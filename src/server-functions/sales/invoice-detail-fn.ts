/**
 * Rich invoice detail with timeline, payments, slip, and returns.
 */

import { createServerFn } from "@tanstack/react-start";
import { invoices } from "@/db/schemas/sales-schema";
import {
  creditRecoveryAttempts,
  invoiceTimelineEvents,
  payments,
  salesReturns,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import { requireSalesViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

function serializeForServer<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export const getInvoiceDetailFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ invoiceId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<any> => {
    const { db } = await import("@/db");
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, data.invoiceId),
      with: {
        customer: true,
        salesman: { columns: { id: true, name: true } },
        warehouse: { columns: { id: true, name: true } },
        performer: { columns: { id: true, name: true } },
        order: { columns: { id: true, billNumber: true, shopkeeperName: true } },
        orderBooker: { columns: { id: true, name: true } },
        items: {
          with: {
            recipe: { columns: { id: true, name: true } },
            discountRule: { columns: { id: true, ruleType: true } },
          },
        },
      },
    });

    if (!invoice) throw new Error("Invoice not found");

    const [paymentsList, slip, returns, timeline] = await Promise.all([
      db.query.payments.findMany({
        where: eq(payments.invoiceId, data.invoiceId),
        orderBy: [desc(payments.paymentDate)],
        with: {
          recordedBy: { columns: { id: true, name: true } },
          confirmedBy: { columns: { id: true, name: true } },
          resolvedBy: { columns: { id: true, name: true } },
          wallet: { columns: { id: true, name: true, type: true } },
        },
      }),
      db.query.slipRecords.findFirst({
        where: eq(slipRecords.invoiceId, data.invoiceId),
        with: {
          recoveryAssignedTo: { columns: { id: true, name: true } },
          recoveryAttempts: {
            with: { assignedTo: { columns: { id: true, name: true } } },
            orderBy: [desc(creditRecoveryAttempts.attemptedAt)],
          },
        },
      }),
      db.query.salesReturns.findMany({
        where: eq(salesReturns.invoiceId, data.invoiceId),
        with: {
          items: {
            with: {
              invoiceItem: { columns: { id: true, pack: true } },
              recipe: { columns: { id: true, name: true } },
            },
          },
          stockTraces: {
            with: {
              recipe: { columns: { id: true, name: true } },
              warehouse: { columns: { id: true, name: true } },
            },
          },
          approvedBy: { columns: { id: true, name: true } },
        },
        orderBy: [desc(salesReturns.returnDate)],
      }),
      db.query.invoiceTimelineEvents.findMany({
        where: eq(invoiceTimelineEvents.invoiceId, data.invoiceId),
        orderBy: [desc(invoiceTimelineEvents.eventDate), desc(invoiceTimelineEvents.createdAt)],
        with: { actor: { columns: { id: true, name: true } } },
      }),
    ]);

    return serializeForServer({
      invoice,
      payments: paymentsList,
      slip,
      returns,
      timeline,
    });
  });
