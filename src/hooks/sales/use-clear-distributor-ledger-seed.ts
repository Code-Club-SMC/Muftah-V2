import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearDistributorLedgerSeedFn } from "@/server-functions/sales/seed-distributor-ledger-fn";
import { salesPeopleKeys } from "./use-sales-people";

export function useClearDistributorLedgerSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearDistributorLedgerSeedFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: salesPeopleKeys.distributors() });
      qc.invalidateQueries({ queryKey: salesPeopleKeys.retailers() });
    },
  });
}
