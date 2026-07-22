import {
  useSuspenseQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getInvoicesFn,
  createInvoiceFn,
  getInvoiceStatsFn,
  deleteInvoiceFn,
  updateInvoiceFn,
} from "@/server-functions/sales/invoices-fn";
import { getInvoiceDetailFn } from "@/server-functions/sales/invoice-detail-fn";
import { CreateInvoiceInput, UpdateInvoiceInput } from "@/db/zod_schemas";
import { toast } from "sonner";

export const invoicesKeys = {
  all: ["invoices"] as const,
  list: (params: any) => [...invoicesKeys.all, "list", params] as const,
  detail: (id: string) => [...invoicesKeys.all, "detail", id] as const,
  stats: (params?: any) => [...invoicesKeys.all, "stats", params] as const,
};

export const useGetInvoices = (params: {
  page: number;
  limit: number;
  dateFrom?: string;
  dateTo?: string;
  month?: number;
  year?: number;
  search?: string;
  status?: "paid" | "credit" | "partial";
  customerType?: "distributor" | "retailer";
  warehouseId?: string;
  amountMin?: number;
  amountMax?: number;
  sortBy?: "date" | "totalPrice" | "credit" | "createdAt";
  sortOrder?: "asc" | "desc";
}) => {
  return useSuspenseQuery({
    queryKey: invoicesKeys.list(params),
    queryFn: () => getInvoicesFn({ data: params }),
    gcTime: 0,
    staleTime: 0,
  });
};

export const useGetInvoiceDetail = (id: string) => {
  return useQuery({
    queryKey: invoicesKeys.detail(id),
    queryFn: () => getInvoiceDetailFn({ data: { invoiceId: id } }),
    enabled: !!id,
  });
};

export const useGetInvoiceStats = (params?: {
  dateFrom?: string;
  dateTo?: string;
  status?: "paid" | "credit" | "partial";
  customerType?: "distributor" | "retailer";
  warehouseId?: string;
  amountMin?: number;
  amountMax?: number;
}) => {
  return useSuspenseQuery({
    queryKey: invoicesKeys.stats(params ?? {}),
    queryFn: () => getInvoiceStatsFn({ data: params ?? {} }),
    gcTime: 60_000,
    staleTime: 30_000,
  });
};

export const useCreateInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInvoiceInput) => createInvoiceFn({ data }),
    onSuccess: () => {
      toast.success("Invoice created successfully");
      queryClient.invalidateQueries({ queryKey: invoicesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create invoice");
    },
  });
};

export const useDeleteInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteInvoiceFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Invoice deleted successfully");
      queryClient.invalidateQueries({ queryKey: invoicesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete invoice");
    },
  });
};

export const useUpdateInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateInvoiceInput) => updateInvoiceFn({ data }),
    onSuccess: (_, variables) => {
      toast.success("Invoice updated successfully");
      queryClient.invalidateQueries({ queryKey: invoicesKeys.all });
      queryClient.invalidateQueries({ queryKey: invoicesKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update invoice");
    },
  });
};
