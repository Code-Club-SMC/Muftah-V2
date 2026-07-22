import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updateOverdueSlipsFn,
  previewOverdueSlipsFn,
} from "@/server-functions/sales/overdue-detection-fn";
import { toast } from "sonner";

export const overdueKeys = {
  all: ["overdue-detection"] as const,
  preview: () => [...overdueKeys.all, "preview"] as const,
};

export function usePreviewOverdueSlips() {
  return useQuery({
    queryKey: overdueKeys.preview(),
    queryFn: async () => {
      const res = await previewOverdueSlipsFn({ data: {} });
      return res as { overdueCount: number };
    },
  });
}

export function useUpdateOverdueSlips() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await updateOverdueSlipsFn({ data: {} });
      return res as { updatedCount: number; updatedSlipIds: string[] };
    },
    onSuccess: (result) => {
      toast.success(`${result.updatedCount} slip(s) marked overdue`);
      qc.invalidateQueries({ queryKey: overdueKeys.preview() });
      qc.invalidateQueries({ queryKey: ["credit-recovery"] });
      qc.invalidateQueries({ queryKey: ["slip-lookup"] });
      qc.invalidateQueries({ queryKey: ["overdue-slips"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to update overdue slips"),
  });
}
