# Attendance Overtime Request Design

Date: 2026-07-04

## Goal

Make overtime request and approval reliable for punch-driven standard staff.

The system should:

- calculate worked hours from punches
- suggest overtime automatically from worked hours vs standard duty hours
- require the HR/operator to explain why overtime happened
- let admin only approve or reject the requested overtime
- prevent stale or invalid overtime requests from reaching payroll

## Scope

This design covers:

- Standard staff present attendance rows that are driven by punches.
- Overtime request entry inside the attendance edit form.
- Overtime approval review in the admin approvals screen.
- Payroll treatment of approved overtime only.
- Revalidation when punches change after an overtime request exists.

This design does not cover:

- Order booker overtime rules.
- Admin editing overtime hours.
- A new overtime audit log table.
- A new shift scheduling module.

## Current Problem

Today the system recalculates:

- check-in
- check-out
- duty hours
- late status
- night shift

But `overtimeHours` is still manual.

That creates a bad gap:

- an employee can work 10 hours against an 8-hour standard day
- duty hours correctly become `10.00`
- overtime can still remain `0.00`
- payroll then pays no overtime unless HR manually notices and enters it

This is accurate for storage, but weak for UX and risky for payroll.

## Product Behavior

### 1. Suggested Overtime

For punch-driven standard staff, the system will calculate:

```ts
suggestedOvertimeHours = max(0, dutyHours - standardDutyHours)
```

Example:

- standard duty hours: `8.00`
- worked duty hours: `10.00`
- suggested overtime: `2.00`

This value is derived. It is not typed manually.

### 2. Operator Request Flow

Inside the attendance edit form:

- `Duty Hours` stays read-only and punch-driven.
- Add a read-only `Suggested OT` field.
- Keep `Requested OT Hours` as the editable field stored in `attendance.overtimeHours`.
- Prefill `Requested OT Hours` from `Suggested OT` when:
  - the row is present
  - the employee is punch-driven standard staff
  - there is no existing OT request yet
  - suggested OT is greater than `0`

Operator rules:

- operator may reduce requested OT below suggested OT
- operator may not request more OT than suggested OT
- if requested OT is greater than `0`, remarks are required
- saving requested OT greater than `0` sets status to `pending`

If requested OT is `0`:

- the form behaves as "no OT request"
- remarks are cleared
- stored OT hours become `0.00`
- the row is treated as non-payable even if the stored status field remains at its default technical value

### 3. Remarks Requirement

If requested OT is greater than `0`, `overtimeRemarks` is mandatory.

The UI should label it clearly:

- `Overtime Reason`
- helper text like: `Explain why extra hours were needed. Admin will review this before approval.`

This reason is the main context admin reads before approving.

### 4. Admin Approval Flow

Admin can only:

- approve
- reject

Admin cannot change requested hours.

The approvals screen should show:

- employee
- date
- standard duty hours
- worked duty hours
- suggested OT
- requested OT
- operator remarks
- overtime status

The approve action means:

- admin accepts the exact requested hours already stored on the row

The reject action means:

- the OT request is not payable
- payroll must ignore it

### 5. Payroll Behavior

Payroll continues using the existing rule:

- only `approved` overtime is paid

Formula stays:

```ts
overtimePay = perHourBasic * overtimeMultiplier * approvedOvertimeHours
```

`approvedOvertimeHours` is still the sum of attendance rows where:

- `overtimeHours > 0`
- `overtimeStatus === "approved"`

## Punch Change Revalidation

This is the critical integrity rule.

Overtime requests must stay tied to the latest punch truth.

Whenever punches change for a present standard-staff row, the system recomputes:

- duty hours
- suggested overtime

Then it compares:

- `requested OT`
- `suggested OT`

### Valid Case

If:

```ts
requestedOt <= suggestedOt
```

then the request is still valid.

Examples:

- requested `2.00`, suggested `2.00` → valid
- requested `1.50`, suggested `2.00` → valid

If the request is valid, the current OT status may remain as-is.

### Invalid Case

If:

```ts
requestedOt > suggestedOt
```

then the request is stale and no longer safe.

Examples:

- requested `2.00`, suggested later drops to `1.00`
- requested `2.00`, suggested later drops to `0.00`

When that happens:

- OT status resets to `pending`
- the request remains visible
- admin approval must be blocked
- HR/operator must review and resave the request

This avoids silent overpayment and preserves the operator’s original reason/context.

### Soft Mismatch

If punches increase and suggested OT becomes larger than the current request:

- requested `2.00`, suggested later becomes `3.00`

the request remains valid because it is not overstated.

The UI should show a soft warning to HR:

`Punches changed. Current OT request is lower than the latest suggested OT. Update it if needed.`

Admin can still approve the lower requested amount.

### Approved Requests That Become Stale

If an OT request was already approved and punches later reduce the eligible OT below the approved request:

- the status must automatically go back to `pending`

Reason:

- the basis of approval changed
- approved OT should not survive stale punch data

This rule is especially important before payroll generation.

## Data Model

No new OT table is required for this version.

Reuse existing attendance fields:

- `attendance.dutyHours`
- `attendance.overtimeHours`
- `attendance.overtimeStatus`
- `attendance.overtimeRemarks`

Derived values should be computed in server reads, not stored permanently:

- `suggestedOvertimeHours`
- `overtimeRequestState`
- `overtimeRequestWarning`

Suggested shape returned by server functions:

```ts
{
  requestedOvertimeHours: number
  suggestedOvertimeHours: number
  isOvertimeRequestStale: boolean
  overtimeRequestWarning: string | null
}
```

## Server Rules

### Attendance Save

For punch-driven standard staff present rows:

- recompute duty hours first
- compute suggested OT from recomputed duty hours
- validate requested OT against suggested OT
- reject saves where requested OT is greater than suggested OT
- require remarks when requested OT is greater than `0`

### Punch Recompute

When punches are added, corrected, or deleted:

- recompute attendance row
- recompute suggested OT
- compare against requested OT
- if requested OT becomes invalid:
  - set overtime status to `pending`
  - keep requested hours and remarks

### Approval Read

The OT approvals query should include enough context for admin:

- standard duty hours
- duty hours
- suggested OT
- stale flag
- warning text

If a row is stale, approve must be blocked at both:

- UI level
- server level

## UI Changes

### Attendance Edit Form

Add:

- `Suggested OT` read-only summary
- `Requested OT Hours` editable field
- required `Overtime Reason` when requested OT > 0
- warning banner when requested OT is stale
- warning banner when request is lower than latest suggestion

The form should speak plainly:

- `Suggested OT is based on punches and standard duty hours.`
- `Requested OT cannot be more than the suggested OT.`

### Overtime Approvals Screen

Add columns or stacked context for:

- standard hours
- worked hours
- suggested OT
- requested OT
- operator remarks

If stale:

- show badge like `Needs Recheck`
- disable approve button
- explain why the request is blocked

## Edge Cases

### No Shift Window Configured

If an employee has no saved shift window:

- late/early-leave logic may be limited
- overtime suggestion still works from `standardDutyHours`

This keeps Jasmine-like cases workable even before shift schedules are fully configured.

### Zero or Negative Extra Time

If worked duty is less than or equal to standard duty:

- suggested OT is `0`
- no OT request should be allowed above `0`

### Existing Historical Rows

Existing attendance rows with manual OT remain readable.

Once those rows are edited through the new flow, they must follow the new validation rules.

## Testing

Add tests for:

- suggested OT = `dutyHours - standardDutyHours`
- request is prefilled from suggestion for punch-driven present rows
- request cannot exceed suggestion
- remarks required when request > `0`
- request `0` clears reason and stays non-payable
- punch change that reduces suggestion below request resets OT to `pending`
- punch change that increases suggestion above request keeps request valid
- approved request becomes pending again if later punch edits make it stale
- admin approvals query returns suggestion and stale state
- admin cannot approve stale request

## Recommendation

Implement this in the current attendance/payroll model without adding new tables.

That gives:

- fast operator flow
- clear admin review
- safe payroll behavior
- low migration risk

It also keeps the system simple:

- punches decide worked time
- operator requests OT with a reason
- admin approves or rejects
- payroll pays only approved OT
