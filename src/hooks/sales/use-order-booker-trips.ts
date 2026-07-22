import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOrderBookerTripsFn,
  createOrderBookerTripFn,
  updateOrderBookerTripFn,
  deleteOrderBookerTripFn,
  getTadaRateFn,
} from "@/server-functions/sales/order-booker-trips-fn";

export function useGetOrderBookerTrips(orderBookerId: string, fromDate?: string, toDate?: string) {
  return useQuery({
    queryKey: ["orderBookerTrips", orderBookerId, fromDate, toDate],
    queryFn: () => getOrderBookerTripsFn({ data: { orderBookerId, fromDate, toDate } }),
    enabled: !!orderBookerId,
  });
}

export function useCreateOrderBookerTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrderBookerTripFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orderBookerTrips"] });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
    },
  });
}

export function useUpdateOrderBookerTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateOrderBookerTripFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orderBookerTrips"] });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
    },
  });
}

export function useDeleteOrderBookerTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteOrderBookerTripFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orderBookerTrips"] });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
    },
  });
}

export function useGetTadaRate() {
  return useQuery({
    queryKey: ["tadaRate"],
    queryFn: () => getTadaRateFn(),
  });
}
