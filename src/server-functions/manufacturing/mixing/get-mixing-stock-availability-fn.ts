import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import Big from "big.js";
import { db } from "@/db";
import { formulas } from "@/db/schemas/production-schema";
import { warehouses } from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { loadMixingStockRequirements } from "@/lib/production/mixing-stock.server";

export const getMixingStockAvailabilityFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(
    z.object({ formulaId: z.string().min(1), warehouseId: z.string().min(1) }),
  )
  .handler(async ({ data }) =>
    db.transaction(async (tx) => {
      const [formula] = await tx
        .select()
        .from(formulas)
        .where(eq(formulas.id, data.formulaId))
        .for("share");
      if (!formula?.isActive)
        throw new Error("Active mixing formula not found");
      if (
        !Number.isFinite(Number(formula.batchSize)) ||
        !new Big(formula.batchSize).gt(0)
      ) {
        throw new Error("Mixing formula must have a positive batch size");
      }
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, data.warehouseId))
        .for("share");
      if (!warehouse?.isActive || warehouse.type !== "factory_floor") {
        throw new Error("An active factory floor warehouse is required");
      }
      const { shortages } = await loadMixingStockRequirements(
        tx,
        formula.id,
        warehouse.id,
      );
      return { shortages };
    }),
  );
