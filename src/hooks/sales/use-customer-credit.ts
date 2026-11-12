import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
import {
  getCustomerCreditSummaryFn,
  issueCustomerRefundFn,
  reverseCustomerRefundFn,
} from "@/server-functions/sales/customer-credit-fn";

export const customerCreditKeys = {
  all: ["customer-credit"] as const,
  detail: (customerId: string) => [...customerCreditKeys.all, customerId] as const,
};

export function useCustomerCreditSummary(customerId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: customerCreditKeys.detail(customerId ?? ""),
    queryFn: () => getCustomerCreditSummaryFn({ data: { customerId: customerId ?? "" } }),
    enabled: Boolean(customerId) && enabled,
  });
}

function invalidateCreditAndMoney(qc: ReturnType<typeof useQueryClient>, customerId?: string) {
  const keys: readonly unknown[][] = [
    ["customer-credit"],
    ...(customerId ? [[...customerCreditKeys.detail(customerId)]] : []),
    ["customers"],
    ["distributor-profile"],
    ["shopkeeper-profile"],
    ["distributor-ledger"],
    ["shopkeeper-ledger"],
    ["salesman-ledger"],
    ["salesman-shop-ledger"],
    ["sales-returns"],
    ["invoices"],
    ["invoice-detail"],
    ["wallets"],
    ["transactions"],
    ["transactions-recent"],
    ["daily-closing"],
    ["reports"],
  ];
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useIssueCustomerRefund(customerId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      customerId: string;
      amount: number;
      walletId: string;
      refundDate?: Date;
      notes?: string;
      salesReturnId?: string;
      allowOverdraw?: boolean;
    }) => issueCustomerRefundFn({ data }),
    onSuccess: async (result, variables) => {
      toast.success(`Refund recorded from ${result.walletName}`);
      await invalidateCreditAndMoney(qc, customerId ?? variables.customerId);
    },
    onError: (err: Error) => {
      if (isOverdrawConfirmError(err)) {
        void qc.invalidateQueries({ queryKey: ["wallets"] });
        return;
      }
      toast.error("Failed to record refund", { description: err.message });
    },
  });
}

export function useReverseCustomerRefund(customerId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { refundId: string; reason: string }) =>
      reverseCustomerRefundFn({ data }),
    onSuccess: async () => {
      toast.success("Refund reversed and store credit restored");
      await invalidateCreditAndMoney(qc, customerId);
    },
    onError: (err: Error) => {
      toast.error("Failed to reverse refund", { description: err.message });
    },
  });
}
