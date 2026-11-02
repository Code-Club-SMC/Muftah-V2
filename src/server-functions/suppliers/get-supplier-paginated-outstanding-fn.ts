import { createServerFn } from "@tanstack/react-start";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import {
  purchaseDateBounds,
  purchasesPageByMaterial,
  withStockLeft,
} from "@/lib/suppliers/purchase-rows.server";

export const getSupplierPaginatedOutstandingFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(
    z.object({
      supplierId: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(100),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supplierId, page, limit, dateFrom, dateTo } = data;
    const { fromDate, toDate } = purchaseDateBounds(dateFrom, dateTo);

    // Outstanding means cost > paidAmount
    const conditions = [
      eq(purchaseRecords.supplierId, supplierId),
      sql`${purchaseRecords.cost} > ${purchaseRecords.paidAmount}`,
    ];
    if (fromDate) conditions.push(gte(purchaseRecords.purchaseDate, fromDate));
    if (toDate) conditions.push(lte(purchaseRecords.purchaseDate, toDate));

    const whereClause = and(...conditions);

    const { records, metadata } = await purchasesPageByMaterial(whereClause, page, limit);

    return { data: await withStockLeft(records), metadata };
  });
