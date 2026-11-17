import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { reportDateKey } from "@/lib/report-dates";
import { loadMonthlyReport, loadMonthlyReportDetail } from "./monthly-report-queries.server";

export const getMonthlyReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator(z.object({ startYear: z.number().int().min(2000).max(2100) }))
  .handler(({ data }) => loadMonthlyReport(data.startYear, reportDateKey(new Date())));

export const getMonthlyReportDetailFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator(
    z.object({
      line: z.string().min(1).max(80),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month"),
    }),
  )
  .handler(({ data }) => loadMonthlyReportDetail(data.line, data.month));
