import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface OvertimeHoursInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  maxHours: number;
  label?: string;
  hint?: string;
  inputError?: string | null;
  ariaDescribedBy?: string;
  disabled?: boolean;
}

function decimalToHoursMinutes(value: string | null | undefined) {
  const decimal = Number(value || "0");
  if (!Number.isFinite(decimal) || decimal <= 0) {
    return { hours: 0, minutes: 0 };
  }
  const totalMinutes = Math.round(decimal * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
}

function hoursMinutesToDecimal(hours: number, minutes: number): string {
  const total = hours + minutes / 60;
  return total.toFixed(2);
}

const PRESETS = [
  { label: "30m", hours: 0, minutes: 30 },
  { label: "1h", hours: 1, minutes: 0 },
  { label: "1h 30m", hours: 1, minutes: 30 },
  { label: "2h", hours: 2, minutes: 0 },
] as const;

export function OvertimeHoursInput({
  value,
  onChange,
  maxHours,
  label = "Requested OT Hours",
  hint,
  inputError,
  ariaDescribedBy,
  disabled = false,
}: OvertimeHoursInputProps) {
  const { hours, minutes } = useMemo(
    () => decimalToHoursMinutes(value),
    [value],
  );

  const totalDecimal = useMemo(
    () => hours + minutes / 60,
    [hours, minutes],
  );

  const handleHoursChange = (nextHours: number) => {
    const clampedHours = Math.max(0, Number.isFinite(nextHours) ? nextHours : 0);
    onChange(hoursMinutesToDecimal(clampedHours, minutes));
  };

  const handleMinutesChange = (nextMinutes: number) => {
    const clampedMinutes = Math.max(
      0,
      Math.min(59, Number.isFinite(nextMinutes) ? nextMinutes : 0),
    );
    onChange(hoursMinutesToDecimal(hours, clampedMinutes));
  };

  const applyPreset = (presetHours: number, presetMinutes: number) => {
    onChange(hoursMinutesToDecimal(presetHours, presetMinutes));
  };

  const formatSuggestedHoursMinutes = (decimalHours: number) => {
    const totalMinutes = Math.round(decimalHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.length > 0 ? parts.join(" ") : "0m";
  };

  return (
    <Field className="space-y-1.5">
      <FieldLabel className="text-[13px] font-bold text-foreground/90 tracking-wide">
        {label}
      </FieldLabel>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel className="text-[11.5px] font-medium text-muted-foreground">
            Hours
          </FieldLabel>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="0"
            disabled={disabled}
            value={hours || ""}
            onChange={(e) => handleHoursChange(Number(e.target.value))}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
            aria-describedby={ariaDescribedBy}
            aria-invalid={!!inputError}
            className={cn(
              "h-11 text-[14px] font-medium transition-colors bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-amber-500/30 rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
              inputError &&
                "border-destructive focus-visible:ring-destructive/30",
            )}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel className="text-[11.5px] font-medium text-muted-foreground">
            Minutes
          </FieldLabel>
          <Input
            type="number"
            min={0}
            max={59}
            inputMode="numeric"
            placeholder="0"
            disabled={disabled}
            value={minutes || ""}
            onChange={(e) => handleMinutesChange(Number(e.target.value))}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
            aria-describedby={ariaDescribedBy}
            aria-invalid={!!inputError}
            className={cn(
              "h-11 text-[14px] font-medium transition-colors bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-amber-500/30 rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
              inputError &&
                "border-destructive focus-visible:ring-destructive/30",
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {PRESETS.map(({ label: presetLabel, hours: ph, minutes: pm }) => {
          const presetDecimal = ph + pm / 60;
          const presetDisabled = presetDecimal > maxHours;
          const active = hours === ph && minutes === pm;
          return (
            <Button
              key={presetLabel}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              disabled={disabled || presetDisabled}
              onClick={() => applyPreset(ph, pm)}
              className={cn(
                "h-8 text-[12px] rounded-full",
                active &&
                  "bg-amber-600 hover:bg-amber-700 text-white border-amber-600",
              )}
            >
              {presetLabel}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground/80 font-medium">
        <span>
          Total: <strong className="text-foreground">{totalDecimal.toFixed(2)} hrs</strong>
        </span>
        <span>Suggested: {formatSuggestedHoursMinutes(maxHours)}</span>
      </div>

      {disabled && (
        <p className="text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">
          Overtime approved — locked from editing. Reset to pending in the approval center to change.
        </p>
      )}

      {hint && (
        <p id={ariaDescribedBy} className="text-[11.5px] text-muted-foreground/80 font-medium">
          {hint}
        </p>
      )}

      {inputError && (
        <p className="text-[11px] text-destructive">{inputError}</p>
      )}
    </Field>
  );
}
