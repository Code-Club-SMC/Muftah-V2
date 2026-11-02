import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import {
  db,
  purchaseRecords,
  supplierPayments,
  wallets,
  expenses,
  transactions,
} from "@/db";
import { expenseCategories } from "@/db/schemas/finance-schema";
import { eq, and, isNull, notInArray, sql } from "drizzle-orm";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import Big from "big.js";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";
import { planPurchaseRefund } from "@/lib/suppliers/purchase-refund";
import { loadPurchasePayments } from "@/lib/suppliers/purchase-refund.server";
import { z } from "zod";

const deletePurchaseSchema = z.object({
  id: z.string(),
  // Where the money goes back, and how much. Left out means everything that was paid, to the wallet that paid.
  refundWalletId: z.string().optional(),
  refundAmount: z.string().optional(),
});

export const deletePurchaseRecordFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(deletePurchaseSchema)
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    await db.transaction(async (tx) => {
      // Read inside the transaction so the check and the delete see the same row
      const [locked] = await tx.select({ id: purchaseRecords.id }).from(purchaseRecords)
        .where(eq(purchaseRecords.id, data.id)).for("update");
      const purchase = locked && await tx.query.purchaseRecords.findFirst({
        where: eq(purchaseRecords.id, data.id),
        with: { chemical: true, packagingMaterial: true },
      });

      if (!purchase) {
        throw new Error("Purchase record not found");
      }

      const ref = purchase.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
        : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
      await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
      if (!(await purchaseIsUntouched(tx, purchase))) throw new Error(PURCHASE_LOCKED_MESSAGE);

      const materialName = purchase.chemical?.name ?? purchase.packagingMaterial?.name ?? "material";
      const { payments, walletIds } = await loadPurchasePayments(tx, purchase.id, data.refundWalletId ? [data.refundWalletId] : []);
      const plan = planPurchaseRefund({
        payments,
        walletIds,
        refundWalletId: data.refundWalletId,
        refundAmount: data.refundAmount,
      });

      // 1. The purchase never happened, so its expenses are voided. They stay visible, marked voided,
      //    and the original wallet debits stay in the wallet history.
      const voidedIds: string[] = [];
      for (const paid of plan.moved) {
        const [expense] = await tx
          .select({ id: expenses.id })
          .from(expenses)
          .where(
            and(
              eq(expenses.walletId, paid.walletId),
              eq(expenses.amount, paid.amount.toFixed(2)),
              eq(expenses.category, "Supplier Purchase"),
              // Never a hand-recorded expense that happens to match; those are edited or voided instead.
              eq(expenses.origin, "system"),
              isNull(expenses.voidedAt),
              voidedIds.length ? notInArray(expenses.id, voidedIds) : undefined,
            ),
          )
          .limit(1);
        if (!expense) continue;
        voidedIds.push(expense.id);
        await tx
          .update(expenses)
          .set({ voidedAt: new Date(), voidedById: userId, voidReason: "Purchase record deleted" })
          .where(eq(expenses.id, expense.id));
      }

      // 2. Put the money back in the wallet that was picked.
      if (plan.refund.gt(0) && plan.refundWalletId) {
        const amount = plan.refund.toFixed(2);
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${amount}` })
          .where(eq(wallets.id, plan.refundWalletId));
        await tx.insert(transactions).values({
          id: createId(),
          walletId: plan.refundWalletId,
          type: "credit",
          amount,
          source: "Supplier Refund",
          referenceId: purchase.id,
          description: `Refund for deleted purchase of ${materialName}`,
          performedById: userId,
        });
      }

      // 3. Money that was not given back is a real cost: keep it as an expense on the wallet that paid.
      if (plan.loss.gt(0) && plan.defaultWalletId) {
        const category = await tx.query.expenseCategories.findFirst({
          where: eq(expenseCategories.slug, "supplier-purchase"),
          columns: { id: true },
        });
        if (!category) throw new Error("Supplier Purchase expense category is missing");
        await tx.insert(expenses).values({
          id: createId(),
          description: `Supplier purchase not refunded: ${materialName}`,
          category: "Supplier Purchase",
          categoryId: category.id,
          amount: plan.loss.toFixed(2),
          walletId: plan.defaultWalletId,
          performedById: userId,
        });
      }

      // 4. Delete associated payment rows
      await tx
        .delete(supplierPayments)
        .where(eq(supplierPayments.purchaseId, data.id));

      // 5. Revert stock
      await moveLotStock(tx, { ref, lotId: purchase.lotId!, warehouseId: purchase.warehouseId, delta: `-${new Big(purchase.quantity).toFixed(3)}`, sourceType: "purchase_delete", sourceId: purchase.id });

      // 6. Delete the purchase record
      await tx.delete(purchaseRecords).where(eq(purchaseRecords.id, data.id));

      void logActivityQuiet({
        module: "suppliers",
        action: "deleted",
        entityType: "purchase",
        entityLabel: materialName,
        actorId: userId,
        actorName: context.session.user.name,
        description: plan.paid.gt(0)
          ? `Deleted purchase of ${materialName}; refunded ${plan.refund.toFixed(2)} of ${plan.paid.toFixed(2)} paid`
          : `Deleted purchase of ${materialName}`,
        severity: "info",
      });
    });

    return { success: true };
  });
