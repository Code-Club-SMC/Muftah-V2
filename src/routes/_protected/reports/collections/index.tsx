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
import { formatPKR } from "@/lib/currency-format";
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getCollectionsReportFn } from "@/server-functions/reports/collections-report-fn";

const ACCENT = "blue";

export const Route = createFileRoute("/_protected/reports/collections/")({
  component: CollectionsReportPage,
});

function displayDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function displayMethod(value: string) {
  if (value === "bank_transfer") return "Bank Transfer";
  if (value === "cheque") return "Cheque";
  return "Cash";
}

function displayStatus(value: string) {
  if (value === "returned") return "Cheque Returned";
  if (value === "cancelled") return "Cancelled";
  return "Reversed";
}

function CollectionsReportPage() {
  const [source, setSource] = useState<ReportSource>("all");
  const [params, setParams] = useState<{
    dateFrom?: string;
    dateTo?: string;
    source: ReportSource;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [
      "reports",
      "collections",
      params?.dateFrom,
      params?.dateTo,
      params?.source,
    ],
    queryFn: () => getCollectionsReportFn({ data: params ?? {} }),
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

  const rowCount = data
    ? data.confirmed.length + data.pending.length + data.exceptions.length
    : 0;

  return (
    <div className="space-y-4">
      <OfflineReportPendingBanner />
      <ReportPageShell
        title="Collections Report"
        subtitle="Confirmed money, payments waiting for finance, and payment exceptions."
        onGenerate={handleGenerate}
        isLoading={isLoading}
        isEmpty={!data || rowCount === 0}
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
                  label="Cash"
                  value={formatPKR(data.summary.cash, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Bank Transfer"
                  value={formatPKR(data.summary.bankTransfer, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Cheque Cleared"
                  value={formatPKR(data.summary.cheque, false)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Pending Verification"
                  value={formatPKR(data.summary.pending, false)}
                  accentColor={ACCENT}
                />
              </div>
            </section>

            <section>
              <SectionTitle accentColor={ACCENT}>
                Confirmed Collections
              </SectionTitle>
              <ReportTable
                headers={[
                  "Date",
                  "Invoice #",
                  "Source",
                  "Customer",
                  "Method",
                  "Amount",
                ]}
              >
                {data.confirmed.map((payment) => (
                  <ReportTableRow key={payment.paymentId} accentColor={ACCENT}>
                    <ReportCell muted>
                      {displayDate(payment.effectiveDate)}
                    </ReportCell>
                    <ReportCell mono>{payment.invoiceNumber}</ReportCell>
                    <ReportCell muted>
                      {reportSourceLabel(payment.source)}
                    </ReportCell>
                    <ReportCell bold>{payment.customerName}</ReportCell>
                    <ReportCell>{displayMethod(payment.method)}</ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatPKR(payment.amount, false)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
              </ReportTable>
            </section>

            {data.pending.length > 0 && (
              <section>
                <SectionTitle accentColor={ACCENT}>
                  Pending Verification
                </SectionTitle>
                <ReportTable
                  headers={[
                    "Recorded",
                    "Invoice #",
                    "Source",
                    "Customer",
                    "Method",
                    "Amount",
                  ]}
                >
                  {data.pending.map((payment) => (
                    <ReportTableRow
                      key={payment.paymentId}
                      accentColor={ACCENT}
                    >
                      <ReportCell muted>
                        {displayDate(payment.paymentDate)}
                      </ReportCell>
                      <ReportCell mono>{payment.invoiceNumber}</ReportCell>
                      <ReportCell muted>
                        {reportSourceLabel(payment.source)}
                      </ReportCell>
                      <ReportCell bold>{payment.customerName}</ReportCell>
                      <ReportCell>{displayMethod(payment.method)}</ReportCell>
                      <ReportCell align="right" mono bold>
                        {formatPKR(payment.amount, false)}
                      </ReportCell>
                    </ReportTableRow>
                  ))}
                </ReportTable>
              </section>
            )}

            {data.exceptions.length > 0 && (
              <section>
                <SectionTitle accentColor={ACCENT}>
                  Payment Exceptions
                </SectionTitle>
                <ReportTable
                  headers={[
                    "Recorded",
                    "Invoice #",
                    "Source",
                    "Customer",
                    "Status",
                    "Reason",
                    "Amount",
                  ]}
                >
                  {data.exceptions.map((payment) => (
                    <ReportTableRow
                      key={payment.paymentId}
                      accentColor={ACCENT}
                    >
                      <ReportCell muted>
                        {displayDate(payment.paymentDate)}
                      </ReportCell>
                      <ReportCell mono>{payment.invoiceNumber}</ReportCell>
                      <ReportCell muted>
                        {reportSourceLabel(payment.source)}
                      </ReportCell>
                      <ReportCell bold>{payment.customerName}</ReportCell>
                      <ReportCell>
                        <Badge variant="outline">
                          {displayStatus(payment.status)}
                        </Badge>
                      </ReportCell>
                      <ReportCell muted>{payment.reason}</ReportCell>
                      <ReportCell align="right" mono bold>
                        {formatPKR(payment.amount, false)}
                      </ReportCell>
                    </ReportTableRow>
                  ))}
                </ReportTable>
              </section>
            )}
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
