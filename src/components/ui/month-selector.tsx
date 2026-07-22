import * as React from "react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MonthSelectorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  startYearOffset?: number;
  endYearOffset?: number;
}

function generateMonthOptions(
  startYearOffset = -2,
  endYearOffset = 1,
): { value: string; label: string }[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = currentYear + startYearOffset;
  const endYear = currentYear + endYearOffset;

  const options: { value: string; label: string }[] = [];

  for (let year = endYear; year >= startYear; year--) {
    for (let month = 12; month >= 1; month--) {
      const value = `${year}-${String(month).padStart(2, "0")}`;
      const label = format(parseISO(`${value}-01`), "MMMM yyyy");
      options.push({ value, label });
    }
  }

  return options;
}

export function MonthSelector({
  value,
  onChange,
  placeholder = "Select month",
  className,
  startYearOffset,
  endYearOffset,
}: MonthSelectorProps) {
  const options = React.useMemo(
    () => generateMonthOptions(startYearOffset, endYearOffset),
    [startYearOffset, endYearOffset],
  );

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "w-full sm:w-[180px] rounded-xl border-input bg-card hover:bg-accent/50",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-xl">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="rounded-lg"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
