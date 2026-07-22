import { createServerFn } from "@tanstack/react-start";
import { db, purchaseRecords, materialStock, transactions, wallets, expenses } from "@/db";
import { eq, sql, and } from "drizzle-orm";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";

import { packagingMaterials } from "@/db/schemas/inventory-schema";
import { expenseCategories } from "@/db/schemas/finance-schema";

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
  minStock: z.string().optional(),
  unit: z.string().optional(),
  // Payment fields
  walletId: z.string().optional(),
  paymentStatus: z.enum(["paid", "partial", "unpaid"]).optional(),
  paidAmount: z.string().optional(),
  supplierName: z.string().optional(),
});

export const updatePurchaseRecordFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(updatePurchaseSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // 1. Get existing purchase record
      const existingRecord = await tx.query.purchaseRecords.findFirst({
        where: eq(purchaseRecords.id, data.id),
      });

      if (!existingRecord) {
        throw new Error("Purchase record not found");
      }

      let qtyDiff = 0;
      if (data.quantity) {
        const oldQty = parseFloat(existingRecord.quantity);
        const newQty = parseFloat(data.quantity);
        qtyDiff = newQty - oldQty;
      }

      // 2. Update Stock if quantity changed
      if (qtyDiff !== 0) {
        const materialField =
          existingRecord.materialType === "chemical"
            ? materialStock.chemicalId
            : materialStock.packagingMaterialId;

        const materialId =
          existingRecord.materialType === "chemical"
            ? existingRecord.chemicalId
            : existingRecord.packagingMaterialId;

        if (materialId) {
          const stockRecord = await tx.query.materialStock.findFirst({
            where: and(
              eq(materialStock.warehouseId, existingRecord.warehouseId),
              eq(materialField, materialId),
            ),
          });

          if (stockRecord) {
            await tx
              .update(materialStock)
              .set({
                quantity: sql`${materialStock.quantity} + ${qtyDiff.toString()}`,
                updatedAt: new Date(),
              })
              .where(eq(materialStock.id, stockRecord.id));
          } else {
            // If no stock record exists (weird, but possible if deleted manually), create one?
            // For now, ignore or throw. Stock should exist if purchase exists.
          }
        }
      }

      // 3. Update Material if applicable (Packaging only as per user request)
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
            minimumStockLevel: data.minStock
              ? parseInt(data.minStock)
              : undefined,
            updatedAt: new Date(),
          })
          .where(eq(packagingMaterials.id, existingRecord.packagingMaterialId));
      }

      // 4. Update Purchase Record
      const updateData: any = {
        notes: data.notes || null,
        invoiceNumber: data.invoiceNumber || null,
        transactionId: data.transactionId || null,
        updatedAt: new Date(),
      };

      if (data.quantity && data.cost) {
        updateData.quantity = data.quantity;
        updateData.cost = data.cost;
        updateData.unitCost = (
          parseFloat(data.cost) / parseFloat(data.quantity)
        ).toFixed(4);
      }

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
          description: `Supplier Purchase: ${data.materialName} from ${data.supplierName}`,
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

      return { success: true };
    });
  });
