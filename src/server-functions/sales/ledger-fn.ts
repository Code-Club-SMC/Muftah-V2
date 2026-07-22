/**
 * Production-ready Ledger Server Functions
 * Fixes: balance calculation, pagination, search, sorting, aging, audit logging
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { db } from "@/db";
import { invoices, customers } from "@/db/schemas/sales-schema";
import { payments, slipRecords, salesmen, ledgerExportAuditLog, salesReturns } from "@/db/schemas/sales-erp-schema";
import { requireSalesViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import {
  eq,
  and,
  gte,
  lte,
  asc,
  sum,
  count,
  inArray,
  lt,
  ne,
  or,
  isNull,
} from "drizzle-orm";
import { parseISO, isValid, endOfDay } from "date-fns";
import type {
  LedgerEntry,
  LedgerSummary,
  DistributorLedgerResponse,
  SalesmanLedgerResponse,
} from "@/lib/ledger-types";

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const APPROVED_RETURN_STATUSES = ["approved", "completed"] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
}

function parseDateInput(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const parsed = parseISO(dateStr);
  return isValid(parsed) ? parsed : null;
}

function returnEffectiveDate(row: {
  approvedAt: Date | null;
  returnDate: Date;
}): Date {
  return row.approvedAt ?? row.returnDate;
}

async function resolveInvoiceSlipMap(
  txInvoiceIds: string[],
  knownMap: Map<string, string>,
): Promise<Map<string, string>> {
  const result = new Map(knownMap);
  const missing = txInvoiceIds.filter((id) => id && !result.has(id));
  if (missing.length === 0) return result;
  const rows = await db
    .select({ id: invoices.id, slipNumber: invoices.slipNumber })
    .from(invoices)
    .where(inArray(invoices.id, missing));
  for (const row of rows) {
    if (row.slipNumber) result.set(row.id, row.slipNumber);
  }
  return result;
}

function buildApprovedReturnWindow(
  dateFrom?: string,
  dateTo?: string,
) {
  const fromDate = parseDateInput(dateFrom);
  const toDate = parseDateInput(dateTo);

  if (!fromDate && !toDate) {
    return undefined;
  }

  const approvedConditions: any[] = [];
  const fallbackConditions: any[] = [isNull(salesReturns.approvedAt)];

  if (fromDate) {
    approvedConditions.push(gte(salesReturns.approvedAt, fromDate));
    fallbackConditions.push(gte(salesReturns.returnDate, fromDate));
  }
  if (toDate) {
    const toDateEnd = endOfDay(toDate);
    approvedConditions.push(lte(salesReturns.approvedAt, toDateEnd));
    fallbackConditions.push(lte(salesReturns.returnDate, toDateEnd));
  }

  return or(
    and(...fallbackConditions),
    and(...approvedConditions),
  );
}

function buildApprovedReturnBeforeDate(fromDate: Date) {
  return or(
    and(isNull(salesReturns.approvedAt), lt(salesReturns.returnDate, fromDate)),
    lt(salesReturns.approvedAt, fromDate),
  );
}

function compareLedgerTimeline(
  a: { date: Date; kind: "invoice" | "return" | "payment"; idx: number },
  b: { date: Date; kind: "invoice" | "return" | "payment"; idx: number },
) {
  const dateDiff = a.date.getTime() - b.date.getTime();
  if (dateDiff !== 0) return dateDiff;

  const kindRank = {
    invoice: 0,
    return: 1,
    payment: 2,
  } as const;
  const kindDiff = kindRank[a.kind] - kindRank[b.kind];
  if (kindDiff !== 0) return kindDiff;

  return a.idx - b.idx;
}

function buildDateConditions(
  dateFrom?: string,
  dateTo?: string,
  dateField: any = invoices.date,
) {
  const conditions: any[] = [];
  const fromDate = parseDateInput(dateFrom);
  const toDate = parseDateInput(dateTo);

  if (fromDate) conditions.push(gte(dateField, fromDate));
  if (toDate) conditions.push(lte(dateField, endOfDay(toDate)));

  return conditions;
}

async function logLedgerAccess(params: {
  userId: string;
  userName?: string;
  userEmail?: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  exportType: string;
  periodFrom?: Date;
  periodTo?: Date;
  entryCount?: number;
}) {
  try {
    const headers = getRequestHeaders() as unknown as Record<string, string | undefined>;
    await db.insert(ledgerExportAuditLog).values({
      userId: params.userId,
      userName: params.userName ?? null,
      userEmail: params.userEmail ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName ?? null,
      exportType: params.exportType,
      periodFrom: params.periodFrom ?? null,
      periodTo: params.periodTo ?? null,
      entryCount: params.entryCount ?? 0,
      ipAddress: headers["x-forwarded-for"] ?? headers["x-real-ip"] ?? null,
      userAgent: headers["user-agent"] ?? null,
    });
  } catch (err) {
    // Non-blocking: audit log failure should not break the main operation
    console.error("[Ledger Audit] Failed to log access:", err);
  }
}

function filterAndSortEntries(
  entries: LedgerEntry[],
  search?: string,
  _sortBy?: string,
  sortOrder?: string,
  typeFilter?: string,
): LedgerEntry[] {
  let result = [...entries];

  // Type filter
  if (typeFilter && typeFilter !== "all") {
    result = result.filter((e) => e.type === typeFilter);
  }

  // Search filter
  if (search && search.trim()) {
    const term = search.toLowerCase().trim();
    result = result.filter((e) => {
      if (e.type === "invoice") {
        return (
          (e.slipNumber?.toLowerCase().includes(term) ?? false) ||
          (e.warehouseName?.toLowerCase().includes(term) ?? false) ||
          (e.remarks?.toLowerCase().includes(term) ?? false) ||
          e.items.some((item) => item.pack.toLowerCase().includes(term))
        );
      }
      if (e.type === "return") {
        return (
          String(e.returnNumber ?? "").toLowerCase().includes(term) ||
          (e.reason?.toLowerCase().includes(term) ?? false) ||
          (e.invoiceSlipNumber?.toLowerCase().includes(term) ?? false) ||
          (e.notes?.toLowerCase().includes(term) ?? false)
        );
      }
      return (
        (e.reference?.toLowerCase().includes(term) ?? false) ||
        e.method.toLowerCase().includes(term) ||
        (e.notes?.toLowerCase().includes(term) ?? false) ||
        (e.invoiceSlipNumber?.toLowerCase().includes(term) ?? false)
      );
    });
  }

  // Ledger must stay chronological or running balance becomes misleading.
  // Keep only date order in the main view.
  const order = sortOrder === "desc" ? -1 : 1;
  result.sort((a, b) => {
    return (a.date.getTime() - b.date.getTime()) * order;
  });

  return result;
}

// ── DISTRIBUTOR LEDGER ────────────────────────────────────────────────────

export const generateDistributorLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        customerId: z.string().min(1, "Customer ID is required"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().positive().default(DEFAULT_PAGE),
        limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
        search: z.string().optional(),
        sortBy: z.literal("date").optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        typeFilter: z.enum(["all", "invoice", "payment", "return"]).optional(),
        includeFullEntries: z.boolean().optional(),
        exportType: z.enum(["view", "print", "csv", "pdf"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id ?? "unknown";
    const userName = context.authContext?.session?.user?.name ?? "Unknown";
    const userEmail = context.authContext?.session?.user?.email ?? undefined;

    // Validate customer exists
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
      columns: { id: true, name: true, city: true, mobileNumber: true, credit: true, customerType: true },
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    // ── Compute opening balance from pre-period data ──
    let openingBalance = 0;
    const fromDate = parseDateInput(data.dateFrom);

    if (fromDate) {
      const [preInvoiceAgg] = await db
        .select({ totalCredit: sum(invoices.credit) })
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, data.customerId),
            lt(invoices.date, fromDate),
          ),
        );

      const [prePaymentAgg] = await db
        .select({ totalPaid: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.customerId, data.customerId),
            lt(payments.paymentDate, fromDate),
            ne(payments.method, "invoice_cash"),
          ),
        );

      // Approved returns whose effective date falls before the period also
      // reduce the opening balance (they are standalone dated events).
      const [preReturnAgg] = await db
        .select({ totalReturned: sum(salesReturns.totalAmount) })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.customerId, data.customerId),
            inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
            buildApprovedReturnBeforeDate(fromDate),
          ),
        );

      openingBalance =
        safeNumber(preInvoiceAgg?.totalCredit) -
        safeNumber(prePaymentAgg?.totalPaid) -
        safeNumber(preReturnAgg?.totalReturned);
    }

    // ── Fetch invoices in period ──
    const invoiceConditions = [
      eq(invoices.customerId, data.customerId),
      ...buildDateConditions(data.dateFrom, data.dateTo, invoices.date),
    ];

    const invoiceRows = await db.query.invoices.findMany({
      where: and(...invoiceConditions),
      with: {
        items: {
          columns: {
            id: true,
            pack: true,
            numberOfCartons: true,
            discountCartons: true,
            freeCartons: true,
            quantity: true,
            packsPerCarton: true,
            actualPackSize: true,
            perCartonPrice: true,
            amount: true,
            costOfGoodsSold: true,
            hsnCode: true,
            retailPrice: true,
          },
        },
        warehouse: { columns: { name: true } },
        salesman: { columns: { name: true } },
      },
      orderBy: [asc(invoices.date), asc(invoices.sNo)],
    });

    // ── Fetch slip records ──
    const slipMap = new Map<string, { status: string | null; amountDue: string; recoveryStatus: string | null }>();
    const slipRows = await db.query.slipRecords.findMany({
      where: eq(slipRecords.customerId, data.customerId),
      columns: { invoiceId: true, status: true, amountDue: true, recoveryStatus: true },
    });
    slipRows.forEach((s) => {
      if (s.invoiceId) {
        slipMap.set(s.invoiceId, {
          status: s.status ?? null,
          amountDue: s.amountDue,
          recoveryStatus: s.recoveryStatus ?? null,
        });
      }
    });

    // ── Fetch payments in period ──
    const paymentConditions = [
      eq(payments.customerId, data.customerId),
      ...buildDateConditions(data.dateFrom, data.dateTo, payments.paymentDate),
    ];

    const paymentRows = await db.query.payments.findMany({
      where: and(...paymentConditions),
      orderBy: [asc(payments.paymentDate), asc(payments.createdAt)],
      columns: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        paymentDate: true,
        invoiceId: true,
      },
    });

    // ── Fetch approved sales returns in period (credit-note style events) ──
    const returnConditions = [
      eq(salesReturns.customerId, data.customerId),
      inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
    ];
    const returnWindow = buildApprovedReturnWindow(data.dateFrom, data.dateTo);
    if (returnWindow) {
      returnConditions.push(returnWindow);
    }

    const returnRows = await db.query.salesReturns.findMany({
      where: and(...returnConditions),
      orderBy: [asc(salesReturns.returnDate), asc(salesReturns.returnNumber)],
      with: {
        stockTraces: {
          columns: { totalCost: true },
        },
      },
      columns: {
        id: true,
        returnNumber: true,
        invoiceId: true,
        returnDate: true,
        approvedAt: true,
        totalAmount: true,
        reason: true,
        condition: true,
        status: true,
        notes: true,
      },
    });

    // Build invoice slip number map for payment + return linking.
    // Includes older invoices outside the selected period so that payments
    // against aged invoices still show their linked slip number.
    const referencedInvoiceIds = Array.from(
      new Set([
        ...paymentRows.map((p) => p.invoiceId).filter(Boolean) as string[],
        ...returnRows.map((r) => r.invoiceId).filter(Boolean) as string[],
      ]),
    );
    const baseSlipMap = new Map<string, string>();
    invoiceRows.forEach((inv) => {
      if (inv.id && inv.slipNumber) {
        baseSlipMap.set(inv.id, inv.slipNumber);
      }
    });
    const invoiceSlipMap = await resolveInvoiceSlipMap(
      referencedInvoiceIds,
      baseSlipMap,
    );

    // ── Merge into chronological ledger entries with running balance ──
    const entries: LedgerEntry[] = [];
    const timeline: Array<{ date: Date; kind: "invoice" | "return" | "payment"; idx: number }> = [];

    invoiceRows.forEach((inv, i) =>
      timeline.push({ date: new Date(inv.date), kind: "invoice", idx: i }),
    );
    returnRows.forEach((ret, i) =>
      timeline.push({ date: returnEffectiveDate(ret), kind: "return", idx: i }),
    );
    paymentRows.forEach((pay, i) =>
      timeline.push({ date: new Date(pay.paymentDate), kind: "payment", idx: i }),
    );

    timeline.sort(compareLedgerTimeline);

    let runningBalance = openingBalance;

    for (const t of timeline) {
      if (t.kind === "invoice") {
        const inv = invoiceRows[t.idx];
        const totalPrice = safeNumber(inv.totalPrice);
        const cash = safeNumber(inv.cash);
        const credit = safeNumber(inv.credit);
        const expenses = safeNumber(inv.expenses);
        const slipInfo = inv.id ? slipMap.get(inv.id) : null;

        runningBalance += credit;
        entries.push({
          type: "invoice",
          id: inv.id,
          date: new Date(inv.date),
          slipNumber: inv.slipNumber,
          warehouseName: inv.warehouse?.name ?? null,
          totalPrice,
          cash,
          credit,
          status: inv.status,
          runningBalance,
          items: inv.items.map((item) => ({
            id: item.id,
            pack: item.pack,
            numberOfCartons: item.numberOfCartons,
            discountCartons: item.discountCartons,
            freeCartons: item.freeCartons,
            quantity: item.quantity,
            packsPerCarton: item.packsPerCarton,
            actualPackSize: item.actualPackSize,
            perCartonPrice: item.perCartonPrice,
            amount: item.amount,
            costOfGoodsSold: item.costOfGoodsSold,
            hsnCode: item.hsnCode,
            retailPrice: item.retailPrice,
          })),
          expenses,
          expensesDescription: inv.expensesDescription ?? null,
          creditReturnDate: inv.creditReturnDate ?? null,
          remarks: inv.remarks ?? null,
          slipStatus: slipInfo?.status ?? null,
          slipRecoveryStatus: slipInfo?.recoveryStatus ?? null,
          slipAmountDue: safeNumber(slipInfo?.amountDue),
        });
      } else if (t.kind === "return") {
        const ret = returnRows[t.idx];
        const amount = safeNumber(ret.totalAmount);
        const invoiceSlipNumber = invoiceSlipMap.get(ret.invoiceId) ?? null;

        runningBalance -= amount;
        entries.push({
          type: "return",
          id: ret.id,
          date: returnEffectiveDate(ret),
          returnNumber: ret.returnNumber,
          invoiceId: ret.invoiceId,
          invoiceSlipNumber,
          amount,
          reason: ret.reason,
          condition: ret.condition,
          status: ret.status,
          notes: ret.notes,
          runningBalance,
        });
      } else {
        const pay = paymentRows[t.idx];
        const amount = safeNumber(pay.amount);
        const invoiceSlipNumber = pay.invoiceId
          ? invoiceSlipMap.get(pay.invoiceId) ?? null
          : null;

        // Only credit payments (non-invoice_cash) affect the running balance.
        // invoice_cash payments are for the cash portion of invoices and are already paid.
        if (pay.method !== "invoice_cash") {
          runningBalance -= amount;
        }
        entries.push({
          type: "payment",
          id: pay.id,
          date: new Date(pay.paymentDate),
          reference: pay.reference,
          method: pay.method,
          amount,
          notes: pay.notes,
          runningBalance,
          invoiceId: pay.invoiceId,
          invoiceSlipNumber,
        });
      }
    }

    // ── Period aggregates ──
    const [agg] = await db
      .select({
        totalSales: sum(invoices.totalPrice),
        totalCash: sum(invoices.cash),
        totalCredit: sum(invoices.credit),
        invoiceCount: count(),
      })
      .from(invoices)
      .where(and(...invoiceConditions));

    const [payAgg] = await db
      .select({ totalPaid: sum(payments.amount), paymentCount: count() })
      .from(payments)
      .where(and(...paymentConditions, ne(payments.method, "invoice_cash")));

    const periodTotalProfit = invoiceRows.reduce((sum, inv) => {
      const invoiceLineProfit = (inv.items ?? []).reduce((lineSum, item) => {
        return lineSum + ((Number(item.amount) || 0) - (Number(item.costOfGoodsSold) || 0));
      }, 0);

      return sum + (invoiceLineProfit - (Number(inv.invoiceDiscount) || 0));
    }, 0) - returnRows.reduce((sum, ret) => {
      const returnCost = (ret.stockTraces ?? []).reduce((traceSum, trace) => {
        return traceSum + safeNumber(trace.totalCost);
      }, 0);
      return sum + (safeNumber(ret.totalAmount) - returnCost);
    }, 0);

    const summary: LedgerSummary = {
      openingBalance,
      closingBalance: runningBalance,
      periodTotalSales: safeNumber(agg?.totalSales),
      periodTotalCash: safeNumber(agg?.totalCash),
      periodTotalCredit: safeNumber(agg?.totalCredit),
      periodPayments: safeNumber(payAgg?.totalPaid),
      periodReturns: returnRows.reduce((sum, ret) => sum + safeNumber(ret.totalAmount), 0),
      periodCashPayments: safeNumber(agg?.totalCash),
      periodTotalProfit,
      invoiceCount: Number(agg?.invoiceCount) || 0,
      paymentCount: Number(payAgg?.paymentCount) || 0,
    };

    // ── Apply search, filter, sort ──
    const filteredEntries = filterAndSortEntries(
      entries,
      data.search,
      data.sortBy,
      data.sortOrder,
      data.typeFilter,
    );

    // ── Pagination ──
    const totalEntries = filteredEntries.length;
    const pageCount = Math.ceil(totalEntries / data.limit);
    const page = Math.min(data.page, Math.max(1, pageCount)) || 1;
    const offset = (page - 1) * data.limit;
    const paginatedEntries = filteredEntries.slice(offset, offset + data.limit);

    // ── Audit Log ──
    await logLedgerAccess({
      userId,
      userName,
      userEmail,
      entityType: "distributor",
      entityId: data.customerId,
      entityName: customer.name,
      exportType: data.exportType ?? "view",
      periodFrom: fromDate ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: totalEntries,
    });

    const response: DistributorLedgerResponse = {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        mobileNumber: customer.mobileNumber,
        credit: customer.credit,
        customerType: customer.customerType,
      },
      entries: data.includeFullEntries ? filteredEntries : paginatedEntries,
      summary,
      generatedAt: new Date().toISOString(),
      generatedBy: userName,
      page,
      pageCount,
      totalEntries,
    };

    return response;
  });

// ── SALESMAN LEDGER ───────────────────────────────────────────────────────

export const generateSalesmanLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        salesmanId: z.string().min(1, "Salesman ID is required"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().positive().default(DEFAULT_PAGE),
        limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
        search: z.string().optional(),
        sortBy: z.literal("date").optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        typeFilter: z.enum(["all", "invoice", "payment", "return"]).optional(),
        includeFullEntries: z.boolean().optional(),
        exportType: z.enum(["view", "print", "csv", "pdf"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id ?? "unknown";
    const userName = context.authContext?.session?.user?.name ?? "Unknown";
    const userEmail = context.authContext?.session?.user?.email ?? undefined;

    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.salesmanId),
      columns: { id: true, name: true },
    });
    if (!salesman) throw new Error("Salesman not found");

    const linkedCustomers = await db.query.customers.findMany({
      where: eq(customers.salesmanId, data.salesmanId),
      columns: { id: true, name: true },
    });
    const customerIds = linkedCustomers.map((c) => c.id);

    if (customerIds.length === 0) {
      return {
        salesman: { id: salesman.id, name: salesman.name },
        entries: [],
        summary: {
          openingBalance: 0,
          closingBalance: 0,
          periodTotalSales: 0,
          periodTotalCash: 0,
          periodTotalCredit: 0,
          periodPayments: 0,
          periodReturns: 0,
          periodCashPayments: 0,
          periodTotalProfit: 0,
          invoiceCount: 0,
          paymentCount: 0,
        },
        generatedAt: new Date().toISOString(),
        generatedBy: userName,
        page: 1,
        pageCount: 1,
        totalEntries: 0,
      } satisfies SalesmanLedgerResponse;
    }

    // ── Compute opening balance from pre-period data ──
    let openingBalance = 0;
    const fromDate = parseDateInput(data.dateFrom);
    if (fromDate) {
      const [preInvoiceAgg] = await db
        .select({ totalCredit: sum(invoices.credit) })
        .from(invoices)
        .where(and(inArray(invoices.customerId, customerIds), lt(invoices.date, fromDate)));
      const [prePaymentAgg] = await db
        .select({ totalPaid: sum(payments.amount) })
        .from(payments)
        .where(and(inArray(payments.customerId, customerIds), lt(payments.paymentDate, fromDate), ne(payments.method, "invoice_cash")));
      const [preReturnAgg] = await db
        .select({ totalReturned: sum(salesReturns.totalAmount) })
        .from(salesReturns)
        .where(
          and(
            inArray(salesReturns.customerId, customerIds),
            inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
            buildApprovedReturnBeforeDate(fromDate),
          ),
        );
      openingBalance =
        safeNumber(preInvoiceAgg?.totalCredit) -
        safeNumber(prePaymentAgg?.totalPaid) -
        safeNumber(preReturnAgg?.totalReturned);
    }

    const invConditions = [
      inArray(invoices.customerId, customerIds),
      ...buildDateConditions(data.dateFrom, data.dateTo, invoices.date),
    ];

    const invoiceRows = await db.query.invoices.findMany({
      where: and(...invConditions),
      with: {
        customer: { columns: { name: true } },
        warehouse: { columns: { name: true } },
      },
      orderBy: [asc(invoices.date), asc(invoices.sNo)],
    });

    const payConditions = [
      inArray(payments.customerId, customerIds),
      ...buildDateConditions(data.dateFrom, data.dateTo, payments.paymentDate),
    ];

    const paymentRows = await db.query.payments.findMany({
      where: and(...payConditions),
      orderBy: [asc(payments.paymentDate), asc(payments.createdAt)],
      columns: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        paymentDate: true,
        customerId: true,
        invoiceId: true,
      },
    });

    const returnConditions = [
      inArray(salesReturns.customerId, customerIds),
      inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
    ];
    const returnWindow = buildApprovedReturnWindow(data.dateFrom, data.dateTo);
    if (returnWindow) {
      returnConditions.push(returnWindow);
    }

    const returnRows = await db.query.salesReturns.findMany({
      where: and(...returnConditions),
      orderBy: [asc(salesReturns.returnDate), asc(salesReturns.returnNumber)],
      columns: {
        id: true,
        customerId: true,
        returnNumber: true,
        invoiceId: true,
        returnDate: true,
        approvedAt: true,
        totalAmount: true,
        reason: true,
        condition: true,
        status: true,
        notes: true,
      },
    });

    const customerMap = new Map(linkedCustomers.map((c) => [c.id, c.name]));
    const invoiceSlipMap = await resolveInvoiceSlipMap(
      Array.from(
        new Set([
          ...paymentRows.map((pay) => pay.invoiceId).filter(Boolean) as string[],
          ...returnRows.map((ret) => ret.invoiceId).filter(Boolean) as string[],
        ]),
      ),
      new Map(
        invoiceRows
          .filter((inv) => inv.id && inv.slipNumber)
          .map((inv) => [inv.id, inv.slipNumber!] as const),
      ),
    );

    const entries: LedgerEntry[] = [];
    const timeline: Array<{ date: Date; kind: "invoice" | "return" | "payment"; idx: number }> = [];
    invoiceRows.forEach((inv, i) =>
      timeline.push({ date: new Date(inv.date), kind: "invoice", idx: i }),
    );
    returnRows.forEach((ret, i) =>
      timeline.push({ date: returnEffectiveDate(ret), kind: "return", idx: i }),
    );
    paymentRows.forEach((pay, i) =>
      timeline.push({ date: new Date(pay.paymentDate), kind: "payment", idx: i }),
    );
    timeline.sort(compareLedgerTimeline);

    let runningBalance = openingBalance;
    for (const t of timeline) {
      if (t.kind === "invoice") {
        const inv = invoiceRows[t.idx];
        const credit = safeNumber(inv.credit);
        runningBalance += credit;
        entries.push({
          type: "invoice",
          id: inv.id,
          date: new Date(inv.date),
          slipNumber: inv.slipNumber,
          warehouseName: inv.warehouse?.name ?? null,
          totalPrice: safeNumber(inv.totalPrice),
          cash: safeNumber(inv.cash),
          credit,
          status: inv.status,
          runningBalance,
          items: [],
          expenses: 0,
          expensesDescription: null,
          creditReturnDate: null,
          remarks: null,
          slipStatus: null,
          slipRecoveryStatus: null,
          slipAmountDue: 0,
          customerName: inv.customer?.name ?? null,
        } as LedgerEntry);
      } else if (t.kind === "return") {
        const ret = returnRows[t.idx];
        const amount = safeNumber(ret.totalAmount);
        runningBalance -= amount;
        entries.push({
          type: "return",
          id: ret.id,
          date: returnEffectiveDate(ret),
          returnNumber: ret.returnNumber,
          invoiceId: ret.invoiceId,
          invoiceSlipNumber: invoiceSlipMap.get(ret.invoiceId) ?? null,
          amount,
          reason: ret.reason,
          condition: ret.condition,
          status: ret.status,
          notes: ret.notes,
          runningBalance,
          customerName: customerMap.get(ret.customerId) ?? null,
        } as LedgerEntry);
      } else {
        const pay = paymentRows[t.idx];
        const amount = safeNumber(pay.amount);
        // Only credit payments (non-invoice_cash) affect the running balance.
        if (pay.method !== "invoice_cash") {
          runningBalance -= amount;
        }
        entries.push({
          type: "payment",
          id: pay.id,
          date: new Date(pay.paymentDate),
          reference: pay.reference,
          method: pay.method,
          amount,
          notes: pay.notes,
          runningBalance,
          invoiceId: pay.invoiceId,
          invoiceSlipNumber: pay.invoiceId ? invoiceSlipMap.get(pay.invoiceId) ?? null : null,
          customerName: customerMap.get(pay.customerId) ?? null,
        } as LedgerEntry);
      }
    }

    const [agg] = await db
      .select({
        totalSales: sum(invoices.totalPrice),
        totalCash: sum(invoices.cash),
        totalCredit: sum(invoices.credit),
        invoiceCount: count(),
      })
      .from(invoices)
      .where(and(...invConditions));

    const [payAgg] = await db
      .select({ totalPaid: sum(payments.amount), paymentCount: count() })
      .from(payments)
      .where(and(...payConditions, ne(payments.method, "invoice_cash")));

    const summary: LedgerSummary = {
      openingBalance,
      closingBalance: runningBalance,
      periodTotalSales: safeNumber(agg?.totalSales),
      periodTotalCash: safeNumber(agg?.totalCash),
      periodTotalCredit: safeNumber(agg?.totalCredit),
      periodPayments: safeNumber(payAgg?.totalPaid),
      periodReturns: returnRows.reduce((sum, ret) => sum + safeNumber(ret.totalAmount), 0),
      periodCashPayments: safeNumber(agg?.totalCash),
      periodTotalProfit: 0,
      invoiceCount: Number(agg?.invoiceCount) || 0,
      paymentCount: Number(payAgg?.paymentCount) || 0,
    };

    const filteredEntries = filterAndSortEntries(
      entries,
      data.search,
      data.sortBy,
      data.sortOrder,
      data.typeFilter,
    );

    const totalEntries = filteredEntries.length;
    const pageCount = Math.ceil(totalEntries / data.limit);
    const page = Math.min(data.page, Math.max(1, pageCount)) || 1;
    const offset = (page - 1) * data.limit;
    const paginatedEntries = filteredEntries.slice(offset, offset + data.limit);

    await logLedgerAccess({
      userId,
      userName,
      userEmail,
      entityType: "salesman",
      entityId: data.salesmanId,
      entityName: salesman.name,
      exportType: data.exportType ?? "view",
      periodFrom: parseDateInput(data.dateFrom) ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: totalEntries,
    });

    return {
      salesman: { id: salesman.id, name: salesman.name },
      entries: data.includeFullEntries ? filteredEntries : paginatedEntries,
      summary,
      generatedAt: new Date().toISOString(),
      generatedBy: userName,
      page,
      pageCount,
      totalEntries,
    } satisfies SalesmanLedgerResponse;
  });

// ── EXPORT AUDIT LOG QUERY ────────────────────────────────────────────────

// ── SALESMAN SUMMARY (retained for backward compatibility) ─────────────────

export const getSalesmanSummaryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        salesmanId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.salesmanId),
    });
    if (!salesman) throw new Error("Salesman not found");

    const linkedCustomers = await db.query.customers.findMany({
      where: eq(customers.salesmanId, data.salesmanId),
      columns: {
        id: true,
        name: true,
        city: true,
        credit: true,
        customerType: true,
        mobileNumber: true,
        email: true,
      },
    });
    const customerIds = linkedCustomers.map((c) => c.id);

    if (customerIds.length === 0) {
      return {
        salesman,
        customers: [],
        totalSales: 0,
        totalCredit: 0,
        totalCash: 0,
        outstandingBalance: 0,
        invoiceCount: 0,
      };
    }

    const conditions = [inArray(invoices.customerId, customerIds)];
    if (data.dateFrom) {
      const f = parseISO(data.dateFrom);
      if (isValid(f)) conditions.push(gte(invoices.date, f));
    }
    if (data.dateTo) {
      const t = parseISO(data.dateTo);
      if (isValid(t)) conditions.push(lte(invoices.date, t));
    }

    const [agg] = await db
      .select({
        totalSales: sum(invoices.totalPrice),
        totalCredit: sum(invoices.credit),
        totalCash: sum(invoices.cash),
        invoiceCount: count(),
      })
      .from(invoices)
      .where(and(...conditions));

    const customersWithBalance = linkedCustomers.map((c) => ({
      ...c,
      outstandingBalance: safeNumber(c.credit),
    }));

    const totalOutstanding = customersWithBalance.reduce(
      (acc, c) => acc + c.outstandingBalance,
      0,
    );

    return {
      salesman,
      customers: customersWithBalance,
      totalSales: safeNumber(agg?.totalSales),
      totalCredit: safeNumber(agg?.totalCredit),
      totalCash: safeNumber(agg?.totalCash),
      outstandingBalance: totalOutstanding,
      invoiceCount: Number(agg?.invoiceCount) || 0,
    };
  });

// ── SALESMAN-SHOP LEDGER (retained for backward compatibility) ─────────────

export const getSalesmanShopLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        salesmanId: z.string(),
        customerId: z.string(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        exportType: z.enum(["view", "print", "csv", "pdf"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id ?? "unknown";
    const userName = context.authContext?.session?.user?.name ?? "Unknown";
    const userEmail = context.authContext?.session?.user?.email ?? undefined;

    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.salesmanId),
    });
    if (!salesman) throw new Error("Salesman not found");

    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
      columns: {
        id: true,
        name: true,
        city: true,
        mobileNumber: true,
        credit: true,
        customerType: true,
      },
    });
    if (!customer) throw new Error("Customer not found");

    const invoiceConditions = [
      eq(invoices.customerId, data.customerId),
      eq(invoices.salesmanId, data.salesmanId),
      ...buildDateConditions(data.dateFrom, data.dateTo, invoices.date),
    ];

    const fromDate = parseDateInput(data.dateFrom);
    let openingBalance = 0;
    if (fromDate) {
      const [preInvoiceAgg] = await db
        .select({ totalCredit: sum(invoices.credit) })
        .from(invoices)
        .where(
          and(
            eq(invoices.customerId, data.customerId),
            eq(invoices.salesmanId, data.salesmanId),
            lt(invoices.date, fromDate),
          ),
        );
      const [prePaymentAgg] = await db
        .select({ totalPaid: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.customerId, data.customerId),
            lt(payments.paymentDate, fromDate),
            ne(payments.method, "invoice_cash"),
          ),
        );
      const [preReturnAgg] = await db
        .select({ totalReturned: sum(salesReturns.totalAmount) })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.customerId, data.customerId),
            inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
            buildApprovedReturnBeforeDate(fromDate),
          ),
        );

      openingBalance =
        safeNumber(preInvoiceAgg?.totalCredit) -
        safeNumber(prePaymentAgg?.totalPaid) -
        safeNumber(preReturnAgg?.totalReturned);
    }

    const invoiceRows = await db.query.invoices.findMany({
      where: and(...invoiceConditions),
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
      orderBy: [asc(invoices.date)],
    });

    const payConditions = [
      eq(payments.customerId, data.customerId),
      ...buildDateConditions(data.dateFrom, data.dateTo, payments.paymentDate),
    ];

    const paymentRows = await db.query.payments.findMany({
      where: and(...payConditions),
      orderBy: [asc(payments.paymentDate)],
      columns: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        paymentDate: true,
        invoiceId: true,
      },
    });

    const returnConditions = [
      eq(salesReturns.customerId, data.customerId),
      inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
    ];
    const returnWindow = buildApprovedReturnWindow(data.dateFrom, data.dateTo);
    if (returnWindow) {
      returnConditions.push(returnWindow);
    }

    const returnRows = await db.query.salesReturns.findMany({
      where: and(...returnConditions),
      orderBy: [asc(salesReturns.returnDate), asc(salesReturns.returnNumber)],
      columns: {
        id: true,
        returnNumber: true,
        invoiceId: true,
        returnDate: true,
        approvedAt: true,
        totalAmount: true,
        reason: true,
        condition: true,
        status: true,
        notes: true,
      },
    });

    const invoiceSlipMap = await resolveInvoiceSlipMap(
      Array.from(
        new Set([
          ...paymentRows.map((pay) => pay.invoiceId).filter(Boolean) as string[],
          ...returnRows.map((ret) => ret.invoiceId).filter(Boolean) as string[],
        ]),
      ),
      new Map(
        invoiceRows
          .filter((inv) => inv.id && inv.slipNumber)
          .map((inv) => [inv.id, inv.slipNumber!] as const),
      ),
    );

    type ShopLedgerEntry =
      | {
          type: "invoice";
          id: string;
          date: Date;
          slipNumber: string | null;
          warehouseName: string | null;
          totalPrice: number;
          cash: number;
          credit: number;
          status: string;
          runningBalance: number;
          items: any[];
        }
      | {
          type: "payment";
          id: string;
          date: Date;
          reference: string | null;
          method: string;
          amount: number;
          notes: string | null;
          runningBalance: number;
          invoiceId: string | null;
          invoiceSlipNumber: string | null;
        }
      | {
          type: "return";
          id: string;
          date: Date;
          returnNumber: number | null;
          invoiceId: string;
          invoiceSlipNumber: string | null;
          amount: number;
          reason: string;
          condition: string;
          status: string;
          notes: string | null;
          runningBalance: number;
        };

    const entries: ShopLedgerEntry[] = [];
    const timeline: Array<{ date: Date; kind: "invoice" | "return" | "payment"; idx: number }> = [];
    invoiceRows.forEach((inv, i) =>
      timeline.push({ date: new Date(inv.date), kind: "invoice", idx: i }),
    );
    returnRows.forEach((ret, i) =>
      timeline.push({ date: returnEffectiveDate(ret), kind: "return", idx: i }),
    );
    paymentRows.forEach((pay, i) =>
      timeline.push({ date: new Date(pay.paymentDate), kind: "payment", idx: i }),
    );
    timeline.sort(compareLedgerTimeline);

    let runningBalance = openingBalance;
    for (const t of timeline) {
      if (t.kind === "invoice") {
        const inv = invoiceRows[t.idx];
        const credit = safeNumber(inv.credit);
        runningBalance += credit;
        entries.push({
          type: "invoice",
          id: inv.id,
          date: new Date(inv.date),
          slipNumber: inv.slipNumber,
          warehouseName: inv.warehouse?.name ?? null,
          totalPrice: safeNumber(inv.totalPrice),
          cash: safeNumber(inv.cash),
          credit,
          status: inv.status,
          runningBalance,
          items: inv.items,
        });
      } else if (t.kind === "return") {
        const ret = returnRows[t.idx];
        const amount = safeNumber(ret.totalAmount);
        runningBalance -= amount;
        entries.push({
          type: "return",
          id: ret.id,
          date: returnEffectiveDate(ret),
          returnNumber: ret.returnNumber,
          invoiceId: ret.invoiceId,
          invoiceSlipNumber: invoiceSlipMap.get(ret.invoiceId) ?? null,
          amount,
          reason: ret.reason,
          condition: ret.condition,
          status: ret.status,
          notes: ret.notes,
          runningBalance,
        });
      } else {
        const pay = paymentRows[t.idx];
        const amount = safeNumber(pay.amount);
        // Only credit payments (non-invoice_cash) affect the running balance.
        if (pay.method !== "invoice_cash") {
          runningBalance -= amount;
        }
        entries.push({
          type: "payment",
          id: pay.id,
          date: new Date(pay.paymentDate),
          reference: pay.reference,
          method: pay.method,
          amount,
          notes: pay.notes,
          runningBalance,
          invoiceId: pay.invoiceId,
          invoiceSlipNumber: pay.invoiceId ? invoiceSlipMap.get(pay.invoiceId) ?? null : null,
        });
      }
    }

    const [agg] = await db
      .select({
        totalSales: sum(invoices.totalPrice),
        totalCash: sum(invoices.cash),
        totalCredit: sum(invoices.credit),
        invoiceCount: count(),
      })
      .from(invoices)
      .where(and(...invoiceConditions));

    const [payAgg] = await db
      .select({ totalPaid: sum(payments.amount) })
      .from(payments)
      .where(and(...payConditions, ne(payments.method, "invoice_cash")));

    await logLedgerAccess({
      userId,
      userName,
      userEmail,
      entityType: customer.customerType === "distributor" ? "distributor" : "shopkeeper",
      entityId: customer.id,
      entityName: customer.name,
      exportType: data.exportType ?? "view",
      periodFrom: fromDate ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: entries.length,
    });

    return {
      salesman,
      customer,
      entries,
      openingBalance,
      closingBalance: runningBalance,
      periodTotalSales: safeNumber(agg?.totalSales),
      periodTotalCash: safeNumber(agg?.totalCash),
      periodTotalCredit: safeNumber(agg?.totalCredit),
      periodPayments: safeNumber(payAgg?.totalPaid),
      periodReturns: returnRows.reduce((sum, ret) => sum + safeNumber(ret.totalAmount), 0),
      periodCashPayments: safeNumber(agg?.totalCash),
      invoiceCount: Number(agg?.invoiceCount) || 0,
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// SHOPKEEPER LEDGER (Full parity with distributor ledger)
// ═══════════════════════════════════════════════════════════════════════════
export const generateShopkeeperLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        customerId: z.string().min(1, "Customer ID is required"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().positive().default(DEFAULT_PAGE),
        limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
        search: z.string().optional(),
        sortBy: z.literal("date").optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        typeFilter: z.enum(["all", "invoice", "payment", "return"]).optional(),
        includeFullEntries: z.boolean().optional(),
        exportType: z.enum(["view", "print", "csv", "pdf"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.authContext?.session?.user?.id ?? "unknown";
    const userName = context.authContext?.session?.user?.name ?? "Unknown";
    const userEmail = context.authContext?.session?.user?.email ?? undefined;

    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, data.customerId),
      columns: { id: true, name: true, city: true, mobileNumber: true, credit: true, customerType: true },
    });
    if (!customer) throw new Error("Customer not found");

    // ── Compute opening balance from pre-period data ──
    let openingBalance = 0;
    const fromDate = parseDateInput(data.dateFrom);
    if (fromDate) {
      const [preInvoiceAgg] = await db
        .select({ totalCredit: sum(invoices.credit) })
        .from(invoices)
        .where(and(eq(invoices.customerId, data.customerId), lt(invoices.date, fromDate)));
      const [prePaymentAgg] = await db
        .select({ totalPaid: sum(payments.amount) })
        .from(payments)
        .where(and(eq(payments.customerId, data.customerId), lt(payments.paymentDate, fromDate), ne(payments.method, "invoice_cash")));
      const [preReturnAgg] = await db
        .select({ totalReturned: sum(salesReturns.totalAmount) })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.customerId, data.customerId),
            inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
            buildApprovedReturnBeforeDate(fromDate),
          ),
        );
      openingBalance =
        safeNumber(preInvoiceAgg?.totalCredit) -
        safeNumber(prePaymentAgg?.totalPaid) -
        safeNumber(preReturnAgg?.totalReturned);
    }

    // ── Fetch invoices in period ──
    const invoiceConditions = [
      eq(invoices.customerId, data.customerId),
      ...buildDateConditions(data.dateFrom, data.dateTo, invoices.date),
    ];
    const invoiceRows = await db.query.invoices.findMany({
      where: and(...invoiceConditions),
      with: {
        items: {
          columns: {
            id: true,
            pack: true,
            numberOfCartons: true,
            discountCartons: true,
            freeCartons: true,
            quantity: true,
            packsPerCarton: true,
            actualPackSize: true,
            perCartonPrice: true,
            amount: true,
            costOfGoodsSold: true,
            hsnCode: true,
            retailPrice: true,
          },
        },
        warehouse: { columns: { name: true } },
        salesman: { columns: { name: true } },
      },
      orderBy: [asc(invoices.date), asc(invoices.sNo)],
    });

    // ── Fetch slip records ──
    const slipMap = new Map<string, { status: string | null; amountDue: string; recoveryStatus: string | null }>();
    const slipRows = await db.query.slipRecords.findMany({
      where: eq(slipRecords.customerId, data.customerId),
      columns: { invoiceId: true, status: true, amountDue: true, recoveryStatus: true },
    });
    slipRows.forEach((s) => {
      if (s.invoiceId) {
        slipMap.set(s.invoiceId, {
          status: s.status ?? null,
          amountDue: s.amountDue,
          recoveryStatus: s.recoveryStatus ?? null,
        });
      }
    });

    // ── Fetch payments in period ──
    const paymentConditions = [
      eq(payments.customerId, data.customerId),
      ...buildDateConditions(data.dateFrom, data.dateTo, payments.paymentDate),
    ];
    const paymentRows = await db.query.payments.findMany({
      where: and(...paymentConditions),
      orderBy: [asc(payments.paymentDate), asc(payments.createdAt)],
      columns: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        paymentDate: true,
        invoiceId: true,
      },
    });

    const returnConditions = [
      eq(salesReturns.customerId, data.customerId),
      inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
    ];
    const returnWindow = buildApprovedReturnWindow(data.dateFrom, data.dateTo);
    if (returnWindow) {
      returnConditions.push(returnWindow);
    }

    const returnRows = await db.query.salesReturns.findMany({
      where: and(...returnConditions),
      orderBy: [asc(salesReturns.returnDate), asc(salesReturns.returnNumber)],
      with: {
        stockTraces: {
          columns: { totalCost: true },
        },
      },
      columns: {
        id: true,
        returnNumber: true,
        invoiceId: true,
        returnDate: true,
        approvedAt: true,
        totalAmount: true,
        reason: true,
        condition: true,
        status: true,
        notes: true,
      },
    });

    const invoiceSlipMap = await resolveInvoiceSlipMap(
      Array.from(
        new Set([
          ...paymentRows.map((pay) => pay.invoiceId).filter(Boolean) as string[],
          ...returnRows.map((ret) => ret.invoiceId).filter(Boolean) as string[],
        ]),
      ),
      new Map(
        invoiceRows
          .filter((inv) => inv.id && inv.slipNumber)
          .map((inv) => [inv.id, inv.slipNumber!] as const),
      ),
    );

    // ── Merge into chronological ledger entries with running balance ──
    const entries: LedgerEntry[] = [];
    const timeline: Array<{ date: Date; kind: "invoice" | "return" | "payment"; idx: number }> = [];
    invoiceRows.forEach((inv, i) => timeline.push({ date: new Date(inv.date), kind: "invoice", idx: i }));
    returnRows.forEach((ret, i) => timeline.push({ date: returnEffectiveDate(ret), kind: "return", idx: i }));
    paymentRows.forEach((pay, i) => timeline.push({ date: new Date(pay.paymentDate), kind: "payment", idx: i }));
    timeline.sort(compareLedgerTimeline);

    let runningBalance = openingBalance;
    for (const t of timeline) {
      if (t.kind === "invoice") {
        const inv = invoiceRows[t.idx];
        const totalPrice = safeNumber(inv.totalPrice);
        const cash = safeNumber(inv.cash);
        const credit = safeNumber(inv.credit);
        const expenses = safeNumber(inv.expenses);
        const slipInfo = inv.id ? slipMap.get(inv.id) : null;

        runningBalance += credit;
        entries.push({
          type: "invoice",
          id: inv.id,
          date: new Date(inv.date),
          slipNumber: inv.slipNumber,
          warehouseName: inv.warehouse?.name ?? null,
          totalPrice,
          cash,
          credit,
          status: inv.status,
          runningBalance,
          items: inv.items.map((item) => ({
            id: item.id,
            pack: item.pack,
            numberOfCartons: item.numberOfCartons,
            discountCartons: item.discountCartons,
            freeCartons: item.freeCartons,
            quantity: item.quantity,
            packsPerCarton: item.packsPerCarton,
            actualPackSize: item.actualPackSize,
            perCartonPrice: item.perCartonPrice,
            amount: item.amount,
            costOfGoodsSold: item.costOfGoodsSold,
            hsnCode: item.hsnCode,
            retailPrice: item.retailPrice,
          })),
          expenses,
          expensesDescription: inv.expensesDescription ?? null,
          creditReturnDate: inv.creditReturnDate ?? null,
          remarks: inv.remarks ?? null,
          slipStatus: slipInfo?.status ?? null,
          slipRecoveryStatus: slipInfo?.recoveryStatus ?? null,
          slipAmountDue: safeNumber(slipInfo?.amountDue),
        });
      } else if (t.kind === "return") {
        const ret = returnRows[t.idx];
        const amount = safeNumber(ret.totalAmount);
        runningBalance -= amount;
        entries.push({
          type: "return",
          id: ret.id,
          date: returnEffectiveDate(ret),
          returnNumber: ret.returnNumber,
          invoiceId: ret.invoiceId,
          invoiceSlipNumber: invoiceSlipMap.get(ret.invoiceId) ?? null,
          amount,
          reason: ret.reason,
          condition: ret.condition,
          status: ret.status,
          notes: ret.notes,
          runningBalance,
        });
      } else {
        const pay = paymentRows[t.idx];
        const amount = safeNumber(pay.amount);
        const invoiceSlipNumber = pay.invoiceId ? invoiceSlipMap.get(pay.invoiceId) ?? null : null;

        // Only credit payments (non-invoice_cash) affect the running balance.
        if (pay.method !== "invoice_cash") {
          runningBalance -= amount;
        }
        entries.push({
          type: "payment",
          id: pay.id,
          date: new Date(pay.paymentDate),
          reference: pay.reference,
          method: pay.method,
          amount,
          notes: pay.notes,
          runningBalance,
          invoiceId: pay.invoiceId,
          invoiceSlipNumber,
        });
      }
    }

    // ── Period aggregates ──
    const [agg] = await db
      .select({
        totalSales: sum(invoices.totalPrice),
        totalCash: sum(invoices.cash),
        totalCredit: sum(invoices.credit),
        invoiceCount: count(),
      })
      .from(invoices)
      .where(and(...invoiceConditions));

    const [payAgg] = await db
      .select({ totalPaid: sum(payments.amount), paymentCount: count() })
      .from(payments)
      .where(and(...paymentConditions, ne(payments.method, "invoice_cash")));

    const periodTotalProfit = invoiceRows.reduce((sum, inv) => {
      return sum + (inv.items ?? []).reduce((lineSum, item) => {
        return lineSum + ((Number(item.amount) || 0) - (Number(item.costOfGoodsSold) || 0));
      }, 0);
    }, 0) - returnRows.reduce((sum, ret) => {
      const returnCost = (ret.stockTraces ?? []).reduce((traceSum, trace) => {
        return traceSum + safeNumber(trace.totalCost);
      }, 0);
      return sum + (safeNumber(ret.totalAmount) - returnCost);
    }, 0);

    const summary: LedgerSummary = {
      openingBalance,
      closingBalance: runningBalance,
      periodTotalSales: safeNumber(agg?.totalSales),
      periodTotalCash: safeNumber(agg?.totalCash),
      periodTotalCredit: safeNumber(agg?.totalCredit),
      periodPayments: safeNumber(payAgg?.totalPaid),
      periodReturns: returnRows.reduce((sum, ret) => sum + safeNumber(ret.totalAmount), 0),
      periodCashPayments: safeNumber(agg?.totalCash),
      periodTotalProfit,
      invoiceCount: Number(agg?.invoiceCount) || 0,
      paymentCount: Number(payAgg?.paymentCount) || 0,
    };

    // ── Apply search, filter, sort ──
    const filteredEntries = filterAndSortEntries(
      entries,
      data.search,
      data.sortBy,
      data.sortOrder,
      data.typeFilter,
    );

    // ── Pagination ──
    const totalEntries = filteredEntries.length;
    const pageCount = Math.ceil(totalEntries / data.limit);
    const page = Math.min(data.page, Math.max(1, pageCount)) || 1;
    const offset = (page - 1) * data.limit;
    const paginatedEntries = filteredEntries.slice(offset, offset + data.limit);

    // ── Audit Log ──
    await logLedgerAccess({
      userId,
      userName,
      userEmail,
      entityType: "shopkeeper",
      entityId: data.customerId,
      entityName: customer.name,
      exportType: data.exportType ?? "view",
      periodFrom: fromDate ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: totalEntries,
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        mobileNumber: customer.mobileNumber,
        credit: customer.credit,
        customerType: customer.customerType,
      },
      entries: data.includeFullEntries ? filteredEntries : paginatedEntries,
      summary,
      generatedAt: new Date().toISOString(),
      generatedBy: userName,
      page,
      pageCount,
      totalEntries,
    };
  });
