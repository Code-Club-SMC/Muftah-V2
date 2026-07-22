import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOrdersFn,
  getOrderDetailFn,
  createOrderFn,
  updateOrderFn,
  deleteOrderFn,
  fulfillOrderFn,
} from "@/server-functions/sales/orders-fn";

export function useGetOrders(filters?: { status?: string; orderBookerId?: string; fromDate?: string; toDate?: string }) {
  return useQuery({
    queryKey: ["orders", filters],
    queryFn: () => getOrdersFn({ data: filters ?? {} }),
  });
}

export function useGetOrderDetail(id: string) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: () => getOrderDetailFn({ data: { id } }),
    enabled: !!id,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrderFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["orderBookerTrips"] });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
    },
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateOrderFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteOrderFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useFulfillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fulfillOrderFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["commissionRecords"] });
      qc.invalidateQueries({ queryKey: ["commissionSummary"] });
    },
  });
}
