# Two phase audit completion implementation plan

> **For agentic workers:** Use subagent-driven-development for independent repair tasks and record evidence in `docs/two-phase-production-audit.md`. Preserve this uncommitted worktree.

**Goal:** Close the concrete October 2 audit findings and verify the September 29 plan requirement by requirement.

**Architecture:** Keep the existing transactional domain code. Make stored material costs authoritative, connect current UI controls to existing server contracts, and extend integrity SQL to compare all current allocation/stock records.

**Tech Stack:** TanStack Start, TanStack Query, React, Drizzle, PostgreSQL, Big.js, Vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-10-02-two-phase-audit-completion.md`

**Status — 2026-10-06:** Complete within the owner's stated scope. Final evidence: 86 actual PostgreSQL checks and 170 focused checks passed; clean migrations/relations, schema drift, build, typecheck, independent follow-up review and graph refresh passed. Unrelated default-suite failures and an isolated parser recheck are recorded in `docs/two-phase-production-audit.md`.

## Global constraints

Use the constraints and rulings from the spec. No browser automation, new dependencies, application database mutations, commits or direct generated-route edits.

## Task 1: Recorded manufacturing costs

Files: `src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts`, `src/server-functions/manufacturing/packaging/log-packaging-progress-fn.ts`, `src/__tests__/integration/two-phase-production.test.ts`.

- [x] Add failing database assertions for two material deductions of quantity 0.001 at cost 5: recorded costs sum to 0.02 and the run/allocation total must also be 0.02.
- [x] Compute each stored two-decimal row cost once and sum that amount into the manufacturing total. Preserve stock and transaction guards.
- [x] Verify fractional-cost scenarios and the existing lifecycle suite.

## Task 2: Management and operator screen contracts

Files: current formula/mixing/packaging/operator components, manufacturing and recipe hooks, matching paginated server reads, focused React/hook tests.

- [x] Write failing checks for eleventh-record access, successful creation cache invalidation, decimal bulk remaining, action permission gating, and missing allocation state.
- [x] Wire server pagination/search to existing table components and paginate assigned operator mixing work.
- [x] Invalidate affected operator and embedded manufacturing queries on mutation success.
- [x] Expose permitted untouched-work cancellation and formula deactivation/edit fields using existing functions.
- [x] Use Big.js and `getPackagingTarget` for allocation remaining and target previews.
- [x] Verify focused component/hook checks and type contracts.

## Task 3: Integrity reconciliation and missing evidence

Files: `src/lib/cartons/carton-extended.service.ts`, integration tests, evidence tracker.

- [x] Reproduce a ledger-only allocation and corrupted finished quantity/value with failing database checks.
- [x] Use a full join with null-safe SKU comparison for carton/ledger totals; include all scoped allocation records. Reconcile finished stock per recipe/warehouse with live carton packs and WAC value.
- [x] Verify scope filtering and balanced normal receipts, dispatch, returns and transfers.
- [x] Exercise deterministic independent-connection invoice/bulk and manual dispatch/return ordering, plus dashboard/report queries.
- [x] Migrate an empty isolated test database, check relations and schema drift, run final tests/typecheck/build, review repairs and refresh graph.

## Task 4: Reachable inventory and invoice mutations

Files: invoice mutation/posting helpers and return queries, inventory transfer and warehouse deactivation handlers, raw stock add/adjust/update handlers, finished-stock readers and views, focused endpoint/component regressions.

- [x] Reproduce partial availability double counting and inconsistent invoice edits/deletion through actual handlers; reverse and redispatch cartons, value and ledger transactionally. Preserve financial checks, return limits and audit identity.
- [x] Reproduce full/loose inventory transfers and deactivation merges; use sorted stock/carton locks and traced pack movements, and reject relocation during live manufacturing work.
- [x] Reproduce raw adjustment versus manufacturing debit on separate connections; serialize quantity reads and updates, preserving purchases and audit deltas.
- [x] Retain canonical inventory quantities and show partial packs once in totals and low-stock checks. Weight aggregated warehouse WAC by current units and value.
- [x] Review these connected repairs, run combined PostgreSQL and component gates, then update the broad September 29 findings only when supported by the evidence.

## Task 5: Final review edge cases — October 4

- [x] Reproduce sealed-carton invoice creation/editing and zero-cost create/edit/delete. Align availability and preserve explicitly recorded zero WAC.
- [x] Align invoice availability reads and desktop/mobile selectors with sealed standard cartons and unit/loose stock; count partial packs once and respect other lines' reservations.
- [x] Reproduce rounded-WAC full/partial transfers and online invoice create/edit/delete; conserve recorded currency value, including cross-warehouse carton operations, while preserving signed offline historical COGS.
- [x] Reproduce a further packaging receipt into stock with rounded WAC; add recorded production cost to recorded inventory value before calculating the next WAC. Full production suite: 21 scenarios passed on October 6.
- [x] Reproduce approved zero-cost and fractional-cost sales returns; restore recorded invoice cost including the final currency remainder across repeated returns.
- [x] Use warehouse NO KEY UPDATE for deactivation so manufacturing admission remains excluded while audit foreign-key checks can proceed; verify stock mutation/deactivation races on independent connections.
- [x] Reproduce a bulk mutation racing multi-recipe warehouse relocation; acquire all stock references in global warehouse/recipe order before moving any recipe.
- [x] Run the final combined gates and independent follow-up review, record any unrelated full-suite failures, refresh graphify and close only supported tracker findings.
