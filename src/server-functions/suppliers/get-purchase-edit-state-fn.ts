// src/server-functions/suppliers/get-purchase-edit-state-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, purchaseRecords } from "@/db";
import { lockMaterialStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";

export const getPurchaseEditStateFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, data.id));
    if (!purchase) throw new Error("Purchase record not found");
    const ref = purchase.materialType === "chemical"
      ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
      : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
    await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
    return { stockLocked: !(await purchaseIsUntouched(tx, purchase)) };
  }));
