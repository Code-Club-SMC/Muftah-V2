import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type MonthlyReportCellTarget,
  MonthlyReportDetailSheet,
} from "@/components/reports/monthly/monthly-report-detail-sheet";
import { MonthlyReportTable } from "@/components/reports/monthly/monthly-report-table";
import { ReportDocumentHeader, ReportPrintStyles } from "@/components/reports/report-document";
import { SummaryCard } from "@/components/reports/report-primitives";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportDateKey } from "@/lib/report-dates";
import {
  fiscalYearLabel,
  fiscalYearRange,
  fiscalYearStartFor,
  formatLac,
  monthlyReportCsv,
} from "@/lib/reports/monthly-report";
import { getMonthlyReportFn } from "@/server-functions/reports/monthly-report-fn";

const YEARS_SHOWN = 5;
const PRINT_CSS = "@media print { @page { size: A4 landscape; margin: 8mm; } }";

export const Route = createFileRoute("/_protected/reports/monthly/")({
  component: MonthlyReportPage,
});

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function MonthlyReportPage() {
  const [thisYear] = useState(() => fiscalYearStartFor(reportDateKey(new Date())));
  const [startYear, setStartYear] = useState(thisYear);
  const [cell, setCell] = useState<MonthlyReportCellTarget | null>(null);
  const { data: report, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["reports", "monthly", startYear],
    queryFn: () => getMonthlyReportFn({ data: { startYear } }),
  });
  const years = Array.from({ length: YEARS_SHOWN }, (_, index) => thisYear - index);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="print:hidden">
        <Link to="/reports" className="text-sm">
          Back to Reports
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Monthly Report</h1>
        <p className="text-sm text-muted-foreground">
          Sale, consumption and result for each month of the July–June year.
        </p>
        <div className="flex flex-wrap items-center gap-3 py-4">
          <Select value={String(startYear)} onValueChange={(value) => setStartYear(Number(value))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {fiscalYearLabel(year)} (Jul–Jun)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={!report || isFetching} onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="outline"
            disabled={!report || isFetching}
            onClick={() =>
              report && downloadCsv(`monthly-report-${report.label}.csv`, monthlyReportCsv(report))
            }
          >
            Excel
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="space-y-2 border p-5">
          <p>Report could not be loaded. {error instanceof Error ? error.message : ""}</p>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : !report ? (
        <p role="status">Generating report…</p>
      ) : (
        <div data-report-document className="report-content space-y-6 pb-8">
          <ReportDocumentHeader
            title="Monthly Report"
            scope={report.label}
            period={{ dateFrom: fiscalYearRange(report.startYear).from, dateTo: fiscalYearRange(report.startYear).to }}
            generatedAt={dataUpdatedAt}
            periodLabel="Financial year"
            basis="Sales by invoice date; credit is what is still unpaid today. Raw material and packing by batch completion date. Salaries by payroll month. Expenses by expense date, one row per expense category. Purchases are shown for reference and are not added to consumption."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 print:grid-cols-5">
            <SummaryCard label="Total sale (lac)" value={formatLac(report.summary.totalSale)} accentColor="emerald" />
            <SummaryCard label="Consumption (lac)" value={formatLac(report.summary.totalConsumption)} accentColor="amber" />
            <SummaryCard
              label="Difference (lac)"
              value={formatLac(report.summary.difference)}
              accentColor={report.summary.difference < 0 ? "rose" : "emerald"}
              highlight
            />
            <SummaryCard
              label="Without credit (lac)"
              value={formatLac(report.summary.withoutCredit)}
              accentColor={report.summary.withoutCredit < 0 ? "rose" : "emerald"}
              highlight
            />
            <SummaryCard label="Weight sold (ton)" value={report.summary.weightTon.toFixed(2)} accentColor="blue" />
          </div>
          <MonthlyReportTable
            report={report}
            onCellClick={(line, index) => setCell({ line, month: report.months[index] })}
          />
          <p className="text-xs text-muted-foreground">
            * current month, still running. – month not started yet. Click any number to see its records.
          </p>
        </div>
      )}

      <MonthlyReportDetailSheet target={cell} onClose={() => setCell(null)} />
      <ReportPrintStyles />
      <style>{PRINT_CSS}</style>
    </main>
  );
}
