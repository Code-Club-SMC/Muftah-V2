# Two phase production audit and repair tracker

Source: [Revised Design (v2)](./Two-Phase%20Production%20System%20%E2%80%94%20Revised%20Design%20(v2).md). Baseline audit: 2026-09-29, current uncommitted worktree. The baseline build failed on two deleted production sheet imports. Typecheck reported 157 errors after route generation.

## Scope decision

The project is in testing. Per the owner's 2026-09-29 direction, preserving, migrating, or displaying legacy production data is **out of scope**. Existing broken links, compilation failures, and code that affects current manufacturing, cartons, stock, sales, or reports remain in scope. This scope decision is not a completed checklist item.

## Completion rule

Check an item only after its stated behavior is implemented, its connected callers are reviewed, and focused verification passes. Passing a compiler gate alone does not prove stock or accounting behavior. Leave an item unchecked if database or end to end evidence needed for confidence is unavailable. Record the evidence beside any checkmark.

## Findings

- [x] **A01 Build and type contracts.** Removed deleted production imports, obsolete routes and hooks, and repaired current contracts. Evidence: the final October 6 build and typecheck passed; build regenerated the current route tree.
- [x] **A02 Database model and migration.** Drizzle and SQL align for current formulas, mixing, allocations, cartons, WAC, lab reports and recovery. Evidence: October 6 clean migration/relation check passed, and schema generation found no changes.
- [x] **A03 Carton dispatch accounting.** Allocation dispatch and returns use dedicated allocation references. Evidence: October 6 production and invoice suites passed full/partial dispatch, edit/delete reversal, returns and audit/ledger checks.
- [x] **A04 Manufacturing UI contracts.** Current formula, mixing, allocation and operator payloads, lists, consoles, cache updates and routes are connected. Evidence: October 6 focused component/hook/read checks, typecheck and route-generating build passed, under the owner's no-browser ruling.
- [x] **A05 Operator authorization.** Assigned work and permitted output/completion actions remain server enforced. Evidence: real middleware/RBAC checks, assigned-reader checks and PostgreSQL assignment/lifecycle checks passed.
- [x] **A06 Allocation invariants.** Completed mixing, active matching recipes, compatible units, usable targets, available bulk and untouched cancellation are enforced. Evidence: boundary and independent-connection allocation checks passed in the October 6 production suite.
- [x] **A07 Packaging progress and cancellation.** Target/stock caps, material tracking, completion and cancellation preserve atomic stock accounting. Evidence: October 6 lifecycle, shortfall and rollback checks passed.
- [x] **A08 Finished goods and WAC.** Completion receipts, canonical quantities, cartons, recorded currency value, WAC, sales and returns reconcile. Evidence: October 6 production, invoice, transfer and integrity suites passed, including fractional/zero-cost and repeated-receipt cases.
- [x] **A09 Mixing lifecycle.** Active definitions/warehouses, batch sequence, stock, yield caps, completion and shortfalls are enforced. Evidence: lifecycle, independent-connection debit/batch checks and batch-ID unit checks passed.
- [x] **A10 Current module integration.** Cartons, inventory, sales, dashboard, navigation, reports and recipe actions use current entities and routes. Evidence: actual query/handler checks, focused UI/read checks and final compiler gates passed.
- [x] **A11 Quality control and chemical recovery.** QC attaches to mixing, and failed-run recovery preserves stock and recorded loss value. Evidence: October 6 QC relations/assignment, recovery limits/costs and expense/profit-loss query checks passed.

All broad findings are closed against the evidence in **Completion — 2026-10-06** below. This is completion of the repair plan within the stated scope, not a claim that the repository's unrelated test suite is green.

## Verification log

- 2026-09-29: Baseline `bun run build` failed on imports of deleted `../productions/initiate-production-sheet` from recipe card and detail components.
- 2026-09-29: Baseline `bun run typecheck` failed with 157 errors after route generation. The generated route tree was restored to its original worktree state after the audit.
- 2026-09-29: Repaired tree passed `bun run typecheck` and `bun run build`; A01 checked.
- 2026-09-29: Migrations 0000–0010 applied successfully to isolated local database `titan_two_phase_audit_20260929`. A02 remains open pending schema drift and relation checks.

## Repairs and evidence — 2026-10-01

The broad findings above remain open until all of their verification requirements pass. The checks below cover only the specific behaviors named.

- [x] Recovery aggregates repeated chemical deductions and weights their recorded costs. A database regression reproduced 2 kg reported instead of 5 kg; the corrected result is 5 kg at PKR 16/kg.
- [x] Packaging quantity conversion accepts the recipe form's `L` unit and calculates decimal targets without losing a pack to binary rounding. Six focused quantity and batch ID unit tests passed.
- [x] The tested mixing/packaging path enforces assignment, output limits, shortfall reasons, cancellation restrictions and bulk release, and rolls back progress and prior debits when another packaging material is insufficient. A real PostgreSQL lifecycle test passed with all fixtures rolled back.
- [x] Completion receives full and partial cartons once, records their opening ledger entries, rejects duplicate completion, and blends different receipt costs. The database check reconciled 8 packs and PKR 124 of inventory at WAC 15.5.
- [x] Sales availability does not count partial carton contents twice. A real invoice regression reproduced sale of 7 packs after 6 were produced; the repair rejects that sale and records a valid unit dispatch in both stock and the carton ledger.
- [x] Tested good and damaged sales returns keep same-warehouse full/partial carton quantities, source references, inventory value and cumulative return limits aligned. PostgreSQL checks cover unit/full-carton dispatch, partial good returns, remaining damaged returns, duplicate approval and excess-return rejection.
- [x] Bulk/carton adjustments, transfers, stock counts and integrity checks reconcile quantities/value. Completed by the October 6 production, transfer and integrity checks.
- [x] Formula/recipe edit guards, operator cache invalidation, QC permissions and report/query boundaries have focused evidence in the October 6 component/middleware and production checks.

### Implementation decisions

- Finished goods become sellable at allocation completion, together with WAC and carton receipt. This intentionally changes v2's progress-time stock credit: crediting loose stock before its carton ledger and cost exist allowed inconsistent availability and valuation.
- A zero-output mixing run must fail instead of completing with unusable bulk and zero unit cost. A run with recorded output must complete with a shortfall instead of failing and bypassing chemical costing.
- Packaging recipes with non-cancelled allocations cannot be redefined; create a new recipe for a changed packaging definition. Active mixing work prevents formula edits. These guards prevent live definitions from changing stored targets or the interpretation of existing stock.

### Current verification

- Migrations 0000–0014 applied to isolated `titan_two_phase_audit_test` in `titan-new-postgres-1`. Application database `main` was not migrated or modified by the audit tests.
- Schema generation reported no further changes after 0014.
- Build passed. Typecheck passed after updating nullable mixing recovery references in scoped profit/loss reports; both will be rerun after the remaining repairs.
- Fourteen focused PostgreSQL scenarios now pass, including independent-connection allocation, chemical-debit, batch-number and receipt checks. Most fixtures roll back; the concurrency fixture is committed for other connections to see, then deleted by its own IDs. HTTP/session transport is bypassed in this suite. Separate real middleware callbacks and RBAC route checks pass.
- Graph update succeeded with permitted execution after the repairs. The updated code graph has 6,081 nodes and 17,098 edges. HTML visualization was skipped by graphify because of its node limit.

## Independent review — 2026-10-01

Read-only review confirmed the following current-flow problems. Legacy-data preservation remains out of scope.

- [x] Offline signed invoices preserve live WAC when valuing remaining stock. Reproduced PKR 30 instead of 39 for three remaining packs at WAC 13; PostgreSQL regression now gets 39 while the signed invoice retains its historical COGS.
- [x] Good returns for recipes without cartons preserve loose packs in the container column. PostgreSQL test verifies seven returned/remaining packs valued at 84, then a further receipt gives ten packs valued at 144 at WAC 14.4.
- [x] Bulk carton operations lock stock before sorted cartons, with per-adjustment savepoints. October 6 independent-connection close-versus-bulk, invoice-versus-bulk and multi-recipe relocation-versus-bulk checks passed.
- [x] Tested manual manufacturing returns enforce dispatch ownership, cumulative good/damaged quantity limits and destination capacity, and good returns update finished goods. PostgreSQL checks reject another order, 40 packs against a four-pack dispatch and repeated damaged returns; valid returns reconcile four packs and PKR 52 of sellable stock.
- [x] Tested allocation carton close/reopen and replacement creation use allocation records. Closing seals full cartons; reopening unseals tracking while keeping the allocation completed. PostgreSQL checks reject a second stock receipt, reject excess replacement cartons, and verify empty replacement creation adds no finished goods.
- [x] Decimal allocation sums use decimal arithmetic. PostgreSQL boundary check allocates 0.100 then 0.200 from 0.300 successfully without overreservation.
- [x] Tested packaging recipe creation derives targets from its formula and rejects zero/incompatible fill values and inconsistent carton settings. The test submits a stale batch size of 999 and receives the formula's size 10 and target 10; edit guards reject recipes with allocations and formulas with active work.

## Further connected repairs verified — 2026-10-01

- [x] Tested carton top-up, removal, count override, transfer, QC condemnation and retirement change finished goods quantities and value in the same transaction. PostgreSQL lifecycle reconciles each step down to zero packs and zero value.
- [x] Tested warehouse transfer carries source WAC into the destination. Transfer of two packs from WAC 13 into two packs at WAC 20 produces destination WAC 16.5 and value 66. Same-warehouse merge preserves quantity and value.
- [x] Physical stock counts accept entered zero, reject stale stock and duplicate approval, and atomically update carton/stock/audit records. PostgreSQL checks cover those boundaries.
- [x] Correcting a held full carton to two packs and clearing its hold restores PARTIAL, not a stale COMPLETE status. PostgreSQL hold/count/clear regression passes.
- [x] Standard carton sales reject a repacked six-pack carton for a four-pack recipe. A mixed units/cartons invoice preserves the standard full carton for its carton line and dispatches seven of twelve packs with five packs/value 65 remaining.
- [x] QC report creation attaches to mixing, preserves the product snapshot, returns its creator relation, and denies an unassigned operator reader. Real PostgreSQL insert and relation checks pass.
- [x] Failed mixing recovery enforces assignment, recovered quantity limits, one settlement and loss value. Checks recover three of five deducted kg with loss 32, and settle decimal deductions 0.300 + 0.600 as exactly 0.900 with no false over-recovery error.
- [x] Tested assignment selection requires work permissions and excludes active bans, missing roles and roles without work permissions. Expired bans are treated consistently with session authorization. Middleware and route checks allow the Operator role and run managers into current consoles.
- [x] Concurrent allocation, chemical stock and batch-number checks use separate connections: only one competing six-unit allocation succeeds from ten available units; only one competing ten-unit chemical debit succeeds; created batch numbers differ by one.
- [x] Concurrent allocation receipts blend six packs/value 80, and simultaneous completed-allocation close and bulk removal both commit, leaving five packs/value 66.67. Completed allocation carton actions use NO KEY UPDATE so their locks permit foreign-key checks from carton audit inserts.
- [x] Manual dispatch and sales-return approval share an order lock before stock locks. The deterministic independent-connection ordering check passed in the October 6 production suite.
- [x] Operator pagination/cache, integrity and dashboard/report boundaries passed component/hook and PostgreSQL checks. The owner's no-browser ruling supersedes this earlier browser-verification requirement; no visual/manual browser verification is claimed.

### Final gates for this repair pass

- `bun run typecheck`: passed.
- `bun run build`: passed after the latest invoice/carton/assignment changes.
- Focused unit/middleware/source suite: 30 tests passed across five files.
- Opt-in PostgreSQL production suite: 14 scenarios passed.
- `db:generate`: no schema changes; existing corrective migrations remain the required isolated-schema baseline.
- `graphify update .`: completed after code changes.
- Application database `main` was not migrated or used for test stock mutations. The isolated audit database retains RBAC permission catalog rows needed by its tests; committed manufacturing fixtures are removed by scoped cleanup.
- Whole-worktree whitespace checking reports existing whitespace in unrelated HR/sales changes and older production edits. This pass did not rewrite unrelated files.

## Re-audit and spec-driven repairs — 2026-10-02

The September 29 plan was **not fully verified or implemented** at the start of this pass. A02–A11 were still unchecked, and independent standards/spec reviews reproduced further gaps. Acceptance criteria are recorded in `docs/superpowers/specs/2026-10-02-two-phase-audit-completion.md`; execution is tracked in `docs/superpowers/plans/2026-10-02-two-phase-audit-completion.md`.

- [x] Manufacturing totals now sum the same rounded row costs recorded in material usage. Real PostgreSQL regressions failed before the repair and passed afterward for mixing/recovery and packaging/receipt. A further duplicate fractional BOM case reproduced 0.010 units costing 0.00 instead of 0.01; costing now uses the canonical stock-debit quantity.
- [x] Formula/mixing management and assigned mixing lists expose later pages and global searches. Creation/definition mutations refresh operator lists and embedded manufacturing data. Read-only consoles hide unauthorized actions, and denied/missing allocations show explicit states. Untouched work cancellation and formula edit/deactivation controls are accessible. Component, real QueryClient callback, and generated SQL checks pass.
- [x] Bulk entry uses decimal remaining quantities and the shared packaging target conversion. A component regression covers 0.300 minus 0.100 and displays container/carton/loose targets.
- [x] Integrity checks detect finished quantity/value drift, missing carton groups and null SKU ledger groups. The regression failed on a corrupted stock row before the fix and passes after it. Queries use one repeatable-read snapshot. Valuation comparison allows only the rounding error from four-decimal WAC plus currency precision.
- [x] Stock-only integrity results display recipe, warehouse, quantities and value. Absence of open alerts alone no longer claims validation. Four rendered component checks also show ledger-only results before persisted alert rows arrive. Completed allocation stock/cartons have a current route from the packaging list, including recipes without cartons.
- [x] Migrations 0000–0014 apply to a generated empty database ending `_test`, followed by real nested Drizzle relation inserts/reads. The temporary database is dropped in the check's cleanup. Schema generation reports no changes.
- [x] Final connected query/race evidence and combined gates are recorded in the October 6 completion section. Broad findings were closed only after the combined database and focused checks passed.

Ruling: the owner prohibits Playwright and similar browser automation. Screen evidence for this pass consists of code tracing, rendered component checks, cache callbacks, route generation, middleware/RBAC checks and PostgreSQL handlers. Visual/manual browser verification is not claimed.

Ruling: preserve existing unrelated changes and failures. The initial full suite exposed HR/attendance/settlement failures and tests referring to older migration filenames. Two production/auth source guards affected by the removed endpoint and revised operator pagination were updated to check the current contracts. No unrelated production logic was changed for those failures.

### Final endpoint review follow-up

The final read-only review found remaining current-flow paths that bypassed the production repairs: invoice edit/delete, inventory stock transfers, warehouse deactivation transfers, raw stock absolute updates, and finished inventory display totals. Acceptance criteria 9–10 cover these paths.

- [x] Invoice edit/delete reverses and redispatches stock, recorded value and allocation ledger while retaining payment/return restrictions and audit identity. All 26 actual-handler invoice scenarios passed on October 6.
- [x] Full/loose transfers and warehouse relocation conserve packs/value and allocation trace. Ordinary transfer excludes held stock; deactivation guards live work and serializes admission. All 20 transfer scenarios passed on October 6.
- [x] Raw adjustments and purchases serialize with manufacturing debits, including first receipts, stale subtraction, locked recount deltas and purchase/finance records. All 17 raw-stock scenarios passed on October 6.
- [x] Finished inventory reads retain canonical full/loose quantities. Components and low-stock queries count the six-pack full/partial fixture once. Item detail WAC is weighted by current stock quantity and recorded value; empty warehouses do not distort it. The seven initial display/read checks passed after reproducing the errors; active-factory selection checks follow warehouse relocation.
- [x] Single and multiple carton actions verify that their carton recipe/warehouse still match the stock locations locked before the carton rows. Four focused checks reject a changed location with a retry error before mutation.
- [x] Failed chemical recovery invalidates current mixing and inventory queries; warehouse relocation refreshes factory stock and warnings. Both real QueryClient regressions failed before the hook repair and passed afterward (13 mutation checks total).

### Final valuation and locking review — 2026-10-04

Independent review found edge cases that the earlier checks did not exercise. Acceptance criterion 11 records the required behavior before the repairs.

- [x] Sealed cartons are accepted by both invoice creation and editing. Explicitly recorded zero WAC remains zero through invoice creation, editing and deletion. Three actual-handler regressions failed before these repairs; the expanded invoice suite then passed 18 scenarios.
- [x] Invoice form previews count partial packs once, include partial/loose products for unit lines in both layouts, apply other lines' reservations, and reject held/sold-out selections. Recorded zero WAC remains zero in profit previews and detail profit calculations. Six new rendered/pure regressions failed before the repair and passed afterward alongside 27 existing invoice form checks. The sealed availability reader is tracked separately until its database check passes.
- [x] Transfers, cross-warehouse carton operations and relocation credit the exact recorded value debited, including the final residual from rounded WAC. The October 6 transfer regressions passed after reproducing losses in all three paths.
- [x] Splitting sealed cartons records UNSEALED. Relocating empty carton history establishes a destination zero-stock row for future receipts. Both actual-handler regressions passed on October 6.
- [x] Warehouse NO KEY UPDATE permits audit foreign-key checks while excluding manufacturing admission. Both independent-connection mutation/deactivation races passed on October 6.
- [x] Multi-recipe relocation pre-acquires all source/destination stock references in global warehouse/recipe order. The actual two-recipe/two-warehouse race reproduced a deadlock before the repair and passed afterward on October 6.
- [x] Online invoice COGS uses the recorded debit; edit/delete restores recorded value. Returns allocate cumulative recorded COGS across approvals and duplicate rows, preserving zero and final cents. Signed offline historical COGS is unchanged. All 26 invoice scenarios passed on October 6.
- [x] Further packaging receipts retain existing recorded inventory value rather than reconstructing it from rounded WAC. The regression covers 3,000 packs/value 100 followed by positive, fractional and zero-cost receipts. The full 21-scenario production PostgreSQL suite passed on October 6 after the repair.
- [x] Combined PostgreSQL and focused checks passed, build/typecheck passed, targeted independent review found no outstanding defects, and graphify was refreshed. The unrelated full-suite failures are recorded below.

## Completion — 2026-10-06

All six tasks in `docs/superpowers/plans/2026-09-29-two-phase-production-repair.md`, findings A01–A11, and acceptance criteria 1–11 in the October 2 completion spec are implemented and verified within the owner's scope decisions. The original audit was incomplete; each subsequent finding was specified and reproduced before its repair. The final closures below supersede earlier pending-evidence notes.

### Final evidence

| Gate | Result | Recorded evidence |
| --- | --- | --- |
| Combined actual PostgreSQL handlers, independent-connection races, integrity and clean schema | **86 passed, 0 failed, 0 skipped** across six files | `/tmp/titan-completion-db.json` |
| Focused component, hook, read, permission, accounting and invoice source checks | **170 passed** across 22 files, extracted from the final default-suite report | `/tmp/titan-completion-unit-final.json` |
| Clean migrations and nested Drizzle relations | **Passed**; all migrations 0000–0014 applied to a newly generated empty `_test` database, which the test then dropped | `two-phase-schema.test.ts`, included in the 86 checks |
| Schema drift | **No schema changes, nothing to migrate** | `/tmp/titan-closing-schema-drift.log` |
| Production build | **Passed**; router regenerated current routes | `/tmp/titan-completion-build.log` |
| Typecheck | **Passed** | `/tmp/titan-completion-typecheck.log` |
| Targeted independent follow-up review | **No outstanding defects** in final valuation, lock ordering, return allocation, sealed availability and print-profit fixes | Read-only code/regression review; no child database runs |
| Graph refresh after final code/test changes | **Passed**; 6,099 nodes, 17,257 edges, 302 communities | `/tmp/titan-completion-graphify-final.log` |

The combined database gate ran these files sequentially with `--config vitest.integration.config.ts --fileParallelism=false`, using only `TEST_DATABASE_URL` for `titan_two_phase_audit_test` on port 5433:

| Database suite | Passed checks | Covered boundaries |
| --- | --- | --- |
| `src/__tests__/integration/two-phase-production.test.ts` | 21 | Mixing/allocation/packaging lifecycle, caps and atomic rollback; rounded recorded costs; repeated receipts; assignment; chemical/batch/allocation races; dispatch/bulk and dispatch/return ordering; QC, recovery, dashboard and reports |
| `src/__tests__/integration/two-phase-stock-transfers.test.ts` | 20 | Full/partial/loose and cross-warehouse transfers; exact currency and allocation trace; holds; empty history; live-work admission; audit foreign-key races; global multi-recipe lock order; raw quantity precision |
| `src/__tests__/integration/two-phase-invoice-mutations.test.ts` | 26 | Create/edit/delete and reversal; financial/return restrictions; sealed standard availability; explicit zero costs; exact online COGS; cumulative return cents and duplicate rows; immutable signed offline snapshots |
| `src/__tests__/integration/two-phase-raw-stock.test.ts` | 17 | Purchases and adjustments versus manufacturing debit; first-receipt upserts; stale subtraction; locked recount; active warehouse checks; exact representable quantities; preserved finance/audits |
| `src/__tests__/integration/two-phase-integrity.test.ts` | 1 | Ledger-only/null-SKU groups, finished quantity/value drift and scope filtering in one repeatable-read snapshot |
| `src/__tests__/integration/two-phase-schema.test.ts` | 1 | Empty-database migrations, dedicated allocation foreign keys and nested current-model relation reads |

The final return/reader regression run reproduced six failures with 20 passing controls before the patch: zero-cost restocking, full fractional cost, separate approvals, duplicate rows, sealed availability and standard/nonstandard sealed counts. All 26 passed after the patch. The warehouse follow-up likewise reproduced a multi-recipe deadlock and acceptance of an unrepresentable raw transfer before repair; all 20 transfer checks then passed. Four rendered print checks preserve both zero and positive recorded COGS for retailer/distributor templates. These checks execute normal component/handler contracts; no browser automation was used.

### Unrelated full-suite failures

The final `bun run test --reporter=json` run reported **669 passed, 17 failed, 89 skipped** across 124 files. All 170 scoped checks passed. The 86 database checks were skipped by the default configuration and were executed separately by the passing database gate above.

Sixteen failures match the existing HR/attendance/settlement and migration-name baseline: `hr-payroll-regressions`, `order-booker-trip-attendance-phase4`, attendance `back-attribute`/`recompute-server`, `hr-validators`, `edit-attendance-form`, `manual-punch-timeline`, settlement `math`, and `scan-attendance-fn`. The unrelated `offline-sales-schema.test.ts` suite also fails to load because it references absent historical migration `0011_smiling_puma.sql`. No unrelated application logic was changed to address these failures.

One additional attendance workbook-parser case failed in that full run. Its unchanged file passed **15/15** on an isolated recheck, recorded in `/tmp/titan-completion-parser-recheck.json`. The full repository suite is therefore not claimed green. The two invoice posting assertions affected by the stock-helper refactor were updated to check its current transaction/stock/signed-cost contracts; their 12 checks pass in the final full run.

Application database `main` was not migrated or used for audit stock mutations. The concurrency fixtures use isolated test data and scoped cleanup. Existing unrelated work was preserved; no commit or deployment was made. Screen verification follows the owner's prohibition on Playwright and similar tools: code tracing, rendered jsdom components, real QueryClient callbacks, generated routes, middleware/RBAC and PostgreSQL handlers. Visual/manual browser verification is not claimed.
