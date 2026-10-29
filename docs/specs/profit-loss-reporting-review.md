# Profit & Loss Reporting Review

Date: 2026-06-26

## Findings

### 1. High — current-period cash recoveries for older invoices never enter the P&L totals

- Files:
  - `src/server-functions/reports/profit-loss/company-reporting-core.ts:421-458`
  - `src/server-functions/reports/profit-loss/company-reporting-core.ts:662-710`
  - `src/server-functions/reports/profit-loss/company-reporting-core.ts:1217-1228`
  - `src/server-functions/reports/profit-loss/reporting-core.ts:221-245`
  - `src/server-functions/reports/profit-loss/reporting-core.ts:372-380`
- `loadContext()` only loads invoice lines whose `invoices.date` is inside the selected range. `buildSnapshot()` then computes realized revenue from payments up to `range.toDate`, but only for those preloaded invoice lines.
- That means a payment recovered this month for an invoice issued last month is excluded from:
  - company-wide revenue/COGS/profit
  - product summaries
  - recipe summaries
  - recipe invoice drill-down
  - monthly trend buckets
- The same limitation applies to approved returns on older invoices, because returns are only loaded for the same invoice ID set.
- This conflicts with the stated requirement that the report answer "Is the company in profit or loss right now?" using realized revenue from paid and partial invoices.
- Recommended fix:
  - decouple realized-revenue recognition from invoice issue date
  - load invoice/payment/return data by payment-effective window, or otherwise include older invoices that receive payment/return activity inside the selected period
  - then reuse that same corrected snapshot for company, product, recipe, trend, and drill-down paths

### 2. High — TA/DA is loaded by trip date, so reimbursed or payroll-paid older trips can be omitted from operating expenses

- Files:
  - `src/server-functions/reports/profit-loss/company-reporting-core.ts:571-583`
  - `src/server-functions/reports/profit-loss/company-reporting-core.ts:866-913`
  - `src/server-functions/hr/payroll/core.ts:244-260`
- `loadContext()` fetches `travelLogs` only where `travelLogs.date` is between the report's `fromDate` and `toDate`.
- Later, `buildSnapshot()` treats TA/DA as a paid expense when either:
  - the log is attached to a paid payslip for the payroll period, or
  - `reimbursedAt` falls inside the selected range
- Those two rules are date-of-payment rules, not date-of-trip rules. A common case is "June payroll pays May trips." Those May logs will not be present in `context.travelLogs` for a June report, so June TA/DA expense is understated.
- The standalone reimbursement path has the same bug: a trip dated before the report window but reimbursed inside the window is filtered out before `reimbursedAt` is even checked.
- Recommended fix:
  - preload travel logs by the dates that can make them payable in the report
  - at minimum, include logs tied to in-range payroll periods plus logs with `reimbursedAt` inside the range

### 3. Medium — product and recipe CSV export bypasses Phase 2 realized-reporting logic

- Files:
  - `src/server-functions/reports/profit-loss/export-csv-fn.ts:124-212`
  - `src/components/reports/profit-loss/pnl-export-bar.tsx:36-54`
  - `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx:191-198`
  - `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx:602-607`
- The company-wide CSV path correctly calls `getCompanyReportData()`.
- The product/recipe CSV path does not. It runs a separate raw invoice query filtered by:
  - `invoices.status in ("paid", "partially_paid")`
  - `invoices.date` in range
- That export uses full `invoiceItems.amount` and full `invoiceItems.costOfGoodsSold`, so it ignores:
  - partial-payment realization ratios
  - approved return adjustments
  - the shared snapshot logic used by the Phase 2 screens
- Result: exported product/recipe numbers can disagree with the on-screen report the admin just viewed.
- Recommended fix:
  - drive scoped CSV export from the same snapshot helpers used by `getProductProfitLossForReportsFn()` and `getRecipeProfitLossFn()`
  - add parity tests that compare exported totals with rendered report totals

## Resolved Since Prior Pass

- The stale `/compare` route reference is gone.
- The terminology dialog no longer includes the previously stale `Return Adjustment` entry.
- Failed-batch chemical loss now has a traceable non-cash expense path and reconciliation add-back.
- Product and recipe reports now surface failed-batch chemical loss separately instead of hiding it inside WAC or misclassifying loss-only periods as `No activity`.

## Open Questions

- Should realized revenue be recognized by payment date, or by invoice date with a partial-collection ratio snapshot? The current code mixes both concepts. That decision needs to be explicit before the Phase 1/company logic is considered final.
- For finance reconciliation, is a generic `Remaining Timing Difference` row acceptable, or is the target a fully explained zero-difference bridge with no residual catch-all?

## Testing Gaps

- I ran `bun run test -- src/lib/pnl-reporting.test.ts` and it passed: 35/35.
- The current tests are useful, but they do not cover the bugs above.
- Missing coverage:
  - payment recovery for an invoice issued before the selected report range
  - approved return on an invoice issued before the selected report range
  - TA/DA reimbursed in-range for a trip dated before the range
  - TA/DA paid through an in-range payroll whose payroll period starts before the range
  - product/recipe CSV export parity with the on-screen Phase 2 totals

## Brief Summary

- The implementation reuse is directionally good: Phase 2 correctly moved product and recipe reporting onto the shared realized snapshot, and Phase 3/4 UI hardening is mostly wired as intended.
- The remaining issues are not visual; they are timing and data-source correctness problems in the shared reporting core and the scoped export path.
