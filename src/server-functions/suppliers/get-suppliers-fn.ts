import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireSuppliersViewMiddleware } from "@/lib/middlewares";

export const getSuppliersFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .handler(async () => {
    const suppliersData = await db.query.suppliers.findMany({
      orderBy: (suppliers, { desc }) => [desc(suppliers.createdAt)],
      with: {
        purchases: true,
        payments: true,
      },
    });

    return suppliersData.map((supplier) => {
      const active = supplier.purchases.filter((purchase) => !purchase.voidedAt);
      const totalPurchases = active.reduce(
        (acc, p) => acc + parseFloat(p.cost),
        0,
      );
      const totalPayments = active.reduce(
        (acc, p) => acc + parseFloat(p.paidAmount || "0"),
        0,
      );
      const balance = totalPurchases - totalPayments;

      return {
        ...supplier,
        totalPurchases,
        totalPayments,
        balance,
      };
    });
  });
