import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCommissionMonthSummary } from "@/hooks/sales/use-recovery-commission";
import { formatPKR } from "@/lib/currency-format";
import { MonthPicker, currentMonth } from "./month-picker";

const COLUMNS = [
  ["delivered", "Delivered"], ["returned", "Returned"], ["collected", "Collected"],
  ["earned", "Earned"], ["stillOwed", "Still owed"], ["waiting", "Waiting"],
] as const;
type SortKey = "name" | (typeof COLUMNS)[number][0];

export function CommissionSummary() {
  const [month, setMonth] = useState(currentMonth);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const { data, isLoading } = useCommissionMonthSummary(month);
  const navigate = useNavigate();
  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const result = sort.key === "name" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
      return sort.asc ? result : -result;
    });
    return list;
  }, [data, sort]);
  const toggle = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));
  const header = (key: SortKey, label: string, right = true) => (
    <TableHead className={right ? "text-right text-[11px]" : "text-[11px]"}>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-[11px]" onClick={() => toggle(key)}>
        {label} <ArrowUpDown className="ml-1 size-3" />
      </Button>
    </TableHead>
  );
  return (
    <section aria-label="Commission summary" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Commission summary</h3>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <p className="text-sm text-muted-foreground">Commission is earned only on money collected. Earned is what goes on the payslip.</p>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {header("name", "Order Booker", false)}
              {COLUMNS.map(([key, label]) => header(key, label))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No deliveries, collections or money owed this month.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.orderBookerId} className="cursor-pointer"
                onClick={() => navigate({ to: "/sales/people/order-bookers/$orderBookerId", params: { orderBookerId: r.orderBookerId }, search: { month } })}>
                <TableCell className="text-sm font-medium">{r.name}</TableCell>
                {COLUMNS.map(([key]) => <TableCell key={key} className="text-right text-sm tabular-nums">{formatPKR(r[key], false)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
          {data && rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="text-sm font-semibold">Total</TableCell>
                {COLUMNS.map(([key]) => <TableCell key={key} className="text-right text-sm font-semibold tabular-nums">{formatPKR(data.total[key], false)}</TableCell>)}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </section>
  );
}
