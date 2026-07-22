import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { productionRunLabReports } from "@/db/schemas/inventory-schema";
import { requireManufacturingViewMiddleware } from "@/lib/middlewares";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const getProductionLabReportsSchema = z.object({
    productionRunId: z.string().min(1),
});

export const getProductionLabReportsFn = createServerFn()
    .middleware([requireManufacturingViewMiddleware])
    .inputValidator(getProductionLabReportsSchema)
    .handler(async ({ data }) => {
        const reports = await db.query.productionRunLabReports.findMany({
            where: eq(productionRunLabReports.productionRunId, data.productionRunId),
            with: {
                createdBy: {
                    columns: { id: true, name: true },
                },
                productionRun: {
                    columns: { id: true, batchId: true },
                },
            },
            orderBy: [desc(productionRunLabReports.reportDate)],
        });

        return reports;
    });

const getProductionLabReportByIdSchema = z.object({
    reportId: z.string().min(1),
});

export const getProductionLabReportByIdFn = createServerFn()
    .middleware([requireManufacturingViewMiddleware])
    .inputValidator(getProductionLabReportByIdSchema)
    .handler(async ({ data }) => {
        const report = await db.query.productionRunLabReports.findFirst({
            where: eq(productionRunLabReports.id, data.reportId),
            with: {
                createdBy: {
                    columns: { id: true, name: true },
                },
                productionRun: {
                    columns: { id: true, batchId: true },
                },
            },
        });

        if (!report) throw new Error("Lab report not found");
        return report;
    });
