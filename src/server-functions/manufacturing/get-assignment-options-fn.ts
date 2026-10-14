import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { getProductionOperators } from "@/lib/production/operator-assignment.server";
import { warehouses } from "@/db/schemas/inventory-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { and, asc, eq } from "drizzle-orm";

export const getManufacturingAssignmentOptionsFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .handler(async () => {
    const [factoryFloors, operators] = await Promise.all([
      db.select({ id: warehouses.id, name: warehouses.name })
        .from(warehouses)
        .where(and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true)))
        .orderBy(asc(warehouses.name)),
      getProductionOperators(db),
    ]);
    return { factoryFloors, operators };
  });
