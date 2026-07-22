import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { products } from "@/db/schemas/inventory-schema";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";

const addProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export const addProductFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(addProductSchema)
  .handler(async ({ data }) => {
    const [newProduct] = await db
      .insert(products)
      .values({
        name: data.name,
        description: data.description,
      })
      .returning();

    return newProduct;
  });
