import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { endOfDay, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { payments } from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES } from "@/lib/report-source";

const inputSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  source: z.enum(REPORT_SOURCES).default("all"),
});

function dateConditions(
  column: typeof payments.effectiveDate | typeof payments.paymentDate,
  dateFrom?: string,
  dateTo?: string,
) {
  const conditions = [];
  if (dateFrom) {
    const from = parseISO(dateFrom);
    if (isValid(from)) conditions.push(gte(column, from));
  }
  if (dateTo) {
    const to = parseISO(dateTo);
    if (isValid(to)) conditions.push(lte(column, endOfDay(to)));
  }
  return conditions;
}

export const getCollectionsReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const confirmedConditions = [
      eq(payments.status, "confirmed"),
      ne(payments.method, "expense_offset"),
      ...dateConditions(payments.effectiveDate, data.dateFrom, data.dateTo),
    ];
    const pendingConditions = [
      eq(payments.status, "pending"),
      ...dateConditions(payments.paymentDate, data.dateFrom, data.dateTo),
    ];
    const exceptionConditions = [
      inArray(payments.status, ["returned", "cancelled", "reversed"]),
      ne(payments.method, "expense_offset"),
      ...dateConditions(payments.paymentDate, data.dateFrom, data.dateTo),
    ];

    if (data.source !== "all") {
      confirmedConditions.push(eq(invoices.source, data.source));
      pendingConditions.push(eq(invoices.source, data.source));
      exceptionConditions.push(eq(invoices.source, data.source));
    }

    const baseSelection = {
      paymentId: payments.id,
      invoiceNumber: invoices.invoiceNumber,
      customerName: customers.name,
      source: invoices.source,
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      paymentDate: payments.paymentDate,
      effectiveDate: payments.effectiveDate,
      reason: payments.resolutionReason,
    };

    const [confirmedRows, pendingRows, exceptionRows] = await Promise.all([
      db
        .select(baseSelection)
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(customers, eq(payments.customerId, customers.id))
        .where(and(...confirmedConditions))
        .orderBy(desc(payments.effectiveDate), desc(payments.id)),
      db
        .select(baseSelection)
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(customers, eq(payments.customerId, customers.id))
        .where(and(...pendingConditions))
        .orderBy(desc(payments.paymentDate), desc(payments.id)),
      db
        .select(baseSelection)
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(customers, eq(payments.customerId, customers.id))
        .where(and(...exceptionConditions))
        .orderBy(desc(payments.resolvedAt), desc(payments.id)),
    ]);

    const confirmed = confirmedRows.map((row) => ({
      paymentId: row.paymentId,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      source: row.source,
      method: row.method as "cash" | "bank_transfer" | "cheque",
      amount: Number(row.amount),
      effectiveDate: row.effectiveDate?.toISOString() ?? "",
    }));
    const pending = pendingRows.map((row) => ({
      paymentId: row.paymentId,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      source: row.source,
      method: row.method as "bank_transfer" | "cheque",
      amount: Number(row.amount),
      paymentDate: row.paymentDate.toISOString(),
    }));
    const exceptions = exceptionRows.map((row) => ({
      paymentId: row.paymentId,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      source: row.source,
      method: row.method as "cash" | "bank_transfer" | "cheque",
      status: row.status as "returned" | "cancelled" | "reversed",
      amount: Number(row.amount),
      reason: row.reason ?? "—",
      paymentDate: row.paymentDate.toISOString(),
    }));

    const sumConfirmed = (method: "cash" | "bank_transfer" | "cheque") =>
      confirmed
        .filter((row) => row.method === method)
        .reduce((sum, row) => sum + row.amount, 0);

    return {
      confirmed,
      pending,
      exceptions,
      summary: {
        cash: sumConfirmed("cash"),
        bankTransfer: sumConfirmed("bank_transfer"),
        cheque: sumConfirmed("cheque"),
        pending: pending.reduce((sum, row) => sum + row.amount, 0),
      },
    };
  });
