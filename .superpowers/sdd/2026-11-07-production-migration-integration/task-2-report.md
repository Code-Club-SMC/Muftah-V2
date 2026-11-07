# Task 2 report

## Outcome

Task 2 is complete on `fix/reconcile-production-migrations`, starting at `e385f0bfa0faecd017c4e1c3102ab5aebf09c714`. The branch remains DRAFT. Production was not changed.

Added `src/db/migration-integration.test.ts` and generated these artifacts using Drizzle only:

- `src/db/migrations/0026_rainy_magma.sql`
- `src/db/migrations/meta/0026_snapshot.json`
- One appended entry in `src/db/migrations/meta/_journal.json`

No source schema edits were needed. The inherited combined schemas already retain the exact legacy `sales_returns.condition` definition and declare the invoice offline-slot FK. The existing offline-sales schema regression was not changed or weakened.

## RED, generation, GREEN

All commands ran in `/tmp/opencode/titan-migration-integration`. The worktree has no `.env`; Bun commands used `--no-env-file`.

### RED before generation

```bash
bun --no-env-file run test src/db/migration-integration.test.ts
```

Exit 1 at 18:45:33 on 2026-11-07. One test file failed, with 7 failed and 2 passed tests. Failures were the intended missing-forward-output checks:

- No journal entry after 0025, forward entry count was zero.
- No new offline fields, returns lifecycle DDL, purchase audit/lab/packaging DDL, or invoice-slot FK in forward SQL.
- The latest existing snapshot still had the legacy `'pending'` default rather than the expected new `'requested'` default.
- No allowed forward statements existed.

The baseline hash checks and complete snapshot ancestry/file correspondence already passed. There were no import, configuration, or database failures.

### Generator

```bash
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/titan_placeholder bun --no-env-file run db:generate
```

Exit 0. Drizzle inspected 125 schema tables and generated `0026_rainy_magma.sql` plus its snapshot and appended journal entry. No database command or connection was used. No existing artifact was deleted, regenerated, or hand-corrected.

### GREEN after generation

```bash
bun --no-env-file run test src/db/migration-integration.test.ts
```

Exit 0 at 18:45:48. One test file passed, all 9 tests passed, duration 1.57s. No test semantics changed between RED and GREEN. Later edits to the test were formatting only.

Final focused run after formatting:

```bash
bun --no-env-file run test src/db/migration-integration.test.ts src/db/schemas/offline-sales-schema.test.ts src/db/schemas/offline-attendance-schema.test.ts src/db/schemas/invoice-settlement-schema.test.ts src/lib/inventory/packaging-kind.test.ts src/lib/suppliers/purchase-refund.test.ts src/lib/sales/returns/return-lifecycle.test.ts src/lib/sales/returns/return-reasons.test.ts
```

Exit 0 at 18:49:10. All 8 files and 50 tests passed, duration 6.42s. This includes the existing offline-sales migration FK regression and schema FK/restrict checks unchanged.

## Baseline and ancestry evidence

An independent Python filesystem/hash check compared the immutable manifest bytes with `git show e385f0bfa0faecd017c4e1c3102ab5aebf09c714:src/db/migration-baseline.json`, checked each manifest SQL/snapshot SHA-256, and compared the original journal prefix. Results:

- Manifest byte-identical to the task base.
- All 52 baseline SQL/snapshot hashes match, covering 26 SQL files and 26 snapshots.
- All 26 original journal entries match exactly, including timestamps, versions, tags, indices, and breakpoints.
- Indices are contiguous 0 through 26; timestamps strictly increase.
- Appended journal entry has index 26, version `7`, tag `0026_rainy_magma`, timestamp `1794059141656`, and `breakpoints: true`.
- Snapshot 0026 ID is `debdb8bb-f450-4401-b7bd-4bad6ea8570a`.
- Its `prevId` is `7707fc27-b474-4191-9002-5e3260081c9e`, exactly snapshot 0025's ID.
- Every snapshot predecessor is checked by ID back to the zero UUID. IDs are unique. There are no orphan SQL files or snapshots.
- This actual baseline has a distinct `0001_snapshot.json` with a unique ID despite the custom SQL seed tag. No ancestry exception was added.
- The invoice offline-slot FK is absent from baseline snapshot 0025 and present with `ON DELETE restrict` in snapshot 0026 and the new SQL.

The baseline journal file's hash is intentionally not compared after generation because Drizzle appends to it. The test instead requires the exact original journal prefix. All baseline SQL and snapshot files are hashed individually.

## Generated SQL review

Read and reviewed all 76 lines of generated SQL and the appended journal diff. The 58 statements consist of one new table, 38 added columns, 9 added foreign keys, 4 created indexes, 5 added check constraints, and one status-default change.

- Offline invoices add customer details, invoice discount and expenses with descriptions, and printed total. Offline items add manual free cartons, price override, and listed price. Payments add expense metadata, notes, and instant verification. New required fields have safe defaults; new checks require nonnegative extras/manual free quantities.
- Returns add the reason catalog, reason index/FK, lifecycle actor/reason/timestamp fields, requested and inspected item quantities, and stock trace kind. Only the default for future return statuses changes to `'requested'`. Historical rows are not rewritten, and all old columns, including header `condition`, remain intact.
- Purchases add nullable void metadata, refund wallet/actor FKs, active-supplier index, and refund bounds/metadata checks. Existing rows satisfy the all-null void metadata branch without a backfill.
- Lab reports gain nullable purchase ownership with restrict FK and index. Existing reports remain nullable.
- Packaging kind is nullable and constrained to the schema's allowed values, so existing null values remain valid.
- Invoices gain the missing FK from `offline_sales_slot_id` to `offline_sales_invoice_slots.id`, with restrict deletion. No legacy migration or original workspace 0032 artifact was imported.

The regression rejects DROP/TRUNCATE and direct INSERT/UPDATE/DELETE/MERGE. It also restricts statements to additive DDL plus the one approved status-default change. A snapshot comparison requires every baseline table and column definition to survive unchanged, except that specific status default.

## Additional verification

```bash
bun --no-env-file x --no-install prettier src/db/migration-integration.test.ts --check
```

Final exit 0, formatting passes. An earlier check reported formatting differences; only the authored test was formatted using patch. Generated files were never formatted or manually edited.

```bash
git diff --check
```

Exit 0. The final staged diff was also checked with `git diff --cached --check` before commit.

```bash
git diff e385f0bfa0faecd017c4e1c3102ab5aebf09c714 -- src/db/migration-baseline.json src/db/schemas src/hooks/sales/use-sales-returns.ts src/routes/offline-desk.tsx src/routeTree.gen.ts
```

Exit 0 with no diff. Manifest, source schemas, original offline-sales tests, and paths implicated by the typecheck blockers are untouched by this task.

```bash
graphify update .
```

Exit 0 after code changes, rerun after final test formatting. Final result was 8,348 nodes, 22,130 edges, 401 communities. The graph report and JSON updated locally. HTML visualization was skipped because the graph exceeds the 5,000-node limit. Graph outputs are ignored and not part of the commit.

```bash
bun --no-env-file run typecheck
```

Exit 1 with two errors in unchanged inherited files:

1. `src/hooks/sales/use-sales-returns.ts:4` imports nonexistent `processSalesReturnFn`.
2. `src/routes/offline-desk.tsx:10` uses `/offline-desk`, which is absent from the inherited generated route types.

No unrelated fixes or route generation were attempted. Vitest also emits the existing `vite-tsconfig-paths` deprecation advisory; it does not affect the passing tests.

## Concerns and limits

- DRAFT remains mandatory. The reviewed downstream returns UI/accounting blockers are outside Task 2 and were not fixed. Passing history/schema tests does not establish application readiness.
- Existing returns keep legacy statuses and zero defaults in new item counters. No lifecycle data conversion or reason seeding was performed. Any later compatibility/backfill decision needs separate approval.
- New FK/check validation, table-lock duration, and existing invoice-slot orphan risk were not tested against a database. Read-only data validation and a controlled database rehearsal remain downstream work, not authorization to deploy.
- No database connections, migration application, application seeds, schema push, main merge, deployment, or production operations occurred. No credentials, backups, or production data were read or committed.
- The original workspace was not accessed or modified. No `.env` was read. No subagents or reviewers were spawned. Generated output received an inline review only, as required by the task's delegation prohibition.
- The pre-existing untracked controller plan at `docs/superpowers/plans/2026-11-07-production-migration-integration.md` was left untouched and excluded from the Task 2 commit. All inherited branch files remain retained.
