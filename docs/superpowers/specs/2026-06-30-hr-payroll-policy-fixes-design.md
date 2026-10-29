# HR Payroll Policy and Audit Fixes Design

Date: 2026-06-30

## Goal

Implement the HR/payroll audit fixes with a policy model that gives admins clear control over basic salary deductions. The system will stop hardcoding basic salary cuts and will calculate payroll from explicit, auditable deduction rules.

## Scope

This design covers:

- Company-level basic salary deduction policy.
- Employee-level opt-in override for basic salary deduction policy.
- Corrected attendance, leave, proration, payslip, and reporting deduction behavior.
- Annual leave entitlement enforcement for the 14-day default.
- Payroll integrity fixes for duplicate records, partial generation, advance rounding, and finance reversals.
- Payroll period integrity fixes for 16th-to-15th cycles, payout-month selection, early processing, and missed-cycle handling.
- Regression tests around deduction behavior and high-risk server workflows.

This design does not introduce a full HR policy engine for every payroll rule. Allowance deduction rules already exist per employee and will remain in the employee salary configuration.

## Product Behavior

Admins will manage a company default policy in an HR Payroll Settings screen. The default policy controls when basic salary is deducted:

```ts
{
  absent: true,
  annualLeave: false,
  sickLeave: false,
  specialLeave: false,
  lateArrival: true,
  earlyLeaving: true,
  notEmployed: true,
}
```

Employee Add/Edit screens will show a Basic Salary Deduction Policy card. By default, employees follow the company policy. Admins can turn on "Override company policy" for exceptional employees and edit the same rule toggles for that employee.

Payroll will resolve basic salary policy in this order:

```ts
effectivePolicy =
  employee.basicSalaryDeductionPolicyOverride ?? company.basicSalaryDeductionPolicy
```

The UI must clearly label whether a payslip used company policy or an employee override.

## Data Model

Add a typed HR settings table, not raw `app_settings` SQL:

- `hr_payroll_settings.id`
- `hr_payroll_settings.basic_salary_deduction_policy`
- `hr_payroll_settings.created_at`
- `hr_payroll_settings.updated_at`
- `hr_payroll_settings.updated_by`

Add employee override fields:

- `employees.basic_salary_deduction_policy_override_enabled`
- `employees.basic_salary_deduction_policy_override`

The override JSON stores only the same basic salary policy shape. If override is disabled, payroll ignores the override JSON even if old data exists.

Add database uniqueness constraints:

- `attendance(employee_id, date)` unique.
- `payrolls(month)` unique.
- `payslips(payroll_id, employee_id)` unique.
- `night_shift_rates(year)` unique if not already enforced by migration.

## Deduction Rules

Basic salary deductions will use the effective policy:

- `absent`: deduct per day if enabled.
- `annualLeave`: deduct per day only for unpaid or excess annual leave if enabled.
- `sickLeave`: deduct per day if enabled.
- `specialLeave`: deduct per day if enabled. Default is false so special leave pays only basic salary while allowance flags handle allowance cuts.
- `lateArrival`: deduct hourly if enabled.
- `earlyLeaving`: deduct hourly if enabled.
- `notEmployed`: deduct per day for joining date and cutoff proration if enabled.

Allowance deductions remain controlled by `allowanceConfig[].deductions`.

The calculator will return both adjusted earnings and a complete deduction breakdown. `totalDeductions` will include attendance, proration, advance, tax, manual deductions, and previous deficit. Net salary will be derived once from this canonical calculation.

## Leave Behavior

Attendance leave entries must have a valid `leaveType`. Server validators will reject `status: "leave"` without `leaveType`.

Annual leave entitlement:

- Default annual leave allowance remains 14 days.
- Employee create/edit will expose annual leave allowance to HR admins.
- Employee detail will show current annual leave balance as read-only payroll state.
- Approving annual leave will check entitlement for the leave year.
- Approved annual leave within entitlement is paid according to policy.
- Annual leave beyond entitlement is converted to unpaid annual leave for payroll purposes, not silently accepted as paid.
- Sick leave remains tracked separately with its existing 10-day default unless business rules are changed later.

Balances will update on leave approval and payroll approval. Payroll approval will still recalculate balances as a safety net, but approval-time validation becomes the primary guardrail.

## Payslip and Reporting

Payslip display must not double-subtract attendance deductions. Earnings shown on the payslip are already adjusted by the calculator, so deduction rows must be informational unless the net salary calculation explicitly uses unadjusted earnings.

The chosen canonical model:

- Store original salary components.
- Store adjusted salary components.
- Store attendance/proration deduction rows.
- Compute printed net from original earnings plus additions minus all deductions.
- Treat adjusted salary components as display/audit fields, not as the source for subtracting deductions again.

Reports and dashboards that show total deductions will use the canonical `totalDeductions`, which includes attendance and proration deductions.

## Payroll Period Behavior

Payroll periods are payout-month based:

- Payout month `YYYY-MM` maps to stored payroll month `YYYY-MM-01`.
- Cycle start is the 16th of the previous calendar month.
- Cycle end is the 15th of the payout month.
- Payout date is the 25th of the payout month.

The implementation must centralize this logic in `src/lib/payroll-cycle.ts`. Server functions must not manually reconstruct period start/end with local date math.

Payroll lifecycle states:

- Accruing: cycle start through cycle end.
- Processing: the 16th through the 25th of the payout month.
- Late/closed: after the 25th, unless the payroll is still draft or unpaid.

The payroll page will default to the current active payout month, but admins must be able to select prior payout months. This prevents late or missed payrolls from disappearing after the active cycle advances on the 26th.

Route loaders, server prefetches, payroll table queries, simulations, and salary calculator saves must use the same month key. The route loader must not prefetch the calendar month while the component queries the active payout month.

Early processing must be explicit:

- Full-cycle generation before cycle end is blocked.
- If admin chooses an early cutoff date, payroll is calculated only through that cutoff.
- Future days after the cutoff are not treated as absence or employee misconduct.
- Future unearned days may be shown as a separate early-cutoff/proration line, not as `not_employed`.
- Early-cutoff days must not affect Bradford, leave balances, annual leave usage, overtime, or night shift counts.

Boundary tests must cover the 15th, 16th, 25th, and 26th, plus January rollover and leap-year February.

Salary revisions currently use the salary revision active at cycle start. This implementation will keep that rule for deterministic payroll unless a separate mid-cycle proration feature is requested. The UI should make the applied salary revision visible on preview and payslip.

## Payroll Generation Integrity

Bulk payslip generation must be all-or-fail for a payroll run. If any employee fails generation, the run should return errors and avoid approving a partial payroll.

Payroll approval must verify:

- Payroll status allows approval.
- Payroll has a payslip for every eligible employee in the payroll period.
- No pending leave or overtime decisions affect the period.
- No duplicate payslips exist for the payroll.

Selective payroll generation will honor `employeeIds` for simulations and generation. Partial runs remain draft-only and non-approvable unless they cover all eligible employees.

## Finance and Advance Fixes

Salary advance installments must distribute rounding remainder to the final installment so the recovered amount exactly equals the approved advance amount.

Salary advance rejection must be status-aware:

- Pending advances can be rejected.
- Approved advances cannot be rejected without a reversal workflow.
- If reversal is added, it must create an offsetting wallet transaction and update advance state atomically.

Employee deletion approval must not delete financial records that already affected wallets or payroll. It should block deletion or require explicit reversal workflows for approved salary advances and reimbursed travel logs.

TADA reimbursement and payroll reimbursement must re-check eligibility inside the transaction to avoid concurrent double reimbursement.

## Attendance Fixes

Attendance writes will use database upsert backed by the unique `(employee_id, date)` constraint.

Changing attendance status will normalize incompatible fields:

- Non-leave rows clear `leaveType`, leave approval status, and approved leave flags.
- Non-present rows clear late, early, overtime, and night shift fields.
- Night shift allowance counts only present attendance rows.

Daily attendance should list active employees by default. Terminated or resigned employees should only appear when viewing historical dates where they were employed.

Rest days validation will prevent selecting all seven days as rest days.

Early departure deductions will only apply for the intended payroll-affecting status, not for every non-`none` marker.

## Server Functions and Permissions

Add HR settings server functions:

- `getHrPayrollSettingsFn`
- `updateHrPayrollSettingsFn`

Both require HR permissions:

- View requires `hr.view`.
- Update requires `hr.manage`.

Employee create/update functions will accept override fields and validate policy shape. Payroll functions will read HR settings once per run and pass the effective policy into pure calculator functions.

## UI

Add `/hr/settings` as a dedicated HR Settings route. The navigation should expose it to users with HR access.

The settings UI will use the same occasion language as allowance cards:

- Absent
- Annual leave
- Sick leave
- Special leave
- Late arrival
- Early leaving
- Not employed / proration

Employee forms will show:

- Company policy summary.
- Override switch.
- Override toggles only when enabled.
- Warning text that overrides should be used only for contractual exceptions.

Payslip UI will show the policy source and corrected deduction totals.

## Migration and Backfill

Migration will insert a singleton HR payroll settings row with the default basic salary policy.

Existing employees will have override disabled by default. This preserves company-level behavior and avoids accidental per-employee drift.

Existing payslips will not be recalculated by migration. New or regenerated draft payslips will use the corrected logic. Approved or paid historical payrolls remain immutable unless a separate correction workflow is requested.

## Testing

Add unit tests for payroll calculator cases:

- Approved annual leave does not deduct basic by default.
- Unapproved or excess annual leave deducts according to policy.
- Sick leave does not deduct basic by default.
- Special leave keeps basic by default and deducts allowance flags.
- Absence deducts basic plus configured allowance flags.
- Late and early deductions respect basic policy toggles.
- Not-employed proration respects basic policy and always prorates allowances.
- `totalDeductions` includes attendance and proration deductions.

Add source/server workflow tests for:

- Leave requires `leaveType`.
- Annual leave cap enforcement.
- Attendance upsert uses conflict target.
- Payroll approval rejects incomplete payslip coverage.
- Advance installment totals equal approved amount.
- Advance rejection cannot reject approved advances without reversal.
- Night shift allowance counts present rows only.

Add payroll period tests for:

- `getCycleForPayoutMonth` returns correct 16th-to-15th windows across normal months, January rollover, and leap-year February.
- Current active cycle shifts to the next payout month only after the 25th.
- Processing window is the 16th through 25th.
- Payroll route loader and container use the same payout month key.
- Early generation without explicit cutoff is rejected.
- Explicit early cutoff does not classify future cycle days as `not_employed`.
- Missed-cycle detection does not hide late unpaid payrolls after the active month advances.

Run at minimum:

```bash
bun test src/lib/hr-payroll-regressions.test.ts
bun run typecheck
bun run build
```

## Rollout Notes

This change affects salary calculations. The UI must make corrected deductions visible before payroll approval. Admins should regenerate draft payrolls after changing policy. Approved and paid payrolls stay locked.

The first implementation milestone should focus on typed policy, calculator correctness, payslip/report correctness, leave type validation, and tests. The second milestone should handle database uniqueness migrations and finance reversal safeguards if migration risk needs to be separated.
