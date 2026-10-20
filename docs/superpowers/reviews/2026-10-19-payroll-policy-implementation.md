# Attendance payroll policy implementation

Date: 19 October 2026

Task 1 implements the approved P1–P4 decisions. This report covers focused production changes and regressions; the separate browser and PostgreSQL lifecycle suites provide end-to-end evidence.

## Changes

| Files | Behavior |
| --- | --- |
| `src/lib/payroll-calculator.ts` | Paid annual leave preserves basic even with the annual basic switch enabled. Unpaid annual still follows that switch and allowance flags. Approved partial comp leave covers only its stored hours; uncovered duty uses the existing undertime policy. Stored two-decimal duty shortfalls are calculated at that boundary. Installed Big.js accumulates exact monetary numerators over a common denominator; an exact remainder comparison rounds whole rupees, including overtime halves and repeated fractional daily rates. All occasion totals reconcile to accumulated, rounded component deductions, including leave-only cycles. |
| `src/lib/attendance/leave-policy.ts` | Shared working-date guard rejects rest-day and recorded-holiday leave charges. Annual entitlement calculations exclude historical rest-day leave. |
| `src/lib/attendance/compensatory-reservation.server.ts` | Shared reservation adjustment applies only the difference between previous and next hours and refuses a negative bank. Callers hold existing payroll/employee locks. |
| `src/lib/validators/hr-validators.ts` | Comp-hour input refuses negative or nonfinite values before mutation. |
| `src/server-functions/hr/attendance/upsert-attendance-fn.ts` | Reservation adjustment covers standard and order-booker saves, revisions, rejected requests and cancellation. Punch-based restoration continues using the existing recomputation refund. Leave saves reject nonworking dates and recorded holidays. Existing dirty changes were retained. |
| `src/server-functions/hr/attendance/leave-approvals-fn.ts` | Decisions use shared payroll/employee locks and invalidation/finalized guards. Rejection refunds comp hours and clears applied hours exactly once while retaining the leave status. Annual entitlement remains serialized and paid eligibility remains distinct from approval. |
| `src/server-functions/hr/attendance/bulk-mark-attendance-fn.ts`, `bulk-mark-attendance-range-fn.ts` | Bulk overwrites clear and refund previous comp reservations; leave charges reject nonworking dates. Single-date bulk now uses the same locks and invalidation guard. Existing range import/punch safeguards were retained. |
| `src/server-functions/hr/attendance/convert-overtime-fn.ts`, `process-overtime-fn.ts` | Conversion and decisions share locks and finalized/draft invalidation guards. Conversion refuses invalid or stale worked hours. Repeated conversion cannot issue another credit. An overtime decision cannot revoke already converted hours without a bank reversal workflow. |
| `src/lib/attendance/overtime-request.ts` | Shared mutation eligibility uses zero standard hours on configured rest days, the actual configured shift duration on working dates, and the existing standard-hours fallback. Conversion, approval and punch-based attendance saving all use it. Existing correct recomputation and display calculations retain their rest-day semantics. |
| `src/hooks/hr/use-upsert-attendance.ts`, `use-process-leave-approval.ts`, `use-process-overtime.ts`, `use-convert-overtime.ts`, `use-bulk-mark-attendance.ts` | Refresh actual attendance, employee, approval and payroll query keys after relevant mutations. Conversion previously used unmatched `hr` key prefixes. Leave approval toast now states the decision without promising a deduction outcome that contradicts configured policy. |

The parent task extends generic draft invalidation/finalized protection in `device-import/payroll.server.ts` and `offline/payroll-invalidation.server.ts`; those files were not edited by this task.

## Demonstrated regressions

`src/lib/payroll-approved-policies.test.ts` has eleven passing checks. The first run failed paid annual basic (1,000 instead of 0), partial comp shortfall (0 instead of 4 hours), 7.98-hour deduction (2 instead of 3), and accumulated short deductions (7 instead of 8). Later failing checks demonstrated overtime rounding (4.02 hours at PKR 125 gave 502 instead of 503; 1.16 hours at 1.5 multiplier gave 217 instead of 218) and leave-only rounding (component sum 6 versus occasion/total 5). Independent review then demonstrated that the initial epsilon fix still returned 13,312 for thirteen absences at basic 26,625 and divisor 26, whose exact result is 13,312.50 and must round to 13,313. Exact numerator accumulation replaced that epsilon fix. A 120-case independent integer-rational oracle also verifies fractional daily rates. All checks now pass with exact expected amounts.

`src/server-functions/hr/attendance/leave-policies.behavior.test.ts` has twenty passing checks. It exercises production handlers with captured transport, input validators, the production reservation helper and a small in-memory query adapter. Checks cover repeated rejection/cancellation, revision deltas, order-booker cancellation, both bulk cancellation paths, invalid hours/overdraw, rest-day/holiday refusal, repeated conversion, converted approval restrictions and finalized decisions. Follow-up checks reproduced and fixed a rest-day regression: an eight-hour rest-day shift with eight stored overtime hours must bank eight once, while an ordinary eight-hour shift cannot bank another eight. Approval and punch-based saving also retain rest-day overtime. These checks do not establish PostgreSQL concurrency, HTTP authentication, wallet behavior or browser UI completion.

## Verification

Focused command (31 checks pass after review corrections):

```bash
bun run test src/server-functions/hr/attendance/leave-policies.behavior.test.ts src/lib/payroll-approved-policies.test.ts
```

Broader affected sweep:

```bash
bun run test src/server-functions/hr/attendance src/lib/hr-payroll-calculator.test.ts src/lib/hr-attendance-overtime-regressions.test.ts src/lib/hr-overtime-approvals.test.ts src/lib/hr-overtime-ui-consistency.test.ts src/lib/payroll-approved-policies.test.ts src/lib/payroll-allowance-deductions.test.ts src/lib/payroll-attendance-waivers.test.ts src/lib/payroll-explanation-log.test.ts src/lib/attendance/device-import/payroll.test.ts
```

Result at this task's handoff: 24 files passed, one file failed; 118 checks passed, one failed. The failure is the older `manual-punches-fn.behavior.test.ts` expectation that a legacy manual punch without device provenance remains editable inside an approved payroll. The parent's generic finalized guard now correctly refuses it. The parent was notified to update that obsolete expectation. Log: `/tmp/titan-payroll-policies-tests.log`.

After independent review corrections, the following eleven-file sweep passed all 67 checks. It includes the focused suites above, overtime helper and source guards, calculator allowance/waiver/explanation tests, and attendance/overtime regressions. Log: `/tmp/titan-payroll-review-followup-tests.log`.

```bash
bun run test src/server-functions/hr/attendance/leave-policies.behavior.test.ts src/server-functions/hr/attendance/upsert-attendance-fn.test.ts src/server-functions/hr/attendance/process-overtime-fn.test.ts src/lib/attendance/overtime-request.test.ts src/lib/payroll-approved-policies.test.ts src/lib/payroll-allowance-deductions.test.ts src/lib/payroll-attendance-waivers.test.ts src/lib/payroll-explanation-log.test.ts src/lib/hr-payroll-calculator.test.ts src/lib/hr-attendance-overtime-regressions.test.ts src/lib/hr-overtime-ui-consistency.test.ts
```

A separate run of `hr-payroll-regressions.test.ts` retained two unrelated failures: exact source-text wrapping of `approved-generate`, and historical migration filenames absent from the current chain. This task did not alter those tests or generated migrations.

`git diff --check` passed. The initial `bun run typecheck` recorded the known 47 report/P&L diagnostics plus a temporary type error in the parent's concurrently edited generic invalidation input; the parent was notified. The final typecheck result is recorded below when available. Production build and final Graphify refresh belong to the parent orchestration; an already started Graphify run was stopped on the parent's request to avoid overlapping refreshes.

## Follow-up boundaries

- Browser and actual PostgreSQL race/lifecycle checks remain mandatory; focused handler tests cannot replace them.
- Payroll leave-balance recalculation in `payroll-fn.ts` must also exclude historical rest-day leave. That file is owned by the parent/lifecycle task and was flagged for follow-up.
- Generated migrations, the retained `main` database, commits, deployment and external payment systems were untouched by this task.
