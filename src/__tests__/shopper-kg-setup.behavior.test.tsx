import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AddPackagingMaterialForm } from "@/components/inventory/add-packaging-material-form";
import { EditMaterialDialog } from "@/components/inventory/edit-material-dialog";

vi.mock("@/hooks/inventory/use-add-packaging-material", () => ({ useAddPackagingMaterial: () => ({ mutateAsync: vi.fn(), status: "idle" }) }));
vi.mock("@/hooks/inventory/use-material-actions", () => ({ useUpdateMaterial: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/stock/use-material-lots", () => ({ useMaterialLots: () => ({ data: {}, isLoading: false }) }));
vi.mock("@/server-functions/suppliers/get-suppliers-fn", () => ({ getSuppliersFn: vi.fn() }));
vi.mock("@/server-functions/suppliers/update-purchase-record-fn", () => ({ updatePurchaseRecordFn: vi.fn() }));
vi.mock("@/server-functions/inventory/find-similar-materials-fn", () => ({ findSimilarMaterialsFn: vi.fn() }));
vi.mock("@/server-functions/inventory/get-inventory-fn", () => ({ getInventoryFn: vi.fn() }));
vi.mock("@/components/suppliers/payment-method-select", () => ({ PaymentMethodSelect: () => null }));

function wrap(children: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(["suppliers"], [{ id: "s1", supplierName: "Shopper Co" }]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("shoppers measured in KG", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(cleanup);

  it("asks for shopper weight and KG price when Measured in KG is on", () => {
    const warehouses = [{ id: "f1", name: "Floor", type: "factory_floor" }] as never;
    render(wrap(<AddPackagingMaterialForm onSuccess={vi.fn()} warehouses={warehouses} preselectedWarehouse="f1" />));
    fireEvent.click(screen.getByRole("switch", { name: "Measured in KG" }));
    expect(screen.getByLabelText("Weight of one shopper (grams)")).toBeTruthy();
    expect(screen.getByLabelText("Price per KG (PKR)")).toBeTruthy();
    expect(screen.getByLabelText("Initial stock (KG)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Weight of one shopper (grams)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Price per KG (PKR)"), { target: { value: "520" } });
    expect(screen.queryByText("The Golden Formula")).toBeNull();
    expect(screen.queryByLabelText("Cost Per Unit (PKR)")).toBeNull();
  });

  it("shows the switch locked in the edit dialog once the item has stock", () => {
    const item = { id: "st1", warehouseId: "f1", quantity: "10", packagingMaterial: { id: "p1", name: "100g shopper", type: "primary", costPerUnit: "2", minimumStockLevel: 0, measuredInKg: false } };
    render(wrap(<EditMaterialDialog open onOpenChange={vi.fn()} type="packaging" item={item} />));
    const toggle = screen.getByRole("switch", { name: "Measured in KG" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Locked: this material already has stock or history.")).toBeTruthy();
  });
});
