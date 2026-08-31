import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { Download, Search, X, Plus } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { startOfDay, endOfDay, subDays, isSameDay } from "date-fns";
import { MODULE_CONFIG } from "./activity-event-card";
import { cn } from "@/lib/utils";
import { ManualActivityEventDialog } from "./manual-activity-event-dialog";

export interface ActivityFilters {
  module?: string;
  action?: string;
  actorId?: string;
  entityType?: string;
  severity?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

interface FilterOptions {
  modules: string[];
  actions: string[];
  entityTypes: string[];
  actors: { id: string; name: string }[];
}

interface ActivityTimelineFiltersProps {
  filters: ActivityFilters;
  onFiltersChange: (filters: ActivityFilters) => void;
  filterOptions?: FilterOptions;
  isLoading?: boolean;
  onExport?: () => void;
  isExporting?: boolean;
}

const TOP_MODULES = [
  { id: "all", label: "All Events" },
  { id: "sales", label: "Sales" },
  { id: "finance", label: "Finance" },
  { id: "manufacturing", label: "Manufacturing" },
  { id: "inventory", label: "Inventory" },
  { id: "suppliers", label: "Suppliers" },
  { id: "hr", label: "HR & Payroll" },
  { id: "auth", label: "Security & Auth" },
];

export function ActivityTimelineFilters({
  filters,
  onFiltersChange,
  filterOptions,
  onExport,
  isExporting,
}: ActivityTimelineFiltersProps) {
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);

  const updateFilter = (key: keyof ActivityFilters, value: string | undefined) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  const handleDateChange = (range: DateRange | undefined) => {
    onFiltersChange({
      ...filters,
      dateFrom: range?.from ? startOfDay(range.from).toISOString() : undefined,
      dateTo: range?.to ? endOfDay(range.to).toISOString() : range?.from ? endOfDay(range.from).toISOString() : undefined,
    });
  };

  const setDatePreset = (preset: "today" | "yesterday" | "7days" | "all") => {
    const today = new Date();
    if (preset === "today") {
      onFiltersChange({
        ...filters,
        dateFrom: startOfDay(today).toISOString(),
        dateTo: endOfDay(today).toISOString(),
      });
    } else if (preset === "yesterday") {
      const yesterday = subDays(today, 1);
      onFiltersChange({
        ...filters,
        dateFrom: startOfDay(yesterday).toISOString(),
        dateTo: endOfDay(yesterday).toISOString(),
      });
    } else if (preset === "7days") {
      onFiltersChange({
        ...filters,
        dateFrom: startOfDay(subDays(today, 7)).toISOString(),
        dateTo: endOfDay(today).toISOString(),
      });
    } else if (preset === "all") {
      onFiltersChange({
        ...filters,
        dateFrom: undefined,
        dateTo: undefined,
      });
    }
  };

  const handleReset = () => {
    const today = new Date();
    onFiltersChange({
      dateFrom: startOfDay(today).toISOString(),
      dateTo: endOfDay(today).toISOString(),
    });
  };

  // Determine active date preset
  const today = new Date();
  const isTodayActive =
    filters.dateFrom &&
    filters.dateTo &&
    isSameDay(new Date(filters.dateFrom), today) &&
    isSameDay(new Date(filters.dateTo), today);

  const isYesterdayActive =
    filters.dateFrom &&
    filters.dateTo &&
    isSameDay(new Date(filters.dateFrom), subDays(today, 1)) &&
    isSameDay(new Date(filters.dateTo), subDays(today, 1));

  const isAllTimeActive = !filters.dateFrom && !filters.dateTo;

  const dateRange: DateRange | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          to: filters.dateTo ? new Date(filters.dateTo) : undefined,
        }
      : undefined;

  const currentModule = filters.module ?? "all";

  return (
    <div className="space-y-3">
      {/* ── 1-Click Department Pills ─────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {TOP_MODULES.map((item) => {
          const isActive = currentModule === item.id;
          const config = item.id !== "all" ? MODULE_CONFIG[item.id] : null;

          return (
            <button
              key={item.id}
              onClick={() => updateFilter("module", item.id === "all" ? undefined : item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer",
                isActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs"
                  : "bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-400 hover:bg-slate-200/80 dark:hover:bg-muted/80"
              )}
            >
              {config && (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isActive ? "bg-white dark:bg-slate-950" : config.dotColor
                  )}
                />
              )}
              {item.label}
            </button>
          );
        })}
      </div>

      {/* ── Secondary Controls Toolbar ───────────────────────────────── */}
      <div className="flex flex-col 2xl:flex-row items-stretch 2xl:items-center justify-between gap-3 p-2 rounded-xl bg-slate-100/70 dark:bg-muted/30 border border-slate-200/80 dark:border-border/60">
        {/* Left Side: Search + Dropdowns */}
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search activity..."
              value={filters.search ?? ""}
              onChange={(e) => updateFilter("search", e.target.value)}
              className="pl-8.5 h-8.5 text-xs bg-white dark:bg-card border-slate-200/80 dark:border-border rounded-lg shadow-xs"
            />
            {filters.search && (
              <button
                onClick={() => updateFilter("search", undefined)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Action Filter */}
          <Select
            value={filters.action ?? "all"}
            onValueChange={(v) => updateFilter("action", v === "all" ? undefined : v)}
          >
            <SelectTrigger className="h-8.5 w-[120px] text-xs bg-white dark:bg-card border-slate-200/80 dark:border-border rounded-lg shadow-xs font-medium">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {filterOptions?.actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Severity Filter */}
          <Select
            value={filters.severity ?? "all"}
            onValueChange={(v) => updateFilter("severity", v === "all" ? undefined : v)}
          >
            <SelectTrigger className="h-8.5 w-[115px] text-xs bg-white dark:bg-card border-slate-200/80 dark:border-border rounded-lg shadow-xs font-medium">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="info">Standard</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          {/* Operator Filter */}
          {filterOptions?.actors && filterOptions.actors.length > 0 && (
            <Select
              value={filters.actorId ?? "all"}
              onValueChange={(v) => updateFilter("actorId", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="h-8.5 w-[130px] text-xs bg-white dark:bg-card border-slate-200/80 dark:border-border rounded-lg shadow-xs font-medium">
                <SelectValue placeholder="Operator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Operators</SelectItem>
                {filterOptions.actors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-8.5 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <X className="size-3" />
            Reset
          </Button>
        </div>

        {/* Right Side: Quick Date Presets + Date Picker + Export */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Quick Date Presets */}
          <div className="flex items-center rounded-lg bg-white dark:bg-card border border-slate-200/80 dark:border-border p-0.5 shadow-xs">
            <button
              onClick={() => setDatePreset("today")}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                isTodayActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 dark:text-slate-400 hover:text-foreground"
              )}
            >
              Today
            </button>
            <button
              onClick={() => setDatePreset("yesterday")}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                isYesterdayActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 dark:text-slate-400 hover:text-foreground"
              )}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDatePreset("7days")}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-600 dark:text-slate-400 hover:text-foreground transition-colors cursor-pointer"
            >
              7D
            </button>
            <button
              onClick={() => setDatePreset("all")}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                isAllTimeActive
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 dark:text-slate-400 hover:text-foreground"
              )}
            >
              All Time
            </button>
          </div>

          {/* Date Picker Range */}
          <DatePickerWithRange
            date={dateRange}
            onDateChange={handleDateChange}
            className="w-auto"
          />

          {onExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={isExporting}
              className="h-8.5 px-3 text-xs font-medium bg-white dark:bg-card border-slate-200/80 dark:border-border rounded-lg shadow-xs hover:bg-slate-50 dark:hover:bg-muted gap-1.5 shrink-0"
            >
              <Download className="size-3.5 text-muted-foreground" />
              <span className="hidden xl:inline">Export CSV</span>
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setIsManualDialogOpen(true)}
            className="h-8.5 px-3 text-xs font-medium rounded-lg shadow-xs gap-1.5 shrink-0"
          >
            <Plus className="size-3.5" />
            <span className="hidden xl:inline">Log Event</span>
          </Button>
        </div>
      </div>

      <ManualActivityEventDialog 
        open={isManualDialogOpen} 
        onOpenChange={setIsManualDialogOpen} 
      />
    </div>
  );
}
