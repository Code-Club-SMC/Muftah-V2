import { eq } from "drizzle-orm";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import type { Tx } from "./material-lots.server";

export async function lockChemicalReportPurchase(
  tx: Tx,
  purchaseId: string,
  chemicalId: string,
  options?: { allowVoided?: boolean },
) {
  const [purchase] = await tx.select().from(purchaseRecords)
    .where(eq(purchaseRecords.id, purchaseId)).for("update");
  if (!purchase) throw new Error("Purchase record not found");
  if (purchase.materialType !== "chemical" || purchase.chemicalId !== chemicalId) {
    throw new Error("Purchase does not belong to this chemical");
  }
  if (purchase.voidedAt && !options?.allowVoided) {
    throw new Error("Cannot change reports for a voided purchase");
  }
  return purchase;
}

export async function lockOwnedLabReport(
  tx: Tx,
  reportId: string,
  options?: { allowVoided?: boolean },
) {
  const original = await tx.query.chemicalLabReports.findFirst({ where: eq(chemicalLabReports.id, reportId) });
  if (!original) throw new Error("Lab report not found");
  // Purchase delete/void also locks the purchase. Always acquire it before any report write lock.
  if (original.purchaseId) {
    await lockChemicalReportPurchase(tx, original.purchaseId, original.chemicalId, options);
  }
  const [report] = await tx.select().from(chemicalLabReports)
    .where(eq(chemicalLabReports.id, reportId)).for("update");
  if (!report) throw new Error("Lab report not found");
  if (report.purchaseId !== original.purchaseId || report.chemicalId !== original.chemicalId) {
    throw new Error("Lab report ownership changed");
  }
  return report;
}
