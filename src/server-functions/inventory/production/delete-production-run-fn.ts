import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
    productionRuns,
    productionMaterialsUsed,
} from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteProductionRunSchema = z.object({
    productionRunId: z.string(),
});

export const deleteProductionRunFn = createServerFn()
    .middleware([requireManufacturingRunManageMiddleware])
    .inputValidator(deleteProductionRunSchema)
    .handler(async ({ data }) => {
        const run = await db.query.productionRuns.findFirst({
            where: (runs, { eq }) => eq(runs.id, data.productionRunId),
        });

        if (!run) {
            throw new Error("Production run not found.");
        }

        // Only allow deleting scheduled or cancelled runs without extra confirmation
        // In-progress or completed runs may have material deductions
        if (run.status === "in_progress") {
            throw new Error(
                "Cannot delete a production run that is currently in progress. Please cancel it first.",
            );
        }

        if (run.status === "completed") {
            throw new Error(
                "Cannot delete a completed production run. Completed runs are part of the production audit trail.",
            );
        }

        return await db.transaction(async (tx) => {
            // Delete production materials used
            await tx
                .delete(productionMaterialsUsed)
                .where(eq(productionMaterialsUsed.productionRunId, data.productionRunId));

            // Delete the production run
            await tx
                .delete(productionRuns)
                .where(eq(productionRuns.id, data.productionRunId));

            return { success: true };
        });
    });
