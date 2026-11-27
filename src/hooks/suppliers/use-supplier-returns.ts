import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";
import type { SupplierReturnQueue } from "@/lib/suppliers/supplier-returns";
import {
  applySupplierCreditFn,
  cancelSupplierReturnFn,
  completeSupplierReturnFn,
  dispatchSupplierReturnFn,
  getPurchaseReturnableFn,
  getSupplierReturnFn,
  listSupplierReturnsFn,
  previewDebitNoteFn,
  requestSupplierReturnFn,
  voidSupplierReturnFn,
} from "@/server-functions/suppliers/supplier-returns-fn";

export function usePurchaseReturnable(purchaseId: string | null) {
  return useQuery({
    queryKey: ["purchase-returnable", purchaseId],
    queryFn: () => getPurchaseReturnableFn({ data: { purchaseId: purchaseId! } }),
    enabled: !!purchaseId,
  });
}

export function useSupplierReturns(supplierId: string, queue: SupplierReturnQueue) {
  return useQuery({
    queryKey: ["supplier-returns", supplierId, queue],
    queryFn: () => listSupplierReturnsFn({ data: { supplierId, queue } }),
  });
}

export function useSupplierReturn(id: string | null) {
  return useQuery({
    queryKey: ["supplier-return", id],
    queryFn: () => getSupplierReturnFn({ data: { id: id! } }),
    enabled: !!id,
  });
}

export function useDebitNotePreview(id: string | null) {
  return useQuery({
    queryKey: ["debit-note-preview", id],
    queryFn: () => previewDebitNoteFn({ data: { id: id! } }),
    enabled: !!id,
  });
}

/** Everything a return can change: the return lists, the purchase rows, stock, wallets and the supplier totals. */
export async function invalidateSupplierReturnQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["supplier-returns"] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-return"] }),
    queryClient.invalidateQueries({ queryKey: ["purchase-returnable"] }),
    queryClient.invalidateQueries({ queryKey: ["debit-note-preview"] }),
    queryClient.invalidateQueries({ queryKey: ["supplier"] }),
    queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    invalidateStockQueries(queryClient),
    queryClient.invalidateQueries({ queryKey: ["activity-timeline"] }),
    invalidateFinanceQueries(queryClient),
  ]);
}

export function useSupplierReturnMutations() {
  const queryClient = useQueryClient();
  const done = (message: string) => async () => {
    await invalidateSupplierReturnQueries(queryClient);
    toast.success(message);
  };
  const failed = (error: Error) => toast.error(error.message);
  // Each wrapper passes only the input: React Query also hands mutationFn a context object.
  return {
    request: useMutation({ mutationFn: (input: Parameters<typeof requestSupplierReturnFn>[0]) => requestSupplierReturnFn(input), onSuccess: done("Return requested"), onError: failed }),
    dispatch: useMutation({ mutationFn: (input: Parameters<typeof dispatchSupplierReturnFn>[0]) => dispatchSupplierReturnFn(input), onSuccess: done("Marked as dispatched"), onError: failed }),
    complete: useMutation({ mutationFn: (input: Parameters<typeof completeSupplierReturnFn>[0]) => completeSupplierReturnFn(input), onSuccess: done("Debit note issued"), onError: failed }),
    cancel: useMutation({ mutationFn: (input: Parameters<typeof cancelSupplierReturnFn>[0]) => cancelSupplierReturnFn(input), onSuccess: done("Return cancelled"), onError: failed }),
    voidNote: useMutation({ mutationFn: (input: Parameters<typeof voidSupplierReturnFn>[0]) => voidSupplierReturnFn(input), onSuccess: done("Debit note voided"), onError: failed }),
    useCredit: useMutation({ mutationFn: (input: Parameters<typeof applySupplierCreditFn>[0]) => applySupplierCreditFn(input), onSuccess: done("Paid from supplier credit"), onError: failed }),
  };
}
