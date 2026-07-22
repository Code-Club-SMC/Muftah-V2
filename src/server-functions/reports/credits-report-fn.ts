import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { invoices, customers } from "@/db/schemas/sales-schema";
import { slipRecords, salesmen } from "@/db/schemas/sales-erp-schema";
import { z } from "zod";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { parseISO, isValid, endOfDay } from "date-fns";

export const getCreditsReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const conditions = [];

    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(slipRecords.issuedAt, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(slipRecords.issuedAt, endOfDay(to)));
    }

    const rows = await db
      .select({
        slipId: slipRecords.id,
        slipNumber: slipRecords.slipNumber,
        issuedAt: slipRecords.issuedAt,
        status: slipRecords.status,
        recoveryStatus: slipRecords.recoveryStatus,
        amountDue: slipRecords.amountDue,
        amountRecovered: slipRecords.amountRecovered,
        customerName: customers.name,
        customerType: customers.customerType,
        salesmanName: salesmen.name,
        invoiceDate: invoices.date,
        invoiceTotal: invoices.totalPrice,
        escalationLevel: slipRecords.escalationLevel,
        nextFollowUpDate: slipRecords.nextFollowUpDate,
        reconciledAt: slipRecords.reconciledAt,
      })
      .from(slipRecords)
      .innerJoin(customers, eq(slipRecords.customerId, customers.id))
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .leftJoin(salesmen, eq(slipRecords.salesmanId, salesmen.id))
      .where(and(...conditions))
      .orderBy(desc(slipRecords.issuedAt));

    const totalDue = rows.reduce((s, r) => s + Number(r.amountDue), 0);
    const totalRecovered = rows.reduce((s, r) => s + Number(r.amountRecovered), 0);
    const outstanding = totalDue - totalRecovered;

    return {
      slips: rows.map((r) => ({
        ...r,
        amountDue: Number(r.amountDue),
        amountRecovered: Number(r.amountRecovered),
        invoiceTotal: Number(r.invoiceTotal),
        escalationLevel: Number(r.escalationLevel),
      })),
      summary: { totalDue, totalRecovered, outstanding, count: rows.length },
    };
  });
