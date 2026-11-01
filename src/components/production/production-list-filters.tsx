import type { ReactNode } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductionListFilters as Filters } from "@/lib/production/list-filters";

const toDay = (date: Date | undefined) =>
  date ? format(date, "yyyy-MM-dd") : undefined;
const fromDay = (day: string | undefined) =>
  day ? new Date(`${day}T00:00:00`) : undefined;

/**
 * One compact row: created-date range and status on the left, page actions on
 * the right. Dates are Pakistan calendar days, both inclusive.
 */
export function ProductionListFilters<Status extends string>({
  value,
  onChange,
  statuses,
  actions,
}: {
  value: Filters<Status>;
  onChange: (value: Filters<Status>) => void;
  statuses: { value: Status; label: string }[];
  actions?: ReactNode;
}) {
  const range: DateRange | undefined = value.from
    ? { from: fromDay(value.from), to: fromDay(value.to) }
    : undefined;
  const hasFilters = !!(value.from || value.to || value.status);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <DatePickerWithRange
          className="w-full sm:w-64"
          date={range}
          onDateChange={(next) =>
            onChange({ ...value, from: toDay(next?.from), to: toDay(next?.to) })
          }
        />
        <Select
          value={value.status ?? "all"}
          onValueChange={(next) =>
            onChange({
              ...value,
              status: next === "all" ? undefined : (next as Status),
            })
          }
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button type="button" variant="ghost" onClick={() => onChange({})}>
            Clear filters
          </Button>
        )}
      </div>
      {actions && <div className="flex shrink-0 justify-end">{actions}</div>}
    </div>
  );
}
