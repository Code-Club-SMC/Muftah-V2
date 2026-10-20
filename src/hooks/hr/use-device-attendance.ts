import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  confirmDeviceAttendanceFn,
  listDeviceAttendanceImportsFn,
  previewDeviceAttendanceFn,
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

export function useConfirmDeviceAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ImportSelection) => confirmDeviceAttendanceFn({ data }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deviceAttendanceKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["daily-attendance"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance-punches"] }),
        queryClient.invalidateQueries({
          queryKey: ["employee-attendance-log"],
        }),
        queryClient.invalidateQueries({ queryKey: ["payrolls"] }),
        queryClient.invalidateQueries({ queryKey: ["payroll"] }),
      ]);
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
