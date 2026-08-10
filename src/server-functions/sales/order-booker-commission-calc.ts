import {
  commissionTiers,
  commissionRecords,
  orderBookers,
} from "@/db/schemas/sales-erp-schema";
import { eq, and, isNull } from "drizzle-orm";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";
import type { SalesTransaction } from "./settlement-service";

export async function calculateCommissionForOrder(
  tx: SalesTransaction,
  orderBookerId: string,
  orderId: string,
  fulfilledAmount: number,
) {
  // 1. Try order-booker-specific tiers first
  let tiers = await tx.query.commissionTiers.findMany({
    where: and(
      eq(commissionTiers.orderBookerId, orderBookerId),
      eq(commissionTiers.isActive, true),
    ),
    orderBy: [commissionTiers.minAmount],
  });

  // 2. Fall back to global tiers if no booker-specific tiers
  if (tiers.length === 0) {
    tiers = await tx.query.commissionTiers.findMany({
      where: and(
        isNull(commissionTiers.orderBookerId),
        eq(commissionTiers.isActive, true),
      ),
      orderBy: [commissionTiers.minAmount],
    });
  }

  let flatRate = 0;
  if (tiers.length === 0) {
    const ob = await tx.query.orderBookers.findFirst({
      where: eq(orderBookers.id, orderBookerId),
    });
    flatRate = parseFloat(ob?.commissionRate ?? "0");
  }

  const commissionResult = calculateOrderBookerCommission({
    fulfilledAmount,
    tiers,
    flatRate,
  });

  await tx
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

  const record = await tx.query.commissionRecords.findFirst({
    where: and(
      eq(commissionRecords.orderBookerId, orderBookerId),
      eq(commissionRecords.orderId, orderId),
    ),
  });

  return record;
}
