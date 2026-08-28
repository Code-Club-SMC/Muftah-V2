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
import { Download, RotateCcw, Search, Filter } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { MODULE_CONFIG } from "./activity-event-card";

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

export function ActivityTimelineFilters({
  filters,
  onFiltersChange,
  filterOptions,
  onExport,
  isExporting,
}: ActivityTimelineFiltersProps) {
  const updateFilter = (key: keyof ActivityFilters, value: string | undefined) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  const handleDateChange = (range: DateRange | undefined) => {
    onFiltersChange({
      ...filters,
      dateFrom: range?.from?.toISOString() ?? undefined,
      dateTo: range?.to?.toISOString() ?? undefined,
    });
  };

  const handleReset = () => {
    onFiltersChange({});
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const dateRange: DateRange | undefined =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          to: filters.dateTo ? new Date(filters.dateTo) : undefined,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-card p-4 shadow-sm transition-all">
      {/* Top Search Bar Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="size-4 text-muted-foreground/70" />
          </div>
          <Input
            placeholder="Search events, labels, actors..."
            value={filters.search ?? ""}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="h-9 w-full bg-background/50 pl-9 border-border/40 shadow-none focus-visible:ring-1 focus-visible:border-border transition-colors text-sm"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <DatePickerWithRange
            date={dateRange}
            onDateChange={handleDateChange}
            className="w-[260px]"
          />
          
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-9 px-3 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="mr-2 size-3.5" />
              Reset
            </Button>
          )}

          {onExport && (
            <Button
              variant="default"
              size="sm"
              onClick={onExport}
              disabled={isExporting}
              className="h-9 px-4 font-medium shadow-sm"
            >
              <Download className="mr-2 size-3.5" />
              Export
            </Button>
          )}
        </div>
      </div>

      {/* Select Dropdowns Row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mr-2">
          <Filter className="size-3.5" />
          Filters
        </div>

        <Select value={filters.module ?? "all"} onValueChange={(v) => updateFilter("module", v === "all" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[140px] border-border/40 bg-background/30 text-xs shadow-none">
            <SelectValue placeholder="Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {(filterOptions?.modules ?? Object.keys(MODULE_CONFIG)).map((m) => (
              <SelectItem key={m} value={m}>{MODULE_CONFIG[m]?.label ?? m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.action ?? "all"} onValueChange={(v) => updateFilter("action", v === "all" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[140px] border-border/40 bg-background/30 text-xs shadow-none">
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

        <Select value={filters.entityType ?? "all"} onValueChange={(v) => updateFilter("entityType", v === "all" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[150px] border-border/40 bg-background/30 text-xs shadow-none">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {filterOptions?.entityTypes.map((e) => (
              <SelectItem key={e} value={e}>
                {e.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.severity ?? "all"} onValueChange={(v) => updateFilter("severity", v === "all" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[120px] border-border/40 bg-background/30 text-xs shadow-none">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        {filterOptions?.actors && filterOptions.actors.length > 0 && (
          <Select value={filters.actorId ?? "all"} onValueChange={(v) => updateFilter("actorId", v === "all" ? undefined : v)}>
            <SelectTrigger className="h-8 w-[150px] border-border/40 bg-background/30 text-xs shadow-none">
              <SelectValue placeholder="User" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {filterOptions.actors.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
