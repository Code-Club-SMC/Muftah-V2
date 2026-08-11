import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { endOfDay, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES, type ReportSource } from "@/lib/report-source";

type SalesReportInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  date: Date;
  customerName: string;
  customerType: string;
  source: Exclude<ReportSource, "all">;
  paidAmount: number;
  outstandingAmount: number;
  totalPrice: number;
  items: Array<{
    pack: string;
    cartons: number;
    units: number;
    perCartonPrice: number;
    amount: number;
    hsnCode: string;
  }>;
};

export const getSalesReportFn = createServerFn()
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
    const conditions = [ne(invoices.status, "voided")];

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
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        date: invoices.date,
        customerName: customers.name,
        customerType: customers.customerType,
        source: invoices.source,
        paidAmount: invoices.paidAmount,
        outstandingAmount: invoices.outstandingAmount,
        totalPrice: invoices.totalPrice,
        itemPack: invoiceItems.pack,
        itemCartons: invoiceItems.numberOfCartons,
        itemUnits: invoiceItems.quantity,
        itemPerCartonPrice: invoiceItems.perCartonPrice,
        itemAmount: invoiceItems.amount,
        itemHsnCode: invoiceItems.hsnCode,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
      .where(and(...conditions))
      .orderBy(desc(invoices.date), desc(invoices.id));

    const invoiceMap = new Map<string, SalesReportInvoice>();
    for (const row of rows) {
      let invoice = invoiceMap.get(row.invoiceId);
      if (!invoice) {
        invoice = {
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          date: row.date,
          customerName: row.customerName,
          customerType: row.customerType,
          source: row.source,
          paidAmount: Number(row.paidAmount),
          outstandingAmount: Number(row.outstandingAmount),
          totalPrice: Number(row.totalPrice),
          items: [],
        };
        invoiceMap.set(row.invoiceId, invoice);
      }

      invoice.items.push({
        pack: row.itemPack,
        cartons: row.itemCartons,
        units: row.itemUnits,
        perCartonPrice: Number(row.itemPerCartonPrice),
        amount: Number(row.itemAmount),
        hsnCode: row.itemHsnCode,
      });
    }

    const invoiceList = Array.from(invoiceMap.values());
    return {
      invoices: invoiceList,
      summary: {
        paidAmount: invoiceList.reduce((sum, row) => sum + row.paidAmount, 0),
        outstandingAmount: invoiceList.reduce(
          (sum, row) => sum + row.outstandingAmount,
          0,
        ),
        totalRevenue: invoiceList.reduce((sum, row) => sum + row.totalPrice, 0),
        count: invoiceList.length,
      },
    };
  });
