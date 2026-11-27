import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { notFound } from "@tanstack/react-router";
import { sql, eq, and, isNull } from "drizzle-orm";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { supplierCreditBalance } from "@/lib/suppliers/supplier-returns.server";

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

    const [totals] = await db
      .select({
        totalPurchases: sql<string>`COALESCE(SUM(${purchaseRecords.cost}), 0)`,
        totalPaid: sql<string>`COALESCE(SUM(${purchaseRecords.paidAmount}), 0)`,
        totalReturned: sql<string>`COALESCE(SUM(${purchaseRecords.returnedAmount}), 0)`,
      })
      .from(purchaseRecords)
      .where(and(eq(purchaseRecords.supplierId, data.id), isNull(purchaseRecords.voidedAt)));

    const supplierCredit = await db.transaction((tx) => supplierCreditBalance(tx, data.id));
    const totalPurchasesNum = parseFloat(String(totals.totalPurchases));
    const totalPaidNum = parseFloat(String(totals.totalPaid));
    const totalReturnedNum = parseFloat(String(totals.totalReturned));

    return {
      ...supplier,
      // What we still owe: purchases less payments less debit notes applied to them.
      balance: totalPurchasesNum - totalPaidNum - totalReturnedNum,
      totalPurchases: totalPurchasesNum,
      totalPayments: totalPaidNum,
      totalReturned: totalReturnedNum,
      supplierCredit,
    };
  });
