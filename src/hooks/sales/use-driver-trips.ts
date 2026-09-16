import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listDriversFn,
  listDriverTripsFn,
  createDriverTripFn,
  deleteDriverTripFn,
} from "@/server-functions/sales/driver-trips-fn";
import { getTadaRateFn } from "@/server-functions/sales/order-booker-trips-fn";

export const driverKeys = {
  all: ["drivers"] as const,
  list: (status?: "active" | "inactive") =>
    [...driverKeys.all, "list", status] as const,
  trips: (filters?: { driverId?: string; fromDate?: string; toDate?: string }) =>
    [...driverKeys.all, "trips", filters] as const,
};

export function useGetDrivers(status?: "active" | "inactive") {
  return useQuery({
    queryKey: driverKeys.list(status),
    queryFn: () => listDriversFn({ data: status ? { status } : {} }),
  });
}

export function useGetDriverTrips(filters?: {
  driverId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  return useQuery({
    queryKey: driverKeys.trips(filters),
    queryFn: () => listDriverTripsFn({ data: filters }),
  });
}

export function useCreateDriverTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createDriverTripFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driverKeys.all });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["payrolls"] });
    },
  });
}

export function useDeleteDriverTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteDriverTripFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driverKeys.all });
      qc.invalidateQueries({ queryKey: ["daily-attendance"] });
      qc.invalidateQueries({ queryKey: ["employee-attendance-log"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["payrolls"] });
    },
  });
}

export function useGetTadaRate() {
  return useQuery({
    queryKey: ["tadaRate"],
    queryFn: () => getTadaRateFn(),
  });
}
