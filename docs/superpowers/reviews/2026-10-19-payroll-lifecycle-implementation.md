# Payroll lifecycle implementation and validation

The standalone PostgreSQL matrix passed 28 cases on 20 October 2026. The browser-draft prerequisite case was deliberately excluded, giving 28 passed and 1 skipped. This result proves the handler-level lifecycle matrix, not complete browser acceptance.

Evidence is saved under [lifecycle-92e63223aff6c952](attendance-payroll/lifecycle-92e63223aff6c952/integration-results.json). The [Vitest log](attendance-payroll/lifecycle-92e63223aff6c952/vitest.log) records the actual invocation and result. Its randomly named database, `titan_payroll_e2e_92e63223aff6c952_test`, was created for this validation and migrated using the existing generated migrations. Main was never selected. Fixtures created prerequisites only; tested attendance, import, leave, overtime, generation, approval and payment actions called production handlers or production import services.

## Scope and transport limitation

Production input validators, calculations, transactions and PostgreSQL ran. The suite captures the TanStack server-function transport and supplies explicit HR context. Middleware authorization is not exercised by these calls. HTTP authentication, viewer denials, salary preview/save/reload/print and the real-source browser workflow require the separate browser runs.

The machine report explicitly records `browserDraftPrerequisiteVerified: false` and omits `P01`, `P08` and `REAL_FILE` from this invocation's coverage. The first test remains strict: a seed-only database without browser-created draft slips fails. When the full runner executes it after the browser, it checks every saved and regenerated employee net, deduction and salary revision, approval balances, exact settlement and replay behavior. Those assertions were not run in this standalone validation.

## Demonstrated payroll correction

Payroll approval previously counted a legacy approved annual row on a Sunday against annual entitlement. The reproduced result was 11 remaining days where the independently counted working-date usage required 12. `recalculateLeaveBalancesForPayroll` now reads leave rows within the payroll's leave year, filters working dates and counts covered dates once across overlapping approved payroll periods.

The suite additionally proves January approval excludes the preceding December's leave, overlapping historical payroll coverage does not count one date twice, and earlier approved same-year usage survives later approval. It retains real concurrent annual approvals competing for one remaining paid day.

The resumed validation also reproduced selective waiver deductions with `explanationLog.isWaived` incorrectly false. The parent agent fixed that calculator reporting defect. All four named selective waiver cases now require their explanation flags and passed. No further payroll/core production edits were needed during this resumed validation.

## Subcase audit

| Cases | Assertions actually exercised in the standalone matrix |
| --- | --- |
| L01-L06 | All four schema leave types; pending approval refusal; stored paid/approval states; exact default salaries; approved and direct pending-to-rejected paths; repeated decisions; pending and rejected leave summaries; no failed-approval balance or wallet changes. Separate per-type regeneration and payroll approval cases verify one annual, sick or comp charge and unchanged other balances. |
| L07-L09 | Thirteen historical paid annual dates with approved payroll coverage and two competing decisions; one paid, one unpaid. Independent single excess-date literals with basic policy disabled and enabled. Paid annual retains basic under the enabled policy. Company policy inheritance, disabled and enabled employee overrides, sick and special basic switches, fuel replacement and a custom sick allowance are asserted separately. |
| L10-L12 | Comp reservation 8, repeated 8, revision to 6, cancellation refund and repeated rejection refund; invalid/nonfinite/overdraw refusal; full and partial comp salary; eight actually worked overtime hours converted once and consumed without cash payout. |
| L13-L16 | December/January request-year and January payroll-year boundaries; eleven approved sick dates remain sick, have net 42,900 under baseline flags and net 31,900 under enabled sick basic deduction, with remaining sick balance clamped to zero. Rest-day and recorded-holiday charges are refused. Missing/unsupported leave types fail without changing the prior row. Concurrent entitlement and comp decisions conserve balances. |
| A01-A05 | Exact baseline, absence, late-only/early-only/combined undertime, seven-hour break import, pending/rejected/approved overtime, multiplier 1.5 and eligibility refusal. |
| A06-A08 | Same-upload and separate-upload overnight attribution, following normal duty, historical cycle and calendar boundaries, configured night allowance, incomplete imported day and daytime next-arrival separation. Save/generation with a full waiver and ignored unmarked days still refuses invalid evidence. An older complete salary snapshot cannot approve after new unresolved import evidence. |
| A09-A10 | Six-hour to eight-hour correction and reupload; raw claims and correction/deletion audit; deleted punches stay deleted after replay. Explicit absence and each of the four supported leave resolutions determine salary despite surviving raw evidence. |
| A11-A14 | Rest dates create no unmarked alarm; missing working dates remain unmarked until HR resolves them; holiday divisor 25 and annual deduction 104; joining/cutoff proration and the existing effective-revision-date rule; exact half-rupee rounding and accumulation; annual, sick, special and undertime waivers preserve other deductions, attendance and balances and carry a waived explanation. Pending leave and invalid imported timelines remain blockers under a full waiver. |
| P02-P04 | Manual daily changes, leave decisions, correction and overtime decisions stale existing drafts. Regeneration yields the correct exact amount. Empty/incomplete/ineligible coverage is refused; the unique constraint rejects duplicate employee coverage. Per-type and historical entitlement approval is repeatable without an extra charge. |
| P05 | Approved and paid cycles refuse daily edits, punch addition/correction/deletion, overtime decisions, leave decisions, comp conversion, bulk daily changes, bulk leave ranges, regeneration and direct draft saves. New finalized-period imports report blocked input. Snapshots verify attendance, balances, payslips, payroll, wallet and ledger stay unchanged. |
| P06 | Insufficient funds preserves approved state, wallet and ledger. Two simultaneous payment handlers yield one success and one exact debit. Repeated payment is refused. The independent two-employee case pays 85,800 and leaves 914,200. Each independent case resets only the manifest-owned wallet and its transactions after the initial browser lifecycle evidence. |
| P07 | Actual competing PostgreSQL calls cover annual entitlement versus entitlement, comp spend versus spend, conversion versus conversion, conversion versus two spends, leave approval versus regeneration, correction versus regeneration, import versus payroll approval and payment versus payment. Assertions allow either valid serialized outcome and require an exact final salary or a stale-draft refusal followed by regeneration. |
| COMPOSITE | Gross 43,650, deductions 2,575, net 41,075, component and occasion reconciliation, attendance counts, Bradford 27 and final annual/sick/comp balances 13/9/8. |

Case IDs are attached to named assertions; numeric expected and actual comparisons are recorded alongside each test. A passing ID is not used here to claim that omitted browser subcases ran.

## Other checks and remaining obligations

The [typecheck log](attendance-payroll/lifecycle-92e63223aff6c952/typecheck.log) has exactly the previously identified 47 report/P&L diagnostics and no diagnostics in the lifecycle suite or payroll files. `git diff --check` passed for the lifecycle and payroll files. The complete application build, browser scenarios, real-source lifecycle prerequisite, HTTP/RBAC acceptance, independent final review and final graph refresh belong to the parent run and must be assessed using its actual results.

The calendar-boundary fixture uses 31 August/1 September and the cycle-boundary fixture uses 15/16 October. The previous 31 October fixture was future-dated relative to the runtime and correctly imported no punches; this was a test fixture error, not a production defect.

Fixture credentials are private temporary artifacts and must be deleted after validation. [Cleanup results](attendance-payroll/lifecycle-92e63223aff6c952/cleanup.json) record account revocation, database removal and credential deletion for the proven-owned lifecycle runs. No commits, pushes, deployment or generated migration edits were performed by this resumed lifecycle task. The parent is responsible for the single final graph update while shared edits are quiescent.
