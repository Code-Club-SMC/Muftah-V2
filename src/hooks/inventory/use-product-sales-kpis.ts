import { useQuery } from "@tanstack/react-query";
import { getProductSalesKpisFn } from "@/server-functions/inventory/products/get-product-sales-kpis-fn";
import type { DateRange } from "react-day-picker";

export function useProductSalesKpis(dateRange: DateRange | undefined) {
  return useQuery({
    queryKey: ["product-sales-kpis", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: () =>
      getProductSalesKpisFn({
        data: {
          dateFrom: dateRange?.from ? dateRange.from.toISOString() : undefined,
          dateTo: dateRange?.to ? dateRange.to.toISOString() : undefined,
        },
      }),
    enabled: !!dateRange?.from,
  });
}
