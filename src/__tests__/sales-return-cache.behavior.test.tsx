import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { useCreateSalesReturn, useDecideSalesReturn, useCompleteSalesReturn, useCancelSalesReturn, useVoidSalesReturn, useReturnReasons, type CreateSalesReturnInput } from "@/hooks/sales/use-sales-returns";

const mocks = vi.hoisted(() => ({ create: vi.fn(), decide: vi.fn(), complete: vi.fn(), cancel: vi.fn(), void: vi.fn(), reasons: vi.fn() }));
vi.mock("@/server-functions/sales/sales-returns-fn", () => ({ createSalesReturnFn: mocks.create, decideSalesReturnFn: mocks.decide, completeSalesReturnFn: mocks.complete, cancelSalesReturnFn: mocks.cancel, voidSalesReturnFn: mocks.void }));
vi.mock("@/server-functions/sales/return-reasons-fn", () => ({ getReturnReasonsFn: mocks.reasons }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let client: QueryClient;
const local = [["sales-returns", "invoice", "invoice"], ["invoice-detail", "invoice"]];
const physical = ["inventory", "factory-floor", "item-detail", "low-stock-alerts", "carton-availability", "cartons", "invoices", "customers", "sales-people", "salesman-summary", "distributor-profile", "shopkeeper-profile", "reconciliation", "credit-recovery", "slip-lookup", "overdue-slips", "distributor-ledger", "shopkeeper-ledger", "salesman-ledger", "salesman-shop-ledger", "reports"].map(key => [key, "cached"]);
physical.push(["production-runs", "batch", "kpis"], ["production-runs", "batch", "audit"]);
const untouched = [["wallets"], ["transactions"], ["unrelated"]];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.resetAllMocks();
  Object.values(mocks).forEach(mock => mock.mockResolvedValue({ success: true }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  [...local, ...physical, ...untouched].forEach(key => client.setQueryData(key, []));
});
afterEach(() => { cleanup(); client.clear(); });
const invalid = (keys: string[][], expected: boolean) => keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(expected));
const createInput = { invoiceId: "invoice", reasonId: "reason", reasonNote: "Details", items: [{ invoiceItemId: "item", cartonsReturned: 0, quantityReturned: 2 }] };
const receipt = { returnId: "return", lines: [{ returnItemId: "line", goodUnits: 1, damagedUnits: 1, expiredUnits: 0 }] };
function useActions() {
  return { create: useCreateSalesReturn(), decide: useDecideSalesReturn("invoice"), complete: useCompleteSalesReturn("invoice"), cancel: useCancelSalesReturn("invoice"), void: useVoidSalesReturn("invoice") };
}
describe("return lifecycle cache and contracts", () => {
  it("derives a concrete validated request contract, not the server validator's any input", () => {
    expectTypeOf<CreateSalesReturnInput>().not.toBeAny();
    expectTypeOf<CreateSalesReturnInput["reasonId"]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<ReturnType<typeof useDecideSalesReturn>["mutateAsync"]>[0]>().toEqualTypeOf<{ returnId: string; action: "approve" | "reject"; reason?: string }>();
    expectTypeOf<Parameters<ReturnType<typeof useCompleteSalesReturn>["mutateAsync"]>[0]["lines"][number]>().toEqualTypeOf<{ returnItemId: string; goodUnits: number; damagedUnits: number; expiredUnits: number }>();
    expectTypeOf<Parameters<ReturnType<typeof useCancelSalesReturn>["mutateAsync"]>[0]>().toEqualTypeOf<{ returnId: string; reason: string }>();
    expectTypeOf<Parameters<ReturnType<typeof useVoidSalesReturn>["mutateAsync"]>[0]>().toEqualTypeOf<{ returnId: string; reason: string }>();
  });
  it.each(["create", "approve", "reject", "cancel"])("%s refreshes local reads without pretending to move stock or credit", async action => {
    const { result } = renderHook(useActions, { wrapper });
    await act(async () => {
      if (action === "create") await result.current.create.mutateAsync(createInput);
      else if (action === "cancel") await result.current.cancel.mutateAsync({ returnId: "return", reason: "Not arriving" });
      else await result.current.decide.mutateAsync({ returnId: "return", action: action as "approve" | "reject", reason: action === "reject" ? "Wrong goods" : undefined });
    });
    invalid(local, true); invalid(physical, false); invalid(untouched, false);
    if (action === "cancel") expect(mocks.cancel).toHaveBeenCalledWith({ data: { returnId: "return", reason: "Not arriving" } });
    if (action === "reject") expect(mocks.decide).toHaveBeenCalledWith({ data: { returnId: "return", action: "reject", reason: "Wrong goods" } });
  });
  it.each(["complete", "void"] as const)("%s refreshes actual stock, balances, ledgers and reports without wallet movement", async action => {
    const { result } = renderHook(useActions, { wrapper });
    await act(async () => {
      if (action === "complete") await result.current.complete.mutateAsync(receipt);
      else await result.current.void.mutateAsync({ returnId: "return", reason: "Wrong receipt" });
    });
    invalid(local, true); invalid(physical, true); invalid(untouched, false);
    expect(mocks[action]).toHaveBeenCalledWith({ data: action === "complete" ? receipt : { returnId: "return", reason: "Wrong receipt" } });
  });
  it.each(["decide", "complete", "cancel", "void"] as const)("failed %s refreshes stale detail but never marks stock/balances changed", async action => {
    mocks[action].mockRejectedValue(new Error("Return is already completed"));
    const { result } = renderHook(useActions, { wrapper });
    await act(async () => {
      const promise = action === "complete" ? result.current.complete.mutateAsync(receipt)
        : action === "decide" ? result.current.decide.mutateAsync({ returnId: "return", action: "approve" })
        : result.current[action].mutateAsync({ returnId: "return", reason: "Wrong goods" });
      await expect(promise).rejects.toThrow("already completed");
    });
    invalid(local, true); invalid(physical, false);
  });
  it("failed requests refresh reservations and reason choices", async () => {
    client.setQueryData(["return-reasons"], []);
    mocks.create.mockRejectedValue(new Error("Pick a return reason from the list."));
    const { result } = renderHook(useActions, { wrapper });
    await act(async () => { await expect(result.current.create.mutateAsync(createInput)).rejects.toThrow("reason"); });
    invalid(local, true); invalid([["return-reasons"]], true); invalid(physical, false);
  });
  it("never runs the seeding reason reader while disabled", async () => {
    const { rerender } = renderHook(({ enabled }) => useReturnReasons(enabled), { wrapper, initialProps: { enabled: false } });
    expect(mocks.reasons).not.toHaveBeenCalled();
    await act(async () => { rerender({ enabled: true }); });
    expect(mocks.reasons).toHaveBeenCalledWith({ data: { includeInactive: false } });
  });
});
