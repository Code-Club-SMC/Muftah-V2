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
  EmptySection,
} from "@/components/reports/report-primitives";
import { getExpensesReportFn } from "@/server-functions/reports/expenses-report-fn";
import { formatNumber } from "@/lib/currency-format";
import { Badge } from "@/components/ui/badge";

const ACCENT = "violet";

export const Route = createFileRoute("/_protected/reports/expenses/")({
  component: ExpensesReportPage,
});

function ExpensesReportPage() {
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
    queryKey: ["reports", "expenses", params],
    queryFn: () => getExpensesReportFn({ data: params ?? {} }),
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

  const isEmpty =
    !data ||
    (data.financeExpenses.length === 0 &&
      data.productionCosts.length === 0 &&
      data.failedBatchLosses.length === 0);

  return (
    <ReportPageShell
      title="Expenses Report"
      subtitle="Finance expenses and production costs for the selected period."
      onGenerate={handleGenerate}
      applied={params}
      generatedAt={dataUpdatedAt}
      error={error}
      basis="Finance expenses use expense date, completed manufacturing costs use completion date, and settled failed-batch losses use settlement date. These separate categories may overlap and must not be added as accounting expenses."
      periodLabel="Recognition date range"
      isLoading={isLoading}
      isEmpty={isEmpty}
      accentColor={ACCENT}
    >
      {data && (
        <div className="space-y-8">
          <section>
            <SectionTitle accentColor={ACCENT}>Period Summary</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 print:grid-cols-3">
              <SummaryCard
                label="Finance Expenses"
                value={formatReportMoney(data.summary.totalFinanceExpenses)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Production Costs"
                value={formatReportMoney(data.summary.totalProductionCosts)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Failed Batch Losses"
                value={formatReportMoney(data.summary.totalFailedBatchLosses)}
                accentColor={ACCENT}
              />
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-0.5 h-5 rounded bg-violet-500" />
              <h2 className="text-base font-semibold tracking-tight">
                General Expenses
              </h2>
              <Badge variant="secondary" className="text-[10px] print:hidden">
                Finance
              </Badge>
            </div>
            {data.financeExpenses.length === 0 ? (
              <EmptySection message="No finance expenses recorded for this period." />
            ) : (
              <ReportTable
                headers={[
                  "Date",
                  "Category",
                  "Description",
                  "Wallet",
                  "Slip #",
                  "Amount",
                ]}
                alignRight={[5]}
              >
                {data.financeExpenses.map((e) => (
                  <ReportTableRow key={e.expenseId} accentColor={ACCENT}>
                    <ReportCell muted>
                      {e.expenseDate ? formatReportDate(e.expenseDate) : "—"}
                    </ReportCell>
                    <ReportCell bold>
                      {e.categoryName || "Uncategorized"}
                    </ReportCell>
                    <ReportCell>{e.description || "—"}</ReportCell>
                    <ReportCell muted>{e.walletName || "—"}</ReportCell>
                    <ReportCell mono muted>
                      {e.slipNumber || "—"}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(e.amount)}
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
                    {formatReportMoney(data.summary.totalFinanceExpenses)}
                  </ReportCell>
                </ReportTableRow>
              </ReportTable>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-0.5 h-5 rounded bg-amber-500" />
              <h2 className="text-base font-semibold tracking-tight">
                Manufacturing Costs
              </h2>
              <Badge variant="secondary" className="text-[10px] print:hidden">
                Production
              </Badge>
            </div>
            {data.productionCosts.length === 0 ? (
              <EmptySection message="No production costs recorded for this period." />
            ) : (
              <ReportTable
                headers={[
                  "Batch ID",
                  "Completed",
                  "Product",
                  "Recipe",
                  "Warehouse",
                  "Containers",
                  "Chemical Cost",
                  "Packaging Cost",
                  "Total Cost",
                  "Actual/Pack",
                ]}
                alignRight={[5, 6, 7, 8, 9]}
              >
                {data.productionCosts.map((p) => (
                  <ReportTableRow key={p.runId} accentColor={ACCENT}>
                    <ReportCell mono bold>
                      {p.batchId}
                    </ReportCell>
                    <ReportCell muted>
                      {p.actualCompletionDate
                        ? formatReportDate(p.actualCompletionDate)
                        : "—"}
                    </ReportCell>
                    <ReportCell>{p.productName}</ReportCell>
                    <ReportCell>{p.recipeName}</ReportCell>
                    <ReportCell muted>{p.warehouseName}</ReportCell>
                    <ReportCell align="right" mono>
                      {formatNumber(p.containersProduced)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(p.totalChemicalCost)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(p.totalPackagingCost)}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(p.totalProductionCost)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(p.actualCostPerPack)}
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
                      data.productionCosts.reduce(
                        (s, p) => s + p.totalChemicalCost,
                        0,
                      ),
                    )}
                  </ReportCell>
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(
                      data.productionCosts.reduce(
                        (s, p) => s + p.totalPackagingCost,
                        0,
                      ),
                    )}
                  </ReportCell>
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(data.summary.totalProductionCosts)}
                  </ReportCell>
                  <ReportCell />
                </ReportTableRow>
              </ReportTable>
            )}
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-0.5 h-5 rounded bg-rose-500" />
              <h2 className="text-base font-semibold tracking-tight">
                Failed Batch Chemical Losses
              </h2>
              <Badge variant="secondary" className="text-[10px] print:hidden">
                Non-cash
              </Badge>
            </div>
            {data.failedBatchLosses.length === 0 ? (
              <EmptySection message="No failed-batch chemical losses were settled for this period." />
            ) : (
              <ReportTable
                headers={[
                  "Settled",
                  "Batch ID",
                  "Product",
                  "Recipe",
                  "Chemical",
                  "Expected Qty",
                  "Recovered Qty",
                  "Loss Qty",
                  "Loss Amount",
                ]}
                alignRight={[5, 6, 7, 8]}
              >
                {data.failedBatchLosses.map((row) => (
                  <ReportTableRow key={row.settlementId} accentColor={ACCENT}>
                    <ReportCell muted>
                      {row.settledAt ? formatReportDate(row.settledAt) : "—"}
                    </ReportCell>
                    <ReportCell mono bold>
                      {row.batchId}
                    </ReportCell>
                    <ReportCell>{row.productName}</ReportCell>
                    <ReportCell>{row.recipeName}</ReportCell>
                    <ReportCell>{row.chemicalName}</ReportCell>
                    <ReportCell align="right" mono>
                      {formatNumber(row.expectedQuantity)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatNumber(row.recoveredQuantity)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatNumber(row.lossQuantity)}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(row.lossAmount)}
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
                  <ReportCell />
                  <ReportCell />
                  <ReportCell align="right" mono bold>
                    {formatReportMoney(data.summary.totalFailedBatchLosses)}
                  </ReportCell>
                </ReportTableRow>
              </ReportTable>
            )}
          </section>
        </div>
      )}
    </ReportPageShell>
  );
}
