/**
 * Automated overdue detection for outstanding invoices.
 * Scans all non-closed slips whose Payment Due Date has passed
 * and marks them as overdue.
 */

import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { customers, invoices } from "@/db/schemas/sales-schema";
import { slipRecords } from "@/db/schemas/sales-erp-schema";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";
import { requireSalesManageMiddleware } from "@/lib/middlewares";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Marks all past-due, non-closed slips as overdue.
 * Returns the number of slips updated and a list of affected invoice IDs.
 *
 * This function is safe to run repeatedly (idempotent): slips already marked
 * overdue will not be touched again unless their status was changed away.
 */
export const updateOverdueSlipsFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<{ updatedCount: number; updatedSlipIds: string[] }> => {
    const userId = context.session.user.id;
    const userName = context.session.user.name ?? "System";

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return await db.transaction(async (tx) => {
      // Find non-closed slips whose Payment Due Date is before today.
      // This must join invoices explicitly so the due-date filter is in scope.
      const overdueSlips = await tx
        .select({
          id: slipRecords.id,
          slipNumber: slipRecords.slipNumber,
          invoiceId: slipRecords.invoiceId,
          recoveryStatus: slipRecords.recoveryStatus,
          customerId: slipRecords.customerId,
          customerName: customers.name,
          paymentDueDate: invoices.paymentDueDate,
        })
        .from(slipRecords)
        .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
        .leftJoin(customers, eq(slipRecords.customerId, customers.id))
        .where(
          and(
            ne(slipRecords.status, "closed"),
            lt(invoices.paymentDueDate, todayStart),
          ),
        );

      const updatedIds: string[] = [];

      for (const slip of overdueSlips) {
        // Only update if not already overdue
        if (slip.recoveryStatus === "overdue") continue;

        await tx
          .update(slipRecords)
          .set({
            recoveryStatus: "overdue",
            updatedAt: new Date(),
          })
          .where(eq(slipRecords.id, slip.id));

        if (slip.invoiceId) {
          await recordInvoiceTimelineEvent(
            {
              invoiceId: slip.invoiceId,
              eventType: "status_change",
              title: "Marked overdue",
              description: `Outstanding invoice ${slip.slipNumber} for ${slip.customerName ?? "customer"} was automatically marked overdue after the Payment Due Date (${slip.paymentDueDate?.toISOString().split("T")[0] ?? "unknown"}).`,
              metadata: {
                slipId: slip.id,
                slipNumber: slip.slipNumber,
                previousStatus: slip.recoveryStatus,
                newStatus: "overdue",
                automatic: true,
              },
              actorId: userId,
              actorName: userName,
            },
            tx,
          );
        }

        updatedIds.push(slip.id);
      }

      return {
        updatedCount: updatedIds.length,
        updatedSlipIds: updatedIds,
      };
    });
  });

/**
 * Returns how many slips would be marked overdue without actually updating them.
 */
export const previewOverdueSlipsFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: any) => z.object({}).parse(input))
  .handler(async (): Promise<{ overdueCount: number }> => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(slipRecords)
      .innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))
      .where(
        and(
          ne(slipRecords.status, "closed"),
          lt(invoices.paymentDueDate, todayStart),
          ne(slipRecords.recoveryStatus, "overdue"),
        ),
      );

    return { overdueCount: Number(result.count) || 0 };
  });
