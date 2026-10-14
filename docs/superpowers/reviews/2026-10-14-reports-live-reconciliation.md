# Report reconciliation against the configured database

Completed 14 October 2026. Result: **62 checks passed, no mismatches, with material data-coverage limits.**

## Database and method

- Target: configured local application database `main` at `localhost:5433`. This is not a production endpoint.
- PostgreSQL timezone: UTC. Reporting dates: Asia/Karachi.
- The final audit ran in one `REPEATABLE READ READ ONLY` transaction, with PostgreSQL read-only mode enforced on the connection and the application pool limited to one connection.
- Actual validated report handler bodies and accounting calculations executed against the real database. The audit substituted only the TanStack transport wrapper and auth middleware loading. HTTP/session/RBAC behavior was not re-tested by this internal database audit.
- Purchase output was compared with independent half-open SQL date predicates and decimal sums. Checked record IDs, row values, counts, total cost, paid amounts, outstanding amounts, each populated Pakistan purchase day, and an empty day before the first purchase.
- No data was seeded, changed, deleted, or migrated. The transaction ended with `ROLLBACK`.

## Results

Available purchase period: **7–12 October 2026**.

| Purchase measure | Database and report | Difference |
| --- | ---: | ---: |
| Records | 28 | 0 |
| Total cost | PKR 141,245,150.00 | PKR 0.00 |
| Paid amount | PKR 0.00 | PKR 0.00 |
| Outstanding | PKR 141,245,150.00 | PKR 0.00 |

All purchase rows retained their stored quantity, unit cost, total cost and paid amount. No invalid payment balances were found. Every stored cost agreed with quantity multiplied by stored unit cost, rounded to two decimals.

| Report area | Available financial data | Verified result |
| --- | --- | --- |
| Purchases | 28 purchase records, 5 suppliers | Nonzero amounts and complete record coverage reconcile. |
| Sales | 0 invoices, 0 invoice items | All/online/offline reports return zero rows and revenue. |
| Collections | 0 payments | All/online/offline reports return zero confirmed/pending/exception rows and amounts. |
| Outstanding | 0 slips | All/online/offline reports return zero rows and outstanding. |
| Salaries | 0 payrolls, payslips or employees | Empty result and zero net salary. |
| Expenses | 0 finance expenses, completed packaging allocations or failed losses | Empty result and zero separate category totals. |
| Company profitability | No sales, payroll, operating expenses or wallet transactions | All/online/offline report zero revenue/profit and `no_activity`. |
| Wallet reconciliation | 0 wallets and transactions | Current balance, period movement and bridge difference are zero. |
| Product/recipe profitability | Checked the 1 available product and 2 available recipes | Zero net impact, consistent with no financial activity. |

Unpaid inventory purchases correctly do not create operating profit, operating expense or wallet movement in this dataset.

## Limits and remaining evidence

This is a successful reconciliation of the available local data, not a certification of production financial records. Nonzero sales, partial payments, returns, payroll/arrears, commissions, failed losses and wallet movements cannot be reconciled here because those records do not exist in the configured database. Their prior automated fixture tests remain separate evidence.

Completing nonzero reconciliation for those areas requires a populated business database connection or a consistent copy of that database. Do not replace the missing evidence by adding synthetic transactions to this database.

## Audit artifacts

Preserved under `.superpowers/sdd/2026-10-13-reports-accuracy-print/verification/`:

- `live-database-reconciliation.json`: exact initial source table counts and direct financial totals.
- `live-report-reconciliation.json`: snapshot metadata, all 62 comparisons, results and coverage limits.
- `live-reconcile.ts`: executable read-only audit of actual validated handlers.
- `live-reconcile.log`: concise execution result.

Re-run from the project root with `bun .superpowers/sdd/2026-10-13-reports-accuracy-print/verification/live-reconcile.ts`. It uses the configured `DATABASE_URL`, enforces read-only access, and writes only local audit artifacts.
