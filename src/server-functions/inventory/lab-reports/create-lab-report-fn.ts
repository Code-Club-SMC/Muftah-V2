import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const analysisItemSchema = z.object({
    item: z.string().min(1, "Analysis item name is required"),
    requirement: z.string().min(1, "Requirement/standard is required"),
    result: z.string().min(1, "Result is required"),
    passed: z.boolean(),
});

const createLabReportSchema = z.object({
    chemicalId: z.string().min(1),
    productName: z.string().min(1, "Product name is required"),
    stockNumber: z.string().optional(),
    lotNumber: z.string().optional(),
    analysisItems: z
        .array(analysisItemSchema)
        .min(1, "At least one analysis item is required"),
    certifiedBy: z.string().min(1, "Certifier name is required"),
    certifierTitle: z.string().optional(),
    reportDate: z.string().min(1, "Report date is required"),
    standardReference: z.string().optional(),
    notes: z.string().optional(),
});

export const createLabReportFn = createServerFn()
    .middleware([requireInventoryManageMiddleware])
    .inputValidator(createLabReportSchema)
    .handler(async ({ data, context }) => {
        const [report] = await db
            .insert(chemicalLabReports)
            .values({
                chemicalId: data.chemicalId,
                productName: data.productName,
                stockNumber: data.stockNumber || null,
                lotNumber: data.lotNumber || null,
                analysisItems: data.analysisItems,
                certifiedBy: data.certifiedBy,
                certifierTitle: data.certifierTitle || null,
                reportDate: new Date(data.reportDate),
                standardReference: data.standardReference || null,
                notes: data.notes || null,
                createdById: context.session.user.id,
            })
            .returning();

        return report;
    });
