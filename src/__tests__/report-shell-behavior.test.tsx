import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ReportPageShell } from "@/components/reports/report-page-shell";
import { currentReportMonth } from "@/lib/report-dates";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock("@/components/reports/offline-report-pending-banner", () => ({
  OfflineReportPendingBanner: () => null,
}));
vi.mock("@/components/custom/date-range-picker", () => ({
  DatePickerWithRange: ({ onDateChange }: any) => (
    <button
      onClick={() =>
        onDateChange({ from: new Date(2020, 0, 1), to: new Date(2020, 0, 2) })
      }
    >
      Change dates
    </button>
  ),
}));
afterEach(cleanup);
const m = currentReportMonth();
const props = {
  title: "Sales",
  subtitle: "Invoices",
  onGenerate: vi.fn(),
  isLoading: false,
  isEmpty: true,
  applied: { dateFrom: m.from, dateTo: m.to },
  generatedAt: 1791878400000,
  basis: "Current balances",
  children: <p>Rows</p>,
};
describe("report shell export behavior", () => {
  it("prints successful empty report with stable applied metadata", () => {
    render(<ReportPageShell {...props} />);
    expect(
      (screen.getByRole("button", { name: "Print" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText("No records for this selection.")).toBeTruthy();
    expect(screen.getByText(/Generated:/).textContent).toContain("PKT");
  });
  it("disables draft exports while retaining applied document", () => {
    render(<ReportPageShell {...props} />);
    fireEvent.click(screen.getByText("Change dates"));
    expect(
      (screen.getByRole("button", { name: "Print" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/Filters changed/)).toBeTruthy();
    expect(document.querySelector("[data-report-document]")).toBeTruthy();
  });
  it("failed refresh has Retry and no printable zero report", () => {
    render(<ReportPageShell {...props} error={new Error("Network failed")} />);
    expect(screen.getByRole("alert").textContent).toContain("Network failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(document.querySelector("[data-report-document]")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Print" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("PDF continuation also becomes disabled on a failed refresh", () => {
    const view = render(<ReportPageShell {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as PDF" }));
    view.rerender(<ReportPageShell {...props} error={new Error("Failed")} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Open print dialog",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
