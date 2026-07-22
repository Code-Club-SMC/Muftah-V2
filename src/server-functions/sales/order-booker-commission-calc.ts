import { db } from "@/db";
import { commissionTiers, commissionRecords, orderBookers } from "@/db/schemas/sales-erp-schema";
import { eq, and, isNull } from "drizzle-orm";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";

export async function calculateCommissionForOrder(
  tx: any,
  orderBookerId: string,
  orderId: string,
  fulfilledAmount: number,
) {
  const dbOrTx = tx || db;

  // 1. Try order-booker-specific tiers first
  let tiers = await dbOrTx.query.commissionTiers.findMany({
    where: and(
      eq(commissionTiers.orderBookerId, orderBookerId),
      eq(commissionTiers.isActive, true),
    ),
    orderBy: [commissionTiers.minAmount],
  });

  // 2. Fall back to global tiers if no booker-specific tiers
  if (tiers.length === 0) {
    tiers = await dbOrTx.query.commissionTiers.findMany({
      where: and(
        isNull(commissionTiers.orderBookerId),
        eq(commissionTiers.isActive, true),
      ),
      orderBy: [commissionTiers.minAmount],
    });
  }

  let flatRate = 0;
  if (tiers.length === 0) {
    const ob = await dbOrTx.query.orderBookers.findFirst({
      where: eq(orderBookers.id, orderBookerId),
    });
    flatRate = parseFloat(ob?.commissionRate ?? "0");
  }

  const commissionResult = calculateOrderBookerCommission({
    fulfilledAmount,
    tiers,
    flatRate,
  });

  await dbOrTx
    .insert(commissionRecords)
    .values({
      orderBookerId,
      orderId,
      fulfilledAmount: fulfilledAmount.toString(),
      appliedRate: commissionResult.rate.toString(),
      commissionAmount: commissionResult.amount.toFixed(2),
      status: "accrued",
    })
    .onConflictDoNothing({
      target: [commissionRecords.orderBookerId, commissionRecords.orderId],
    });

  const record = await dbOrTx.query.commissionRecords.findFirst({
    where: and(
      eq(commissionRecords.orderBookerId, orderBookerId),
      eq(commissionRecords.orderId, orderId),
    ),
  });

  return record;
}
