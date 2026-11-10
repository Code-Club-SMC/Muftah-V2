import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as ReturnsListRoute } from "@/routes/_protected/sales/returns/index";
import {
  buildReturnTimeline,
  Route as ReturnDetailRoute,
} from "@/routes/_protected/sales/returns/$returnId";
import type { SalesReturnDetail } from "@/hooks/sales/use-sales-returns";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  decide: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  void: vi.fn(),
  reasons: vi.fn(),
  permissions: ["*"] as string[],
  viewerData: undefined as { permissions: string[] } | undefined,
  viewerLoading: false,
  routeParams: { returnId: "ret-1" },
}));

vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
  createSalesReturnFn: vi.fn(),
  decideSalesReturnFn: mocks.decide,
  completeSalesReturnFn: mocks.complete,
  cancelSalesReturnFn: mocks.cancel,
  voidSalesReturnFn: mocks.void,
  listSalesReturnsFn: mocks.list,
  getSalesReturnDetailFn: mocks.detail,
}));

vi.mock("@/server-functions/sales/return-reasons-fn", () => ({
  getReturnReasonsFn: mocks.reasons,
  saveReturnReasonFn: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({
    data: mocks.viewerData ?? (mocks.viewerLoading ? undefined : { permissions: mocks.permissions }),
    isLoading: mocks.viewerLoading,
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => mocks.routeParams,
  Link: ({ children, to, params }: { children: React.ReactNode; to?: string; params?: Record<string, string> }) => (
    <a href={to ?? "#"} data-to={to} data-params={params ? JSON.stringify(params) : undefined}>
      {children}
    </a>
  ),
}));

let client: QueryClient;

function makeListResult(overrides: Partial<{
  rows: Array<{
    id: string;
    returnNumber: number;
    status: string;
    reason: string;
    totalAmount: string;
    createdAt: string;
    completedAt: string | null;
    invoiceId: string;
    invoiceNumber: string;
    customerName: string;
  }>;
  counts: { "to-approve": number; "to-receive": number; done: number; all: number };
  page: number;
  pageCount: number;
}> = {}) {
  return {
    rows: [
      {
        id: "ret-1",
        returnNumber: 42,
        status: "requested",
        reason: "Damaged in transit",
        totalAmount: "1500",
        createdAt: "2026-11-01T10:00:00.000Z",
        completedAt: null,
        invoiceId: "inv-1",
        invoiceNumber: "INV-101",
        customerName: "Al-Noor Traders",
      },
    ],
    counts: { "to-approve": 1, "to-receive": 2, done: 3, all: 6 },
    page: 1,
    pageCount: 1,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<Record<string, unknown>> = {}): SalesReturnDetail {
  return {
    id: "ret-1",
    returnNumber: 42,
    invoiceId: "inv-1",
    customerId: "cust-1",
    returnDate: new Date("2026-11-01T10:00:00.000Z"),
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    approvedAt: new Date("2026-11-01T11:00:00.000Z"),
    completedAt: null,
    cancelledAt: null,
    voidedAt: null,
    status: "approved",
    reason: "Damaged in transit",
    notes: "Carton corner crushed",
    rejectReason: null,
    cancelReason: null,
    voidReason: null,
    totalAmount: "1200",
    priceOverride: false,
    priceOverrideReason: null,
    invoice: {
      id: "inv-1",
      invoiceNumber: "INV-101",
      slipNumber: "S-101",
      totalPrice: "5000",
      invoiceDiscount: "0",
      status: "partially_paid",
      items: [],
    },
    customer: {
      id: "cust-1",
      name: "Al-Noor Traders",
      outstandingAmount: "3500",
    },
    createdBy: { id: "u1", name: "Ayesha" },
    approvedBy: { id: "u2", name: "Bilal" },
    receivedBy: null,
    cancelledBy: null,
    voidedBy: null,
    items: [
      {
        id: "line-1",
        invoiceItemId: "inv-item-1",
        cartonsReturned: 1,
        quantityReturned: 0,
        cartonsRequested: 1,
        quantityRequested: 0,
        goodUnits: 0,
        damagedUnits: 0,
        expiredUnits: 0,
        refundPerUnit: "120",
        totalRefund: "1200",
        invoiceItem: {
          id: "inv-item-1",
          pack: "Bottle 500ml",
          packsPerCarton: 10,
          actualPackSize: 1,
        },
        recipe: { id: "rec-1", name: "Mango Drink" },
      },
    ],
    stockTraces: [],
    ...overrides,
  } as unknown as SalesReturnDetail;
}

function mount(ui: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function clickTab(label: string | RegExp) {
  const tab = screen.getByRole("tab", { name: label });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permissions = ["*"];
  mocks.viewerData = undefined;
  mocks.viewerLoading = false;
  mocks.routeParams = { returnId: "ret-1" };
  mocks.list.mockResolvedValue(makeListResult());
  mocks.detail.mockResolvedValue(makeDetail());
  mocks.reasons.mockResolvedValue([
    { id: "r1", name: "Damaged in transit", requiresNote: false, isActive: true, sortOrder: 0 },
    { id: "r2", name: "Discontinued", requiresNote: true, isActive: false, sortOrder: 1 },
  ]);
  for (const m of [mocks.decide, mocks.complete, mocks.cancel, mocks.void]) {
    m.mockResolvedValue({ success: true });
  }
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  client.clear();
});

describe("SalesReturnsPage work queue", () => {
  const ListPage = ReturnsListRoute.options.component!;

  it("blocks access cleanly without sales.view and avoids loading return queries", () => {
    mocks.permissions = ["inventory.returns.receive"];
    mount(<ListPage />);
    expect(screen.getByRole("alert").textContent).toContain("Sales view permission is required");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.reasons).not.toHaveBeenCalled();
  });

  it("renders a loading skeleton while viewer permissions load instead of flashing an empty state", () => {
    mocks.viewerLoading = true;
    const { container } = mount(<ListPage />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(screen.queryByText("No returns waiting for approval")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("opens on To approve with tab counts, links to detail/invoice, and switches tabs cleanly", async () => {
    mount(<ListPage />);

    await screen.findByText("#42");
    expect(screen.getByRole("tab", { name: /To approve/ }).textContent).toContain("1");
    expect(screen.getByRole("tab", { name: /To receive/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Done/ }).textContent).toContain("3");
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toContain("6");
    expect(screen.getByText("#42").closest("a")?.getAttribute("data-to")).toBe("/sales/returns/$returnId");
    expect(screen.getByText("#INV-101").closest("a")?.getAttribute("data-to")).toBe("/sales/invoices/$invoiceId");
    expect(mocks.list).toHaveBeenCalledWith({
      data: { tab: "to-approve", search: undefined, reasonId: undefined, page: 1 },
    });

    mocks.list.mockResolvedValueOnce(
      makeListResult({
        rows: [
          {
            id: "ret-2",
            returnNumber: 43,
            status: "approved",
            reason: "Damaged in transit",
            totalAmount: "900",
            createdAt: "2026-11-02T10:00:00.000Z",
            completedAt: null,
            invoiceId: "inv-2",
            invoiceNumber: "INV-102",
            customerName: "Safa Mart",
          },
        ],
      }),
    );

    clickTab(/To receive/);
    await screen.findByText("#43");
    expect(mocks.list).toHaveBeenLastCalledWith({
      data: { tab: "to-receive", search: undefined, reasonId: undefined, page: 1 },
    });
  });

  it("debounces search and filters by active and inactive return reasons", async () => {
    mount(<ListPage />);
    await screen.findByText("#42");

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Return #, invoice # or customer"), {
      target: { value: "  INV-999 " },
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();

    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith({
        data: { tab: "to-approve", search: "INV-999", reasonId: undefined, page: 1 },
      }),
    );

    const trigger = screen.getByRole("combobox", { name: "Filter by reason" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const inactiveOption = await screen.findByRole("option", { name: "Discontinued (inactive)" });
    fireEvent.click(inactiveOption);

    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        data: { tab: "to-approve", search: "INV-999", reasonId: "r2", page: 1 },
      }),
    );
  });

  it("shows empty copy, query error retry, and pagination controls", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Database offline"));
    mount(<ListPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Database offline");

    mocks.list.mockResolvedValueOnce(
      makeListResult({ rows: [], counts: { "to-approve": 0, "to-receive": 0, done: 0, all: 0 } }),
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText("No returns waiting for approval");

    mocks.list.mockResolvedValueOnce(makeListResult({ page: 1, pageCount: 2 }));
    clickTab(/Done/);
    await screen.findByText("Page 1 of 2");

    mocks.list.mockResolvedValueOnce(makeListResult({ page: 2, pageCount: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        data: { tab: "done", search: undefined, reasonId: undefined, page: 2 },
      }),
    );
    await screen.findByText("Page 2 of 2");
  });

  it("loads return detail lazily when Receive is opened from a list row, retries failures, and preserves entries on raced terminal state", async () => {
    mocks.list.mockResolvedValue(
      makeListResult({
        rows: [
          {
            id: "ret-1",
            returnNumber: 42,
            status: "approved",
            reason: "Damaged in transit",
            totalAmount: "1200",
            createdAt: "2026-11-01T10:00:00.000Z",
            completedAt: null,
            invoiceId: "inv-1",
            invoiceNumber: "INV-101",
            customerName: "Al-Noor Traders",
          },
        ],
      }),
    );

    mount(<ListPage />);
    const receiveBtn = await screen.findByRole("button", { name: "Receive" });
    expect(mocks.detail).not.toHaveBeenCalled();

    mocks.detail.mockRejectedValueOnce(new Error("Temporary network timeout"));
    fireEvent.click(receiveBtn);

    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("button", { name: "Confirm receipt" }) as HTMLButtonElement).disabled).toBe(true);
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Temporary network timeout");

    mocks.detail.mockResolvedValueOnce(makeDetail({ status: "approved" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));

    await within(dialog).findByText("Bottle 500ml: requested 10 packs");
    for (const input of within(dialog).getAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).value).toBe("");
    }

    fireEvent.change(within(dialog).getByLabelText("Bottle 500ml good packs"), { target: { value: "6" } });
    mocks.detail.mockResolvedValueOnce(makeDetail({ status: "cancelled" }));
    mocks.complete.mockRejectedValueOnce(new Error("Return is cancelled"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));
    expect(
      await within(dialog).findByText(
        "This action is no longer available. Invoice details have refreshed; your entries are kept.",
      ),
    ).toBeTruthy();
    expect((within(dialog).getByLabelText("Bottle 500ml good packs") as HTMLInputElement).value).toBe("6");
    expect((within(dialog).getByRole("button", { name: "Confirm receipt" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("SalesReturnDetailPage and timeline", () => {
  const DetailPage = ReturnDetailRoute.options.component!;

  it("builds a chronological who-and-when timeline across every lifecycle state", () => {
    const timeline = buildReturnTimeline(
      makeDetail({
        status: "voided",
        completedAt: new Date("2026-11-02T14:00:00.000Z"),
        voidedAt: new Date("2026-11-03T09:00:00.000Z"),
        receivedBy: { id: "u3", name: "Hamza" },
        voidedBy: { id: "u2", name: "Bilal" },
        voidReason: "Entered against wrong invoice",
      }),
    );

    expect(timeline.map((step) => step.label)).toEqual([
      "Requested",
      "Approved",
      "Received and completed",
      "Voided",
    ]);
    expect(timeline[0].by).toBe("Ayesha");
    expect(timeline[2].by).toBe("Hamza");
    expect(timeline[3].note).toBe("Entered against wrong invoice");

    const rejected = buildReturnTimeline(
      makeDetail({ status: "rejected", rejectReason: "Sealed undamaged cartons", notes: null }),
    );
    expect(rejected.map((step) => step.label)).toEqual(["Requested", "Rejected"]);
    expect(rejected[1].note).toBe("Sealed undamaged cartons");
  });

  it("shows skeleton while viewer loads, handles errors with retry, and restricts without sales.view", async () => {
    mocks.viewerLoading = true;
    const { container, rerender } = mount(<DetailPage />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(screen.queryByText("Could not load return")).toBeNull();

    mocks.viewerLoading = false;
    mocks.permissions = ["inventory.view"];
    rerender(
      <QueryClientProvider client={client}>
        <DetailPage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Sales view permission is required");

    mocks.permissions = ["*"];
    mocks.detail.mockRejectedValueOnce(new Error("Return missing"));
    rerender(
      <QueryClientProvider client={client}>
        <DetailPage />
      </QueryClientProvider>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Return missing");
    expect(screen.getByText("Returns").closest("a")?.getAttribute("data-to")).toBe("/sales/returns");

    mocks.detail.mockResolvedValueOnce(makeDetail());
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText("Return #42");
  });

  it("renders unreceived items with dash cells, price override warning, and uses preloaded items on Receive", async () => {
    mocks.detail.mockResolvedValue(
      makeDetail({
        priceOverride: true,
        priceOverrideReason: "Manager approved full shelf rate",
      }),
    );

    mount(<DetailPage />);
    await screen.findByText("Return #42");
    expect(screen.getByRole("list", { name: "Return progress" })).toBeTruthy();
    expect(screen.getByText("If everything arrives")).toBeTruthy();
    expect(screen.getAllByText("Rs 1,200").length).toBe(2);
    expect(screen.getByText("Rs 3,500")).toBeTruthy();
    expect(screen.getByText(/Manager approved full shelf rate/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);

    expect(mocks.detail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bottle 500ml: requested 10 packs")).toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledTimes(1);

    fireEvent.change(within(dialog).getByLabelText("Bottle 500ml good packs"), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() =>
      expect(mocks.complete).toHaveBeenCalledWith({
        data: {
          returnId: "ret-1",
          notes: undefined,
          lines: [{ returnItemId: "line-1", goodUnits: 8, damagedUnits: 0, expiredUnits: 0 }],
        },
      }),
    );
  });

  it("renders inspected quantities, shortfall, stock traces, and void reversal wording for completed/voided returns", async () => {
    mocks.detail.mockResolvedValue(
      makeDetail({
        status: "voided",
        completedAt: new Date("2026-11-02T14:00:00.000Z"),
        voidedAt: new Date("2026-11-03T09:00:00.000Z"),
        receivedBy: { id: "u3", name: "Hamza" },
        voidedBy: { id: "u2", name: "Bilal" },
        voidReason: "Entered against wrong invoice",
        items: [
          {
            id: "line-1",
            invoiceItemId: "inv-item-1",
            cartonsReturned: 0,
            quantityReturned: 8,
            cartonsRequested: 1,
            quantityRequested: 0,
            goodUnits: 6,
            damagedUnits: 2,
            expiredUnits: 0,
            refundPerUnit: "120",
            totalRefund: "960",
            invoiceItem: {
              id: "inv-item-1",
              pack: "Bottle 500ml",
              packsPerCarton: 10,
              actualPackSize: 1,
            },
            recipe: { id: "rec-1", name: "Mango Drink" },
          },
        ],
        stockTraces: [
          {
            id: "t-1",
            kind: "receive",
            totalUnitsMoved: 6,
            destination: "sellable",
            recipe: { id: "rec-1", name: "Mango Drink" },
            warehouse: { id: "w-1", name: "Factory Floor" },
          },
          {
            id: "t-2",
            kind: "void",
            totalUnitsMoved: -6,
            destination: "sellable",
            recipe: { id: "rec-1", name: "Mango Drink" },
            warehouse: { id: "w-1", name: "Factory Floor" },
          },
        ],
      }),
    );

    mount(<DetailPage />);
    await screen.findByText("Reversed receipt");
    expect(screen.getByText("Rs 960")).toBeTruthy();
    expect(screen.getByText(/Receipt: added 6 packs to sellable stock/)).toBeTruthy();
    expect(screen.getByText(/Void: removed 6 packs from sellable stock/)).toBeTruthy();
    const row = screen.getByText("Bottle 500ml").closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "Bottle 500ml",
      "10 packs (1 carton)",
      "6",
      "2",
      "0",
      "2",
      "Rs 120",
      "Rs 960",
    ]);
  });
});
