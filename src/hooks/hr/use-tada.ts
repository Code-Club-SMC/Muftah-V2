import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    setTadaRateFn,
    getActiveTadaRateFn,
    createTravelLogFn,
    listTravelLogsFn,
    processTravelLogFn,
    listTadaRatesFn,
} from "@/server-functions/hr/rates/tada-rates-fn";
import { getEmployeesFn } from "@/server-functions/hr/employees/get-employees-fn";

// ────────────────────────────────────────────────────────────────────────────
// RATE QUERIES & MUTATIONS
// ────────────────────────────────────────────────────────────────────────────

export function useActiveTadaRate() {
    return useQuery({
        queryKey: ["active-tada-rate"],
        queryFn: () => getActiveTadaRateFn(),
    });
}

export function useTadaRateHistory() {
    return useQuery({
        queryKey: ["tada-rate-history"],
        queryFn: () => listTadaRatesFn(),
    });
}

export function useSetTadaRate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Parameters<typeof setTadaRateFn>[0]["data"]) => {
            return await setTadaRateFn({ data });
        },
        onSuccess: () => {
            toast.success("New TA/DA rate set successfully.");
            queryClient.invalidateQueries({ queryKey: ["active-tada-rate"] });
            queryClient.invalidateQueries({ queryKey: ["tada-rate-history"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to set rate");
        },
    });
}

// ────────────────────────────────────────────────────────────────────────────
// LOG QUERIES & MUTATIONS
// ────────────────────────────────────────────────────────────────────────────

export function useEmployeesForTada() {
    return useQuery({
        queryKey: ["employees", "active"],
        queryFn: () => getEmployeesFn({ data: { status: "active" } }),
    });
}

export function useTravelLogs(params: Parameters<typeof listTravelLogsFn>[0]["data"] = {}) {
    return useQuery({
        queryKey: ["travel-logs", params],
        queryFn: () => listTravelLogsFn({ data: params }),
    });
}

export function useCreateTravelLog() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Parameters<typeof createTravelLogFn>[0]["data"]) => {
            return await createTravelLogFn({ data });
        },
        onSuccess: () => {
            toast.success("Travel log entry created successfully.");
            queryClient.invalidateQueries({ queryKey: ["travel-logs"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to create travel log. Make sure an active rate is set.");
        },
    });
}

export function useProcessTravelLog() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Parameters<typeof processTravelLogFn>[0]["data"]) => {
            return await processTravelLogFn({ data });
        },
        onSuccess: (_, variables) => {
            toast.success(`Travel log ${variables.status} successfully.`);
            queryClient.invalidateQueries({ queryKey: ["travel-logs"] });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to process travel log");
        },
    });
}
