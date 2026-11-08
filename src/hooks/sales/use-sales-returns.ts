import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createSalesReturnFn,
  decideSalesReturnFn,
  completeSalesReturnFn,
  cancelSalesReturnFn,
  voidSalesReturnFn,
} from "@/server-functions/sales/sales-returns-fn";
import { getReturnReasonsFn } from "@/server-functions/sales/return-reasons-fn";
import { toast } from "sonner";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";
import type { OptionalFetcher } from "@tanstack/react-start";

// The validators accept `any`; derive their validated outputs, not their untyped inputs.
type ValidatedInput<T> = T extends OptionalFetcher<infer _Middleware, infer Validator, infer _Response>
  ? Validator extends (...args: any[]) => infer Output ? Output : never
  : never;
export type CreateSalesReturnInput = ValidatedInput<typeof createSalesReturnFn>;
type DecideInput = ValidatedInput<typeof decideSalesReturnFn>;
type CompleteInput = ValidatedInput<typeof completeSalesReturnFn>;
type CancelInput = ValidatedInput<typeof cancelSalesReturnFn>;
type VoidInput = ValidatedInput<typeof voidSalesReturnFn>;

export const salesReturnKeys = {
  all: ["sales-returns"] as const,
  invoice: (invoiceId: string) => [...salesReturnKeys.all, "invoice", invoiceId] as const,
  reasons: ["return-reasons"] as const,
};

export function useReturnReasons(enabled: boolean) {
  return useQuery({
    queryKey: salesReturnKeys.reasons,
    queryFn: () => getReturnReasonsFn({ data: { includeInactive: false } }),
    enabled,
    retry: false,
  });
}

function refreshReturn(qc: QueryClient, invoiceId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: salesReturnKeys.all }),
    qc.invalidateQueries({ queryKey: ["invoice-detail", invoiceId] }),
  ]);
}

function refreshReceipt(qc: QueryClient, invoiceId: string) {
  const prefixes = [
    "carton-availability", "cartons", "production-runs", "invoices", "customers", "sales-people",
    "distributor-profile", "shopkeeper-profile", "salesman-summary",
    "reconciliation", "credit-recovery", "slip-lookup", "overdue-slips",
    "distributor-ledger", "shopkeeper-ledger", "salesman-ledger", "salesman-shop-ledger", "reports",
  ];
  return Promise.all([
    refreshReturn(qc, invoiceId),
    invalidateStockQueries(qc),
    ...prefixes.map(prefix => qc.invalidateQueries({ queryKey: [prefix] })),
  ]);
}

export function useCreateSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSalesReturnInput) => createSalesReturnFn({ data }),
    retry: false,
    onSuccess: async (_result, variables) => {
      toast.success("Return request created. Nothing moves until receipt.");
      await refreshReturn(qc, variables.invoiceId);
    },
    onError: async (error, variables) => {
      toast.error(error.message || "Failed to request return");
      await Promise.all([
        refreshReturn(qc, variables.invoiceId),
        qc.invalidateQueries({ queryKey: salesReturnKeys.reasons }),
      ]);
    },
  });
}

export function useDecideSalesReturn(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: DecideInput) => decideSalesReturnFn({ data }),
    retry: false,
    onSuccess: async (_result, variables) => {
      toast.success(variables.action === "approve" ? "Return approved. Awaiting receipt." : "Return rejected");
      await refreshReturn(qc, invoiceId);
    },
    onError: async error => {
      toast.error(error.message || "Failed to decide return");
      await refreshReturn(qc, invoiceId);
    },
  });
}

export function useCompleteSalesReturn(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CompleteInput) => completeSalesReturnFn({ data }),
    retry: false,
    onSuccess: async () => {
      toast.success("Return received. Stock and outstanding amount updated.");
      await refreshReceipt(qc, invoiceId);
    },
    onError: async error => {
      toast.error(error.message || "Failed to receive return");
      await refreshReturn(qc, invoiceId);
    },
  });
}

export function useCancelSalesReturn(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CancelInput) => cancelSalesReturnFn({ data }),
    retry: false,
    onSuccess: async () => {
      toast.success("Unreceived return cancelled");
      await refreshReturn(qc, invoiceId);
    },
    onError: async error => {
      toast.error(error.message || "Failed to cancel return");
      await refreshReturn(qc, invoiceId);
    },
  });
}

export function useVoidSalesReturn(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: VoidInput) => voidSalesReturnFn({ data }),
    retry: false,
    onSuccess: async () => {
      toast.success("Receipt voided. Stock and credit reversed.");
      await refreshReceipt(qc, invoiceId);
    },
    onError: async error => {
      toast.error(error.message || "Failed to void receipt");
      await refreshReturn(qc, invoiceId);
    },
  });
}
