# Profit & Loss Reporting — Implementation Spec

## Audit Findings

### Current Reports Module Footprint

- Existing reports-module P&L routes already exist and must be extended, not replaced:
  - `src/routes/_protected/reports/profit-loss/index.tsx`
  - `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx`
  - `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx`
  - `src/routes/_protected/reports/profit-loss/compare/index.tsx`
- Shared UI building blocks already exist and are worth preserving:
  - `src/components/reports/profit-loss/pnl-report-primitives.tsx`
  - `src/components/reports/profit-loss/pnl-charts.tsx`
  - `src/components/reports/profit-loss/pnl-export-bar.tsx`
  - `src/components/reports/profit-loss/pnl-loading-skeleton.tsx`
- The comparison surface is also live and currently depends on the same outdated profitability assumptions:
  - `src/routes/_protected/reports/profit-loss/compare/index.tsx`
  - `src/server-functions/reports/profit-loss/comparison-fn.ts`
- The reports landing page already positions this feature as company profitability with product and recipe drill-down.
- A separate manufacturing-side product P&L implementation also exists:
  - `src/server-functions/inventory/products/get-product-profit-loss-fn.ts`
  - `src/components/recipes/product-profit-loss-view.tsx`

### What The Current Implementation Gets Right

- The existing report shell, header treatment, KPI cards, print styles, CSV export entry point, and date-range-with-explicit-apply interaction are already solid and should stay.
- The chart set is already good enough to preserve:
  - trend chart
  - margin trend chart
  - profitability chart
  - revenue-vs-cost snapshot
  - top products / top recipes bars
  - recipe performance bars
- The company report already uses actual frozen invoice-line COGS from `invoice_items.cost_of_goods_sold`.
- Invoice creation already captures WAC-based cost at sale time and freezes it onto `invoice_items.cost_of_goods_sold` and `invoice_items.cost_of_goods_sold_per_unit`.
- Product drill-down, recipe drill-down, printing, and CSV export already exist as user flows, even though the calculations are inconsistent.
- Permission enforcement is already in place through `requireReportsViewMiddleware`.

### Ground Truth: How The Current Company Report Works

- Server function: `src/server-functions/reports/profit-loss/company-pnl-fn.ts`
- Revenue is currently `SUM(invoice_items.amount)` for invoices whose status is `paid` or `partially_paid`.
- COGS is currently `SUM(invoice_items.cost_of_goods_sold)` for the same rows.
- Company deductions are currently limited to:
  - `SUM(invoices.expenses)`
  - `SUM(commission_records.commission_amount)`
  - `SUM(order_booker_trips.fuel_cost + order_booker_trips.tada_amount)`
- Net profit is currently:
  - `gross profit - invoice expenses - commissions - distribution`
- Monthly trend uses the same inputs.
- The company report excludes any invoice item with `recipeId = null`, so non-recipe-linked sales are invisible in current company profitability.

### Ground Truth: How The Current Product And Recipe Reports Work

- Shared calculation layer: `src/server-functions/reports/profit-loss/reporting-core.ts`
- Product and recipe reports do not use actual invoice-line COGS.
- Instead they estimate raw material and packaging cost from recipe master data:
  - `recipes.estimatedIngredientsCost`
  - `recipes.estimatedPackagingCost`
  - `recipes.targetUnitsPerBatch`
- The current product/recipe math is:
  - `totalRevenue = SUM(invoice_items.amount)`
  - `rawMaterialCost = soldUnits * estimated ingredient cost per unit`
  - `packagingMaterialCost = soldUnits * estimated packaging cost per unit`
  - `totalCogs = raw + packaging`
  - `grossProfit = totalRevenue - totalCogs`
  - `netProfit = grossProfit`
- The current tests explicitly lock this behavior in:
  - `src/lib/pnl-reporting.test.ts`
- Result: the company report and the product/recipe reports are already on two different cost bases.

### Confirmed Calculation And Data Problems

- Partial invoices are overstated everywhere in current P&L:
  - current queries count full `invoice_items.amount` for `partially_paid` invoices
  - they do not count only the paid portion
  - they do not allocate collected cash back to product / recipe lines
- Product and recipe reports use estimated cost, not actual WAC-frozen sold cost.
- Payroll is completely absent from the current company P&L.
- The finance `expenses` table is completely absent from the current company P&L.
- Supplier / raw-material / packaging purchase outflows are absent from the current company P&L.
- Standalone HR TA/DA reimbursements from `travel_logs` are absent from the current company P&L.
- Approved sales returns reduce invoice header totals, but current P&L queries still read original `invoice_items.amount` and `invoice_items.cost_of_goods_sold`, so returns are not reflected correctly.
- Product route recent invoices show only revenue and status, not the invoice-level profit composition.
- Recipe route has no invoice-level drill-down at all.
- Company route has no explicit top-level Profit / Loss / Break-even / No activity status block.
- Comparison route duplicates the same limited status-based revenue logic and limited deduction coverage, so it will drift further unless moved onto the shared corrected dataset.
- `src/components/reports/profit-loss/loss-warning-banner.tsx` exists but is not used by the current routes.
- `src/components/reports/profit-loss/cost-trend-chart.tsx` and `cost-trend-fn.ts` exist but are not used in the live report flow.
- CSV export currently exports invoice-line revenue / COGS only; it does not export company deductions or reconciliation logic.
- The current company page does not show a clear no-activity state when the period is all zeros; it mostly renders zero KPI cards and empty sub-sections.

### Existing Product-Level Logic That Can Be Reused

- The older manufacturing-side product P&L already uses actual `invoice_items.cost_of_goods_sold`.
- It already includes per-recipe invoice drill-down with revenue, COGS, and profit per invoice row.
- That older implementation is calculation-wise closer to the requested product/recipe report than the newer reports-module implementation.
- It still shares one major bug with the reports module: it also counts full revenue for `partially_paid` invoices instead of the paid portion.

### Revenue Sources Present In The System Today

- Initial invoice cash at invoice creation:
  - `invoices.cash`
  - mirrored as `payments.method = "invoice_cash"`
  - mirrored as finance `transactions.source = "Sale"`
- Later invoice recovery:
  - `payments.method = "cash"` or `payments.method = "bank_transfer"`
  - mirrored as finance `transactions.source = "Payment Recovery"` or `transactions.source = "Slip Recovery"`
- Non-cash settlement:
  - `payments.method = "expense_offset"`
- Invoice header totals:
  - `invoices.amount`
  - `invoices.totalPrice`
- Invoice line revenue:
  - `invoice_items.amount`
- Current reporting reads invoice headers or invoice lines, not payment records.

### Cost / Outflow Sources Present In The System Today

- Actual sold-goods cost:
  - `invoice_items.cost_of_goods_sold`
  - `invoice_items.cost_of_goods_sold_per_unit`
- Manual / general finance expenses:
  - `expenses`
- Supplier and raw-material / packaging purchase cash outflows:
  - `purchase_records`
  - `supplier_payments`
  - mirrored into finance `expenses` with category `Supplier Purchase`
- Payroll:
  - `payrolls`
  - `payslips`
  - wallet debits in finance `transactions`
- Commissions:
  - `commission_records`
  - also snapshotted into `payslips.commission_amount`
- TA/DA and distribution:
  - `order_booker_trips.fuel_cost`
  - `order_booker_trips.tada_amount`
  - `travel_logs.total_amount` when reimbursed through the standalone reimbursement flow
  - TA/DA can also be folded into payroll incentives during payslip generation
- Invoice-specific overhead:
  - `invoices.expenses`
- Non-P&L wallet movements also present in finance:
  - `Opening Balance`
  - `Manual Adjustment`
  - `Advance Payment`
  - `Sale Reversal`

### Finance Reconciliation Conclusion

- The finance module’s primary “account balance” surface is the sum of `wallets.balance`.
- That is a cash / bank position, not a general-ledger P&L balance.
- Exact equality between operational net profit and wallet balance is not mathematically correct under the current model because wallet balance also includes:
  - opening balances
  - manual deposits / adjustments
  - salary advances
  - inventory purchases that later become COGS
  - timing differences between shipment, collection, and reimbursement
- To satisfy the user intent without producing bad accounting, implementation must provide:
  - an operational P&L number
  - a mandatory finance reconciliation section that ties that operational result to finance wallet movement / balance for the same period
- Raw-material purchase cash outflows must not be added into net profit if WAC-based sold COGS is also included; that would double count the same underlying cost.
- Raw-material purchase cash outflows do still belong in the reconciliation layer because they explain finance balance movement.

### Payroll / Commission / TA-DA Specific Audit Risks

- Payroll wallet debits are real finance outflows, but payroll does not currently create finance `expenses` rows.
- Commission records are marked `paid` and linked to payslips when payroll is generated for linked order bookers.
- HR travel logs are not marked reimbursed when their TA/DA amount is folded into payroll.
- That means current standalone TA/DA reporting can double count or miss payroll-paid TA/DA unless the payroll flow is tightened.
- Separate reporting buckets for Payroll, Commission, and TA/DA are therefore not fully reliable today without improving the payout classification trail.

## Phase 1 — Company-Wide P&L Report (Extend Existing)

### Objective

Build a company-wide profitability report that preserves the current reports-module UI but replaces the limited calculation layer with a unified, traceable company P&L plus finance reconciliation view.

### What's Being Kept From Current Implementation

- `src/routes/_protected/reports/profit-loss/index.tsx` as the base route and screen composition.
- `src/components/reports/profit-loss/pnl-report-primitives.tsx` as the shared layout system.
- `src/components/reports/profit-loss/pnl-charts.tsx` as the chart library and visual language.
- Existing date-range default behavior:
  - default current month
  - explicit Apply button
- Existing print and export affordances.
- Existing company-to-product drill-down table structure.

### What's Being Fixed / Added

- Replace status-based revenue logic with payment-based realized revenue logic.
- Add a mandatory top-level status indicator:
  - `Profit`
  - `Loss`
  - `Break-even`
  - `No activity`
- Replace the current “Business Deductions” logic with full operating-expense coverage:
  - payroll
  - commissions
  - TA/DA
  - manual / finance expenses
  - any other true operating expense category present in finance
- Add a finance reconciliation section so report figures tie back to finance wallet balance movement.
- Include approved returns / credit-note effects.
- Include an explicit `Unmapped Sales` bucket for company sales rows that have no recipe linkage instead of silently dropping them.
- Add a clear no-activity state instead of a zero-heavy dashboard when both revenue and expense activity are absent.
- Extend export so company deductions and reconciliation are exportable, not only invoice-line gross profit.
- Move the comparison report onto the same corrected company dataset, or explicitly hide it until it is aligned.

### Data Sources & Calculation Logic

- Introduce one shared reporting data layer for realized profitability.
- Revenue source:
  - `payments`
  - include `invoice_cash`, `cash`, `bank_transfer`, and `expense_offset`
  - exclude draft / saved / voided invoices that have no realized collection
- Partial-payment allocation:
  - because there is no payment-to-line allocation table today, use proportional allocation by each invoice line’s share of the invoice’s adjusted net amount
  - `realized ratio = recovered amount / adjusted invoice total`, capped to `0..1`
  - `realized line revenue = adjusted line revenue * realized ratio`
  - `realized line COGS = adjusted line COGS * realized ratio`
- Return handling:
  - use `sales_returns` and `sales_return_items` to reduce invoice-line revenue, units, and COGS before applying realized allocation
  - do not rely only on invoice header totals
- COGS source:
  - always `invoice_items.cost_of_goods_sold`
  - never recipe estimates for company P&L
- Payroll bucket:
  - derive from paid or approved payroll depending on finalized business rule
  - payroll must not double count commission or TA/DA amounts that are reported separately
  - implementation will likely require a payroll payout classification snapshot so those subcomponents are durable and reportable
- Commission bucket:
  - use `commission_records` when paid
  - include payroll-linked commission payouts without also counting them again inside payroll
- TA/DA bucket:
  - include standalone travel-log reimbursements
  - include order-booker trip TA/DA
  - include payroll-paid TA/DA only once
  - implementation must tighten payroll-to-travel-log linkage so payroll-paid TA/DA is marked as reimbursed
- General expense bucket:
  - use finance `expenses`
  - include manual categories and expense-offset-backed expenses
  - exclude capitalized inventory-purchase expenses from net profit
- Finance reconciliation:
  - show how operational net profit ties to finance balance movement
  - separately list non-P&L movements such as opening balances, manual adjustments, salary advances, and capitalized inventory purchases
  - do not force operational net profit itself to equal wallet balance

### Files to Create / Modify

- Modify `src/server-functions/reports/profit-loss/company-pnl-fn.ts`
- Modify `src/server-functions/reports/profit-loss/comparison-fn.ts`
- Modify `src/server-functions/reports/profit-loss/reporting-core.ts`
- Modify `src/server-functions/reports/profit-loss/reporting-math.ts`
- Create a new shared realized-allocation helper under `src/server-functions/reports/profit-loss/`
- Modify `src/server-functions/reports/profit-loss/export-csv-fn.ts`
- Modify `src/routes/_protected/reports/profit-loss/index.tsx`
- Modify `src/routes/_protected/reports/profit-loss/compare/index.tsx`
- Modify `src/components/reports/profit-loss/pnl-report-primitives.tsx`
- Optionally add a dedicated reconciliation helper / server function under `src/server-functions/reports/profit-loss/`
- Modify payroll payout source files if required for reliable payroll / commission / TA/DA separation:
  - `src/server-functions/hr/payroll/core.ts`
  - `src/db/schemas/hr-schema.ts`
  - `src/db/migrations/*`
- Expand tests:
  - `src/lib/pnl-reporting.test.ts`
  - add new realized-revenue / reconciliation tests

### Acceptance Criteria

- Company report revenue counts only collected / settled value, not the full face value of partially paid invoices.
- Company report COGS is based on actual frozen invoice-line sold cost, not recipe estimates.
- Company report includes payroll, commissions, TA/DA, and finance expenses without double counting.
- Approved returns reduce reported revenue, units, and COGS.
- Non-recipe-linked sales are visible in the company report through an explicit fallback bucket.
- Top of screen shows an unambiguous status:
  - Profit
  - Loss
  - Break-even
  - No activity
- Every company number is drillable or traceable to its source records.
- The report includes a reconciliation section that explains any difference between operational net profit and finance wallet balance movement.
- Export output contains the same company-wide logic shown on screen.
- If the comparison route remains visible, it uses the exact same realized-revenue, returns, and expense logic as the company report.

## Phase 2 — Product & Recipe-Level P&L Report (Extend Existing)

### Objective

Extend the existing reports-module product and recipe screens so they use the same realized revenue and actual sold-cost foundation as the company report, while preserving the current visual structure and drill-down flow.

### What's Being Kept From Current Implementation

- `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx`
- `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx`
- Existing chart layout and section composition
- Existing product-to-recipe navigation flow
- Existing date-range apply interaction

### What's Being Fixed / Added

- Remove estimate-based cost logic from reports-module product / recipe P&L.
- Reuse actual invoice-line COGS instead.
- Reuse the same partial-payment allocation logic from Phase 1.
- Add explicit Profit / Loss / Break-even / No activity status at product and recipe level.
- Add full invoice composition tables:
  - realized revenue
  - realized COGS
  - realized profit
  - payment / recovery status
  - return adjustments where applicable
- Keep drill-down order:
  - company
  - product
  - recipe
  - invoice detail / invoice source rows
- Replace misleading `Net Profit = Gross Profit` wording on product and recipe screens.
- Rename product / recipe profitability wording to `Direct Profit` if no shared-overhead allocation model is implemented in this phase.

### Data Sources & Calculation Logic

- Replace `reporting-core.ts` estimate math with actual invoice-line logic.
- Shared base dataset:
  - adjusted invoice lines after approved returns
  - realized revenue allocation from payments
  - actual line COGS from `invoice_items.cost_of_goods_sold`
- Product roll-up:
  - aggregate all recipes under the product
- Recipe roll-up:
  - aggregate only the selected recipe
- Product / recipe reports should not invent arbitrary payroll / admin overhead allocations.
- Unless a formal allocation model is introduced later, product and recipe views will report direct profitability from sold goods only.
- Use the older manufacturing-side product P&L implementation as the closest calculation baseline for invoice drill-down, but move that logic into the reports-module shared reporting layer so company, product, and recipe all agree.

### Files to Create / Modify

- Modify `src/server-functions/reports/profit-loss/product-pnl-for-reports-fn.ts`
- Modify `src/server-functions/reports/profit-loss/recipe-pnl-fn.ts`
- Modify `src/server-functions/reports/profit-loss/reporting-core.ts`
- Modify `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx`
- Modify `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx`
- Reuse logic from:
  - `src/server-functions/inventory/products/get-product-profit-loss-fn.ts`
  - `src/components/recipes/product-profit-loss-view.tsx`
- Add or extend invoice-detail / drill-down helpers as needed under `src/server-functions/reports/profit-loss/`
- Expand tests in `src/lib/pnl-reporting.test.ts`

### Acceptance Criteria

- Product and recipe reports use actual sold cost, not recipe estimate math.
- Product and recipe revenue counts only realized collected / settled value.
- Product summary equals the sum of its recipe summaries.
- Product and recipe statuses are explicit:
  - Profit
  - Loss
  - Break-even
  - No activity
- Product screen can drill into recipes and invoice rows that explain the number.
- Recipe screen can drill into invoice rows that explain the number.
- Returned quantities and revenue reductions are reflected correctly.
- Product and recipe screens no longer present fake `net profit` labels when no company-overhead allocation exists.

## Phase 3 — Terminology Tutorial Dialog

### Objective

Add an on-demand terminology dialog that uses `src/components/custom/responsive-dialog.tsx`, is accessible from a small help icon near the report headers, and explains only the terms that actually appear in the final built reports.

### Final Term List & Plain-Language Copy

- `Collected Revenue`
  - Money the company has actually received or settled from invoices in the selected period.
- `Cost of Goods Sold (COGS)`
  - What the sold products actually cost the company to make, based on the cost saved on the invoice lines.
- `Gross Profit`
  - Collected revenue minus the cost of the products sold.
- `Operating Expenses`
  - Business spending outside product cost, such as payroll, commissions, TA/DA, utilities, and other approved expenses.
- `Net Profit`
  - What is left after gross profit minus operating expenses.
- `Direct Profit`
  - Product or recipe profit before shared company overhead is allocated.
- `Payroll`
  - Salary and wages paid to employees for the selected period.
- `Commission`
  - Sales payout earned by staff for orders or sales.
- `TA/DA`
  - Travel and daily-allowance payments made for business trips.
- `General Expenses`
  - Other approved business spending recorded in finance.
- `Return Adjustment`
  - Sales value and cost removed because products were returned.
- `Reconciliation`
  - The explanation of why profit and finance account balance movement do or do not match exactly.

### Files to Create / Modify

- Create `src/components/reports/profit-loss/pnl-terminology-dialog.tsx`
- Modify `src/components/reports/profit-loss/pnl-report-primitives.tsx`
- Modify:
  - `src/routes/_protected/reports/profit-loss/index.tsx`
  - `src/routes/_protected/reports/profit-loss/product/$productId/index.tsx`
  - `src/routes/_protected/reports/profit-loss/recipe/$recipeId/index.tsx`
- Use existing base component:
  - `src/components/custom/responsive-dialog.tsx`

### Acceptance Criteria

- Help icon is visible near the report headers and is not forced open automatically.
- Dialog works on desktop and mobile through the existing responsive dialog wrapper.
- Dialog contains only terms that are present in the final report UI.
- Copy is plain-language and avoids accounting jargon where a simpler term is possible.
- Terms stay aligned with the actual labels rendered by the reports.

## Phase 4 — Production Hardening & Edge Cases

### Edge Case Checklist

- Zero revenue and zero expenses:
  - show `No activity`
  - no NaN
  - no misleading positive / negative state
- Expenses but no sales:
  - show a clear loss
  - still render traceable expense breakdown
- Partially paid invoice:
  - count only recovered / settled portion as revenue
  - apply the same realization ratio to line-level drill-down
- Approved sales returns:
  - reduce revenue, units, and COGS correctly
- Mid-period WAC change:
  - use frozen invoice-line COGS
  - do not recalculate using today’s stock cost
- Payroll-paid commission:
  - counted once
  - not also counted as standalone commission expense again
- Payroll-paid TA/DA:
  - counted once
  - standalone travel-log reimbursement screen must not re-count the same payout
- Manual finance expense:
  - appears in company operating expenses when it is a true operating expense
- Supplier purchase / raw-material payment:
  - visible in reconciliation
  - excluded from net profit if the same value later flows through WAC COGS
- Opening balance / deposit / manual adjustment / salary advance:
  - excluded from net profit
  - visible in reconciliation if they explain balance movement
- Non-recipe-linked invoice lines:
  - visible in company report fallback bucket
  - flagged for cleanup, not silently discarded
- Negative finance balance period:
  - report remains internally consistent
  - reconciliation explains the negative position
- Traceability:
  - every displayed total can be explained from lower-level rows

### Acceptance Criteria

- No P&L screen shows NaN, divide-by-zero artifacts, or mathematically impossible percentages.
- Company, product, and recipe reports all agree on realized revenue and actual sold-cost rules.
- Returns, partial collections, and cost changes are reflected consistently in every level of the report.
- Finance reconciliation is deterministic and explainable from persisted source records.
- Test coverage exists for:
  - zero activity
  - expenses without sales
  - partial invoices
  - approved returns
  - WAC changes over time
  - payroll / commission / TA-DA double-count prevention
  - reconciliation-only balance events
