import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestSupplierReturnSheet } from "@/components/suppliers/request-supplier-return-sheet";

const requestFn = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ id: "r1", returnNumber: "SR-0001", totalAmount: "5000.00" })));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: requestFn,
  getPurchaseReturnableFn: vi.fn(),
  listSupplierReturnsFn: vi.fn(),
  getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(),
  dispatchSupplierReturnFn: vi.fn(),
  completeSupplierReturnFn: vi.fn(),
  cancelSupplierReturnFn: vi.fn(),
  voidSupplierReturnFn: vi.fn(),
  applySupplierCreditFn: vi.fn(),
}));

const returnable = {
  purchaseId: "p1",
  supplierId: "s1",
  supplierName: "Ali Traders",
  materialName: "Soda Ash",
  unit: "kg",
  warehouseName: "Main Store",
  unitCost: "500.00",
  stockLeft: "30.000",
  pendingRequested: "0.000",
  max: "30.000",
  blockedReason: null as string | null,
};

function open(data: typeof returnable) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["purchase-returnable", "p1"], data);
  return render(
    <QueryClientProvider client={client}>
      <RequestSupplierReturnSheet open onOpenChange={vi.fn()} purchaseId="p1" />
    </QueryClientProvider>,
  );
}

describe("Return to supplier sheet", () => {
  afterEach(() => {
    cleanup();
    requestFn.mockClear();
  });

  it("shows what can go back and the debit note value as you type", () => {
    open(returnable);
    expect(screen.getByText("Up to 30 kg left of this purchase in Main Store")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "10" } });
    expect(screen.getByText("Debit note value: Rs 5,000")).toBeTruthy();
  });

  it("blocks more than the maximum", () => {
    open(returnable);
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "31" } });
    expect(screen.getByText("Only 30 kg can go back")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request return" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends quantity and reason", async () => {
    open(returnable);
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Why is it going back?"), { target: { value: "Wet bags" } });
    fireEvent.click(screen.getByRole("button", { name: "Request return" }));
    await waitFor(() =>
      expect(requestFn).toHaveBeenCalledWith({ data: { purchaseId: "p1", quantity: "10", reason: "Wet bags", notes: "" } }),
    );
  });

  it("explains why a purchase can't be returned", () => {
    open({ ...returnable, max: "0.000", blockedReason: "A voided purchase can't be returned." });
    expect(screen.getByText("A voided purchase can't be returned.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request return" })).toBeNull();
  });
});
