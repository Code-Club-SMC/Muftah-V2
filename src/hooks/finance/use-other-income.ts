import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import {
  createOtherIncomeFn,
  getOtherIncomeFn,
  getOtherIncomeItemNamesFn,
  voidOtherIncomeFn,
} from "@/server-functions/finance/other-income-fn";

export const otherIncomeKeys = {
  all: ["other-income"] as const,
  month: (month: string) => ["other-income", "month", month] as const,
  items: ["other-income", "items"] as const,
};

export const useOtherIncome = (month: string) =>
  useQuery({
    queryKey: otherIncomeKeys.month(month),
    queryFn: () => getOtherIncomeFn({ data: { month } }),
  });

export const useOtherIncomeItemNames = () =>
  useQuery({
    queryKey: otherIncomeKeys.items,
    queryFn: () => getOtherIncomeItemNamesFn(),
  });

/** Income moves account balances and feeds the monthly report, so refresh both. */
function useRefreshAfterIncomeChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: otherIncomeKeys.all }),
      invalidateFinanceQueries(queryClient),
    ]);
}

export const useCreateOtherIncome = () => {
  const refresh = useRefreshAfterIncomeChange();
  return useMutation({
    mutationFn: createOtherIncomeFn,
    onSuccess: () => {
      void refresh();
      toast.success("Income recorded");
    },
    onError: (err: Error) => toast.error("Failed to record income", { description: err.message }),
  });
};

export const useVoidOtherIncome = () => {
  const refresh = useRefreshAfterIncomeChange();
  return useMutation({
    mutationFn: voidOtherIncomeFn,
    onSuccess: () => {
      void refresh();
      toast.success("Income voided");
    },
    onError: (err: Error) => toast.error("Failed to void income", { description: err.message }),
  });
};
