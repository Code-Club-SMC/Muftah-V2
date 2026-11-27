import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireSuppliersManageMiddleware, requireSuppliersViewMiddleware } from "@/lib/middlewares";
import {
  applySupplierCredit,
  cancelSupplierReturn,
  completeSupplierReturn,
  dispatchSupplierReturn,
  getSupplierReturn,
  listSupplierReturns,
  previewDebitNote,
  requestSupplierReturn,
  returnableForPurchase,
  voidSupplierReturn,
} from "@/lib/suppliers/supplier-returns.server";

type Actor = { id: string; name: string };
const id = z.string().min(1);
const reason = z.string().trim().min(1, "A reason is required").max(1000);
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with at most 2 decimals");

function log(
  actor: Actor,
  action: "created" | "updated" | "deleted",
  entityId: string,
  label: string,
  description: string,
  metadata: Record<string, unknown>,
) {
  void logActivityQuiet({
    module: "suppliers",
    action,
    entityType: "supplier_return",
    entityId,
    entityLabel: label,
    actorId: actor.id,
    actorName: actor.name,
    description,
    severity: action === "deleted" ? "warning" : "info",
    metadata,
  });
}

export const getPurchaseReturnableFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ purchaseId: id }))
  .handler(({ data }) => db.transaction((tx) => returnableForPurchase(tx, data.purchaseId)));

export const listSupplierReturnsFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ supplierId: id, queue: z.enum(["to_dispatch", "dispatched", "done"]) }))
  .handler(({ data }) => db.transaction((tx) => listSupplierReturns(tx, data)));

export const getSupplierReturnFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data }) => db.transaction((tx) => getSupplierReturn(tx, data.id)));

export const previewDebitNoteFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data }) => db.transaction((tx) => previewDebitNote(tx, data.id)));

export const requestSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(
    z.object({ purchaseId: id, quantity: z.string().trim(), reason, notes: z.string().trim().max(1000).optional() }),
  )
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => requestSupplierReturn(tx, data, context.session.user.id));
    log(
      context.session.user,
      "created",
      result.id,
      result.returnNumber,
      `Requested supplier return ${result.returnNumber} of ${data.quantity} (PKR ${result.totalAmount}). Reason: ${data.reason}`,
      { purchaseId: data.purchaseId, ...result },
    );
    return result;
  });

export const dispatchSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => dispatchSupplierReturn(tx, { returnId: data.id }, context.session.user.id));
    log(
      context.session.user,
      "updated",
      data.id,
      result.returnNumber,
      `Dispatched supplier return ${result.returnNumber} (${result.quantity} taken out of stock)`,
      result,
    );
    return result;
  });

export const completeSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, cashBack: money.optional(), refundWalletId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) =>
      completeSupplierReturn(
        tx,
        { returnId: data.id, cashBack: data.cashBack, refundWalletId: data.refundWalletId },
        context.session.user.id,
      ),
    );
    log(
      context.session.user,
      "updated",
      data.id,
      result.debitNoteNumber,
      `Issued debit note ${result.debitNoteNumber}: PKR ${result.applied} off the purchase, PKR ${result.refund} cash back, PKR ${result.credit} supplier credit`,
      result,
    );
    return result;
  });

export const cancelSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, reason }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) =>
      cancelSupplierReturn(tx, { returnId: data.id, reason: data.reason }, context.session.user.id),
    );
    log(
      context.session.user,
      "deleted",
      data.id,
      result.returnNumber,
      `Cancelled supplier return ${result.returnNumber}${result.stockRestored ? " and put the stock back" : ""}. Reason: ${data.reason}`,
      result,
    );
    return result;
  });

export const voidSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, reason }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) =>
      voidSupplierReturn(tx, { returnId: data.id, reason: data.reason }, context.session.user.id),
    );
    log(
      context.session.user,
      "deleted",
      data.id,
      result.debitNoteNumber,
      `Voided debit note ${result.debitNoteNumber}. Reason: ${data.reason}`,
      result,
    );
    return result;
  });

export const applySupplierCreditFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ purchaseId: id, amount: money }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => applySupplierCredit(tx, data, context.session.user.id));
    log(
      context.session.user,
      "created",
      result.paymentId,
      data.amount,
      `Paid PKR ${data.amount} from supplier credit`,
      { purchaseId: data.purchaseId, ...result },
    );
    return result;
  });
