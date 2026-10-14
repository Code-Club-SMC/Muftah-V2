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
import { formatNumber } from "@/lib/currency-format";
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getSalesReportFn } from "@/server-functions/reports/sales-report-fn";

const ACCENT = "emerald";

export const Route = createFileRoute("/_protected/reports/sales/")({
  component: SalesReportPage,
});

function displayDate(value: Date | string | null) {
  return value ? formatReportDate(value) : "—";
}

function SalesReportPage() {
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
    queryKey: ["reports", "sales", params],
    queryFn: () => getSalesReportFn({ data: params ?? {} }),
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
        title="Sales Report"
        subtitle="Invoice value, payments, and remaining amount for the selected period."
        onGenerate={handleGenerate}
        source={params ? reportSourceLabel(params.source) : undefined}
        sourceDraft={Boolean(params && source !== params.source)}
        applied={params}
        generatedAt={dataUpdatedAt}
        error={error}
        basis="Invoices issued in the selected period; paid and outstanding amounts are current balances, not collections during that period."
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:grid-cols-4">
                <SummaryCard
                  label="Invoices"
                  value={formatNumber(data.summary.count)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Paid Amount"
                  value={formatReportMoney(data.summary.paidAmount)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Outstanding Amount"
                  value={formatReportMoney(data.summary.outstandingAmount)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Total Sales"
                  value={formatReportMoney(data.summary.totalRevenue)}
                  accentColor={ACCENT}
                />
              </div>
            </section>

            <section>
              <SectionTitle accentColor={ACCENT}>Invoice Summary</SectionTitle>
              <ReportTable
                headers={[
                  "Invoice / issued",
                  "Customer / type",
                  "Items",
                  "Paid Amount",
                  "Outstanding Amount",
                  "Total",
                ]}
                alignRight={[2, 3, 4, 5]}
              >
                {data.invoices.map((invoice) => (
                  <ReportTableRow key={invoice.invoiceId} accentColor={ACCENT}>
                    <ReportCell>
                      <div className="font-mono">{invoice.invoiceNumber}</div>
                      <div>{displayDate(invoice.date)}</div>
                      <div className="text-xs text-muted-foreground">
                        {reportSourceLabel(invoice.source)}
                      </div>
                    </ReportCell>
                    <ReportCell>
                      <div className="font-medium">{invoice.customerName}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {invoice.customerType}
                      </div>
                    </ReportCell>
                    <ReportCell align="right">
                      {formatNumber(invoice.items.length)} items
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(invoice.paidAmount)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(invoice.outstandingAmount)}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(invoice.totalPrice)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
                <ReportTableRow>
                  <ReportCell bold>Total</ReportCell>
                  <ReportCell />
                  <ReportCell />
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(data.summary.paidAmount)}
                  </ReportCell>
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(data.summary.outstandingAmount)}
                  </ReportCell>
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(data.summary.totalRevenue)}
                  </ReportCell>
                </ReportTableRow>
              </ReportTable>
            </section>

            <section>
              <SectionTitle accentColor={ACCENT}>Line Item Detail</SectionTitle>
              <ReportTable
                headers={[
                  "Invoice #",
                  "Product",
                  "HSN Code",
                  "Cartons",
                  "Units",
                  "Price/Carton",
                  "Amount",
                ]}
                alignRight={[3, 4, 5, 6]}
              >
                {data.invoices.flatMap((invoice) =>
                  invoice.items.map((item, index) => (
                    <ReportTableRow
                      key={`${invoice.invoiceId}-${index}`}
                      accentColor={ACCENT}
                    >
                      <ReportCell mono muted>
                        {invoice.invoiceNumber}
                      </ReportCell>
                      <ReportCell>{item.pack}</ReportCell>
                      <ReportCell mono muted>
                        {item.hsnCode}
                      </ReportCell>
                      <ReportCell align="right" mono>
                        {formatNumber(item.cartons)}
                      </ReportCell>
                      <ReportCell align="right" mono>
                        {formatNumber(item.units)}
                      </ReportCell>
                      <ReportCell align="right" mono>
                        {formatReportMoney(item.perCartonPrice)}
                      </ReportCell>
                      <ReportCell align="right" mono bold>
                        {formatReportMoney(item.amount)}
                      </ReportCell>
                    </ReportTableRow>
                  )),
                )}
                <ReportTableRow>
                  <ReportCell bold>Total</ReportCell>
                  <ReportCell />
                  <ReportCell />
                  <ReportCell />
                  <ReportCell />
                  <ReportCell />
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(
                      data.invoices.reduce(
                        (sum, invoice) =>
                          sum +
                          invoice.items.reduce((s, item) => s + item.amount, 0),
                        0,
                      ),
                    )}
                  </ReportCell>
                </ReportTableRow>
              </ReportTable>
            </section>
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
