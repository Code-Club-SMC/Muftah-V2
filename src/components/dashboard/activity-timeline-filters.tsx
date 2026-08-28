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
import { Download, RotateCcw, Search } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { MODULE_CONFIG } from "./activity-event-card";

// ── TYPES ──────────────────────────────────────────────────────────────────

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

// ── COMPONENT ──────────────────────────────────────────────────────────────

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
    <div className="space-y-3">
      {/* Row 1: Search + Date Range + Actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search events..."
            value={filters.search ?? ""}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9 h-9 text-sm bg-background/50 border-border/60"
          />
        </div>

        <DatePickerWithRange
          date={dateRange}
          onDateChange={handleDateChange}
          className="w-auto"
        />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-9 px-3 text-muted-foreground hover:text-foreground gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        )}

        {onExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={isExporting}
            className="h-9 px-3 gap-1.5 border-dashed"
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        )}
      </div>

      {/* Row 2: Dropdown filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Module */}
        <Select
          value={filters.module ?? "all"}
          onValueChange={(v) => updateFilter("module", v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs bg-background/50 border-border/60">
            <SelectValue placeholder="All Modules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {(filterOptions?.modules ?? Object.keys(MODULE_CONFIG)).map((m) => (
              <SelectItem key={m} value={m}>
                {MODULE_CONFIG[m]?.label ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Action */}
        <Select
          value={filters.action ?? "all"}
          onValueChange={(v) => updateFilter("action", v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs bg-background/50 border-border/60">
            <SelectValue placeholder="All Actions" />
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

        {/* Entity Type */}
        <Select
          value={filters.entityType ?? "all"}
          onValueChange={(v) => updateFilter("entityType", v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[150px] h-8 text-xs bg-background/50 border-border/60">
            <SelectValue placeholder="All Entities" />
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

        {/* Severity */}
        <Select
          value={filters.severity ?? "all"}
          onValueChange={(v) => updateFilter("severity", v === "all" ? undefined : v)}
        >
          <SelectTrigger className="w-[120px] h-8 text-xs bg-background/50 border-border/60">
            <SelectValue placeholder="All Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        {/* Actor */}
        {filterOptions?.actors && filterOptions.actors.length > 0 && (
          <Select
            value={filters.actorId ?? "all"}
            onValueChange={(v) => updateFilter("actorId", v === "all" ? undefined : v)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs bg-background/50 border-border/60">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {filterOptions.actors.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
