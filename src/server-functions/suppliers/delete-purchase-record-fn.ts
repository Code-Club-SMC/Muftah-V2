import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import {
  db,
  purchaseRecords,
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
import { packagingUnit } from "@/lib/inventory/material-units";

const deletePurchaseSchema = z.object({
  id: z.string(),
  reason: z.string().trim().min(1, "A void reason is required").max(1000),
  // Where the money goes back, and how much. Left out means everything that was paid, to the wallet that paid.
  refundWalletId: z.string().optional(),
  refundAmount: z.string().optional(),
});

export const deletePurchaseRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(deletePurchaseSchema)
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    const audit = await db.transaction(async (tx) => {
      // All purchase writers take this lock before checking state or changing stock/money.
      const [locked] = await tx.select({ id: purchaseRecords.id }).from(purchaseRecords)
        .where(eq(purchaseRecords.id, data.id)).for("update");
      const purchase = locked && await tx.query.purchaseRecords.findFirst({
        where: eq(purchaseRecords.id, data.id),
        with: { chemical: true, packagingMaterial: true, supplier: true },
      });

      if (!purchase) {
        throw new Error("Purchase record not found");
      }
      if (purchase.voidedAt) throw new Error("Purchase is already voided");

      const ref = purchase.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
        : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
      await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
      if (!(await purchaseIsUntouched(tx, purchase))) throw new Error(PURCHASE_LOCKED_MESSAGE);

      const material = purchase.materialType === "chemical" ? purchase.chemical : purchase.packagingMaterial;
      if (!material) throw new Error("Purchase material not found");
      const materialName = material.name;
      const { payments, walletIds } = await loadPurchasePayments(tx, purchase.id, data.refundWalletId ? [data.refundWalletId] : []);
      const plan = planPurchaseRefund({
        payments,
        walletIds,
        refundWalletId: data.refundWalletId,
        refundAmount: data.refundAmount,
      });
      if (plan.refund.gt(purchase.paidAmount)) throw new Error("Refund cannot be more than the purchase paid amount");

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
          .set({ voidedAt: new Date(), voidedById: userId, voidReason: `Void purchase: ${data.reason}` })
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
          description: `Refund for voided purchase of ${materialName}`,
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

      // Keep original purchase/payment rows; the stock movement and snapshot record the reversal.
      await moveLotStock(tx, { ref, lotId: purchase.lotId!, warehouseId: purchase.warehouseId, delta: `-${new Big(purchase.quantity).toFixed(3)}`, sourceType: "purchase_delete", sourceId: purchase.id });

      await tx.update(purchaseRecords).set({
        voidedAt: new Date(),
        voidedById: userId,
        voidReason: data.reason,
        voidRefundAmount: plan.refund.toFixed(2),
        voidRefundWalletId: plan.refund.gt(0) ? plan.refundWalletId : null,
        voidSnapshot: {
          materialName,
          unit: purchase.materialType === "chemical" ? purchase.chemical!.unit : packagingUnit(purchase.packagingMaterial),
          supplierName: purchase.supplier.supplierName,
        },
      }).where(eq(purchaseRecords.id, purchase.id));
      return { materialName, paid: plan.paid.toFixed(2), refund: plan.refund.toFixed(2) };
    });

    void logActivityQuiet({
      module: "suppliers",
      action: "voided",
      entityType: "purchase",
      entityId: data.id,
      entityLabel: audit.materialName,
      actorId: userId,
      actorName: context.session.user.name,
      description: `Voided purchase of ${audit.materialName}; refunded ${audit.refund} of ${audit.paid} paid. Reason: ${data.reason}`,
      severity: "info",
    });

    return { success: true };
  });
