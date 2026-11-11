import { createServerFn } from "@tanstack/react-start";
import { db, purchaseRecords, transactions, wallets, expenses, suppliers } from "@/db";
import { eq, sql } from "drizzle-orm";
import Big from "big.js";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { lotPrice, lotQuantity, PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { findOrCreateLot, lockMaterialStock, moveLotStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";

import { chemicals, packagingMaterials } from "@/db/schemas/inventory-schema";
import { expenseCategories } from "@/db/schemas/finance-schema";
import { chemicalStockThresholdSchema, packagingStockThresholdSchema, packagingKindSchema } from "@/lib/validators/validators";

type FinanceWriter = Pick<typeof db, "query" | "select" | "insert" | "update">;

async function ensureSupplierPurchaseCategory(tx: FinanceWriter) {
  const existingCategory = await tx.query.expenseCategories.findFirst({
    where: eq(expenseCategories.slug, "supplier-purchase"),
    columns: {
      id: true,
      name: true,
      isActive: true,
      isArchived: true,
    },
  });

  if (existingCategory) {
    if (!existingCategory.isActive || existingCategory.isArchived) {
      await tx
        .update(expenseCategories)
        .set({
          name: "Supplier Purchase",
          isActive: true,
          isArchived: false,
          updatedAt: new Date(),
        })
        .where(eq(expenseCategories.id, existingCategory.id));
    }

    return {
      id: existingCategory.id,
      name: "Supplier Purchase",
    };
  }

  const [createdCategory] = await tx
    .insert(expenseCategories)
    .values({
      id: createId(),
      name: "Supplier Purchase",
      slug: "supplier-purchase",
      sortOrder: 500,
      isActive: true,
      isArchived: false,
    })
    .returning({
      id: expenseCategories.id,
      name: expenseCategories.name,
    });

  return createdCategory;
}

const updatePurchaseSchema = z.object({
  id: z.string(),
  quantity: z.string().optional(),
  cost: z.string().optional(),
  notes: z.string().optional(),
  transactionId: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  // Material fields
  materialName: z.string().optional(),
  capacity: z.string().optional(),
  capacityUnit: z.string().optional(),
  packagingKind: packagingKindSchema,
  minStock: z.union([chemicalStockThresholdSchema, packagingStockThresholdSchema]).optional(),
  unit: z.string().optional(),
  // Payment fields
  walletId: z.string().optional(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]).optional(),
  paidAmount: z.string().optional(),
  supplierName: z.string().optional(),
});

export const updatePurchaseRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(updatePurchaseSchema)
  .handler(async ({ data, context }) => {
    const audit = await db.transaction(async (tx) => {
      // 1. Get existing purchase record
      const [existingRecord] = await tx.select().from(purchaseRecords)
        .where(eq(purchaseRecords.id, data.id)).for("update");

      if (!existingRecord) {
        throw new Error("Purchase record not found");
      }
      if (existingRecord.voidedAt) throw new Error("Purchase is already voided");
      const minimumStock = data.minStock === undefined ? undefined
        : (existingRecord.materialType === "chemical" ? chemicalStockThresholdSchema : packagingStockThresholdSchema).parse(data.minStock);

      let resolvedMaterialName = data.materialName?.trim() || "";
      if (!resolvedMaterialName) {
        if (existingRecord.materialType === "chemical" && existingRecord.chemicalId) {
          const [chemical] = await tx
            .select({ name: chemicals.name })
            .from(chemicals)
            .where(eq(chemicals.id, existingRecord.chemicalId));
          resolvedMaterialName = chemical?.name ?? "Unknown Material";
        } else if (existingRecord.materialType === "packaging" && existingRecord.packagingMaterialId) {
          const [pkg] = await tx
            .select({ name: packagingMaterials.name })
            .from(packagingMaterials)
            .where(eq(packagingMaterials.id, existingRecord.packagingMaterialId));
          resolvedMaterialName = pkg?.name ?? "Unknown Material";
        } else {
          resolvedMaterialName = "Unknown Material";
        }
      }

      let resolvedSupplierName = data.supplierName?.trim() || "";
      if (!resolvedSupplierName) {
        if (existingRecord.supplierId) {
          const [supplier] = await tx
            .select({ supplierName: suppliers.supplierName })
            .from(suppliers)
            .where(eq(suppliers.id, existingRecord.supplierId));
          resolvedSupplierName = supplier?.supplierName ?? "Unknown Supplier";
        } else {
          resolvedSupplierName = "Unknown Supplier";
        }
      }

      // 2. Move lot stock if quantity or price changed. Only allowed while the purchase is untouched.
      const ref = existingRecord.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: existingRecord.chemicalId! }
        : { materialType: "packaging" as const, materialId: existingRecord.packagingMaterialId! };
      const newQuantity = data.quantity ? lotQuantity(data.quantity) : new Big(existingRecord.quantity).toFixed(3);
      if (new Big(newQuantity).lte(0)) throw new Error("Quantity must be more than zero");
      const newCost = data.cost ?? existingRecord.cost;
      const newPrice = lotPrice(new Big(newCost).div(newQuantity));
      const quantityChanged = !new Big(newQuantity).eq(existingRecord.quantity);
      const priceChanged = !existingRecord.lotId || newPrice !== lotPrice(existingRecord.unitCost);
      let lotId = existingRecord.lotId;
      if (quantityChanged || (priceChanged && existingRecord.lotId)) {
        await lockMaterialStock(tx, [existingRecord.warehouseId], [ref]);
        const untouched = await purchaseIsUntouched(tx, existingRecord);
        if (quantityChanged && !untouched) throw new Error(PURCHASE_LOCKED_MESSAGE);
        if (untouched) {
          const target = await findOrCreateLot(tx, ref, newPrice);
          await moveLotStock(tx, { ref, lotId: existingRecord.lotId!, warehouseId: existingRecord.warehouseId, delta: `-${new Big(existingRecord.quantity).toFixed(3)}`, sourceType: "purchase_edit", sourceId: existingRecord.id });
          await moveLotStock(tx, { ref, lotId: target.id, warehouseId: existingRecord.warehouseId, delta: newQuantity, sourceType: "purchase_edit", sourceId: existingRecord.id });
          lotId = target.id;
        }
        // Not untouched and only the price changed: the bill changes, the lot price does not.
      }

      if (existingRecord.materialType === "chemical" && existingRecord.chemicalId && minimumStock !== undefined) {
        await tx.update(chemicals).set({ minimumStockLevel: String(minimumStock), updatedAt: new Date() })
          .where(eq(chemicals.id, existingRecord.chemicalId));
      }

      // 3. Update explicitly supplied material fields.
      if (
        existingRecord.materialType === "packaging" &&
        existingRecord.packagingMaterialId
      ) {
        await tx
          .update(packagingMaterials)
          .set({
            name: data.materialName || undefined,
            capacity: data.capacity || undefined,
            capacityUnit: data.capacityUnit || undefined,
            packagingKind: data.packagingKind,
            minimumStockLevel: minimumStock === undefined ? undefined : Number(minimumStock),
            updatedAt: new Date(),
          })
          .where(eq(packagingMaterials.id, existingRecord.packagingMaterialId));
      }

      // 4. Update Purchase Record
      const updateData = {
        notes: data.notes || null,
        invoiceNumber: data.invoiceNumber || null,
        transactionId: data.transactionId || null,
        updatedAt: new Date(),
        quantity: newQuantity,
        cost: new Big(newCost).toFixed(2),
        unitCost: new Big(newCost).div(newQuantity).toFixed(4),
        lotId,
      };

      await tx
        .update(purchaseRecords)
        .set(updateData)
        .where(eq(purchaseRecords.id, data.id));

      // 5. Conditionally create expense and debit wallet
      if (
        data.walletId &&
        data.walletId !== "pay_later" &&
        (data.paymentStatus === "paid" || data.paymentStatus === "partial")
      ) {
        const expenseAmount =
          data.paymentStatus === "paid"
            ? parseFloat(data.cost ?? existingRecord.cost)
            : parseFloat(data.paidAmount ?? "0");

        // Balance check
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.id, data.walletId));
        if (!wallet) throw new Error("Wallet not found");
        const currentBalance = parseFloat(wallet.balance || "0");
        if (currentBalance < expenseAmount) {
          throw new Error(
            `Insufficient balance in "${wallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${expenseAmount.toLocaleString()}`,
          );
        }

        // Debit wallet
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${expenseAmount}` })
          .where(eq(wallets.id, data.walletId));

        // Insert expense
        const expenseCategory = await ensureSupplierPurchaseCategory(tx);
        const expenseId = createId();
        await tx.insert(expenses).values({
          id: expenseId,
          description: `Supplier Purchase: ${resolvedMaterialName} from ${resolvedSupplierName}`,
          category: expenseCategory.name,
          categoryId: expenseCategory.id,
          amount: expenseAmount.toString(),
          walletId: data.walletId,
          performedById: context.session.user.id,
        });

        // Insert transaction journal entry
        await tx.insert(transactions).values({
          id: createId(),
          walletId: data.walletId,
          type: "debit",
          amount: expenseAmount.toString(),
          source: "Expense",
          referenceId: expenseId,
          performedById: context.session.user.id,
        });
      }

      return {
        purchaseId: existingRecord.id,
        supplierId: existingRecord.supplierId,
        supplierName: resolvedSupplierName,
        materialType: existingRecord.materialType,
        materialId: existingRecord.materialType === "chemical"
          ? existingRecord.chemicalId
          : existingRecord.packagingMaterialId,
        materialName: resolvedMaterialName,
        previousQuantity: new Big(existingRecord.quantity).toFixed(3),
        newQuantity,
        previousCost: new Big(existingRecord.cost).toFixed(2),
        newCost: updateData.cost,
        previousInvoiceNumber: existingRecord.invoiceNumber ?? null,
        newInvoiceNumber: updateData.invoiceNumber,
        previousNotes: existingRecord.notes ?? null,
        newNotes: updateData.notes,
      };
    });

    await logActivityQuiet({
      module: "suppliers",
      action: "updated",
      entityType: "purchase",
      entityId: audit.purchaseId,
      entityLabel: `${audit.materialName} (${audit.newQuantity})`,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Updated purchase of ${audit.materialName} from ${audit.supplierName} (Qty ${audit.previousQuantity} to ${audit.newQuantity}, Cost PKR ${audit.previousCost} to PKR ${audit.newCost})`,
      severity: "info",
      metadata: {
        purchaseId: audit.purchaseId,
        supplierId: audit.supplierId,
        supplierName: audit.supplierName,
        materialType: audit.materialType,
        materialId: audit.materialId,
        materialName: audit.materialName,
        previousQuantity: audit.previousQuantity,
        newQuantity: audit.newQuantity,
        previousCost: audit.previousCost,
        newCost: audit.newCost,
        previousInvoiceNumber: audit.previousInvoiceNumber,
        newInvoiceNumber: audit.newInvoiceNumber,
        previousNotes: audit.previousNotes,
        newNotes: audit.newNotes,
      },
    });

    return { success: true };
  });
