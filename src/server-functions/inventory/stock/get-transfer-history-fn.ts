import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db, stockTransfers, warehouses, user } from "@/db";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";

const getTransferHistorySchema = z.object({
  materialType: z.enum(["chemical", "packaging", "finished"]),
  materialId: z.string(),
  limit: z.number().optional().default(10),
});

export const getTransferHistoryFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator(getTransferHistorySchema)
  .handler(async ({ data }) => {
    const history = await db.query.stockTransfers.findMany({
      where: and(
        eq(stockTransfers.materialType, data.materialType),
        eq(stockTransfers.materialId, data.materialId),
      ),
      orderBy: [desc(stockTransfers.createdAt)],
      limit: data.limit,
      with: {
        fromWarehouse: {
          columns: {
            name: true,
            id: true,
          },
        },
        toWarehouse: {
          columns: {
            name: true,
            id: true,
          },
        },
        performedBy: {
          columns: {
            name: true,
          },
        },
      },
    });

    return history;
  });
