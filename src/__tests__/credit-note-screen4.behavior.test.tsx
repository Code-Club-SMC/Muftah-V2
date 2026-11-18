import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditNotePrintDialog } from "@/components/sales/credit-note-print-dialog";
import { ReturnLifecycleActions } from "@/components/sales/return-lifecycle-actions";
import { formatVoidBlockedByRefundError } from "@/lib/sales/returns/return-lifecycle";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  voidRet: vi.fn(),
  issueRefund: vi.fn(),
  wallets: vi.fn(),
  detail: vi.fn(),
  permissions: ["*"] as string[],
}));

vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
  createSalesReturnFn: vi.fn(),
  decideSalesReturnFn: vi.fn(),
  completeSalesReturnFn: mocks.complete,
  cancelSalesReturnFn: vi.fn(),
  voidSalesReturnFn: mocks.voidRet,
  listSalesReturnsFn: vi.fn(),
  getSalesReturnDetailFn: mocks.detail,
}));

vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
  getCustomerCreditSummaryFn: vi.fn(),
  issueCustomerRefundFn: mocks.issueRefund,
  reverseCustomerRefundFn: vi.fn(),
}));

vi.mock("@/server-functions/finance-fn", () => ({
  getWalletsListFn: mocks.wallets,
}));

vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to?: string; params?: Record<string, string> }) => (
    <a href={to ?? "#"} data-to={to} data-params={params ? JSON.stringify(params) : undefined}>
      {children}
    </a>
  ),
}));

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
    { id: "w-cash", name: "Main Cash", type: "cash", balance: "100.00" },
  ]);
  mocks.complete.mockResolvedValue({
    success: true,
    creditNoteNumber: "CN-2026-0001",
    totalAmount: 1000,
    appliedToInvoiceAmount: 400,
    customerCreditAmount: 600,
    customerId: "cust-1",
    customerName: "Khan Distributors",
    customerType: "distributor",
    invoiceNumber: "INV-100",
    leftoverCreditBalance: 600,
  });
  mocks.issueRefund.mockResolvedValue({
    id: "ref-1",
    walletName: "Main Cash",
  });
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

describe("Screen 4 credit note settlement & void-blocked UX", () => {
  it("opens Screen 4 on completion with split, lazily loads wallets on refund selection, and retries after overdraw confirmation", async () => {
    mount(
      <ReturnLifecycleActions
        invoiceId="inv-1"
        returnId="ret-1"
        status="approved"
        items={[{ id: "li-1", label: "Bottle", approvedUnits: 5 }]}
      />,
    );
    expect(mocks.wallets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));

    await screen.findByText(/CN-2026-0001/);
    expect(screen.getByText(/Khan Distributors/)).toBeTruthy();
    expect(mocks.wallets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Refund Cash \/ Bank Now/i }));
    await waitFor(() => expect(mocks.wallets).toHaveBeenCalledTimes(1));

    const walletTrigger = screen.getByRole("combobox", { name: /Refund from account/i });
    fireEvent.keyDown(walletTrigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Main Cash/ }));

    mocks.issueRefund.mockRejectedValueOnce(new Error("OVERDRAW_CONFIRM_REQUIRED:Main Cash:100.00"));
    fireEvent.click(screen.getByRole("button", { name: /Record refund/i }));

    await screen.findByText("This account will go below zero");
    expect(screen.getByText(/after this refund/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(mocks.issueRefund).toHaveBeenCalledTimes(2));
    expect(mocks.issueRefund).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        customerId: "cust-1",
        amount: 600,
        walletId: "w-cash",
        salesReturnId: "ret-1",
        allowOverdraw: true,
      }),
    });
  });

  it("hides Refund Cash / Bank option when user lacks finance.refunds.issue", async () => {
    mocks.permissions = ["sales.view", "inventory.returns.receive"];
    mount(
      <ReturnLifecycleActions
        invoiceId="inv-1"
        returnId="ret-1"
        status="approved"
        items={[{ id: "li-1", label: "Bottle", approvedUnits: 5 }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));

    await screen.findByText(/CN-2026-0001/);
    expect(screen.queryByRole("button", { name: /Refund Cash \/ Bank Now/i })).toBeNull();
    expect(screen.getByText(/finance\.refunds\.issue/i)).toBeTruthy();
  });

  it("shows customer profile link when void is blocked by active refunds", async () => {
    mocks.voidRet.mockRejectedValueOnce(
      formatVoidBlockedByRefundError({
        refundedAmount: 600,
        customerId: "cust-99",
        customerName: "Khan Distributors",
        customerType: "distributor",
      }),
    );
    mount(<ReturnLifecycleActions invoiceId="inv-1" returnId="ret-1" status="completed" />);

    fireEvent.click(screen.getByRole("button", { name: "Void receipt" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong item inspected" } });
    fireEvent.click(screen.getByRole("button", { name: "Void receipt" }));

    const link = await screen.findByRole("link", { name: /Open customer profile to reverse refund/i });
    expect(link.getAttribute("data-to")).toBe("/sales/people/distributors/$customerId");
    expect(link.getAttribute("data-params")).toContain("cust-99");
  });

  it("renders formal credit note details and split in CreditNotePrintDialog when open", async () => {
    mocks.detail.mockResolvedValue({
      id: "ret-1",
      returnNumber: 12,
      creditNoteNumber: "CN-2026-0005",
      creditNoteIssuedAt: "2026-11-11T10:00:00.000Z",
      completedAt: "2026-11-11T10:00:00.000Z",
      status: "completed",
      reason: "Damaged box",
      totalAmount: "1000.00",
      appliedToInvoiceAmount: "300.00",
      customerCreditAmount: "700.00",
      invoice: { id: "inv-1", invoiceNumber: "INV-101", date: "2026-11-01" },
      customer: { id: "c-1", name: "Al-Noor Traders", city: "Lahore", mobileNumber: "0300-1112233" },
      items: [
        {
          id: "ri-1",
          goodUnits: 5,
          damagedUnits: 0,
          expiredUnits: 0,
          refundPerUnit: "200.00",
          totalRefund: "1000.00",
          invoiceItem: { id: "ii-1", pack: "Mango 1L" },
        },
      ],
      refunds: [],
    });
    mount(<CreditNotePrintDialog open onOpenChange={vi.fn()} returnId="ret-1" />);
    await screen.findByText("CN-2026-0005");
    expect(screen.getByText(/Al-Noor Traders/)).toBeTruthy();
    expect(screen.getByText(/Mango 1L/)).toBeTruthy();
  });

  it("escapes dynamic customer and item values against HTML injection when printing credit note", async () => {
    const mockDocumentWrite = vi.fn();
    const mockDocumentClose = vi.fn();
    const mockOpen = vi.spyOn(window, "open").mockReturnValue({
      document: {
        write: mockDocumentWrite,
        close: mockDocumentClose,
      },
    } as unknown as Window);

    mocks.detail.mockResolvedValue({
      id: "ret-xss",
      returnNumber: 99,
      creditNoteNumber: "CN-2026-9999",
      creditNoteIssuedAt: "2026-11-11T10:00:00.000Z",
      status: "completed",
      totalAmount: "500.00",
      appliedToInvoiceAmount: "500.00",
      customerCreditAmount: "0.00",
      invoice: { id: "inv-99", invoiceNumber: "INV-<99>&", date: "2026-11-01" },
      customer: {
        id: "c-xss",
        name: '<script>alert("xss")</script> & "Co"',
        city: 'City <"Lahore">',
        mobileNumber: "0300-0000000",
      },
      items: [
        {
          id: "ri-xss",
          goodUnits: 1,
          damagedUnits: 0,
          expiredUnits: 0,
          refundPerUnit: "500.00",
          totalRefund: "500.00",
          invoiceItem: { id: "ii-xss", pack: 'Drink <Pack> & "Bottles"' },
        },
      ],
      refunds: [],
    });

    mount(<CreditNotePrintDialog open onOpenChange={vi.fn()} returnId="ret-xss" />);
    await screen.findByText("CN-2026-9999");

    fireEvent.click(screen.getByRole("button", { name: /Print credit note/i }));

    expect(mockOpen).toHaveBeenCalled();
    expect(mockDocumentWrite).toHaveBeenCalledTimes(1);
    const html = mockDocumentWrite.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;Co&quot;");
    expect(html).toContain("Drink &lt;Pack&gt; &amp; &quot;Bottles&quot;");
    expect(html).toContain("City &lt;&quot;Lahore&quot;&gt;");
    expect(html).toContain("INV-&lt;99&gt;&amp;");
    expect(mockDocumentClose).toHaveBeenCalled();

    mockOpen.mockRestore();
  });
});
