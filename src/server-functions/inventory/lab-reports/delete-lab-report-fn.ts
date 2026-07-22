import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";

const deleteLabReportSchema = z.object({
    reportId: z.string().min(1),
});

export const deleteLabReportFn = createServerFn()
    .middleware([requireInventoryManageMiddleware])
    .inputValidator(deleteLabReportSchema)
    .handler(async ({ data }) => {
        await db
            .delete(chemicalLabReports)
            .where(eq(chemicalLabReports.id, data.reportId));

        return { success: true };
    });
