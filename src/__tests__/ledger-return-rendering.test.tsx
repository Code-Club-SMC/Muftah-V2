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

describe("store credit and refund rows in ledgers & exports", () => {
  const storeCreditPayment: LedgerEntry = {
    type: "payment",
    id: "pay-credit-1",
    date: new Date("2026-05-01"),
    reference: null,
    method: "customer_credit",
    isStoreCreditApplied: true,
    amount: 400,
    notes: null,
    runningBalance: 500,
    invoiceId: "inv-1",
    invoiceNumber: "INV-100",
  };

  const refundRow: LedgerEntry = {
    type: "refund",
    eventKind: "refund",
    id: "ref-1",
    date: new Date("2026-05-02"),
    amount: 600,
    creditNoteNumber: "CN-2026-0001",
    walletName: "Main Cash",
    notes: "Payout",
    runningBalance: 0,
  };

  const refundReversalRow: LedgerEntry = {
    type: "refund",
    eventKind: "refund_reversal",
    id: "ref-1:rev",
    date: new Date("2026-05-03"),
    amount: 600,
    creditNoteNumber: "CN-2026-0001",
    walletName: "Main Cash",
    reverseReason: "Wrong account",
    runningBalance: 0,
  };

  const customEntries: LedgerEntry[] = [storeCreditPayment, refundRow, refundReversalRow];

  beforeEach(() => {
    state.data = {
      entries: customEntries,
      summary,
      customer: { id: "customer", name: "Synthetic Customer", creditBalance: 1200 },
      salesman: { id: "salesman", name: "Synthetic Salesman" },
      page: 1,
      pageCount: 1,
      totalEntries: 3,
      generatedAt: new Date().toISOString(),
    };
  });

  it.each([
    ["distributor", distributor, 3, 4],
    ["shopkeeper", shopkeeper, 3, 4],
    ["salesman", salesman, 5, 4],
  ] as const)(
    "renders store credit and refunds in correct debit/credit columns on screen in %s",
    (_name, route, decreaseCol, increaseCol) => {
      const Page = route.options.component as React.ComponentType;
      render(<Page />);

      // Store credit applied row: both debit and credit are "—"
      const rows = screen.getAllByRole("row");
      const creditAppliedRow = rows.find(
        (r) => r.textContent?.includes("Store Credit") || r.textContent?.includes("customer_credit"),
      );
      expect(creditAppliedRow).toBeDefined();
      const creditAppliedCells = within(creditAppliedRow!).getAllByRole("cell");
      expect(creditAppliedCells[decreaseCol].textContent?.trim()).toBe("—");
      expect(creditAppliedCells[increaseCol].textContent?.trim()).toBe("—");

      // Refund row: renders on debt-increasing column (increaseCol), "—" on decreaseCol
      const refundEl = rows.find(
        (r) => r.textContent?.includes("Customer Refund") && !r.textContent?.includes("Reversal"),
      );
      expect(refundEl).toBeDefined();
      const refundCells = within(refundEl!).getAllByRole("cell");
      expect(refundCells[increaseCol].textContent).toContain("600");
      expect(refundCells[decreaseCol].textContent?.trim()).toBe("—");

      // Refund reversal row: renders on debt-decreasing column (decreaseCol), "—" on increaseCol
      const reversalEl = rows.find((r) => r.textContent?.includes("Customer Refund Reversal"));
      expect(reversalEl).toBeDefined();
      const reversalCells = within(reversalEl!).getAllByRole("cell");
      expect(reversalCells[decreaseCol].textContent).toContain("600");
      expect(reversalCells[increaseCol].textContent?.trim()).toBe("—");
    },
  );

  it("exports store credit as 0.00 and refund amounts in HTML print/pdf export", async () => {
    let html = "";
    const printWindow = {
      document: {
        write: (value: string) => {
          html = value;
        },
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(printWindow as any);
    render(
      <LedgerPrintExport
        title="Synthetic"
        entries={customEntries}
        summary={summary}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tbody > tr")];

    // Store credit row: both Debit (col 3) & Credit (col 4) are "0.00"
    const creditRow = rows.find((r) => r.textContent?.includes("Store Credit Applied"))!;
    expect(creditRow).toBeDefined();
    expect(creditRow.children[3].textContent?.trim()).toBe("0.00");
    expect(creditRow.children[4].textContent?.trim()).toBe("0.00");

    // Refund row: Debit (col 3) is "0.00", Credit (col 4) is "600.00"
    const refundDocRow = rows.find(
      (r) => r.textContent?.includes("REF-CN-2026-0001") && r.textContent?.includes("Customer Refund") && !r.textContent?.includes("Reversal"),
    )!;
    expect(refundDocRow).toBeDefined();
    expect(refundDocRow.children[3].textContent?.trim()).toBe("0.00");
    expect(refundDocRow.children[4].textContent?.trim()).toContain("600.00");

    // Refund reversal row: Debit (col 3) is "600.00", Credit (col 4) is "0.00"
    const reversalDocRow = rows.find((r) => r.textContent?.includes("Customer Refund Reversal"))!;
    expect(reversalDocRow).toBeDefined();
    expect(reversalDocRow.children[3].textContent?.trim()).toContain("600.00");
    expect(reversalDocRow.children[4].textContent?.trim()).toBe("0.00");
  });

  it("exports store credit as empty string and refund amounts in CSV export", async () => {
    let captured: Blob | undefined;
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        captured = blob;
        return "blob:test";
      },
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<LedgerPrintExport title="Synthetic" entries={customEntries} summary={summary} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    });
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(captured!);
    });
    const rows = text
      .split("\n")
      .map((row) => row.replace(/^\uFEFF/, "").slice(1, -1).split('","'));

    // Store credit: debit and credit are both empty ""
    const creditCsvRow = rows.find((r) => r[2]?.includes("Store Credit Applied"));
    expect(creditCsvRow).toBeDefined();
    expect(creditCsvRow!.slice(3, 5)).toEqual(["", ""]);

    // Refund: debit is "", credit is "600"
    const refundCsvRow = rows.find(
      (r) => r[1]?.includes("REF-CN-2026-0001") && r[2]?.includes("Customer Refund") && !r[2]?.includes("Reversal"),
    );
    expect(refundCsvRow).toBeDefined();
    expect(refundCsvRow!.slice(3, 5)).toEqual(["", "600"]);

    // Refund reversal: debit is "600", credit is ""
    const reversalCsvRow = rows.find((r) => r[2]?.includes("Customer Refund Reversal"));
    expect(reversalCsvRow).toBeDefined();
    expect(reversalCsvRow!.slice(3, 5)).toEqual(["600", ""]);
  });
});
