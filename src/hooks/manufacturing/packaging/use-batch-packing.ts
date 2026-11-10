import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBatchPackingContextFn } from "@/server-functions/manufacturing/packaging/get-batch-packing-context-fn";
import { recordBatchPackingFn } from "@/server-functions/manufacturing/packaging/record-batch-packing-fn";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

export function useBatchPacking(mixingRunId: string) {
  return useQuery({
    queryKey: ["batch-packing", mixingRunId],
    queryFn: () => getBatchPackingContextFn({ data: { mixingRunId } }),
  });
}

export function useRefreshBatchPacking() {
  const client = useQueryClient();
  return useCallback(
    async (mixingRunId: string) => {
      await Promise.all([
        invalidateStockQueries(client),
        ...[
          ["batch-packing", mixingRunId],
          ["mixing-run", mixingRunId],
          ["operator-mixing-run", mixingRunId],
          ["warehouses"],
          ["cartons"],
          ["carton-availability"],
          ["packaging-allocations"],
          ["mixing-runs"],
          ["operator-mixing-runs"],
          ["operator-packaging"],
          ["production-runs"],
          ["consumption-history"],
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      ]);
    },
    [client],
  );
}

export function useRecordBatchPacking() {
  const refresh = useRefreshBatchPacking();
  return useMutation({
    mutationFn: recordBatchPackingFn,
    retry: false,
    onSuccess: (result) => refresh(result.mixingRunId),
  });
}
