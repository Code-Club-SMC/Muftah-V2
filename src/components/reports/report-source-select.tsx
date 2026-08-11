import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REPORT_SOURCES,
  reportSourceLabel,
  type ReportSource,
} from "@/lib/report-source";

export function ReportSourceSelect({
  value,
  onValueChange,
}: {
  value: ReportSource;
  onValueChange: (value: ReportSource) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as ReportSource)}
    >
      <SelectTrigger className="w-full sm:w-52">
        <SelectValue aria-label="Invoice source" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {REPORT_SOURCES.map((source) => (
            <SelectItem key={source} value={source}>
              {reportSourceLabel(source)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
