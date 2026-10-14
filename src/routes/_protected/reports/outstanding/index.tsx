import { datePickerKey, formatReportDate } from "@/lib/report-dates";
import { formatReportMoney, reportGenerationAction } from "@/lib/report-format";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { ReportPageShell } from "@/components/reports/report-page-shell";
import { ReportSourceSelect } from "@/components/reports/report-source-select";
import {
  ReportCell,
  ReportTable,
  ReportTableRow,
  SectionTitle,
  SummaryCard,
} from "@/components/reports/report-primitives";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/currency-format";
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getOutstandingReportFn } from "@/server-functions/reports/outstanding-report-fn";

const ACCENT = "rose";

export const Route = createFileRoute("/_protected/reports/outstanding/")({
  component: OutstandingReportPage,
});

function displayDate(value: Date | string | null) {
  return value ? formatReportDate(value) : "—";
}

function displayStatus(value: string | null) {
  return (value ?? "pending").replaceAll("_", " ");
}

function OutstandingReportPage() {
  const [source, setSource] = useState<ReportSource>("all");
  const [params, setParams] = useState<{
    dateFrom?: string;
    dateTo?: string;
    source: ReportSource;
  } | null>(null);

  const {
    data,
    isFetching: isLoading,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["reports", "outstanding", params],
    queryFn: () => getOutstandingReportFn({ data: params ?? {} }),
    enabled: Boolean(params),
  });

  const handleGenerate = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) return;
    const next = {
      dateFrom: datePickerKey(range.from),
      dateTo: datePickerKey(range.to),
      source,
    };
    if (reportGenerationAction(params, next) === "refetch") void refetch();
    else setParams(next);
  };

  const handleSourceChange = (next: ReportSource) => {
    setSource(next);
  };

  return (
    <div className="space-y-4">
      <ReportPageShell
        title="Outstanding Report"
        subtitle="Invoices that still have an amount waiting to be paid."
        onGenerate={handleGenerate}
        source={params ? reportSourceLabel(params.source) : undefined}
        sourceDraft={Boolean(params && source !== params.source)}
        applied={params}
        generatedAt={dataUpdatedAt}
        error={error}
        basis="Current unpaid balances for invoices issued in the selected period. Older invoices are excluded. This is not a historical closing balance or all outstanding debt."
        periodLabel="Invoice date range"
        isLoading={isLoading}
        isEmpty={!data || data.invoices.length === 0}
        accentColor={ACCENT}
        filters={
          <ReportSourceSelect
            value={source}
            onValueChange={handleSourceChange}
          />
        }
      >
        {data && (
          <div className="space-y-8">
            <section>
              <SectionTitle accentColor={ACCENT}>Period Summary</SectionTitle>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5 print:grid-cols-5">
                <SummaryCard
                  label="Invoices"
                  value={formatNumber(data.summary.count)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Invoice Amount"
                  value={formatReportMoney(data.summary.invoiceAmount)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Paid Amount"
                  value={formatReportMoney(data.summary.paidAmount)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Returned Amount"
                  value={formatReportMoney(data.summary.returnedAmount)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Current outstanding"
                  value={formatReportMoney(data.summary.outstandingAmount)}
                  accentColor={ACCENT}
                />
              </div>
            </section>

            <section>
              <SectionTitle accentColor={ACCENT}>
                Outstanding Invoices
              </SectionTitle>
              <ReportTable
                headers={[
                  "Invoice / issued",
                  "Customer / salesman",
                  "Recovery / due",
                  "Invoice Amount",
                  "Paid Amount",
                  "Returned Amount",
                  "Current outstanding",
                ]}
                alignRight={[3, 4, 5, 6]}
              >
                {data.invoices.map((invoice) => (
                  <ReportTableRow key={invoice.slipId} accentColor={ACCENT}>
                    <ReportCell>
                      <div className="font-mono">{invoice.invoiceNumber}</div>
                      <div>{displayDate(invoice.invoiceDate)}</div>
                      <div className="text-xs text-muted-foreground">
                        {reportSourceLabel(invoice.source)}
                      </div>
                    </ReportCell>
                    <ReportCell>
                      <div className="font-medium">{invoice.customerName}</div>
                      <div className="text-xs text-muted-foreground">
                        Salesman: {invoice.salesmanName || "—"}
                      </div>
                    </ReportCell>
                    <ReportCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize"
                      >
                        {displayStatus(invoice.recoveryStatus)}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        Due: {displayDate(invoice.paymentDueDate)}
                      </div>
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(invoice.invoiceAmount)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(invoice.paidAmount)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(invoice.returnedAmount)}
                    </ReportCell>
                    <ReportCell
                      align="right"
                      mono
                      bold
                      className="text-rose-500 print:text-black"
                    >
                      {formatReportMoney(invoice.outstandingAmount)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
                <ReportTableRow>
                  <ReportCell bold>Total</ReportCell>
                  {Array.from({ length: 2 }, (_, i) => (
                    <ReportCell key={i} />
                  ))}
                  {[
                    data.summary.invoiceAmount,
                    data.summary.paidAmount,
                    data.summary.returnedAmount,
                    data.summary.outstandingAmount,
                  ].map((v, i) => (
                    <ReportCell key={i} align="right" mono bold>
                      {formatReportMoney(v)}
                    </ReportCell>
                  ))}
                </ReportTableRow>
              </ReportTable>
            </section>
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
