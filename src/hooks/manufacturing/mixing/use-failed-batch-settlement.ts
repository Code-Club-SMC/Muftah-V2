import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFailedBatchSettlementFn } from "@/server-functions/manufacturing/mixing/get-failed-batch-settlement-fn";
import { getFailedBatchesToSettleFn } from "@/server-functions/manufacturing/mixing/get-failed-batches-to-settle-fn";
import { settleFailedBatchChemicalsFn } from "@/server-functions/manufacturing/mixing/settle-failed-batch-chemicals-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export const failedBatchSettlementKey = (mixingRunId: string) => ["failed-batch-settlement", mixingRunId] as const;
export const failedBatchesToSettleKey = ["failed-batches-to-settle"] as const;

export const useFailedBatchSettlement = (mixingRunId: string, enabled = true) =>
  useQuery({
    queryKey: failedBatchSettlementKey(mixingRunId),
    queryFn: () => getFailedBatchSettlementFn({ data: { mixingRunId } }),
    enabled,
  });

export const useFailedBatchesToSettle = () =>
  useQuery({
    queryKey: failedBatchesToSettleKey,
    queryFn: () => getFailedBatchesToSettleFn(),
  });

export const useSettleFailedBatchChemicals = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: settleFailedBatchChemicalsFn,
    onSuccess: async (result, variables) => {
      await invalidateStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: failedBatchSettlementKey(variables.data.mixingRunId) });
      queryClient.invalidateQueries({ queryKey: failedBatchesToSettleKey });
      queryClient.invalidateQueries({ queryKey: ["mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-runs"] });
      queryClient.invalidateQueries({ queryKey: ["operator-mixing-run"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "profit-loss"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "expenses"] });
      queryClient.invalidateQueries({ queryKey: ["activity-timeline"] });
      toast.success(
        `Settled ${result.settledCount} chemical${result.settledCount === 1 ? "" : "s"} for batch ${result.batchId}`,
      );
    },
    onError: (error) => {
      toast.error(error.message || "Could not settle the chemicals");
    },
  });
};
