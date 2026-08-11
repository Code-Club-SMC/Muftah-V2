import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { ReportPageShell } from "@/components/reports/report-page-shell";
import { OfflineReportPendingBanner } from "@/components/reports/offline-report-pending-banner";
import { ReportSourceSelect } from "@/components/reports/report-source-select";
import {
  ReportCell,
  ReportTable,
  ReportTableRow,
  SectionTitle,
  SummaryCard,
} from "@/components/reports/report-primitives";
import { formatNumber, formatPKR } from "@/lib/currency-format";
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getSalesReportFn } from "@/server-functions/reports/sales-report-fn";

const ACCENT = "emerald";

export const Route = createFileRoute("/_protected/reports/sales/")({
  component: SalesReportPage,
});

function displayDate(value: Date | string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
}

function SalesReportPage() {
  const [source, setSource] = useState<ReportSource>("all");
  const [params, setParams] = useState<{
    dateFrom?: string;
    dateTo?: string;
    source: ReportSource;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [
      "reports",
      "sales",
      params?.dateFrom,
      params?.dateTo,
      params?.source,
    ],
    queryFn: () => getSalesReportFn({ data: params ?? {} }),
    enabled: Boolean(params),
  });

  const handleGenerate = (range: DateRange | undefined) => {
    setParams({
      dateFrom: range?.from?.toISOString(),
      dateTo: range?.to?.toISOString(),
      source,
    });
  };

  const handleSourceChange = (next: ReportSource) => {
    setSource(next);
    setParams((current) => (current ? { ...current, source: next } : current));
  };

  return (
    <div className="space-y-4">
      <OfflineReportPendingBanner />
      <ReportPageShell
        title="Sales Report"
        subtitle="Invoice value, payments, and remaining amount for the selected period."
        onGenerate={handleGenerate}
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
                  value={formatPKR(data.summary.paidAmount, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Outstanding Amount"
                  value={formatPKR(data.summary.outstandingAmount, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Total Sales"
                  value={formatPKR(data.summary.totalRevenue, false)}
                  accentColor={ACCENT}
                />
              </div>
            </section>

            <section>
              <SectionTitle accentColor={ACCENT}>Invoice Summary</SectionTitle>
              <ReportTable
                headers={[
                  "Date",
                  "Invoice #",
                  "Source",
                  "Customer",
                  "Type",
                  "Items",
                  "Paid Amount",
                  "Outstanding Amount",
                  "Total",
                ]}
              >
                {data.invoices.map((invoice) => (
                  <ReportTableRow key={invoice.invoiceId} accentColor={ACCENT}>
                    <ReportCell muted>{displayDate(invoice.date)}</ReportCell>
                    <ReportCell mono>{invoice.invoiceNumber}</ReportCell>
                    <ReportCell muted>
                      {reportSourceLabel(invoice.source)}
                    </ReportCell>
                    <ReportCell bold>{invoice.customerName}</ReportCell>
                    <ReportCell muted className="capitalize">
                      {invoice.customerType}
                    </ReportCell>
                    <ReportCell>
                      {formatNumber(invoice.items.length)} items
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatPKR(invoice.paidAmount, false)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatPKR(invoice.outstandingAmount, false)}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatPKR(invoice.totalPrice, false)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
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
                        {formatPKR(item.perCartonPrice, false)}
                      </ReportCell>
                      <ReportCell align="right" mono bold>
                        {formatPKR(item.amount, false)}
                      </ReportCell>
                    </ReportTableRow>
                  )),
                )}
              </ReportTable>
            </section>
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
