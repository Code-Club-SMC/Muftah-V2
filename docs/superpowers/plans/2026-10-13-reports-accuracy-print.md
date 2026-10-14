# Reports accuracy and print implementation plan

> **For agentic workers:** Use subagent-driven-development for implementation and requesting-code-review for independent review. Track completion in the execution ledger.

**Goal:** Implement the approved reporting specification and record test and rendered-PDF evidence.

**Architecture:** Shared Pakistan calendar helpers normalize inputs and display dates. Standard reports share applied-query state and document metadata; standard and P&L reports share print styling. Existing stored financial values remain authoritative.

**Tech Stack:** TanStack Start/Query, React, existing shadcn components, Drizzle, Vitest, browser printing.

**Spec:** `docs/superpowers/specs/2026-10-13-reports-accuracy-print-design.md`

## Global constraints

- Reporting calendar dates mean dates in `Asia/Karachi`, independently of browser and server timezone.
- No schema changes, migration edits, payroll recalculation, historical balance reconstruction, new general ledger, or unrelated manufacturing changes are included.
- Preserve the user's existing uncommitted changes, including reporting changes.
- Use browser printing for both paper and PDF, explicitly labelled as such.
- Body/table text is at least 9pt; metadata/footer text is at least 8pt.
- Do not commit the dirty worktree or overwrite existing changes. Work in the user's current feature branch; review task-scoped diffs against saved pre-task copies.

## Task 1: Pakistan calendar contract

**Requirements:** R1, date portions of R6/R7; A1–A3, A10.
**Files:** Create `src/lib/report-dates.ts` and `src/lib/report-dates.test.ts`. Modify date handling throughout `src/server-functions/reports/`, especially P&L math, trend generation, CSV, and range validation. Preserve existing non-date modifications.
**Interfaces:** Export `reportDateKey(value: Date | string): string`, `formatReportDate(value: Date | string): string`, `formatReportTimestamp(value: Date | string): string`, `datePickerKey(value: Date): string`, `reportDateBounds(input: {dateFrom?: string; dateTo?: string}): {fromDate?: Date; toDate?: Date}`, and `currentReportMonth(): {from: string; to: string}`. Keep existing P&L date-function exports compatible with callers. Date strings are calendar keys; timestamp inputs are instants interpreted in Pakistan time.

- [x] Add failing behavior tests including:
  ```ts
  expect(reportDateBounds({dateFrom: '2026-10-13', dateTo: '2026-10-13'}))
    .toEqual({fromDate: new Date('2026-10-12T19:00:00Z'), toDate: new Date('2026-10-13T18:59:59.999Z')});
  expect(() => reportDateBounds({dateFrom: '2026-02-30'})).toThrow();
  expect(() => reportDateBounds({dateFrom: '2026-10-14', dateTo: '2026-10-13'})).toThrow();
  ```
- [x] Run `bun run test src/lib/report-dates.test.ts` and confirm failure before implementation.
- [x] Implement strict normalization using `Intl.DateTimeFormat` for Pakistan calendar keys and explicit UTC boundaries. Preserve unbounded optional endpoints outside P&L; P&L defaults to Pakistan current month.
- [x] Update report queries and P&L comparison/trend/export callers. Include month/year rollover, leap dates, and timestamp compatibility tests. Existing query status/cost/recognition filters are unchanged.
- [x] Run focused reporting tests in UTC and Asia/Karachi. Record any obsolete local-time expectations replaced with the approved timezone contract.

## Task 2: Standard report state, precision, and traceability

**Requirements:** R2–R6 for standard reports; A4–A8, A11.
**Files:** `src/components/reports/report-page-shell.tsx`, `report-primitives.tsx`, `offline-report-pending-banner.tsx`; six standard route `index.tsx` files; `salaries-report-fn.ts`; new focused report formatting/state/salary helpers and behavior tests under `src/lib/`, `src/hooks/reports/`, and `src/__tests__/` as necessary.
**Interfaces:** Consume Task 1 date helpers. Produce a reusable `ReportDocumentHeader` and `ReportPrintStyles` in `src/components/reports/report-document.tsx`, with title, period, source, generatedAt and basis inputs, suitable for P&L reuse. Export report-only `formatReportMoney(value)` using two decimal places. Keep global dashboard money defaults unchanged.

- [x] Write behavioral tests that fail for hidden salary components, whole-rupee money, stale/draft filters, failed fetch versus empty, and same-filter regeneration.
- [x] Use an applied filter object in the query key. On unchanged generation call `refetch()`; on changed generation update params. Pass query error, fetching state and successful `dataUpdatedAt` to the shell. Disable exporting draft/loading/failed content.
- [x] Send picker calendar keys using `datePickerKey`, show applied metadata, and require both dates. Print empty successful reports with an explicit message.
- [x] Format report money precisely, use accurate basis labels, add additive totals, remove Expenses combined `Grand Total` and duplicate `Budget/Pack`. Preserve known zeros.
- [x] Select persisted salary allowances and display summary plus named per-employee earnings/deductions. Use stored gross/net/deduction totals; label differences and arrears separately. Avoid double-counting night-shift allowance snapshots.
- [x] Include printable offline pending/status-error warnings, truthful Titan ERP identity, PKT timestamp, currency and source.
- [x] Run new behavior tests plus existing offline/settlement/reporting tests and typecheck for affected files.

## Task 3: Unified print/PDF and P&L integration

**Requirements:** R3, R5–R7 across P&L; A8–A10 and long-document coverage for standard reports.
**Files:** `src/components/reports/report-document.tsx`; shared report primitives; all P&L route files and relevant components, especially `pnl-report-primitives.tsx`, `pnl-export-bar.tsx`, and `company-profitability-overview.tsx`; existing CSV export if scope metadata needs amendment. Add behavior tests and a reproducible fixture renderer under `scripts/`.
**Interfaces:** Consume shared Task 1 dates, Task 2 report money and header. Make P&L print/export controls accept disabled state for fetching/errors/unapplied dates; all report roots use the shared document selector.

- [x] Add tests for applied P&L source metadata, PDF instructions before print, precision, and export disabling while draft/fetching.
- [x] Replace conflicting print rules with shared scoped A4 landscape styling. Use right-aligned numeric cells, wrapping descriptive cells, 9pt tables, repeated headers, no scroll clipping, and breakable sections.
- [x] Refactor excessively wide tables into compact related sections where needed. Use common title/period/source/generated/basis metadata and keep offline warnings visible.
- [x] Keep browser print PDF; explain `Save as PDF` before opening the dialog. Preserve existing CSV data scope and include date/source metadata without inventing download behavior.
- [x] Render actual report components with representative fixtures into HTML using React server rendering and project CSS. Generate PDFs in headless Chrome; include 100-row and long-text cases. Inspect PDF pages and extracted text for row coverage and clipping.
- [x] Run targeted report component tests and record inspected artifacts/browser versions.

## Task 4: Acceptance review and completion

**Requirements:** Entire specification.
**Files:** Execution ledger and `docs/superpowers/reviews/2026-10-13-reports-accuracy-print-review.md`; task files only when fixing findings.

- [x] Run focused tests, `bun run typecheck`, and `bun run build`; compare failures with baseline evidence.
- [x] Dispatch independent review against R1–R7/A1–A11, using a task-scoped changed-file list and saved original diff for pre-existing reporting modifications.
- [x] Resolve material findings and rerun affected checks.
- [x] Run `graphify update .` after final source changes.
- [x] Record acceptance coverage, actual PDF observations, and any live-data/browser limitations. Report completion without claiming statutory or live-ledger certification.

## Plan self-review

| Tasks | Shared interface/file | Resolution |
| --- | --- | --- |
| 1 → 2 | Date helpers and salaries backend | Dates finish first; salary additions preserve normalized filtering. |
| 1 → 3 | P&L dates and export | P&L frontend consumes the same keys; CSV changes preserve date semantics. |
| 2 → 3 | Shared document/header/styles, money helper | Standard reports establish the shared contract; print task refines it and integrates P&L. |
| 1 | Date tests versus normalization | Exact UTC endpoints match approved R1. |
| 2 | Stored totals versus visible components | Never recompute payroll records; disclose differences. |
| 3 | Browser PDF versus direct download | Actions accurately explain the browser flow. |
| 4 | Existing dirty files versus review scope | Compare saved originals; no unrelated changes or commits. |
