import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { suppliers } from "@/db/schemas/core-suppliers";
import { warehouses, chemicals, packagingMaterials } from "@/db/schemas/inventory-schema";
import { z } from "zod";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { reportDateBounds } from "@/lib/report-dates";

export const getPurchasesReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { fromDate, toDate } = reportDateBounds(data);
    const conditions = [];

    if (fromDate) {
      conditions.push(gte(purchaseRecords.purchaseDate, fromDate));
    }
    if (toDate) {
      conditions.push(lte(purchaseRecords.purchaseDate, toDate));
    }

    const rows = await db
      .select({
        purchaseId: purchaseRecords.id,
        purchaseDate: purchaseRecords.purchaseDate,
        invoiceNumber: purchaseRecords.invoiceNumber,
        supplierName: suppliers.supplierName,
        supplierShopName: suppliers.supplierShopName,
        warehouseName: warehouses.name,
        materialType: purchaseRecords.materialType,
        chemicalName: chemicals.name,
        packagingName: packagingMaterials.name,
        quantity: purchaseRecords.quantity,
        unitCost: purchaseRecords.unitCost,
        cost: purchaseRecords.cost,
        paidAmount: purchaseRecords.paidAmount,
        paymentMethod: purchaseRecords.paymentMethod,
        notes: purchaseRecords.notes,
        chemicalUnit: chemicals.unit,
        packagingUnit: packagingMaterials.capacityUnit,
      })
      .from(purchaseRecords)
      .innerJoin(suppliers, eq(purchaseRecords.supplierId, suppliers.id))
      .innerJoin(warehouses, eq(purchaseRecords.warehouseId, warehouses.id))
      .leftJoin(chemicals, eq(purchaseRecords.chemicalId, chemicals.id))
      .leftJoin(packagingMaterials, eq(purchaseRecords.packagingMaterialId, packagingMaterials.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseRecords.purchaseDate));

    const totalCost = rows.reduce((s, r) => s + Number(r.cost), 0);
    const totalPaid = rows.reduce((s, r) => s + Number(r.paidAmount), 0);
    const totalOutstanding = totalCost - totalPaid;

    return {
      purchases: rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        unitCost: Number(r.unitCost),
        cost: Number(r.cost),
        paidAmount: Number(r.paidAmount),
        materialName: r.chemicalName || r.packagingName || "Unknown",
        unit: r.chemicalUnit || r.packagingUnit || "units",
      })),
      summary: { totalCost, totalPaid, totalOutstanding, count: rows.length },
    };
  });
