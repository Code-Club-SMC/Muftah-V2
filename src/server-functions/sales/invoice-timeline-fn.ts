/**
 * Invoice timeline event recorder.
 * Creates an immutable audit trail of everything that happens to an invoice.
 */

import { createServerFn } from "@tanstack/react-start";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireSalesViewMiddleware } from "@/lib/middlewares";
import { invoiceTimelineEvents } from "@/db/schemas/sales-erp-schema";

export const getInvoiceTimelineFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) =>
    z.object({ invoiceId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const events = await db.query.invoiceTimelineEvents.findMany({
      where: eq(invoiceTimelineEvents.invoiceId, data.invoiceId),
      orderBy: [desc(invoiceTimelineEvents.eventDate), desc(invoiceTimelineEvents.createdAt)],
      with: {
        actor: { columns: { id: true, name: true } },
      },
    });
    return events.map((e) => ({
      ...e,
      metadata: e.metadata ? JSON.stringify(e.metadata) : null,
    }));
  });
