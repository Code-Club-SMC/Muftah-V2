import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompleteSupplierReturnDialog } from "@/components/suppliers/complete-supplier-return-dialog";
import { SupplierReturnsPanel } from "@/components/suppliers/supplier-returns-panel";

const fns = vi.hoisted(() => ({
  dispatch: vi.fn(async (_i: unknown) => ({ returnNumber: "SR-0001", quantity: "10.000" })),
  complete: vi.fn(async (_i: unknown) => ({ debitNoteNumber: "DN-0001", applied: "0.00", refund: "2000.00", credit: "3000.00" })),
}));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: vi.fn(),
  getPurchaseReturnableFn: vi.fn(),
  listSupplierReturnsFn: vi.fn(),
  getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(),
  dispatchSupplierReturnFn: fns.dispatch,
  completeSupplierReturnFn: fns.complete,
  cancelSupplierReturnFn: vi.fn(),
  voidSupplierReturnFn: vi.fn(),
  applySupplierCreditFn: vi.fn(),
}));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));

const row = {
  id: "r1",
  returnNumber: "SR-0001",
  status: "requested",
  requestedAt: new Date("2026-11-27"),
  dispatchedAt: null,
  completedAt: null,
  materialName: "Soda Ash",
  unit: "kg",
  warehouseName: "Main Store",
  quantity: "10.000",
  unitCost: "500.00",
  totalAmount: "5000.00",
  reason: "Wet",
  notes: null,
  debitNoteNumber: null,
  appliedToPurchaseAmount: "0.00",
  refundAmount: "0.00",
  refundWalletName: null,
  supplierCreditAmount: "0.00",
  purchaseInvoiceNumber: "INV-9",
  purchaseDate: new Date("2026-11-20"),
  cancelReason: null,
  voidReason: null,
  requestedByName: "Ahmed",
};

function client() {
  const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  c.setQueryData(["supplier-returns", "s1", "to_dispatch"], { rows: [row], counts: { to_dispatch: 1, dispatched: 0, done: 2 } });
  c.setQueryData(["wallets"], [{ id: "cash", name: "Cash in Hand", type: "cash", balance: "1000.00" }]);
  c.setQueryData(["debit-note-preview", "r1"], { value: "5000.00", owedBefore: "0.00", applied: "0.00", leftover: "5000.00", supplierName: "Ali Traders" });
  return c;
}

describe("Supplier returns tab", () => {
  afterEach(() => {
    cleanup();
    fns.dispatch.mockClear();
    fns.complete.mockClear();
  });

  it("opens on To dispatch with counts and one primary action", async () => {
    render(<QueryClientProvider client={client()}><SupplierReturnsPanel supplierId="s1" canManage /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "To dispatch (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done (2)" })).toBeTruthy();
    expect(screen.getByText("10 kg Soda Ash")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    await waitFor(() => expect(fns.dispatch).toHaveBeenCalledWith({ data: { id: "r1" } }));
  });

  it("hides actions from view-only users", () => {
    render(<QueryClientProvider client={client()}><SupplierReturnsPanel supplierId="s1" canManage={false} /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Mark as dispatched" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("shows the money consequence and splits cash back from credit before completing", async () => {
    render(<QueryClientProvider client={client()}><CompleteSupplierReturnDialog open onOpenChange={vi.fn()} returnId="r1" /></QueryClientProvider>);
    expect(screen.getByText("Rs 5,000 is more than this purchase still owes.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Cash back from supplier (PKR)"), { target: { value: "2000" } });
    expect(screen.getByText("Rs 3,000 stays with Ali Traders as supplier credit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete and issue debit note" }));
    await waitFor(() => expect(fns.complete).toHaveBeenCalledWith({ data: { id: "r1", cashBack: "2000", refundWalletId: "cash" } }));
  });
});
