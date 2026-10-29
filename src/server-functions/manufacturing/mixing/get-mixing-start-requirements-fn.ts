import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mixingRuns } from "@/db/schemas/production-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { loadMixingStockRequirements } from "@/lib/production/mixing-stock.server";

// The chemicals and amounts a scheduled batch takes, so the operator can pick lots before starting.
export const getMixingStartRequirementsFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(z.object({ mixingRunId: z.string().min(1) }))
  .handler(({ data }) =>
    db.transaction(async (tx) => {
      const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId));
      if (!run) throw new Error("Mixing batch not found");
      const { materials } = await loadMixingStockRequirements(tx, run.formulaId, run.warehouseId);
      return {
        warehouseId: run.warehouseId,
        materials: materials.map(({ chemicalId, name, unit, quantity }) => ({ chemicalId, name, unit, quantity })),
      };
    }),
  );
