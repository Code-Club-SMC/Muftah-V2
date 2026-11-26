import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSalesPeopleViewMiddleware } from "@/lib/middlewares";
import { summarizeBookerMonth, type BookerMonthSummary } from "@/lib/order-booker/recovery-commission";
import { roundMoney } from "@/lib/sales/settlement/money";
import { createReportDateRange } from "@/server-functions/reports/profit-loss/reporting-math";
import type { SalesTransaction } from "./settlement-service";

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

/** Pakistan-time bounds of a "YYYY-MM" month. */
function monthRange(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const range = createReportDateRange({ dateFrom: `${month}-01`, dateTo: `${month}-${String(last).padStart(2, "0")}` });
  return { monthStart: range.fromDate, monthEnd: range.toDate };
}

const ZERO: BookerMonthSummary = { delivered: 0, returned: 0, collected: 0, earned: 0, stillOwed: 0, waiting: 0 };
const SUMMARY_KEYS = Object.keys(ZERO) as Array<keyof BookerMonthSummary>;
const addSummaries = (a: BookerMonthSummary, b: BookerMonthSummary): BookerMonthSummary =>
  Object.fromEntries(SUMMARY_KEYS.map((key) => [key, roundMoney(a[key] + b[key])])) as BookerMonthSummary;

export const getCommissionMonthSummaryFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input: unknown) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const service = await import("./recovery-commission-service");
    await service.ensureRecoveryCommissionSwitchover();
    const { monthStart, monthEnd } = monthRange(data.month);
    const bookers = await db.query.orderBookers.findMany({ columns: { id: true, name: true } });
    const inputs = await service.loadBookerMonthInputs(db as unknown as SalesTransaction, { orderBookerIds: "all", monthStart, monthEnd });
    const rows = bookers
      .map((booker) => {
        const input = inputs.get(booker.id);
        return { orderBookerId: booker.id, name: booker.name, ...(input ? summarizeBookerMonth(input) : ZERO) };
      })
      .filter((row) => row.delivered || row.returned || row.collected || row.earned || row.stillOwed);
    return { month: data.month, rows, total: rows.reduce<BookerMonthSummary>((total, row) => addSummaries(total, row), ZERO) };
  });

export const getBookerCommissionMonthFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input: unknown) => z.object({ orderBookerId: z.string().min(1), month: monthSchema }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const service = await import("./recovery-commission-service");
    await service.ensureRecoveryCommissionSwitchover();
    const { monthStart, monthEnd } = monthRange(data.month);
    const input = (await service.loadBookerMonthInputs(db as unknown as SalesTransaction, {
      orderBookerIds: [data.orderBookerId], monthStart, monthEnd,
    })).get(data.orderBookerId);
    if (!input || input.invoices.length === 0) return { summary: input ? summarizeBookerMonth(input) : ZERO, invoices: [] };

    const { commissionEarnings } = await import("@/db/schemas/sales-erp-schema");
    const { invoices: invoiceTable } = await import("@/db/schemas/sales-schema");
    const { and, eq, inArray, lte } = await import("drizzle-orm");
    const ids = input.invoices.map((invoice) => invoice.id);
    const numbers = new Map(
      (await db.select({ id: invoiceTable.id, invoiceNumber: invoiceTable.invoiceNumber }).from(invoiceTable).where(inArray(invoiceTable.id, ids)))
        .map((row) => [row.id, row.invoiceNumber]),
    );
    const entries = await db.query.commissionEarnings.findMany({
      where: and(eq(commissionEarnings.orderBookerId, data.orderBookerId), lte(commissionEarnings.entryDate, monthEnd)),
      with: { payment: { columns: { method: true } } },
      orderBy: (row, { asc }) => [asc(row.entryDate), asc(row.createdAt)],
    });

    const invoices = input.invoices
      .map((invoice) => {
        const own = entries.filter((entry) => entry.invoiceId === invoice.id);
        const single = summarizeBookerMonth({ ...input, invoices: [invoice], entries: [] });
        const returned = input.returns
          .filter((r) => r.invoiceId === invoice.id && (!r.voidedAt || r.voidedAt > monthEnd))
          .reduce((sum, r) => sum + r.totalAmount, 0);
        const collected = input.payments
          .filter((p) => p.invoiceId === invoice.id && p.status === "confirmed" && p.method !== "customer_credit")
          .reduce((sum, p) => sum + p.amount, 0);
        return {
          invoiceId: invoice.id,
          invoiceNumber: numbers.get(invoice.id) ?? invoice.id.slice(0, 8),
          date: invoice.date,
          delivered: invoice.totalPrice,
          returned: roundMoney(returned),
          collected: roundMoney(collected),
          stillOwed: single.stillOwed,
          rate: invoice.rate,
          mode: invoice.mode,
          earnedSoFar: roundMoney(own.reduce((sum, entry) => sum + Number(entry.amount), 0)),
          entries: own.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            bearer: entry.bearer,
            entryDate: entry.entryDate,
            base: Number(entry.baseAmount),
            amount: Number(entry.amount),
            paymentMethod: entry.payment?.method ?? null,
            note: entry.note,
          })),
        };
      })
      // Only invoices with something to show: money still owed, commission rows, or delivered this month.
      .filter((row) => row.stillOwed > 0 || row.entries.length > 0 || (row.date >= monthStart && row.date <= monthEnd))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    return { summary: summarizeBookerMonth(input), invoices };
  });
