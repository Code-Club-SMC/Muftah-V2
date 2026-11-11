import { createServerFn } from "@tanstack/react-start";
import {
  db,
  suppliers,
  purchaseRecords,
  supplierPayments,
  chemicals,
  packagingMaterials,
} from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { eq } from "drizzle-orm";
import { z } from "zod";

class SupplierDeleteBlockedError extends Error {}

export const deleteSupplierFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    let deletedSupplier: {
      id: string;
      supplierName: string;
      supplierShopName: string | null;
      email: string | null;
      phone: string | null;
      city: string | null;
      state: string | null;
    };

    try {
      deletedSupplier = await db.transaction(async (tx) => {
        const [supplier] = await tx
          .select({
            id: suppliers.id,
            supplierName: suppliers.supplierName,
            supplierShopName: suppliers.supplierShopName,
            email: suppliers.email,
            phone: suppliers.phone,
            city: suppliers.city,
            state: suppliers.state,
          })
          .from(suppliers)
          .where(eq(suppliers.id, data.id))
          .for("update");

        if (!supplier) {
          throw new SupplierDeleteBlockedError("Supplier not found");
        }

        const [existingPurchase] = await tx
          .select({ id: purchaseRecords.id })
          .from(purchaseRecords)
          .where(eq(purchaseRecords.supplierId, data.id))
          .limit(1);
        if (existingPurchase) {
          throw new SupplierDeleteBlockedError(
            "Cannot delete supplier because it has purchase records. Delete unused purchases first.",
          );
        }

        const [existingPayment] = await tx
          .select({ id: supplierPayments.id })
          .from(supplierPayments)
          .where(eq(supplierPayments.supplierId, data.id))
          .limit(1);
        if (existingPayment) {
          throw new SupplierDeleteBlockedError(
            "Cannot delete supplier because it has recorded payment records.",
          );
        }

        await tx
          .update(chemicals)
          .set({ lastSupplierId: null, updatedAt: new Date() })
          .where(eq(chemicals.lastSupplierId, data.id));

        await tx
          .update(packagingMaterials)
          .set({ lastSupplierId: null, updatedAt: new Date() })
          .where(eq(packagingMaterials.lastSupplierId, data.id));

        await tx.delete(suppliers).where(eq(suppliers.id, data.id));

        return supplier;
      });
    } catch (error) {
      if (error instanceof SupplierDeleteBlockedError) {
        throw error;
      }
      if ((error as { code?: string } | null)?.code === "23503") {
        throw new Error(
          "Cannot delete supplier because it is still referenced by other records.",
        );
      }
      console.error("Failed to delete supplier:", error);
      throw new Error("Failed to delete supplier");
    }

    await logActivityQuiet({
      module: "suppliers",
      action: "deleted",
      entityType: "supplier",
      entityId: deletedSupplier.id,
      entityLabel: deletedSupplier.supplierName,
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Deleted supplier ${deletedSupplier.supplierName}`,
      severity: "warning",
      metadata: {
        supplierId: deletedSupplier.id,
        supplierName: deletedSupplier.supplierName,
        supplierShopName: deletedSupplier.supplierShopName,
        phone: deletedSupplier.phone,
        email: deletedSupplier.email,
        city: deletedSupplier.city,
        state: deletedSupplier.state,
      },
    });

    return { success: true };
  });
