# Overtime Hours Input Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decimal-only overtime hours input with separate hours/minutes inputs plus quick preset chips.

**Architecture:** A new presentational component `OvertimeHoursInput` converts between a decimal-hour string (the existing form value) and a `{ hours, minutes }` display. The parent form continues to store `overtimeHours` as a decimal string; only the rendering layer changes.

**Tech Stack:** React, TypeScript, TanStack Form, Tailwind CSS, shadcn/ui `Input`/`Button`/`Field`/`FieldLabel`, existing `cn` helper.

## Global Constraints

- No changes to the DB schema or API (`upsertAttendanceSchema` stays the same).
- `overtimeHours` remains a decimal-hour string in form state.
- Minutes must be clamped to `0-59`.
- Total requested OT cannot exceed suggested OT (existing server rule, mirrored client-side).
- Existing overtime reason validation remains unchanged.
- Follow existing file conventions under `src/components/hr/attendance/`.

---

## Task 1: Create `OvertimeHoursInput` component

**Files:**
- Create: `src/components/hr/attendance/overtime-hours-input.tsx`

**Interfaces:**
- Consumes: shadcn/ui `Input`, `Button`, `Field`, `FieldLabel`; project `cn` helper.
- Produces: `OvertimeHoursInput` component with props:
  - `value: string | null`
  - `onChange: (value: string | null) => void`
  - `maxHours: number`
  - `label?: string`
  - `hint?: string`
  - `inputError?: string | null`
  - `ariaDescribedBy?: string`

- [ ] **Step 1: Write the component**

Create `src/components/hr/attendance/overtime-hours-input.tsx` with the following content:

```tsx
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
    let clampedMinutes = Math.max(
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
          const disabled = presetDecimal > maxHours;
          const active = hours === ph && minutes === pm;
          return (
            <Button
              key={presetLabel}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              disabled={disabled}
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
```

- [ ] **Step 2: Verify no TypeScript errors in the new file**

Run: `bun run typecheck`
Expected: No errors related to `overtime-hours-input.tsx`.

- [ ] **Step 3: Commit the new component**

```bash
git add src/components/hr/attendance/overtime-hours-input.tsx
git commit -m "feat(attendance): add OvertimeHoursInput component"
```

---

## Task 2: Replace the decimal input in `edit-attendance-form.tsx`

**Files:**
- Modify: `src/components/hr/attendance/edit-attendance-form.tsx:1807-1863`

**Interfaces:**
- Consumes: `OvertimeHoursInput` from Task 1.
- Produces: Form renders hours/minutes inputs instead of a single decimal input.

- [ ] **Step 1: Import the new component**

Add to the imports at the top of `edit-attendance-form.tsx`:

```tsx
import { OvertimeHoursInput } from "./overtime-hours-input";
```

- [ ] **Step 2: Replace the `<form.Field name="overtimeHours">` block**

Replace lines 1807-1863:

```tsx
                            <div className="grid grid-cols-1 gap-3">
                              <form.Field name="overtimeHours">
                                {(field) => (
                                  <Field className="space-y-1.5">
                                    <FieldLabel className="text-[13px] font-bold text-foreground/90 tracking-wide">
                                      Requested OT Hours
                                    </FieldLabel>
                                    <div className="relative">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={formatHours(
                                          overtimeUi.summary.suggestedOvertimeHours,
                                        )}
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={field.state.value || ""}
                                        onChange={(e) =>
                                          handleOvertimeHoursChange(
                                            field,
                                            e.target.value || null,
                                          )
                                        }
                                        onWheel={(e) =>
                                          (e.target as HTMLInputElement).blur()
                                        }
                                        aria-describedby="overtime-hours-hint"
                                        aria-invalid={!!overtimeUi.inputError}
                                        className={cn(
                                          "h-11 text-[14px] font-medium transition-colors bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-amber-500/30 rounded-lg pr-11 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                          overtimeUi.inputError &&
                                            "border-destructive focus-visible:ring-destructive/30",
                                        )}
                                      />
                                      <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-muted-foreground"
                                      >
                                        hrs
                                      </span>
                                    </div>
                                    <p
                                      id="overtime-hours-hint"
                                      className="text-[11.5px] text-muted-foreground/80 font-medium"
                                    >
                                      Decimal format — e.g. 1.5 = 1 hr 30 min. Requested OT cannot be more than the suggested OT.
                                    </p>
                                    {overtimeUi.inputError && (
                                      <p className="text-[11px] text-destructive">
                                        {overtimeUi.inputError}
                                      </p>
                                    )}
                                  </Field>
                                )}
                              </form.Field>
                            </div>
```

With:

```tsx
                            <div className="grid grid-cols-1 gap-3">
                              <form.Field name="overtimeHours">
                                {(field) => (
                                  <OvertimeHoursInput
                                    value={field.state.value}
                                    onChange={(nextValue) => {
                                      overtimeEditedRef.current = true;
                                      field.handleChange(nextValue);
                                    }}
                                    maxHours={
                                      overtimeUi.summary.suggestedOvertimeHours
                                    }
                                    hint="Requested OT cannot be more than the suggested OT."
                                    inputError={overtimeUi.inputError}
                                    ariaDescribedBy="overtime-hours-hint"
                                  />
                                )}
                              </form.Field>
                            </div>
```

- [ ] **Step 3: Remove now-unused `handleOvertimeHoursChange` helper (optional cleanup)**

If `handleOvertimeHoursChange` is no longer referenced after Step 2, delete lines 1414-1420:

```tsx
  const handleOvertimeHoursChange = (
    field: { handleChange: (value: string | null) => void },
    nextValue: string | null,
  ) => {
    overtimeEditedRef.current = true;
    field.handleChange(nextValue);
  };
```

- [ ] **Step 4: Run typecheck again**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit the integration**

```bash
git add src/components/hr/attendance/edit-attendance-form.tsx
git commit -m "feat(attendance): use hours/minutes input for overtime entry"
```

---

## Task 3: Verify behavior manually

**Files:**
- None (manual verification in browser).

- [ ] **Step 1: Start dev server**

Run: `bun run dev`
Wait for the app to start on `http://localhost:3000`.

- [ ] **Step 2: Open an attendance edit modal**

Navigate to an employee attendance record with suggested OT > 0 and open the edit form.

- [ ] **Step 3: Test hours + minutes inputs**

- Enter `1` hour and `33` minutes. Verify the total shows `1.55 hrs`.
- Clear both fields. Verify total shows `0.00 hrs` and the overtime reason block disappears.
- Enter minutes `> 59` (e.g. `75`). Verify it clamps to `59`.

- [ ] **Step 4: Test preset chips**

- Click `1h 30m`. Verify hours = `1`, minutes = `30`, total = `1.50 hrs`.
- Verify chips above `maxHours` are disabled.
- Verify active chip highlights.

- [ ] **Step 5: Test save flow**

- Fill overtime reason.
- Save. Verify no validation error and the stored value is correct (inspect network response or re-open the form).

---

## Self-Review

- **Spec coverage:** Separate hours/minutes inputs, preset chips, live total, suggested OT display, no schema changes — all covered.
- **Placeholder scan:** No TBD/TODO/vague steps.
- **Type consistency:** `value: string | null` and `onChange: (value: string | null) => void` match the existing form field type.
- **Cleanup:** `handleOvertimeHoursChange` removal noted as optional but recommended.
