import { createServerFn } from "@tanstack/react-start";
import { requireDashboardViewMiddleware } from "@/lib/middlewares";
import { db } from "@/db";
import { invoices } from "@/db/schemas/sales-schema";
import { productionRuns } from "@/db/schemas/inventory-schema";
import { payslips } from "@/db/schemas/hr-schema";
import { expenses } from "@/db/schemas/finance-schema";
import { desc } from "drizzle-orm";

export const getDashboardLastUpdateFn = createServerFn()
  .middleware([requireDashboardViewMiddleware])
  .handler(async () => {
    // Check the latest `updatedAt` / `createdAt` across key entities
    const [latestInvoice, latestRun, latestPayslip, latestExpense] =
      await Promise.all([
        db
          .select({ ts: invoices.createdAt })
          .from(invoices)
          .orderBy(desc(invoices.createdAt))
          .limit(1),
        db
          .select({ ts: productionRuns.updatedAt })
          .from(productionRuns)
          .orderBy(desc(productionRuns.updatedAt))
          .limit(1),
        db
          .select({ ts: payslips.createdAt })
          .from(payslips)
          .orderBy(desc(payslips.createdAt))
          .limit(1),
        db
          .select({ ts: expenses.createdAt })
          .from(expenses)
          .orderBy(desc(expenses.createdAt))
          .limit(1),
      ]);

    const timestamps = [
      latestInvoice[0]?.ts,
      latestRun[0]?.ts,
      latestPayslip[0]?.ts,
      latestExpense[0]?.ts,
    ].filter(Boolean) as Date[];

    // Return the most recent timestamp across all entities
    const lastUpdated =
      timestamps.length > 0
        ? new Date(Math.max(...timestamps.map((d) => new Date(d).getTime())))
        : new Date(0);

    return { lastUpdated: lastUpdated.toISOString() };
  });
