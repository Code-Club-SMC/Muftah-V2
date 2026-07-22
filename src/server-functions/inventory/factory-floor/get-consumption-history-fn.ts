import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { productionMaterialsUsed, productionRuns } from "@/db/schemas/inventory-schema";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";
import { desc, count, inArray, ilike } from "drizzle-orm";
import { z } from "zod";

export const getConsumptionHistoryFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .inputValidator(
    z.object({
      search: z.string().optional(),
      pageIndex: z.number().default(0),
      pageSize: z.number().default(10),
    })
  )
  .handler(async ({ data }) => {
    const { search, pageIndex, pageSize } = data;
    // Determine the optional WHERE condition for searching by batch ID
    const searchCondition = search
      ? inArray(
          productionMaterialsUsed.productionRunId,
          db
            .select({ id: productionRuns.id })
            .from(productionRuns)
            .where(ilike(productionRuns.batchId, `%${search}%`))
        )
      : undefined;

    // Fetch the total count for the filtered dataset
    const [{ totalCount }] = await db
      .select({ totalCount: count() })
      .from(productionMaterialsUsed)
      .where(searchCondition);

    // Fetch the paginated consumption records
    const history = await db.query.productionMaterialsUsed.findMany({
      where: searchCondition,
      orderBy: [desc(productionMaterialsUsed.createdAt)],
      with: {
        chemical: true,
        packagingMaterial: true,
        productionRun: {
          with: {
            recipe: true,
          },
        },
      },
      limit: pageSize,
      offset: pageIndex * pageSize,
    });

    return { data: history, totalCount };
  });
