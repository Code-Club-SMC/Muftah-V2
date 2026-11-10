import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChemicalReportPurchases, useCreateLabReport, useDeleteLabReport, useLabReports, useUpdateLabReport } from "@/hooks/inventory/use-lab-reports";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), list: vi.fn(), purchases: vi.fn() }));
vi.mock("@/server-functions/inventory/lab-reports/create-lab-report-fn", () => ({ createLabReportFn: mocks.create }));
vi.mock("@/server-functions/inventory/lab-reports/update-lab-report-fn", () => ({ updateLabReportFn: mocks.update }));
vi.mock("@/server-functions/inventory/lab-reports/delete-lab-report-fn", () => ({ deleteLabReportFn: mocks.remove }));
vi.mock("@/server-functions/inventory/lab-reports/get-lab-reports-fn", () => ({ getLabReportsFn: mocks.list, getLabReportByIdFn: vi.fn() }));
vi.mock("@/server-functions/inventory/lab-reports/get-chemical-report-purchases-fn", () => ({ getChemicalReportPurchasesFn: mocks.purchases }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let client: QueryClient;
const keys = [["lab-reports", "c", "all"], ["lab-reports", "c", "p"], ["lab-report", "r"], ["chemical-report-purchases", "c"], ["inventory"], ["factory-floor"], ["item-detail", "chemical", "c", 4]];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  for (const key of keys) client.setQueryData(key, []);
  for (const fn of [mocks.create, mocks.update, mocks.remove]) fn.mockResolvedValue({ id: "r" });
});
afterEach(() => { cleanup(); client.clear(); });
const details = { productName: "Soda", certifiedBy: "Lab", reportDate: "2026-11-06", analysisItems: [{ item: "pH", requirement: "Lab requirement", result: "8", passed: false }] };
describe("certificate query caches", () => {
  it.each(["create", "update", "delete"] as const)("refreshes observed floor coverage and stales scoped report/purchase/detail caches on %s", async action => {
    const refetch = vi.fn(async () => []);
    renderHook(() => useQuery({ queryKey: ["factory-floor"], queryFn: refetch }), { wrapper });
    const { result } = renderHook(() => ({ create: useCreateLabReport(), update: useUpdateLabReport(), delete: useDeleteLabReport() }), { wrapper });
    await act(async () => {
      if (action === "create") await result.current.create.mutateAsync({ data: { chemicalId: "c", purchaseId: "p", ...details } });
      if (action === "update") await result.current.update.mutateAsync({ data: { reportId: "r", ...details } });
      if (action === "delete") await result.current.delete.mutateAsync({ data: { reportId: "r" } });
    });
    expect(refetch).toHaveBeenCalledOnce();
    for (const key of keys.filter(k => k[0] !== "factory-floor" && k[0] !== "lab-report")) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    if (action === "delete") expect(client.getQueryData(["lab-report", "r"])).toBeUndefined();
    else expect(client.getQueryState(["lab-report", "r"])?.isInvalidated).toBe(true);
  });
  it("keeps overview and purchase list keys distinct and sends their scope", async () => {
    client.clear();
    mocks.list.mockResolvedValue([]);
    const { result } = renderHook(() => ({ all: useLabReports("c"), purchase: useLabReports("c", "p") }), { wrapper });
    await act(async () => { await Promise.all([result.current.all.refetch(), result.current.purchase.refetch()]); });
    expect(mocks.list).toHaveBeenCalledWith({ data: { chemicalId: "c", purchaseId: undefined } });
    expect(mocks.list).toHaveBeenCalledWith({ data: { chemicalId: "c", purchaseId: "p" } });
    expect(client.getQueryData(["lab-reports", "c", "all"])).toEqual([]);
    expect(client.getQueryData(["lab-reports", "c", "p"])).toEqual([]);
  });
  it("makes no detail requests without a chemical ID", () => {
    renderHook(() => { useChemicalReportPurchases(""); useLabReports(""); }, { wrapper });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.purchases).not.toHaveBeenCalled();
  });
});
