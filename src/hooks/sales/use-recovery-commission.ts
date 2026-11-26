import { useQuery } from "@tanstack/react-query";
import { getPaymentCommissionFn } from "@/server-functions/sales/payment-settlement-fn";
import { getBookerCommissionMonthFn, getCommissionMonthSummaryFn } from "@/server-functions/sales/recovery-commission-fn";

export function useCommissionMonthSummary(month: string) {
  return useQuery({
    queryKey: ["recovery-commission", "summary", month],
    queryFn: () => getCommissionMonthSummaryFn({ data: { month } }),
  });
}

export function useBookerCommissionMonth(orderBookerId: string, month: string) {
  return useQuery({
    queryKey: ["recovery-commission", "booker", orderBookerId, month],
    queryFn: () => getBookerCommissionMonthFn({ data: { orderBookerId, month } }),
    enabled: Boolean(orderBookerId),
  });
}

export function usePaymentCommission(paymentId: string | null) {
  return useQuery({
    queryKey: ["recovery-commission", "payment", paymentId],
    queryFn: () => getPaymentCommissionFn({ data: { paymentId: paymentId as string } }),
    enabled: Boolean(paymentId),
  });
}
