import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import type { DateRange } from "react-day-picker";
import { currentReportMonth, datePickerKey } from "@/lib/report-dates";
import { reportCanExport } from "@/lib/report-format";
import { ReportDocumentHeader, ReportPrintStyles } from "./report-document";
import { OfflineReportPendingBanner } from "./offline-report-pending-banner";
interface ReportPageShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onGenerate: (range: DateRange | undefined) => void;
  isLoading: boolean;
  isEmpty: boolean;
  accentColor?: "emerald" | "rose" | "blue" | "amber" | "violet";
  emptyMessage?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  applied?: { dateFrom?: string; dateTo?: string } | null;
  generatedAt?: number;
  error?: unknown;
  source?: string;
  sourceDraft?: boolean;
  basis?: string;
  periodLabel?: string;
}
export function ReportPageShell({
  title,
  subtitle,
  children,
  onGenerate,
  isLoading,
  isEmpty,
  emptyMessage = "Select both dates and generate the report.",
  actions,
  filters,
  applied,
  generatedAt,
  error,
  source,
  sourceDraft = false,
  basis = "",
  periodLabel = "Period",
}: ReportPageShellProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const m = currentReportMonth();
    return {
      from: new Date(`${m.from}T12:00:00`),
      to: new Date(`${m.to}T12:00:00`),
    };
  });
  const complete = Boolean(dateRange?.from && dateRange?.to);
  const draft =
    sourceDraft ||
    !complete ||
    !applied ||
    datePickerKey(dateRange!.from!) !== applied.dateFrom ||
    datePickerKey(dateRange!.to!) !== applied.dateTo;
  const canExport = reportCanExport({
    generatedAt,
    draft,
    loading: isLoading,
    error: Boolean(error),
  });
  const [pdfHelp, setPdfHelp] = useState(false);
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="print:hidden">
        <Link to="/reports" className="text-sm">
          Back to Reports
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex flex-wrap items-center gap-3 py-4">
          <label className="text-sm">
            {periodLabel}
            <DatePickerWithRange date={dateRange} onDateChange={setDateRange} />
          </label>
          {filters}
          <Button
            disabled={
              isLoading ||
              !complete ||
              Boolean(
                dateRange?.from &&
                dateRange?.to &&
                datePickerKey(dateRange.from) > datePickerKey(dateRange.to),
              )
            }
            onClick={() => onGenerate(dateRange)}
          >
            Generate Report
          </Button>
          <Button
            variant="outline"
            disabled={!canExport}
            onClick={() => window.print()}
          >
            Print
          </Button>
          <Button
            variant="outline"
            disabled={!canExport}
            onClick={() => setPdfHelp(true)}
          >
            Save as PDF
          </Button>
          {canExport && actions}
        </div>
        {pdfHelp && (
          <div role="status" className="mb-4 border p-3">
            In the browser print dialog, select Save as PDF.
            <Button
              variant="outline"
              disabled={!canExport}
              onClick={() => {
                if (canExport) {
                  setPdfHelp(false);
                  window.print();
                }
              }}
            >
              Open print dialog
            </Button>
          </div>
        )}
        {draft && generatedAt ? (
          <p role="status" className="mb-3 text-sm">
            Filters changed. Generate Report to apply them.
          </p>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="border p-5">
          Report could not be loaded.{" "}
          {error instanceof Error ? error.message : ""}
          <Button
            onClick={() => onGenerate(dateRange)}
            disabled={isLoading || !complete}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <p role="status">Generating report…</p>
      ) : !generatedAt || !applied ? (
        <p role="status">{emptyMessage}</p>
      ) : (
        <div data-report-document className="report-content pb-8">
          <ReportDocumentHeader
            title={title}
            period={applied}
            source={source}
            generatedAt={generatedAt}
            basis={basis}
            periodLabel={periodLabel}
          />
          <OfflineReportPendingBanner />
          {isEmpty ? (
            <p className="py-8">No records for this selection.</p>
          ) : (
            children
          )}
        </div>
      )}
      <ReportPrintStyles />
    </main>
  );
}
