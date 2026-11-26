import { addMonths, format, parse } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const currentMonth = () => format(new Date(), "yyyy-MM");

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const date = parse(`${month}-01`, "yyyy-MM-dd", new Date());
  const shift = (by: number) => onChange(format(addMonths(date, by), "yyyy-MM"));
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
      <span className="min-w-32 text-center text-sm font-medium">{format(date, "MMMM yyyy")}</span>
      <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
    </div>
  );
}
