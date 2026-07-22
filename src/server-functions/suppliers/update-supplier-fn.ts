import { createServerFn } from "@tanstack/react-start";
import { db, suppliers } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { updateSupplierSchema } from "@/lib/validators";
import { eq } from "drizzle-orm";

export const updateSupplierFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(updateSupplierSchema)
  .handler(async ({ data }) => {
    try {
      const [updatedSupplier] = await db
        .update(suppliers)
        .set({
          supplierName: data.supplierName,
          supplierShopName: data.supplierShopName,
          email: data.email || null,
          phone: data.phone,
          nationalId: data.nationalId || null,
          address: data.address,
          city: data.city,
          state: data.state,
          notes: data.notes,
        })
        .where(eq(suppliers.id, data.id))
        .returning();
      return updatedSupplier;
    } catch (error) {
      console.error("Failed to update supplier:", error);
      throw new Error("Failed to update supplier");
    }
  });
