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
import { reportSourceLabel, type ReportSource } from "@/lib/report-source";
import { getCollectionsReportFn } from "@/server-functions/reports/collections-report-fn";

const ACCENT = "blue";

export const Route = createFileRoute("/_protected/reports/collections/")({
  component: CollectionsReportPage,
});

function displayDate(value: string) {
  return formatReportDate(value);
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

  const {
    data,
    isFetching: isLoading,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["reports", "collections", params],
    queryFn: () => getCollectionsReportFn({ data: params ?? {} }),
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

  const rowCount = data
    ? data.confirmed.length + data.pending.length + data.exceptions.length
    : 0;

  return (
    <div className="space-y-4">
      <ReportPageShell
        title="Collections Report"
        subtitle="Confirmed money, payments waiting for finance, and payment exceptions."
        onGenerate={handleGenerate}
        source={params ? reportSourceLabel(params.source) : undefined}
        sourceDraft={Boolean(params && source !== params.source)}
        applied={params}
        generatedAt={dataUpdatedAt}
        error={error}
        basis="Confirmed receipts use effective date. Pending and exception sections use payment date. Non-cash expense offsets are excluded from receipts."
        periodLabel="Receipt / payment date range"
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
                  value={formatReportMoney(data.summary.cash)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Bank Transfer"
                  value={formatReportMoney(data.summary.bankTransfer)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Cheque Cleared"
                  value={formatReportMoney(data.summary.cheque)}
                  accentColor={ACCENT}
                />
                <SummaryCard
                  label="Pending Verification"
                  value={formatReportMoney(data.summary.pending)}
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
                alignRight={[5]}
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
                      {formatReportMoney(payment.amount)}
                    </ReportCell>
                  </ReportTableRow>
                ))}
                <ReportTableRow>
                  <ReportCell bold>Total</ReportCell>
                  <ReportCell />
                  <ReportCell />
                  <ReportCell />
                  <ReportCell />
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(
                      data.confirmed.reduce((s, p) => s + p.amount, 0),
                    )}
                  </ReportCell>
                </ReportTableRow>
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
                  alignRight={[5]}
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
                        {formatReportMoney(payment.amount)}
                      </ReportCell>
                    </ReportTableRow>
                  ))}
                  <ReportTableRow>
                    <ReportCell bold>Total</ReportCell>
                    <ReportCell />
                    <ReportCell />
                    <ReportCell />
                    <ReportCell />
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(
                        data.pending.reduce((s, p) => s + p.amount, 0),
                      )}
                    </ReportCell>
                  </ReportTableRow>
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
                  alignRight={[6]}
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
                        {formatReportMoney(payment.amount)}
                      </ReportCell>
                    </ReportTableRow>
                  ))}
                  <ReportTableRow>
                    <ReportCell bold>Total</ReportCell>
                    <ReportCell />
                    <ReportCell />
                    <ReportCell />
                    <ReportCell />
                    <ReportCell />
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(
                        data.exceptions.reduce((s, p) => s + p.amount, 0),
                      )}
                    </ReportCell>
                  </ReportTableRow>
                </ReportTable>
              </section>
            )}
          </div>
        )}
      </ReportPageShell>
    </div>
  );
}
