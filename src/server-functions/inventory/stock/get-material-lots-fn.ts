import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { listLotBalances, lockMaterialStock } from "@/lib/inventory/material-lots.server";
import type { LotBalance } from "@/lib/inventory/material-lots";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

export const getMaterialLotsFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .inputValidator(z.object({ warehouseId: z.string().min(1), materialType: z.enum(["chemical", "packaging"]), materialIds: z.array(z.string().min(1)).min(1).max(100) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const refs = data.materialIds.map((materialId) => ({ materialType: data.materialType, materialId }));
    // Locking also turns stock from before lots into opening lots, so the picker shows it.
    await lockMaterialStock(tx, [data.warehouseId], refs);
    const result: Record<string, LotBalance[]> = {};
    for (const ref of refs) result[ref.materialId] = await listLotBalances(tx, data.warehouseId, ref);
    return result;
  }));
