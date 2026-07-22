import { createServerFn } from "@tanstack/react-start";
import {
  db,
  purchaseRecords,
  supplierPayments,
  materialStock,
  wallets,
  expenses,
  transactions,
} from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deletePurchaseSchema = z.object({
  id: z.string(),
});

export const deletePurchaseRecordFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(deletePurchaseSchema)
  .handler(async ({ data }) => {
    const purchase = await db.query.purchaseRecords.findFirst({
      where: eq(purchaseRecords.id, data.id),
      with: { payments: true },
    });

    if (!purchase) {
      throw new Error("Purchase record not found");
    }

    await db.transaction(async (tx) => {
      // 1. Restore wallet balances for any payments that debited a real wallet
      for (const payment of purchase.payments) {
        if (!payment.walletId || payment.walletId === "pay_later") continue;

        const amount = parseFloat(payment.amount ?? "0");
        if (amount <= 0) continue;

        // Credit the wallet back
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${amount}` })
          .where(eq(wallets.id, payment.walletId));

        // Remove the associated expense row (matched by walletId + amount + category)
        const [expense] = await tx
          .delete(expenses)
          .where(
            and(
              eq(expenses.walletId, payment.walletId),
              eq(expenses.amount, payment.amount),
              eq(expenses.category, "Supplier Purchase"),
            ),
          )
          .returning();

        // Remove the transaction journal entry linked to that expense
        if (expense) {
          await tx
            .delete(transactions)
            .where(eq(transactions.referenceId, expense.id));
        }
      }

      // 2. Delete associated payment rows
      await tx
        .delete(supplierPayments)
        .where(eq(supplierPayments.purchaseId, data.id));

      // 3. Revert stock
      if (purchase.materialType === "chemical" && purchase.chemicalId) {
        await tx
          .update(materialStock)
          .set({
            quantity: sql`${materialStock.quantity} - ${purchase.quantity}`,
          })
          .where(
            and(
              eq(materialStock.warehouseId, purchase.warehouseId),
              eq(materialStock.chemicalId, purchase.chemicalId),
            ),
          );
      } else if (
        purchase.materialType === "packaging" &&
        purchase.packagingMaterialId
      ) {
        await tx
          .update(materialStock)
          .set({
            quantity: sql`${materialStock.quantity} - ${purchase.quantity}`,
          })
          .where(
            and(
              eq(materialStock.warehouseId, purchase.warehouseId),
              eq(
                materialStock.packagingMaterialId,
                purchase.packagingMaterialId,
              ),
            ),
          );
      }

      // 4. Delete the purchase record
      await tx.delete(purchaseRecords).where(eq(purchaseRecords.id, data.id));
    });

    return { success: true };
  });
