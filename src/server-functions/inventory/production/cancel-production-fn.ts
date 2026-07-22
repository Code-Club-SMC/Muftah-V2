import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productionRuns } from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";

const cancelProductionSchema = z.object({
  productionRunId: z.string().min(1, "Production run ID is required"),
  reason: z.string().optional(),
});

export const cancelProductionFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(cancelProductionSchema)
  .handler(async ({ data }) =>
    db.transaction(async (tx) => {
      const run = await tx.query.productionRuns.findFirst({
        where: eq(productionRuns.id, data.productionRunId),
      });

      if (!run) {
        throw new Error("Production run not found");
      }

      if (run.status !== "scheduled") {
        throw new Error(
          "Only scheduled production runs can be cancelled. In-progress runs must be managed from the operator screen.",
        );
      }

      await tx
        .update(productionRuns)
        .set({
          status: "cancelled",
          actualCompletionDate: new Date(),
          notes: data.reason
            ? run.notes
              ? `${run.notes}\n\n[CANCELLED]: ${data.reason}`
              : `[CANCELLED]: ${data.reason}`
            : run.notes,
        })
        .where(eq(productionRuns.id, run.id));

      return {
        success: true,
        status: "cancelled" as const,
      };
    }),
  );
