import { createServerFn } from "@tanstack/react-start";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { db } from "@/db";
import { formulas, mixingRuns } from "@/db/schemas/production-schema";
import { productionRuns, warehouses } from "@/db/schemas/inventory-schema";
import { getProductionOperators } from "@/lib/production/operator-assignment.server";
import { generateNextBatchId } from "@/lib/production/batch-id";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { loadMixingStockRequirements } from "@/lib/production/mixing-stock.server";

const createMixingRunSchema = z.object({
  formulaId: z.string().min(1, "Mixing Formula ID is required"),
  warehouseId: z.string().min(1, "Warehouse ID is required"),
  operatorId: z.string().min(1, "Operator ID is required"),
  scheduledStartDate: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const createMixingRunFn = createServerFn({ method: "POST" })
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(createMixingRunSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // The advisory lock serializes the shared A-series counter across mixing creates.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('mixing_batch_id'))`,
      );

      const [formula] = await tx
        .select()
        .from(formulas)
        .where(eq(formulas.id, data.formulaId))
        .for("share");

      if (!formula || !formula.isActive) {
        throw new Error("Active mixing formula not found");
      }
      if (
        !Number.isFinite(Number(formula.batchSize)) ||
        Number(formula.batchSize) <= 0
      ) {
        throw new Error("Mixing formula must have a positive batch size");
      }

      const [warehouse] = await tx
        .select({
          id: warehouses.id,
          type: warehouses.type,
          isActive: warehouses.isActive,
        })
        .from(warehouses)
        .where(eq(warehouses.id, data.warehouseId))
        .limit(1)
        .for("share");
      if (
        !warehouse ||
        !warehouse.isActive ||
        warehouse.type !== "factory_floor"
      ) {
        throw new Error("An active factory floor warehouse is required");
      }
      const [operator] = await getProductionOperators(tx, data.operatorId);
      if (!operator) throw new Error("An active operator is required");

      const { shortages } = await loadMixingStockRequirements(
        tx,
        formula.id,
        warehouse.id,
      );
      if (shortages.length) return { success: false as const, shortages };

      // Query BOTH productionRuns and mixingRuns to find the highest Axxxx batch ID
      const [lastLegacyRun] = await tx
        .select({ batchId: productionRuns.batchId })
        .from(productionRuns)
        .where(sql`${productionRuns.batchId} ~ '^A[0-9]+$'`)
        .orderBy(desc(sql`substring(${productionRuns.batchId} from 2)::bigint`))
        .limit(1);

      const [lastMixingRun] = await tx
        .select({ batchId: mixingRuns.batchId })
        .from(mixingRuns)
        .where(sql`${mixingRuns.batchId} ~ '^A[0-9]+$'`)
        .orderBy(desc(sql`substring(${mixingRuns.batchId} from 2)::bigint`))
        .limit(1);

      let lastBatchId: string | null = null;
      if (lastLegacyRun && lastMixingRun) {
        lastBatchId =
          Number(lastLegacyRun.batchId.slice(1)) >
          Number(lastMixingRun.batchId.slice(1))
            ? lastLegacyRun.batchId
            : lastMixingRun.batchId;
      } else if (lastLegacyRun) {
        lastBatchId = lastLegacyRun.batchId;
      } else if (lastMixingRun) {
        lastBatchId = lastMixingRun.batchId;
      }

      const batchId = generateNextBatchId(lastBatchId || null);

      const targetBulkQuantity = formula.batchSize.toString();
      const bulkUnit = formula.batchUnit;

      const [mixingRun] = await tx
        .insert(mixingRuns)
        .values({
          batchId,
          formulaId: data.formulaId,
          warehouseId: data.warehouseId,
          operatorId: data.operatorId,
          initiatorId: context.session.user.id,
          targetBulkQuantity,
          bulkUnit,
          status: "scheduled",
          scheduledStartDate: data.scheduledStartDate || new Date(),
          notes: data.notes,
        })
        .returning();

      logActivityQuiet({
        module: "manufacturing",
        action: "created",
        entityType: "mixing_run",
        entityLabel: batchId,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Created mixing batch ${batchId} for mixing formula ${formula.name}`,
      });

      return { success: true as const, mixingRun };
    });
  });
