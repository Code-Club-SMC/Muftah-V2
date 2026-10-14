# Reports accuracy and print/PDF specification

Status: Approved by the user on 2026-10-13; implemented and verified against fixtures on 2026-10-14. See the final review for acceptance evidence and live-data/browser limits.

## Objective

Make the reports module understandable, internally traceable, and readable on screen and on A4 paper. Correct report date boundaries and misleading presentation without changing the established operational profitability model.

This specification defines acceptance criteria, not a claim of statutory accounting compliance. It supplements `docs/specs/profit-loss-reporting-spec.md`. Existing payment-based realization, frozen invoice COGS, returns handling, and finance reconciliation remain authoritative.

## Scope and approach

Cover Sales, Collections, Outstanding, Salaries, Purchases, Expenses, and company/product/recipe profitability, including their existing CSV and print/PDF paths.

Use shared date, metadata, money, and print helpers with the existing report components. Preserve report-specific tables and drill-downs. Use browser printing for both paper and PDF, explicitly labelled as such.

Alternatives considered:

- Styling-only changes leave the date and interpretation problems unresolved.
- A dedicated server PDF renderer adds a dependency and a second rendering path. It is unnecessary for the existing browser print workflow.
- Shared reporting conventions and corrected date handling address the observed problems with the existing stack. This is the proposed approach.

No schema changes, migration edits, payroll recalculation, historical balance reconstruction, new general ledger, or unrelated manufacturing changes are included. Preserve the user's existing uncommitted changes, including reporting changes.

## Requirements

### R1. Pakistan reporting dates

- Reporting calendar dates mean dates in `Asia/Karachi`, independently of browser and server timezone.
- New UI requests send validated `YYYY-MM-DD` dates. Date picker values represent selected calendar dates; do not serialize local midnight into an ISO timestamp and then apply server-local end-of-day logic.
- Shared server normalization converts date boundaries into UTC instants. An inclusive 13 October 2026 range starts at `2026-10-12T19:00:00.000Z` and ends at `2026-10-13T18:59:59.999Z`.
- Preserve compatibility with existing internal timestamp callers by interpreting timestamps as instants and deriving their Pakistan calendar date before normalization. Do not accept arbitrary malformed date strings.
- Reject impossible dates and reversed ranges. The UI requires both dates before generation. Missing dates on existing server entry points retain their documented defaults; P&L defaults to the current Pakistan calendar month.
- Apply the same rules to queries, previous-period comparisons, trend buckets, displayed transaction dates, report metadata, and CSV date/filename generation. Audit every caller before changing shared P&L date helpers.
- Monthly comparisons use Pakistan calendar months. Custom comparisons use an equal number of calendar days immediately preceding the selected range.

### R2. Report meaning and balance basis

Show a short basis statement in both screen and printed reports:

| Report | Required explanation |
| --- | --- |
| Sales | Invoices issued in the selected period; paid and outstanding amounts are current balances, not collections during that period. |
| Collections | Confirmed receipts use effective date. Pending and exception sections use payment date. Non-cash expense offsets are excluded from receipts. |
| Outstanding | Current unpaid balances for invoices issued in the selected period. This is not a historical closing balance or all outstanding debt. |
| Salaries | Payslips selected by payroll payment date; payroll month is shown separately. Net salary is a payroll result, not a claim that the same cash amount was disbursed. |
| Purchases | Purchases selected by purchase date; paid and outstanding amounts reflect current payment status. |
| Expenses | Finance expenses, completed manufacturing costs, and settled failed-batch losses are separate categories with different recognition bases. |
| Profitability | Operational payment-based realized profitability; product/recipe direct profit excludes shared company overhead. |

- Outstanding retains its current invoice-date selection behavior. Label the filter `Invoice date range` and the balance `Current outstanding`. Older invoices are excluded by that filter. Do not imply an as-of report.
- Expenses must not present the sum of finance spending and production cost as an accounting expense total: inventory purchases can overlap with production costs. Remove the displayed `Grand Total`; retain the separate category totals and their explanations.
- Correct the Expenses `Budget/Pack` column: the current server selection supplies actual cost, not a budget. Do not display actual cost under a budget label. Remove the duplicate column unless a genuine persisted budget source is established during implementation.
- Do not relabel zero as missing. Show `0.00` for known zero amounts and an em dash with explanatory context only for unavailable values.

### R3. Monetary precision and totals

- Report financial tables, summary amounts, print output, and existing CSV exports show two decimal places with grouping. State `Currency: PKR` in report metadata. Avoid compact K/L/Cr notation in financial tables and report totals.
- Compact chart-axis labels may remain, provided tooltips and associated figures show precise values.
- Scope formatting changes to reports; do not change the global default for unrelated dashboards.
- Keep stored amounts and existing accounting calculations as the source of truth. Do not round every intermediate calculation merely to match display formatting.
- Add numeric totals to additive money columns where the table contains all contributing records. Label non-additive rates, ratios, and current costs appropriately; do not sum them.
- Where displayed rounded components differ from a stored total, disclose the rounding difference instead of changing stored figures. Negative values remain visible and understandable in monochrome.

### R4. Complete salary explanations

- Read earnings and deductions from persisted payslip snapshots, including `allowanceBreakdown`, commission, night-shift allowance, and existing deduction components.
- Use a compact employee summary table: employee/code, payroll month, gross, deductions, net, and arrears where applicable.
- Provide a second detail section per employee with named earnings and deductions. Include all nonzero components and basic salary. Explicitly avoid counting night-shift allowance twice if it also appears in the allowance snapshot.
- Keep gross, deductions, and net as stored. Surface a labelled reconciliation difference if historical components do not reconcile; never silently invent earnings or deductions.
- Show arrears separately from current-period net salary. Explain their persisted meaning before combining any amounts.
- Layout must not solve completeness by extending the existing 13-column table into an unreadable wider table.

### R5. Applied filters, errors, and generation state

- Distinguish draft filters from applied filters. The report title, basis, source, dates, totals, and exports must all describe the same successfully loaded dataset.
- Disable print/PDF while a report is loading, has unapplied filter changes, or has a failed refresh. Keep error messages distinct from legitimate empty results and provide Retry.
- Re-generating an unchanged range must refresh the data, not merely reuse the same query key without a fetch.
- Capture generation metadata when data successfully loads. Do not produce a new generation time on every render or every print click.
- Legitimate empty reports may be printed with their metadata and an explicit `No records for this selection` message. Failed requests must never become printable zero reports.
- Controls have labels and visible keyboard focus; status changes are accessible. Keep existing report permissions on server functions.

### R6. Shared document metadata

Every printed report includes:

- Report title and company/product/recipe scope as applicable.
- Applied period, explicitly labelled according to the report's date basis.
- Applied invoice source where supported, including `All invoices`.
- Generation date and time in Pakistan time, labelled `PKT`.
- Currency and short report-basis statement.
- A readable incompleteness notice when unposted offline invoices are known to exist. A failed status check must not imply that all invoices are posted.

Reuse a verified company identity if one exists. The repository currently contains conflicting hard-coded names in unrelated documents. Do not select one as the legal company name by guesswork. Use `Titan ERP` as the application identity until a verified company identity is available, without inventing an address, tax number, or logo. This fallback does not block the other improvements.

Prepared/approved signature areas may remain where useful, together on a page. Blank signature lines must not imply that a report is approved.

### R7. Print and browser PDF layout

- Use one shared print stylesheet scoped to report content. Remove conflicting global report print rules. Print only the report document, not application navigation, controls, overlays, or tooltips.
- Use A4 landscape for wide tabular reports with 10–12 mm margins. Body/table text is at least 9pt; metadata/footer text is at least 8pt. Do not shrink tables to fit at the expense of these sizes.
- Split wide content into related tables or structured detail blocks. Use deliberate column widths; allow names and descriptions to wrap; keep amounts right-aligned with tabular digits. Column headers align with their data.
- Repeat table headers across pages. Avoid breaking normal rows, separating section headings from their first row, and separating totals from their label. Allow long sections and oversized content to paginate rather than forcing entire tables onto one page.
- Reset application scroll containers, fixed heights, and overflow constraints for print. No omitted rows caused by screen pagination, clipping, or scroll areas.
- Use white backgrounds, dark text, restrained rules, and labels that remain clear in grayscale. Suppress decorative charts in print if their underlying data is already presented; retain useful charts only when readable.
- Use browser-supported page numbering with a footer containing report identity. Document page-number limitations for other browsers rather than promise identical pagination everywhere.
- Provide consistent `Print` and `Save as PDF` actions. The PDF action explains before opening printing that the user should select `Save as PDF`. Do not describe this as a direct file download.
- Existing CSV exports must describe the same applied date/source scope and precision as their report. Creating CSV exporters for reports that do not already have them is outside this change.

## Acceptance tests and evidence

| ID | Scenario | Required result |
| --- | --- | --- |
| A1 | Same-day Pakistan selection under UTC and Pakistan server timezones | Identical UTC boundaries; first/last instants included, adjacent dates excluded. |
| A2 | Leap day, month/year rollover, reversed and impossible dates | Valid ranges normalize correctly; invalid ranges produce validation errors. |
| A3 | Previous month/custom comparison and trend dates | Labels and buckets follow Pakistan calendar dates without changing comparison length. |
| A4 | Old unpaid invoice and invoice in selected range | Only the selected invoice cohort appears; current-balance explanation appears on screen and print. |
| A5 | Values such as 1234.56, 0, and -10.25 | Two decimals, correct grouping/sign, no compact notation, zero is not missing. |
| A6 | Payslip with commission, allowance snapshot, night shift, deductions, and arrears | All components visible once, stored totals retained, discrepancies explained. |
| A7 | Change filters, failed fetch, empty fetch, regenerate unchanged filters | Applied metadata stays consistent; failures are not empty reports; unchanged regeneration refetches. |
| A8 | Online/offline/all source and pending offline invoices | Applied source and incompleteness warning survive printing/PDF. |
| A9 | At least 100 rows, long names, large and negative amounts | Multi-page A4 output has every row, readable text, repeated headers, intact totals, and no clipping. |
| A10 | Company/product/recipe reports plus existing CSV export | Dates, source scope, money precision, and profitability basis agree. |
| A11 | Expenses containing inventory purchases and manufacturing costs | Separate totals; no misleading combined expense total or actual cost labelled as budget. |

Implementation must add behavioral regression tests for date boundaries, applied-filter/error behavior, precision, and salary breakdown. Use existing report tests as additional regression coverage, not as proof of rendered PDF quality.

Run focused reporting tests, typecheck, and production build. Identify pre-existing failures separately from regressions. Visually inspect representative browser-generated PDFs for Sales, Salaries, Purchases, Expenses, Outstanding, and P&L using empty, ordinary, and multi-page fixtures. Record which browsers and artifacts were actually inspected. Missing browser access or live reconciliation evidence must be reported explicitly, not marked passed.

After code changes, run `graphify update .`. Request independent code review against this specification and resolve material findings before declaring implementation complete.

## Delivery sequence

1. Review this specification, especially current-balance semantics and browser-based PDF output.
2. Write the implementation plan with requirement-to-task mapping.
3. Add failing regression tests and correct dates, report states, precision, and salary data presentation.
4. Apply shared metadata and document styling across standard reports and P&L.
5. Verify tests, rendered output, and spec coverage; report limitations with concrete evidence.

## Spec self-review

- Existing operational P&L recognition is preserved; historical balance reconstruction is explicitly excluded.
- Report dates, transaction dates, comparison dates, and export dates share a stated timezone contract.
- Data precision and display precision are separate, with no automatic rewriting of stored money.
- Company identity has an honest fallback rather than an invented business name.
- Browser PDF functionality is explicit, with a visual acceptance requirement.
- All audit findings map to requirements and acceptance scenarios above.
