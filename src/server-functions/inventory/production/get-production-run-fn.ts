import { createServerFn } from "@tanstack/react-start";
import { desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  productionRuns,
  chemicals,
  packagingMaterials,
  productionProgressLogs,
} from "@/db";
import { requireAuthMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";

export const getProductionRunsFn = createServerFn()
  .middleware([requireAuthMiddleware])
  .inputValidator(
    z
      .object({
        filter: z.enum(["active"]).optional(),
        runId: z.string().optional(),
      })
      .optional(),
  )
  .handler(async ({ data, context }) => {
    const permissions = context.authContext.permissions;
    const canViewManufacturing =
      hasPermission(permissions, "manufacturing.view") ||
      hasPermission(permissions, "manufacturing.run.read");
    const canViewOperator =
      hasPermission(permissions, "operator.view") ||
      hasPermission(permissions, "operator.run.read");

    if (!canViewManufacturing && !canViewOperator) {
      throw new Error("You do not have permission to view production runs.");
    }

    const operatorOnlyAccess = canViewOperator && !canViewManufacturing;
    let whereClause: SQL | undefined;

    if (data?.runId) {
      // Specific Run (Any Status)
      whereClause = eq(productionRuns.id, data.runId);
    } else if (data?.filter === "active" || operatorOnlyAccess) {
      // Active Runs Only
      whereClause = eq(productionRuns.status, "in_progress");
    }

    const runs = await db.query.productionRuns.findMany({
      ...(whereClause ? { where: whereClause } : {}),
      orderBy: [desc(productionRuns.createdAt)],
      with: {
        recipe: {
          with: {
            product: true,
            ingredients: {
              with: {
                chemical: true,
              },
            },
            packaging: {
              with: {
                packagingMaterial: true,
              },
            },
            containerPackaging: true,
            cartonPackaging: true,
          },
        },
        warehouse: true,
        operator: true,
        initiator: true,
        materialsUsed: true,
      },
      limit: data?.runId ? 1 : operatorOnlyAccess ? 25 : 10,
    });

    // Fetch all materials to map names
    const allChemicals = await db
      .select({ id: chemicals.id, name: chemicals.name })
      .from(chemicals);
    const allPackaging = await db
      .select({ id: packagingMaterials.id, name: packagingMaterials.name })
      .from(packagingMaterials);

    const chemicalMap = new Map(allChemicals.map((c) => [c.id, c.name]));
    const packagingMap = new Map(allPackaging.map((p) => [p.id, p.name]));

    // Enrich materialsUsed with names
    const enrichedRuns = runs.map((run) => ({
      ...run,
      materialsUsed:
        run.materialsUsed?.map((mu) => ({
          ...mu,
          materialName:
            mu.materialType === "chemical"
              ? chemicalMap.get(mu.materialId) || "Unknown Chemical"
              : packagingMap.get(mu.materialId) || "Unknown Packaging",
        })) || [],
    }));

    if (!data?.runId || enrichedRuns.length === 0) {
      return enrichedRuns;
    }

    const latestLog = await db.query.productionProgressLogs.findFirst({
      where: eq(productionProgressLogs.productionRunId, enrichedRuns[0].id),
      orderBy: [desc(productionProgressLogs.createdAt), desc(productionProgressLogs.id)],
    });

    return enrichedRuns.map((run) => ({
      ...run,
      latestProgressLog: latestLog && latestLog.productionRunId === run.id ? latestLog : null,
    }));
  });
