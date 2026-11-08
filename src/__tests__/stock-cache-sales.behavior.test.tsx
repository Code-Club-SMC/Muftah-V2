import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateInvoice, useUpdateInvoice, useDeleteInvoice } from "@/hooks/sales/use-invoices";
import { useDecideSalesReturn, useCompleteSalesReturn, useVoidSalesReturn } from "@/hooks/sales/use-sales-returns";
import { useApplyQcHold, useReleaseQcHold, useDispatch, useProcessReturn, useCloseBatch } from "@/features/manufacturing/cartons/hooks/use-carton-mutations";
import { createInvoiceSchema, updateInvoiceSchema } from "@/db/zod_schemas";
import { usePostOfflineSalesBatch } from "@/hooks/sales/use-offline-sales";
import { useAddWarehouse } from "@/hooks/inventory/use-add-warehouse";
import { useUpdateWarehouse } from "@/hooks/inventory/use-update-warehouse";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), process: vi.fn(), post: vi.fn(), warehouse: vi.fn() }));
vi.mock("@/server-functions/sales/offline-post-fn", () => ({ postOfflineSalesBatchFn: mocks.post }));
vi.mock("@/server-functions/sales/offline-review-fn", () => ({ acknowledgeOfflineSalesWarningFn: vi.fn(), excludeOfflineSalesInvoiceFn: vi.fn(), getOfflineSalesBatchFn: vi.fn(), listOfflineSalesImportBatchesFn: vi.fn(), listOfflineSalesReplacementWalletsFn: vi.fn(), refreshOfflineSalesPreviewFn: vi.fn(), replaceOfflineSalesWalletFn: vi.fn(), resolveOfflineSalesOrderConflictFn: vi.fn() }));
vi.mock("@/server-functions/sales/offline-stock-reconciliation-fn", () => ({ listStockReconciliationIssuesFn: vi.fn(), resolveStockReconciliationIssueFn: vi.fn() }));
vi.mock("@/server-functions/sales/offline-entries-fn", () => ({ sendOfflineSalesEntriesFn: vi.fn() }));
vi.mock("@/server-functions/sales/offline-workbooks-fn", () => ({ forceRetireOfflineSalesWorkbookFn: vi.fn(), listOfflineSalesWorkbooksFn: vi.fn() }));
vi.mock("@/server-functions/inventory/add-warehouse.fn", () => ({ addWarehouseFn: mocks.warehouse }));
vi.mock("@/server-functions/inventory/update-warehouse-fn", () => ({ updateWarehouseFn: mocks.warehouse }));
vi.mock("@/server-functions/sales/invoices-fn", () => ({ createInvoiceFn: mocks.create, updateInvoiceFn: mocks.update, deleteInvoiceFn: mocks.remove, getInvoicesFn: vi.fn(), getInvoiceStatsFn: vi.fn() }));
vi.mock("@/server-functions/sales/invoice-detail-fn", () => ({ getInvoiceDetailFn: vi.fn() }));
vi.mock("@/server-functions/sales/sales-returns-fn", () => ({ createSalesReturnFn: vi.fn(), decideSalesReturnFn: mocks.process, completeSalesReturnFn: mocks.process, cancelSalesReturnFn: vi.fn(), voidSalesReturnFn: mocks.process }));
vi.mock("@/server-functions/sales/return-reasons-fn", () => ({ getReturnReasonsFn: vi.fn() }));
vi.mock("@/server-functions/manufacturing/cartons", () => ({ applyQcHoldFn: async () => ({}), releaseQcHoldFn: async () => ({}), dispatchCartonsFn: async () => ({}), processReturnFn: async () => ({}), closeBatchFn: async () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let client: QueryClient;
const keys = [["low-stock-alerts"], ["factory-floor"], ["item-detail", "finished", "recipe", 4]];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const line = { pack: "Pack", recipeId: "recipe", unitType: "units", numberOfUnits: 2, perCartonPrice: 120, retailPrice: 10 };
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({ id: "invoice", success: true });
  mocks.post.mockResolvedValue({ batchId: "batch", hasMore: false });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  for (const key of keys) client.setQueryData(key, []);
});
afterEach(() => { cleanup(); client.clear(); });
function refreshed() { for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true); }
describe("finished stock cache caller audit", () => {
  it("refreshes stock when closing a batch completes and receives an in-progress allocation", async () => {
    const { result } = renderHook(useCloseBatch, { wrapper });
    await act(async () => { await result.current.mutateAsync({ productionRunId: "allocation", acknowledgeShortfall: true }); });
    refreshed();
  });
  it("invalidates after offline posting dispatches physical stock", async () => {
    const { result } = renderHook(usePostOfflineSalesBatch, { wrapper });
    await act(async () => { await result.current.mutateAsync("batch"); });
    refreshed();
  });
  it.each(["create", "update"])("refreshes catalog alerts when warehouse %s changes the active floor scope", async action => {
    const input = { name: "Floor", type: "factory_floor" as const, address: "Address", city: "City", state: "State", latitude: "1", longitude: "1" };
    const { result } = renderHook(() => ({ create: useAddWarehouse(), update: useUpdateWarehouse() }), { wrapper });
    await act(async () => {
      if (action === "create") await result.current.create.mutateAsync({ data: input });
      else await result.current.update.mutateAsync({ data: { id: "floor", ...input } });
    });
    refreshed();
  });
  it("invalidates physical stock after invoice posting", async () => {
    const { result } = renderHook(useCreateInvoice, { wrapper });
    const validInput = createInvoiceSchema.parse({ customerId: "customer", warehouseId: "floor", items: [line] });
    await act(async () => { await result.current.mutateAsync(validInput); });
    refreshed();
  });
  it("invalidates after invoice stock reversal and redispatch", async () => {
    const { result } = renderHook(useUpdateInvoice, { wrapper });
    const validInput = updateInvoiceSchema.parse({ id: "invoice", warehouseId: "floor", items: [line] });
    await act(async () => { await result.current.mutateAsync(validInput); });
    refreshed();
  });
  it("invalidates after invoice deletion reverses dispatch", async () => {
    const { result } = renderHook(useDeleteInvoice, { wrapper });
    await act(async () => { await result.current.mutateAsync("invoice"); });
    refreshed();
  });
  it.each(["receive", "void"])("invalidates after sales return %s moves stock", async action => {
    const { result } = renderHook(() => ({ receive: useCompleteSalesReturn("invoice"), void: useVoidSalesReturn("invoice") }), { wrapper });
    await act(async () => {
      if (action === "receive") await result.current.receive.mutateAsync({ returnId: "return", lines: [{ returnItemId: "line", goodUnits: 1, damagedUnits: 0, expiredUnits: 0 }] });
      else await result.current.void.mutateAsync({ returnId: "return", reason: "Incorrect receipt" });
    });
    refreshed();
  });
  it.each(["approve", "reject"] as const)("does not refresh stock after return %s", async action => {
    const { result } = renderHook(() => useDecideSalesReturn("invoice"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ returnId: "return", action, reason: action === "reject" ? "Wrong item" : undefined }); });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it("does not refresh after a failed invoice mutation", async () => {
    mocks.remove.mockRejectedValue(new Error("Not allowed"));
    const { result } = renderHook(useDeleteInvoice, { wrapper });
    await act(async () => { await expect(result.current.mutateAsync("invoice")).rejects.toThrow("Not allowed"); });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
  it("covers existing carton hold/release, dispatch and return callbacks", async () => {
    const { result } = renderHook(() => ({ hold: useApplyQcHold("carton", "batch"), release: useReleaseQcHold("carton", "batch"), dispatch: useDispatch(), returned: useProcessReturn() }), { wrapper });
    const mutations = [
      () => result.current.hold.mutateAsync({ reason: "QC inspection" }),
      () => result.current.release.mutateAsync({ outcome: "CLEARED" }),
      () => result.current.dispatch.mutateAsync({ lines: [{ cartonId: "carton", packsToDispatch: 2 }], dispatchedBy: "actor" }),
      () => result.current.returned.mutateAsync({ dispatchOrderId: "dispatch", lines: [{ cartonId: "carton", packsReturned: 1, condition: "GOOD" }] }),
    ];
    for (const mutate of mutations) {
      for (const key of keys) client.setQueryData(key, []);
      await act(async () => { await mutate(); });
      refreshed();
    }
  });
});
