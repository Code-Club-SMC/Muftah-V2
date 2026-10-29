# Overtime Hours Input UX Redesign

## Problem

The current "Requested OT Hours" field uses decimal hours (`1.33` = 1 hour 20 minutes). Users routinely confuse this with hours-and-minutes notation (`1.33` interpreted as 1 hour 33 minutes). This causes payroll errors and support confusion.

## Goal

Make overtime entry intuitive by accepting **hours and minutes as separate values** while preserving the existing database schema (decimal hours stored as a string).

## Approach

**Option B: Two inputs + quick preset chips.**

- Replace the single number input with a side-by-side `Hours` and `Minutes` input.
- Provide one-click chips for common values: `30m`, `1h`, `1h 30m`, `2h`.
- Show a live total in decimal hours (e.g. `Total: 1.55 hrs`).
- Keep `overtimeHours` in the form as the single source of truth in decimal-hour string form.

## UX/Behavior

- Field label remains "Requested OT Hours".
- Inputs render in a row:
  - `Hours` — integer, min `0`.
  - `Minutes` — integer, min `0`, max `59`.
- Live total displayed below: `Total: {decimal} hrs`.
- Suggested OT rendered as hours/minutes: `Suggested: 1h 30m`.
- Preset chips fill both inputs and update the total.
- Chips are disabled when selecting them would exceed the suggested OT.
- Existing overtime reason validation remains unchanged.

## Data Flow

```
User edits Hours/Minutes ──► parse to decimal ──► form.setFieldValue("overtimeHours", decimalString)
                                                                       ▲
User clicks preset chip ──► convert preset to Hours/Minutes ────────────┘
```

- The form field `overtimeHours` continues to store a decimal-hour string.
- The new `OvertimeHoursInput` component is presentational only.
- No changes to `upsertAttendanceSchema` or the server function.

## Component Design

- New file: `src/components/hr/attendance/overtime-hours-input.tsx`.
- Props:
  - `value: string | null` — current decimal-hour value from form.
  - `onChange: (value: string | null) => void` — emits decimal-hour string.
  - `maxHours: number` — suggested overtime in decimal hours (for chip disabling).
  - `label?: string` — optional label override.
- Uses existing `Input`, `Button`, `Field`, `FieldLabel`, and `cn`.
- Helper functions inside the component:
  - `decimalToHoursMinutes(value)` → `{ hours: number, minutes: number }`.
  - `hoursMinutesToDecimal(hours, minutes)` → `string` rounded to 2 decimals.

## Validation

- `Minutes` input clamped to `0-59`.
- `Hours` input non-negative integer.
- Total decimal hours must not exceed `maxHours`.
- If total > 0, overtime reason required (existing `.refine` in `upsertAttendanceSchema`).

## Files to Change

- `src/components/hr/attendance/edit-attendance-form.tsx`
  - Replace the single `overtimeHours` `<Input>` with the new `OvertimeHoursInput` component.
- `src/components/hr/attendance/overtime-hours-input.tsx`
  - New presentational component.

## Out of Scope

- Changing the database column type or the API schema.
- Changing payroll calculations that consume `overtimeHours`.
- Adding chips beyond the four presets (`30m`, `1h`, `1h 30m`, `2h`).

## Testing Notes

- Verify `1h 33m` produces `"1.55"`.
- Verify `30m` produces `"0.50"`.
- Verify chips respect `maxHours` and disable correctly.
- Verify overtime reason validation still triggers when total > 0.
