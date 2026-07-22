import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { productionRunLabReports } from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";

const deleteProductionLabReportSchema = z.object({
    reportId: z.string().min(1),
});

export const deleteProductionLabReportFn = createServerFn()
    .middleware([requireManufacturingRunManageMiddleware])
    .inputValidator(deleteProductionLabReportSchema)
    .handler(async ({ data }) => {
        await db
            .delete(productionRunLabReports)
            .where(eq(productionRunLabReports.id, data.reportId));

        return { success: true };
    });
