/**
 * Sales returns: Requested → Approved → Completed, or Rejected / Cancelled / Voided.
 * Stock and money move only when a return is completed (received and inspected),
 * and move back, dated on the void day, when a completed return is voided.
 */

import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import {
  salesReturnReasons,
  salesReturns,
  salesReturnItems,
  salesReturnStockTraces,
} from "@/db/schemas/sales-erp-schema";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
import {
  requireReturnsReceiveMiddleware,
  requireSalesReturnsApproveMiddleware,
  requireSalesReturnsCreateMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { recalculateInvoiceSettlement } from "./settlement-service";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";
import { lockCartonReturnOrder } from "@/lib/cartons/sales-return.server";
import { lockCartonStock } from "@/lib/cartons/stock-adjustment.server";
import { hasPermission } from "@/lib/rbac";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnUnitsPerCarton,
  resolveRefundPerUnit,
  sumMoney,
} from "@/lib/sales/returns/refund-pricing";
import {
  RETURN_STATUSES,
  RETURN_TAB_STATUSES,
  allocateReturnCost,
  assertReturnAction,
  checkInspection,
  computeReturnCreditSplit,
  receivedUnits,
  requestedUnits,
  reservedReturnUnits,
  returnCostBasis,
  returnReasonText,
  splitUnits,
  unitsOf,
  type ReturnStatus,
} from "@/lib/sales/returns/return-lifecycle";
import { moneyString, roundMoney } from "@/lib/sales/settlement/money";
import {
  allocateNextCreditNoteNumber,
  ensureCreditNotesBackfilled,
  issueCustomerCreditFromReturn,
  voidReturnCreditSettlement,
} from "./customer-credit-service";
import { restockReturnedUnits, reverseReturnStock } from "@/lib/sales/returns/return-stock.server";

const RETURN_LIST_PAGE_SIZE = 50;

async function lockReturn(tx: any, returnId: string) {
  await tx.select({ id: salesReturns.id }).from(salesReturns).where(eq(salesReturns.id, returnId)).for("update");
  const salesReturn = await tx.query.salesReturns.findFirst({
    where: eq(salesReturns.id, returnId),
    with: { items: true, invoice: true },
  });
  if (!salesReturn) throw new Error("Return not found");
  return salesReturn;
}

/**
 * Units of each invoice line already tied up by returns of this invoice.
 * Open returns hold what they asked for; completed returns hold what arrived.
 */
async function getReservedUnitsByInvoiceItem(
  tx: any,
  invoiceId: string,
  invoiceItemIds: string[],
  options: { statuses?: ReturnStatus[]; excludeReturnId?: string } = {},
) {
  const totals = new Map<string, number>();
  if (invoiceItemIds.length === 0) return totals;

  const rows = await tx.query.salesReturnItems.findMany({
    where: inArray(salesReturnItems.invoiceItemId, invoiceItemIds),
    with: {
      salesReturn: { columns: { id: true, invoiceId: true, status: true } },
      invoiceItem: { columns: { packsPerCarton: true, actualPackSize: true } },
    },
  });

  for (const row of rows) {
    if (row.salesReturn.invoiceId !== invoiceId) continue;
    if (options.excludeReturnId && row.salesReturn.id === options.excludeReturnId) continue;
    if (options.statuses && !options.statuses.includes(row.salesReturn.status)) continue;
    const units = reservedReturnUnits(row.salesReturn.status, row, getReturnUnitsPerCarton(row.invoiceItem));
    totals.set(row.invoiceItemId, (totals.get(row.invoiceItemId) ?? 0) + units);
  }
  return totals;
}

// ── GET RETURNS FOR INVOICE ────────────────────────────────────────────────

export const getSalesReturnsByInvoiceFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ invoiceId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    return await db.query.salesReturns.findMany({
      where: eq(salesReturns.invoiceId, data.invoiceId),
      with: {
        items: {
          with: {
            invoiceItem: true,
            recipe: { columns: { id: true, name: true } },
          },
        },
        approvedBy: { columns: { id: true, name: true } },
        stockTraces: {
          with: {
            recipe: { columns: { id: true, name: true } },
            warehouse: { columns: { id: true, name: true } },
          },
        },
        refunds: {
          with: {
            wallet: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: [desc(salesReturns.returnDate)],
    });
  });

// ── GET RETURN DETAIL ──────────────────────────────────────────────────────

export const getSalesReturnDetailFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ returnId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    await ensureCreditNotesBackfilled(db);
    const person = { columns: { id: true, name: true } } as const;
    const salesReturn = await db.query.salesReturns.findFirst({
      where: eq(salesReturns.id, data.returnId),
      with: {
        invoice: {
          columns: {
            id: true,
            invoiceNumber: true,
            slipNumber: true,
            date: true,
            totalPrice: true,
            invoiceDiscount: true,
            status: true,
          },
          with: { items: true },
        },
        customer: {
          columns: {
            id: true,
            name: true,
            city: true,
            mobileNumber: true,
            outstandingAmount: true,
            creditBalance: true,
            customerType: true,
          },
        },
        createdBy: person,
        approvedBy: person,
        receivedBy: person,
        cancelledBy: person,
        voidedBy: person,
        items: {
          with: {
            invoiceItem: true,
            recipe: { columns: { id: true, name: true } },
          },
        },
        stockTraces: {
          with: {
            recipe: { columns: { id: true, name: true } },
            warehouse: { columns: { id: true, name: true } },
          },
        },
        refunds: {
          with: {
            wallet: { columns: { id: true, name: true } },
            issuedBy: person,
            reversedBy: person,
          },
        },
      },
    });
    if (!salesReturn) throw new Error("Return not found");
    return salesReturn;
  });

// ── CREATE RETURN ──────────────────────────────────────────────────────────

export const createSalesReturnFn = createServerFn()
  .middleware([requireSalesReturnsCreateMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        invoiceId: z.string().min(1),
        returnDate: z.string().optional(),
        reasonId: z.string().min(1, "Pick a reason"),
        reasonNote: z.string().trim().max(500).optional(),
        notes: z.string().optional(),
        priceOverrideReason: z.string().trim().max(500).optional(),
        approveNow: z.boolean().optional(),
        items: z
          .array(
            z.object({
              invoiceItemId: z.string().min(1),
              cartonsReturned: z.number().int().min(0).default(0),
              quantityReturned: z.number().int().min(0).default(0),
              refundPerUnit: z.number().min(0).optional(),
            }),
          )
          .min(1, "At least one return item is required"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;
    const permissions = context.authContext.permissions;

    return await db.transaction(async (tx) => {
      await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, data.invoiceId)).for("update");
      const invoice = await tx.query.invoices.findFirst({
        where: eq(invoices.id, data.invoiceId),
        with: { items: true, customer: true },
      });
      if (!invoice) throw new Error("Invoice not found");
      if (!invoice.customer) throw new Error("Invoice has no linked customer");

      const reasonRow = await tx.query.salesReturnReasons.findFirst({
        where: eq(salesReturnReasons.id, data.reasonId),
      });
      if (!reasonRow || !reasonRow.isActive) throw new Error("Pick a return reason from the list.");
      const reason = returnReasonText(reasonRow, data.reasonNote);

      const approveNow = data.approveNow === true;
      if (approveNow && !hasPermission(permissions ?? [], "sales.returns.approve")) {
        throw new Error("You don't have the right to approve returns.");
      }

      const invoiceItemMap = new Map(invoice.items.map((i) => [i.id, i]));
      const requestUnitsByItem = new Map<string, number>();
      const reservedUnitsByItem = await getReservedUnitsByInvoiceItem(
        tx,
        data.invoiceId,
        data.items.map((item) => item.invoiceItemId),
      );
      const canOverridePrice = hasPermission(permissions ?? [], "sales.returns.override-price");
      const itemsTotal = sumMoney(invoice.items.map((item) => item.amount));
      const resolvedLines: Array<{
        invoiceItemId: string;
        recipeId: string | null;
        cartonsReturned: number;
        quantityReturned: number;
        cartonsRequested: number;
        quantityRequested: number;
        refundPerUnit: string;
        totalRefund: string;
      }> = [];
      let anyPriceOverride = false;

      for (const item of data.items) {
        const invoiceItem = invoiceItemMap.get(item.invoiceItemId);
        if (!invoiceItem) throw new Error("Invoice item not found");

        const cartons = item.cartonsReturned ?? 0;
        const units = item.quantityReturned ?? 0;
        const cpp = getReturnUnitsPerCarton(invoiceItem);
        const totalUnitsReturned = unitsOf(cartons, units, cpp);
        if (totalUnitsReturned <= 0) {
          throw new Error(`Return quantity must be greater than zero for ${invoiceItem.pack}`);
        }
        const totalUnitsInvoiced = unitsOf(invoiceItem.numberOfCartons, invoiceItem.quantity, cpp);
        requestUnitsByItem.set(
          item.invoiceItemId,
          (requestUnitsByItem.get(item.invoiceItemId) ?? 0) + totalUnitsReturned,
        );
        const remainingReturnableUnits = Math.max(
          0,
          totalUnitsInvoiced - (reservedUnitsByItem.get(item.invoiceItemId) ?? 0),
        );
        if ((requestUnitsByItem.get(item.invoiceItemId) ?? 0) > remainingReturnableUnits) {
          throw new Error(`Return quantity exceeds remaining returnable quantity for ${invoiceItem.pack}`);
        }

        const maxRefundPerUnit = getMaxRefundPerUnit(invoiceItem, {
          invoiceDiscount: invoice.invoiceDiscount,
          itemsTotal,
        });
        const { refundPerUnit, overridden } = resolveRefundPerUnit({
          requested: item.refundPerUnit,
          max: maxRefundPerUnit,
          canOverride: canOverridePrice,
          overrideReason: data.priceOverrideReason,
          label: invoiceItem.pack,
        });
        anyPriceOverride ||= overridden;

        resolvedLines.push({
          invoiceItemId: item.invoiceItemId,
          recipeId: invoiceItem.recipeId,
          cartonsReturned: cartons,
          quantityReturned: units,
          cartonsRequested: cartons,
          quantityRequested: units,
          refundPerUnit,
          totalRefund: calculateReturnLineRefund(totalUnitsReturned, refundPerUnit),
        });
      }

      const totalAmount = sumMoney(resolvedLines.map((line) => line.totalRefund));
      const priceOverrideReason = anyPriceOverride ? data.priceOverrideReason!.trim() : null;
      const now = new Date();

      const [salesReturn] = await tx
        .insert(salesReturns)
        .values({
          id: createId(),
          invoiceId: data.invoiceId,
          customerId: invoice.customerId,
          returnDate: data.returnDate ? new Date(data.returnDate) : now,
          reason,
          reasonId: reasonRow.id,
          reasonNote: data.reasonNote?.trim() || null,
          totalAmount,
          status: approveNow ? "approved" : "requested",
          createdById: userId,
          ...(approveNow ? { approvedById: userId, approvedAt: now } : {}),
          notes: data.notes ?? null,
          priceOverride: anyPriceOverride,
          priceOverrideReason,
        })
        .returning();

      const items = await tx
        .insert(salesReturnItems)
        .values(resolvedLines.map((line) => ({ id: createId(), salesReturnId: salesReturn.id, ...line })))
        .returning();

      await recordInvoiceTimelineEvent(
        {
          invoiceId: data.invoiceId,
          eventType: "return",
          title: `Return #${salesReturn.returnNumber} ${approveNow ? "requested and approved" : "requested"}`,
          description: `Return of PKR ${totalAmount} requested. Reason: ${reason}.${anyPriceOverride ? ` Refund price overridden: ${priceOverrideReason}.` : ""} Nothing moves until the goods are received.`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            totalAmount,
            reason,
            approveNow,
            priceOverride: anyPriceOverride,
            priceOverrideReason,
          },
          actorId: userId,
        },
        tx,
      );

      return { ...salesReturn, items };
    });
  });

// ── APPROVE / REJECT ───────────────────────────────────────────────────────

export const decideSalesReturnFn = createServerFn()
  .middleware([requireSalesReturnsApproveMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        returnId: z.string().min(1),
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(500).optional(),
      })
      .refine((value) => value.action === "approve" || (value.reason?.length ?? 0) >= 3, {
        message: "Give a reason for rejecting (at least 3 characters).",
        path: ["reason"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const salesReturn = await lockReturn(tx, data.returnId);
      assertReturnAction(salesReturn, data.action);
      const approved = data.action === "approve";
      const now = new Date();

      const [updated] = await tx
        .update(salesReturns)
        .set({
          status: approved ? "approved" : "rejected",
          approvedById: userId,
          approvedAt: now,
          rejectReason: approved ? null : data.reason!,
          updatedAt: now,
        })
        .where(eq(salesReturns.id, salesReturn.id))
        .returning();

      await recordInvoiceTimelineEvent(
        {
          invoiceId: salesReturn.invoiceId,
          eventType: "status_change",
          title: `Return #${salesReturn.returnNumber} ${approved ? "approved" : "rejected"}`,
          description: approved
            ? `Return #${salesReturn.returnNumber} approved. Waiting for the goods to arrive.`
            : `Return #${salesReturn.returnNumber} rejected. Reason: ${data.reason}.`,
          metadata: { salesReturnId: salesReturn.id, returnNumber: salesReturn.returnNumber, action: data.action },
          actorId: userId,
        },
        tx,
      );
      return updated;
    });
  });

// ── CANCEL (approved, goods never came) ────────────────────────────────────

export const cancelSalesReturnFn = createServerFn()
  .middleware([requireSalesReturnsApproveMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        returnId: z.string().min(1),
        reason: z.string().trim().min(3, "Give a reason for cancelling (at least 3 characters).").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const salesReturn = await lockReturn(tx, data.returnId);
      assertReturnAction(salesReturn, "cancel");
      const now = new Date();
      const [updated] = await tx
        .update(salesReturns)
        .set({ status: "cancelled", cancelledById: userId, cancelledAt: now, cancelReason: data.reason, updatedAt: now })
        .where(eq(salesReturns.id, salesReturn.id))
        .returning();

      await recordInvoiceTimelineEvent(
        {
          invoiceId: salesReturn.invoiceId,
          eventType: "status_change",
          title: `Return #${salesReturn.returnNumber} cancelled`,
          description: `Return #${salesReturn.returnNumber} cancelled before the goods arrived. Reason: ${data.reason}.`,
          metadata: { salesReturnId: salesReturn.id, returnNumber: salesReturn.returnNumber, action: "cancel" },
          actorId: userId,
        },
        tx,
      );
      return updated;
    });
  });

// ── LIST (work queue) ──────────────────────────────────────────────────────

export const listSalesReturnsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        tab: z.enum(["to-approve", "to-receive", "done", "all"]).default("to-approve"),
        search: z.string().trim().max(100).optional(),
        reasonId: z.string().min(1).optional(),
        page: z.number().int().min(1).default(1),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    await ensureCreditNotesBackfilled(db);
    const term = data.search?.replace(/^#/, "").trim();
    const searchCondition = term
      ? or(
          /^\d+$/.test(term) ? eq(salesReturns.returnNumber, Number(term)) : undefined,
          ilike(invoices.invoiceNumber, `%${term}%`),
          ilike(customers.name, `%${term}%`),
        )
      : undefined;
    const baseCondition = and(
      searchCondition,
      data.reasonId ? eq(salesReturns.reasonId, data.reasonId) : undefined,
    );
    const tabCondition = data.tab === "all" ? undefined : inArray(salesReturns.status, RETURN_TAB_STATUSES[data.tab]);

    const [rows, statusCounts] = await Promise.all([
      db
        .select({
          id: salesReturns.id,
          returnNumber: salesReturns.returnNumber,
          creditNoteNumber: salesReturns.creditNoteNumber,
          status: salesReturns.status,
          reason: salesReturns.reason,
          totalAmount: salesReturns.totalAmount,
          appliedToInvoiceAmount: salesReturns.appliedToInvoiceAmount,
          customerCreditAmount: salesReturns.customerCreditAmount,
          customerId: salesReturns.customerId,
          createdAt: salesReturns.createdAt,
          completedAt: salesReturns.completedAt,
          invoiceId: salesReturns.invoiceId,
          invoiceNumber: invoices.invoiceNumber,
          customerName: customers.name,
        })
        .from(salesReturns)
        .innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
        .innerJoin(customers, eq(salesReturns.customerId, customers.id))
        .where(and(baseCondition, tabCondition))
        .orderBy(desc(salesReturns.createdAt), desc(salesReturns.returnNumber))
        .limit(RETURN_LIST_PAGE_SIZE)
        .offset((data.page - 1) * RETURN_LIST_PAGE_SIZE),
      db
        .select({ status: salesReturns.status, total: count() })
        .from(salesReturns)
        .innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
        .innerJoin(customers, eq(salesReturns.customerId, customers.id))
        .where(baseCondition)
        .groupBy(salesReturns.status),
    ]);

    const byStatus = new Map(statusCounts.map((row) => [row.status, Number(row.total)]));
    const sum = (statuses: readonly string[]) => statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);
    const counts = {
      "to-approve": sum(RETURN_TAB_STATUSES["to-approve"]),
      "to-receive": sum(RETURN_TAB_STATUSES["to-receive"]),
      done: sum(RETURN_TAB_STATUSES.done),
      all: sum(RETURN_STATUSES),
    };
    return {
      rows,
      counts,
      page: data.page,
      pageCount: Math.max(1, Math.ceil(counts[data.tab] / RETURN_LIST_PAGE_SIZE)),
    };
  });

// ── RECEIVE AND INSPECT (the only step that moves stock and money) ────────

export const completeSalesReturnFn = createServerFn()
  .middleware([requireReturnsReceiveMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        returnId: z.string().min(1),
        notes: z.string().trim().max(1000).optional(),
        lines: z
          .array(
            z.object({
              returnItemId: z.string().min(1),
              goodUnits: z.number().int().min(0).default(0),
              damagedUnits: z.number().int().min(0).default(0),
              expiredUnits: z.number().int().min(0).default(0),
            }),
          )
          .min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    await ensureCreditNotesBackfilled(db);
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const salesReturn = await lockReturn(tx, data.returnId);
      assertReturnAction(salesReturn, "receive");
      await lockCartonReturnOrder(tx, salesReturn.invoiceId);
      await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, salesReturn.invoiceId)).for("update");

      const linesById = new Map(data.lines.map((line) => [line.returnItemId, line]));
      for (const id of linesById.keys()) {
        if (!salesReturn.items.some((item: { id: string }) => item.id === id)) {
          throw new Error("A received line does not belong to this return.");
        }
      }

      const invoiceItemIds = salesReturn.items.map((item: { invoiceItemId: string }) => item.invoiceItemId);
      const invoiceItemRows = await tx.query.invoiceItems.findMany({
        where: inArray(invoiceItems.id, invoiceItemIds),
        with: { recipe: true },
      });
      const invoiceItemMap = new Map(invoiceItemRows.map((item) => [item.id, item]));

      const inspection = salesReturn.items.map((returnItem: typeof salesReturnItems.$inferSelect) => {
        const invoiceItem = invoiceItemMap.get(returnItem.invoiceItemId);
        if (!invoiceItem) throw new Error("Invoice item not found for this return");
        const unitsPerCarton = getReturnUnitsPerCarton(invoiceItem);
        const line = linesById.get(returnItem.id);
        return {
          returnItem,
          invoiceItem,
          unitsPerCarton,
          label: invoiceItem.pack,
          approvedUnits: requestedUnits(returnItem, unitsPerCarton),
          goodUnits: line?.goodUnits ?? 0,
          damagedUnits: line?.damagedUnits ?? 0,
          expiredUnits: line?.expiredUnits ?? 0,
        };
      });
      checkInspection(inspection);

      if (!salesReturn.priceOverride) {
        const itemsTotal = sumMoney(
          (await tx.query.invoiceItems.findMany({
            where: eq(invoiceItems.invoiceId, salesReturn.invoiceId),
            columns: { amount: true },
          })).map((item) => item.amount),
        );
        for (const { returnItem, invoiceItem } of inspection) {
          const maxRefundPerUnit = getMaxRefundPerUnit(invoiceItem, {
            invoiceDiscount: salesReturn.invoice.invoiceDiscount,
            itemsTotal,
          });
          if (new Big(returnItem.refundPerUnit).gt(maxRefundPerUnit)) {
            throw new Error(
              `Return #${salesReturn.returnNumber} refunds ${invoiceItem.pack} at Rs ${returnItem.refundPerUnit} per unit, above the invoice price of Rs ${maxRefundPerUnit}. Cancel it and record the return again.`,
            );
          }
        }
      }

      const warehouseId = salesReturn.invoice.stockWarehouseId ?? salesReturn.invoice.warehouseId;
      if (!warehouseId) throw new Error("Invoice warehouse is required to restock returns");
      await lockFinishedGoods(tx, warehouseId, invoiceItemRows.flatMap((item) => (item.recipeId ? [item.recipeId] : [])));

      const receivedByItem = await getReservedUnitsByInvoiceItem(tx, salesReturn.invoiceId, invoiceItemIds, {
        statuses: ["completed"],
        excludeReturnId: salesReturn.id,
      });
      const lineRefunds: string[] = [];

      for (const line of inspection) {
        const { returnItem, invoiceItem, unitsPerCarton } = line;
        const received = receivedUnits(line);
        const alreadyReceived = receivedByItem.get(invoiceItem.id) ?? 0;
        const totalUnitsInvoiced = unitsOf(invoiceItem.numberOfCartons, invoiceItem.quantity, unitsPerCarton);
        if (alreadyReceived + received > totalUnitsInvoiced) {
          throw new Error(`Completing this return would exceed sold quantity for ${invoiceItem.pack}`);
        }

        const basis = returnCostBasis(invoiceItem, unitsPerCarton);
        let unitsBefore = alreadyReceived;
        for (const condition of ["good", "damaged", "expired"] as const) {
          const units = line[`${condition}Units`];
          if (units <= 0) continue;
          await restockReturnedUnits(tx, {
            salesReturnId: salesReturn.id,
            returnItemId: returnItem.id,
            invoiceId: salesReturn.invoiceId,
            invoiceItem,
            warehouseId,
            condition,
            units,
            unitsPerCarton,
            costPerUnit: basis.costPerUnit,
            inventoryValue: allocateReturnCost(basis, unitsBefore, units),
            userId,
          });
          unitsBefore += units;
        }
        receivedByItem.set(invoiceItem.id, unitsBefore);

        // Keep the requester's carton/loose split when everything arrived.
        const split =
          received === line.approvedUnits
            ? { cartons: returnItem.cartonsRequested, loose: returnItem.quantityRequested }
            : splitUnits(received, unitsPerCarton);
        const totalRefund = calculateReturnLineRefund(received, returnItem.refundPerUnit);
        lineRefunds.push(totalRefund);
        await tx
          .update(salesReturnItems)
          .set({
            goodUnits: line.goodUnits,
            damagedUnits: line.damagedUnits,
            expiredUnits: line.expiredUnits,
            cartonsReturned: split.cartons,
            quantityReturned: split.loose,
            totalRefund,
            updatedAt: new Date(),
          })
          .where(eq(salesReturnItems.id, returnItem.id));
      }

      const totalAmount = sumMoney(lineRefunds);
      const creditNoteNumber = await allocateNextCreditNoteNumber(tx);
      const [lockedInvoice] = await tx
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          totalPrice: invoices.totalPrice,
          paidAmount: invoices.paidAmount,
          excessCreditedAmount: invoices.excessCreditedAmount,
        })
        .from(invoices)
        .where(eq(invoices.id, salesReturn.invoiceId));
      if (!lockedInvoice) throw new Error("Parent invoice not found");

      const priorCompleted = await tx
        .select({ applied: salesReturns.appliedToInvoiceAmount })
        .from(salesReturns)
        .where(and(eq(salesReturns.invoiceId, salesReturn.invoiceId), eq(salesReturns.status, "completed")));
      const priorApplied = roundMoney(
        priorCompleted.reduce((sum, r) => sum + roundMoney(r.applied), 0),
      );
      const preReturnOpenBalance = roundMoney(
        Math.max(
          0,
          roundMoney(lockedInvoice.totalPrice) -
            priorApplied -
            roundMoney(lockedInvoice.paidAmount) +
            roundMoney(lockedInvoice.excessCreditedAmount),
        ),
      );
      const split = computeReturnCreditSplit(Number(totalAmount), preReturnOpenBalance);
      const now = new Date();
      const [updated] = await tx
        .update(salesReturns)
        .set({
          status: "completed",
          completedAt: now,
          receivedById: userId,
          totalAmount,
          creditNoteNumber,
          creditNoteIssuedAt: now,
          appliedToInvoiceAmount: moneyString(split.appliedToInvoiceAmount),
          customerCreditAmount: moneyString(split.customerCreditAmount),
          notes: data.notes || salesReturn.notes,
          updatedAt: now,
        })
        .where(eq(salesReturns.id, salesReturn.id))
        .returning();

      let leftoverCreditBalance = 0;
      if (split.customerCreditAmount > 0) {
        const issued = await issueCustomerCreditFromReturn(tx, {
          customerId: salesReturn.customerId,
          salesReturnId: salesReturn.id,
          sourceInvoiceId: salesReturn.invoiceId,
          creditNoteNumber,
          amount: split.customerCreditAmount,
          performedById: userId,
          notes: `Credit Note ${creditNoteNumber} from Return #${salesReturn.returnNumber}`,
        });
        leftoverCreditBalance = issued.balanceAfter;
      }

      await recalculateInvoiceSettlement(tx, salesReturn.invoiceId, {
        actorId: userId,
        reason: `Completed return #${salesReturn.returnNumber} (${creditNoteNumber})`,
      });

      const customerInfo = await tx.query.customers.findFirst({
        where: eq(customers.id, salesReturn.customerId),
        columns: { id: true, name: true, customerType: true, creditBalance: true },
      });

      const received = inspection.reduce((sum: number, line: (typeof inspection)[number]) => sum + receivedUnits(line), 0);
      const requested = inspection.reduce((sum: number, line: (typeof inspection)[number]) => sum + line.approvedUnits, 0);
      await recordInvoiceTimelineEvent(
        {
          invoiceId: salesReturn.invoiceId,
          eventType: "status_change",
          title: `Credit Note ${creditNoteNumber} issued (Return #${salesReturn.returnNumber})`,
          description: `Return #${salesReturn.returnNumber} received: ${received} of ${requested} packs arrived${requested > received ? ` (${requested - received} short, closed)` : ""}. PKR ${moneyString(split.appliedToInvoiceAmount)} cleared invoice balance${split.customerCreditAmount > 0 ? `; PKR ${moneyString(split.customerCreditAmount)} transferred to store credit` : ""}.`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            creditNoteNumber,
            action: "complete",
            totalAmount,
            appliedToInvoiceAmount: split.appliedToInvoiceAmount,
            customerCreditAmount: split.customerCreditAmount,
            receivedUnits: received,
            requestedUnits: requested,
          },
          actorId: userId,
        },
        tx,
      );
      return {
        ...updated,
        creditNoteNumber,
        appliedToInvoiceAmount: split.appliedToInvoiceAmount,
        customerCreditAmount: split.customerCreditAmount,
        customerId: salesReturn.customerId,
        customerName: customerInfo?.name ?? "",
        customerType: customerInfo?.customerType ?? "retailer",
        invoiceNumber: lockedInvoice.invoiceNumber,
        leftoverCreditBalance: customerInfo ? roundMoney(customerInfo.creditBalance) : leftoverCreditBalance,
      };
    });
  });

// ── VOID (completed return was wrong) ─────────────────────────────────────

export const voidSalesReturnFn = createServerFn()
  .middleware([requireSalesReturnsApproveMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        returnId: z.string().min(1),
        reason: z.string().trim().min(3, "Give a reason for voiding (at least 3 characters).").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const salesReturn = await lockReturn(tx, data.returnId);
      assertReturnAction(salesReturn, "void");
      await lockCartonReturnOrder(tx, salesReturn.invoiceId);
      await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, salesReturn.invoiceId)).for("update");

      const traces = await tx.query.salesReturnStockTraces.findMany({
        where: and(eq(salesReturnStockTraces.salesReturnId, salesReturn.id), eq(salesReturnStockTraces.kind, "receive")),
        with: {
          recipe: true,
          invoiceItem: { columns: { packsPerCarton: true, actualPackSize: true } },
        },
      });
      await lockCartonStock(tx, traces.map((trace) => ({ warehouseId: trace.warehouseId, recipeId: trace.recipeId })));
      await reverseReturnStock(tx, {
        salesReturnId: salesReturn.id,
        returnNumber: salesReturn.returnNumber,
        invoiceId: salesReturn.invoiceId,
        userId,
        traces,
      });

      await voidReturnCreditSettlement(tx, {
        salesReturnId: salesReturn.id,
        invoiceId: salesReturn.invoiceId,
        customerId: salesReturn.customerId,
        creditNoteNumber: salesReturn.creditNoteNumber,
        reason: data.reason,
        performedById: userId,
        recalculateInvoice: async (affectedInvoiceId) => {
          await recalculateInvoiceSettlement(tx, affectedInvoiceId, {
            actorId: userId,
            reason: `Credit note ${salesReturn.creditNoteNumber ?? salesReturn.id} voided`,
          });
        },
        recordTimeline: async (params) => {
          await recordInvoiceTimelineEvent(params as any, tx);
        },
      });

      const now = new Date();
      const [updated] = await tx
        .update(salesReturns)
        .set({ status: "voided", voidedById: userId, voidedAt: now, voidReason: data.reason, updatedAt: now })
        .where(eq(salesReturns.id, salesReturn.id))
        .returning();

      await recalculateInvoiceSettlement(tx, salesReturn.invoiceId, {
        actorId: userId,
        reason: `Return #${salesReturn.returnNumber} voided: ${data.reason}`,
        allowUnapplyOverageOnReturnVoid: true,
      });

      await recordInvoiceTimelineEvent(
        {
          invoiceId: salesReturn.invoiceId,
          eventType: "status_change",
          title: `Return #${salesReturn.returnNumber} voided`,
          description: `Return #${salesReturn.returnNumber} voided. Reason: ${data.reason}. The goods were taken back out of stock and Outstanding Amount went back up by PKR ${salesReturn.totalAmount}.`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            action: "void",
            totalAmount: salesReturn.totalAmount,
          },
          actorId: userId,
        },
        tx,
      );
      return updated;
    });
  });
