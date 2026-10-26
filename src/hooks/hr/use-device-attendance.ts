import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  confirmDeviceAttendanceFn,
  discardDeviceAttendanceImportFn,
  listDeviceAttendanceImportsFn,
  previewDeviceAttendanceFn,
  undoDeviceAttendanceImportFn,
  unlinkDevicePersonFn,
  uploadDeviceAttendanceFn,
} from "@/server-functions/hr/attendance/device-import-fn";
import type { DeviceImportMappings } from "@/lib/attendance/device-import/contracts";

type ImportSelection = { importId: string; mappings?: DeviceImportMappings };

export const deviceAttendanceKeys = {
  all: ["device-attendance"] as const,
  imports: () => [...deviceAttendanceKeys.all, "imports"] as const,
};

export function useDeviceAttendanceImports(enabled = true) {
  return useQuery({
    queryKey: deviceAttendanceKeys.imports(),
    queryFn: () => listDeviceAttendanceImportsFn(),
    enabled,
    staleTime: 5_000,
  });
}

export function useUploadDeviceAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FormData) => uploadDeviceAttendanceFn({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviceAttendanceKeys.imports(),
      });
    },
    onError: (error) =>
      toast.error(error.message || "Unable to upload attendance report"),
  });
}

export function usePreviewDeviceAttendance() {
  return useMutation({
    mutationFn: (data: ImportSelection) => previewDeviceAttendanceFn({ data }),
    onError: (error) =>
      toast.error(error.message || "Unable to preview attendance report"),
  });
}

const invalidateAttendance = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: deviceAttendanceKeys.all }),
    queryClient.invalidateQueries({ queryKey: ["daily-attendance"] }),
    queryClient.invalidateQueries({ queryKey: ["attendance-punches"] }),
    queryClient.invalidateQueries({ queryKey: ["employee-attendance-log"] }),
    queryClient.invalidateQueries({ queryKey: ["payrolls"] }),
    queryClient.invalidateQueries({ queryKey: ["payroll"] }),
  ]);

export function useConfirmDeviceAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ImportSelection) => confirmDeviceAttendanceFn({ data }),
    onSuccess: async (result) => {
      await invalidateAttendance(queryClient);
      const applied = result.rows.reduce(
        (count, row) => count + row.newPunchCount,
        0,
      );
      toast.success(
        `${applied} device punches imported. Review any flagged days.`,
      );
    },
    onError: (error) =>
      toast.error(error.message || "Unable to import device attendance"),
  });
}

export function useUndoDeviceAttendanceImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) =>
      undoDeviceAttendanceImportFn({ data: { importId } }),
    onSuccess: async (result) => {
      await invalidateAttendance(queryClient);
      toast.success(
        result.keptPunchCount > 0
          ? `${result.removedPunchCount} imported punches removed. ${result.keptPunchCount} punches HR corrected or recorded separately were kept.`
          : `${result.removedPunchCount} imported punches removed.`,
      );
    },
    onError: (error) =>
      toast.error(error.message || "Unable to undo device import"),
  });
}

export function useDiscardDeviceAttendanceImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) =>
      discardDeviceAttendanceImportFn({ data: { importId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviceAttendanceKeys.imports(),
      });
      toast.success("Upload discarded.");
    },
    onError: (error) =>
      toast.error(error.message || "Unable to discard upload"),
  });
}

export function useUnlinkDevicePerson() {
  return useMutation({
    mutationFn: (personId: string) =>
      unlinkDevicePersonFn({ data: { personId } }),
    onError: (error) =>
      toast.error(error.message || "Unable to unlink device Person ID"),
  });
}
