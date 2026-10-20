# Attendance-to-payroll E2E implementation plan

> **For agentic workers:** Execute this plan task by task, using subagent-driven-development for isolated implementation and requesting-code-review for independent review. Preserve the existing dirty workspace. Do not commit, push, deploy or modify generated migrations.

**Goal:** Verify the approved attendance-to-payroll acceptance specification against real browser actions and PostgreSQL, with exact nonzero salaries and explicit evidence for every mandatory case.

**Architecture:** Reuse the compiled application, installed database tools and existing Playwright provisioning. A guarded orchestrator owns disposable local databases, fixture setup, application lifecycle and cleanup. Genuine browser actions verify the exposed salary workflow; captured production handlers verify the unexposed payroll lifecycle and concurrency separately.

**Tech stack:** Bun, TypeScript, Node, Playwright/Chrome, Vitest, PostgreSQL, Drizzle, Big.js.

**Spec:** `docs/superpowers/specs/2026-10-19-attendance-payroll-e2e-design.md`

## Global constraints

- P1–P4 are approved: paid annual leave preserves basic; rejected/cancelled comp reservations refund once; partial comp covers only its hours; nonworking dates consume no leave entitlement.
- Use `2026-10`, cycle `2026-09-16` through `2026-10-15`, TZ `Asia/Karachi`, local PostgreSQL port 5433, random run-owned databases ending `_test`.
- Refuse `main` and nonlocal hosts. Never change the retained demonstration data.
- Apply the complete immutable generated migration chain. Add no application runtime dependency, new leave type, test-only route or external payment integration.
- Expected salaries are independent literals and decimal arithmetic, never imported production calculations. Exact rupees, no tolerance.
- Browser and handler-integration results are separate. Missing, failed or skipped mandatory cases do not pass.
- Save traces and machine-readable assertions before cleanup. Explicit debug retention must identify retained databases. Never write credentials/tokens/passwords into evidence.

## Task 1: Approved policy behavior and monetary boundaries

Files: `src/lib/payroll-calculator.ts`, `src/server-functions/hr/attendance/leave-approvals-fn.ts`, `upsert-attendance-fn.ts`, `convert-overtime-fn.ts`, `process-overtime-fn.ts`, relevant focused regression tests.

- [x] Trace current annual, comp, nonworking-date, invalidation and finalized-period guards, including all callers.
- [x] Add failing behavioral checks for P1–P4 and the 7.98-hour PKR 3 rounding boundary.
- [x] Fix only demonstrated shared defects. Use existing attendance/payroll locking and invalidation helpers.
- [x] Run focused payroll and attendance regressions; independently review policy changes.

## Task 2: Independent fixtures and isolated run ownership

Files: `src/__tests__/e2e/attendance-payroll.fixtures.ts`, `attendance-payroll.setup.ts`, `attendance-payroll.run.ts`, fixture tests, `package.json`.

Interfaces: fixture exports provide literal working dates, salary configuration, case IDs and expected amounts. Setup writes credentials with mode 0600 outside evidence, seeded employee IDs, synthetic upload files and a sanitized manifest. Orchestrator sets `DATABASE_URL`, `TEST_DATABASE_URL`, `PAYROLL_E2E_DIRECTORY` and `PAYROLL_E2E_SCENARIO` before spawning setup/browser/integration processes.

- [x] Assert independent 26-day calendar, original SHA-256, baseline PKR 42,900, composite PKR 41,075, six-person net PKR 244,329 and rounding examples.
- [x] Guard local port/name before any database operation, require runtime after 15 October 2026, create exactly two owned databases and migrate them normally.
- [x] Seed only identity, salary/policy, entitlement prerequisite and synthetic wallet records. Browser-tested attendance is created through the app.
- [x] Compile once, run each database sequentially, capture sanitized results, revoke sessions, close pools and drop only owned databases. Preserve failed databases only with explicit retention.

## Task 3: Genuine browser salary journeys

Files: `src/__tests__/e2e/attendance-payroll.browser.cjs`; shared fixture manifest from Task 2.

- [x] Sign in through Better Auth as HR, import original and controlled files, assert raw timestamps/claims and review rows independently in PostgreSQL.
- [x] Use attendance editor/bulk action, all four leave approvals, overtime decisions and HR correction with audit reasons. Prove unresolved imports block salary saving before resolving them.
- [x] Select October 2026 explicitly, compare salary components/occasions/net, save draft, reload, compare persisted fields and payslip display/print.
- [x] Verify source replay before/after decisions and draft, viewer mutation rejection, screenshots/traces/console evidence. Do not replace transport or write action outcomes directly.

## Task 4: Real PostgreSQL lifecycle and concurrency

Files: `src/__tests__/integration/attendance-payroll.test.ts`; production payroll files only for reproduced defects.

- [x] Capture server handlers with real validators, explicit authenticated HR context and all production transactions/calculations.
- [x] Exercise L01–L16 and A01–A14 with the literal fixture, including composite and real-source totals, policy inheritance and allowance variants.
- [x] Exercise P01–P08 where applicable to lifecycle: stale generation, exact coverage, locks, balances, repeat decisions, finalized immutability, one wallet debit, insufficient funds and actual competing PostgreSQL calls.
- [x] Record all case IDs with expected/actual outcomes and the transport/auth limitation; missing cases remain explicit failures or incomplete coverage.

## Task 5: Acceptance and review

- [x] Run independent oracle checks, focused existing regressions, browser scenarios and lifecycle suite.
- [x] Run typecheck, production build and `git diff --check`; distinguish the pre-existing 47 report/P&L diagnostics.
- [x] Independently review the implementation against the entire approved spec; resolve important findings.
- [x] Run `graphify update .` after code changes.
- [x] Publish reproducible commands, evidence links, case coverage and actual limitations in `docs/superpowers/reviews/2026-10-19-attendance-payroll-e2e-verification.md`. Mark completion only when every mandatory gate passes.

## Execution ledger

- 19 October 2026: user approved the spec and P1–P4. Existing import/browser work is preserved as the baseline, not counted as salary acceptance evidence.
- Ruling: continue in the provided dirty workspace because the approved spec explicitly requires preserving and using the existing uncommitted import implementation. No commits or worktree migration.
- 20 October 2026 resumption: no third-run process survived the interruption. Continued from saved files and created run `5b2c099c7dbdccc1`; all four browser leave decision/retry flows passed, then the runner missed the overtime confirmation dialog. Run `7dff34ca3de52187` exposed stale SSR approval data despite a persisted two-hour pending request. Both are recorded failures, not accepted salary runs.
- A failing request-isolation regression demonstrated the module-scoped QueryClient sharing cached HR data across SSR requests. `getContext()` now creates a QueryClient per router/request. The focused isolation test passes after the fix.
- A14 integration exposed a selective-waiver explanation flag remaining false while its monetary deduction was waived. Added a failing annual explanation regression and fixed the shared waiver lookup; the five-file focused sweep passed 36 checks.
- Independent harness review found and prompted fixes for PostgreSQL URL query overrides, weak net-cell and review-row assertions, viewer error false positives, trace publication before sanitization, and missing browser punch-correction coverage. Review: `docs/superpowers/reviews/2026-10-20-payroll-harness-review.md`.
- Reupload with zero new punches has a disabled confirmation button in the existing UI. Browser evidence records this unchanged upload and preservation assertions; lifecycle coverage separately exercises handler confirmation. No unsupported click is invented.
- Completion on 20 October: run `b14d5a9a941cc2d7` passed 28 controlled and 31 original-file browser checks, both 31-test PostgreSQL lifecycle suites without skips, and all 40 mandatory case IDs. The affected regression sweep passed 169 tests in 30 files. Production build, source/output fingerprint reuse, independent reviews, final subcase assertions, Graphify refresh and `git diff --check` completed. Typecheck still reports exactly the 47 existing report/P&L diagnostics and no new diagnostic. Both final run-owned databases were dropped and credentials/raw traces removed. Detailed failed-run history and limitations remain in the verification report.

- Original-file fixture detail: existing recomputation automatically suggests overtime on seven completed rest-day intervals. The browser rejects those suggestions through the real approval screen while preserving source hours and claims. This creates no new overtime request or payout and keeps the approved salary oracle unchanged.
