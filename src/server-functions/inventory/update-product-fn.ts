import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const updateProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export const updateProductFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(updateProductSchema)
  .handler(async ({ data }) => {
    const [updatedProduct] = await db
      .update(products)
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date(),
      })
      .where(eq(products.id, data.id))
      .returning();

    return updatedProduct;
  });
