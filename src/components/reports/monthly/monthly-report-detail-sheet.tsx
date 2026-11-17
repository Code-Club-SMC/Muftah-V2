import { useQuery } from "@tanstack/react-query";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { formatRupees } from "@/lib/finance/expense-entry";
import { formatReportDate } from "@/lib/report-dates";
import { type MonthKey, type MonthlyReportLine, monthLongLabel } from "@/lib/reports/monthly-report";
import { getMonthlyReportDetailFn } from "@/server-functions/reports/monthly-report-fn";

export interface MonthlyReportCellTarget {
  line: MonthlyReportLine;
  month: MonthKey;
}

export function MonthlyReportDetailSheet({
  target,
  onClose,
}: {
  target: MonthlyReportCellTarget | null;
  onClose: () => void;
}) {
  const { data, isFetching, error } = useQuery({
    queryKey: ["reports", "monthly", "detail", target?.line.key, target?.month],
    queryFn: () =>
      getMonthlyReportDetailFn({ data: { line: target!.line.key, month: target!.month } }),
    enabled: target !== null,
  });
  const show = (amount: number) =>
    data?.unit === "kg" ? `${amount.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : formatRupees(amount);

  return (
    <ResponsiveSheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={target ? `${target.line.label} · ${monthLongLabel(target.month)}` : "Details"}
      description="The records behind this number."
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load records. {error instanceof Error ? error.message : ""}
        </p>
      ) : isFetching || !data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No records.</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y rounded-lg border">
            {data.rows.map((row, index) => (
              <li key={`${row.date}-${row.reference}-${index}`} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatReportDate(row.date)}
                    {row.reference ? ` · ${row.reference}` : ""}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{show(row.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between text-sm font-semibold">
            <span>Total ({data.rows.length})</span>
            <span className="tabular-nums">{show(data.total)}</span>
          </p>
        </div>
      )}
    </ResponsiveSheet>
  );
}
