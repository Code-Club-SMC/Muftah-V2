import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { type DateRange } from "react-day-picker";
import { format } from "date-fns";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";

export interface InvoiceFilterState {
  dateFrom?: string;
  dateTo?: string;
  status?: "paid" | "credit" | "partial" | "all";
  customerType?: "distributor" | "retailer" | "all";
  warehouseId?: string;
  amountMin?: number;
  amountMax?: number;
}

interface Props {
  value: InvoiceFilterState;
  onChange: (value: InvoiceFilterState) => void;
  warehouses?: { id: string; name: string }[];
}

export const InvoiceFilters = ({ value, onChange, warehouses }: Props) => {
  const [collapsed, setCollapsed] = useState(true);

  // Staged (local) state — changes here don't trigger a fetch
  const [staged, setStaged] = useState<InvoiceFilterState>(value);

  // Sync staged when external value changes (e.g. route reload)
  useMemo(() => {
    setStaged(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasStagedChanges = JSON.stringify(staged) !== JSON.stringify(value);

  const stagedHasFilters = !!(
    staged.dateFrom ||
    staged.dateTo ||
    (staged.status && staged.status !== "all") ||
    (staged.customerType && staged.customerType !== "all") ||
    staged.warehouseId ||
    staged.amountMin !== undefined ||
    staged.amountMax !== undefined
  );

  const activeHasFilters = !!(
    value.dateFrom ||
    value.dateTo ||
    (value.status && value.status !== "all") ||
    (value.customerType && value.customerType !== "all") ||
    value.warehouseId ||
    value.amountMin !== undefined ||
    value.amountMax !== undefined
  );

  const handleDateRangeChange = useCallback((range: DateRange | undefined) => {
    setStaged((prev) => ({
      ...prev,
      dateFrom: range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
      dateTo: range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
    }));
  }, []);

  const dateRange = useMemo<DateRange | undefined>(() => {
    if (!staged.dateFrom && !staged.dateTo) return undefined;
    return {
      from: staged.dateFrom ? new Date(staged.dateFrom) : undefined,
      to: staged.dateTo ? new Date(staged.dateTo) : undefined,
    };
  }, [staged.dateFrom, staged.dateTo]);

  const handleApply = useCallback(() => {
    onChange(staged);
  }, [staged, onChange]);

  const handleClear = useCallback(() => {
    const cleared: InvoiceFilterState = {
      status: "all",
      customerType: "all",
    };
    setStaged(cleared);
    onChange(cleared);
  }, [onChange]);

  const updateStaged = useCallback(
    (partial: Partial<InvoiceFilterState>) => {
      setStaged((prev) => ({ ...prev, ...partial }));
    },
    [],
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
          {activeHasFilters && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {[
                value.dateFrom || value.dateTo,
                value.status && value.status !== "all",
                value.customerType && value.customerType !== "all",
                value.warehouseId,
                value.amountMin !== undefined,
                value.amountMax !== undefined,
              ].filter(Boolean).length}
            </span>
          )}
          {hasStagedChanges && (
            <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white animate-pulse">
              !
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="h-7 text-xs gap-1"
          >
            {collapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            {collapsed ? "Show" : "Hide"}
          </Button>
        </div>
      </div>

      {/* Filter body */}
      {!collapsed && (
        <>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Date Range */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date Range</Label>
                <DatePickerWithRange
                  date={dateRange}
                  onDateChange={handleDateRangeChange}
                  className="w-full"
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={staged.status ?? "all"}
                  onValueChange={(v) => updateStaged({ status: v as any })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Customer Type */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Customer Type</Label>
                <Select
                  value={staged.customerType ?? "all"}
                  onValueChange={(v) => updateStaged({ customerType: v as any })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="distributor">Distributor</SelectItem>
                    <SelectItem value="retailer">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Warehouse */}
              {warehouses && warehouses.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Warehouse</Label>
                  <Select
                    value={staged.warehouseId ?? "all"}
                    onValueChange={(v) => updateStaged({ warehouseId: v === "all" ? undefined : v })}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All warehouses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Amount Min */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Min Amount (PKR)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={staged.amountMin ?? ""}
                  onChange={(e) =>
                    updateStaged({
                      amountMin: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="h-9 text-sm"
                />
              </div>

              {/* Amount Max */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max Amount (PKR)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="No limit"
                  value={staged.amountMax ?? ""}
                  onChange={(e) =>
                    updateStaged({
                      amountMax: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Footer: Apply / Clear */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-muted/10">
            {activeHasFilters && (
              <Button variant="ghost" size="sm" onClick={handleClear} className="h-7 text-xs gap-1 text-muted-foreground">
                <X className="size-3" />
                Clear All
              </Button>
            )}
            {!activeHasFilters && <div />}
            <Button
              size="sm"
              onClick={handleApply}
              disabled={!hasStagedChanges}
              className="h-7 text-xs gap-1.5"
            >
              <Search className="size-3" />
              Apply Filters
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
