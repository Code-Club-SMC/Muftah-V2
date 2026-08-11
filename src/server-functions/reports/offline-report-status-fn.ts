import { createServerFn } from "@tanstack/react-start";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { offlineSalesStagedInvoices } from "@/db/schemas/offline-sales-schema";
import { requireReportsViewMiddleware } from "@/lib/middlewares";

const REPORT_BLOCKING_STATUSES = [
  "ready",
  "warning",
  "invalid",
  "needs_review",
] as const;

export const getOfflineReportStatusFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .handler(async () => {
    const pending = await db
      .select({ id: offlineSalesStagedInvoices.id })
      .from(offlineSalesStagedInvoices)
      .where(
        inArray(offlineSalesStagedInvoices.status, REPORT_BLOCKING_STATUSES),
      )
      .limit(1);

    return { hasUnpostedOfflineInvoices: pending.length > 0 };
  });
