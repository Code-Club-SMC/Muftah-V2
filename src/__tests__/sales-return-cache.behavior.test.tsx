import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { toast } from "sonner";
import {
  salesReturnKeys,
  useCreateSalesReturn,
  useDecideSalesReturn,
  useCompleteSalesReturn,
  useCancelSalesReturn,
  useVoidSalesReturn,
  useReturnReasons,
  useSaveReturnReason,
  type CreateSalesReturnInput,
} from "@/hooks/sales/use-sales-returns";
import {
  customerCreditKeys,
  useCustomerCreditSummary,
  useIssueCustomerRefund,
  useReverseCustomerRefund,
} from "@/hooks/sales/use-customer-credit";
import { overdrawError } from "@/lib/finance/expense-corrections";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  decide: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  void: vi.fn(),
  reasons: vi.fn(),
  saveReason: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  customerCreditSummary: vi.fn(),
  issueRefund: vi.fn(),
  reverseRefund: vi.fn(),
}));
vi.mock("@/server-functions/sales/sales-returns-fn", () => ({ createSalesReturnFn: mocks.create, decideSalesReturnFn: mocks.decide, completeSalesReturnFn: mocks.complete, cancelSalesReturnFn: mocks.cancel, voidSalesReturnFn: mocks.void, listSalesReturnsFn: mocks.list, getSalesReturnDetailFn: mocks.detail }));
vi.mock("@/server-functions/sales/return-reasons-fn", () => ({ getReturnReasonsFn: mocks.reasons, saveReturnReasonFn: mocks.saveReason }));
vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
  getCustomerCreditSummaryFn: mocks.customerCreditSummary,
  issueCustomerRefundFn: mocks.issueRefund,
  reverseCustomerRefundFn: mocks.reverseRefund,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
let client: QueryClient;
const local = [
  ["sales-returns", "invoice", "invoice"],
  ["sales-returns", "list", { tab: "to-approve", page: 1 }],
  ["sales-returns", "detail", "return"],
  ["invoice-detail", "invoice"],
];
const physical = ["inventory", "factory-floor", "item-detail", "low-stock-alerts", "carton-availability", "cartons", "invoices", "customers", "sales-people", "salesman-summary", "distributor-profile", "shopkeeper-profile", "reconciliation", "credit-recovery", "slip-lookup", "overdue-slips", "distributor-ledger", "shopkeeper-ledger", "salesman-ledger", "salesman-shop-ledger", "reports", "customer-credit"].map(key => [key, "cached"]);
physical.push(["production-runs", "batch", "kpis"], ["production-runs", "batch", "audit"]);
const untouched = [["wallets"], ["transactions"], ["unrelated"]];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.resetAllMocks();
  Object.values(mocks).forEach(mock => mock.mockResolvedValue({ success: true, walletName: "Cash Box" }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  [...local, ...physical, ...untouched].forEach(key => client.setQueryData(key, []));
});
afterEach(() => { cleanup(); client.clear(); });
const invalid = (keys: unknown[][], expected: boolean) => keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(expected));
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
  it("separates active and includeInactive reason keys while invalidating both on save", async () => {
    client.setQueryData(salesReturnKeys.reasons, []);
    client.setQueryData([...salesReturnKeys.reasons, "all"], []);
    const { result } = renderHook(() => useSaveReturnReason(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: "Late delivery", requiresNote: false, isActive: true });
    });
    expect(mocks.saveReason).toHaveBeenCalledWith({ data: { name: "Late delivery", requiresNote: false, isActive: true } });
    invalid([["return-reasons"], ["return-reasons", "all"]], true);
    invalid(untouched, false);
  });
  it("fast-path approveNow refreshes local reads with awaiting-receipt copy and without moving stock or balances", async () => {
    const { result } = renderHook(useActions, { wrapper });
    await act(async () => {
      await result.current.create.mutateAsync({ ...createInput, approveNow: true });
    });
    invalid(local, true); invalid(physical, false); invalid(untouched, false);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("awaiting receipt"));
  });
});

describe("customer credit and refund cache invalidation", () => {
  const creditKeysToTrack = [
    ["customer-credit"],
    ["customer-credit", "cust-1"],
    ["wallets"],
    ["transactions"],
    ["transactions-recent"],
    ["daily-closing"],
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
    ["reports"],
  ];

  it("useIssueCustomerRefund invalidates credit, wallet, transaction, customer, invoice, returns, ledger, and report keys", async () => {
    creditKeysToTrack.forEach(key => client.setQueryData(key, []));
    client.setQueryData(["unrelated-key"], []);
    mocks.issueRefund.mockResolvedValueOnce({ refundId: "ref-1", walletName: "Cash Box" });

    const { result } = renderHook(() => useIssueCustomerRefund("cust-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        customerId: "cust-1",
        amount: 500,
        walletId: "wallet-1",
      });
    });

    expect(mocks.issueRefund).toHaveBeenCalledWith({
      data: {
        customerId: "cust-1",
        amount: 500,
        walletId: "wallet-1",
      },
    });
    expect(toast.success).toHaveBeenCalledWith("Refund recorded from Cash Box");
    invalid(creditKeysToTrack, true);
    invalid([["unrelated-key"]], false);
  });

  it("useIssueCustomerRefund suppresses error toast and invalidates wallets when isOverdrawConfirmError is true", async () => {
    creditKeysToTrack.forEach(key => client.setQueryData(key, []));
    const overdraw = overdrawError("Cash Box", "-100");
    mocks.issueRefund.mockRejectedValueOnce(overdraw);

    const { result } = renderHook(() => useIssueCustomerRefund("cust-1"), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          customerId: "cust-1",
          amount: 500,
          walletId: "wallet-1",
        })
      ).rejects.toThrow();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(client.getQueryState(["wallets"])?.isInvalidated).toBe(true);
    // Other credit keys should NOT be invalidated on overdraw error
    expect(client.getQueryState(["customer-credit"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["transactions"])?.isInvalidated).toBe(false);
  });

  it("useIssueCustomerRefund shows error toast on normal error", async () => {
    mocks.issueRefund.mockRejectedValueOnce(new Error("Database connection failed"));

    const { result } = renderHook(() => useIssueCustomerRefund("cust-1"), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          customerId: "cust-1",
          amount: 500,
          walletId: "wallet-1",
        })
      ).rejects.toThrow("Database connection failed");
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to record refund", {
      description: "Database connection failed",
    });
  });

  it("useReverseCustomerRefund invalidates credit, wallet, transaction, customer, invoice, returns, ledger, and report keys", async () => {
    creditKeysToTrack.forEach(key => client.setQueryData(key, []));
    client.setQueryData(["unrelated-key"], []);
    mocks.reverseRefund.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useReverseCustomerRefund("cust-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        refundId: "ref-1",
        reason: "Customer returned money",
      });
    });

    expect(mocks.reverseRefund).toHaveBeenCalledWith({
      data: {
        refundId: "ref-1",
        reason: "Customer returned money",
      },
    });
    expect(toast.success).toHaveBeenCalledWith("Refund reversed and store credit restored");
    invalid(creditKeysToTrack, true);
    invalid([["unrelated-key"]], false);
  });

  it("useReverseCustomerRefund shows error toast on failure", async () => {
    mocks.reverseRefund.mockRejectedValueOnce(new Error("Cannot reverse settled refund"));

    const { result } = renderHook(() => useReverseCustomerRefund("cust-1"), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          refundId: "ref-1",
          reason: "Customer returned money",
        })
      ).rejects.toThrow("Cannot reverse settled refund");
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to reverse refund", {
      description: "Cannot reverse settled refund",
    });
  });

  it("useCustomerCreditSummary fetches credit summary when enabled", async () => {
    mocks.customerCreditSummary.mockResolvedValueOnce({ storeCredit: "1500" });

    renderHook(() => useCustomerCreditSummary("cust-1"), { wrapper });
    await act(async () => {
      await client.refetchQueries({ queryKey: customerCreditKeys.detail("cust-1") });
    });

    expect(mocks.customerCreditSummary).toHaveBeenCalledWith({
      data: { customerId: "cust-1" },
    });
  });

  it("useCustomerCreditSummary is disabled when customerId is empty or enabled is false", () => {
    renderHook(() => useCustomerCreditSummary("", true), { wrapper });
    renderHook(() => useCustomerCreditSummary("cust-1", false), { wrapper });
    renderHook(() => useCustomerCreditSummary(null, true), { wrapper });
    renderHook(() => useCustomerCreditSummary(undefined, true), { wrapper });

    expect(mocks.customerCreditSummary).not.toHaveBeenCalled();
  });
});
