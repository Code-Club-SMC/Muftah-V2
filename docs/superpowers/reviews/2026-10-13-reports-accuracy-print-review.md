# Reports accuracy and print independent review

Final status: both review findings resolved and scoped re-review passed. Implementation and fixture acceptance are complete. Follow-up database reconciliation passed 62 checks on available local data; nonzero sales/payroll/wallet data and other browsers remain unverified. See `2026-10-14-reports-live-reconciliation.md`.

Reviewed 14 October 2026 against the approved specification and implementation plan. Compared report changes with `.superpowers/sdd/2026-10-13-reports-accuracy-print/baseline/src`, read Task 1–3 implementation reports and the Task 1–2 review records, and inspected current report routes, shared components, date/money/salary helpers, server report changes and behavioral tests. Unrelated dirty changes and migrations are excluded. No source files were edited by this reviewer.

## Initial review verdicts, resolved below

Spec: changes requested. Two P2 findings remain in CSV serialization and complete P&L table totals. Date handling, standard report state, salary snapshot explanations and basis metadata otherwise follow the reviewed requirements. Final R7/A9 acceptance depends on the parent's browser evidence, not this source review.

Quality: changes requested for the CSV defect below. Shared helpers and state handling are straightforward; no new dependency or accounting model was introduced. Existing report authorization middleware is retained. The earlier Task 2 basic-salary duplication and arrears findings are fixed.

## Findings

### P2: Escape company reconciliation CSV fields exactly once

Location: `src/server-functions/reports/profit-loss/export-csv-fn.ts:146–159`.

The reconciliation rows escape each value when created, then escape every field again when serialized. The new grouped money formatter makes ordinary positive amounts trigger this path: `1,234.56` becomes `"""1,234.56"""` in CSV, which parses as a value containing literal quote characters. Summary and invoice rows contain the correctly escaped amount, so the same export now represents reconciliation money differently. Negative amounts and quoted descriptions also suffer from the existing double escape.

Keep reconciliation fields raw until the final row serialization, or serialize the already escaped rows without escaping again. Preserve protection for text that starts with spreadsheet formula characters. Add a parsed CSV regression covering grouped positive money, zero, negative money and quoted descriptions. This implements R3 and A10 without changing financial calculations. The double-escape structure predates this task, but grouped formatting newly exposes ordinary positive amounts to it.

### P2: Complete P&L detail tables still omit additive money totals

Locations: `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx:605` and `:677`; `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx:750`.

Recipe Invoice Drill-down renders every `invoiceDetails` record but stops after the final row, without totals for realized revenue, COGS or direct profit. The product and recipe Failed Batch Loss Trace tables likewise render their complete loss records without a loss-amount total. R3 explicitly requires totals for additive money columns when all contributing records are present. Add appropriately labelled totals based on those rows; leave realization percentages and rates unsummed.

The product Recent Invoice Sales table is intentionally limited by `fetchProductRecentInvoices(..., 12)` and is excluded from this finding. Do not put whole-report totals under that partial table. Existing company product totals and product recipe-summary totals already provide useful complete-table totals.

## Verification

Independently ran:

```text
bun run test src/__tests__/pnl-export.behavior.test.tsx src/__tests__/pnl-route-state.behavior.test.tsx src/__tests__/report-state-salary.test.ts src/__tests__/report-shell-behavior.test.tsx src/__tests__/report-route-state.test.tsx src/lib/report-dates.test.ts
```

All six files and 20 tests passed. They cover Pakistan dates, report precision, persisted salary components, applied filters, same-range refetch, failed refreshes, successful empty states and guarded browser PDF instructions. These tests do not exercise CSV content serialization and therefore do not detect the first finding. A separate executable reproduction using the current CSV escaping function confirmed the double-escaped strings for `1,234.56` and `-10.25`.

## Acceptance evidence still required

- R7/A9: the parent is refining shared CSS and inspecting actual browser-generated fixtures. This reviewer did not inspect a PDF or verify page clipping, repeated headers, row coverage or physical font sizes. Record the actual browser, artifact paths and inspected pages for empty, ordinary and multi-page Sales, Salaries, Purchases, Expenses, Outstanding and P&L output. Do not turn passing DOM fixtures into a visual pass.
- R3: monetary values are formatted to two decimals, and salary discrepancies retain stored totals. No dedicated behavioral fixture demonstrates a displayed-component rounding difference against a stored total. Keep this acceptance gap explicit; do not alter accounting calculations to manufacture agreement.
- A4/A10: no live database reconciliation was performed by this reviewer. Existing invoice-cohort outstanding semantics and operational payment realization were preserved rather than redefined.
- Final consolidated typecheck, production build and `graphify update .` remain parent-owned. Prior task reports describe successful checks; this review does not independently certify the final combined versions.
- Page-number behavior outside the browser actually tested must remain documented as a browser limitation.

The verdict covers the source state at review time. The parent is concurrently refining print CSS and fixtures; append scoped fix verification when the findings above are resolved.

## Scoped fix verification, 14 October 2026

Both P2 findings above are resolved. Reconciliation values remain raw until final CSV serialization, so grouped positive amounts and quoted descriptions are escaped once. Formula-leading text is prefixed before quoting, including text containing quotes, while formatted negative money retains its numeric sign. Known zero follows the same money formatter and serializes as `0.00`.

The complete recipe invoice table now totals realized quantity, revenue, COGS and direct profit from its displayed `invoiceDetails` records. Its footer spans the ten existing columns and leaves realization rates and statuses unsummed. Recipe and product loss footers total their displayed complete loss records, with correct seven-column and eight-column spans respectively. The partial product Recent Invoice Sales table has no misleading overall contribution total.

Salary reconciliation now compares displayed component cents with displayed stored totals. The new fixture demonstrates two `1.005` earnings displayed as `1.01` each against stored gross `2.01`, yielding a disclosed `-0.01` difference. The route displays nonzero differences and explains rounding or incomplete snapshots. Basic salary and night shift remain counted once, and net reconciliation includes persisted arrears once without changing stored totals.

Independently ran `bun run test src/__tests__/pnl-csv.behavior.test.ts src/__tests__/pnl-table-totals.behavior.test.tsx src/__tests__/report-state-salary.test.ts`. All three files and nine tests passed. The CSV test asserts exact serialized strings rather than parsing CSV, and zero is covered by the money-format test rather than a reconciliation-row fixture. These are coverage limits, not observed defects in the inspected serialization path.

Scoped spec and quality verdicts pass for these fixes, with no remaining finding in the reviewed scope. This supersedes the earlier two P2 findings and the salary rounding-fixture gap. Actual PDF inspection, live reconciliation, consolidated typecheck/build and graph update remain parent-owned and are not certified by this scoped re-review.

## Final implementation acceptance, recorded by parent

Final source verified on 14 October 2026. Both P2 findings and the earlier salary findings are fixed and independently re-reviewed. No unresolved material code findings remain in the reviewed scope.

- Consolidated reporting suite: 13 files, 108 tests passed.
- Final targeted salary/print fixtures: 3 files, 33 tests passed after the last print changes. Earlier final print/control pass: 4 files, 31 tests passed.
- Full typecheck passed. Final production build passed. `git diff --check` passed for report files.
- Final `graphify update .` succeeded outside the sandbox after the sandbox denied its worker process operation. AST graph refreshed to 6,536 nodes and 18,391 edges; optional HTML visualization exceeded the existing graph-size limit.
- Chrome 144.0.7559.132 generated 27 A4 landscape PDFs from actual route DOM: six standard reports plus company/product/recipe profitability, each with 0, 3 and 100 record fixtures. Browser measurements found no horizontal overflow, no overflowing table cells, correctly aligned numeric cells, and table fonts at least 9pt.
- Extracted text from all 27 PDFs confirmed every expected unique record ID, page numbering on every page, and the offline incompleteness notice.
- Visually inspected first pages for Outstanding, Purchases, Salaries, Expenses and all three P&L scopes; continuation pages for Sales, Outstanding, Purchases, Salaries, Expenses and Product P&L; and an empty Collections report. Repeated table headers, readable monetary decimals, known zeros, signed negatives, complete salary components and retained print warnings were visible.
- Compact salary detail puts earnings and deductions side by side. The 100-employee fixture fell from 84 to 59 pages while retaining all records; the 3-employee fixture fits 3 pages. Company duplicate screen header/date-picker chrome is hidden in print.

Artifacts and full test/build/browser/graph logs are stored in `.superpowers/sdd/2026-10-13-reports-accuracy-print/{artifacts,verification}/`. `browser-checks.json` and `pdf-text-checks.json` record the automated output checks. These are fixtures, not production financial records.

| Acceptance | Evidence | Result / limits |
| --- | --- | --- |
| A1–A3 Pakistan dates, validation, comparisons | Helper/P&L tests and independent date review; UTC and Pakistan runs | Passed for defined calendar contract. |
| A4 current outstanding meaning | Query/code review, visible invoice-cohort basis in screen/PDF | Passed presentation/selection review; no historical balance or live-ledger reconciliation claimed. |
| A5 precision/zero/negative | Formatter tests, rendered expenses/CSV tests, PDFs | Passed. |
| A6 complete salary/arrears/rounding | Real persisted-snapshot regressions, scoped independent re-review, side-by-side PDF detail | Passed fixtures; stored payroll totals preserved. |
| A7 applied/draft/error/refetch | Actual shell, Sales and Company P&L route behavior tests | Passed. |
| A8 source and offline notice | Header/control tests and PDF text extraction | Passed fixtures. |
| A9 long documents/readability | 100-row fixtures in all nine scopes, Chrome metrics and representative page inspection | Passed Chrome fixtures; no guarantee of identical pagination in untested browsers. |
| A10 shared P&L/CSV scope | Date/reporting/CSV tests, chart print tables and P&L PDFs | Passed fixture/code coverage; no live cross-report reconciliation performed. |
| A11 truthful Expenses totals/cost labels | Code review and Expenses PDF inspection | Separate categories and actual per-pack cost retained; no overlapping accounting grand total or false budget column. |

Optional QA prerequisites: a local Playwright installation, Chrome, `pdftotext`, and `pdftoppm`. No application dependency was added. Run the two print-fixture test files with `REPORT_FIXTURE_DIR` set, copy the current `.output/public/assets/styles-*.css` to that directory as `report-app.css`, then run `scripts/check-report-pdfs.cjs` with `REPORT_BROWSER_MODULE` pointing to Playwright.
