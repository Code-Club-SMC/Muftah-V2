import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { createId } from "@paralleldrive/cuid2";
import { invoices, customers } from "@/db/schemas/sales-schema";
import { payments, slipRecords, invoiceTimelineEvents } from "@/db/schemas/sales-erp-schema";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
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
            credit: true,
          },
        },
        salesman: { columns: { id: true, name: true } },
        invoice: {
          columns: {
            id: true,
            date: true,
            totalPrice: true,
            cash: true,
            credit: true,
            status: true,
            slipNumber: true,
            creditReturnDate: true,
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
// Auto-closes slip when amountDue is fully recovered.
// Updates invoice status to 'paid' or 'partially_paid'.
// ═══════════════════════════════════════════════════════════════════════════
export const reconcileSlipFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        slipId: z.string().min(1),
        amount: z.number().positive("Amount must be positive"),
        method: z.enum(["cash", "bank_transfer", "expense_offset"]).default("cash"),
        walletId: z.string().optional(),
        reference: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const slip = await tx.query.slipRecords.findFirst({
        where: eq(slipRecords.id, data.slipId),
        with: { invoice: true },
      });

      if (!slip) throw new Error("Slip not found");
      if (slip.status === "closed") throw new Error("Slip is already closed");

      const currentDue = Number(slip.amountDue);
      const currentRecovered = Number(slip.amountRecovered);

      if (data.amount > currentDue) {
        throw new Error(
          `Amount (${data.amount}) exceeds outstanding balance (${currentDue.toFixed(2)})`,
        );
      }

      const newDue = Math.max(0, currentDue - data.amount);
      const newRecovered = currentRecovered + data.amount;
      const isClosed = newDue === 0;

      // 1. Update slip record
      await tx
        .update(slipRecords)
        .set({
          amountDue: newDue.toString(),
          amountRecovered: newRecovered.toString(),
          status: isClosed ? "closed" : "partially_recovered",
          reconciledAt: isClosed ? new Date() : null,
          recoveryStatus: isClosed ? null : (slip.recoveryStatus ?? "partially_paid"),
          recoveryAssignedToId: isClosed ? null : undefined,
          nextFollowUpDate: isClosed ? null : undefined,
          lastFollowUpDate: isClosed ? null : undefined,
          escalationLevel: isClosed ? 0 : undefined,
          updatedAt: new Date(),
        })
        .where(eq(slipRecords.id, data.slipId));

      // 2. Update invoice status
      if (slip.invoice) {
        const newInvoiceStatus = isClosed ? "paid" : "partially_paid";
        await tx
          .update(invoices)
          .set({
            credit: newDue.toString(),
            cash: sql`${invoices.cash} + ${data.amount}`,
            status: newInvoiceStatus,
          })
          .where(eq(invoices.id, slip.invoice.id));
      }

      // 3. Payment record
      const [payment] = await tx
        .insert(payments)
        .values({
          id: createId(),
          customerId: slip.customerId,
          invoiceId: slip.invoiceId,
          amount: data.amount.toString(),
          method: data.method,
          reference: data.reference ?? slip.slipNumber,
          notes: data.notes,
          recordedById: userId,
          paymentDate: new Date(),
        })
        .returning();

      // 3b. Timeline event
      await recordInvoiceTimelineEvent(
        {
          invoiceId: slip.invoiceId,
          eventType: "payment",
          title: `Payment received: PKR ${data.amount.toFixed(2)}`,
          description:
            (data.method === "cash"
              ? "Cash payment"
              : data.method === "bank_transfer"
                ? "Bank transfer"
                : "Expense offset") +
            (data.reference ? ` (Ref: ${data.reference})` : ".") +
            (isClosed ? " Slip fully closed." : ` Remaining: PKR ${newDue.toFixed(2)}`),
          metadata: {
            paymentId: payment.id,
            amount: data.amount,
            method: data.method,
            reference: data.reference,
            slipClosed: isClosed,
            remainingDue: newDue,
          },
          actorId: userId,
        },
        tx,
      );

      if (isClosed) {
        await recordInvoiceTimelineEvent(
          {
            invoiceId: slip.invoiceId,
            eventType: "closed",
            title: "Invoice closed",
            description: `Slip ${slip.slipNumber} fully reconciled. Total recovered: PKR ${newRecovered.toFixed(2)}.`,
            metadata: {
              slipNumber: slip.slipNumber,
              totalRecovered: newRecovered,
            },
            actorId: userId,
          },
          tx,
        );
      }

      // 4. Update customer ledger
      await tx
        .update(customers)
        .set({
          payment: sql`${customers.payment} + ${data.amount}`,
          credit: sql`${customers.credit} - ${data.amount}`,
        })
        .where(eq(customers.id, slip.customerId));

      // 5. Wallet credit (if applicable)
      if (
        data.walletId &&
        (data.method === "cash" || data.method === "bank_transfer")
      ) {
        const wallet = await tx.query.wallets.findFirst({
          where: eq(wallets.id, data.walletId),
        });
        if (!wallet) throw new Error("Wallet not found");

        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${data.amount}` })
          .where(eq(wallets.id, data.walletId));

        await tx.insert(transactions).values({
          id: createId(),
          walletId: data.walletId,
          type: "credit",
          amount: data.amount.toString(),
          referenceId: payment.id,
          source: "Slip Recovery",
          performedById: userId,
        });
      }

      return {
        payment,
        slipClosed: isClosed,
        remainingDue: newDue,
      };
    });
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET OVERDUE SLIPS
// Shows slips whose creditReturnDate has passed AND still have outstanding balance.
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
    // A slip is overdue when its invoice's creditReturnDate has passed
    // and it still has outstanding balance (amountDue > 0).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // If daysOverdue > 0, slip must be overdue by at least that many days
    const cutoffDate = new Date(todayStart);
    if (data.daysOverdue > 0) {
      cutoffDate.setDate(cutoffDate.getDate() - data.daysOverdue);
    }

    const conditions = [
      ne(slipRecords.status, "closed"),
      gt(slipRecords.amountDue, "0"),
      lte(invoices.creditReturnDate, data.daysOverdue > 0 ? cutoffDate : todayStart),
    ];

    if (data.salesmanId) {
      conditions.push(eq(slipRecords.salesmanId, data.salesmanId));
    }

    const offset = (data.page - 1) * data.limit;

    // Use explicit join since we filter on invoices.creditReturnDate
    const results = await db
      .select({
        id: slipRecords.id,
        slipNumber: slipRecords.slipNumber,
        customerId: slipRecords.customerId,
        salesmanId: slipRecords.salesmanId,
        amountDue: slipRecords.amountDue,
        amountRecovered: slipRecords.amountRecovered,
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
      .orderBy(asc(invoices.creditReturnDate))
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
            creditReturnDate: true,
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
      entry.totalDue += Number(s.amountDue);
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
      gt(slipRecords.amountDue, "0"),
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
            creditReturnDate: true,
            slipNumber: true,
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
        creditReturnDate: s.invoice?.creditReturnDate,
        invoiceTotal: Number(s.invoice?.totalPrice ?? 0),
        amountDue: Number(s.amountDue),
        amountRecovered: Number(s.amountRecovered),
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
  .inputValidator((input: any) =>
    z
      .object({
        items: z.array(
          z.object({
            slipId: z.string().min(1),
            amount: z.number().positive("Amount must be positive"),
          }),
        ).min(1, "At least one item required"),
        method: z.enum(["cash", "bank_transfer"]).default("cash"),
        walletId: z.string().optional(),
        reference: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;
    const results: Array<{ slipId: string; slipNumber: string; success: boolean; error?: string; slipClosed?: boolean }> = [];

    await db.transaction(async (tx) => {
      for (const item of data.items) {
        try {
          const slip = await tx.query.slipRecords.findFirst({
            where: eq(slipRecords.id, item.slipId),
            with: { invoice: true },
          });

          if (!slip) {
            results.push({ slipId: item.slipId, slipNumber: "—", success: false, error: "Slip not found" });
            continue;
          }

          if (slip.status === "closed") {
            results.push({ slipId: item.slipId, slipNumber: slip.slipNumber, success: false, error: "Already closed" });
            continue;
          }

          const currentDue = Number(slip.amountDue);
          if (item.amount > currentDue) {
            results.push({ slipId: item.slipId, slipNumber: slip.slipNumber, success: false, error: `Amount exceeds due (${currentDue.toFixed(2)})` });
            continue;
          }

          const newDue = Math.max(0, currentDue - item.amount);
          const newRecovered = Number(slip.amountRecovered) + item.amount;
          const isClosed = newDue === 0;

          // Update slip
          await tx
            .update(slipRecords)
            .set({
              amountDue: newDue.toString(),
              amountRecovered: newRecovered.toString(),
              status: isClosed ? "closed" : "partially_recovered",
              reconciledAt: isClosed ? new Date() : null,
              recoveryStatus: isClosed ? null : (slip.recoveryStatus ?? "partially_paid"),
              updatedAt: new Date(),
            })
            .where(eq(slipRecords.id, item.slipId));

          // Update invoice
          if (slip.invoice) {
            await tx
              .update(invoices)
              .set({
                credit: newDue.toString(),
                cash: sql`${invoices.cash} + ${item.amount}`,
                status: isClosed ? "paid" : "partially_paid",
              })
              .where(eq(invoices.id, slip.invoice.id));
          }

          // Payment record
          await tx.insert(payments).values({
            id: createId(),
            customerId: slip.customerId,
            invoiceId: slip.invoiceId,
            amount: item.amount.toString(),
            method: data.method,
            reference: data.reference ?? slip.slipNumber,
            notes: data.notes,
            recordedById: userId,
            paymentDate: new Date(),
          });

          // Update customer ledger
          await tx
            .update(customers)
            .set({
              payment: sql`${customers.payment} + ${item.amount}`,
              credit: sql`GREATEST(${customers.credit} - ${item.amount}, 0)`,
            })
            .where(eq(customers.id, slip.customerId));

          // Timeline event
          await recordInvoiceTimelineEvent(
            {
              invoiceId: slip.invoiceId,
              eventType: "payment",
              title: `Batch payment: PKR ${item.amount.toFixed(2)}`,
              description: `${data.method === "cash" ? "Cash" : "Bank transfer"}${data.reference ? ` (Ref: ${data.reference})` : ""}. ${isClosed ? "Slip closed." : `Remaining: PKR ${newDue.toFixed(2)}`}`,
              metadata: { amount: item.amount, method: data.method, slipClosed: isClosed },
              actorId: userId,
            },
            tx,
          );

          results.push({ slipId: item.slipId, slipNumber: slip.slipNumber, success: true, slipClosed: isClosed });
        } catch (err) {
          results.push({ slipId: item.slipId, slipNumber: "—", success: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    });

    return { results };
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
        gte(payments.paymentDate, dayStart),
        lte(payments.paymentDate, dayEnd),
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

    const totalExpenseOffset = todayPayments
      .filter((p) => p.method === "expense_offset")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Slips issued today
    const todaySlips = await db.query.slipRecords.findMany({
      where: and(
        gte(slipRecords.issuedAt, dayStart),
        lte(slipRecords.issuedAt, dayEnd),
      ),
      columns: { status: true, amountDue: true, amountRecovered: true },
    });

    // Slips closed today
    const closedToday = await db.query.slipRecords.findMany({
      where: and(
        gte(slipRecords.reconciledAt, dayStart),
        lte(slipRecords.reconciledAt, dayEnd),
        eq(slipRecords.status, "closed"),
      ),
      columns: { slipNumber: true, amountRecovered: true, customerId: true },
    });

    return {
      date: targetDate.toISOString().split("T")[0],
      payments: todayPayments,
      totalCollected: totalCash + totalBankTransfer + totalExpenseOffset,
      totalCash,
      totalBankTransfer,
      totalExpenseOffset,
      slipsIssuedToday: todaySlips.length,
      slipsClosedToday: closedToday.length,
      closedSlips: closedToday,
    };
  });
