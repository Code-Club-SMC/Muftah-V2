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
    let previousName: string | null = null;
    let updatedSupplier: typeof suppliers.$inferSelect | undefined;

    try {
      const [existing] = await db
        .select({ supplierName: suppliers.supplierName })
        .from(suppliers)
        .where(eq(suppliers.id, data.id))
        .limit(1);
      previousName = existing?.supplierName ?? null;

      [updatedSupplier] = await db
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
    } catch (error) {
      console.error("Failed to update supplier:", error);
      throw new Error("Failed to update supplier");
    }

    if (!updatedSupplier) {
      throw new Error("Supplier not found");
    }

    await logActivityQuiet({
      module: "suppliers",
      action: "updated",
      entityType: "supplier",
      entityId: updatedSupplier.id,
      entityLabel: updatedSupplier.supplierName,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Updated supplier ${updatedSupplier.supplierName}`,
      severity: "info",
      metadata: {
        supplierId: updatedSupplier.id,
        supplierName: updatedSupplier.supplierName,
        previousSupplierName: previousName,
        supplierShopName: updatedSupplier.supplierShopName,
        phone: updatedSupplier.phone,
        email: updatedSupplier.email,
        city: updatedSupplier.city,
        state: updatedSupplier.state,
      },
    });

    return updatedSupplier;
  });
