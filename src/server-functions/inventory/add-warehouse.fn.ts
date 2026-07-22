import { createServerFn } from "@tanstack/react-start";
import { db, warehouses } from "@/db";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { addWarehouseSchema } from "@/lib/validators";

export const addWarehouseFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(addWarehouseSchema) // Cleaned up validator call
  .handler(async ({ data }) => {
    try {
      const [result] = await db
        .insert(warehouses)
        .values({
          name: data.name,
          type: data.type,
          address: data.address,
          city: data.city,
          state: data.state,
          latitude: data.latitude.toString(),
          longitude: data.longitude.toString(),
        })
        .returning();
      console.log({ result });
      return result;
    } catch (error) {
      console.error("DB Error:", error);
      throw new Error("Failed to create warehouse record");
    }
  });
