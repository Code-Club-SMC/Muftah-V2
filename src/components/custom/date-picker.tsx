import { useEffect, useState } from "react";
import { format, getYear, getMonth } from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";

interface DatePickerProps {
  date?: Date;
  onChange?: (date?: Date) => void;
  range?: DateRange;
  onRangeChange?: (date: DateRange | undefined) => void;
  mode?: "single" | "range";
  placeholder?: string;
  className?: string;
  tourId?: string;
  /**
   * When true, shows a month-grid picker instead of a full calendar.
   * Useful for dashboard filters that operate on a monthly granularity.
   */
  monthOnly?: boolean;
  formatStr?: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function MonthPicker({
  date,
  onChange,
  onClose,
}: {
  date?: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(
    date ? getYear(date) : getYear(today),
  );

  const selectedMonth = date ? getMonth(date) : -1;
  const selectedYear = date ? getYear(date) : -1;

  const isFuture = (monthIndex: number) => {
    if (viewYear > getYear(today)) return true;
    if (viewYear === getYear(today) && monthIndex > getMonth(today))
      return true;
    return false;
  };

  return (
    <div className="p-3 w-55">
      {/* Year navigation */}
      <div className="flex items-center justify-between mb-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setViewYear((y) => y - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="text-sm font-bold tabular-nums">{viewYear}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setViewYear((y) => y + 1)}
          disabled={viewYear >= getYear(today)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((label, idx) => {
          const isSelected = selectedYear === viewYear && selectedMonth === idx;
          const disabled = isFuture(idx);

          return (
            <button
              key={label}
              disabled={disabled}
              onClick={() => {
                onChange(new Date(viewYear, idx, 1));
                onClose();
              }}
              className={cn(
                "rounded-md py-1.5 text-xs font-semibold transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-foreground",
                disabled && "opacity-30 cursor-not-allowed pointer-events-none",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DatePicker({
  date,
  onChange,
  range,
  onRangeChange,
  mode = "single",
  placeholder = "Pick a date",
  className,
  tourId,
  monthOnly = false,
  formatStr = "PPP",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [internalRange, setInternalRange] = useState<DateRange | undefined>(
    range,
  );

  useEffect(() => {
    if (!open && mode === "range") {
      setInternalRange(range);
    }
  }, [range, open, mode]);

  if (monthOnly) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal gap-2",
              !date && "text-muted-foreground",
              className,
            )}
            data-tour={tourId}
          >
            <CalendarIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {date ? format(date, formatStr || "MMMM yyyy") : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <MonthPicker
            date={date}
            onChange={(d) => onChange?.(d)}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    );
  }

  if (mode === "range") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal gap-2",
              !internalRange?.from && "text-muted-foreground",
              className,
            )}
            data-tour={tourId}
          >
            <CalendarIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {internalRange?.from
                ? internalRange.to
                  ? `${format(internalRange.from, "LLL dd, y")} - ${format(internalRange.to, "LLL dd, y")}`
                  : format(internalRange.from, "LLL dd, y")
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={internalRange?.from}
            selected={internalRange}
            onSelect={setInternalRange}
            numberOfMonths={2}
          />
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
            <Button
              onClick={() => {
                onRangeChange?.(internalRange);
                setOpen(false);
              }}
              className="flex-1"
              size="sm"
              disabled={!internalRange?.from}
            >
              Apply
            </Button>
            <Button
              onClick={() => {
                setInternalRange(undefined);
                onRangeChange?.(undefined);
              }}
              variant="outline"
              size="sm"
              className="gap-1"
            >
              <X className="size-3" />
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Full calendar fallback (kept for non-monthOnly usages)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal gap-2",
            !date && "text-muted-foreground",
            className,
          )}
          data-tour={tourId}
        >
          <CalendarIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {date ? format(date, formatStr) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d: Date | undefined) => {
            onChange?.(d);
            if (d) setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
