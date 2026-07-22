import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { invoices, invoiceItems, customers } from "@/db/schemas/sales-schema";
import { z } from "zod";
import { and, eq, gte, lte, desc, inArray } from "drizzle-orm";
import { parseISO, isValid, endOfDay } from "date-fns";

export const getSalesReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const conditions = [inArray(invoices.status, ["saved", "paid", "partially_paid"])];

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
        sNo: invoices.sNo,
        date: invoices.date,
        customerName: customers.name,
        customerType: customers.customerType,
        cash: invoices.cash,
        credit: invoices.credit,
        totalPrice: invoices.totalPrice,
        expenses: invoices.expenses,
        slipNumber: invoices.slipNumber,
        remarks: invoices.remarks,
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
      .orderBy(desc(invoices.date));

    // Group by invoice
    const invoiceMap = new Map<string, any>();
    for (const row of rows) {
      if (!invoiceMap.has(row.invoiceId)) {
        invoiceMap.set(row.invoiceId, {
          invoiceId: row.invoiceId,
          sNo: row.sNo,
          date: row.date,
          customerName: row.customerName,
          customerType: row.customerType,
          cash: Number(row.cash),
          credit: Number(row.credit),
          totalPrice: Number(row.totalPrice),
          expenses: Number(row.expenses),
          slipNumber: row.slipNumber,
          remarks: row.remarks,
          items: [],
        });
      }
      invoiceMap.get(row.invoiceId).items.push({
        pack: row.itemPack,
        cartons: row.itemCartons,
        units: row.itemUnits,
        perCartonPrice: Number(row.itemPerCartonPrice),
        amount: Number(row.itemAmount),
        hsnCode: row.itemHsnCode,
      });
    }

    const invoicesList = Array.from(invoiceMap.values());
    const totalCash = invoicesList.reduce((s, i) => s + i.cash, 0);
    const totalCredit = invoicesList.reduce((s, i) => s + i.credit, 0);
    const totalRevenue = invoicesList.reduce((s, i) => s + i.totalPrice, 0);
    const totalExpenses = invoicesList.reduce((s, i) => s + i.expenses, 0);

    return {
      invoices: invoicesList,
      summary: { totalCash, totalCredit, totalRevenue, totalExpenses, count: invoicesList.length },
    };
  });
