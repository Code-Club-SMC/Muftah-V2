import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { supplierPayments } from "@/db/schemas/supplier-schema";
import { purchaseDateBounds } from "@/lib/suppliers/purchase-rows.server";

export const getSupplierPaginatedPaymentsFn = createServerFn()
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
    const offset = (page - 1) * limit;
    const { fromDate, toDate } = purchaseDateBounds(dateFrom, dateTo);

    const conditions = [eq(supplierPayments.supplierId, supplierId)];
    if (fromDate) conditions.push(gte(supplierPayments.paymentDate, fromDate));
    if (toDate) conditions.push(lte(supplierPayments.paymentDate, toDate));

    const whereClause = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(supplierPayments)
      .where(whereClause);

    const records = await db.query.supplierPayments.findMany({
      where: whereClause,
      with: {
        purchase: {
          with: {
            chemical: true,
            packagingMaterial: true,
          },
        },
      },
      orderBy: [
        desc(supplierPayments.paymentDate),
        desc(supplierPayments.createdAt),
        desc(supplierPayments.id),
      ],
      limit,
      offset,
    });

    return {
      data: records,
      metadata: {
        totalRecords: Number(count),
        totalPages: Math.max(1, Math.ceil(Number(count) / limit)),
        currentPage: page,
      },
    };
  });
