import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnedStockView } from "@/components/inventory/returned-stock/returned-stock-view";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), scrap: vi.fn(), sell: vi.fn(), setValue: vi.fn(), voidMovement: vi.fn(), wallets: vi.fn(),
  permissions: ["*"] as string[],
}));

vi.mock("@/server-functions/inventory/returned-stock-fn", () => ({
  getReturnedStockFn: mocks.list,
  scrapReturnedStockFn: mocks.scrap,
  sellReturnedStockFn: mocks.sell,
  setReturnedStockValueFn: mocks.setValue,
  voidReturnedStockMovementFn: mocks.voidMovement,
  getReturnedStockAccountsFn: mocks.wallets,
}));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  mocks.permissions = ["*"];
  mocks.list.mockResolvedValue({
    rows: [{ warehouseId: "w1", warehouseName: "Factory", recipeId: "r1", recipeName: "Mango 1L", condition: "damaged", units: 4, unitsPerCarton: 12, value: "20.00" }],
    movements: [{
      id: "m1", kind: "scrap", recipeName: "Mango 1L", warehouseName: "Factory", condition: "damaged", units: 1,
      valueRemoved: "5.00", unitPrice: null, saleAmount: null, lossAmount: "5.00", walletName: null, note: "Leaking",
      movementDate: new Date("2026-12-01T10:00:00Z"), performedByName: "Ali", voidedAt: null, voidedByName: null, voidReason: null,
    }],
  });
  mocks.wallets.mockResolvedValue([{ id: "cash", name: "Main Cash" }]);
  mocks.scrap.mockResolvedValue({ id: "m2" });
  mocks.setValue.mockResolvedValue({ id: "m3" });
  mocks.voidMovement.mockResolvedValue({ id: "m1" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

const mount = () => render(<QueryClientProvider client={client}><ReturnedStockView /></QueryClientProvider>);

describe("Returned Stock page", () => {
  it("lists stock and history, scraps with a loss preview, lowers value and voids", async () => {
    mount();
    const row = (await screen.findByRole("cell", { name: "Mango 1L" })).closest("tr")!;
    expect(within(row).getByText("Rs 20")).toBeTruthy();
    expect(within(row).getByText("Rs 5")).toBeTruthy(); // value per pack
    expect(screen.getByText("Scrapped")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Dispose" }));
    fireEvent.change(screen.getByLabelText("Packs"), { target: { value: "2" } });
    expect(await screen.findByText("Loss booked: Rs 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scrap 2 packs" }));
    await waitFor(() => expect(mocks.scrap).toHaveBeenCalledWith({
      data: { warehouseId: "w1", recipeId: "r1", condition: "damaged", units: 2, note: undefined },
    }));

    fireEvent.click(within(row).getByRole("button", { name: "Set value" }));
    fireEvent.change(screen.getByLabelText("Value per pack"), { target: { value: "2" } });
    expect(await screen.findByText(/Loss booked: Rs 12\b/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Boxes torn" } });
    fireEvent.click(screen.getByRole("button", { name: "Lower value" }));
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith({
      data: { warehouseId: "w1", recipeId: "r1", condition: "damaged", valuePerPack: 2, note: "Boxes torn" },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Pack was fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Void entry" }));
    await waitFor(() => expect(mocks.voidMovement).toHaveBeenCalledWith({ data: { movementId: "m1", reason: "Pack was fine" } }));
  });

  it("sells as seconds with account names for someone who can't view finance", async () => {
    mocks.permissions = ["inventory.view", "inventory.returns.dispose"];
    mocks.sell.mockResolvedValue({ id: "m4" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Dispose" }));
    expect(mocks.wallets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Sell as seconds"));
    fireEvent.change(screen.getByLabelText("Packs"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Price per pack"), { target: { value: "6" } });
    await waitFor(() => expect(mocks.wallets).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Money goes into" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Main Cash" }));
    expect(await screen.findByText("Rs 6 goes into Main Cash. Profit booked: Rs 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sell 1 pack" }));
    await waitFor(() => expect(mocks.sell).toHaveBeenCalledWith({
      data: { warehouseId: "w1", recipeId: "r1", condition: "damaged", units: 1, unitPrice: 6, walletId: "cash", note: undefined },
    }));
  });

  it("hides actions from people who can only view", async () => {
    mocks.permissions = ["inventory.view"];
    mount();
    await screen.findByRole("cell", { name: "Mango 1L" });
    expect(screen.queryByRole("button", { name: "Dispose" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set value" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });
});
