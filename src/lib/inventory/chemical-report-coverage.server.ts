import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import type { ChemicalReportCoverage } from "./chemical-report-contract";

export async function chemicalReportCoverage(
  chemicalIds: string[], warehouseId?: string,
): Promise<Record<string, ChemicalReportCoverage>> {
  const ids = [...new Set(chemicalIds)];
  if (!ids.length) return {};
  // Separate aggregates avoid multiplying purchases by their certificates.
  const [purchases, reports] = await Promise.all([
    db.select({
      chemicalId: purchaseRecords.chemicalId,
      purchaseCount: sql<number>`count(*)::int`,
      missingPurchaseCount: sql<number>`count(*) filter (where ${notExists(
        db.select({ id: chemicalLabReports.id }).from(chemicalLabReports)
          .where(eq(chemicalLabReports.purchaseId, purchaseRecords.id)),
      )})::int`,
    }).from(purchaseRecords).where(and(
      inArray(purchaseRecords.chemicalId, ids),
      eq(purchaseRecords.materialType, "chemical"),
      isNull(purchaseRecords.voidedAt),
      warehouseId ? eq(purchaseRecords.warehouseId, warehouseId) : undefined,
    )).groupBy(purchaseRecords.chemicalId),
    db.select({
      chemicalId: chemicalLabReports.chemicalId,
      reportCount: sql<number>`count(*)::int`,
    }).from(chemicalLabReports).where(inArray(chemicalLabReports.chemicalId, ids))
      .groupBy(chemicalLabReports.chemicalId),
  ]);
  const result: Record<string, ChemicalReportCoverage> = Object.fromEntries(
    ids.map(id => [id, { purchaseCount: 0, missingPurchaseCount: 0, reportCount: 0 }]),
  );
  for (const row of purchases) {
    if (row.chemicalId) Object.assign(result[row.chemicalId], {
      purchaseCount: Number(row.purchaseCount), missingPurchaseCount: Number(row.missingPurchaseCount),
    });
  }
  for (const row of reports) result[row.chemicalId].reportCount = Number(row.reportCount);
  return result;
}
