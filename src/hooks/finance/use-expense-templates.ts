import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getExpenseDateRangeFilters } from "@/lib/finance-expenses";
import { getTemplateWindow, toDayKey } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import {
  archiveExpenseTemplateFn,
  listExpenseTemplatesFn,
  saveExpenseTemplateFn,
  skipExpenseTemplateMonthFn,
} from "@/server-functions/finance/expense-templates-fn";

export const expenseTemplateKeys = {
  all: ["expenses", "templates"] as const,
  list: (todayKey: string) => ["expenses", "templates", todayKey] as const,
};

export const useExpenseTemplates = (enabled = true) => {
  const todayKey = toDayKey(new Date());
  return useQuery({
    queryKey: expenseTemplateKeys.list(todayKey),
    queryFn: () => {
      const { dateFrom, dateTo } = getExpenseDateRangeFilters(getTemplateWindow(todayKey));
      return listExpenseTemplatesFn({ data: { windowFrom: dateFrom!, windowTo: dateTo! } }) as Promise<ExpenseTemplate[]>;
    },
    enabled,
    staleTime: 30_000,
  });
};

const useTemplateMutation = <TInput,>(fn: (input: { data: TInput }) => Promise<unknown>, success: string, failure: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseTemplateKeys.all });
      toast.success(success);
    },
    onError: (err: Error) => toast.error(failure, { description: err.message }),
  });
};

export const useSaveExpenseTemplate = () =>
  useTemplateMutation(saveExpenseTemplateFn, "Template saved", "Failed to save template");
export const useArchiveExpenseTemplate = () =>
  useTemplateMutation(archiveExpenseTemplateFn, "Template deleted", "Failed to delete template");
export const useSkipExpenseTemplateMonth = () =>
  useTemplateMutation(skipExpenseTemplateMonthFn, "Skipped for this month", "Failed to skip");
