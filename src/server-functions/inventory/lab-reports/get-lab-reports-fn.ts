import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const getLabReportsSchema = z.object({
    chemicalId: z.string().min(1),
});

export const getLabReportsFn = createServerFn()
    .middleware([requireInventoryViewMiddleware])
    .inputValidator(getLabReportsSchema)
    .handler(async ({ data }) => {
        const reports = await db.query.chemicalLabReports.findMany({
            where: eq(chemicalLabReports.chemicalId, data.chemicalId),
            with: {
                createdBy: {
                    columns: { id: true, name: true },
                },
                chemical: {
                    columns: { id: true, name: true, unit: true },
                },
            },
            orderBy: [desc(chemicalLabReports.reportDate)],
        });

        return reports;
    });

const getLabReportByIdSchema = z.object({
    reportId: z.string().min(1),
});

export const getLabReportByIdFn = createServerFn()
    .middleware([requireInventoryViewMiddleware])
    .inputValidator(getLabReportByIdSchema)
    .handler(async ({ data }) => {
        const report = await db.query.chemicalLabReports.findFirst({
            where: eq(chemicalLabReports.id, data.reportId),
            with: {
                createdBy: {
                    columns: { id: true, name: true },
                },
                chemical: {
                    columns: { id: true, name: true, unit: true },
                },
            },
        });

        if (!report) throw new Error("Lab report not found");
        return report;
    });
