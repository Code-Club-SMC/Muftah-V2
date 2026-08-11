import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { postOfflineSalesBatchFn } from "@/server-functions/sales/offline-post-fn";
import {
  acknowledgeOfflineSalesWarningFn,
  excludeOfflineSalesInvoiceFn,
  getOfflineSalesBatchFn,
  listOfflineSalesImportBatchesFn,
  listOfflineSalesReplacementWalletsFn,
  refreshOfflineSalesPreviewFn,
  replaceOfflineSalesWalletFn,
  resolveOfflineSalesOrderConflictFn,
} from "@/server-functions/sales/offline-review-fn";
import {
  listStockReconciliationIssuesFn,
  resolveStockReconciliationIssueFn,
} from "@/server-functions/sales/offline-stock-reconciliation-fn";
import { uploadOfflineSalesWorkbookFn } from "@/server-functions/sales/offline-upload-fn";
import {
  downloadOfflineSalesWorkbookFn,
  forceRetireOfflineSalesWorkbookFn,
  issueOfflineSalesWorkbookFn,
  listOfflineSalesOperatorsFn,
  listOfflineSalesWorkbooksFn,
  replaceOfflineSalesWorkbookFn,
} from "@/server-functions/sales/offline-workbooks-fn";

export const offlineSalesKeys = {
  all: ["offline-sales"] as const,
  workbooks: () => [...offlineSalesKeys.all, "workbooks"] as const,
  operators: () => [...offlineSalesKeys.all, "operators"] as const,
  history: () => [...offlineSalesKeys.all, "history"] as const,
  batches: () => [...offlineSalesKeys.all, "batch"] as const,
  batch: (batchId: string) => [...offlineSalesKeys.batches(), batchId] as const,
  wallets: () => [...offlineSalesKeys.all, "replacement-wallets"] as const,
  stockIssues: (status: "open" | "resolved" | "all") =>
    [...offlineSalesKeys.all, "stock-issues", status] as const,
};

export const offlineSalesQueries = {
  workbooks: () =>
    queryOptions({
      queryKey: offlineSalesKeys.workbooks(),
      queryFn: () => listOfflineSalesWorkbooksFn(),
      staleTime: 15_000,
    }),
  operators: () =>
    queryOptions({
      queryKey: offlineSalesKeys.operators(),
      queryFn: () => listOfflineSalesOperatorsFn(),
      staleTime: 60_000,
    }),
  history: () =>
    queryOptions({
      queryKey: offlineSalesKeys.history(),
      queryFn: () => listOfflineSalesImportBatchesFn(),
      staleTime: 10_000,
    }),
  batch: (batchId: string) =>
    queryOptions({
      queryKey: offlineSalesKeys.batch(batchId),
      queryFn: () => getOfflineSalesBatchFn({ data: { batchId } }),
      staleTime: 5_000,
    }),
  wallets: () =>
    queryOptions({
      queryKey: offlineSalesKeys.wallets(),
      queryFn: () => listOfflineSalesReplacementWalletsFn(),
      staleTime: 30_000,
    }),
  stockIssues: (status: "open" | "resolved" | "all") =>
    queryOptions({
      queryKey: offlineSalesKeys.stockIssues(status),
      queryFn: () => listStockReconciliationIssuesFn({ data: { status } }),
      staleTime: 10_000,
    }),
};

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function filenameFromDisposition(disposition: string | null) {
  return (
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? "offline-sales-F01.xlsx"
  );
}

async function saveWorkbookResponse(response: Response) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
  );
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function useOfflineSalesWorkbooks(enabled = true) {
  return useQuery({ ...offlineSalesQueries.workbooks(), enabled });
}

export function useOfflineSalesOperators(enabled = true) {
  return useQuery({ ...offlineSalesQueries.operators(), enabled });
}

export function useOfflineSalesHistory(enabled = true) {
  return useQuery({ ...offlineSalesQueries.history(), enabled });
}

export function useOfflineSalesBatch(batchId: string | null) {
  return useQuery({
    ...offlineSalesQueries.batch(batchId ?? "none"),
    enabled: Boolean(batchId),
  });
}

export function useOfflineSalesReplacementWallets(enabled = true) {
  return useQuery({ ...offlineSalesQueries.wallets(), enabled });
}

export function useStockReconciliationIssues(
  status: "open" | "resolved" | "all",
  enabled = true,
) {
  return useQuery({ ...offlineSalesQueries.stockIssues(status), enabled });
}

function useInvalidateOfflineSales() {
  const queryClient = useQueryClient();
  return async (batchId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: offlineSalesKeys.workbooks() }),
      queryClient.invalidateQueries({ queryKey: offlineSalesKeys.history() }),
      queryClient.invalidateQueries({ queryKey: offlineSalesKeys.batches() }),
      queryClient.invalidateQueries({ queryKey: offlineSalesKeys.all }),
      ...(batchId
        ? [
            queryClient.invalidateQueries({
              queryKey: offlineSalesKeys.batch(batchId),
            }),
          ]
        : []),
    ]);
  };
}

export function useIssueOfflineSalesWorkbook() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "issue-workbook"],
    mutationFn: (operatorUserId: string) =>
      issueOfflineSalesWorkbookFn({ data: { operatorUserId } }),
    onSuccess: async () => {
      toast.success("Official offline sales workbook issued");
      await invalidate();
    },
    onError: (error) => toast.error(message(error, "Could not issue workbook")),
  });
}

export function useDownloadOfflineSalesWorkbook() {
  return useMutation({
    mutationKey: ["offline-sales", "download-workbook"],
    mutationFn: async (workbookId: string) => {
      const response = await downloadOfflineSalesWorkbookFn({
        data: { workbookId },
      });
      await saveWorkbookResponse(response);
    },
    onSuccess: () => toast.success("Workbook downloaded"),
    onError: (error) =>
      toast.error(message(error, "Could not download workbook")),
  });
}

export function useReplaceOfflineSalesWorkbook() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "replace-workbook"],
    mutationFn: (data: {
      workbookId: string;
      usedRowsUploaded: true;
      operatorUserId?: string;
    }) => replaceOfflineSalesWorkbookFn({ data }),
    onSuccess: async () => {
      toast.success("Workbook replaced. Download the new official file.");
      await invalidate();
    },
    onError: (error) =>
      toast.error(message(error, "Could not replace workbook")),
  });
}

export function useForceRetireOfflineSalesWorkbook() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "force-retire-workbook"],
    mutationFn: (data: { workbookId: string; reason: string }) =>
      forceRetireOfflineSalesWorkbookFn({ data }),
    onSuccess: async () => {
      toast.success("Unsafe workbook force-retired");
      await invalidate();
    },
    onError: (error) =>
      toast.error(message(error, "Could not retire workbook")),
  });
}

export function useUploadOfflineSalesWorkbook() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "upload"],
    mutationFn: (data: FormData) => uploadOfflineSalesWorkbookFn({ data }),
    onSuccess: async (result) => {
      toast.success(
        result.status === "rejected"
          ? "Workbook rejected as unsafe"
          : "Workbook checked. Review results before posting.",
      );
      await invalidate(result.batchId);
    },
    onError: (error) =>
      toast.error(message(error, "Could not upload workbook")),
  });
}

function batchMutation<T>(input: {
  key: string;
  run: (data: T) => Promise<unknown>;
  success: string;
  failure: string;
}) {
  return function useBatchMutation() {
    const invalidate = useInvalidateOfflineSales();
    return useMutation({
      mutationKey: ["offline-sales", input.key],
      mutationFn: input.run,
      onSuccess: async (_result, data) => {
        toast.success(input.success);
        const batchId = (data as { batchId?: string }).batchId;
        await invalidate(batchId);
      },
      onError: (error) => toast.error(message(error, input.failure)),
    });
  };
}

export const useRefreshOfflineSalesPreview = batchMutation({
  key: "refresh-preview",
  run: (data: { batchId: string }) => refreshOfflineSalesPreviewFn({ data }),
  success: "Preview refreshed with current system data",
  failure: "Could not refresh preview",
});

export const useAcknowledgeOfflineSalesWarning = batchMutation({
  key: "acknowledge-warning",
  run: (data: { batchId: string; stagedInvoiceId: string }) =>
    acknowledgeOfflineSalesWarningFn({ data }),
  success: "Warning acknowledged",
  failure: "Could not acknowledge warning",
});

export const useReplaceOfflineSalesWallet = batchMutation({
  key: "replace-wallet",
  run: (data: {
    batchId: string;
    stagedPaymentId: string;
    replacementWalletId: string;
  }) => replaceOfflineSalesWalletFn({ data }),
  success: "Destination account replaced",
  failure: "Could not replace destination account",
});

export const useExcludeOfflineSalesInvoice = batchMutation({
  key: "exclude-invoice",
  run: (data: { batchId: string; stagedInvoiceId: string; reason: string }) =>
    excludeOfflineSalesInvoiceFn({ data }),
  success: "Offline invoice excluded",
  failure: "Could not exclude invoice",
});

export const useResolveOfflineSalesOrderConflict = batchMutation({
  key: "resolve-order-conflict",
  run: (data: {
    batchId: string;
    stagedInvoiceId: string;
    resolution:
      | "same_dispatch_duplicate"
      | "replace_incorrect_online"
      | "second_physical_dispatch";
    existingInvoiceId: string;
    reason: string;
  }) => resolveOfflineSalesOrderConflictFn({ data }),
  success: "Booked-order conflict recorded",
  failure: "Could not resolve booked-order conflict",
});

export function usePostOfflineSalesBatch() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "post-batch"],
    mutationFn: async (batchId: string) => {
      let result = await postOfflineSalesBatchFn({ data: { batchId } });
      let runs = 1;
      while (result.hasMore && runs < 30) {
        result = await postOfflineSalesBatchFn({ data: { batchId } });
        runs += 1;
      }
      return result;
    },
    onSuccess: async (result) => {
      toast.success(
        result.hasMore
          ? "Posting paused safely. Press Post again to continue."
          : "Eligible offline invoices posted",
      );
      await invalidate(result.batchId);
    },
    onError: (error) =>
      toast.error(message(error, "Could not post offline invoices")),
  });
}

export function useResolveStockReconciliationIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["offline-sales", "resolve-stock-issue"],
    mutationFn: (data: {
      issueId: string;
      resolutionType: "counted_adjustment" | "missing_record";
      resolutionReference: string;
      resolutionReason: string;
    }) => resolveStockReconciliationIssueFn({ data }),
    onSuccess: async () => {
      toast.success("Stock issue resolved");
      await queryClient.invalidateQueries({ queryKey: offlineSalesKeys.all });
    },
    onError: (error) =>
      toast.error(message(error, "Could not resolve stock issue")),
  });
}
