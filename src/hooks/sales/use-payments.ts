import { useQuery } from "@tanstack/react-query";
import { getPaymentsFn } from "@/server-functions/sales/payments-fn";

export const paymentsKeys = {
  all: ["payments"] as const,
  list: (filters: any) => ["payments", "list", filters] as const,
};

export function useGetPayments(filters: {
  customerId?: string;
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: paymentsKeys.list(filters),
    queryFn: () => getPaymentsFn({ data: filters }),
  });
}
