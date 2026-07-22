import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { purchaseRecords, supplierPayments } from "@/db/schemas/supplier-schema";

export const getSupplierPaginatedOutstandingFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(
    z.object({
      supplierId: z.string(),
      page: z.number().default(1),
      limit: z.number().default(25),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supplierId, page, limit, dateFrom, dateTo } = data;
    const offset = (page - 1) * limit;

    // Outstanding means cost > paidAmount
    const conditions = [
      eq(purchaseRecords.supplierId, supplierId),
      sql`${purchaseRecords.cost} > ${purchaseRecords.paidAmount}`
    ];

    if (dateFrom) {
      conditions.push(gte(purchaseRecords.purchaseDate, new Date(dateFrom)));
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(purchaseRecords.purchaseDate, toDate));
    }

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(purchaseRecords)
      .where(whereClause);

    const records = await db.query.purchaseRecords.findMany({
      where: whereClause,
      with: {
        warehouse: true,
        chemical: true,
        packagingMaterial: true,
      },
      orderBy: [desc(purchaseRecords.createdAt)],
      limit,
      offset,
    });

    const allStocks = await db.query.materialStock.findMany();

    const purchaseIds = records.map((r) => r.id);
    const relatedPayments = purchaseIds.length > 0
      ? await db.query.supplierPayments.findMany({
          where: inArray(supplierPayments.purchaseId, purchaseIds),
          orderBy: [desc(supplierPayments.createdAt)],
        })
      : [];

    const enriched = records.map((p) => {
      let stock = 0;
      let lowStock = false;
      let minStock = 0;

      if (p.chemicalId) {
        const stocks = allStocks.filter((s) => s.chemicalId === p.chemicalId);
        const rawStock = stocks.reduce(
          (sum, s) => sum + parseFloat(s.quantity),
          0,
        );
        stock = Math.max(0, rawStock);
        minStock = parseFloat(p.chemical?.minimumStockLevel || "0");
      } else if (p.packagingMaterialId) {
        const stocks = allStocks.filter(
          (s) => s.packagingMaterialId === p.packagingMaterialId,
        );
        const rawStock = stocks.reduce(
          (sum, s) => sum + parseFloat(s.quantity),
          0,
        );
        stock = Math.max(0, rawStock);
        minStock = parseFloat(
          p.packagingMaterial?.minimumStockLevel?.toString() || "0",
        );
      }

      lowStock = stock < minStock;

      const payments = relatedPayments.filter((pay) => pay.purchaseId === p.id);
      const lastPayment = payments.length > 0 ? payments[0] : null;

      return {
        ...p,
        currentStock: stock,
        isLowStock: lowStock,
        minStockLevel: minStock,
        lastPayment,
      };
    });

    return {
      data: enriched,
      metadata: {
        totalRecords: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
        currentPage: page,
      },
    };
  });
