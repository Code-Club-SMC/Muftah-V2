import { DatePicker } from "@/components/custom/date-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ExpenseFieldDraftValue } from "@/lib/finance-expenses";
import type { ExpenseCategoryFieldDefinition } from "@/lib/types/finance-types";

export function ExpenseDynamicFieldInput({
  field,
  value,
  onChange,
}: {
  field: ExpenseCategoryFieldDefinition;
  value?: ExpenseFieldDraftValue;
  onChange: (value: ExpenseFieldDraftValue) => void;
}) {
  const inputId = `expense-field-${field.id}`;
  const placeholder = field.placeholder || `Enter ${field.label.toLowerCase()}...`;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
        {field.label}
        {field.isRequired ? (
          <Badge variant="outline" className="rounded-none px-1 py-0 text-[10px] shadow-none">
            Required
          </Badge>
        ) : null}
      </Label>

      {field.fieldType === "textarea" ? (
        <Textarea
          id={inputId}
          placeholder={placeholder}
          value={value?.valueText || ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
          className="min-h-16 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "text" ? (
        <Input
          id={inputId}
          placeholder={placeholder}
          value={value?.valueText || ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
          className="h-11 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "number" ? (
        <Input
          id={inputId}
          type="number"
          inputMode="decimal"
          placeholder={placeholder}
          value={value?.valueNumber || ""}
          onChange={(event) => onChange({ valueNumber: event.target.value })}
          // A number box must not change when the page is scrolled over it.
          onWheel={(event) => event.currentTarget.blur()}
          className="h-11 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "date" ? (
        <DatePicker
          date={value?.valueDate}
          onChange={(date) => onChange({ valueDate: date })}
          placeholder={`Pick ${field.label.toLowerCase()}`}
          className="h-11 w-full justify-start rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "select" ? (
        <Select value={value?.valueOptionId || ""} onValueChange={(next) => onChange({ valueOptionId: next })}>
          <SelectTrigger id={inputId} className="h-11 w-full rounded-none shadow-none">
            <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            {field.options.map((option) => (
              <SelectItem key={option.id} value={option.id} className="rounded-none">
                {option.isActive ? option.label : `${option.label} (no longer offered)`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.fieldType === "boolean" ? (
        <Select
          value={value?.valueBoolean || ""}
          onValueChange={(next: "true" | "false") => onChange({ valueBoolean: next })}
        >
          <SelectTrigger id={inputId} className="h-11 w-full rounded-none shadow-none">
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            <SelectItem value="true" className="rounded-none">Yes</SelectItem>
            <SelectItem value="false" className="rounded-none">No</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
