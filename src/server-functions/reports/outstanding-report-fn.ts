import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gt, gte, lte, ne } from "drizzle-orm";
import { endOfDay, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { slipRecords, salesmen } from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES } from "@/lib/report-source";

export const getOutstandingReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        source: z.enum(REPORT_SOURCES).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const conditions = [
      ne(invoices.status, "voided"),
      gt(slipRecords.outstandingAmount, "0"),
    ];

    if (data.source !== "all") {
      conditions.push(eq(invoices.source, data.source));
    }

    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(invoices.date, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(invoices.date, endOfDay(to)));
    }

    const rows = await db
      .select({
        slipId: slipRecords.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.date,
        source: invoices.source,
        paymentDueDate: invoices.paymentDueDate,
        recoveryStatus: slipRecords.recoveryStatus,
        invoiceAmount: slipRecords.invoiceAmount,
        paidAmount: slipRecords.paidAmount,
        returnedAmount: slipRecords.returnedAmount,
        outstandingAmount: slipRecords.outstandingAmount,
        customerName: customers.name,
        customerType: customers.customerType,
        salesmanName: salesmen.name,
        escalationLevel: slipRecords.escalationLevel,
        nextFollowUpDate: slipRecords.nextFollowUpDate,
      })
      .from(slipRecords)
      .innerJoin(customers, eq(slipRecords.customerId, customers.id))
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .leftJoin(salesmen, eq(slipRecords.salesmanId, salesmen.id))
      .where(and(...conditions))
      .orderBy(desc(invoices.paymentDueDate), desc(invoices.id));

    const outstandingInvoices = rows.map((row) => ({
      ...row,
      invoiceAmount: Number(row.invoiceAmount),
      paidAmount: Number(row.paidAmount),
      returnedAmount: Number(row.returnedAmount),
      outstandingAmount: Number(row.outstandingAmount),
      escalationLevel: Number(row.escalationLevel),
    }));

    return {
      invoices: outstandingInvoices,
      summary: {
        invoiceAmount: outstandingInvoices.reduce(
          (sum, row) => sum + row.invoiceAmount,
          0,
        ),
        paidAmount: outstandingInvoices.reduce(
          (sum, row) => sum + row.paidAmount,
          0,
        ),
        returnedAmount: outstandingInvoices.reduce(
          (sum, row) => sum + row.returnedAmount,
          0,
        ),
        outstandingAmount: outstandingInvoices.reduce(
          (sum, row) => sum + row.outstandingAmount,
          0,
        ),
        count: outstandingInvoices.length,
      },
    };
  });
