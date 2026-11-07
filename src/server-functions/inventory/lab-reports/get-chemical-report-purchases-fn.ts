import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chemicals, chemicalLabReports } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { suppliers } from "@/db/schemas/core-suppliers";
import { requireInventoryViewMiddleware } from "@/lib/middlewares";
import type { ChemicalReportPurchase } from "@/lib/inventory/chemical-report-contract";

export const getChemicalReportPurchasesFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator(z.object({ chemicalId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ChemicalReportPurchase[]> => db.select({
    purchaseId: purchaseRecords.id,
    chemicalId: chemicals.id,
    chemicalName: chemicals.name,
    supplierName: suppliers.supplierName,
    purchaseDate: purchaseRecords.purchaseDate,
    quantity: purchaseRecords.quantity,
    unit: chemicals.unit,
    voidedAt: purchaseRecords.voidedAt,
    reportCount: sql<number>`(select count(*)::int from ${chemicalLabReports}
      where ${chemicalLabReports.purchaseId} = ${purchaseRecords.id})`,
  }).from(purchaseRecords)
    .innerJoin(chemicals, eq(purchaseRecords.chemicalId, chemicals.id))
    .innerJoin(suppliers, eq(purchaseRecords.supplierId, suppliers.id))
    .where(and(eq(purchaseRecords.chemicalId, data.chemicalId), eq(purchaseRecords.materialType, "chemical")))
    .orderBy(desc(purchaseRecords.purchaseDate), desc(purchaseRecords.createdAt), desc(purchaseRecords.id)));
