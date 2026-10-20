import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
vi.mock("@/server-functions/reports/profit-loss/export-csv-fn", () => ({
  exportPnlCsvFn: vi.fn(),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuSeparator: () => null,
}));
import { PnlExportBar } from "@/components/reports/profit-loss/pnl-export-bar";
import {
  PnlPrintHeader,
  PnlBreakdownTable,
} from "@/components/reports/profit-loss/pnl-report-primitives";
afterEach(cleanup);
it("PDF explains browser saving before opening printing and rechecks disabled state", () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const { rerender } = render(
    <PnlExportBar source="offline_import" dateFrom="2026-10-13" dateTo="2026-10-13" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save as PDF" }));
  expect(screen.getByRole("status").textContent).toContain(
    "select Save as PDF",
  );
  expect(print).not.toHaveBeenCalled();
  rerender(<PnlExportBar disabled source="offline_import" />);
  for (const name of [
    "Export",
    "Download CSV",
    "Save as PDF",
    "Print Report",
    "Open print dialog",
  ])
    expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(
      true,
    );
  fireEvent.click(screen.getByRole("button", { name: "Open print dialog" }));
  expect(print).not.toHaveBeenCalled();
  rerender(<PnlExportBar source="offline_import" />);
  fireEvent.click(screen.getByRole("button", { name: "Open print dialog" }));
  expect(print).toHaveBeenCalledTimes(1);
  print.mockRestore();
});
it("applied print metadata has source, scope, PKT and operational basis; money is precise", () => {
  render(
    <>
      <PnlPrintHeader
        title="Recipe P&L"
        productName="Product A"
        recipeName="Recipe B"
        periodLabel="October"
        generatedAt="2026-10-13T19:00:00Z"
        source="Offline invoices"
        dateFrom="2026-10-13"
        dateTo="2026-10-13"
      />
      <PnlBreakdownTable
        summary={{
          totalRevenue: 1234.56,
          totalCogs: 0,
          grossProfit: -10.25,
          netProfit: -10.25,
        }}
      />
    </>,
  );
  expect(screen.getByText("Invoice source: Offline invoices")).toBeTruthy();
  expect(screen.getByText(/Generated:/).textContent).toContain(
    "14 Oct 2026, 00:00 PKT",
  );
  expect(screen.getByText(/Operational payment-based/)).toBeTruthy();
  expect(screen.getByText("1,234.56")).toBeTruthy();
  expect(screen.getByText("0.00")).toBeTruthy();
  expect(screen.getAllByText("-10.25").length).toBeGreaterThan(0);
});

import { OperatingExpensesSection } from "@/components/reports/profit-loss/company-profitability-overview";
it("operating expense deduction amounts retain cents, grouping and negative signs", () => {
  render(
    <OperatingExpensesSection
      metrics={[]}
      total={0}
      hasBreakdown
      deductionRows={[
        {
          type: "one",
          label: "Ordinary amount",
          description: "Detail",
          amount: 1234.56,
          impact: -1234.56,
        },
        {
          type: "zero",
          label: "Known zero",
          description: "Detail",
          amount: 0,
          impact: 0,
        },
        {
          type: "negative",
          label: "Correction",
          description: "Detail",
          amount: -10.25,
          impact: -10.25,
        },
      ]}
    />,
  );
  expect(screen.getByText("1,234.56")).toBeTruthy();
  expect(screen.getAllByText("0.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("-10.25").length).toBe(2);
});
