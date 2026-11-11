import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupByMaterial, PurchaseHistoryTable, type PurchaseRecord } from "@/components/suppliers/purchase-history-table";
import { PaymentRecordsTable } from "@/components/suppliers/payment-records-table";
import { PurchaseDetailsDialog } from "@/components/suppliers/purchase-details-dialog";

vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn(async () => []) }));
const purchase = {
  id: "void-purchase", createdAt: "2026-11-05", materialType: "chemical", quantity: "100", cost: "9000", paidAmount: "7000", unitCost: "90",
  chemicalId: "c", chemical: { id: "c", name: "Soda", unit: "kg", minimumStockLevel: "0" }, packagingMaterial: null, stockLeft: 0,
  voidedAt: "2026-11-06", voidReason: "Duplicate supplier entry", voidRefundAmount: "6500", voidRefundWalletId: "cash",
  voidedBy: { name: "Buyer" }, voidRefundWallet: { name: "Cash wallet" },
  voidSnapshot: { materialName: "Original Soda", unit: "kg", supplierName: "Original Supplier" },
};
const paymentForVoidedPurchase = {
  id: "payment", createdAt: "2026-11-05", amount: "7000", method: "cash", walletId: "cash", reference: null, notes: null, purchase,
};
function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["wallets"], [{ id: "cash", name: "Cash wallet" }]);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
afterEach(cleanup);
describe("retained void history", () => {
  it("keeps voids in groups but excludes their stock, quantity, cost and payments from active totals", () => {
    const active: PurchaseRecord = { ...purchase, id: "active", voidedAt: null, quantity: "20", cost: "1800", paidAmount: "800", stockLeft: 15 };
    const [group] = groupByMaterial([active, purchase]);
    expect(group.records).toHaveLength(2);
    expect(group).toMatchObject({ totalQty: 20, totalCost: 1800, totalPaid: 800, totalStockLeft: 15 });
  });
  it("shows original payments and separately labels the purchase refund and not-refunded amount", () => {
    show(<PaymentRecordsTable data={[paymentForVoidedPurchase]} />);
    expect(screen.getByText("Voided")).toBeTruthy();
    expect(screen.getByText(/7,000/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View payment details" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Duplicate supplier entry")).toBeTruthy();
    expect(within(dialog).getByText("Purchase refund").nextElementSibling?.textContent).toContain("6,500");
    expect(within(dialog).getByText("Not refunded").nextElementSibling?.textContent).toContain("500");
    expect(within(dialog).getByText("Amount Paid").nextElementSibling?.textContent).toContain("7,000");
    expect(within(dialog).getAllByText("Cash wallet").length).toBeGreaterThan(0);
  });
  it("offers details and permanent delete for a voided purchase, not edit, pay, report or restock", () => {
    show(<PurchaseHistoryTable data={[purchase]} setSelectedItem={vi.fn()} setDetailsOpen={vi.fn()} setEditDialogOpen={vi.fn()} setDeleteDialogOpen={vi.fn()} onRecordPayment={vi.fn()} onRestock={vi.fn()} onCreateReport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand group" }));
    expect(screen.queryByText("Restock")).toBeNull();
    expect(screen.queryByText("Buy Again")).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions menu" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getByRole("menuitem", { name: /View Details/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete purchase/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Edit|Record Payment|Void|Create report/ })).toBeNull();
  });
  it("shows actor, snapshot, original amounts and no active balance in purchase details", () => {
    show(<PurchaseDetailsDialog open onOpenChange={vi.fn()} purchase={purchase} />);
    expect(screen.getByText("Voided")).toBeTruthy();
    expect(screen.getByText("Buyer")).toBeTruthy();
    expect(screen.getByText("Original Supplier")).toBeTruthy();
    expect(screen.getByText("Original Soda")).toBeTruthy();
    expect(screen.queryByText("Remaining Balance")).toBeNull();
  });
});
