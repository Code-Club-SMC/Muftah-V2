import { createServerFn } from "@tanstack/react-start";
import {
  db,
  purchaseRecords,
  supplierPayments,
  wallets,
  expenses,
  transactions,
} from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import Big from "big.js";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";
import { z } from "zod";

const deletePurchaseSchema = z.object({
  id: z.string(),
});

export const deletePurchaseRecordFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(deletePurchaseSchema)
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      // Read inside the transaction so the check and the delete see the same row
      const [locked] = await tx.select({ id: purchaseRecords.id }).from(purchaseRecords)
        .where(eq(purchaseRecords.id, data.id)).for("update");
      const purchase = locked && await tx.query.purchaseRecords.findFirst({
        where: eq(purchaseRecords.id, data.id),
        with: { payments: true },
      });

      if (!purchase) {
        throw new Error("Purchase record not found");
      }

      const ref = purchase.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
        : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
      await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
      if (!(await purchaseIsUntouched(tx, purchase))) throw new Error(PURCHASE_LOCKED_MESSAGE);

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
      await moveLotStock(tx, { ref, lotId: purchase.lotId!, warehouseId: purchase.warehouseId, delta: `-${new Big(purchase.quantity).toFixed(3)}`, sourceType: "purchase_delete", sourceId: purchase.id });

      // 4. Delete the purchase record
      await tx.delete(purchaseRecords).where(eq(purchaseRecords.id, data.id));
    });

    return { success: true };
  });
