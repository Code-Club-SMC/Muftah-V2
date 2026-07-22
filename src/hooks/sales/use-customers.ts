import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCustomersFn,
  getAllCustomersFn,
  getCustomerStatsFn,
  getCustomerLedgerFn,
  updateCustomerFn,
} from "@/server-functions/sales/customers-fn";
import { toast } from "sonner";

export const customersKeys = {
  all: ["customers"] as const,
  list: (params: {
    page: number;
    limit: number;
    search?: string;
    customerType?: string;
    city?: string;
    outstandingOnly?: boolean;
    sortBy?: string;
    sortOrder?: string;
  }) => [...customersKeys.all, "list", params] as const,
  select: () => [...customersKeys.all, "select"] as const,
  stats: (params?: { dateFrom?: string; dateTo?: string }) =>
    [...customersKeys.all, "stats", params ?? {}] as const,
  ledger: (customerId: string, params: { page: number; limit: number; dateFrom?: string; dateTo?: string }) =>
    [...customersKeys.all, "ledger", customerId, params] as const,
};

export const useGetCustomers = (params: {
  page: number;
  limit: number;
  search?: string;
  customerType?: string;
  city?: string;
  outstandingOnly?: boolean;
  sortBy?: string;
  sortOrder?: string;
}) => {
  return useSuspenseQuery({
    queryKey: customersKeys.list(params),
    queryFn: () => getCustomersFn({ data: params }),
    gcTime: 0,
    staleTime: 0,
  });
};

export const useGetAllCustomers = () => {
  return useSuspenseQuery({
    queryKey: customersKeys.select(),
    queryFn: () => getAllCustomersFn(),
    gcTime: 0,
    staleTime: 0,
  });
};

export const useGetCustomerStats = (params?: { dateFrom?: string; dateTo?: string }) => {
  return useSuspenseQuery({
    queryKey: customersKeys.stats(params),
    queryFn: () => getCustomerStatsFn({ data: params ?? {} }),
    gcTime: 30_000,
    staleTime: 0,
  });
};

export const useGetCustomerLedger = (
  customerId: string,
  params: { page: number; limit: number; dateFrom?: string; dateTo?: string },
) => {
  return useQuery({
    queryKey: customersKeys.ledger(customerId, params),
    queryFn: () => getCustomerLedgerFn({ data: { customerId, ...params } }),
    enabled: !!customerId,
    gcTime: 0,
    staleTime: 0,
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { id: string; name?: string; address?: string; mobileNumber?: string; cnic?: string; city?: string; state?: string; bankAccount?: string; customerType?: "distributor" | "retailer" }) =>
      updateCustomerFn({ data }),
    onSuccess: () => {
      toast.success("Customer updated successfully");
      queryClient.invalidateQueries({ queryKey: customersKeys.all });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update customer");
    },
  });
};
