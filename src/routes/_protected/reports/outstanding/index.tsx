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
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPKR } from "@/lib/currency-format";
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getOutstandingReportFn } from "@/server-functions/reports/outstanding-report-fn";

const ACCENT = "rose";

export const Route = createFileRoute("/_protected/reports/outstanding/")({
  component: OutstandingReportPage,
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

  const { data, isLoading } = useQuery({
    queryKey: [
      "reports",
      "outstanding",
      params?.dateFrom,
      params?.dateTo,
      params?.source,
    ],
    queryFn: () => getOutstandingReportFn({ data: params ?? {} }),
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
        title="Outstanding Report"
        subtitle="Invoices that still have an amount waiting to be paid."
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5 print:grid-cols-5">
                <SummaryCard
                  label="Invoices"
                  value={formatNumber(data.summary.count)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Invoice Amount"
                  value={formatPKR(data.summary.invoiceAmount, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Paid Amount"
                  value={formatPKR(data.summary.paidAmount, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Returned Amount"
                  value={formatPKR(data.summary.returnedAmount, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Outstanding Amount"
                  value={formatPKR(data.summary.outstandingAmount, false)}
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
                  "Invoice #",
                  "Invoice Date",
                  "Source",
                  "Customer",
                  "Salesman",
                  "Recovery Status",
                  "Payment Due Date",
                  "Invoice Amount",
                  "Paid Amount",
                  "Returned Amount",
                  "Outstanding Amount",
                ]}
              >
                {data.invoices.map((invoice) => (
                  <ReportTableRow key={invoice.slipId} accentColor={ACCENT}>
                    <ReportCell mono>{invoice.invoiceNumber}</ReportCell>
                    <ReportCell muted>
                      {displayDate(invoice.invoiceDate)}
                    </ReportCell>
                    <ReportCell muted>
                      {reportSourceLabel(invoice.source)}
                    </ReportCell>
                    <ReportCell bold>{invoice.customerName}</ReportCell>
                    <ReportCell>{invoice.salesmanName || "—"}</ReportCell>
                    <ReportCell>
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize"
                      >
                        {displayStatus(invoice.recoveryStatus)}
                      </Badge>
                    </ReportCell>
                    <ReportCell muted>
                      {displayDate(invoice.paymentDueDate)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatPKR(invoice.invoiceAmount, false)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatPKR(invoice.paidAmount, false)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatPKR(invoice.returnedAmount, false)}
                    </ReportCell>
                    <ReportCell
                      align="right"
                      mono
                      bold
                      className="text-rose-500 print:text-black"
                    >
                      {formatPKR(invoice.outstandingAmount, false)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
              </ReportTable>
            </section>
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
