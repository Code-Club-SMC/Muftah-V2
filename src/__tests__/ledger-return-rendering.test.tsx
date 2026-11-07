import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerPrintExport } from "@/components/sales/ledger-print-export";
import type { LedgerEntry, LedgerSummary } from "@/lib/ledger-types";
import { Route as distributor } from "@/routes/_protected/sales/people/distributors/$customerId/ledger";
import { Route as shopkeeper } from "@/routes/_protected/sales/people/shopkeepers/$customerId/ledger";
import { Route as salesman } from "@/routes/_protected/sales/people/salesmen/$salesmanId/ledger";

const state = vi.hoisted(() => ({ data: {} as any }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data }) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useParams: () => ({ customerId: "customer", salesmanId: "salesman" }) }),
  useRouter: () => ({ navigate: vi.fn() }),
}));
vi.mock("@/server-functions/sales/ledger-fn", () => ({ generateDistributorLedgerFn: vi.fn(), generateShopkeeperLedgerFn: vi.fn(), generateSalesmanLedgerFn: vi.fn() }));
vi.mock("@/components/custom/date-range-picker", () => ({ DatePickerWithRange: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { DropdownMenu: wrap, DropdownMenuContent: wrap, DropdownMenuLabel: wrap, DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: wrap, DropdownMenuItem: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button> };
});

const entries: LedgerEntry[] = [
  { type: "return", eventKind: "return", id: "r1:return", date: new Date("2026-03-01"), returnNumber: 7, invoiceId: "i1", invoiceNumber: "INV-1", amount: 200,
    reason: "Synthetic", condition: "good", status: "voided", notes: null, runningBalance: 700 },
  { type: "return", eventKind: "void", id: "r1:void", date: new Date("2026-04-01"), returnNumber: 7, invoiceId: "i1", invoiceNumber: "INV-1", amount: 200,
    reason: "Synthetic", condition: "good", status: "voided", notes: null, runningBalance: 900 },
];
const summary: LedgerSummary = { openingBalance: 900, closingBalance: 900, periodTotalSales: 0, periodPayments: 0, periodReturns: 0, periodTotalProfit: -60, invoiceCount: 0, paymentCount: 0 };

beforeEach(() => { state.data = { entries, summary, customer: { id: "customer", name: "Synthetic" }, salesman: { id: "salesman", name: "Synthetic" }, page: 1, pageCount: 1, totalEntries: 2, generatedAt: new Date().toISOString() }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("return direction on existing ledger screens and exports", () => {
  it.each([["distributor", distributor, 3, 4], ["shopkeeper", shopkeeper, 3, 4], ["salesman", salesman, 5, 4]] as const)("renders receipt and void on opposite columns in %s", (_name, route, receiptColumn, voidColumn) => {
    const Page = route.options.component as React.ComponentType;
    render(<Page />);
    const rows = screen.getAllByRole("row").filter(row => /Return.*#7/.test(row.textContent ?? ""));
    expect(rows).toHaveLength(2);
    const cells = rows.map(row => within(row).getAllByRole("cell"));
    expect(cells[0][receiptColumn].textContent).toContain("200");
    expect(cells[0][voidColumn].textContent).toBe("—");
    expect(cells[1][receiptColumn].textContent).toBe("—");
    expect(cells[1][voidColumn].textContent).toContain("200");
    expect(rows[0].textContent).not.toContain("Void");
    expect(rows[1].textContent).toContain("Void");
  });

  it.each(["Print", "Save as PDF"])("puts void in Credit with positive magnitude and correct totals for %s", async action => {
    let html = "";
    const printWindow = { document: { write: (value: string) => { html = value; }, close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(printWindow as any);
    const loadEntriesForExport = vi.fn().mockResolvedValue(entries);
    render(<LedgerPrintExport title="Synthetic" entries={[]} summary={summary} loadEntriesForExport={loadEntriesForExport} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: action })); });
    expect(loadEntriesForExport).toHaveBeenCalledWith(action === "Print" ? "print" : "pdf");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tbody > tr")];
    const receipt = rows.find(row => row.textContent?.includes("RET-7"))!;
    const reversal = rows.find(row => row.textContent?.includes("VOID-7"))!;
    expect(receipt.children[3].textContent).toContain("200.00");
    expect(receipt.children[4].textContent).toBe("0.00");
    expect(reversal.children[3].textContent).toBe("0.00");
    expect(reversal.children[4].textContent).toContain("200.00");
    expect(reversal.textContent).toContain("Sales Return Void");
    const totals = rows.at(-1)!;
    expect(totals.children[1].textContent).toContain("200.00");
    expect(totals.children[2].textContent).toContain("1,100.00");
    expect(totals.children[3].textContent).toContain("900.00 Cr");
  });

  it("exports both event kinds in CSV with opposite columns and unchanged closing debt", async () => {
    let captured: Blob | undefined;
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { captured = blob; return "blob:test"; }, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<LedgerPrintExport title="Synthetic" entries={entries} summary={summary} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Download CSV" })); });
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(captured!); });
    const rows = text.split("\n").map(row => row.replace(/^\uFEFF/, "").slice(1, -1).split('\",\"'));
    expect(rows.find(row => row[1] === "RET-7")!.slice(3, 5)).toEqual(["200", ""]);
    expect(rows.find(row => row[1] === "VOID-7")!.slice(3, 5)).toEqual(["", "200"]);
    expect(rows.at(-1)!.slice(3, 6)).toEqual(["PKR 200.00", "PKR 1,100.00", "PKR 900.00 Cr"]);
  });
});
