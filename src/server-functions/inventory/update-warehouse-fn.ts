import { createServerFn } from "@tanstack/react-start";
import { db, warehouses } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { updateWarehouseSchema } from "@/lib/validators";
import { eq } from "drizzle-orm";

export const updateWarehouseFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateWarehouseSchema)
  .handler(async ({ data }) => {
    try {
      const [result] = await db
        .update(warehouses)
        .set({
          name: data.name,
          type: data.type,
          address: data.address,
          city: data.city,
          state: data.state,
          latitude: data.latitude.toString(),
          longitude: data.longitude.toString(),
        })
        .where(eq(warehouses.id, data.id))
        .returning();

      return result;
    } catch (error) {
      console.error("DB Error:", error);
      throw new Error("Failed to update warehouse record");
    }
  });
