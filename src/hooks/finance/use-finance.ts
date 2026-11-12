import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createExpenseFn,
  createWalletFn,
  debitWalletFn,
  deleteWalletFn,
  depositToWalletFn,
  getExpensesFn,
  getExpensesKpisFn,
  getTransactionsFn,
  getWalletsListFn,
  updateWalletFn,
} from "@/server-functions/finance-fn";
import { listCategoryDefinitionsFn } from "@/server-functions/finance/expense-categories-fn";
import { getExpenseEntryDefaultsFn } from "@/server-functions/finance/expense-entry-defaults-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
import type {
  CreateExpenseInput,
  ExpenseEntryDefaults,
  ExpenseCategoryDefinition,
  ExpenseKpis,
  ExpenseListResponse,
  FinanceDynamicFieldFilterInput,
  FinanceDynamicFieldType,
  FinanceDynamicFieldValueInput,
} from "@/lib/types/finance-types";

export type {
  CreateExpenseInput,
  ExpenseCategoryDefinition,
  ExpenseKpis,
  ExpenseListResponse,
  FinanceDynamicFieldFilterInput,
  FinanceDynamicFieldType,
  FinanceDynamicFieldValueInput,
};

type ExpenseListParams = {
  page?: number;
  limit?: number;
  offset?: number;
  categoryId?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  fieldFilters?: FinanceDynamicFieldFilterInput[];
};

type ExpenseKpiParams = {
  categoryId?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  fieldFilters?: FinanceDynamicFieldFilterInput[];
};

const EXPENSES_STALE_TIME = 30_000;

export const financeExpenseKeys = {
  all: ["expenses"] as const,
  list: (params: ExpenseListParams) =>
    [...financeExpenseKeys.all, "list", params] as const,
  kpis: (params: ExpenseKpiParams) =>
    [...financeExpenseKeys.all, "kpis", params] as const,
  entryDefaults: ["expenses", "entry-defaults"] as const,
};

export const financeExpenseCategoryKeys = {
  all: ["expense-categories"] as const,
  definitions: ["expense-categories", "definitions"] as const,
};

const normalizeExpenseListParams = (params: ExpenseListParams = {}) => {
  const {
    page = 1,
    limit = 60,
    offset,
    categoryId,
    category,
    dateFrom,
    dateTo,
    fieldFilters = [],
  } = params;

  const finalOffset = offset ?? (page - 1) * limit;

  return {
    page,
    limit,
    offset: finalOffset,
    categoryId,
    category,
    dateFrom,
    dateTo,
    fieldFilters,
  };
};

const normalizeExpenseKpiParams = (params: ExpenseKpiParams = {}) => ({
  categoryId: params.categoryId,
  category: params.category,
  dateFrom: params.dateFrom,
  dateTo: params.dateTo,
  fieldFilters: params.fieldFilters ?? [],
});

const buildExpenseListRequest = (params: ReturnType<typeof normalizeExpenseListParams>) => ({
  page: params.page,
  limit: params.limit,
  offset: params.offset,
  ...(params.categoryId ? { categoryId: params.categoryId } : {}),
  ...(params.category ? { category: params.category } : {}),
  ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
  ...(params.dateTo ? { dateTo: params.dateTo } : {}),
  ...(params.fieldFilters.length > 0 ? { fieldFilters: params.fieldFilters } : {}),
});

const buildExpenseKpiRequest = (params: ReturnType<typeof normalizeExpenseKpiParams>) => ({
  ...(params.categoryId ? { categoryId: params.categoryId } : {}),
  ...(params.category ? { category: params.category } : {}),
  ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
  ...(params.dateTo ? { dateTo: params.dateTo } : {}),
  ...(params.fieldFilters.length > 0 ? { fieldFilters: params.fieldFilters } : {}),
});

export const getExpenseCategoryDefinitionsQueryOptions = () => ({
  queryKey: financeExpenseCategoryKeys.definitions,
  queryFn: () => listCategoryDefinitionsFn() as Promise<ExpenseCategoryDefinition[]>,
  staleTime: EXPENSES_STALE_TIME,
});

export const getExpenseListQueryOptions = (params: ExpenseListParams = {}) => {
  const normalized = normalizeExpenseListParams(params);

  return {
    queryKey: financeExpenseKeys.list(normalized),
    queryFn: () =>
      getExpensesFn({
        data: buildExpenseListRequest(normalized),
      }) as Promise<ExpenseListResponse>,
    placeholderData: (prev: ExpenseListResponse | undefined) => prev,
    staleTime: EXPENSES_STALE_TIME,
  };
};

export const getExpenseKpiQueryOptions = (params: ExpenseKpiParams = {}) => {
  const normalized = normalizeExpenseKpiParams(params);

  return {
    queryKey: financeExpenseKeys.kpis(normalized),
    queryFn: () =>
      getExpensesKpisFn({
        data: buildExpenseKpiRequest(normalized),
      }) as Promise<ExpenseKpis>,
    staleTime: EXPENSES_STALE_TIME,
  };
};

export const getExpenseEntryDefaultsQueryOptions = () => ({
  queryKey: financeExpenseKeys.entryDefaults,
  queryFn: () => getExpenseEntryDefaultsFn() as Promise<ExpenseEntryDefaults>,
  staleTime: EXPENSES_STALE_TIME,
});

// ── Wallets ────────────────────────────────────────────────

export const useWallets = (options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: ["wallets"],
    queryFn: () => getWalletsListFn(),
    enabled: options?.enabled ?? true,
  });

export const useCreateWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWalletFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Account created successfully");
    },
    onError: (err: Error) => {
      const msg = err.message?.includes("Failed query")
        ? "An error occurred while creating the account. Please check your input and try again."
        : err.message;
      toast.error("Failed to create account", { description: msg });
    },
  });
};

export const useUpdateWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateWalletFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      toast.success("Wallet updated");
    },
    onError: (err: Error) =>
      toast.error("Failed to update wallet", { description: err.message }),
  });
};

export const useDeleteWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWalletFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Account deleted successfully");
    },
    onError: (err: Error) =>
      toast.error("Failed to delete account", { description: err.message }),
  });
};

// ── Deposits ───────────────────────────────────────────────

export const useDepositToWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: depositToWalletFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Deposit recorded successfully");
    },
    onError: (err: Error) =>
      toast.error("Failed to record deposit", { description: err.message }),
  });
};

// ── Expenses ───────────────────────────────────────────────

export const useExpenseCategoryDefinitions = () =>
  useQuery(getExpenseCategoryDefinitionsQueryOptions());

// Anything that moves money on an expense changes balances, lists, totals, the journal and reports.
const invalidateExpenseMoney = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ["wallets"] });
  queryClient.invalidateQueries({ queryKey: financeExpenseKeys.all });
  queryClient.invalidateQueries({ queryKey: ["transactions"] });
  queryClient.invalidateQueries({ queryKey: ["transactions-recent"] });
  queryClient.invalidateQueries({ queryKey: ["reports", "profit-loss"] });
  queryClient.invalidateQueries({ queryKey: ["reports", "expenses"] });
};

export const useCreateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createExpenseFn,
    onSuccess: () => {
      invalidateExpenseMoney(queryClient);
      toast.success("Expense recorded");
    },
    onError: (err: Error) => {
      // The form turns an overdraft refusal into the "Save anyway?" dialog. The balance the form
      // showed was out of date, so fetch the real one for that dialog.
      if (isOverdrawConfirmError(err)) {
        queryClient.invalidateQueries({ queryKey: ["wallets"] });
        return;
      }
      toast.error("Failed to record expense", { description: err.message });
    },
  });
};

export const useUpdateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateExpenseFn,
    onSuccess: (result: { changed: boolean }) => {
      invalidateExpenseMoney(queryClient);
      if (result.changed) toast.success("Expense updated");
      else toast.info("Nothing changed");
    },
    onError: (err: Error) => {
      if (isOverdrawConfirmError(err)) {
        queryClient.invalidateQueries({ queryKey: ["wallets"] });
        return;
      }
      toast.error("Failed to update expense", { description: err.message });
    },
  });
};

export const useVoidExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: voidExpenseFn,
    onSuccess: () => {
      invalidateExpenseMoney(queryClient);
      toast.success("Expense voided");
    },
    onError: (err: Error) =>
      toast.error("Failed to void expense", { description: err.message }),
  });
};

export const useExpenseEntryDefaults = (enabled = true) =>
  useQuery({ ...getExpenseEntryDefaultsQueryOptions(), enabled });

export const useExpenses = (params: ExpenseListParams = {}) =>
  useQuery(getExpenseListQueryOptions(params));

export const useExpenseKpis = (params: ExpenseKpiParams = {}) =>
  useQuery(getExpenseKpiQueryOptions(params));

// ── Transactions ───────────────────────────────────────────

export const useTransactions = (params: {
  walletId?: string;
  source?: string;
  type?: "credit" | "debit";
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
} = {}) => {
  const { walletId, source, type, dateFrom, dateTo, page = 1, limit = 20 } =
    params;

  return useQuery({
    queryKey: [
      "transactions",
      { walletId, source, type, dateFrom, dateTo, page, limit },
    ],
    queryFn: () =>
      getTransactionsFn({
        data: { walletId, source, type, dateFrom, dateTo, page, limit },
      }),
    placeholderData: (prev) => prev,
  });
};

export const useRecentTransactions = (params?: {
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}) => {
  const { limit = 10, dateFrom, dateTo } = params || {};

  return useQuery({
    queryKey: ["transactions-recent", { limit, dateFrom, dateTo }],
    queryFn: () =>
      getTransactionsFn({ data: { page: 1, limit, dateFrom, dateTo } }),
    staleTime: EXPENSES_STALE_TIME,
  });
};

// ── Generic Debit ──────────────────────────────────────────

export const useDebitWallet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: debitWalletFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err: Error) =>
      toast.error("Payment failed", { description: err.message }),
  });
};
