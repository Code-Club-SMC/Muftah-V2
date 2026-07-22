import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { supplierPayments } from "@/db/schemas/supplier-schema";

export const getSupplierPaginatedPaymentsFn = createServerFn()
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

    const conditions = [eq(supplierPayments.supplierId, supplierId)];

    if (dateFrom) {
      conditions.push(gte(supplierPayments.paymentDate, new Date(dateFrom)));
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(supplierPayments.paymentDate, toDate));
    }

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
      orderBy: [desc(supplierPayments.createdAt)],
      limit,
      offset,
    });

    return {
      data: records,
      metadata: {
        totalRecords: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
        currentPage: page,
      },
    };
  });
