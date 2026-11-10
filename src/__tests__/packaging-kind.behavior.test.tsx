import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StockTable } from "@/components/inventory/stock-table";
import { EditMaterialDialog } from "@/components/inventory/edit-material-dialog";
import { AddPackagingMaterialForm } from "@/components/inventory/add-packaging-material-form";

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), purchase: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/inventory/use-material-actions", () => ({ useDeleteMaterial: () => ({ mutateAsync: vi.fn() }), useUpdateMaterial: () => ({ mutateAsync: mocks.update }) }));
vi.mock("@/hooks/inventory/use-add-packaging-material", () => ({ useAddPackagingMaterial: () => ({ mutateAsync: mocks.create, status: "idle" }) }));
vi.mock("@/hooks/stock/use-material-lots", () => ({ useMaterialLots: () => ({ data: {}, isLoading: false }) }));
vi.mock("@/server-functions/suppliers/get-suppliers-fn", () => ({ getSuppliersFn: vi.fn() }));
vi.mock("@/server-functions/suppliers/update-purchase-record-fn", () => ({ updatePurchaseRecordFn: mocks.purchase }));
vi.mock("@/server-functions/inventory/get-inventory-fn", () => ({ getInventoryFn: vi.fn() }));
vi.mock("@/server-functions/inventory/find-similar-materials-fn", () => ({ findSimilarMaterialsFn: async () => [] }));
vi.mock("@/components/suppliers/payment-method-select", () => ({ PaymentMethodSelect: () => null }));
vi.mock("@/components/inventory/add-raw-material-sheet", () => ({ AddRawMaterialDialog: () => null }));
vi.mock("@/components/inventory/add-packaging-material-dialog", () => ({ AddPackagingMaterialDialog: () => null }));
vi.mock("@/components/inventory/lab-reports/lab-reports-list", () => ({ LabReportsList: () => null }));

let client: QueryClient;
const warehouses = [{ id: "floor", name: "Floor", type: "factory_floor" }] as never;
const date = new Date("2026-11-05");
const material = { id: "pkg", name: "Existing shopper", type: "primary", packagingKind: "shopper", capacity: "100", capacityUnit: "g", costPerUnit: "520", minimumStockLevel: 0, measuredInKg: true, weightPerPack: "6.5", createdAt: date, updatedAt: date };
const item = { id: "stock", warehouseId: "floor", quantity: "10.000", createdAt: date, updatedAt: date, warehouse: { name: "Floor", isActive: true }, packagingMaterial: material };
const wrap = (children: React.ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ success: true });
  mocks.create.mockResolvedValue({ id: "pkg" });
  mocks.purchase.mockResolvedValue({ success: true });
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["suppliers"], [{ id: "supplier", supplierName: "Supplier" }]);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); });
function choose(label: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Packaging kind" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("explicit packaging kinds", () => {
  it("renders the real table with specific and truthful legacy labels, keeping units unchanged", () => {
    const data = [
      { ...item, id: "bottle", packagingMaterial: { ...material, name: "Bottle item", packagingKind: "bottle", measuredInKg: false } },
      { ...item, id: "bucket", packagingMaterial: { ...material, name: "Bucket item", type: "master", packagingKind: "bucket", measuredInKg: false } },
      { ...item, id: "legacy", packagingMaterial: { ...material, name: "Legacy bucket", type: "master", packagingKind: null, measuredInKg: false } },
      { ...item, id: "primary", packagingMaterial: { ...material, name: "Legacy pack", packagingKind: null } },
    ] as never;
    render(wrap(<StockTable data={data} type="packaging" warehouses={[]} preselectedWarehouse={undefined} hideAddButton hideActions />));
    for (const label of ["Bottle", "Bucket", "Master packaging", "Primary packaging"]) expect(screen.getByText(label)).toBeTruthy();
    expect(within(screen.getByText("Legacy bucket").closest("tr")!).getByText("PCS")).toBeTruthy();
    expect(within(screen.getByText("Legacy pack").closest("tr")!).getByText("KG")).toBeTruthy();
  });
  it.each(["Bucket", "Unspecified"])("saves %s as metadata without stock adjustment or unit/role changes", async label => {
    render(wrap(<EditMaterialDialog open onOpenChange={vi.fn()} type="packaging" item={item} />));
    choose(label);
    fireEvent.click(screen.getByRole("button", { name: "Update Material" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const payload = mocks.update.mock.calls[0][0].data;
    expect(payload.stock).toBeUndefined();
    expect(payload.data).toMatchObject({ packagingKind: label === "Bucket" ? "bucket" : null, materialType: "primary", measuredInKg: true });
  });
  it("creates an explicitly classified master bucket without changing the role or PCS", async () => {
    render(wrap(<AddPackagingMaterialForm onSuccess={vi.fn()} warehouses={warehouses} preselectedWarehouse="floor" preselectedSupplierId="supplier" />));
    fireEvent.click(screen.getByRole("button", { name: "Carton" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. 10kg Bucket"), { target: { value: "New bucket" } });
    fireEvent.change(screen.getByLabelText("Initial Stock"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Cost Per Unit (PKR)"), { target: { value: "2" } });
    choose("Bucket");
    fireEvent.click(screen.getByRole("button", { name: "Save Material" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ type: "master", packagingKind: "bucket", measuredInKg: false });
  });
  it("keeps the kind on purchase edit and allows clearing it", async () => {
    render(wrap(<AddPackagingMaterialForm onSuccess={vi.fn()} warehouses={warehouses} preselectedWarehouse="floor" initialValues={{ purchaseId: "p", name: "Bucket", quantity: "10", unitCost: "2", paidAmount: "0", minimumStockLevel: 0, type: "master", packagingKind: "bucket" } as never} />));
    expect(screen.getByRole("combobox", { name: "Packaging kind" }).textContent).toContain("Bucket");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.purchase).toHaveBeenCalledOnce());
    expect(mocks.purchase.mock.calls[0][0].data.packagingKind).toBe("bucket");
    choose("Unspecified");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.purchase).toHaveBeenCalledTimes(2));
    expect(mocks.purchase.mock.calls[1][0].data.packagingKind).toBeNull();
  });
});
