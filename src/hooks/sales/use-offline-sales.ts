import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";
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
import { offlineBackupSchema } from "@/lib/sales/offline/entry-schema";
import { sendOfflineSalesEntriesFn } from "@/server-functions/sales/offline-entries-fn";
import {
  forceRetireOfflineSalesWorkbookFn,
  listOfflineSalesWorkbooksFn,
} from "@/server-functions/sales/offline-workbooks-fn";

export const offlineSalesKeys = {
  all: ["offline-sales"] as const,
  workbooks: () => [...offlineSalesKeys.all, "workbooks"] as const,
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

export function useOfflineSalesWorkbooks(enabled = true) {
  return useQuery({ ...offlineSalesQueries.workbooks(), enabled });
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

export function useForceRetireOfflineSalesWorkbook() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "force-retire-workbook"],
    mutationFn: (data: { workbookId: string; reason: string }) =>
      forceRetireOfflineSalesWorkbookFn({ data }),
    onSuccess: async () => {
      toast.success("Offline invoice numbers retired");
      await invalidate();
    },
    onError: (error) =>
      toast.error(message(error, "Could not retire the invoice numbers")),
  });
}

/** Office-side upload of the backup file the offline desk can download. */
export function useUploadOfflineSalesBackup() {
  const invalidate = useInvalidateOfflineSales();
  return useMutation({
    mutationKey: ["offline-sales", "upload-backup"],
    mutationFn: async (input: {
      file: File;
      outageStartedAt: string;
      outageEndedAt: string;
      outageReason: string;
    }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(await input.file.text());
      } catch {
        throw new Error("That file is not an offline desk backup.");
      }
      const parsed = offlineBackupSchema.safeParse(raw);
      if (!parsed.success) throw new Error("That file is not an offline desk backup.");
      return await sendOfflineSalesEntriesFn({
        data: {
          workbookId: parsed.data.workbookId,
          outageStartedAt: input.outageStartedAt,
          outageEndedAt: input.outageEndedAt,
          outageReason: input.outageReason,
          source: "backup_file",
          entries: parsed.data.entries,
        },
      });
    },
    onSuccess: async (result) => {
      toast.success("Backup checked. Review results before posting.");
      await invalidate(result.batchId);
    },
    onError: (error) => toast.error(message(error, "Could not upload backup")),
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
  const queryClient = useQueryClient();
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
      await invalidateStockQueries(queryClient);
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
