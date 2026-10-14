import { salaryComponents } from "@/lib/report-salary";
import { formatReportMonth } from "@/lib/report-dates";
import { datePickerKey, formatReportDate } from "@/lib/report-dates";
import { formatReportMoney, reportGenerationAction } from "@/lib/report-format";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { ReportPageShell } from "@/components/reports/report-page-shell";
import {
  SectionTitle,
  SummaryCard,
  ReportTable,
  ReportTableRow,
  ReportCell,
} from "@/components/reports/report-primitives";
import { getSalariesReportFn } from "@/server-functions/reports/salaries-report-fn";
import { formatNumber } from "@/lib/currency-format";

const ACCENT = "blue";

export const Route = createFileRoute("/_protected/reports/salaries/")({
  component: SalariesReportPage,
});

function SalariesReportPage() {
  const [params, setParams] = useState<{
    dateFrom?: string;
    dateTo?: string;
  } | null>(null);

  const {
    data,
    isFetching: isLoading,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["reports", "salaries", params],
    queryFn: () => getSalariesReportFn({ data: params ?? {} }),
    enabled: !!params,
  });

  const handleGenerate = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) return;
    const next = {
      dateFrom: datePickerKey(range.from),
      dateTo: datePickerKey(range.to),
    };
    if (reportGenerationAction(params, next) === "refetch") void refetch();
    else setParams(next);
  };

  const isEmpty = !data || data.payslips.length === 0;

  return (
    <ReportPageShell
      title="Salaries Report"
      subtitle="Payslip data with earnings, deductions, and net pay for the selected period."
      onGenerate={handleGenerate}
      applied={params}
      generatedAt={dataUpdatedAt}
      error={error}
      basis="Payslips selected by payroll payment date; payroll month is shown separately. Net salary is a payroll result, not a claim that the same cash amount was disbursed."
      periodLabel="Payroll payment date range"
      isLoading={isLoading}
      isEmpty={isEmpty}
      accentColor={ACCENT}
    >
      {data && (
        <div className="space-y-8">
          <section>
            <SectionTitle accentColor={ACCENT}>Period Summary</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4">
              <SummaryCard
                label="Payslips"
                value={formatNumber(data.summary.count)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Total Gross"
                value={formatReportMoney(data.summary.totalGross)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Total Deductions"
                value={formatReportMoney(data.summary.totalDeductions)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Net including arrears"
                value={formatReportMoney(data.summary.totalNet)}
                accentColor={ACCENT}
              />
            </div>
          </section>

          <section>
            <SectionTitle accentColor={ACCENT}>Payslip Detail</SectionTitle>
            <ReportTable
              headers={[
                "Employee / code",
                "Payroll month",
                "Gross",
                "Deductions",
                "Current-period net",
                "Arrears included",
                "Net incl. arrears",
              ]}
              alignRight={[2, 3, 4, 5, 6]}
            >
              {data.payslips.map((p) => (
                <ReportTableRow key={p.payslipId}>
                  <ReportCell bold>
                    {p.employeeName}
                    <br />
                    {p.employeeCode}
                  </ReportCell>
                  <ReportCell>
                    {p.payrollMonth ? formatReportMonth(p.payrollMonth) : "—"}
                  </ReportCell>
                  {[
                    p.grossSalary,
                    p.totalDeductions,
                    p.grossSalary - p.totalDeductions,
                    p.arrearsAmount,
                    p.netSalary,
                  ].map((v, i) => (
                    <ReportCell key={i} align="right" mono>
                      {formatReportMoney(v)}
                    </ReportCell>
                  ))}
                </ReportTableRow>
              ))}
              <ReportTableRow>
                <ReportCell bold>Total</ReportCell>
                <ReportCell />
                {[
                  data.summary.totalGross,
                  data.summary.totalDeductions,
                  data.summary.totalGross - data.summary.totalDeductions,
                  data.summary.totalArrears,
                  data.summary.totalNet,
                ].map((v, i) => (
                  <ReportCell key={i} align="right" bold mono>
                    {formatReportMoney(v)}
                  </ReportCell>
                ))}
              </ReportTableRow>
            </ReportTable>
            <p className="mt-3 text-sm">
              Stored net salary includes arrears from missed payroll cycles.
              Current-period net is gross minus deductions; arrears are shown
              separately for reference and must not be added to net again.
            </p>
            {data.payslips.map((p) => {
              const detail = salaryComponents(p);
              return (
                <section key={p.payslipId} className="report-salary-detail mt-6">
                  <h3 className="font-semibold mb-2">
                    {p.employeeName} · {p.employeeCode} ·{" "}
                    {p.payrollMonth ? formatReportMonth(p.payrollMonth) : "—"}
                  </h3>
                  <ReportTable headers={["Earning", "Amount"]} alignRight={[1]}>
                    {detail.earnings.map((x) => (
                      <ReportTableRow key={x.label}>
                        <ReportCell>{x.label}</ReportCell>
                        <ReportCell align="right" mono>
                          {formatReportMoney(x.amount)}
                        </ReportCell>
                      </ReportTableRow>
                    ))}
                    <ReportTableRow>
                      <ReportCell bold>Stored gross salary</ReportCell>
                      <ReportCell align="right" mono bold>
                        {formatReportMoney(p.grossSalary)}
                      </ReportCell>
                    </ReportTableRow>
                  </ReportTable>
                  <div className="mt-3">
                    <ReportTable
                      headers={["Deduction", "Amount"]}
                      alignRight={[1]}
                    >
                      {detail.deductions.map((x) => (
                        <ReportTableRow key={x.label}>
                          <ReportCell>{x.label}</ReportCell>
                          <ReportCell align="right" mono>
                            {formatReportMoney(x.amount)}
                          </ReportCell>
                        </ReportTableRow>
                      ))}
                      <ReportTableRow>
                        <ReportCell bold>Stored total deductions</ReportCell>
                        <ReportCell align="right" mono bold>
                          {formatReportMoney(p.totalDeductions)}
                        </ReportCell>
                      </ReportTableRow>
                    </ReportTable>
                  </div>
                  {[
                    [
                      "Gross component reconciliation difference",
                      detail.grossDifference,
                    ],
                    [
                      "Deduction component reconciliation difference",
                      detail.deductionDifference,
                    ],
                    ["Net reconciliation difference", detail.netDifference],
                  ]
                    .filter(([, v]) => Math.abs(Number(v)) > 0.000001)
                    .map(([label, v]) => (
                      <p key={String(label)} className="mt-2 text-sm">
                        {label}: {formatReportMoney(Number(v))}. Stored totals
                        retained; historical components may differ due to
                        rounding or incomplete snapshots.
                      </p>
                    ))}
                </section>
              );
            })}
          </section>
        </div>
      )}
    </ReportPageShell>
  );
}
