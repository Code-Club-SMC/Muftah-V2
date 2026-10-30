import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import {
  db,
  chemicals,
  warehouses,
  purchaseRecords,
  supplierPayments,
  wallets,
  expenses,
  transactions,
  suppliers,
} from "@/db";
import { eq, sql } from "drizzle-orm";
import { isSimilarMaterialName, lotPrice } from "@/lib/inventory/material-lots";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { addChemicalSchema } from "@/lib/validators/validators";
import { createId } from "@paralleldrive/cuid2";
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

export const addRawMaterialFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(addChemicalSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // Validate Warehouse
      const warehouse = await tx.query.warehouses.findFirst({
        where: eq(warehouses.id, data.warehouseId),
      });

      if (!warehouse) throw new Error("Warehouse not found");
      if (warehouse.type !== "factory_floor") {
        throw new Error(
          "Raw materials must be added to a Factory Floor facility.",
        );
      }

      const targetWarehouseId = warehouse.id;

      // The same name must buy through Add stock; other near-misses need confirmation (typo guard).
      const candidates = await tx.select({ id: chemicals.id, name: chemicals.name }).from(chemicals);
      const exact = candidates.find((row) => row.name.trim() === data.name.trim());
      if (exact) throw new Error(`Similar item already exists: "${exact.name}". Use Add stock to buy more of it.`);
      const similar = candidates.find((row) => isSimilarMaterialName(row.name, data.name));
      if (similar && !data.confirmSimilarName) throw new Error(`Similar item already exists: "${similar.name}"`);

      const [finalMaterial] = await tx
        .insert(chemicals)
        .values({
          name: data.name.trim(),
          unit: data.unit,
          costPerUnit: lotPrice(data.costPerUnit),
          minimumStockLevel: data.minimumStockLevel,
          packagingType: data.packagingType,
          packagingSize: data.packagingSize,
          lastSupplierId: data.supplierId,
        })
        .returning();

      const materialId = finalMaterial.id;

      // 2. Initialize or Update stock
      if (parseFloat(data.quantity || "0") > 0) {
        const ref = { materialType: "chemical", materialId } as const;
        await lockMaterialStock(tx, [targetWarehouseId], [ref]);
        const lot = await findOrCreateLot(tx, ref, data.costPerUnit);

        // 3. Create Purchase Record
        const totalCost = (
          parseFloat(data.costPerUnit) * parseFloat(data.quantity)
        ).toFixed(2);

        // Determine paid amount based on paymentStatus
        let amountToRecord = 0;
        if (data.paymentStatus === "paid") {
          amountToRecord = parseFloat(totalCost);
        } else if (data.paymentStatus === "partial" && data.amountPaid) {
          amountToRecord = parseFloat(data.amountPaid);
        }

        const [purchase] = await tx
          .insert(purchaseRecords)
          .values({
            supplierId: data.supplierId,
            warehouseId: targetWarehouseId,
            materialType: "chemical",
            chemicalId: materialId,
            quantity: data.quantity,
            cost: totalCost,
            paidAmount: amountToRecord.toString(),
            unitCost: lot.unitPrice,
            lotId: lot.id,
            notes: data.notes || "Initial Stock",
            paymentMethod: data.paymentMethod,
            bankName: data.bankName,
            transactionId: data.transactionId || null,
          })
          .returning();

        await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: targetWarehouseId, delta: data.quantity, sourceType: "purchase", sourceId: purchase.id });

        if (amountToRecord > 0) {
          await tx.insert(supplierPayments).values({
            supplierId: data.supplierId,
            purchaseId: purchase.id,
            amount: amountToRecord.toString(),
            method: data.paymentMethod,
            bankName: data.bankName,
            reference: data.transactionId || undefined,
            notes:
              data.paymentStatus === "partial"
                ? "Partial payment for stock purchase"
                : "Full payment for stock purchase",
          });
        }

        // 4. Conditionally create expense and debit wallet
        const walletId = data.walletId || data.paymentMethod;
        if (
          walletId &&
          walletId !== "pay_later" &&
          (data.paymentStatus === "paid" || data.paymentStatus === "partial")
        ) {
          const expenseAmount =
            data.paymentStatus === "paid"
              ? parseFloat(totalCost)
              : parseFloat(data.amountPaid ?? "0");

          // Look up supplier name for expense description
          const [supplier] = await tx
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, data.supplierId));
          const supplierName = supplier?.supplierName ?? "Unknown Supplier";

          // Balance check
          const [wallet] = await tx
            .select()
            .from(wallets)
            .where(eq(wallets.id, walletId));
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
            .where(eq(wallets.id, walletId));

          // Insert expense
          const expenseCategory = await ensureSupplierPurchaseCategory(tx);
          const expenseId = createId();
          await tx.insert(expenses).values({
            id: expenseId,
            description: `Supplier Purchase: ${data.name} from ${supplierName}`,
            category: expenseCategory.name,
            categoryId: expenseCategory.id,
            amount: expenseAmount.toString(),
            walletId: walletId,
            performedById: context.session.user.id,
          });

          // Insert transaction journal entry
          await tx.insert(transactions).values({
            id: createId(),
            walletId: walletId,
            type: "debit",
            amount: expenseAmount.toString(),
            source: "Expense",
            referenceId: expenseId,
            performedById: context.session.user.id,
          });
        }
      }
      logActivityQuiet({
        module: "inventory",
        action: "created",
        entityType: "chemical",
        entityLabel: finalMaterial.name,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Added raw material ${finalMaterial.name} to inventory`,
      });

      return finalMaterial;
    });
  });
