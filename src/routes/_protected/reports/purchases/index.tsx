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
import { getPurchasesReportFn } from "@/server-functions/reports/purchases-report-fn";
import { getWalletsListFn } from "@/server-functions/finance-fn";
import { formatNumber, formatQuantity } from "@/lib/currency-format";
import { Badge } from "@/components/ui/badge";

const ACCENT = "amber";

function resolveMethodLabel(
  method: string | null | undefined,
  wallets: { id: string; name: string }[],
): string {
  if (!method) return "—";
  const known: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    pay_later: "Pay Later",
  };
  if (known[method]) return known[method];
  const wallet = wallets.find((w) => w.id === method);
  return wallet ? wallet.name : "Finance Account";
}

export const Route = createFileRoute("/_protected/reports/purchases/")({
  component: PurchasesReportPage,
});

function PurchasesReportPage() {
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
    queryKey: ["reports", "purchases", params],
    queryFn: () => getPurchasesReportFn({ data: params ?? {} }),
    enabled: !!params,
  });

  const { data: wallets = [] } = useQuery({
    queryKey: ["finance", "wallets", "list"],
    queryFn: getWalletsListFn,
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

  const isEmpty = !data || data.purchases.length === 0;

  return (
    <ReportPageShell
      title="Purchases Report"
      subtitle="Supplier purchases with material details, quantities, costs, and payment status."
      onGenerate={handleGenerate}
      applied={params}
      generatedAt={dataUpdatedAt}
      error={error}
      basis="Purchases selected by purchase date; paid and outstanding amounts reflect current payment status."
      periodLabel="Purchase date range"
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
                label="Purchases"
                value={formatNumber(data.summary.count)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Total Cost"
                value={formatReportMoney(data.summary.totalCost)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Total Paid"
                value={formatReportMoney(data.summary.totalPaid)}
                accentColor={ACCENT}
              />
              <SummaryCard
                label="Outstanding"
                value={formatReportMoney(data.summary.totalOutstanding)}
                accentColor={ACCENT}
              />
            </div>
          </section>

          <section>
            <SectionTitle accentColor={ACCENT}>Purchase Records</SectionTitle>
            <ReportTable
              headers={[
                "Invoice / date",
                "Supplier / warehouse",
                "Material / type",
                "Quantity",
                "Unit Cost",
                "Total",
                "Paid",
                "Payment",
              ]}
              alignRight={[3, 4, 5, 6]}
            >
              {data.purchases.map((p) => {
                const isFullyPaid = p.paidAmount >= p.cost;
                const isPartial = p.paidAmount > 0 && p.paidAmount < p.cost;
                return (
                  <ReportTableRow key={p.purchaseId} accentColor={ACCENT}>
                    <ReportCell>
                      <div className="font-mono">{p.invoiceNumber || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.purchaseDate
                          ? formatReportDate(p.purchaseDate)
                          : "—"}
                      </div>
                    </ReportCell>
                    <ReportCell>
                      <div className="font-medium">{p.supplierName}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.warehouseName}
                      </div>
                    </ReportCell>
                    <ReportCell>
                      <div>{p.materialName}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {p.materialType}
                      </div>
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatQuantity(p.quantity, p.unit)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(p.unitCost)}
                    </ReportCell>
                    <ReportCell align="right" mono bold>
                      {formatReportMoney(p.cost)}
                    </ReportCell>
                    <ReportCell align="right" mono>
                      {formatReportMoney(p.paidAmount)}
                    </ReportCell>
                    <ReportCell>
                      <div className="mb-1">
                        {resolveMethodLabel(p.paymentMethod, wallets)}
                      </div>
                      {isFullyPaid ? (
                        <Badge
                          variant="default"
                          className="text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                        >
                          Paid
                        </Badge>
                      ) : isPartial ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                        >
                          Partial
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-rose-400 border-rose-400/30"
                        >
                          Unpaid
                        </Badge>
                      )}
                    </ReportCell>
                  </ReportTableRow>
                );
              })}
              <ReportTableRow>
                <ReportCell bold>Total</ReportCell>
                <ReportCell />
                <ReportCell />
                <ReportCell />
                <ReportCell />
                <ReportCell align="right" mono bold>
                  {formatReportMoney(data.summary.totalCost)}
                </ReportCell>
                <ReportCell align="right" mono bold>
                  {formatReportMoney(data.summary.totalPaid)}
                </ReportCell>
                <ReportCell />
              </ReportTableRow>
            </ReportTable>
          </section>
        </div>
      )}
    </ReportPageShell>
  );
}
