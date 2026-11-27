import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordPaymentDialog } from "@/components/suppliers/record-payment-dialog";

const credit = vi.hoisted(() => vi.fn(async (_i: unknown) => ({ paymentId: "pay1", balanceAfter: "1000.00" })));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: vi.fn(),
  getPurchaseReturnableFn: vi.fn(),
  listSupplierReturnsFn: vi.fn(),
  getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(),
  dispatchSupplierReturnFn: vi.fn(),
  completeSupplierReturnFn: vi.fn(),
  cancelSupplierReturnFn: vi.fn(),
  voidSupplierReturnFn: vi.fn(),
  applySupplierCreditFn: credit,
}));
vi.mock("@/server-functions/suppliers/add-payment-fn", () => ({ addPaymentFn: vi.fn() }));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn(async () => []) }));

function open(supplierCredit?: string, outstandingBalance = 21000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPaymentDialog
        open
        onOpenChange={vi.fn()}
        supplierId="s1"
        supplierName="Ali Traders"
        outstandingBalance={outstandingBalance}
        purchaseId="p2"
        defaultAmount={String(outstandingBalance)}
        supplierCredit={supplierCredit}
      />
    </QueryClientProvider>,
  );
}

describe("Use supplier credit", () => {
  afterEach(() => {
    cleanup();
    credit.mockClear();
  });

  it("offers the credit and asks before using it", async () => {
    open("3000.00");
    expect(screen.getByText("Supplier credit Rs 3,000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use supplier credit" }));
    expect(credit).not.toHaveBeenCalled();
    expect(screen.getByText(/Rs 18,000 will still be owed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use Rs 3,000 credit" }));
    await waitFor(() => expect(credit).toHaveBeenCalledWith({ data: { purchaseId: "p2", amount: "3000.00" } }));
  });

  it("goes back without using the credit", () => {
    open("3000.00");
    fireEvent.click(screen.getByRole("button", { name: "Use supplier credit" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(credit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use supplier credit" })).toBeTruthy();
  });

  it("uses no more than the purchase still owes", async () => {
    open("3000.00", 1200);
    fireEvent.click(screen.getByRole("button", { name: "Use supplier credit" }));
    expect(screen.getByText(/Nothing will be owed on it after this/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use Rs 1,200 credit" }));
    await waitFor(() => expect(credit).toHaveBeenCalledWith({ data: { purchaseId: "p2", amount: "1200.00" } }));
  });

  it("hides the offer when there is no credit", () => {
    open("0.00");
    expect(screen.queryByRole("button", { name: "Use supplier credit" })).toBeNull();
  });
});
