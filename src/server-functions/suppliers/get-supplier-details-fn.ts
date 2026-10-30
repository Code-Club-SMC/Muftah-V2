import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { notFound } from "@tanstack/react-router";
import { sql, eq } from "drizzle-orm";
import { purchaseRecords } from "@/db/schemas/supplier-schema";

export const getSupplierDetailsFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const supplier = await db.query.suppliers.findFirst({
      where: (suppliers, { eq }) => eq(suppliers.id, data.id),
    });

    if (!supplier) {
      throw notFound();
    }

    // 1. Calculate Total Purchases using Database SUM
    const purchasesResult = await db
      .select({ totalPurchases: sql<number>`COALESCE(SUM(cost), 0)` })
      .from(purchaseRecords)
      .where(eq(purchaseRecords.supplierId, data.id));

    // 2. Calculate Total Paid using paidAmount from purchaseRecords
    const paidResult = await db
      .select({ totalPaid: sql<number>`COALESCE(SUM(paid_amount), 0)` })
      .from(purchaseRecords)
      .where(eq(purchaseRecords.supplierId, data.id));

    const totalPurchasesNum = parseFloat(String(purchasesResult[0].totalPurchases));
    const totalPaidNum = parseFloat(String(paidResult[0].totalPaid));
    const balance = totalPurchasesNum - totalPaidNum;

    return {
      ...supplier,
      balance,
      totalPurchases: totalPurchasesNum,
      totalPayments: totalPaidNum,
    };
  });
