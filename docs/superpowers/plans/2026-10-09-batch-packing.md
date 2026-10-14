# Batch packing implementation plan

> **For agentic workers:** Use subagent-driven-development for scoped implementation and independent review. Work in the current feature branch, preserving the existing dirty workspace.

**Goal:** Record finished packaging from the same production batch with accurate physical stock and a simple English operator screen.

**Architecture:** Shared decimal quantity module, one receipt transaction and one reusable batch packing form. Preserve existing completed allocation links and carton audit relationships. Add forward schema changes through the generator only.

**Tech Stack:** TanStack Start, React Query, Drizzle/PostgreSQL, Big.js, shadcn/Radix, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-batch-packing-design.md`

## Global constraints

- All operator copy is simple English.
- Preserve all pre-existing workspace changes.
- Generated migrations are immutable; only `bun run db:generate` writes new SQL/snapshots/journal.
- Never apply migrations to the application database as part of verification.
- Physical loose packs must not create or consume cartons.
- Server recomputes quantities, validates permissions and posts all lines atomically.

## Task 1: Receipt quantities, posting and stock compatibility

Files: create `src/lib/production/batch-packing.ts`, `src/server-functions/manufacturing/packaging/get-batch-packing-context-fn.ts`, `record-batch-packing-fn.ts` and transaction helper as needed. Modify production schema and affected stock/availability consumers. Tests in `src/lib/production/batch-packing.test.ts` and `src/__tests__/integration/batch-packing.test.ts`.

Interfaces: exact context, submission and quantity interfaces in spec. UI consumes these unchanged.

- [x] Add quantity tests, including `expect(calculatePackingLine({fullCartons:20,partialPacks:0,loosePacks:0},{fillAmount:'250',fillUnit:'g',containersPerCarton:40,usesCartons:true},'kg').nominalBulk).toBe('200.000')` and outside counts larger than capacity.
- [x] Implement decimal validation, schema receipt/audit fields and physical-stock representation; use guarded stock debit under transaction locks.
- [x] Implement read context and authenticated POST with request replay, live formula validation, complete rollback and persistent historical settings.
- [x] Update affected downstream stock consumers; verify physical cartons and loose packs through dispatch/reversal and transfers.
- [x] Generate new migrations and test only in isolated `_test` database.
- [x] Review spec and quality for this task; resolve material findings.

## Task 2: Operator screen and entry points

Files: create `src/components/packaging/batch-packing-form.tsx`, optional row component, and `src/hooks/manufacturing/packaging/use-batch-packing.ts`; modify mixing detail, mixing console, operator list/route and default packing navigation.

Interfaces: consume Task 1 exact contract. Form exported `BatchPackingForm({mixingRunId:string})`.

- [x] Build the main count-entry form with one line per selected format, configured weight/capacity, kg helper and clear live balance.
- [x] Add optional partial-carton and measured-bulk fields; loss reason and plain validation. Compose Field/FieldGroup, Input, Card, Alert and ToggleGroup from existing UI.
- [x] Persist actor/batch drafts and request identity; review before confirm, retain on error, clear on confirmed receipt only.
- [x] Invalidate batch, factory-floor, inventory and carton queries on success. Mount form on completed batches in both entry points; show old jobs only as legacy work.
- [x] Add meaningful behavioral tests for the 500kg example, overdraw, draft/retry behavior and responsive/accessibility structure.
- [x] Review spec and quality for this task; resolve material findings.

## Task 3: End-to-end verification and documentation

- [x] Run focused quantity, component, permission and stock tests with `bun run test <paths> --maxWorkers=2`.
- [x] Run isolated PostgreSQL receipt/concurrency/stock regressions with `TEST_DATABASE_URL=..._test bun run test --config vitest.integration.config.ts <paths>`.
- [x] Run `bun run typecheck` and `bun run build`.
- [x] Inspect count-entry form at 360px mobile and 1440px desktop in Chrome using real components and mocked data. No horizontal overflow or browser exceptions. Expanded weight-helper mode also passed. This was a real-component preview with mocked data, not an authenticated application smoke test.
- [x] Independent final review, fix material findings, then run `graphify update .`.
- [x] Record verification outcomes and deployment migration requirement.

## Execution ledger

Ruling: user explicitly approved proceeding; implement directly without a repeated design gate. Existing workspace is dirty and carries the production changes this feature builds on. A new branch `feat/batch-packing-record` and `/tmp/titan-packing-baseline/src` preserve an auditable starting point; do not commit unrelated changes.

Pre-flight: Tasks 1/2 share only the documented interfaces. Task 1 owns server/schema/domain/stock consumers, Task 2 owns form/hooks/navigation. Task 3 validates their combination. Loose-pack downstream compatibility is mandatory, not a UI-only change.


### Progress checkpoint — 2026-10-09

**Completed:** approved spec and plan written; feature branch created; baseline preserved. The shared packing form is mounted on both completed-batch entry points. Operator lists include completed batches, and finishing mixing stays on the same batch. Simple English, physical counts, kg calculator with remainder, optional partial cartons/measured weight/loss, editable packing time, review/confirm, persisted drafts and stable retry IDs are implemented.

**Verification so far:** 7 new packing UI tests pass. Latest combined UI/list run passed 17 tests. Existing manufacturing-screen behavior suite passed in an earlier combined run. Typecheck passed before the most recent review fixes; rerun is pending. Chrome preview at 1440px and 360px had no horizontal overflow or runtime exceptions after correcting preview-only Tailwind source discovery. Screenshots are `/tmp/titan-packing-desktop.png` and `/tmp/titan-packing-mobile.png`; preview uses the real form with mocked server responses, not the authenticated application.

**Review fixes implemented:** mobile sticky balance/review control; compact format cards; hidden advanced options; wrapping weight arrangement controls; recovery paths refresh related inventory caches; variance-reason error association; stable request ID retained when checking a failed submission before editing. Operator list loader prefetch-key alignment is fixed.

**In progress:** backend receipt transaction and loose-pack stock compatibility. Shared decimal helper, context/POST interfaces, receipt schema and outside-pack ledger are present. Backend completion, forward migration generation, isolated PostgreSQL tests, physical-stock display integration and independent backend review are not yet signed off.

**Remaining:** tests for latest review changes, expanded-mode browser check, final typecheck/build, independent final review, graphify refresh, and migration/deployment notes. No application database migration has been applied.

**Execution note:** UI reviewer delivered actionable findings but hit an agent usage limit before writing its final report. Findings are captured above; final independent review still remains open. Backend agent was interrupted and has been asked to resume its existing work.

Backend interim, resumed after interruption: quantity validator, receipt schema and transaction, authenticated context/POST/retry state, and initial outside-pack stock compatibility are implemented. Generator created `0016_wet_guardian.sql`. Tests and final downstream verification remain pending, so Task 1 checkboxes remain uncompleted. Details: `/tmp/titan-batch-packing-backend-report.md`.


### Verification checkpoint — continued after Docker became available

- Docker PostgreSQL 18 is healthy on port 5433. The dedicated temporary PostgreSQL cluster on port 55438 remains the test target.
- Fixed the old finished-stock display fixture's missing mixingRuns mock. Latest form + finished-stock run passed 17 tests, including two new cases for outside packs exceeding carton capacity and partial-carton contents not being labeled loose.
- Expanded weight-calculator and optional-field browser check at 360px passed with no horizontal overflow or runtime exceptions. The 1440px count view also passed. Removed two stray JSX text characters found in the browser inspection.
- Physical finished-goods counts and factory-floor loose-pack KPI now use the explicit outside-pack balance. Aggregate quotient/remainder is retained only for total-unit arithmetic.
- Backend quantity and bulk-read checks: 11 passed. Database migration and transaction/concurrency checks are still in progress.


### Resume checkpoint — 2026-10-10

The execution environment restarted and `/tmp` reports/test logs/preview fixtures and prior agents no longer exist. Source changes and this plan are intact. A new backend worker resumed the existing implementation. Previous verified results recorded in conversation: 57 focused tests passed; six isolated PostgreSQL receipt/downstream/concurrency tests passed; typecheck passed. Changed code will be reverified. All further review reports are stored under `docs/superpowers/` to survive runtime resets.

Independent review identified three important gaps, now in the fix loop:
1. Chemical cost must reconcile across several receipts, not only across lines within one receipt. Tiny batch costs exposed duplicated rounding cents. Backend fix and regression tests in progress.
2. Historical no-carton stock starts with outside tracking zero. UI now derives outside packs from total units for no-carton formats, including mixed old/new stock. Added a display regression.
3. Outside packs need an audited correction path. Inventory-manager correction dialog and table action are implemented; the backend endpoint with expected-current guard, reason and audit is in progress. Zero-stock rows remain visible to authorized managers so an incorrect zero can be corrected.

The main operator form remains complete. Remaining sign-off: backend fixes, latest UI/database regressions, independent final review, production build, graphify refresh and deployment note for generated migration 0016.

### Review and verification checkpoint — 2026-10-10

- Latest focused run passed **61 tests across seven files**, covering the 500kg form, quantity rules, saved drafts/retry recovery, manufacturing entry points, physical finished-stock display and the new correction dialog.
- `bun run typecheck` passed with the correction endpoint included. Final build remains pending downstream review fixes.
- Independent review is persisted in `docs/superpowers/reviews/2026-10-10-batch-packing-review.md`. Review found invoice create/edit ordering and availability gaps for outside packs; fixes and database regressions are in progress.
- Carton KPIs and supplementary-carton limits now use receipt snapshots for physical counts. Outside packs no longer inflate carton targets. Historical allocations keep their existing calculation. Snapshot capacity is used for receipt-backed records.
- Current runtime cannot reach Docker's desktop socket. Database verification is probing the available local PostgreSQL service; it will use an isolated `_test` database only.


### Final verification — 2026-10-10

**Implementation complete.** The completed batch now owns the packing record workflow. Operators record all formats together, review exact counts and bulk balance, and confirm once. Simple English is used throughout. Finished goods distinguish physical cartons, packs inside a partial carton and sealed packs outside cartons. Failed submissions retain their exact request for safe retry.

| Check | Result |
| --- | --- |
| Packing form, quantities, manufacturing entry points, finished-stock display and correction dialog | 61 tests passed |
| Production permissions, invoice availability and sales/posting regression checks | 42 tests passed |
| Isolated PostgreSQL packing, production, invoice edits/returns and stock transfers | 80 distinct tests passed across final runs |
| TypeScript | `bun run typecheck` passed |
| Production build | `bun run build` passed |
| Responsive rendering | 360px and 1440px real-component Chrome preview passed, including expanded options |
| Code graph | `graphify update .` passed; 6,237 nodes and 17,878 edges |

Database evidence: the full four-suite run passed 77/80. The remaining three failures were missing required public invoice numbers after changing isolated concurrency fixtures to explicitly select their warehouse. Adding those fixture values yielded **32/32** passing tests in the two affected suites; the other **48** tests had passed unchanged. No unresolved regression failure remains.

Additional fixes from review: cumulative cost rounding; historical no-carton stock; audited outside-pack corrections; outside stock in invoice-edit availability; physical dispatch before aggregate debit; receipt-snapshot carton targets. The independent reviewer verified most of these paths before reaching its usage limit; the parent completed the remaining inspection and regressions. See the separate review record for that boundary.

**Deployment:** apply generated migration `0016_wet_guardian.sql` through the normal migration runner before deploying this code. Migrations were applied only to isolated `_test` databases, including the fresh `titan_batch_packing_final_test`; the application database was not changed. Existing generated migrations were not rewritten. No deployment or commit was performed.

**Verification limits:** no authenticated full-application browser journey or operator acceptance session was performed. Browser evidence uses the real packing components with mocked responses. Build emitted chunk-size/plugin-timing warnings; PostgreSQL tests emitted the existing concurrent-query deprecation warning. Graph HTML was skipped because the graph exceeds its visualization size limit; JSON and Markdown graph outputs were updated.

The spec, this plan, backend progress and review Markdown files now have narrow `.gitignore` exceptions so they can be versioned. Final raw logs live beside this plan and remain ignored: `batch-packing-final-migrate.log`, `batch-packing-final-db.log`, `batch-packing-final-db-recheck.log`, `batch-packing-final-typecheck.log`, `batch-packing-final-build.log`, and `batch-packing-final-graphify.log`.
