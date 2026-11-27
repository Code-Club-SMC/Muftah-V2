import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnLifecycleActions } from "@/components/sales/return-lifecycle-actions";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), detail: vi.fn() }));

vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
  createSalesReturnFn: vi.fn(),
  decideSalesReturnFn: vi.fn(),
  completeSalesReturnFn: mocks.complete,
  cancelSalesReturnFn: vi.fn(),
  voidSalesReturnFn: vi.fn(),
  listSalesReturnsFn: vi.fn(),
  getSalesReturnDetailFn: mocks.detail,
}));
vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
  getCustomerCreditSummaryFn: vi.fn(),
  issueCustomerRefundFn: vi.fn(),
  reverseCustomerRefundFn: vi.fn(),
}));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: ["*"] } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  mocks.detail.mockResolvedValue({
    id: "ret-1",
    status: "approved",
    items: [{
      id: "ri-1",
      cartonsRequested: 0,
      quantityRequested: 3,
      invoiceItem: {
        pack: "Mango 1L", packsPerCarton: 1, actualPackSize: 1,
        costOfGoodsSold: "30.00", costOfGoodsSoldPerUnit: "10.0000", perCartonPrice: "10",
        dispatchedUnits: 3, numberOfCartons: 0, quantity: 3,
      },
    }],
  });
  mocks.complete.mockResolvedValue({ id: "ret-1" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ReturnLifecycleActions invoiceId="inv-1" returnId="ret-1" status="approved"
        items={[{ id: "ri-1", label: "Mango 1L", approvedUnits: 3 }]} />
    </QueryClientProvider>,
  );
}

describe("Screen 3 salvage value", () => {
  it("asks for salvage only for damaged packs, shows the loss and sends it", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Mango 1L good packs"), { target: { value: "1" } });
    expect(screen.queryByLabelText("Mango 1L damaged salvage per pack")).toBeNull();

    fireEvent.change(screen.getByLabelText("Mango 1L damaged packs"), { target: { value: "2" } });
    const salvage = await screen.findByLabelText("Mango 1L damaged salvage per pack");
    expect(await screen.findByText("Loss booked: Rs 20")).toBeTruthy();
    fireEvent.change(salvage, { target: { value: "3" } });
    expect(await screen.findByText("Loss booked: Rs 14")).toBeTruthy();

    fireEvent.change(salvage, { target: { value: "11" } });
    expect(await screen.findByText(/salvage value Rs 22\.00 is more than what these 2 packs cost/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm receipt" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(salvage, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    expect(mocks.complete).toHaveBeenCalledWith({
      data: {
        returnId: "ret-1",
        notes: undefined,
        lines: [{ returnItemId: "ri-1", goodUnits: 1, damagedUnits: 2, expiredUnits: 0, damagedSalvagePerUnit: 3 }],
      },
    });
  });
});
