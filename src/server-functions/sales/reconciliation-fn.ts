import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { createId } from "@paralleldrive/cuid2";
import { invoices, customers } from "@/db/schemas/sales-schema";
import { payments, slipRecords, invoiceTimelineEvents } from "@/db/schemas/sales-erp-schema";
import { recordRecoveryPayment } from "./settlement-service";
import {
  requireSalesManageMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import {
  eq,
  and,
  sql,
  gte,
  lte,
  asc,
  desc,
  gt,
  ne,
  ilike,
} from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP SLIP
// Instant search by slip number — returns full context for reconciliation.
// ═══════════════════════════════════════════════════════════════════════════
export const lookupSlipFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ slipNumber: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const slip = await db.query.slipRecords.findFirst({
      where: ilike(slipRecords.slipNumber, data.slipNumber.trim()),
      with: {
        customer: {
          columns: {
            id: true,
            name: true,
            city: true,
            mobileNumber: true,
            customerType: true,
            outstandingAmount: true,
          },
        },
        salesman: { columns: { id: true, name: true } },
        invoice: {
          columns: {
            id: true,
            date: true,
            totalPrice: true,
            paidAmount: true,
            outstandingAmount: true,
            paymentStatus: true,
            invoiceNumber: true,
            paymentDueDate: true,
          },
          with: {
            items: {
              columns: {
                pack: true,
                numberOfCartons: true,
                discountCartons: true,
                freeCartons: true,
                quantity: true,
                perCartonPrice: true,
                amount: true,
              },
            },
            warehouse: { columns: { name: true } },
          },
        },
      },
    });

    if (!slip) throw new Error(`Slip "${data.slipNumber}" not found`);

    return slip;
  });

// ═══════════════════════════════════════════════════════════════════════════
// SLIP RECONCILIATION HISTORY
// Payments + invoice timeline for a given slip, used to match/audit payments.
// ═══════════════════════════════════════════════════════════════════════════
export const getSlipReconciliationHistoryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ slipId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const slip = await db.query.slipRecords.findFirst({
      where: eq(slipRecords.id, data.slipId),
      columns: { invoiceId: true, slipNumber: true },
    });
    if (!slip) throw new Error("Slip not found");

    const [paymentsList, timeline] = await Promise.all([
      db.query.payments.findMany({
        where: eq(payments.invoiceId, slip.invoiceId),
        orderBy: [desc(payments.paymentDate)],
        with: {
          recordedBy: { columns: { id: true, name: true } },
          wallet: { columns: { id: true, name: true } },
        },
      }),
      db.query.invoiceTimelineEvents.findMany({
        where: eq(invoiceTimelineEvents.invoiceId, slip.invoiceId),
        orderBy: [desc(invoiceTimelineEvents.eventDate), desc(invoiceTimelineEvents.createdAt)],
        with: {
          actor: { columns: { id: true, name: true } },
        },
      }),
    ]);

    return {
      slipNumber: slip.slipNumber,
      payments: paymentsList.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
      timeline: timeline.map((e) => ({
        ...e,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
      })),
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILE SLIP
// Records partial or full payment against an open slip.
// Auto-closes the slip when Outstanding Amount reaches zero.
// Updates invoice status to 'paid' or 'partially_paid'.
// ═══════════════════════════════════════════════════════════════════════════
export const reconcileSlipFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        slipId: z.string().min(1),
        amount: z.number().positive("Amount must be positive"),
        method: z.enum(["cash", "bank_transfer", "cheque"]).default("cash"),
        walletId: z.string().min(1, "Destination account is required"),
        reference: z.string().trim().min(1).optional(),
        chequeNumber: z.string().trim().min(1).optional(),
        chequeBank: z.string().trim().min(1).optional(),
        chequeDate: z.coerce.date().optional(),
        paymentDate: z.coerce.date().default(() => new Date()),
        sourceRecordId: z.string().trim().min(1).optional(),
        notes: z.string().optional(),
      })
      .superRefine((row, ctx) => {
        if (row.method === "bank_transfer" && !row.reference) {
          ctx.addIssue({
            code: "custom",
            path: ["reference"],
            message: "Bank reference is required",
          });
        }
        if (row.method === "cheque") {
          if (!row.chequeNumber) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeNumber"],
              message: "Cheque number is required",
            });
          }
          if (!row.chequeBank) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeBank"],
              message: "Cheque bank is required",
            });
          }
          if (!row.chequeDate) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeDate"],
              message: "Cheque date is required",
            });
          }
        }
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return db.transaction(async (tx) => {
      const slip = await tx.query.slipRecords.findFirst({
        where: eq(slipRecords.id, data.slipId),
        columns: { invoiceId: true, slipNumber: true },
      });
      if (!slip) throw new Error("Slip not found");

      const payment = await recordRecoveryPayment(tx, {
        invoiceId: slip.invoiceId,
        actorId: userId,
        payment: {
          method: data.method,
          amount: data.amount,
          walletId: data.walletId,
          reference: data.reference,
          chequeNumber: data.chequeNumber,
          chequeBank: data.chequeBank,
          chequeDate: data.chequeDate,
          paymentDate: data.paymentDate,
          sourceRecordId: data.sourceRecordId ?? `recovery-${createId()}`,
          notes: data.notes,
        },
      });

      const updatedSlip = await tx.query.slipRecords.findFirst({
        where: eq(slipRecords.id, data.slipId),
        columns: { status: true, outstandingAmount: true },
      });
      if (!updatedSlip) throw new Error("Updated slip could not be loaded");

      return {
        payment,
        slipClosed: updatedSlip.status === "closed",
        remainingDue: Number(updatedSlip.outstandingAmount),
      };
    });
  });


// ═══════════════════════════════════════════════════════════════════════════
// GET OVERDUE SLIPS
// Shows slips whose Payment Due Date has passed and still have an outstanding balance.
// ═══════════════════════════════════════════════════════════════════════════
export const getOverdueSlipsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        daysOverdue: z.number().int().min(0).default(0),
        salesmanId: z.string().optional(),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().default(50),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // A slip is overdue when its Payment Due Date has passed and it still
    // has an Outstanding Amount.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // If daysOverdue > 0, slip must be overdue by at least that many days
    const cutoffDate = new Date(todayStart);
    if (data.daysOverdue > 0) {
      cutoffDate.setDate(cutoffDate.getDate() - data.daysOverdue);
    }

    const conditions = [
      ne(slipRecords.status, "closed"),
      gt(slipRecords.outstandingAmount, "0"),
      lte(invoices.paymentDueDate, data.daysOverdue > 0 ? cutoffDate : todayStart),
    ];

    if (data.salesmanId) {
      conditions.push(eq(slipRecords.salesmanId, data.salesmanId));
    }

    const offset = (data.page - 1) * data.limit;

    // Use an explicit join because Payment Due Date belongs to the invoice.
    const results = await db
      .select({
        id: slipRecords.id,
        slipNumber: slipRecords.slipNumber,
        customerId: slipRecords.customerId,
        salesmanId: slipRecords.salesmanId,
        outstandingAmount: slipRecords.outstandingAmount,
        paidAmount: slipRecords.paidAmount,
        status: slipRecords.status,
        recoveryStatus: slipRecords.recoveryStatus,
        issuedAt: slipRecords.issuedAt,
        recoveryAssignedToId: slipRecords.recoveryAssignedToId,
        nextFollowUpDate: slipRecords.nextFollowUpDate,
        lastFollowUpDate: slipRecords.lastFollowUpDate,
        escalationLevel: slipRecords.escalationLevel,
        invoiceId: slipRecords.invoiceId,
        reconciledAt: slipRecords.reconciledAt,
        createdAt: slipRecords.createdAt,
        updatedAt: slipRecords.updatedAt,
      })
      .from(slipRecords)
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .leftJoin(customers, eq(slipRecords.customerId, customers.id))
      .where(and(...conditions))
      .orderBy(asc(invoices.paymentDueDate))
      .limit(data.limit)
      .offset(offset);

    // Fetch related entities for the results
    const slipIds = results.map((r) => r.id);
    const fullSlips = await db.query.slipRecords.findMany({
      where: sql`${slipRecords.id} IN (${sql.join(slipIds.map((id) => sql`${id}`), sql`, `)})`,
      with: {
        customer: {
          columns: {
            id: true,
            name: true,
            city: true,
            mobileNumber: true,
            customerType: true,
          },
        },
        salesman: { columns: { id: true, name: true } },
        recoveryAssignedTo: { columns: { id: true, name: true } },
        invoice: {
          columns: {
            date: true,
            totalPrice: true,
            paymentDueDate: true,
          },
        },
      },
    });

    const [totalRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(slipRecords)
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .where(and(...conditions));

    // Group by salesman for summary
    const bySalesman = new Map<
      string,
      { salesmanName: string; count: number; totalDue: number }
    >();
    fullSlips.forEach((s) => {
      const key = s.salesmanId ?? "__unassigned__";
      const name = s.salesman?.name ?? "Unassigned";
      const entry = bySalesman.get(key) ?? { salesmanName: name, count: 0, totalDue: 0 };
      entry.count += 1;
      entry.totalDue += Number(s.outstandingAmount);
      bySalesman.set(key, entry);
    });

    return {
      slips: fullSlips,
      total: Number(totalRes.count),
      pageCount: Math.ceil(Number(totalRes.count) / data.limit),
      groupedBySalesman: Object.fromEntries(bySalesman),
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET OPEN SLIPS FOR RECOVERY
// Returns all non-closed slips with outstanding balance for batch reconciliation.
// Optionally filter by order booker (via invoices.orderBookerId).
// ═══════════════════════════════════════════════════════════════════════════
export const getOpenSlipsForRecoveryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().default(100),
        orderBookerId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.limit;

    const conditions = [
      ne(slipRecords.status, "closed"),
      gt(slipRecords.outstandingAmount, "0"),
    ];

    if (data.orderBookerId) {
      conditions.push(eq(invoices.orderBookerId, data.orderBookerId));
    }

    const results = await db.query.slipRecords.findMany({
      where: and(...conditions),
      with: {
        customer: {
          columns: {
            id: true,
            name: true,
            city: true,
            mobileNumber: true,
          },
        },
        salesman: { columns: { id: true, name: true } },
        invoice: {
          columns: {
            id: true,
            date: true,
            totalPrice: true,
            paymentDueDate: true,
            invoiceNumber: true,
            orderBookerId: true,
          },
          with: {
            orderBooker: { columns: { id: true, name: true } },
          },
        },
      },
      orderBy: [asc(slipRecords.issuedAt)],
      limit: data.limit,
      offset,
    });

    const [totalRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(slipRecords)
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .where(and(...conditions));

    return {
      slips: results.map((s) => ({
        id: s.id,
        slipNumber: s.slipNumber,
        customerId: s.customerId,
        customerName: s.customer?.name ?? "—",
        customerCity: s.customer?.city ?? null,
        salesmanName: s.salesman?.name ?? "—",
        invoiceDate: s.invoice?.date,
        paymentDueDate: s.invoice?.paymentDueDate,
        invoiceTotal: Number(s.invoice?.totalPrice ?? 0),
        outstandingAmount: Number(s.outstandingAmount),
        paidAmount: Number(s.paidAmount),
        status: s.status,
        orderBookerId: s.invoice?.orderBookerId ?? null,
        orderBookerName: s.invoice?.orderBooker?.name ?? null,
      })),
      total: Number(totalRes.count),
      pageCount: Math.ceil(Number(totalRes.count) / data.limit),
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// BATCH RECONCILE SLIPS
// Records payments against multiple slips in a single transaction.
// ═══════════════════════════════════════════════════════════════════════════
export const batchReconcileSlipsFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              slipId: z.string().min(1),
              amount: z.number().positive("Amount must be positive"),
            }),
          )
          .min(1, "At least one item required"),
        method: z.enum(["cash", "bank_transfer", "cheque"]).default("cash"),
        walletId: z.string().min(1, "Destination account is required"),
        reference: z.string().trim().min(1).optional(),
        chequeNumber: z.string().trim().min(1).optional(),
        chequeBank: z.string().trim().min(1).optional(),
        chequeDate: z.coerce.date().optional(),
        paymentDate: z.coerce.date().default(() => new Date()),
        sourceRecordId: z.string().trim().min(1).optional(),
        notes: z.string().optional(),
      })
      .superRefine((row, ctx) => {
        if (row.method === "bank_transfer" && !row.reference) {
          ctx.addIssue({
            code: "custom",
            path: ["reference"],
            message: "Bank reference is required",
          });
        }
        if (row.method === "cheque") {
          if (!row.chequeNumber) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeNumber"],
              message: "Cheque number is required",
            });
          }
          if (!row.chequeBank) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeBank"],
              message: "Cheque bank is required",
            });
          }
          if (!row.chequeDate) {
            ctx.addIssue({
              code: "custom",
              path: ["chequeDate"],
              message: "Cheque date is required",
            });
          }
        }
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;
    const allocationGroupId = `recovery-batch-${createId()}`;

    return db.transaction(async (tx) => {
      const results: Array<{
        slipId: string;
        slipNumber: string;
        success: true;
        slipClosed: boolean;
      }> = [];

      for (const [index, item] of data.items.entries()) {
        const slip = await tx.query.slipRecords.findFirst({
          where: eq(slipRecords.id, item.slipId),
          columns: { invoiceId: true, slipNumber: true },
        });
        if (!slip) throw new Error(`Slip ${index + 1} was not found`);

        await recordRecoveryPayment(tx, {
          invoiceId: slip.invoiceId,
          actorId: userId,
          payment: {
            method: data.method,
            amount: item.amount,
            walletId: data.walletId,
            reference: data.reference,
            chequeNumber: data.chequeNumber,
            chequeBank: data.chequeBank,
            chequeDate: data.chequeDate,
            paymentDate: data.paymentDate,
            sourceRecordId:
              data.sourceRecordId != null
                ? `${data.sourceRecordId}:${slip.invoiceId}`
                : `${allocationGroupId}:${slip.invoiceId}`,
            allocationGroupId,
            notes: data.notes,
          },
        });

        const updatedSlip = await tx.query.slipRecords.findFirst({
          where: eq(slipRecords.id, item.slipId),
          columns: { status: true },
        });
        if (!updatedSlip) throw new Error("Updated slip could not be loaded");
        results.push({
          slipId: item.slipId,
          slipNumber: slip.slipNumber,
          success: true,
          slipClosed: updatedSlip.status === "closed",
        });
      }

      return { allocationGroupId, results };
    });
  });


// ═══════════════════════════════════════════════════════════════════════════
// DAILY CLOSING SUMMARY
// All slips reconciled today, total recovered, open balance.
// ═══════════════════════════════════════════════════════════════════════════
export const getDailyClosingSummaryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ date: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const targetDate = data.date ? new Date(data.date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Payments collected today
    const todayPayments = await db.query.payments.findMany({
      where: and(
        eq(payments.status, "confirmed"),
        gte(payments.effectiveDate, dayStart),
        lte(payments.effectiveDate, dayEnd),
      ),
      with: {
        customer: { columns: { name: true, customerType: true } },
      },
    });

    const totalCash = todayPayments
      .filter((p) => p.method === "cash")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalBankTransfer = todayPayments
      .filter((p) => p.method === "bank_transfer")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalCheque = todayPayments
      .filter((p) => p.method === "cheque")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalExpenseOffset = todayPayments
      .filter((p) => p.method === "expense_offset")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Slips issued today
    const todaySlips = await db.query.slipRecords.findMany({
      where: and(
        gte(slipRecords.issuedAt, dayStart),
        lte(slipRecords.issuedAt, dayEnd),
      ),
      columns: { status: true, outstandingAmount: true, paidAmount: true },
    });

    // Slips closed today
    const closedToday = await db.query.slipRecords.findMany({
      where: and(
        gte(slipRecords.reconciledAt, dayStart),
        lte(slipRecords.reconciledAt, dayEnd),
        eq(slipRecords.status, "closed"),
      ),
      columns: { slipNumber: true, paidAmount: true, customerId: true },
    });

    return {
      date: targetDate.toISOString().split("T")[0],
      payments: todayPayments,
      totalCollected:
        totalCash + totalBankTransfer + totalCheque + totalExpenseOffset,
      totalCash,
      totalBankTransfer,
      totalCheque,
      totalExpenseOffset,
      slipsIssuedToday: todaySlips.length,
      slipsClosedToday: closedToday.length,
      closedSlips: closedToday,
    };
  });
