import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), booker: vi.fn(), navigate: vi.fn() }));
vi.mock("@/server-functions/sales/recovery-commission-fn", () => ({
  getCommissionMonthSummaryFn: mocks.summary,
  getBookerCommissionMonthFn: mocks.booker,
}));
vi.mock("@/server-functions/sales/payment-settlement-fn", () => ({ getPaymentCommissionFn: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

import { CommissionSummary } from "@/components/sales/commission/commission-summary";
import { BookerCommissionTab } from "@/components/sales/commission/booker-commission-tab";

const row = (name: string, earned: number, delivered: number) => ({
  orderBookerId: name.toLowerCase(), name, delivered, returned: 0, collected: earned * 50, earned, stillOwed: 100000, waiting: 2000,
});
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-15T12:00:00+05:00"), toFake: ["Date"] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.summary.mockResolvedValue({
    month: "2026-10",
    rows: [row("Bilal Ahmed", 19600, 1240000), row("Usman Tariq", 11850, 850000)],
    total: { delivered: 2090000, returned: 0, collected: 1572500, earned: 31450, stillOwed: 200000, waiting: 4000 },
  });
  mocks.booker.mockResolvedValue({
    summary: { delivered: 500000, returned: 100000, collected: 200000, earned: 3400, stillOwed: 195000, waiting: 3900 },
    invoices: [{
      invoiceId: "inv1", invoiceNumber: "INV-7", date: new Date("2026-10-05"), delivered: 500000, returned: 100000, collected: 200000,
      stillOwed: 195000, rate: 2, mode: "recovery", earnedSoFar: 3400,
      entries: [
        { id: "e1", kind: "payment", bearer: null, entryDate: new Date("2026-10-20"), base: 200000, amount: 4000, paymentMethod: "cheque", note: null },
        { id: "e2", kind: "payment_reversal", bearer: "booker", entryDate: new Date("2026-10-28"), base: -30000, amount: -600, paymentMethod: "cheque", note: "Bounced" },
      ],
    }],
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

describe("Commission summary", () => {
  it("shows every column for the current month with a total row, sorts, and opens a booker", async () => {
    wrap(<CommissionSummary />);
    expect(await screen.findByText("Bilal Ahmed")).toBeTruthy();
    expect(mocks.summary).toHaveBeenCalledWith({ data: { month: "2026-10" } });
    for (const header of ["Order Booker", "Delivered", "Returned", "Collected", "Earned", "Still owed", "Waiting"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
    }
    const rows = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(rows().at(-1)).toBe("Total");
    fireEvent.click(screen.getByRole("button", { name: /Earned/ }));
    expect(rows().slice(0, 2)).toEqual(["Usman Tariq", "Bilal Ahmed"]);
    expect(rows().at(-1)).toBe("Total");
    fireEvent.click(screen.getByText("Bilal Ahmed"));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/sales/people/order-bookers/$orderBookerId", params: { orderBookerId: "bilal ahmed" }, search: { month: "2026-10" } });
  });

  it("moves to the previous month", async () => {
    wrap(<CommissionSummary />);
    await screen.findByText("Bilal Ahmed");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(mocks.summary).toHaveBeenLastCalledWith({ data: { month: "2026-09" } });
  });
});

describe("Booker Commission tab", () => {
  it("shows the four headline numbers, the invoice list with the locked rate, and each payment's commission line", async () => {
    wrap(<BookerCommissionTab orderBookerId="b1" month="2026-10" onMonthChange={() => {}} />);
    const totals = await screen.findByRole("region", { name: "Month totals" });
    for (const label of ["Delivered", "Collected", "Earned", "Waiting"]) expect(within(totals).getByText(label)).toBeTruthy();
    expect(await within(totals).findByText("Rs 3,400")).toBeTruthy();
    expect(screen.getByText("INV-7")).toBeTruthy();
    expect(screen.getByText("2%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show payments for INV-7" }));
    expect(screen.getByText("Payment received")).toBeTruthy();
    expect(screen.getByText("Reversed payment (deducted from booker)")).toBeTruthy();
    expect(screen.getByText("Bounced")).toBeTruthy();
  });
});
