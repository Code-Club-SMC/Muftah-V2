import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { endOfDay, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import {
  ledgerExportAuditLog,
  payments,
  salesmen,
  salesReturns,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import type {
  DistributorLedgerResponse,
  LedgerEntry,
  LedgerSummary,
  SalesmanLedgerResponse,
} from "@/lib/ledger-types";
import { requireSalesViewMiddleware } from "@/lib/middlewares";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const APPROVED_RETURN_STATUSES = ["approved", "completed"] as const;

const ledgerQuerySchema = z.object({
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
});

type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

function safeNumber(value: string | number | null | undefined) {
  if (value == null) return 0;
  const number = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(number) ? number : 0;
}

function parseDateInput(value?: string) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
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

function buildApprovedReturnWindow(dateFrom?: string, dateTo?: string) {
  const fromDate = parseDateInput(dateFrom);
  const toDate = parseDateInput(dateTo);
  if (!fromDate && !toDate) return undefined;

  const approvedConditions: any[] = [];
  const fallbackConditions: any[] = [isNull(salesReturns.approvedAt)];
  if (fromDate) {
    approvedConditions.push(gte(salesReturns.approvedAt, fromDate));
    fallbackConditions.push(gte(salesReturns.returnDate, fromDate));
  }
  if (toDate) {
    approvedConditions.push(lte(salesReturns.approvedAt, endOfDay(toDate)));
    fallbackConditions.push(lte(salesReturns.returnDate, endOfDay(toDate)));
  }
  return or(and(...fallbackConditions), and(...approvedConditions));
}

function buildApprovedReturnBeforeDate(fromDate: Date) {
  return or(
    and(isNull(salesReturns.approvedAt), lt(salesReturns.returnDate, fromDate)),
    lt(salesReturns.approvedAt, fromDate),
  );
}

function customerCondition(
  customerIds: string[],
  column:
    | typeof invoices.customerId
    | typeof payments.customerId
    | typeof salesReturns.customerId
    | typeof slipRecords.customerId,
) {
  return customerIds.length === 1
    ? eq(column, customerIds[0])
    : inArray(column, customerIds);
}

function startOfDayTime(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function filterAndSortEntries(entries: LedgerEntry[], query: LedgerQuery) {
  let result = [...entries];
  if (query.typeFilter && query.typeFilter !== "all") {
    result = result.filter((entry) => entry.type === query.typeFilter);
  }
  if (query.search?.trim()) {
    const term = query.search.trim().toLowerCase();
    result = result.filter((entry) => {
      const invoiceNumber =
        entry.type === "invoice" ? entry.invoiceNumber : entry.invoiceNumber;
      if (invoiceNumber.toLowerCase().includes(term)) return true;
      if (entry.customerName?.toLowerCase().includes(term)) return true;
      if (entry.type === "invoice") {
        return (
          entry.warehouseName?.toLowerCase().includes(term) ||
          entry.remarks?.toLowerCase().includes(term) ||
          entry.items.some((item) => item.pack.toLowerCase().includes(term))
        );
      }
      if (entry.type === "return") {
        return (
          String(entry.returnNumber).includes(term) ||
          entry.reason.toLowerCase().includes(term) ||
          entry.notes?.toLowerCase().includes(term)
        );
      }
      return (
        entry.reference?.toLowerCase().includes(term) ||
        entry.method.toLowerCase().includes(term) ||
        entry.notes?.toLowerCase().includes(term)
      );
    });
  }

  // Ledger must stay chronological by calendar date, with Invoices preceding Payments on the same day.
  const order = query.sortOrder === "desc" ? -1 : 1;
  const kindRank = { invoice: 0, return: 1, payment: 2 } as const;
  result.sort((a, b) => {
    const dayDiff = startOfDayTime(a.date) - startOfDayTime(b.date);
    if (dayDiff !== 0) return dayDiff * order;
    const kindDiff = kindRank[a.type] - kindRank[b.type];
    if (kindDiff !== 0) return kindDiff * order;
    const timeDiff = a.date.getTime() - b.date.getTime();
    if (timeDiff !== 0) return timeDiff * order;
    return a.id.localeCompare(b.id) * order;
  });
  return result;
}

async function logLedgerAccess(params: {
  userId: string;
  userName: string;
  userEmail?: string;
  entityType: string;
  entityId: string;
  entityName: string;
  exportType: string;
  periodFrom?: Date;
  periodTo?: Date;
  entryCount: number;
}) {
  try {
    const headers = getRequestHeaders() as unknown as Record<
      string,
      string | undefined
    >;
    await db.insert(ledgerExportAuditLog).values({
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName,
      exportType: params.exportType,
      periodFrom: params.periodFrom ?? null,
      periodTo: params.periodTo ?? null,
      entryCount: params.entryCount,
      ipAddress: headers["x-forwarded-for"] ?? headers["x-real-ip"] ?? null,
      userAgent: headers["user-agent"] ?? null,
    });
  } catch (error) {
    console.error("[Ledger Audit] Failed to log access:", error);
  }
}

async function buildLedger(customerIds: string[], query: LedgerQuery) {
  if (customerIds.length === 0) {
    const summary: LedgerSummary = {
      openingBalance: 0,
      closingBalance: 0,
      periodTotalSales: 0,
      periodPayments: 0,
      periodReturns: 0,
      periodTotalProfit: 0,
      invoiceCount: 0,
      paymentCount: 0,
    };
    return { entries: [] as LedgerEntry[], summary };
  }

  const fromDate = parseDateInput(query.dateFrom);
  let openingBalance = 0;
  if (fromDate) {
    const [preInvoices, prePayments, preReturns] = await Promise.all([
      db.query.invoices.findMany({
        where: and(
          customerCondition(customerIds, invoices.customerId),
          ne(invoices.status, "voided"),
          lt(invoices.date, fromDate),
        ),
        columns: { totalPrice: true },
      }),
      db.query.payments.findMany({
        where: and(
          customerCondition(customerIds, payments.customerId),
          eq(payments.status, "confirmed"),
          lt(payments.effectiveDate, fromDate),
        ),
        columns: { amount: true },
      }),
      db.query.salesReturns.findMany({
        where: and(
          customerCondition(customerIds, salesReturns.customerId),
          inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
          buildApprovedReturnBeforeDate(fromDate),
        ),
        columns: { totalAmount: true },
      }),
    ]);

    openingBalance =
      preInvoices.reduce((sum, row) => sum + safeNumber(row.totalPrice), 0) -
      prePayments.reduce((sum, row) => sum + safeNumber(row.amount), 0) -
      preReturns.reduce((sum, row) => sum + safeNumber(row.totalAmount), 0);
  }

  const invoiceConditions = [
    customerCondition(customerIds, invoices.customerId),
    ne(invoices.status, "voided"),
    ...buildDateConditions(query.dateFrom, query.dateTo, invoices.date),
  ];
  const paymentConditions = [
    customerCondition(customerIds, payments.customerId),
    eq(payments.status, "confirmed"),
    ...buildDateConditions(
      query.dateFrom,
      query.dateTo,
      payments.effectiveDate,
    ),
  ];
  const returnConditions = [
    customerCondition(customerIds, salesReturns.customerId),
    inArray(salesReturns.status, [...APPROVED_RETURN_STATUSES]),
  ];
  const returnWindow = buildApprovedReturnWindow(query.dateFrom, query.dateTo);
  if (returnWindow) returnConditions.push(returnWindow);

  const [invoiceRows, paymentRows, returnRows, slipRows, linkedCustomers] =
    await Promise.all([
      db.query.invoices.findMany({
        where: and(...invoiceConditions),
        with: {
          items: true,
          warehouse: { columns: { name: true } },
          customer: { columns: { name: true } },
        },
        orderBy: [asc(invoices.date), asc(invoices.id)],
      }),
      db.query.payments.findMany({
        where: and(...paymentConditions),
        with: { invoice: { columns: { invoiceNumber: true } } },
        orderBy: [asc(payments.effectiveDate), asc(payments.id)],
      }),
      db.query.salesReturns.findMany({
        where: and(...returnConditions),
        with: {
          invoice: { columns: { invoiceNumber: true } },
          stockTraces: { columns: { totalCost: true } },
        },
        orderBy: [asc(salesReturns.approvedAt), asc(salesReturns.id)],
      }),
      db.query.slipRecords.findMany({
        where: customerCondition(customerIds, slipRecords.customerId),
        columns: {
          invoiceId: true,
          recoveryStatus: true,
          outstandingAmount: true,
        },
      }),
      db.query.customers.findMany({
        where: inArray(customers.id, customerIds),
        columns: { id: true, name: true },
      }),
    ]);

  const customerNames = new Map(
    linkedCustomers.map((customer) => [customer.id, customer.name]),
  );
  const slips = new Map(
    slipRows.map((slip) => [slip.invoiceId, slip] as const),
  );
  const timeline: Array<{
    date: Date;
    id: string;
    kind: "invoice" | "return" | "payment";
    index: number;
  }> = [];

  invoiceRows.forEach((row, index) =>
    timeline.push({ date: row.date, id: row.id, kind: "invoice", index }),
  );
  returnRows.forEach((row, index) =>
    timeline.push({
      date: row.approvedAt ?? row.returnDate,
      id: row.id,
      kind: "return",
      index,
    }),
  );
  paymentRows.forEach((row, index) =>
    timeline.push({
      date: row.effectiveDate ?? row.paymentDate,
      id: row.id,
      kind: "payment",
      index,
    }),
  );
  const kindRank = { invoice: 0, return: 1, payment: 2 } as const;
  timeline.sort((left, right) => {
    const dayDiff = startOfDayTime(left.date) - startOfDayTime(right.date);
    if (dayDiff !== 0) return dayDiff;
    const kindDiff = kindRank[left.kind] - kindRank[right.kind];
    if (kindDiff !== 0) return kindDiff;
    const timeDiff = left.date.getTime() - right.date.getTime();
    if (timeDiff !== 0) return timeDiff;
    return left.id.localeCompare(right.id);
  });

  const entries: LedgerEntry[] = [];
  let runningBalance = openingBalance;
  for (const event of timeline) {
    if (event.kind === "invoice") {
      const invoice = invoiceRows[event.index];
      const totalPrice = safeNumber(invoice.totalPrice);
      const slip = slips.get(invoice.id);
      runningBalance += totalPrice;
      entries.push({
        type: "invoice",
        id: invoice.id,
        date: invoice.date,
        invoiceNumber: invoice.invoiceNumber,
        warehouseName: invoice.warehouse?.name ?? null,
        totalPrice,
        paidAmount: safeNumber(invoice.paidAmount),
        returnedAmount: safeNumber(invoice.returnedAmount),
        outstandingAmount: safeNumber(invoice.outstandingAmount),
        paymentDueDate: invoice.paymentDueDate,
        paymentStatus: invoice.paymentStatus,
        status: invoice.status,
        runningBalance,
        items: invoice.items,
        expenses: safeNumber(invoice.expenses),
        expensesDescription: invoice.expensesDescription,
        remarks: invoice.remarks,
        recoveryStatus: slip?.recoveryStatus ?? null,
        recoveryOutstandingAmount: safeNumber(slip?.outstandingAmount),
        customerName: invoice.customer?.name ?? null,
      });
      continue;
    }

    if (event.kind === "return") {
      const salesReturn = returnRows[event.index];
      const amount = safeNumber(salesReturn.totalAmount);
      runningBalance -= amount;
      entries.push({
        type: "return",
        id: salesReturn.id,
        date: salesReturn.approvedAt ?? salesReturn.returnDate,
        returnNumber: salesReturn.returnNumber,
        invoiceId: salesReturn.invoiceId,
        invoiceNumber: salesReturn.invoice.invoiceNumber,
        amount,
        reason: salesReturn.reason,
        condition: salesReturn.condition,
        status: salesReturn.status,
        notes: salesReturn.notes,
        runningBalance,
        customerName: customerNames.get(salesReturn.customerId) ?? null,
      });
      continue;
    }

    const payment = paymentRows[event.index];
    const amount = safeNumber(payment.amount);
    runningBalance -= amount;
    entries.push({
      type: "payment",
      id: payment.id,
      date: payment.effectiveDate ?? payment.paymentDate,
      reference: payment.reference ?? payment.chequeNumber,
      method: payment.method,
      amount,
      notes: payment.notes,
      runningBalance,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoice.invoiceNumber,
      customerName: customerNames.get(payment.customerId) ?? null,
    });
  }

  const periodTotalSales = invoiceRows.reduce(
    (sum, row) => sum + safeNumber(row.totalPrice),
    0,
  );
  const periodPayments = paymentRows.reduce(
    (sum, row) => sum + safeNumber(row.amount),
    0,
  );
  const periodReturns = returnRows.reduce(
    (sum, row) => sum + safeNumber(row.totalAmount),
    0,
  );
  const invoiceProfit = invoiceRows.reduce((sum, invoice) => {
    const lineProfit = invoice.items.reduce(
      (itemSum, item) =>
        itemSum + safeNumber(item.amount) - safeNumber(item.costOfGoodsSold),
      0,
    );
    return sum + lineProfit - safeNumber(invoice.invoiceDiscount);
  }, 0);
  const returnedProfit = returnRows.reduce((sum, salesReturn) => {
    const returnedCost = salesReturn.stockTraces.reduce(
      (cost, trace) => cost + safeNumber(trace.totalCost),
      0,
    );
    return sum + safeNumber(salesReturn.totalAmount) - returnedCost;
  }, 0);

  return {
    entries,
    summary: {
      openingBalance,
      closingBalance: runningBalance,
      periodTotalSales,
      periodPayments,
      periodReturns,
      periodTotalProfit: invoiceProfit - returnedProfit,
      invoiceCount: invoiceRows.length,
      paymentCount: paymentRows.length,
    } satisfies LedgerSummary,
  };
}

function paginateLedger(entries: LedgerEntry[], query: LedgerQuery) {
  const filteredEntries = filterAndSortEntries(entries, query);
  const totalEntries = filteredEntries.length;
  const pageCount = Math.max(1, Math.ceil(totalEntries / query.limit));
  const page = Math.min(query.page, pageCount);
  const offset = (page - 1) * query.limit;
  return {
    entries: query.includeFullEntries
      ? filteredEntries
      : filteredEntries.slice(offset, offset + query.limit),
    totalEntries,
    page,
    pageCount,
  };
}

async function getCustomer(customerId: string) {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: {
      id: true,
      name: true,
      city: true,
      mobileNumber: true,
      outstandingAmount: true,
      customerType: true,
      salesmanId: true,
    },
  });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

function auditContext(context: any) {
  return {
    userId: context.authContext?.session?.user?.id ?? "unknown",
    userName: context.authContext?.session?.user?.name ?? "Unknown",
    userEmail: context.authContext?.session?.user?.email ?? undefined,
  };
}

async function generateCustomerLedger(
  data: LedgerQuery & { customerId: string },
  context: any,
) {
  const customer = await getCustomer(data.customerId);
  const ledger = await buildLedger([customer.id], data);
  const page = paginateLedger(ledger.entries, data);
  const actor = auditContext(context);
  await logLedgerAccess({
    ...actor,
    entityType: customer.customerType,
    entityId: customer.id,
    entityName: customer.name,
    exportType: data.exportType ?? "view",
    periodFrom: parseDateInput(data.dateFrom) ?? undefined,
    periodTo: parseDateInput(data.dateTo) ?? undefined,
    entryCount: page.totalEntries,
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      city: customer.city,
      mobileNumber: customer.mobileNumber,
      outstandingAmount: customer.outstandingAmount,
      customerType: customer.customerType,
    },
    entries: page.entries,
    summary: ledger.summary,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.userName,
    page: page.page,
    pageCount: page.pageCount,
    totalEntries: page.totalEntries,
  } satisfies DistributorLedgerResponse;
}

export const generateDistributorLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    ledgerQuerySchema
      .extend({ customerId: z.string().min(1, "Customer ID is required") })
      .parse(input),
  )
  .handler(({ data, context }) => generateCustomerLedger(data, context));

export const generateShopkeeperLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    ledgerQuerySchema
      .extend({ customerId: z.string().min(1, "Customer ID is required") })
      .parse(input),
  )
  .handler(({ data, context }) => generateCustomerLedger(data, context));

export const generateSalesmanLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    ledgerQuerySchema
      .extend({ salesmanId: z.string().min(1, "Salesman ID is required") })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.salesmanId),
      columns: { id: true, name: true },
    });
    if (!salesman) throw new Error("Salesman not found");

    const linkedCustomers = await db.query.customers.findMany({
      where: eq(customers.salesmanId, data.salesmanId),
      columns: { id: true },
    });
    const ledger = await buildLedger(
      linkedCustomers.map((customer) => customer.id),
      data,
    );
    const page = paginateLedger(ledger.entries, data);
    const actor = auditContext(context);
    await logLedgerAccess({
      ...actor,
      entityType: "salesman",
      entityId: salesman.id,
      entityName: salesman.name,
      exportType: data.exportType ?? "view",
      periodFrom: parseDateInput(data.dateFrom) ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: page.totalEntries,
    });

    return {
      salesman,
      entries: page.entries,
      summary: ledger.summary,
      generatedAt: new Date().toISOString(),
      generatedBy: actor.userName,
      page: page.page,
      pageCount: page.pageCount,
      totalEntries: page.totalEntries,
    } satisfies SalesmanLedgerResponse;
  });

export const getSalesmanSummaryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
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
        outstandingAmount: true,
        customerType: true,
        mobileNumber: true,
      },
    });
    if (linkedCustomers.length === 0) {
      return {
        salesman,
        customers: [],
        totalSales: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        invoiceCount: 0,
      };
    }

    const customerIds = linkedCustomers.map((customer) => customer.id);
    const invoiceRows = await db.query.invoices.findMany({
      where: and(
        customerCondition(customerIds, invoices.customerId),
        ne(invoices.status, "voided"),
        ...buildDateConditions(data.dateFrom, data.dateTo, invoices.date),
      ),
      columns: {
        totalPrice: true,
        paidAmount: true,
        outstandingAmount: true,
      },
    });
    const customersWithBalance = linkedCustomers.map((customer) => ({
      ...customer,
      outstandingBalance: safeNumber(customer.outstandingAmount),
    }));

    return {
      salesman,
      customers: customersWithBalance,
      totalSales: invoiceRows.reduce(
        (sum, invoice) => sum + safeNumber(invoice.totalPrice),
        0,
      ),
      paidAmount: invoiceRows.reduce(
        (sum, invoice) => sum + safeNumber(invoice.paidAmount),
        0,
      ),
      outstandingAmount: customersWithBalance.reduce(
        (sum, customer) => sum + customer.outstandingBalance,
        0,
      ),
      invoiceCount: invoiceRows.length,
    };
  });

export const getSalesmanShopLedgerFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    ledgerQuerySchema
      .pick({ dateFrom: true, dateTo: true, exportType: true })
      .extend({ salesmanId: z.string(), customerId: z.string() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.id, data.salesmanId),
    });
    if (!salesman) throw new Error("Salesman not found");
    const customer = await getCustomer(data.customerId);
    if (customer.salesmanId !== data.salesmanId) {
      throw new Error("This customer is not assigned to the selected salesman");
    }

    const query = ledgerQuerySchema.parse(data);
    const ledger = await buildLedger([customer.id], query);
    const actor = auditContext(context);
    await logLedgerAccess({
      ...actor,
      entityType: "salesman_shop",
      entityId: customer.id,
      entityName: customer.name,
      exportType: data.exportType ?? "view",
      periodFrom: parseDateInput(data.dateFrom) ?? undefined,
      periodTo: parseDateInput(data.dateTo) ?? undefined,
      entryCount: ledger.entries.length,
    });

    return {
      salesman,
      customer,
      entries: ledger.entries,
      ...ledger.summary,
    };
  });
