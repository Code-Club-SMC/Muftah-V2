import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import {
  db,
  purchaseRecords,
  supplierPayments,
  wallets,
  expenses,
  transactions,
  chemicals,
  packagingMaterials,
  inventoryAuditLog,
} from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
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
  reason: z.string().trim().min(1, "A deletion reason is required").max(1000),
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
      const [locked] = await tx
        .select({ id: purchaseRecords.id })
        .from(purchaseRecords)
        .where(eq(purchaseRecords.id, data.id))
        .for("update");
      const purchase = locked
        ? await tx.query.purchaseRecords.findFirst({
            where: eq(purchaseRecords.id, data.id),
            with: {
              chemical: true,
              packagingMaterial: true,
              supplier: true,
              warehouse: true,
            },
          })
        : null;

      if (!purchase) {
        throw new Error("Purchase record not found");
      }

      const isAlreadyVoided = Boolean(purchase.voidedAt);
      const material = purchase.materialType === "chemical"
        ? purchase.chemical
        : purchase.packagingMaterial;
      if (!material && !isAlreadyVoided) {
        throw new Error("Purchase material not found");
      }

      const materialName =
        material?.name ?? purchase.voidSnapshot?.materialName ?? "Unknown Material";
      const unit = purchase.materialType === "chemical"
        ? (purchase.chemical?.unit ?? purchase.voidSnapshot?.unit ?? "kg")
        : (purchase.packagingMaterial
            ? packagingUnit(purchase.packagingMaterial)
            : (purchase.voidSnapshot?.unit ?? "units"));
      const supplierName =
        purchase.supplier?.supplierName ??
        purchase.voidSnapshot?.supplierName ??
        "Unknown Supplier";
      const warehouseName = purchase.warehouse?.name ?? purchase.warehouseId;

      let refund = new Big(0);
      let refundWalletId: string | null = null;
      let refundWalletName: string | null = null;
      let unrefundedAmount = new Big(0);

      if (!isAlreadyVoided) {
        const ref = purchase.materialType === "chemical"
          ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
          : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };

        await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
        if (!(await purchaseIsUntouched(tx, purchase))) {
          throw new Error(PURCHASE_LOCKED_MESSAGE);
        }

        const [attachedReport] = await tx
          .select({ id: chemicalLabReports.id })
          .from(chemicalLabReports)
          .where(eq(chemicalLabReports.purchaseId, purchase.id))
          .limit(1);
        if (attachedReport) {
          throw new Error(
            "Cannot delete purchase while a chemical lab report is attached. Delete the lab report(s) first.",
          );
        }

        const { payments, walletIds } = await loadPurchasePayments(
          tx,
          purchase.id,
          data.refundWalletId ? [data.refundWalletId] : [],
        );
        const plan = planPurchaseRefund({
          payments,
          walletIds,
          refundWalletId: data.refundWalletId,
          refundAmount: data.refundAmount,
        });
        if (plan.refund.gt(purchase.paidAmount)) {
          throw new Error("Refund cannot be more than the purchase paid amount");
        }

        refund = plan.refund;
        refundWalletId = plan.refundWalletId;
        unrefundedAmount = plan.loss;

        // 1. Void auto-recorded purchase expenses (linked wallet debits remain in history).
        const voidedIds: string[] = [];
        for (const paidRow of plan.moved) {
          const [expense] = await tx
            .select({ id: expenses.id })
            .from(expenses)
            .where(
              and(
                eq(expenses.walletId, paidRow.walletId),
                eq(expenses.amount, paidRow.amount.toFixed(2)),
                eq(expenses.category, "Supplier Purchase"),
                // Never touch hand-recorded expenses that happen to match.
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
            .set({
              voidedAt: new Date(),
              voidedById: userId,
              voidReason: `Purchase deleted: ${data.reason}`,
            })
            .where(eq(expenses.id, expense.id));
        }

        // 2. Credit selected refund wallet.
        if (plan.refund.gt(0) && plan.refundWalletId) {
          const amount = plan.refund.toFixed(2);
          const [refundWallet] = await tx
            .select({ name: wallets.name })
            .from(wallets)
            .where(eq(wallets.id, plan.refundWalletId))
            .limit(1);
          refundWalletName = refundWallet?.name ?? plan.refundWalletId;

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

        // 3. Keep any unrefunded portion as an expense on the original paying wallet.
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

        // 4. Reverse lot and total material stock, and append an inventory audit debit entry.
        await moveLotStock(tx, {
          ref,
          lotId: purchase.lotId!,
          warehouseId: purchase.warehouseId,
          delta: `-${new Big(purchase.quantity).toFixed(3)}`,
          sourceType: "purchase_delete",
          sourceId: purchase.id,
        });

        await tx.insert(inventoryAuditLog).values({
          warehouseId: purchase.warehouseId,
          materialType: purchase.materialType,
          materialId: ref.materialId,
          type: "debit",
          amount: new Big(purchase.quantity).toFixed(3),
          reason: `Purchase deleted (${supplierName}): ${data.reason}`,
          performedById: userId,
          referenceId: purchase.id,
          lotId: purchase.lotId,
        });
      } else {
        // Legacy previously voided row: still require lab reports to be removed first,
        // and never double-reverse stock or refund money.
        const [attachedReport] = await tx
          .select({ id: chemicalLabReports.id })
          .from(chemicalLabReports)
          .where(eq(chemicalLabReports.purchaseId, purchase.id))
          .limit(1);
        if (attachedReport) {
          throw new Error(
            "Cannot delete purchase while a chemical lab report is attached. Delete the lab report(s) first.",
          );
        }
      }

      // Delete linked supplier payments and the purchase record itself.
      const existingPayments = await tx
        .select({ id: supplierPayments.id })
        .from(supplierPayments)
        .where(eq(supplierPayments.purchaseId, purchase.id));

      await tx
        .delete(supplierPayments)
        .where(eq(supplierPayments.purchaseId, purchase.id));

      await tx
        .delete(purchaseRecords)
        .where(eq(purchaseRecords.id, purchase.id));

      // Keep material.lastSupplierId valid if it pointed to this deleted purchase's supplier.
      const materialId = purchase.materialType === "chemical"
        ? purchase.chemicalId
        : purchase.packagingMaterialId;
      if (
        material &&
        materialId &&
        (material as { lastSupplierId?: string | null }).lastSupplierId === purchase.supplierId
      ) {
        const materialFilter = purchase.materialType === "chemical"
          ? eq(purchaseRecords.chemicalId, materialId)
          : eq(purchaseRecords.packagingMaterialId, materialId);
        const remainingPurchases = await tx
          .select({
            supplierId: purchaseRecords.supplierId,
            purchaseDate: purchaseRecords.purchaseDate,
            createdAt: purchaseRecords.createdAt,
          })
          .from(purchaseRecords)
          .where(and(materialFilter, isNull(purchaseRecords.voidedAt)));

        remainingPurchases.sort((a, b) => {
          const dateDiff =
            new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        const nextSupplierId = remainingPurchases[0]?.supplierId ?? null;
        if (purchase.materialType === "chemical") {
          await tx
            .update(chemicals)
            .set({ lastSupplierId: nextSupplierId, updatedAt: new Date() })
            .where(eq(chemicals.id, materialId));
        } else {
          await tx
            .update(packagingMaterials)
            .set({ lastSupplierId: nextSupplierId, updatedAt: new Date() })
            .where(eq(packagingMaterials.id, materialId));
        }
      }

      return {
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        supplierName,
        warehouseId: purchase.warehouseId,
        warehouseName,
        materialType: purchase.materialType,
        materialId: materialId ?? null,
        materialName,
        unit,
        quantity: new Big(purchase.quantity).toFixed(3),
        cost: new Big(purchase.cost).toFixed(2),
        paidAmount: new Big(purchase.paidAmount).toFixed(2),
        refunded: refund.toFixed(2),
        refundWalletId,
        refundWalletName,
        unrefunded: unrefundedAmount.toFixed(2),
        deletedPaymentCount: existingPayments.length,
        wasAlreadyVoided: isAlreadyVoided,
        previousVoidReason: purchase.voidReason ?? null,
        invoiceNumber: purchase.invoiceNumber ?? null,
      };
    });

    await logActivityQuiet({
      module: "suppliers",
      action: "deleted",
      entityType: "purchase",
      entityId: audit.purchaseId,
      entityLabel: `${audit.materialName} (${audit.quantity} ${audit.unit})`,
      actorId: userId,
      actorName: context.session.user.name,
      description: audit.wasAlreadyVoided
        ? `Permanently deleted previously voided purchase of ${audit.quantity} ${audit.unit} ${audit.materialName} from ${audit.supplierName}. Reason: ${data.reason}`
        : `Deleted purchase of ${audit.quantity} ${audit.unit} ${audit.materialName} from ${audit.supplierName}; refunded PKR ${audit.refunded} of PKR ${audit.paidAmount} paid. Reason: ${data.reason}`,
      severity: "warning",
      metadata: {
        purchaseId: audit.purchaseId,
        supplierId: audit.supplierId,
        supplierName: audit.supplierName,
        warehouseId: audit.warehouseId,
        warehouseName: audit.warehouseName,
        materialType: audit.materialType,
        materialId: audit.materialId,
        materialName: audit.materialName,
        quantity: `${audit.quantity} ${audit.unit}`,
        cost: audit.cost,
        paidAmount: audit.paidAmount,
        refundAmount: audit.refunded,
        refundWalletId: audit.refundWalletId,
        refundWalletName: audit.refundWalletName,
        unrefundedAmount: audit.unrefunded,
        deletedPaymentCount: audit.deletedPaymentCount,
        wasAlreadyVoided: audit.wasAlreadyVoided,
        previousVoidReason: audit.previousVoidReason,
        invoiceNumber: audit.invoiceNumber,
        reason: data.reason,
      },
    });

    return { success: true };
  });
