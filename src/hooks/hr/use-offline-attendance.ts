import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  downloadOfflineAttendanceWorkbookFn,
  issueOfflineAttendanceWorkbookFn,
  listOfflineAttendanceOperatorsFn,
  listOfflineAttendanceWorkbooksFn,
  replaceOfflineAttendanceWorkbookFn,
  retireOfflineAttendanceWorkbookFn,
} from "@/server-functions/hr/attendance/offline-workbooks-fn";
import { uploadOfflineAttendanceWorkbookFn } from "@/server-functions/hr/attendance/offline-upload-fn";
import {
  confirmOfflineOutageWindowFn,
  excludeOfflineImportRowsFn,
  getOfflineImportBatchFn,
  getOfflineImportQueuesFn,
  refreshOfflineImportPreviewFn,
  rejectOfflineOutageWindowFn,
} from "@/server-functions/hr/attendance/offline-review-fn";
import { confirmOfflineAttendanceImportFn } from "@/server-functions/hr/attendance/offline-confirm-fn";

export const offlineAttendanceKeys = {
  all: ["offline-attendance"] as const,
  workbooks: () => [...offlineAttendanceKeys.all, "workbooks"] as const,
  operators: () => [...offlineAttendanceKeys.all, "operators"] as const,
  queues: () => [...offlineAttendanceKeys.all, "queues"] as const,
  batch: (batchId: string) =>
    [...offlineAttendanceKeys.all, "batch", batchId] as const,
};

function filenameFromDisposition(disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "offline-attendance.xlsx";
}

async function saveWorkbookResponse(response: Response) {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameFromDisposition(response.headers.get("Content-Disposition"));
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function useOfflineAttendanceWorkbooks() {
  return useQuery({
    queryKey: offlineAttendanceKeys.workbooks(),
    queryFn: () => listOfflineAttendanceWorkbooksFn(),
    staleTime: 10_000,
  });
}

export function useOfflineAttendanceOperators() {
  return useQuery({
    queryKey: offlineAttendanceKeys.operators(),
    queryFn: () => listOfflineAttendanceOperatorsFn(),
    staleTime: 30_000,
  });
}

export function useOfflineImportQueues() {
  return useQuery({
    queryKey: offlineAttendanceKeys.queues(),
    queryFn: () => getOfflineImportQueuesFn(),
    staleTime: 5_000,
  });
}

export function useOfflineImportBatch(batchId: string | null) {
  return useQuery({
    queryKey: offlineAttendanceKeys.batch(batchId ?? "none"),
    queryFn: () => getOfflineImportBatchFn({ data: { batchId: batchId! } }),
    enabled: Boolean(batchId),
    staleTime: 5_000,
  });
}

export function useIssueOfflineAttendanceWorkbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof issueOfflineAttendanceWorkbookFn>[0]["data"]) =>
      issueOfflineAttendanceWorkbookFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.workbooks(),
      });
      toast.success("Offline workbook issued");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to issue offline workbook");
    },
  });
}

export function useDownloadOfflineAttendanceWorkbook() {
  return useMutation({
    mutationFn: async (workbookId: string) => {
      const response = await downloadOfflineAttendanceWorkbookFn({
        data: { workbookId },
      });
      await saveWorkbookResponse(response);
      return workbookId;
    },
    onSuccess: () => {
      toast.success("Workbook downloaded");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to download workbook");
    },
  });
}

export function useReplaceOfflineAttendanceWorkbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workbookId: string) =>
      replaceOfflineAttendanceWorkbookFn({ data: { workbookId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.workbooks(),
      });
      toast.success("Offline workbook replaced");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to replace workbook");
    },
  });
}

export function useRetireOfflineAttendanceWorkbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Parameters<typeof retireOfflineAttendanceWorkbookFn>[0]["data"],
    ) => retireOfflineAttendanceWorkbookFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.workbooks(),
      });
      toast.success("Offline workbook retired");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to retire workbook");
    },
  });
}

export function useUploadOfflineAttendanceWorkbook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData) => uploadOfflineAttendanceWorkbookFn({ data }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      toast.success(
        result.status === "rejected"
          ? "Workbook rejected as unsafe"
          : "Workbook uploaded for supervisor confirmation",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to upload workbook");
    },
  });
}

export function useConfirmOfflineOutageWindow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Parameters<typeof confirmOfflineOutageWindowFn>[0]["data"],
    ) => confirmOfflineOutageWindowFn({ data }),
    onSuccess: (preview) => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.batch(preview.batchId),
      });
      toast.success("Outage confirmed. Preview ready.");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to confirm outage");
    },
  });
}

export function useRejectOfflineOutageWindow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Parameters<typeof rejectOfflineOutageWindowFn>[0]["data"],
    ) => rejectOfflineOutageWindowFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      toast.success("Outage rejected");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to reject outage");
    },
  });
}

export function useRefreshOfflineImportPreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (batchId: string) =>
      refreshOfflineImportPreviewFn({ data: { batchId } }),
    onSuccess: (preview) => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.batch(preview.batchId),
      });
      toast.success("Preview refreshed");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to refresh preview");
    },
  });
}

export function useExcludeOfflineImportRows() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Parameters<typeof excludeOfflineImportRowsFn>[0]["data"],
    ) => excludeOfflineImportRowsFn({ data }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.batch(result.batchId),
      });
      toast.success("Rows excluded");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to exclude rows");
    },
  });
}

export function useConfirmOfflineAttendanceImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      let result = await confirmOfflineAttendanceImportFn({ data: { batchId } });
      let guard = 0;

      while (result.hasMore && guard < 100) {
        result = await confirmOfflineAttendanceImportFn({ data: { batchId } });
        guard += 1;
      }

      return result;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.queues(),
      });
      void queryClient.invalidateQueries({
        queryKey: offlineAttendanceKeys.batch(result.batchId),
      });
      void queryClient.invalidateQueries({ queryKey: ["daily-attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      toast.success(
        result.hasMore
          ? "Import still has more rows. Run import again."
          : "Offline attendance imported",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to import offline attendance");
    },
  });
}
