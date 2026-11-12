import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerCreditSection } from "@/components/sales/customer-credit-section";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  issueRefund: vi.fn(),
  reverseRefund: vi.fn(),
  wallets: vi.fn(),
  permissions: ["*"] as string[],
}));

vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
  getCustomerCreditSummaryFn: mocks.summary,
  issueCustomerRefundFn: mocks.issueRefund,
  reverseCustomerRefundFn: mocks.reverseRefund,
}));

vi.mock("@/server-functions/finance-fn", () => ({
  getWalletsListFn: mocks.wallets,
}));

vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.permissions = ["*"];
  mocks.wallets.mockResolvedValue([
    { id: "w-1", name: "Petty Cash", type: "cash", balance: "50.00" },
  ]);
  mocks.summary.mockResolvedValue({
    customerId: "c-1",
    creditBalance: 1200,
    lots: [
      {
        id: "lot-1",
        sourceType: "sales_return",
        creditNoteNumber: "CN-2026-0001",
        originalAmount: "1200.00",
        remainingAmount: "1200.00",
        status: "active",
        createdAt: "2026-11-10T10:00:00.000Z",
      },
    ],
    refunds: [
      {
        id: "ref-1",
        amount: "300.00",
        status: "active",
        refundDate: "2026-11-10T11:00:00.000Z",
        creditNoteNumber: "CN-2026-0001",
        wallet: { id: "w-1", name: "Petty Cash" },
        issuedBy: { id: "u-1", name: "Admin" },
        notes: "Paid customer via cash",
      },
    ],
    movements: [
      {
        id: "m-1",
        movementType: "credit_issued",
        amount: "1200.00",
        balanceAfter: "1200.00",
        creditNoteNumber: "CN-2026-0001",
        createdAt: "2026-11-10T10:00:00.000Z",
        notes: "Overpayment from return",
      },
    ],
  });
  mocks.issueRefund.mockResolvedValue({ id: "ref-2", walletName: "Petty Cash" });
  mocks.reverseRefund.mockResolvedValue({ success: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  client.clear();
});

function mount(ui: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("CustomerCreditSection", () => {
  it("shows store credit balance, credit note lots, and opens refund modal with overdraw guard", async () => {
    mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
    await screen.findByText("Credit Lots (1)");

    fireEvent.click(screen.getByRole("button", { name: /Issue Refund/i }));
    await waitFor(() => expect(mocks.wallets).toHaveBeenCalledTimes(1));

    const trigger = screen.getByRole("combobox", { name: /Refund account/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Petty Cash/ }));

    fireEvent.change(screen.getByLabelText(/Refund amount/i), { target: { value: "1200" } });
    mocks.issueRefund.mockRejectedValueOnce(new Error("OVERDRAW_CONFIRM_REQUIRED:Petty Cash:50.00"));
    fireEvent.click(screen.getByRole("button", { name: /Confirm refund/i }));

    await screen.findByText("This account will go below zero");
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(mocks.issueRefund).toHaveBeenCalledTimes(2));
    expect(mocks.issueRefund).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        customerId: "c-1",
        amount: 1200,
        walletId: "w-1",
        allowOverdraw: true,
      }),
    });
  });

  it("allows finance users to reverse an active refund with a reason", async () => {
    mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
    await screen.findByText("Reverse refund");

    fireEvent.click(screen.getByRole("button", { name: "Reverse refund" }));
    fireEvent.change(screen.getByLabelText(/Reversal reason/i), {
      target: { value: "Wrong account selected" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm reversal/i }));

    await waitFor(() => expect(mocks.reverseRefund).toHaveBeenCalledTimes(1));
    expect(mocks.reverseRefund).toHaveBeenCalledWith({
      data: { refundId: "ref-1", reason: "Wrong account selected" },
    });
  });

  it("hides Issue Refund and Reverse refund buttons when user lacks finance permissions", async () => {
    mocks.permissions = ["sales.view"];
    mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
    await screen.findByText("Credit Lots (1)");

    expect(screen.queryByRole("button", { name: /Issue Refund/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reverse refund/i })).toBeNull();
  });

  it("respects fine-grained permissions: finance.refunds.issue and finance.payments.reverse", async () => {
    mocks.permissions = ["finance.refunds.issue"];
    const { unmount } = mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
    await screen.findByText("Credit Lots (1)");
    expect(screen.getByRole("button", { name: /Issue Refund/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Reverse refund/i })).toBeNull();
    unmount();

    mocks.permissions = ["finance.payments.reverse"];
    mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
    await screen.findByText("Credit Lots (1)");
    expect(screen.queryByRole("button", { name: /Issue Refund/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Reverse refund/i })).toBeDefined();
  });
});
