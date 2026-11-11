import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, purchaseRecords } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { lockMaterialStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { planPurchaseRefund } from "@/lib/suppliers/purchase-refund";
import { loadPurchasePayments } from "@/lib/suppliers/purchase-refund.server";

export const getPurchaseEditStateFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, data.id)).for("update");
    if (!purchase) throw new Error("Purchase record not found");

    const [attachedReport] = await tx
      .select({ id: chemicalLabReports.id })
      .from(chemicalLabReports)
      .where(eq(chemicalLabReports.purchaseId, purchase.id))
      .limit(1);
    const hasLabReports = Boolean(attachedReport);

    if (purchase.voidedAt) {
      return {
        stockLocked: false,
        alreadyVoided: true,
        hasLabReports,
        refund: { paid: "0.00", walletId: null },
      };
    }

    const ref = purchase.materialType === "chemical"
      ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
      : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
    await lockMaterialStock(tx, [purchase.warehouseId], [ref]);

    // Default refund for deleting this purchase, to the wallet that paid it.
    const { payments, walletIds } = await loadPurchasePayments(tx, purchase.id);
    const { paid, defaultWalletId } = planPurchaseRefund({ payments, walletIds });
    return {
      stockLocked: !(await purchaseIsUntouched(tx, purchase)),
      alreadyVoided: false,
      hasLabReports,
      refund: { paid: paid.toFixed(2), walletId: defaultWalletId },
    };
  }));
