import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockOwnedLabReport } from "@/lib/inventory/lab-report-ownership.server";

const deleteLabReportSchema = z.object({
    reportId: z.string().min(1),
});

export const deleteLabReportFn = createServerFn({ method: "POST" })
    .middleware([requireInventoryManageMiddleware])
    .inputValidator(deleteLabReportSchema)
    .handler(async ({ data }) => {
      return db.transaction(async tx => {
        await lockOwnedLabReport(tx, data.reportId, { allowVoided: true });
        await tx
            .delete(chemicalLabReports)
            .where(eq(chemicalLabReports.id, data.reportId));

        return { success: true };
      });
    });
