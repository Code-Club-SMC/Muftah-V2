import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { type DateRange } from "react-day-picker";

interface Props {
  date: DateRange | undefined;
  onDateChange: (date: DateRange | undefined) => void;
  className?: string;
}

export function DatePickerWithRange({ date, onDateChange, className }: Props) {
  const [internalDate, setInternalDate] = useState<DateRange | undefined>(date);
  const [open, setOpen] = useState(false);

  // Sync only on initial mount or when external date changes while closed
  useEffect(() => {
    if (!open) {
      setInternalDate(date);
    }
  }, [date, open]);

  const handleApply = () => {
    onDateChange(internalDate);
    setOpen(false);
  };

  const handleClear = () => {
    setInternalDate(undefined);
    onDateChange(undefined);
  };

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            id="date-picker-range"
            className="w-full justify-start text-left font-normal border-dashed"
          >
            <CalendarIcon className="mr-2 size-4 opacity-50" />
            {internalDate?.from ? (
              internalDate.to ? (
                <>
                  {format(internalDate.from, "LLL dd, y")} -{" "}
                  {format(internalDate.to, "LLL dd, y")}
                </>
              ) : (
                format(internalDate.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={internalDate?.from}
            selected={internalDate}
            onSelect={setInternalDate}
            numberOfMonths={2}
          />
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
            <Button
              onClick={handleApply}
              className="flex-1"
              size="sm"
              disabled={!internalDate?.from}
            >
              Apply
            </Button>
            <Button
              onClick={handleClear}
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
    </div>
  );
}
