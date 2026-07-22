import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const deleteProductSchema = z.object({
  id: z.string(),
});

export const deleteProductFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(deleteProductSchema)
  .handler(async ({ data }) => {
    await db.delete(products).where(eq(products.id, data.id));
    return { success: true };
  });
