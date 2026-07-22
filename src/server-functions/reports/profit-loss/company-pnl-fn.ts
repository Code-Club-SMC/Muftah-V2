import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { getCompanyReportData } from "./company-reporting-core";

export const getCompanyProfitLossFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => getCompanyReportData(data));
