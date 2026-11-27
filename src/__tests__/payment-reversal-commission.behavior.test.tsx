import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reverse: vi.fn(), commission: vi.fn() }));
vi.mock("@/server-functions/sales/payment-settlement-fn", () => ({
  getPendingPaymentVerificationFn: mocks.list,
  confirmBankTransferFn: vi.fn(), clearChequeFn: vi.fn(), returnChequeFn: vi.fn(), cancelBankTransferFn: vi.fn(),
  reversePaymentFn: mocks.reverse,
  getPaymentCommissionFn: mocks.commission,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PaymentVerificationPage } from "@/components/finance/payment-verification-page";

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.list.mockResolvedValue({ data: [{
    id: "p1", amount: "200000.00", method: "cheque", status: "confirmed", paymentDate: new Date("2026-10-10"), effectiveDate: new Date("2026-10-10"), ageDays: 3,
    invoice: { id: "i1", invoiceNumber: "INV-1", paymentDueDate: null }, customer: { id: "c1", name: "Shop" },
  }], total: 1, pageCount: 1 });
  mocks.reverse.mockResolvedValue({ id: "p1" });
});
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={client}><PaymentVerificationPage /></QueryClientProvider>);

async function openReverse() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Cheque bounced" } });
}

describe("Reversing a payment that earned commission", () => {
  it("asks who bears it, defaults to the booker, and sends the choice", async () => {
    mocks.commission.mockResolvedValue({ amount: 4000, orderBookerName: "Bilal Ahmed" });
    await openReverse();
    expect(await screen.findByText(/Commission on this payment: Rs 4,000 \(Bilal Ahmed\)/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Deduct from booker" }) as HTMLInputElement).getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("radio", { name: "Company bears the loss" }));
    fireEvent.click(screen.getByRole("button", { name: "Reverse payment" }));
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalled());
    expect(mocks.reverse.mock.calls[0][0].data).toMatchObject({ paymentId: "p1", commissionBearer: "company" });
  });

  it("does not ask when the payment earned no commission", async () => {
    mocks.commission.mockResolvedValue(null);
    await openReverse();
    await waitFor(() => expect(mocks.commission).toHaveBeenCalled());
    expect(screen.queryByText(/Who bears it/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reverse payment" }));
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalled());
    expect(mocks.reverse.mock.calls[0][0].data.commissionBearer).toBe("booker");
  });
});
