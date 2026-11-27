import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, purchaseRecords } from "@/db";
import { chemicalLabReports, chemicals, packagingMaterials } from "@/db/schemas/inventory-schema";
import { packagingUnit } from "@/lib/inventory/material-units";
import type { MaterialRef } from "@/lib/inventory/material-lots";
import { lockMaterialStock, purchaseIsUntouched, type Tx } from "@/lib/inventory/material-lots.server";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { planPurchaseRefund } from "@/lib/suppliers/purchase-refund";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
import { loadPurchasePayments } from "@/lib/suppliers/purchase-refund.server";
import { activeReturnMessage, activeReturnNumber, creditUsedOnPurchase } from "@/lib/suppliers/supplier-returns.server";

async function materialUnit(tx: Tx, ref: MaterialRef) {
  if (ref.materialType === "chemical") {
    const [row] = await tx.select({ unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, ref.materialId));
    return row?.unit || "kg";
  }
  const [row] = await tx.select({ measuredInKg: packagingMaterials.measuredInKg }).from(packagingMaterials).where(eq(packagingMaterials.id, ref.materialId));
  return packagingUnit(row);
}

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
        unused: undefined,
        alreadyVoided: true,
        hasLabReports,
        activeReturn: null,
        creditGivenBack: "0.00",
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
    const stockLocked = !(await purchaseIsUntouched(tx, purchase));
    // What a price correction would still reach.
    const unused = stockLocked
      ? { quantity: (await purchaseStockLeft(tx, [purchase])).get(purchase.id) ?? 0, unit: await materialUnit(tx, ref) }
      : undefined;
    // A purchase with an open supplier return can't be edited or deleted.
    const returnNumber = await activeReturnNumber(tx, purchase.id);
    // Supplier credit spent on this purchase goes back to the supplier if it is deleted.
    const { total: creditUsed } = await creditUsedOnPurchase(tx, purchase.id);
    return {
      stockLocked,
      unused,
      alreadyVoided: false,
      hasLabReports,
      activeReturn: returnNumber ? { returnNumber, message: activeReturnMessage(returnNumber) } : null,
      creditGivenBack: creditUsed.toFixed(2),
      refund: { paid: paid.toFixed(2), walletId: defaultWalletId },
    };
  }));
