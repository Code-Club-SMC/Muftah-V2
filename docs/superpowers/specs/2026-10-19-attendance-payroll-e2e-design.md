# Attendance-to-payroll acceptance specification

Date: 19 October 2026

Status: approved for implementation on 19 October 2026. The user approved the specification and all four policy resolutions in section 11 after reviewing the status and outstanding decisions. Implementation and local acceptance completed on 20 October 2026 in run `b14d5a9a941cc2d7`. See the [verification report](../reviews/2026-10-19-attendance-payroll-e2e-verification.md) for both browser scenarios, 62 PostgreSQL lifecycle tests, all 40 mandatory case IDs and documented limitations.

## 1. Objective

Prove that device-file attendance produces the correct employee salary through the existing HR workflow, using nonzero salaries, all four supported leave types, actual authentication, actual application mutations, and PostgreSQL.

The acceptance boundary includes imported punches, completed working intervals, overnight attribution, HR resolution, leave and overtime decisions, salary preview, saved draft payslips, payslip display, payroll approval, and isolated test-wallet settlement. A successful upload or a correct attendance-hour total alone does not satisfy this specification.

The feature remains a replacement of barcode capture with file upload. This work does not introduce new leave types, a new payroll formula, a new approval UI, an external payment integration, or automatic absence marking. A discovered salary defect must be recorded against a requirement below; expected values must not be changed merely to match the implementation.

## 2. Existing contracts and sources

| Contract | Repository source |
| --- | --- |
| Current leave types: `sick`, `annual`, `special`, `compensatory` | `src/db/schemas/hr-schema.ts`, `leaveTypeEnum`; `src/lib/validators/hr-validators.ts` |
| Four attendance states: present, absent, leave, holiday | `src/db/schemas/hr-schema.ts`, `attendanceStatusEnum` |
| Company basic-salary policy, employee override, per-component allowance flags | `src/lib/types/hr-types.ts`; `src/server-functions/hr/payroll/core.ts` |
| Payroll cycle runs from the previous month's 16th through the payout month's 15th | `src/lib/payroll-cycle.ts` |
| Payroll divisor is the number of working dates in the complete cycle, excluding configured rest days and recorded holidays | `src/lib/payroll-calculator.ts`, `calculateWorkingDays` and `getCalendarDaysInPayPeriodMonth` |
| Duty time is the sum of completed IN/OUT intervals, excluding breaks, with the existing two-decimal hour representation | `src/lib/attendance/recompute.ts`; `src/lib/attendance/recompute-server.ts` |
| Annual allowance defaults to 14; sick balance defaults to 10; comp-off is an hours balance | `src/db/schemas/hr-schema.ts` |
| Approval decision and paid eligibility are separate: `leaveApprovalStatus` and `isApprovedLeave` | `src/server-functions/hr/attendance/leave-approvals-fn.ts` |
| Annual leave exceeding entitlement can be approved with `isApprovedLeave=false` | `processLeaveApprovalFn` in the same file |
| Comp-off usage adjusts the hours balance when attendance is saved; payroll excludes overtime converted to comp-off from cash overtime | `upsert-attendance-fn.ts`; `convert-overtime-fn.ts`; `sumApprovedOvertimeHours` |
| Historical incomplete imported days block generation and approval; imports preserve HR corrections and finalized payroll | `src/lib/attendance/device-import/payroll.server.ts`; `core.ts`; `payroll-fn.ts` |
| Existing basic-policy design says the annual basic-deduction switch applies only to unpaid/excess annual leave | `docs/superpowers/specs/2026-06-30-hr-payroll-policy-fixes-design.md` |
| Device import must preserve attendance/payroll behavior and leave missing source dates for HR | `docs/superpowers/specs/2026-10-14-device-attendance-import-design.md` |

Comments that describe a different rule from executable code are evidence of a discrepancy, not an independent expected-result oracle. Older references to `casual` or `unpaid` are compatibility paths in the calculator, not additional current leave types. New attendance inputs using those values must be rejected by the current validators.

## 3. Test approach and isolation

Use one compiled application and two separately seeded, disposable PostgreSQL databases, run sequentially. One database verifies the unchanged real source file; the other verifies controlled salary and leave scenarios. This avoids comparing a real-file scenario against data mutated by the controlled cases.

The alternatives are insufficient on their own: calculator-only tests omit authentication, persistence and UI behavior; reusing the already populated local `main` database risks changing its employee salaries, leave balances and payroll locks.

### Browser coverage

Use real headless Chrome/Playwright against the compiled production application. Use real Better Auth sign-in, DB RBAC permissions, file inputs, attendance editor, leave/overtime approval screens, salary calculator, Save Draft Slip action, and existing payslip display/print output. Do not intercept network responses, replace server functions, inject payroll results, or write action results directly into tables.

Seed setup may insert identity, salary revisions, company settings, test wallet, historical entitlement fixtures and prerequisite records explicitly identified by a case. Browser-stage attendance imports, tested HR decisions, and draft payslips must be produced by the application itself. Query PostgreSQL independently after actions.

### Payroll lifecycle integration coverage

The active UI currently exposes salary preview/draft saving. Repository-wide caller inspection found no active UI callers for `useApprovePayroll`, `useMarkPayrollPaid`, `useCreatePayroll`, or `generatePayslipsFn`. Do not invent buttons or describe direct handler calls as browser clicks.

Exercise `createPayrollFn`, `generatePayslipsFn`, `approvePayrollFn`, and `markPayrollAsPaidFn` in a separate real-PostgreSQL integration suite using the repository's handler-capture convention. Keep their validators, production handlers, core calculations, transactions, locks and database operations. Only the transport/middleware wrapper may be replaced for these integration calls. Supply the required authenticated HR context explicitly. This tier does not establish real HTTP authentication for those unexposed actions; existing boundary checks and the genuine browser-authenticated salary workflow provide separate coverage.

Browser and integration results must be reported separately. Together they cover the actual UI journey and downstream salary lifecycle without adding a test-only application endpoint.

### Runtime constraints

- Create random run-owned databases named `titan_payroll_e2e_<run>_test` and `titan_payroll_real_<run>_test` on local PostgreSQL port 5433. Refuse nonlocal hosts, database names not ending `_test`, and any target named `main`.
- Apply the complete generated migration chain with the normal migrator. Never edit generated migrations or migration-history records.
- Do not alter the six employees, 138 imported punches or 52 attendance records already retained in `main`.
- Use `TZ=Asia/Karachi` for the application process and the same timezone in Chrome. Assert runtime time is after 15 October 2026 before full-cycle generation; fail preparation clearly if it is not.
- Use the October 2026 payout key explicitly. Do not depend on whichever month the UI selects by default.
- Build through the final `bun run build` script with its explicit production environment. Any TLS override is limited to the guarded local test database connection.
- Use a dedicated test identity with HR view/manage permissions and only additional permissions proven necessary by existing routes. Do not reuse a real administrator session.
- Use a dedicated synthetic wallet for lifecycle checks. No external transfer or production wallet is permitted.
- Preserve traces and assertions before stopping the run's app process, revoking its test sessions, closing pools and removing only the databases created by that run. Offer an explicit debug retention flag that leaves the failed database identified in the report.
- A setup failure, skipped mandatory case, missing fixture, unsupported UI action, or failed cleanup must be reported. None is a passing test.

## 4. Deterministic monetary fixture

The controlled fixture uses standard staff, not trip-derived order booker/salesman/driver attendance. Everyone is active and joined on or before 16 September 2026. Seed one salary revision effective on 16 September 2026; no later revision can affect the calculation. Trip-based role payroll is unchanged by this test task and must not be claimed as covered.

The payout month is `2026-10`, stored month `2026-10-01`, cycle `2026-09-16` through `2026-10-15`, and payout date `2026-10-25`. Sundays are rest days: 20 and 27 September, 4 and 11 October. With no holidays, the divisor is exactly **26 working days**. The standard duty is **8 hours**. Standard daily shifts are 09:00–17:00; the overnight fixture uses an explicitly configured 20:00–04:00 shift with the same eight-hour standard. The configured grace threshold is 15 minutes.

Every baseline working date must have an accounted record created through the specified fixture upload or HR workflow. Leave replaces an explicitly identified eight-hour baseline date. Unmarked-day overrides, attendance waivers, custom deduction overrides, arrears, previous deficits, advances, tax, commissions, bonuses and incentives are all off/zero unless a case expressly enables one. A waiver must never hide a missing-punch or pending-approval error.

The baseline has these monthly amounts and flags. Allowance early/late flags are false. Basic absent/late/early/not-employed policy flags are true; basic annual/sick/special flags are false.

| Component | PKR | Per working day | Deduct on absence | Annual | Sick | Special |
| --- | ---: | ---: | --- | --- | --- | --- |
| Basic salary | 26,000 | 1,000 | Yes | No | No | No |
| House rent | 5,200 | 200 | Yes | No | No | Yes |
| Utilities | 2,600 | 100 | Yes | No | No | Yes |
| Conveyance | 2,600 | 100 | Yes | Yes | No | Yes |
| Mobile | 1,300 | 50 | Yes | No | No | Yes |
| Bike maintenance | 1,300 | 50 | Yes | No | No | Yes |
| Technical | 2,600 | 100 | Yes | No | No | No |
| Special allowance | 1,300 | 50 | No | No | No | No |

Baseline gross and net are **PKR 42,900**. Basic hourly rate is `26,000 / (26 × 8) = 125`. A separate sales-style allowance variant replaces conveyance with the same PKR 2,600 fuel allowance and the same annual-leave flag. It does not turn on a trip-derived employee role.

Night shift allowance is zero in the baseline. The dedicated night case seeds the applicable 2026 night rate as PKR 500 per qualifying night and verifies exactly one PKR 500 addition. Do not also count it as a flat monthly allowance.

### Independent expected-result rules

Let `D` be the independently enumerated complete-cycle working-date count, `B` the configured basic salary, `H=8`, and `A_i` a configured allowance.

- Full-day basic deduction, when its policy enables it: `B / D`.
- Full-day allowance deduction, when its occasion flag enables it: `A_i / D`.
- Basic undertime for `u` hours: `(B / (D × H)) × u`.
- Approved cash overtime for `o` hours at multiplier `m`: `round((B / (D × H)) × o × m)`.
- Standard gross: basic plus ordinary monthly allowances. Add approved cash overtime and applicable night allowance once.
- Total deductions: attendance plus proration plus explicit flat deductions. The fixture has no arrears or previous deficit unless declared.
- Net: original gross plus additions minus total deductions. Adjusted component values must not be used to subtract attendance deductions a second time.

Expected results must use checked-in literal values and independent decimal/rational arithmetic. The expected-value path must not import `calculatePayslip`, `calculateAbsentDeductions`, production rest-day helpers or the production recomputation/planner. Assertions must compare components, occasion totals and net, not only a final total that could conceal offsetting mistakes.

Accumulate exact decimal amounts before the documented rounding stage. For nonnegative monetary amounts, positive halves round upward to whole rupees. Do not accept a one-rupee tolerance. Persisted decimal strings must normalize exactly to the expected monetary value.

Keep the existing two-decimal duty-hour boundary explicit. For example, 09:00–16:59 yields stored duty `7.98`, shortfall `0.02`, and exact basic deduction `125 × 0.02 = 2.50`, rounded to **PKR 3**. A binary floating-point result just below 2.50 must not silently make that PKR 2. If current code fails this assertion, report/fix the monetary rounding defect; do not change the golden value.

## 5. Leave coverage and expected amounts

The mandatory supported-type coverage set must equal the schema's four enum values. A newly added leave type must fail the coverage check until its policy cases are specified.

For each supported type, create the request in the existing attendance editor, verify it in Leave Requests, exercise pending → approved, pending → rejected, and a repeated identical decision. Assert `status`, `leaveType`, `leaveApprovalStatus`, `isApprovedLeave`, stored hours, salary preview, summary counts and the relevant balance at each stage. Monetary changes are compared against an otherwise identical fully accounted cycle.

| ID | Case | Required monetary/balance result |
| --- | --- | --- |
| L01 | Approved annual leave within entitlement, baseline flags | Basic deduction 0; conveyance deduction 100; net **42,800**. Approved paid annual usage rises by one. Annual balance 14 → 13 after leave approval and remains 13 after payroll approval. |
| L02 | Approved sick leave, baseline flags | Basic/allowance deductions 0; net **42,900**. Annual/comp balances unchanged. Current sick balance is recalculated on payroll approval: 10 → 9, without a second deduction on repeated reads/regeneration. |
| L03 | Approved special leave, baseline flags | Deduct house rent 200 + utilities 100 + conveyance 100 + mobile 50 + bike 50 = **500**; net **42,400**. Basic, technical and special allowance remain intact. Annual, sick and comp balances unchanged. |
| L04 | Approved full-day compensatory leave | Reserve/use exactly 8 banked hours; initial bank 16 → 8. No basic/allowance deduction; net **42,900**. Approval/regeneration must not debit the bank again. Annual/sick balances unchanged. |
| L05 | Pending request, each of the four types | It remains visibly pending, not counted as approved paid leave. Preview may show a clearly provisional calculation, but payroll approval must fail with the pending item unresolved. Preview and failed approval change no wallet, payslip approval status or entitlement balance. Comp reservations follow L10. |
| L06 | Rejected request, each type, without changing daily status | Stored approval is rejected and paid flag false. Do not silently convert the daily status to absence. Baseline per-type deduction flags still determine monetary deductions: annual 100, sick 0, special 500. Rejected comp-off treatment and release of hours follow proposed resolution P2. Counts must show unpaid/unapproved leave rather than paid leave. |
| L07 | Annual entitlement boundary | Prepare 13 previously approved paid annual dates in the same leave year with matching prior approved-payroll coverage. Approve a 14th and 15th date. The 14th is paid; the 15th is approved but unpaid; balance stays at 0 and never negative. Notes expose exhaustion. Default basic annual policy false must not be misrepresented as a mandatory absence-sized deduction. |
| L08 | Annual basic-deduction policy enabled | With `annualLeave=true`, apply proposed P1: approved paid annual within entitlement keeps basic and deducts conveyance 100, net **42,800**; approved excess/unpaid annual deducts basic 1,000 plus conveyance 100, net **41,800**. These are separate single-current-cycle-date scenarios with explicit historical entitlement prerequisites. |
| L09 | Sick and special basic-policy toggles | With only `sickLeave=true`, one sick day deducts basic 1,000, net **41,900**. With only `specialLeave=true`, one special day deducts basic 1,000 + flagged allowances 500, net **41,400**. Do not infer either switch from the word “paid” in a label. |
| L10 | Comp-off reservation, correction and rejection | Save 8 hours from bank 16 → 8; save the same request again → 8; revise use 8 → 6 → bank 10; cancel/change the daily status → refund the remaining 6 → bank 16. Rejection must release the reservation once under proposed P2. Insufficient bank, negative/nonfinite hours and an overdraw attempt must fail atomically. |
| L11 | Partial compensatory leave | Proposed P3: a 4-hour approved comp-off request covers four hours of the 8-hour duty, consumes exactly four bank hours and leaves four hours of basic undertime, deduction **500**, net **42,400** with baseline allowance flags. Bank 16 → 12. Test alongside the full 8-hour case. |
| L12 | Comp bank earned from overtime | Create 8 actual eligible overtime hours through the attendance workflow; convert through the existing comp-off action. Bank rises by 8 once; cash overtime is zero for converted hours. Use those 8 hours for a full-day comp-off request; bank returns to its starting value, with no simultaneous overtime payout or full-day absence deduction. |
| L13 | Annual entitlement reset and sick limits | Exercise the December/January leave-year boundary in an isolated fixture. Paid annual entitlement is evaluated against the leave date's year. Sick balance must never become negative; its existing 10-day default is not permission to invent an automatic conversion policy for an eleventh approved sick day. Verify configured sick deduction flags and report approved sick usage separately from a clamped remaining balance. |
| L14 | Repeated and concurrent decisions | Annual paid entitlement is never overspent when two approvals compete for one remaining day: only one is paid, the other is approved unpaid. Repeated comp conversion/usage/rejection never grants or spends hours twice. Use actual concurrent PostgreSQL calls in lifecycle integration. |
| L15 | Leave on a rest day or marked holiday | It must not create salary deductions, missing-work alarms or double-counted job days. Under proposed P4, the workflow refuses a leave charge for a non-working date and consumes no annual/sick entitlement or comp hours. Retain a negative test if the current approval path counts it. |
| L16 | Leave validation and compatibility | Missing type and unsupported `casual`/`unpaid` values fail new attendance writes without partial side effects. The UI offers exactly the four current types. Any legacy calculator characterization is a separately labeled unit test, not evidence that the app supports an additional leave workflow. |

The allowance test variant must verify annual leave deducts fuel 100 in place of conveyance 100. A separate custom allowance with `sickLeave=true` must produce its configured daily deduction, so a default zero sick deduction cannot conceal an ignored flag.

Company policy inheritance and employee override each get an independent case: a disabled override is ignored; an enabled override wins; another employee retains the company rule. Policy changes in these cases affect only the isolated test database.

## 6. Attendance and payroll cases

| ID | Case | Required result |
| --- | --- | --- |
| A01 | All working dates contain a completed 8-hour day | 26 present dates, no unexplained gaps, no attendance deduction, gross/net **42,900**. |
| A02 | One HR-resolved absence | Basic + all absence-flagged components = **1,600**, net **41,300**. Special allowance is not deducted. No inferred absence is created solely because a CSV lacks a date. |
| A03 | One 6-hour day | Basic undertime **250**, net **42,650**. Exercise late-only, early-only and combined flags; combined flags do not charge the same shortfall twice. |
| A04 | Breaks | 09:00–12:00 and 13:00–17:00 = 7 hours, one hour short, deduction **125**, net **42,775**. First-to-last span must not count the break as work. |
| A05 | Cash overtime decisions | A 10-hour day suggests 2 extra hours. Pending/rejected overtime pays 0; exactly 2 approved payout hours add **250**, net **43,150** at multiplier 1.0. Multiplier 1.5 adds **375**, net **43,275**. Pending overtime blocks final payroll approval. Stale requests exceeding current duty-derived eligibility are rejected. |
| A06 | Overnight, same upload and separate uploads | 20:00–04:00 is 8 hours on the IN date, not two short days. Next-day normal duty remains on the next day. Exactly one configured night allowance adds **500**; net **43,400** in its single-case fixture. A next-calendar-month/cycle-boundary checkout must not move salary to the checkout period. |
| A07 | Historical missing checkout or invalid timeline | Import retains raw evidence and flags review. Generation/save and payroll approval reject unresolved imported historical days. An attendance waiver or “ignore unmarked days” cannot bypass this guard. No fabricated checkout or salary is saved. |
| A08 | Daytime missing checkout | An arrival the next day must not close the previous daytime IN. HR resolution is still required; no huge fabricated interval/overtime payment. |
| A09 | HR correction and reupload | Start with a valid 6-hour imported day, then correct it to 8 hours with a reason. Basic deduction changes **250 → 0**; net **42,650 → 42,900** after regeneration. Reupload of the original file restores neither the old timestamp nor the old salary. Assert raw claim lineage and audit reasons. |
| A10 | Delete and status resolution | Delete a claimed punch with a reason; reupload must not resurrect it. Resolve the day explicitly as absence or each leave type and follow the normal approval workflow. Payroll follows the resolved status, not the surviving raw source row. |
| A11 | Rest days, holidays and missing dates | Rest days never count as unmarked or reduce pay. Add one working-day holiday: divisor becomes 25, rather than changing to 30/31 calendar days. Annual conveyance daily deduction becomes **104**. Missing expected working dates remain visibly unmarked until HR decides their status. |
| A12 | Cutoff, joining date and salary revision | Early processing requires explicit cutoff. Post-cutoff/pre-joining dates use the existing distinct proration rules and do not become leave, misconduct or overtime. Verify the seeded revision ID and amounts are the ones saved. Characterize the existing effective-date rule separately: current date when between cycle start and 30 days after cycle end, otherwise cycle end. Do not assume cycle-start selection from older documentation or change salary-revision policy in this task. |
| A13 | Rounding | Cover the 7.98-hour / PKR 3 boundary in section 4, several small deductions accumulated within one component, and overtime half-rupee boundaries. Require exact reconciled component/occasion/total/net values with no one-rupee tolerance. |
| A14 | Explicit HR deduction waiver | One selected annual/sick/special/undertime waiver removes only that configured deduction, records the waived explanation and leaves raw attendance/leave balances unchanged. Full-salary waiver never resolves a pending leave or invalid punch timeline. |

### Composite salary example

Use a separate fully accounted employee cycle with these exceptions. All other working dates remain present for eight hours.

| Date | Exception |
| --- | --- |
| 17 September | Absence, deduction 1,600 |
| 21 September | Approved sick leave, deduction 0 |
| 23 September | Approved paid annual leave, deduction 100 |
| 25 September | Approved special leave, deduction 500 |
| 29 September | Approved 8-hour comp-off, deduction 0, bank 16 → 8 |
| 1 October | 6-hour day, deduction 250 |
| 2 October | The 7-hour split day from A04, deduction 125 |
| 5 October | Approved 2-hour cash overtime, addition 250 |
| 7 October | 20:00 IN, 8 October 04:00 OUT, night addition 500; 8 October still has its own normal day |

Expected counts: 21 present working dates, 1 absent date, 4 approved leave dates, 3 undertime hours, 2 cash overtime hours and 1 night shift. Expected gross **43,650**, attendance deductions **2,575**, net **41,075**. Annual balance becomes 13, sick becomes 9 on payroll approval, comp bank is 8. Isolated absence/sick/special dates give Bradford `3² × 3 = 27`; annual and approved comp-off do not add Bradford events. Check period/yearly values separately and do not apply Bradford as an undeclared monetary deduction.

## 7. The exact client file as a salary scenario

Use the original `docs/Total Punches(20261001-20261014).csv`, SHA-256 `5c96e6912b261a4def094be00b46de516930b6fe085c1cdb75b71684d8779591`. The bytes are XLSX. It contains 52 rows, six identities and 138 punches. Never rewrite it, rename a synthetic report to impersonate it, or use the copied unit-test fixture as a substitute for the browser upload.

In the real-file test database only, seed those six identities with the nonzero salary fixture and full-cycle employment eligibility. Seed no attendance from this file. Upload and confirm in Chrome; require 138 punches/claims and the actual 12 review rows before HR decisions. Independently verify all raw source timestamps and paired interval totals.

The report covers only 1–14 October. Inspect each expected working date from 16 September through 15 October. Dates outside the report, and missing dates inside it, receive explicit test HR actions, not inferred absences. In this synthetic scenario, HR marks each uncovered working date Present for exactly eight hours through the existing manual/bulk workflow, with reason `Synthetic payroll E2E baseline; not device evidence`. Do not add those hours to the original source file or raw source claims.

Keep the unresolved payroll block demonstrable before resolution. Use this exact test-only resolution manifest for the twelve review rows. These are synthetic HR decisions for an isolated salary test, not a claim about these employees' actual entitlement or absence. Every saved decision must include that qualification in its test reason. All leave rows go through the real approval screen and become approved/paid under the baseline settings. Seed Shahab Gul's comp bank at 16 hours and use 8; other employees start with zero comp hours.

| Source row | Person ID | Date | Explicit synthetic HR resolution |
| --- | --- | --- | --- |
| 9 | 112009 | 7 October | Approved annual leave |
| 10 | 112009 | 11 October | Absent on a rest day; no salary deduction |
| 13 | 112009 | 14 October | Absent |
| 21 | 113016 | 14 October | Approved sick leave |
| 31 | 111007 | 14 October | Approved special leave |
| 36 | 110001 | 7 October | Approved 8-hour compensatory leave |
| 38 | 110001 | 10 October | Absent |
| 39 | 110001 | 11 October | Absent on a rest day; no salary deduction |
| 42 | 110001 | 14 October | Absent |
| 46 | 111008 | 14 October | Absent |
| 51 | 111006 | 11 October | Absent on a rest day; no salary deduction |
| 54 | 111006 | 14 October | Absent |

Do not alter completed source intervals, invent checkouts, or request overtime in this real-file scenario. Hours above eight do not become cash overtime automatically. A resolved non-present day has zero payable duty even when its raw claim/punch evidence remains stored; the explicit HR status takes precedence in the salary oracle.

The following literal results were calculated independently from the original workbook XML using minute intervals and decimal arithmetic. Round each complete day's hours to two decimals, ignore rest days for salary, apply the explicit resolutions above, and accumulate basic undertime before whole-rupee rounding. All employees use the PKR 42,900 gross fixture; additions and unrelated deductions are zero.

| Employee / Person ID | Supplemental 8-hour working dates | Salary-counted absent days | Undertime hours | Absence deduction | Undertime deduction | Leave deduction | Total deductions | Net PKR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Himayat Ullah / 112009 | 17 | 1 | 0.00 | 1,600 | 0 | 100 | 1,700 | **41,200** |
| Rahmant Wali / 113016 | 20 | 0 | 16.32 | 0 | 2,040 | 0 | 2,040 | **40,860** |
| Sameen Ullah / 111007 | 18 | 0 | 3.59 | 0 | 449 | 500 | 949 | **41,951** |
| Shahab Gul / 110001 | 17 | 2 | 3.68 | 3,200 | 460 | 0 | 3,660 | **39,240** |
| Rafi Ullah / 111008 | 23 | 1 | 0.75 | 1,600 | 94 | 0 | 1,694 | **41,206** |
| Anees Ur Rahman / 111006 | 19 | 1 | 11.42 | 1,600 | 1,428 | 0 | 3,028 | **39,872** |

Expected aggregate: **PKR 257,400 gross − 13,071 deductions = 244,329 net**, with 147 present working dates, 5 absent working dates and 4 approved leave dates. The 114 supplemental attendance dates plus the source's 52 dates produce 166 stored attendance records, including 10 rest-day records. Raw punch and claim counts remain 138. The four leave types all occur in this genuine original-file browser scenario as well as the controlled matrix.

After payroll approval, Himayat's annual balance is 13, Rahmant's sick balance is 9 and Shahab's comp bank is 8. Other annual/sick balances remain 14/10. These salary totals must never be used as real payable amounts for the retained demonstration employees in `main`.

Reupload the same source before and after HR resolution, after saving a draft, and after approval/payment in the lifecycle tier. Claims, attendance decisions, balances and generated salary must not duplicate or revert. An already recorded source may be reported unchanged; a genuinely new attendance mutation in a finalized period must be rejected.

## 8. Drafts, approval, settlement and invariants

| ID | Transition/check | Required result |
| --- | --- | --- |
| P01 | Preview → Save Draft Slip → reload → payslip display/print | Preview, persisted scalar fields, reloaded net and printed net agree exactly. No wallet debit. Do not expect transient component/occasion breakdown objects to exist in `payslips`: verify those in the preview response and the persisted aggregate fields separately. |
| P02 | Attendance, leave state or overtime changes after draft generation | A salary-affecting change marks the affected draft stale or causes an equivalent server-enforced refusal of approval until regeneration. A stale payslip cannot be finalized merely because its pending approval was resolved. Recalculation must change the correct amount and clear only the captured invalidation revision. |
| P03 | Payroll approval | Refuse empty/incomplete/duplicate/ineligible payslip coverage, unresolved imported days, pending leave and positive pending overtime. A fully resolved payroll covers every eligible test employee and total equals the exact sum of its saved payslips. |
| P04 | Approval and balance repeatability | Approval recalculates annual/sick usage without discarding already accounted same-year prior usage or re-consuming comp hours. A second approval is refused without additional balance or financial changes. |
| P05 | Approved and paid payroll immutability | Import confirmation, punch edits/deletions, daily leave/status changes, leave/overtime decision changes and comp conversion cannot mutate finalized salary inputs. Failed actions leave attendance, balances, payslips, payroll and wallet unchanged. |
| P06 | Payment in isolated test wallet | Start wallet at 1,000,000. Approved amount `T` produces one debit `T`, balance `1,000,000 − T`, matching payroll total and paid state. Repeat or concurrent payment produces no second debit. Insufficient funds rolls back both state and wallet changes. |
| P07 | Payroll races | Actual PostgreSQL concurrency covers import/correction versus draft save/approval; leave approval versus regeneration; entitlement versus entitlement; comp usage/conversion versus another spend; payment versus payment. Require a valid serialized outcome, no entitlement overdraw, and no stale finalized salary. |
| P08 | Access control | A real viewer-only browser session cannot mutate device attendance, leave, overtime or draft payslips. The permitted HR session succeeds. Assertions cover actual rejected requests, not only hidden buttons. Lifecycle integration reports its separate transport/auth limitation from section 3. |

The main invariant at every saved stage is:

`net salary = original basic + original ordinary allowances + approved additions − attendance/proration deductions − declared flat deductions`.

No attendance event, leave reservation, overtime conversion or wallet transaction may be applied twice by a retry. No salary-affecting decision may be hidden by a green upload test.

## 9. Evidence and completion criteria

The implementation is accepted only when every mandatory case has a recorded result and all policy resolutions are confirmed. A failing documented rule is a defect, not an expected snapshot.

Produce machine-readable results with case IDs, fixture hashes, test-only database identity, application build identity, browser version, payout cycle, effective salary revision/policy, expected versus actual component/occasion/gross/deduction/net values, leave states/balances, and wallet deltas. Record browser cases and integration cases separately. Do not store passwords, session tokens or the database password.

Capture screenshots/trace after login for import preview, HR correction, all four leave types and approval outcomes, salary breakdown, saved/reloaded draft and payslip print output. Record console errors and uncaught exceptions independently. Wait for the specific completed mutation and its new/revised database row; a previous visible preview is never proof that a new mutation succeeded.

Required gates:

1. Independent fixture/oracle checks pass, including exact calendar count, salary totals, enum coverage and decimal rounding boundaries.
2. Genuine browser flow passes for the original source and controlled leave/salary scenarios.
3. PostgreSQL lifecycle and race cases pass, with no mandatory skips.
4. Existing affected attendance/payroll regressions pass. The known 47 unrelated report/P&L type errors remain separately identified; no new test or production diagnostic is permitted.
5. Production build and `git diff --check` pass. Refresh Graphify after code changes.
6. Reviewer can reproduce the run from documented commands and inspect both successful evidence and any unresolved finding.

## 10. Implementation boundaries after spec review

Keep the harness in the existing `src/__tests__/e2e/` area. Expected new artifacts are a typed isolated-database setup/orchestrator, a payroll browser runner following the existing `device-attendance.browser.cjs` pattern, checked-in salary/leave expected-result and real-file-resolution fixtures, and `src/__tests__/integration/attendance-payroll.test.ts` for lifecycle/concurrency cases. Reuse installed `pg`, Drizzle migrations, existing authentication utilities and the current Playwright provisioning mechanism. Add no application runtime dependency or test-only production route.

Production changes, if a case fails, must be the smallest fix at the shared source of the demonstrated defect. Likely review points are `payroll-calculator.ts`, `leave-approvals-fn.ts`, `upsert-attendance-fn.ts`, `convert-overtime-fn.ts`, `process-overtime-fn.ts`, payroll `core.ts`/`payroll-fn.ts`, and the relevant query invalidation hooks. These are investigation targets, not a preauthorization to refactor them all.

Generate only new forward migrations if a demonstrated fix requires schema support. Never rewrite migration 0017 or any earlier generated migration. Preserve all existing uncommitted work. Do not deploy, commit, push or change the retained local demonstration database as part of this suite.

## 11. Approved policy resolutions

The user approved P1–P4 on 19 October 2026. These are binding acceptance expectations, not claims about existing verified behavior.

| ID | Discrepancy | Proposed acceptance rule |
| --- | --- | --- |
| P1 | The earlier policy spec limits basic annual deduction to unpaid/excess annual leave; the current calculator selects the annual branch by type and does not test paid eligibility first. | Follow the documented rule: enabling basic `annualLeave` deducts basic only for unpaid/excess/rejected annual leave. Paid annual within entitlement keeps basic. Per-allowance annual flags still apply. L08 supplies exact amounts. |
| P2 | Comp hours are reserved on attendance save, but `processLeaveApprovalFn` has no refund logic when that request is rejected. | Pending requests may reserve their selected hours. Rejecting/cancelling releases the reservation exactly once, resets applied comp hours to zero, and does not auto-convert the day to absence. Until HR changes its status, a rejected leave row uses the existing unapproved-leave deduction flags, not an invented absence policy. |
| P3 | The UI permits partial comp hours on a whole-day leave row; the calculator currently skips paid comp leave without evaluating the uncovered duty. | Approved comp hours cover only those hours. For a leave day with 4 of 8 hours banked and no work, apply 4 hours of basic undertime under the configured undertime policy. Eight banked hours cover the day fully. No partial comp request may produce a full eight-hour credit silently. |
| P4 | Payroll excludes rest days and holidays from working days, but leave approval counts typed leave dates without a matching non-working-date exclusion. Calendar-day versus working-day entitlement is not established consistently. | Use working-day entitlement: reject a leave charge on a configured rest day or recorded holiday; consume no entitlement or comp hours and apply no salary deduction. HR must change the calendar/daily status explicitly if the date should be a working day. |

Implement P1–P4 as written. Do not hardcode current discrepancies into passing golden values. The implementation plan records these decisions and retains regression cases for the alternatives rejected during review.
