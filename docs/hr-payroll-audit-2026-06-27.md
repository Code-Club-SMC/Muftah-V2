# HR & Payroll Audit

Date: 2026-06-27

Scope:
- `src/server-functions/hr/**`
- `src/db/schemas/hr-schema.ts`
- `src/lib/payroll-calculator.ts`
- Selected HR/payroll hooks and components where they materially affect server-side behavior

Method:
- Read `graphify-out/GRAPH_REPORT.md` and verified the graph was fresh against `HEAD`
- Traced payroll generation, approval, payment, leave, attendance, TA/DA, advances, Bradford, and employee-deletion flows end to end
- Ran `bun run test` and `bun run typecheck`

Verification:
- `bun run test`: passed (`8` files, `118` tests)
- `bun run typecheck`: failed due existing repo-wide errors, including some HR files; findings below are based on source-level control-flow and data-integrity analysis, not on type errors alone

Executive summary:
- I found `11` material issues
- `2` are `Critical`
- `6` are `High`
- `3` are `Medium`
- The main risks are broken payroll workflow invariants, ledger/payslip settlement drift, non-idempotent balance mutations, and audit data that can no longer be trusted after regeneration or approval-first flows

## Findings

### 1. Critical: Payroll status enforcement is broken and the documented workflow is not actually enforced

Impact:
- Draft payrolls can be generated and paid
- Already-approved or already-paid payrolls can pass validation again
- The intended `draft -> approved -> paid` state model is not reliable
- Bradford snapshots are attempted at the wrong point in the workflow and can silently never be captured

Evidence:
- `src/server-functions/hr/payroll/payroll-fn.ts:20-50`
  - `validateStatusTransition()` decides allow/deny by checking whether a human-readable message contains lowercase `"cannot"`, `"immutable"`, or `"locked"`
  - This incorrectly allows:
    - `draft-generate` because the message starts with capitalized `"Cannot"`
    - `draft-pay` because the message contains none of those substrings
    - `approved-approve` because `"already approved"` is not blocked by the substring test
    - `paid-pay` because `"already marked as paid"` is not blocked either
- `src/server-functions/hr/payroll/payroll-fn.ts:108-118`
  - `generatePayslipsFn` trusts this broken validator
- `src/server-functions/hr/payroll/payroll-fn.ts:301-319`
  - `markPayrollAsPaidFn` also trusts the same broken validator
- `src/server-functions/hr/payroll/dashboard-fn.ts:448-510`
  - `saveEmployeePayslipFn` bypasses the documented workflow entirely by creating a `draft` payroll if none exists and generating a payslip immediately
- `src/server-functions/hr/payroll/payroll-fn.ts:248-275`
  - `approvePayrollFn` triggers `snapshotBradfordForPayroll()` immediately after setting status to `approved`
- `src/server-functions/hr/payroll/bradford-snapshot-fn.ts:25-32`
  - `snapshotBradfordForPayroll()` hard-fails when no payslips exist, and approval swallows that failure

Why this matters:
- The module currently supports mutually contradictory flows:
  - approval before generation
  - generation on draft
  - payment on draft
- That makes status, audit logs, and operator expectations diverge quickly

Recommended fix:
- Replace message-substring logic with an explicit boolean transition matrix
- Pick one workflow and enforce it everywhere
- Only snapshot Bradford after the final set of payslips exists and is frozen

### 2. Critical: Payment settlement can drift or double-debit because per-payslip and per-payroll payment flows coexist

Impact:
- Wallets can be debited twice for the same payroll obligation
- Payrolls can be marked paid while their aggregate totals are stale or zero
- Ledger state can diverge from payslip state

Evidence:
- `src/server-functions/hr/payroll/core.ts:399-429`
  - `generateEmployeePayslipCore()` validates a wallet and treats per-payslip debit as a first-class path
- `src/server-functions/hr/payroll/core.ts:520-536`
  - The same function debits the wallet and creates a finance transaction during payslip generation when `walletId` is supplied
- `src/hooks/hr/use-save-payslip.ts:5-26`
  - The UI save path requires a `walletId`
- `src/components/hr/payroll/salary-calculator-form.tsx:135-179`
  - The salary calculator UI requires a selected wallet before finalizing a single payslip
- `src/server-functions/hr/payroll/payroll-fn.ts:301-368`
  - `markPayrollAsPaidFn()` separately debits the payroll wallet again based on `payroll.totalAmount`
- `src/server-functions/hr/payroll/dashboard-fn.ts:478-510`
  - `saveEmployeePayslipFn()` does not recompute or update `payrolls.totalAmount` after generating individual payslips

Why this matters:
- If single-payslip saves are used with wallet debits, then payroll-level settlement is no longer a pure bookkeeping step
- If payroll-level settlement is later used anyway, it can debit again or mark a payroll paid against a stale total

Recommended fix:
- Choose one settlement model:
  - either debit at payslip time
  - or debit only at payroll-close time
- If per-payslip debits are kept, aggregate payroll totals and payment state must be derived transactionally from the payslips

### 3. High: Payslip regeneration, payroll deletion, and employee deletion are not safe once downstream side effects exist

Impact:
- Regenerating a payslip can fail once it has travel reimbursements, advance installments, or Bradford audit entries
- Deleting a payroll can fail or leave side effects partially reversed
- Employee deletion has the same structural problem

Evidence:
- `src/server-functions/hr/payroll/core.ts:431-442`
  - Regeneration starts by deleting the existing payslip row
- `src/db/schemas/hr-schema.ts:447`
  - `travel_logs.paid_in_payslip_id` references `payslips.id`
- `src/db/schemas/hr-schema.ts:462-464`
  - `advance_installments.payslip_id` references `payslips.id`
- `src/db/schemas/hr-schema.ts:478-480`
  - `bradford_audit_log.payslip_id` references `payslips.id`
- None of those references define an `onDelete` action
- `src/server-functions/hr/payroll/payroll-fn.ts:388-406`
  - `deletePayrollFn()` deletes payslips directly
- `src/server-functions/hr/payroll/payroll-fn.ts:396-403`
  - The delete path only resets the legacy `salary_advances.deducted_in_payslip_id`
- `src/server-functions/hr/payroll/core.ts:538-589`
  - Current payroll generation now uses:
    - `advance_installments`
    - `commission_records.status = paid`
    - `travel_logs.status = reimbursed`
- `src/server-functions/hr/employees/delete-employee-fn.ts:33-48`
  - Employee deletion also deletes payslips directly but never clears `advance_installments`

Why this matters:
- The module treats payslip regeneration as idempotent, but the schema and side-effect model do not support that claim
- Even where foreign keys do not block deletion, business side effects still need reversal

Recommended fix:
- Add an explicit reversal routine that clears or reverts all dependent state before deleting/replacing a payslip
- Alternatively, forbid regeneration/deletion after settlement, travel reimbursement, or Bradford overrides

### 4. High: Leave balances are mutated outside the payroll transaction, are not idempotent, and use the current year instead of the payroll year

Impact:
- Re-generating the same payslip deducts leave a second time
- Historical payroll reruns mutate the wrong leave year
- A failed post-transaction leave update can leave payslip and leave state out of sync

Evidence:
- `src/server-functions/hr/payroll/core.ts:594-629`
  - Leave balances are updated after the payroll transaction has committed
  - `currentYear` is taken from `new Date().getFullYear()`, not from `payrollPeriod`
  - The update subtracts leave based on raw attendance for the cycle every time the function runs

Why this matters:
- This is the opposite of idempotent payroll behavior
- Historical backfills and reruns become destructive

Recommended fix:
- Move leave consumption into the main payroll transaction
- Anchor leave-year logic to the payroll period, not wall-clock now
- Persist per-payslip leave consumption so reruns can reverse/reapply safely

### 5. High: Carried-forward deficit lookup is period-unsafe and can import the wrong deficit

Impact:
- Re-generating a payslip can carry forward its own existing deficit into itself
- Backfilling an older payroll can incorrectly apply a deficit from a later payroll

Evidence:
- `src/server-functions/hr/payroll/core.ts:384-397`
  - Deficit lookup uses the most recently created payslip for the employee, with no payroll-period guard
- `src/server-functions/hr/payroll/core.ts:887-899`
  - The same logic is duplicated in simulation

Why this matters:
- Carry-forward logic must be tied to the immediately preceding payroll period, not to insertion time

Recommended fix:
- Resolve predecessor by payroll period end/month
- Exclude the current payroll and current payslip from predecessor lookup

### 6. High: Preview payslips are not faithful simulations of actual payroll generation

Impact:
- HR can approve or communicate the wrong net pay before saving
- The UI preview is not a reliable audit artifact

Evidence:
- `src/server-functions/hr/payroll/dashboard-fn.ts:278-445`
  - `previewEmployeePayslipFn()` reimplements payroll logic directly instead of calling `simulateEmployeePayslipCore()`
- `src/server-functions/hr/payroll/dashboard-fn.ts:319-385`
  - Preview uses the current employee record, not `getSalaryAtDate()`
  - Preview omits:
    - historical salary revisions
    - auto TA/DA reimbursement from travel logs
    - order-booker trip/fuel incentive
    - night-shift rate lookup from `night_shift_rates`
    - carried-forward deficit from the previous payslip
- `src/server-functions/hr/payroll/core.ts:175-192`
  - Actual generation merges the salary revision active at the payroll start date
- `src/server-functions/hr/payroll/core.ts:244-338`
  - Actual generation also enriches with TA/DA, order-booker trips, commission, and night-shift rate

Why this matters:
- Preview is the operator-facing approval surface
- If preview and saved output differ, operational control is effectively broken

Recommended fix:
- Replace preview implementation with `simulateEmployeePayslipCore()`
- Keep one calculation path only

### 7. High: Bradford snapshots and yearly Bradford data are materially inaccurate

Impact:
- Bradford history cannot be trusted for audit, escalation, or disciplinary use
- Approval-first flows can end up with no snapshot at all

Evidence:
- `src/server-functions/hr/payroll/payroll-fn.ts:266-272`
  - Approval suppresses snapshot failure
- `src/server-functions/hr/payroll/bradford-snapshot-fn.ts:30-32`
  - Snapshot requires payslips to exist
- `src/server-functions/hr/payroll/bradford-snapshot-fn.ts:57-59`
  - Early departures are counted only when `earlyDepartureStatus === "early"`
  - The rest of the module uses values like `none`, `pending`, `approved`, `rejected`, so this counter stays at zero
- `src/server-functions/hr/payroll/bradford-snapshot-fn.ts:110`
  - `unmarkedDaysAtClose` is populated from `payslip.daysAbsent`, not from unmarked days
- `src/server-functions/hr/payroll/bradford-snapshot-fn.ts:66-87`
  - Yearly Bradford is computed from raw attendance records without rest-day filtering
- `src/server-functions/hr/payroll/core.ts:358-382`
  - The same yearly Bradford approach is used during payslip generation

Why this matters:
- This is audit data, not a cosmetic metric
- Misclassified unmarked days or early departures can distort people decisions

Recommended fix:
- Snapshot after payslips are finalized
- Persist true `unmarkedDays` on the payslip or compute it directly at snapshot time
- Reuse the calculator's filtered working-day logic for yearly Bradford
- Align `earlyDepartureStatus` values across the module

### 8. High: End-of-period timestamp filtering excludes valid compensation events and monthly performance windows can spill into the next month

Impact:
- Same-day order-booker trips and commission events on the payroll end date can be dropped
- Monthly performance logs can include data from the next month

Evidence:
- `src/server-functions/hr/payroll/core.ts:286-306`
  - `orderBookerTrips.tripDate` and `commissionRecords.calculatedAt` are bounded with `lte(new Date(payrollPeriod.endDate))`
  - In JavaScript, `new Date("YYYY-MM-DD")` is midnight at the start of that day
- `src/server-functions/hr/payroll/sales-performance-fn.ts:42-44`
  - `monthEndDate` is built as `new Date(\`${yearMonth}-31T23:59:59\`)`
  - For shorter months this rolls into the next month instead of creating the last valid instant of the target month

Why this matters:
- Variable compensation is exactly where date-boundary errors become expensive

Recommended fix:
- Use half-open ranges `[start, nextDay)` for timestamp filters
- Or use `startOfDay` / `endOfDay` helpers on properly parsed dates
- For monthly performance, compute the real last day of month

### 9. Medium: Backdated TA/DA logs use the wrong rate when rates change

Impact:
- Historical travel reimbursements can be overstated or understated after a rate change

Evidence:
- `src/db/schemas/hr-schema.ts:404-416`
  - TA/DA rates are explicitly modeled with `effectiveFrom`
- `src/server-functions/hr/rates/tada-rates-fn.ts:131-155`
  - `createTravelLogFn()` always snapshots the current active rate, not the rate effective on `data.date`

Why this matters:
- The schema supports historical rates, but the write path discards that capability

Recommended fix:
- When creating a travel log, select the latest rate where `effectiveFrom <= trip date`

### 10. Medium: Salary advance approval audit fields trust a client-supplied approver id

Impact:
- A caller with HR manage access can make the advance row say it was approved by someone else
- The salary advance row and finance ledger can disagree about the approver

Evidence:
- `src/server-functions/hr/advances/advances-fn.ts:82-86`
  - `approveSalaryAdvanceFn()` accepts `performedById` from request input
- `src/server-functions/hr/advances/advances-fn.ts:127-137`
  - The finance transaction records `context.session.user.id`
- `src/server-functions/hr/advances/advances-fn.ts:139-145`
  - The salary advance row writes `approvedBy: data.performedById`

Why this matters:
- Audit identity must come from the server session, not the client payload

Recommended fix:
- Remove `performedById` from the input schema and always derive approver identity from `context.session.user.id`

### 11. Medium: Bulk single-day attendance updates leave stale fields behind

Impact:
- Records can retain stale overtime hours, leave approvals, notes, or check-in metadata after a bulk status change
- Phantom overtime approvals and inconsistent payroll inputs become possible

Evidence:
- `src/server-functions/hr/attendance/bulk-mark-attendance-fn.ts:45-59`
  - Existing records are updated only with `status`, `dutyHours`, and `updatedAt`
- By contrast, `src/server-functions/hr/attendance/upsert-attendance-fn.ts:68-95`
  - The normal attendance upsert path fully normalizes leave, overtime, check-in/out, approval flags, and notes

Why this matters:
- Two write paths are maintaining the same entity with different normalization rules

Recommended fix:
- Route bulk updates through the same normalization logic as single-record upserts
- Or fully overwrite dependent fields when bulk-changing status

## Additional observations

- `src/server-functions/hr/payroll/sales-performance-fn.ts:100-113`
  - `totalCartonsSold`, `targetValue`, and `monthlyRank` are still placeholder logic
  - If any downstream pay or HR evaluation depends on those values, they are not production-grade yet

- `src/server-functions/hr/payroll/dashboard-fn.ts:193-220`
  - Dashboard salary budget and pending gross figures are based on current employee basic salary, not salary revisions
  - This affects management reporting more than payroll posting, but it is worth aligning with the historical pay model

## Recommended remediation order

1. Fix the payroll state machine and choose one settlement model
2. Remove per-payslip/per-payroll payment ambiguity
3. Make payslip regeneration and deletion reversible or explicitly forbidden after side effects
4. Move leave-balance mutation into an idempotent, period-aware transaction
5. Replace preview logic with `simulateEmployeePayslipCore()`
6. Repair Bradford snapshot timing and field mapping
7. Fix timestamp window boundaries for variable compensation
8. Clean up TA/DA rate selection and advance approver audit fields

