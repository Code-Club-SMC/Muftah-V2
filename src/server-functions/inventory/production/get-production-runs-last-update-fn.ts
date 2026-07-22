import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { productionRuns } from "@/db/schemas/inventory-schema";
import { desc } from "drizzle-orm";

export const getProductionRunsLastUpdateFn = createServerFn().handler(
  async () => {
    const [result] = await db
      .select({ updatedAt: productionRuns.updatedAt })
      .from(productionRuns)
      .orderBy(desc(productionRuns.updatedAt))
      .limit(1);

    return { lastUpdated: result?.updatedAt || null };
  },
);
