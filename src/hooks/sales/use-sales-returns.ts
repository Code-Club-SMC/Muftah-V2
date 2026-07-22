import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createSalesReturnFn,
  processSalesReturnFn,
} from "@/server-functions/sales/sales-returns-fn";
import { toast } from "sonner";

export const salesReturnKeys = {
  all: ["sales-returns"] as const,
  invoice: (invoiceId: string) => [...salesReturnKeys.all, "invoice", invoiceId] as const,
};

export function useCreateSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      invoiceId: string;
      returnDate?: string;
      reason: string;
      condition: "good" | "damaged" | "expired";
      notes?: string;
      items: Array<{
        invoiceItemId: string;
        cartonsReturned?: number;
        quantityReturned?: number;
        refundPerUnit?: number;
      }>;
    }) => createSalesReturnFn({ data }),
    onSuccess: (_result, variables) => {
      toast.success("Return request created");
      qc.invalidateQueries({ queryKey: salesReturnKeys.invoice(variables.invoiceId) });
      qc.invalidateQueries({ queryKey: ["invoice-detail", variables.invoiceId] });
      qc.invalidateQueries({ queryKey: ["credit-recovery"] });
      qc.invalidateQueries({ queryKey: ["slip-lookup"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to create return"),
  });
}

export function useProcessSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      returnId: string;
      action: "approve" | "reject";
      notes?: string;
      invoiceId: string;
    }) => processSalesReturnFn({ data }),
    onSuccess: (_result, variables) => {
      toast.success(`Return ${variables.action === "approve" ? "approved" : "rejected"}`);
      qc.invalidateQueries({ queryKey: salesReturnKeys.all });
      qc.invalidateQueries({ queryKey: ["invoice-detail", variables.invoiceId] });
      qc.invalidateQueries({ queryKey: ["credit-recovery"] });
      qc.invalidateQueries({ queryKey: ["slip-lookup"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["carton-availability"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to process return"),
  });
}
