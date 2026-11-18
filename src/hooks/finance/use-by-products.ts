import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import {
  createByProductSaleFn,
  getByProductsFn,
  voidByProductSaleFn,
} from "@/server-functions/finance/by-products-fn";

export const byProductKeys = {
  all: ["by-products"] as const,
  month: (month: string) => ["by-products", "month", month] as const,
};

export const useByProducts = (month: string) =>
  useQuery({
    queryKey: byProductKeys.month(month),
    queryFn: () => getByProductsFn({ data: { month } }),
  });

/** Sales move account balances and feed the monthly report, so refresh both. */
function useRefreshAfterSaleChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: byProductKeys.all }),
      invalidateFinanceQueries(queryClient),
    ]);
}

export const useCreateByProductSale = () => {
  const refresh = useRefreshAfterSaleChange();
  return useMutation({
    mutationFn: createByProductSaleFn,
    onSuccess: () => {
      void refresh();
      toast.success("Sale recorded");
    },
    onError: (err: Error) => toast.error("Failed to record sale", { description: err.message }),
  });
};

export const useVoidByProductSale = () => {
  const refresh = useRefreshAfterSaleChange();
  return useMutation({
    mutationFn: voidByProductSaleFn,
    onSuccess: () => {
      void refresh();
      toast.success("Sale voided");
    },
    onError: (err: Error) => toast.error("Failed to void sale", { description: err.message }),
  });
};
