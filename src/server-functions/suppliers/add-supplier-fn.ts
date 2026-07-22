import { createServerFn } from "@tanstack/react-start";
import { db, suppliers } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { supplierSchema } from "@/lib/validators";

export const addSupplierFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(supplierSchema)
  .handler(async ({ data }) => {
    try {
      const [newSupplier] = await db
        .insert(suppliers)
        .values({
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
        .returning();
      return newSupplier;
    } catch (error) {
      console.error("Failed to add supplier:", error);
      throw new Error("Failed to add supplier");
    }
  });
