import { eq, sql } from "drizzle-orm";
import { orders } from "@/db/schemas/sales-erp-schema";

export const MAX_BILL_NUMBER_RETRIES = 5;
export const ORDER_BILL_NUMBER_CONSTRAINT =
  "uq_orders_order_booker_bill_number";

export function isOrderBillNumberUniqueViolation(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes(ORDER_BILL_NUMBER_CONSTRAINT)
  );
}

export async function allocateNextBillNumberInTx(
  tx: any,
  orderBookerId: string,
) {
  const [{ nextBillNumber }] = await tx
    .select({
      nextBillNumber: sql<number>`coalesce(max(${orders.billNumber}), 0) + 1`,
    })
    .from(orders)
    .where(eq(orders.orderBookerId, orderBookerId));

  return Number(nextBillNumber) || 1;
}
