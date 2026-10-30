import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { currentReportMonth, datePickerKey } from "@/lib/report-dates";
import { formatLossMoney, lossColumns, type LossFilters } from "@/lib/production/loss-display";
import { LOSS_STRIP_LABELS, LOSS_TABS, LOSS_TAB_LABELS, type LossRow, type LossRowLink, type LossTab } from "@/lib/production/loss-report";
import { getProductionLossFn, getProductionLossPrintFn } from "@/server-functions/reports/production-loss-fn";
import { LossLimitsDialog } from "./loss-limits-dialog";
import { printProductionLoss } from "./loss-print";

const perTab = <T,>(value: T) => Object.fromEntries(LOSS_TABS.map((tab) => [tab, value])) as Record<LossTab, T>;
const toPicker = (key: string) => new Date(`${key}T12:00:00`);

export function ProductionLossReport({ onOpenRow }: { onOpenRow: (link: LossRowLink) => void }) {
  const [range, setRange] = useState(() => {
    const month = currentReportMonth();
    return { dateFrom: month.from, dateTo: month.to };
  });
  const [tab, setTab] = useState<LossTab>("batch");
  const [filters, setFilters] = useState<Record<LossTab, LossFilters>>(() => perTab({}));
  const [onlyOver, setOnlyOver] = useState<Record<LossTab, boolean>>(() => perTab(false));
  const [pages, setPages] = useState<Record<LossTab, number>>(() => perTab(1));
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { data: access } = useViewerAccess();
  const canManageLimits = hasPermission(access?.permissions ?? [], "reports.loss.limits.manage");

  const view = { tab, ...range, filters: filters[tab], onlyOverLimit: onlyOver[tab] };
  const { data, isFetching, error } = useQuery({
    queryKey: ["reports", "production-loss", { ...view, page: pages[tab] }],
    queryFn: () => getProductionLossFn({ data: { ...view, page: pages[tab] } }),
    // Keep old rows while paging or filtering, but not across tabs: their columns differ.
    placeholderData: (previous, previousQuery) => ((previousQuery?.queryKey[2] as { tab?: LossTab } | undefined)?.tab === tab ? previous : undefined),
  });
  const columns = lossColumns(tab);

  const changeRange = (next: DateRange | undefined) => {
    if (!next?.from || !next?.to) return;
    setRange({ dateFrom: datePickerKey(next.from), dateTo: datePickerKey(next.to) });
    setPages(perTab(1));
  };
  const setFilter = (key: keyof LossFilters, value: string) => {
    setFilters({ ...filters, [tab]: { ...filters[tab], [key]: value || undefined } });
    setPages({ ...pages, [tab]: 1 });
  };
  const print = async () => {
    setPrinting(true);
    try {
      if (!printProductionLoss(await getProductionLossPrintFn({ data: view }))) toast.error("Allow pop-ups to print the report");
    } catch (printError) {
      toast.error(printError instanceof Error ? printError.message : "Could not print the report");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Production Loss</h1>
        <p className="text-sm text-muted-foreground mt-1">Every loss in mixing, packing and the stores, with its cost and reason.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DatePickerWithRange date={{ from: toPicker(range.dateFrom), to: toPicker(range.dateTo) }} onDateChange={changeRange} />
        <div className="flex gap-2">
          {canManageLimits && <Button variant="outline" onClick={() => setLimitsOpen(true)}>Loss limits</Button>}
          <Button onClick={print} disabled={printing || !data}>Print report</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not load the report"}</p>}

      <section>
        <h2 className="text-sm font-medium mb-2">Loss this period</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {LOSS_TABS.map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${tab === key ? "border-primary" : ""}`}>
              <span className="block text-xs text-muted-foreground">{LOSS_STRIP_LABELS[key]}</span>
              <span className="block font-mono font-semibold tabular-nums">Rs {formatLossMoney(data?.strip[key] ?? 0)}</span>
            </button>
          ))}
          <div className="rounded-lg border bg-muted/40 p-3">
            <span className="block text-xs text-muted-foreground">Total</span>
            <span className="block font-mono font-semibold tabular-nums">Rs {formatLossMoney(data?.strip.total ?? 0)}</span>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(value) => setTab(value as LossTab)}>
        <TabsList className="flex-wrap h-auto">
          {LOSS_TABS.map((key) => <TabsTrigger key={key} value={key}>{LOSS_TAB_LABELS[key]}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        {data?.options.map((option) => (
          <div key={option.key} className="space-y-1">
            <Label htmlFor={`loss-filter-${option.key}`} className="text-xs">{option.label}</Label>
            <NativeSelect id={`loss-filter-${option.key}`} value={filters[tab][option.key] ?? ""} onChange={(event) => setFilter(option.key, event.target.value)}>
              <NativeSelectOption value="">All</NativeSelectOption>
              {option.options.map((choice) => <NativeSelectOption key={choice.value} value={choice.value}>{choice.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        ))}
        {tab !== "store" && (
          <div className="flex items-center gap-2 pb-2">
            <Switch id="loss-only-over" checked={onlyOver[tab]} aria-label="Only over limit"
              onCheckedChange={(checked) => { setOnlyOver({ ...onlyOver, [tab]: checked }); setPages({ ...pages, [tab]: 1 }); }} />
            <Label htmlFor="loss-only-over">Only over limit</Label>
          </div>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {data.summary.map((item) => (
            <div key={item.label}>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</div>
              <div className="font-mono font-semibold tabular-nums">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-lg border ${isFetching ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>{columns.map((column) => <TableHead key={column.key} className={column.numeric ? "text-right" : ""}>{column.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.length === 0 && (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">No losses for this range and filters.</TableCell></TableRow>
            )}
            {data?.rows.map((row: LossRow) => (
              <TableRow key={row.id} data-over={row.over} onClick={() => onOpenRow(row.link)}
                className={`cursor-pointer ${row.over ? "text-red-600 dark:text-red-400 font-medium" : ""}`}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.numeric ? "text-right tabular-nums" : ""}>{column.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {data && data.rows.length > 0 && (
            <TableFooter>
              <TableRow>{data.totals.map((cell, i) => <TableCell key={columns[i]?.key ?? i} className={columns[i]?.numeric ? "text-right tabular-nums" : ""}>{cell}</TableCell>)}</TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">Page {data.page} of {data.pageCount} · {data.total} rows</span>
          <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPages({ ...pages, [tab]: data.page - 1 })}>Previous</Button>
          <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setPages({ ...pages, [tab]: data.page + 1 })}>Next</Button>
        </div>
      )}

      {canManageLimits && data && (
        <LossLimitsDialog open={limitsOpen} onOpenChange={setLimitsOpen} limits={data.limits} updatedAt={data.limitsUpdatedAt} updatedBy={data.limitsUpdatedBy} />
      )}
    </div>
  );
}
