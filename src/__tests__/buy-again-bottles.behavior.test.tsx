import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddStockForm } from "@/components/inventory/add-stock-dialog-form";
import type { PurchaseRecord } from "@/components/suppliers/purchase-history-table";

vi.mock("@/hooks/stock/use-add-stock", () => ({ useAddStock: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/stock/use-material-lots", () => ({ useMaterialLots: () => ({ data: {}, isLoading: false }) }));
vi.mock("@/server-functions/inventory/get-materials-fn", () => ({ getMaterialsFn: vi.fn() }));
vi.mock("@/server-functions/suppliers/get-suppliers-fn", () => ({ getSuppliersFn: vi.fn() }));
vi.mock("@/server-functions/inventory/get-inventory-fn", () => ({ getInventoryFn: vi.fn() }));
vi.mock("@/components/suppliers/payment-method-select", () => ({ PaymentMethodSelect: () => null }));

const bottle = { id: "b1", name: "500ml bottle", type: "primary", measuredInKg: false, weightPerPack: "25.000", pricePerKg: "480", costPerUnit: "12", stock: [] };
const shopper = { id: "s1", name: "100g shopper", type: "primary", measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520", stock: [] };
const carton = { id: "c1", name: "Carton 24", type: "master", measuredInKg: false, weightPerPack: null, pricePerKg: null, costPerUnit: "40", stock: [] };

// A past purchase as the supplier's purchase history passes it to "Buy Again".
const purchase = (material: { id: string; name: string; type: string }, quantity: string, cost: string): PurchaseRecord => ({
  id: `p-${material.id}`, createdAt: "2026-10-20", cost, paidAmount: "0", quantity, unitCost: "0", materialType: "packaging",
  paymentMethod: "pay_later", packagingMaterial: { ...material, capacity: null, capacityUnit: null, minimumStockLevel: 0 },
});

function buyAgain(record: PurchaseRecord) {
  const client = new QueryClient();
  client.setQueryData(["materials"], { chemicals: [], packagings: [bottle, shopper, carton] });
  client.setQueryData(["suppliers"], [{ id: "sup1", supplierName: "Bottle Co" }]);
  const warehouses = [{ id: "f1", name: "Floor", type: "factory_floor" }] as never;
  render(
    <QueryClientProvider client={client}>
      <AddStockForm onOpenChange={vi.fn()} onSuccess={vi.fn()} warehouses={warehouses} preselectedWarehouse="f1" itemToRestock={record} preselectedSupplierId="sup1" />
    </QueryClientProvider>,
  );
}
const value = (text: string) => screen.getByDisplayValue(text) as HTMLInputElement;

describe("Buy Again", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(cleanup);

  it("fills a bottle as count × price per piece, with no weight fields", async () => {
    buyAgain(purchase(bottle, "1000", "12000"));
    await waitFor(() => expect(value("12.00")).toBeTruthy());
    expect(value("1000")).toBeTruthy();
    expect(value("12000")).toBeTruthy();
    expect(screen.queryByText(/Weight/)).toBeNull();
    expect(screen.queryByText(/Price\/Kg/)).toBeNull();
    expect(screen.getByText("Formula: Price/Unit * Qty")).toBeTruthy();
  });

  it("recomputes the bottle total when the count changes", async () => {
    buyAgain(purchase(bottle, "1000", "12000"));
    await waitFor(() => expect(value("12.00")).toBeTruthy());
    fireEvent.change(value("1000"), { target: { value: "2500" } });
    await waitFor(() => expect(value("30000")).toBeTruthy());
  });

  it("prices a bottle bought with the old weight formula at its real price per piece", async () => {
    // 1,000 bottles of 25 g at Rs 480/kg were saved as Rs 12,000.
    buyAgain(purchase(bottle, "1000", "12000"));
    await waitFor(() => expect(value("12.00")).toBeTruthy());
    expect(screen.queryByDisplayValue("480.00")).toBeNull();
  });

  it("keeps a KG shopper on KG × price per KG", async () => {
    buyAgain(purchase(shopper, "20", "10400"));
    await waitFor(() => expect(value("520.00")).toBeTruthy());
    expect(value("10400")).toBeTruthy();
    expect(screen.getByText("Qty (KG)")).toBeTruthy();
    expect(screen.getByText("Formula: KG × Price/KG")).toBeTruthy();
  });

  it("fills a carton the same way as a bottle", async () => {
    buyAgain(purchase(carton, "50", "2000"));
    await waitFor(() => expect(value("40.00")).toBeTruthy());
    expect(value("2000")).toBeTruthy();
    expect(screen.getByText("Formula: Price/Unit * Qty")).toBeTruthy();
  });
});
