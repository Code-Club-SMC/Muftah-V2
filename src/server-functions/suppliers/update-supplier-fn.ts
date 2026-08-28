import { createServerFn } from "@tanstack/react-start";
import { db, suppliers } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { updateSupplierSchema } from "@/lib/validators";
import { eq } from "drizzle-orm";
import { logActivityQuiet } from "@/lib/activity-logger.server";

export const updateSupplierFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(updateSupplierSchema)
  .handler(async ({ data, context }) => {
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

      void logActivityQuiet({
        module: "suppliers",
        action: "updated",
        entityType: "supplier",
        entityLabel: updatedSupplier.supplierName,
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `Updated supplier ${updatedSupplier.supplierName}`,
        severity: "info",
      });

      return updatedSupplier;
    } catch (error) {
      console.error("Failed to update supplier:", error);
      throw new Error("Failed to update supplier");
    }
  });
