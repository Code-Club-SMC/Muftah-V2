import { Fragment } from "react";
import {
  formatLac,
  monthShortLabel,
  type MonthlyReport,
  type MonthlyReportLine,
} from "@/lib/reports/monthly-report";
import { cn } from "@/lib/utils";

const TOTAL_KEYS = new Set(["totalSale", "totalConsumption", "difference", "withoutCredit"]);

interface Section {
  title: string;
  note?: string;
  lines: MonthlyReportLine[];
  showShare?: boolean;
  tons?: boolean;
}

export function MonthlyReportTable({
  report,
  onCellClick,
}: {
  report: MonthlyReport;
  onCellClick: (line: MonthlyReportLine, monthIndex: number) => void;
}) {
  const sections: Section[] = [
    { title: "Sale", lines: report.sale },
    { title: "Consumption", lines: report.consumption, showShare: true },
    { title: "Result", lines: report.result },
    { title: "Purchases", note: "shown for reference, not counted above", lines: report.purchases },
    { title: "Weight sold", note: "ton", lines: [report.weight], tons: true },
  ];
  const columnCount = report.months.length + 3;

  return (
    <div className="overflow-x-auto rounded-lg border print:overflow-visible print:rounded-none print:border-0">
      <table className="w-full min-w-[960px] border-collapse text-xs tabular-nums print:min-w-0 print:text-[7.5pt]">
        <thead>
          <tr className="border-b bg-muted">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium print:static">
              Rs in lac
            </th>
            {report.months.map((month) => (
              <th key={month} className="px-2 py-2 text-right font-medium">
                {monthShortLabel(month)}
                {month === report.currentMonth ? "*" : ""}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-semibold">Total</th>
            <th className="px-2 py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.title}>
              <tr className="border-b bg-muted/40">
                <td
                  colSpan={columnCount}
                  className="sticky left-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground print:static"
                >
                  {section.title}
                  {section.note && <span className="ml-2 font-normal normal-case">({section.note})</span>}
                </td>
              </tr>
              {section.lines.map((line) => {
                const isTotal = TOTAL_KEYS.has(line.key);
                const show = (value: number) => (section.tons ? value.toFixed(2) : formatLac(value));
                return (
                  <tr key={line.key} className={cn("border-b last:border-0", isTotal && "font-semibold")}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-[inherit] print:static"
                    >
                      {line.label}
                    </th>
                    {line.months.map((value, index) => (
                      <td
                        key={report.months[index]}
                        className={cn(
                          "px-2 py-1.5 text-right",
                          value !== null && value < 0 && "text-rose-500 print:text-black print:underline",
                        )}
                      >
                        {value === null ? (
                          <span className="text-muted-foreground">–</span>
                        ) : line.drillable && value !== 0 ? (
                          <button
                            type="button"
                            className="hover:underline focus-visible:underline"
                            onClick={() => onCellClick(line, index)}
                          >
                            {show(value)}
                          </button>
                        ) : (
                          show(value)
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold">{show(line.total)}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {section.showShare && line.sharePercent !== undefined
                        ? `${Math.round(line.sharePercent)}%`
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
