import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAddChemical } from "@/hooks/inventory/use-add-raw-material";
import { useUpdateMaterial } from "@/hooks/inventory/use-material-actions";
import { useTransferStock } from "@/hooks/stock/use-transfer-stock";
import { useCreateMixingRun } from "@/hooks/manufacturing/mixing/use-mixing-mutations";
import { EditPurchaseDialog } from "@/components/suppliers/edit-purchase-dialog";
import { DeletePurchaseDialog } from "@/components/suppliers/delete-purchase-dialog";

const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), transfer: vi.fn(), edit: vi.fn(), void: vi.fn(), mixing: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/server-functions/inventory/add-chemical-fn", () => ({ addRawMaterialFn: mocks.add }));
vi.mock("@/server-functions/inventory/update-material-fn", () => ({ updateMaterialFn: mocks.update }));
vi.mock("@/server-functions/inventory/delete-material-fn", () => ({ deleteMaterialFn: vi.fn() }));
vi.mock("@/server-functions/inventory/stock/transfer-stock-fn", () => ({ transferStockFn: mocks.transfer }));
vi.mock("@/server-functions/suppliers/update-purchase-record-fn", () => ({ updatePurchaseRecordFn: mocks.edit }));
vi.mock("@/server-functions/suppliers/delete-purchase-record-fn", () => ({ deletePurchaseRecordFn: mocks.void }));
vi.mock("@/server-functions/suppliers/get-purchase-edit-state-fn", () => ({ getPurchaseEditStateFn: vi.fn(async () => ({ stockLocked: false, refund: { paid: "0.00", walletId: null } })) }));
vi.mock("@/server-functions/manufacturing/mixing/create-mixing-run-fn", () => ({ createMixingRunFn: mocks.mixing }));
vi.mock("@/server-functions/manufacturing/mixing/start-mixing-run-fn", () => ({ startMixingRunFn: vi.fn() }));
vi.mock("@/server-functions/manufacturing/mixing/log-mixing-progress-fn", () => ({ logMixingProgressFn: vi.fn() }));
vi.mock("@/server-functions/manufacturing/mixing/complete-mixing-run-fn", () => ({ completeMixingRunFn: vi.fn() }));
vi.mock("@/server-functions/manufacturing/mixing/cancel-mixing-run-fn", () => ({ cancelMixingRunFn: vi.fn() }));
vi.mock("@/server-functions/manufacturing/mixing/fail-mixing-run-fn", () => ({ failMixingRunFn: vi.fn() }));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));

let client: QueryClient;
const detailKey = ["item-detail", "chemical", "c", 4];
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [mocks.add, mocks.update, mocks.transfer, mocks.edit, mocks.void, mocks.mixing]) fn.mockResolvedValue({ success: true });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  for (const key of [["factory-floor"], ["low-stock-alerts"], detailKey]) client.setQueryData(key, { quantity: "10" });
});
afterEach(() => { cleanup(); client.clear(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

function observe() {
  const stock = vi.fn(async () => ({ quantity: "20" }));
  const alerts = vi.fn(async () => ({ quantity: "20" }));
  renderHook(() => {
    useQuery({ queryKey: ["factory-floor"], queryFn: stock });
    useQuery({ queryKey: ["low-stock-alerts"], queryFn: alerts });
  }, { wrapper });
  return { stock, alerts };
}
function assertRefreshed(observed: ReturnType<typeof observe>) {
  expect(observed.stock).toHaveBeenCalledTimes(1);
  expect(observed.alerts).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
}

describe("stock mutation cache entry points", () => {
  it("refreshes observed stock/alerts and stales inactive detail after adding chemicals", async () => {
    const observed = observe();
    const { result } = renderHook(useAddChemical, { wrapper });
    await act(async () => { await result.current.mutateAsync({ data: { name: "Soda", warehouseId: "floor", quantity: "10", costPerUnit: "2", unit: "kg", minimumStockLevel: "0", supplierId: "s", paymentMethod: "pay_later", paymentStatus: "unpaid", packagingType: "", packagingSize: "", notes: "", invoiceNumber: "", walletId: "", amountPaid: "", transactionId: "", bankName: "" } }); });
    assertRefreshed(observed);
  });
  it("refreshes after a threshold edit", async () => {
    const observed = observe();
    const { result } = renderHook(useUpdateMaterial, { wrapper });
    await act(async () => { await result.current.mutateAsync({ data: { id: "c", type: "chemical", data: { name: "Soda", costPerUnit: "2", minimumStockLevel: "5" } } }); });
    assertRefreshed(observed);
  });
  it("refreshes after stock transfer", async () => {
    const observed = observe();
    const { result } = renderHook(useTransferStock, { wrapper });
    await act(async () => { await result.current.mutateAsync({ data: { fromWarehouseId: "floor", toWarehouseId: "storage", materialType: "chemical", materialId: "c", quantity: "2", looseUnits: "0", notes: "", lotPicks: [{ lotId: "lot", quantity: "2" }] } }); });
    assertRefreshed(observed);
  });
  it("does not refresh stock or announce creation for a business failure", async () => {
    mocks.mixing.mockResolvedValue({ success: false, shortages: [] });
    const observed = observe();
    const { result } = renderHook(useCreateMixingRun, { wrapper });
    await act(async () => { await result.current.mutateAsync({ data: { formulaId: "f", warehouseId: "floor", operatorId: "operator" } }); });
    expect(observed.stock).not.toHaveBeenCalled();
    expect(observed.alerts).not.toHaveBeenCalled();
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
  it.each(["edit", "delete"] as const)("refreshes after the real purchase %s dialog succeeds", async action => {
    const observed = observe();
    client.setQueryData(["purchase-edit-state", "p"], { stockLocked: false, alreadyVoided: false, hasLabReports: false, refund: { paid: "0.00", walletId: null } });
    const props = { open: true, onOpenChange: vi.fn(), purchase: { id: "p", materialType: "chemical", cost: "20", unitCost: "2", quantity: "10" } };
    render(action === "edit" ? <EditPurchaseDialog {...props} /> : <DeletePurchaseDialog {...props} />, { wrapper });
    if (screen.queryByLabelText("Reason")) fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Duplicate supplier entry" } });
    fireEvent.click(screen.getByRole("button", { name: action === "edit" ? "Save Changes" : /Delete purchase/i }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    assertRefreshed(observed);
  });
  it("does not fetch disabled inventory queries for an unauthorized observer", async () => {
    const stock = vi.fn();
    renderHook(() => useQuery({ queryKey: ["factory-floor"], queryFn: stock, enabled: false }), { wrapper });
    const { result } = renderHook(useUpdateMaterial, { wrapper });
    await act(async () => { await result.current.mutateAsync({ data: { id: "c", type: "chemical", data: { name: "Soda", costPerUnit: "2", minimumStockLevel: "5" } } }); });
    expect(stock).not.toHaveBeenCalled();
  });
});
