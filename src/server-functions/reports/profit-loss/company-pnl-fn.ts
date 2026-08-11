import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { REPORT_SOURCES } from "@/lib/report-source";
import { getCompanyReportData } from "./company-reporting-core";

export const getCompanyProfitLossFn = createServerFn()
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
  .handler(async ({ data }) => getCompanyReportData(data));
