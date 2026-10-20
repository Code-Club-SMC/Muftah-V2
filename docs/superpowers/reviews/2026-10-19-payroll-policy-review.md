# Attendance payroll policy review

Reviewed on 19 October 2026 against the approved attendance-to-payroll specification and policy implementation report. Scope includes the reported policy handlers, calculator, hooks, reservation helper, generic attendance invalidation and focused tests. Browser harness and payroll lifecycle implementation in `core.ts` and `payroll-fn.ts` are outside this review.

Assessment: changes requested for two defects below. No production files or database records were changed during review.

## Findings

### 1. P2: accumulated half-rupee amounts still round down

Location: `src/lib/payroll-calculator.ts:263-265`, used for accumulated component deductions at line 600.

The new relative-epsilon adjustment repairs the checked examples but does not cover error accumulated across several divisions/additions. Call the production `calculateAbsentDeductions` with `basicSalary: "26625"`, `standardDutyHours: 8`, `restDays: []`, no allowances, divisor 26, and 13 distinct absent dates. It returns basic and absence deductions of **13,312**. The independent exact amount is `26625 / 26 * 13 = 13312.50`, which must round to **13,313** under A13 and section 4. The same failure occurs with basic amounts 15 and 45, so this is not an isolated large-number issue. Component/occasion reconciliation agrees on the wrong amount.

Reproduction, without a database:

```bash
bun -e 'import { calculateAbsentDeductions } from "./src/lib/payroll-calculator.ts"; const records = Array.from({length: 13}, (_, i) => ({date: `2026-09-${String(i + 1).padStart(2, "0")}`, status: "absent"})); console.log(calculateAbsentDeductions({basicSalary: "26625", standardDutyHours: 8, restDays: [], allowanceConfig: []} as any, records as any, 26).componentDeductions.basicSalary);'
```

Minimal fix: retain decimal/rational precision through the accumulation boundary, or use an error-bounded accumulation and half-up rounding method. Add this accumulated exact-half regression alongside the existing single-day and overtime checks. Increasing a single-operation epsilon without accounting for accumulation leaves the same failure class.

This is an incomplete correction of the pre-existing rounding defect, rather than a newly introduced salary formula.

### 2. P2: the new overtime conversion guard rejects valid rest-day overtime

Location: `src/server-functions/hr/attendance/convert-overtime-fn.ts:72-74`.

The new stale-hours check always subtracts `employee.standardDutyHours`. Existing punch recomputation deliberately uses zero standard hours on a configured rest day and stores all hours worked that day as overtime. For an employee with Sunday rest and an eight-hour standard shift, work eight hours on Sunday. The production attendance row has `dutyHours: "8.00"`, `overtimeHours: "8.00"`, status Present. Selecting that row previously satisfied the one-shift conversion threshold. The new check calculates zero suggested overtime and throws `Requested OT cannot be more than the suggested OT`, so valid earned hours cannot enter the comp bank.

The mismatch is explicit in `src/lib/attendance/recompute-server.ts`, where `effectiveStandardHours` is zero on a rest day and rest-day worked hours are retained as overtime. It also affects shift configurations whose calculated duty differs from the employee's fallback standard.

Minimal fix: validate conversion against the same effective standard used by recomputation, including rest days and configured shift hours. Add a handler regression for an eight-hour Sunday shift that credits eight hours once, while retaining the stale ordinary-workday refusal. This regression was introduced by the new conversion validation.

## Reviewed invariants and limits

- Reservation save/revision/cancellation/rejection paths use the shared locks and delta adjustment. Rejection clears the stored hours, so repeated rejection does not refund twice. A later approval retains zero applied hours until HR submits a new reservation; the calculator therefore grants zero comp-hour coverage.
- Annual decisions hold the shared payroll and employee locks before counting same-year paid annual dates. Repeated approval excludes the current row; rest-day historical rows are filtered. This serializes the decision endpoint. The existing attendance upsert still accepts client-supplied paid/approval fields, so the decision endpoint alone does not establish an application-wide entitlement invariant. This capability predates these changes and is not presented as a new regression.
- Generic invalidation now checks manually entered dates without requiring a device claim. Finalized checks and invalidation run inside the reviewed mutation transactions, so a failed finalized guard rolls back reservation updates too.
- Converting an already converted row and revoking its overtime decision are refused. Existing general attendance/punch edits can still change a converted day's earned hours without a bank reversal. That broader behavior predates the new process-overtime guard and is separate from the new rest-day regression above.

## Validation

The following focused sweep passed **34 tests across 3 files** during review:

```bash
bun run test src/server-functions/hr/attendance/leave-policies.behavior.test.ts src/lib/payroll-approved-policies.test.ts src/lib/attendance/device-import/payroll.test.ts
```

The monetary reproduction above was also executed directly against the production calculator and returned 13312. Focused tests use mocked transport/query adapters and do not prove PostgreSQL concurrency or browser behavior. No build, database operation or graph update was required for this read-only code review and documentation artifact.
