import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { notFound } from "@tanstack/react-router";
import { sql, desc, eq } from "drizzle-orm";
import { purchaseRecords, supplierPayments } from "@/db/schemas/supplier-schema";

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

    // Fetch the 5 most recent purchases for the overview
    const recentPurchases = await db.query.purchaseRecords.findMany({
      where: (purchases, { eq }) => eq(purchases.supplierId, data.id),
      orderBy: [desc(purchaseRecords.createdAt)],
      limit: 5,
      with: {
        warehouse: true,
        chemical: true,
        packagingMaterial: true,
      }
    });

    // Fetch the 5 most recent payments for the overview
    const recentPayments = await db.query.supplierPayments.findMany({
      where: (payments, { eq }) => eq(payments.supplierId, data.id),
      orderBy: [desc(supplierPayments.createdAt)],
      limit: 5,
      with: {
        purchase: {
          with: { chemical: true, packagingMaterial: true }
        }
      }
    });

    // Note: We don't enrich the mini-overview perfectly, or maybe we do.
    // For now we just return them and let the client-side DataTable display it seamlessly without stock data.
    // OR we can fetch stock data for recent 5 if needed. Lets keep it simple.

    return {
      ...supplier,
      balance,
      totalPurchases: totalPurchasesNum,
      totalPayments: totalPaidNum,
      purchases: recentPurchases,
      payments: recentPayments,
    };
  });
