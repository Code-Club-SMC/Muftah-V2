import { createServerFn } from "@tanstack/react-start";
import { db, suppliers } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { supplierSchema } from "@/lib/validators";
import { logActivityQuiet } from "@/lib/activity-logger.server";

export const addSupplierFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(supplierSchema)
  .handler(async ({ data, context }) => {
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

      void logActivityQuiet({
        module: "suppliers",
        action: "created",
        entityType: "supplier",
        entityLabel: newSupplier.supplierName,
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `Created new supplier ${newSupplier.supplierName}`,
        severity: "info",
      });

      return newSupplier;
    } catch (error) {
      console.error("Failed to add supplier:", error);
      throw new Error("Failed to add supplier");
    }
  });
