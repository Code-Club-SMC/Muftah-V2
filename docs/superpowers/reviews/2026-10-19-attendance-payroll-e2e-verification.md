# Attendance-to-payroll acceptance verification

Status: implemented and locally accepted on 20 October 2026. The user approved the specification and P1–P4 on 19 October. Full run `b14d5a9a941cc2d7` passed both browser scenarios and both PostgreSQL lifecycle suites. No deployment is claimed.

Specification: [attendance-to-payroll acceptance](../specs/2026-10-19-attendance-payroll-e2e-design.md). Execution checklist: [implementation plan](../plans/2026-10-19-attendance-payroll-e2e.md).

## Final acceptance evidence

Command: `bun run test:e2e:payroll --reuse-build`. [Machine run report](attendance-payroll/b14d5a9a941cc2d7/results.json), [acceptance summary](attendance-payroll/b14d5a9a941cc2d7/acceptance-summary.json), [all 40 case IDs with named evidence](attendance-payroll/b14d5a9a941cc2d7/case-coverage.json).

| Tier | Controlled scenario | Original workbook |
| --- | --- | --- |
| Genuine browser | [28 checks passed](attendance-payroll/b14d5a9a941cc2d7/controlled/browser-results.json) | [31 checks passed](attendance-payroll/b14d5a9a941cc2d7/real/browser-results.json) |
| PostgreSQL lifecycle | [31 tests passed](attendance-payroll/b14d5a9a941cc2d7/controlled/integration-results.json) | [31 tests passed](attendance-payroll/b14d5a9a941cc2d7/real/integration-results.json) |

Both lifecycle suites verified their actual browser-saved draft prerequisite, with no skipped case. The real-file flow verified 138 raw punches/claims, 12 review rows, 114 explicit supplemental dates, 166 stored attendance rows, and working-date totals of 147 present, five absent and four approved leave dates, plus ten rest-day records. Gross PKR 257,400 minus PKR 13,071 deductions equals PKR 244,329 net. All six individual preview, saved, reloaded and printed salaries match the unchanged oracle. Payment debits the isolated synthetic wallet once. Composite net PKR 41,075, separate period/yearly Bradford scores of 27, entitlement races, invalidation revisions and finalized-period guards also passed.

The final run verified the latest production-source and compiled-output fingerprints before reusing the successful build. Both run-owned databases were removed after session revocation; both private credential files and raw trace archives are absent. Sanitized traces, screenshots and PDFs remain in each scenario directory. Earlier failures below remain failures and are not counted as acceptance.

## Recorded checks

- The affected regression sweep passed **169 tests across 30 files**. Durable [regression log](attendance-payroll/b14d5a9a941cc2d7/affected-regressions.log).
- The independent workbook XML extraction verified the unchanged source SHA-256, 52 source rows, 138 punches and 12 review rows. Its checked-in fixture independently reproduces all six undertime amounts and the 114 supplemental working dates. Run `python3 src/__tests__/e2e/attendance-payroll.source.py`.
- Typecheck completed with exactly the **47 pre-existing report/P&L diagnostics**, with no other diagnostic. Durable [typecheck log](attendance-payroll/b14d5a9a941cc2d7/typecheck.log), rerun after the final test-only assertion additions. This is not a passing repository-wide typecheck.
- The production build passed through `bun run build`. Run `c5f51368454a1276` built the latest production source and records source SHA-256 `f4ebab5797a08e6abb4737f93d96fd83e9e06df73df5677c5806201146785f9a` and compiled-output SHA-256 `1853c161912ac4ece8ecf17c9d21748ff79ae5304ed0d2084825fb67516ffd8d`. Reuse is allowed only while both hashes still match.
- Isolated preparation created, migrated, seeded and removed both disposable databases in run `7091d350b2d81718`. This was preparation-only evidence, not salary acceptance.

## Browser execution ledger

| Run | Recorded outcome |
| --- | --- |
| `64746382fca5a231` | Failed browser preview pagination after two controlled leave submissions. |
| `20ce76c7a711cad3` | Failed because the test awaited POST for actual GET-based leave decisions. |
| `5b2c099c7dbdccc1` | All four browser leave pending/approved/rejected/repeated flows passed. The runner then missed the overtime confirmation dialog. |
| `7dff34ca3de52187` | Exposed stale SSR overtime approval data despite a persisted pending request. A failing request-isolation regression demonstrated the shared QueryClient; the shared source was fixed. |
| `5701645c8c937ce3` | Overtime request/approval and seven complete salary preview/save/reload/print cases passed. The runner then advanced payroll pagination before new rows rendered. Overall run failed. |
| `19f8591d9b5092ab` | Controlled browser 28 steps and lifecycle 29 cases passed. Original import succeeded; runner incorrectly expected unresolved punches to block preview rather than save. Overall failed. |
| `f105469c14a660af` | PostgreSQL connection lost during migration while Docker Desktop was unavailable. No scenario setup/browser pass. Failed; retained database sessions revoked after recovery. |
| `c5f51368454a1276` | Original-only browser passed 30 steps, including all six salaries. Lifecycle passed 30 of 31 cases; approval correctly refused seven automatically suggested rest-day overtime items that the fixture had not resolved. Overall failed. |
| `907277fd5e28897c` | All 11 controlled salary journeys passed, then inline correction editor disappeared before Save, so no correction request was sent. Failed; owned database removed. |
| `edc3471f8f5f2872` | Controlled browser 28 steps and lifecycle 31 cases passed, including final subcase assertions. Original-file run stopped before overtime decisions because raw PostgreSQL dates were JavaScript Date values while the oracle uses date strings. Seven identities/hours matched. Both run-owned databases removed. |
| `b14d5a9a941cc2d7` | Passed: controlled browser 28 checks, original browser 31 checks, both lifecycle suites 31 tests each, all 40 mandatory case IDs, both owned databases removed. |

Each run's machine report is under `docs/superpowers/reviews/attendance-payroll/<run>/`. Individual successful steps in failed runs do not establish full acceptance. Failed databases were retained only because the invocation explicitly selected `--retain-on-failure`; their identities are in each run's cleanup report. Test sessions are revoked and credentials removed even when a failed database is retained.

## Demonstrated fixes

- Paid annual leave preserves basic salary when the annual basic policy is enabled; unpaid/excess annual follows that flag.
- Comp-off reservation changes apply deltas, rejected/cancelled requests refund once, and partial comp-off covers only its applied hours.
- Nonworking leave charges are refused. Payroll balance recalculation excludes historical nonworking leave, clamps the leave year and avoids counting overlapping payroll coverage twice.
- Money accumulates exact common-denominator numerators before half-up rupee rounding, including the 7.98-hour PKR 3 boundary and thirteen fractional daily deductions totaling PKR 13,312.50.
- Manual attendance changes invalidate draft payroll and cannot edit finalized periods without relying on device provenance. Leave/overtime decisions and conversions use the shared transaction guards.
- Rest-day overtime validates against zero standard hours; configured shift duration is respected on working dates.
- Selective waivers now mark their explanation entries as waived as well as removing their monetary deduction.
- QueryClient instances belong to each router/request, preventing an earlier SSR approval response from hiding a later saved overtime request.
- Five attendance/leave/overtime hooks now invalidate the actual salary preview, dashboard and employee history query prefixes. All five actual-hook cache tests failed before the fix and passed after it.
- Failed batch generation cleanup acquires the shared payroll lock and checks draft status before reversing or deleting slips. A real PostgreSQL scheduling barrier reproduced approved coverage falling from two slips to one before the fix, and preserved both slips and PKR 85,800 afterward. [Red and green evidence](attendance-payroll/lifecycle-9fbe3dd93550d0c2/targeted-green-results.json) remains separate from full acceptance.

The original workbook creates seven positive pending rest-day overtime suggestions under existing attendance behavior. The browser now explicitly rejects these in the actual approval screen, without creating a request, changing source intervals, converting comp hours or paying overtime. This supplies the specified zero overtime payout and resolves the approval prerequisite.

Policy implementation and review: [implementation](2026-10-19-payroll-policy-implementation.md), [initial review](2026-10-19-payroll-policy-review.md). Harness review and resolution status: [independent review](2026-10-20-payroll-harness-review.md). Production and mandatory-subcase review: [final review](2026-10-20-payroll-final-review.md). The review found no remaining scoped blocking finding after fixes and added assertions; full runtime acceptance is recorded above.

## Reproduce

Use local PostgreSQL on port 5433 and the installed Chrome/Playwright provisioning. Optional `ATTENDANCE_BROWSER_MODULE` selects an existing Playwright module directory; `ATTENDANCE_BROWSER_CHROME` selects Chrome. `PAYROLL_E2E_ADMIN_URL` may select local PostgreSQL's `postgres` administration database. Endpoint/query-override guards refuse nonlocal connections, other ports and unowned test database names.

```bash
python3 src/__tests__/e2e/attendance-payroll.source.py
bun run test src/__tests__/e2e/attendance-payroll.fixtures.test.ts src/__tests__/e2e/attendance-payroll.safety.test.ts
bun run test:e2e:payroll
```

`--retain-on-failure` retains only failed run-owned databases for diagnosis. `--reuse-build` verifies both production-source and compiled-output fingerprints before reuse and rebuilds otherwise. `--prepare-only` checks preparation/cleanup and reports that limited scope explicitly. `--scenario=controlled` or `--scenario=real` runs a diagnostic subset and can report only partial success.

The browser uses real Better Auth and database RBAC, actual UI actions, real application transport and independent PostgreSQL inspection. Its traces retain actions, DOM snapshots and images while excluding authenticated HTTP traffic and response resources. Raw traces are staged privately and removed before publication. Salary component/occasion assertions and sanitized expected/actual amounts live in the machine report.

Lifecycle integration captures only the server-function transport/middleware boundary, supplies authenticated HR context, and keeps production validators, handlers, calculations, transactions and PostgreSQL. It does not establish HTTP authentication for the unexposed approval/payment actions. Browser and integration reports remain separate.

## Completed gates and limits

All required local acceptance gates passed, with the explicitly permitted existing typecheck failures recorded separately. Independent production review, harness review and mandatory-subcase audit found no remaining blocking finding after fixes. [Final Graphify log](attendance-payroll/b14d5a9a941cc2d7/graphify.log) records successful refresh after the last code edit. `git diff --check` passed.

Each browser recorded zero uncaught page exceptions and the existing SVG console message `ellipse rx: undefined`. The controlled and original response observers recorded seven and one discarded response-body inspections respectively after navigation; these are logged separately from mutation results. Actual required mutations and salary responses were checked independently, and neither browser recorded an HTTP error response.

Lifecycle transport/auth limits described above remain intentional. The repository-wide typecheck remains failing on the 47 unrelated report/P&L diagnostics. This work made no deployment, commit, push, production wallet operation or change to retained `main` demonstration data. Earlier explicitly retained failed databases remain identified in their reports. The database whose revocation failed during Docker interruption has a separate successful [cleanup recovery record](attendance-payroll/f105469c14a660af/cleanup-recovery.json).

Versioned console logs preserve their output content with trailing whitespace and terminal blank lines removed. Browser recordings, screenshots and PDFs remain local and are regenerated by the documented command.
