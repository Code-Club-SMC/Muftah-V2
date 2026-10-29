# Offline Production Runs

**Date:** 2026-08-13

**Status:** Approved design; implementation not started

**Scope:** One factory location, offline production runs covering the full pipeline — create, start, log-progress, edit-latest-log, complete-with-shortfall, and fail — captured during an internet outage in a signed Excel workbook and applied to the live ledger after connectivity returns.

**Dependencies:**
- `2026-08-10-offline-sales-excel-invoicing-design.md` (offline sales workbook pattern)
- `2026-08-03-offline-attendance-excel-import-design.md` (offline attendance workbook/outage/lease pattern)
- Online production pipeline implemented in `src/server-functions/inventory/production/` and `src/lib/production/` (shared helpers reused by this design).

## 1. Purpose

Factory production must continue when factory internet fails. The client will not install a local server and will not purchase backup internet.

One designated operator will record production actions in an official Excel workbook already stored on the factory computer. After connectivity returns, Titan ERP validates the workbook and applies the staged actions to the live ledger through the same `productionRuns`, `materialStock`, `finishedGoodsStock`, `cartons`, and `wacHistory` mutations used online — never a parallel reimplementation.

The Excel workbook is transport only. Uploaded file bytes are never stored in application storage, object storage, or PostgreSQL.

## 2. Honest limitation

During an outage, Excel cannot read live database state. Database stock, run status, and the operator screen remain temporarily stale until import finishes.

The workbook uses a server-issued signed snapshot of recipes and factory-floor material stock. The snapshot is read-only at upload time and used only to render the post-time reconciliation UI and to detect tampering. The live ledger — never the snapshot — is the source of truth for actual deductions.

Single-writer rule is operationally essential. One designated operator uses one official workbook. If a copy is filled in parallel and reuses a slot, the application can detect the conflict at upload and mark it `conflict`, but cannot stop duplicate physical production during the outage.

## 3. Locked business decisions

- One active offline production workbook exists for the factory at a time, owned by one designated operator.
- Offline actions cover the full run pipeline: create run, start run, log-progress, edit-latest-log, complete-with-shortfall, and fail. Cancel is NOT an offline action (operator who creates but does not start lets the run sit `scheduled` online and cancels from the online screen — no stock is touched).
- Outage is self-declared by the operator at upload (attendance-style supervisor confirmation is out of scope for production; only one operator exists).
- One workbook may stage actions for many runs, but each run has at most one creation slot per workbook.
- Each created run binds to a server-reserved `batchId` issued at workbook issuance (mirrors offline sales reserved invoice serials).
- Begin-run and log-progress pull the operator-declared start time and log timestamps from signed workbook cells; the server stamps the canonical `actualStartDate`, `actualCompletionDate`, and `createdAt` at apply time, never trusting client-supplied server fields.
- Lab reports (COA drafts) are deferred to a phase-2 follow-up; out of v1 scope.
- Failed-batch chemical recovery is out of scope for v1; offline fail leaves chemicals deducted exactly as online fail does (recovery happens later via the existing online recovery flow).
- Raw Excel bytes are discarded after parsing.
- Feature ships behind `OFFLINE_PRODUCTION_IMPORT_ENABLED=false`.

## 4. Offline batchId numbering

Online and offline batchIds use the same series via `generateNextBatchId`. Workbook issuance reserves N batchIds up-front inside the issuance transaction (mirrors `reserveOfflineInvoiceSerials`). Reserved-but-unused slots leave gaps in the sequence, exactly as unused offline invoice serials do. This guarantees offline batchIds never collide with online-created runs.

Reserved count: 200 per workbook (constant `OFFLINE_PRODUCTION_WORKBOOK_RUN_CAPACITY = 200`).

## 5. Workbook lifecycle

### Issuing

An authorized manufacturing-manage user issues the single active workbook while online. The operator keeps it on the factory computer at all times; outage prediction is unnecessary.

The workbook should be refreshed at the start of shift when practical so the reference snapshot (recipes, factory-floor chemicals, packaging, finished-goods stock) stays recent. Replacing a workbook closes the previous one for new entries but keeps it recognizable for pending import and audit.

Only one workbook may have `active` status. Database uniqueness enforces this rule (`WHERE status = 'active'`).

Normal replacement follows this safe sequence: upload and stage any used rows from the old workbook, close it, then issue the replacement. An authorized manager may force-retire a lost or damaged workbook with a required reason (5–500 chars). Force-retirement invalidates unused slots; any later upload from that workbook becomes `needs_review` and can never post automatically.

### Capacity

Initial template capacity:
- 200 prepared run slots (each a potential production run).
- Per-slot row capacity for cumulative operator actions (log-progress, edit-log, complete, fail) — recommended 1000 action rows per slot, configurable by constant `OFFLINE_PRODUCTION_ACTION_ROW_CAPACITY = 1000`.
- Total workbook soft cap: 50 MiB; reject uploads above this.

## 6. Offline actions

Each offline action row in the workbook is one atomic step. Each carries the slot's `recordToken`, an integer `rowSequenceNumber` (per-slot monotonic from 1), the `actionKind`, and a small typed payload.

| `actionKind` | Payload | Online equivalent | Notes |
|---|---|---|---|
| `create_run` | `{ recipeId, batchesProduced, scheduledStartDate?, notes? }` | `createProductionRunFn` | One per slot; must be the first action row in that slot. Server stamps `operatorId = workbook.assignedOperatorUserId`, `initiatorId = server-side reviewer` at apply time. Client-provided `operatorId`/`initiatorId` stripped. |
| `start_run` | `{}` | `startProductionFn` | Only valid after `create_run` applied. Deducts chemicals at factory floor under `SELECT FOR UPDATE` on `materialStock`. |
| `log_progress` | `{ unitsProduced }` | `logProductionProgressFn` + `applyProductionProgressLog` | Carton-alignment rule enforced (partial last carton allowed only when `remaining < containersPerCarton && unitsProduced === remaining`). May auto-complete inside the same apply tx. |
| `edit_log` | `{ progressLogId, unitsProduced, editReason }` | `editLatestProductionProgressLogFn` | Only valid when `progressLogId` is still the latest by `(createdAt desc, id desc)` at apply time. Rollback-then-reapply via the same online core. |
| `complete` | `{ shortfallReason? }` | `completeProductionFn` | `shortfallReason` required when `completedUnits < containersProduced` (online parity). Idempotent early-return if run already `completed`. |
| `fail` | `{ reason }` | `failProductionFn` | Only valid when `hasOperatorProductionLogs(run) === false` — re-evaluated live inside the locked apply tx (online parity). |

`cancel` is intentionally not an offline action. The operator screen remains the only place to cancel a `scheduled` run, and only before `start` applies.

## 7. Architecture

### Pipeline

1. **Issue** (manager, `manufacturing.offline.workbooks.manage`): in one tx, reserve 200 batchIds via the existing `generateNextBatchId` helper, build the reference snapshot (recipes + factory-floor `materialStock` + `packagingMaterials` + `finishedGoodsStock` + factory-floor warehouse id), hash and sign it, insert the workbook row + 200 `offlineProductionRunSlots` rows each carrying a server-minted `recordToken`.
2. **Download**: re-hash and verify both signatures (snapshot + manifest) exactly like sales; refuse non-`active`. Build the .xlsx with a manifest sheet, a reference sheet (read-only), and one action-sheet block per slot.
3. **Upload** (operator, `manufacturing.offline.upload`): form-data. Validate `.xlsx` + size within `[MIN_XLSX_BYTES=1 MiB, MAX_BYTES=10 MiB]` (sales parity; the floor avoids degenerate uploads). SHA-256 the bytes (Node `createHash`, not `crypto.subtle` — attendance's slower dance is not copied). Re-upload of identical bytes returns the existing batch (idempotency via UNIQUE `fileSha256`). Parse failure stores a `rejected` batch row with `workbookId NULL`. Successful parse → one tx: verify workbook snapshot hash, insert batch `uploaded`, stage each action row with initial classification, flip batch to `preview_ready`.
4. **Review** (`manufacturing.offline.review`): `refreshOfflineProductionPreview` re-classifies all staged actions against current live data, mutating ONLY `status`/`issueCodes`/`issueDetails`/`reasonCode`/`reasonMessage` — never the `payload` business values (sales parity; regression-tested). `excludeOfflineProductionAction` allowed only for `needs_review|invalid|blocked`.
5. **Post** (`manufacturing.offline.post`): `claimBatch` (atomic conditional UPDATE → `posting`, lease id, expiry `+2 min`). Loop selects the next `ready` action ordered by `(slotId, rowSequenceNumber)` within `OFFLINE_PRODUCTION_POST_LIMIT=20`. Each action applies in its OWN `db.transaction`:
   - `SELECT * FROM production_runs WHERE id = ? FOR UPDATE` (lock the run; this is the offline-specific fix to the online race — the online path has no such lock).
   - `SELECT * FROM materialStock WHERE warehouseId = ? AND (chemicalId|packagingMaterialId) = ? FOR UPDATE` for each material the action touches.
   - `SELECT * FROM finished_goods_stock WHERE warehouseId = ? AND recipeId = ? FOR UPDATE` when the action touches FG (auto-complete, complete, edit-log).
   - Re-classify live (TOCTOU guard — attendance parity).
   - Atomic `UPDATE staged_actions SET status='applied' WHERE id=? AND status='ready' RETURNING` — claimed-row count must equal 1, else throw.
   - Dispatch by `actionKind` to the **online core helpers extracted as `createServerOnlyFn`s**:
     - `create_run` → `createProductionRunCore(tx, { batchId(<reserved>), recipeId, batchesProduced, scheduledStartDate, notes, operatorId, initiatorId })` extracted from `create-production-run-fn.ts`.
     - `start_run` → `startProductionRunCore(tx, { runId, performedById })` extracted from `start-production-fn.ts`.
     - `log_progress` → `logProductionProgressCore(tx, { runId, unitsProduced, performedById })` extracted from `log-production-progress-fn.ts` (calls `applyProductionProgressLog`).
     - `edit_log` → `editLatestProgressLogCore(tx, { runId, progressLogId, unitsProduced, editReason, performedById })` extracted from `edit-latest-production-progress-log-fn.ts`.
     - `complete` → `completeProductionRunCore(tx, { runId, shortfallReason, performedById })` extracted from `complete-production-fn.ts`. Idempotent early-return preserved.
     - `fail` → `failProductionRunCore(tx, { runId, reason, performedById })` extracted from `fail-production-fn.ts`. `hasOperatorProductionLogs` re-checked live inside the locked tx.
   - Set `staged_actions.appliedProductionLogId` (for log/edit) or `appliedRunId` (for create) for audit.
   - On failure: catch, set staged `needs_review` with `reasonCode:"apply_failed"` and a safe allow-listed message (sales `safePostError` pattern).
   - On PG unique-violation (the `applied` partial-unique firing from a retry) → mark `duplicate` with `reasonCode:"already_applied"` (attendance parity).
   - `finalizeBatch`: recompute counts, set status `posting` if `ready` remain, `completed_with_issues` if review/invalid/etc remain, else `completed`. Release lease in `finally`.
   - `PostBatchResult.hasMore = (status === "posting")`. Client loops cap 30 (sales parity).
6. **Operator screen lock**: while ANY `offline_production_staged_actions` row exists with `status ∈ ["ready","warning","invalid","needs_review","blocked","posting"]` for the operator's active workbook, the online operator screen (`routes/_protected/operator/$runId.tsx` and `/operator/index.tsx`) renders a lock banner and disables mutations. Computed via `getOfflineProductionReportStatusFn` → `{ hasUnappliedOfflineProductionActions }`, polled every 30s by `OfflineReportPendingBanner`.

### Reference snapshot

The snapshot is JSON capturing, at issue time:
- `factoryFloorWarehouseId` (resolved by `type = "factory_floor"`, single row).
- `recipes`: id, name, batchSize, batchUnit, targetUnitsPerBatch, containerType, containerPackagingId, fillAmount, fillUnit, containersPerCarton, cartonPackagingId, estimatedCostPerContainer, isActive, ingredients (chemicalId, quantityPerBatch), packaging (packagingMaterialId, quantityPerContainer, usageBasis).
- `chemicals`: id, name, unit, costPerUnit.
- `packagingMaterials`: id, name, type, capacity, capacityUnit, costPerUnit.
- `materialStock`: rows at the factory-floor warehouse keyed by `(chemicalId|packagingMaterialId)` with current `quantity`.
- `finishedGoodsStock`: rows keyed by `recipeId` with current `quantityCartons`, `quantityContainers`.
- `generatedAt`.

The snapshot is hashed (`hashOfflineProductionSnapshot`) and signed (`signOfflineProductionSnapshot`, `signOfflineProductionManifest`), stored on the workbook row, and re-verified at upload and download (sales parity).

## 8. Database schema

New file `src/db/schemas/offline-production-schema.ts`. Status type aliases exported (sales/attendance parity).

### `offline_production_workbooks`
Mirrors `offline_sales_workbooks` (sales shape is the closer parent — carries a signed snapshot):
- `id`, `factoryCode` text with `CHECK = 'F01'`, `operatorUserId` (FK→user restrict), `issuedByUserId` (FK→user), `status` (`active|closed|force_retired`), `templateVersion`, `signingVersion`, `runCapacity`, `referenceSnapshot` jsonb, `snapshotSha256`, `snapshotSignature`, `manifestSignature`, `replacementWorkbookId` (self-FK set null), `issuedAt`, `closedByUserId`, `closedAt`, `forceRetiredByUserId`, `forceRetiredAt`, `forceRetiredReason`, timestamps.
- Partial unique `offline_production_workbooks_one_active_factory_idx ON factoryCode WHERE status='active'` (one active workbook for F01).
- `CHECK templateVersion > 0 AND signingVersion > 0 AND runCapacity > 0`.

### `offline_production_run_slots`
Mirrors `offline_sales_invoice_slots`:
- `id`, `workbookId` (FK restrict), `slotNumber` int, `reservedBatchId` text UNIQUE (reserved up-front), `recordToken` text UNIQUE, `status` (`unused|staged|posted|voided|conflict`), `stagedContentHash`, `stagedRunId` (FK→offline_production_staged_actions ID restrict, nullable), `postedRunId` (FK→productionRuns restrict, nullable), `consumedAt`, timestamps.
- UNIQUE `(workbookId, slotNumber)`. Partial unique on `stagedRunId WHERE NOT NULL`. Partial unique on `postedRunId WHERE NOT NULL` (sales parity — guarantees one-to-one run creation).

### `offline_production_import_batches`
Mirrors `offline_sales_import_batches`:
- `id`, `workbookId` (FK restrict, nullable for rejected), `originalFilename`, `fileSha256` UNIQUE, `byteSize`, `outageStartedAt`, `outageEndedAt`, `outageReason`, `uploadedByUserId`, `reviewedByUserId`, `status` (`uploaded|preview_ready|posting|completed|completed_with_issues|rejected`), counters `totalActions|readyActions|...|appliedActions|excludedActions`, `processingLeaseId`, `processingLeaseExpiresAt`, `lastError`, `uploadedAt`, `reviewedAt`, `completedAt`, timestamps.
- CHECK `outageStartedAt < outageEndedAt`, `byteSize > 0`, `status = 'rejected' OR workbookId IS NOT NULL`.

### `offline_production_staged_actions`
Combines attendance row + sales staged-invoice shapes:
- `id`, `batchId` (FK cascade), `workbookId` (FK restrict), `slotId` (FK restrict), `recordToken`, `rowSequenceNumber` int, `actionKind` (`create_run|start_run|log_progress|edit_log|complete|fail`), `contentHash`, `worksheetRowNumber`, `payload` jsonb (typed per actionKind, see §6), `status` (`pending|ready|duplicate|needs_review|invalid|blocked|applied|excluded`), `reasonCode`, `reasonMessage`, `issueCodes` jsonb, `issueDetails` jsonb, `warningsAcknowledged` bool default false, `appliedRunId` (FK→productionRuns set null, nullable), `appliedProductionLogId` (FK→productionProgressLogs set null, nullable), `appliedAt`, `reviewedByUserId`, `reviewedAt`, timestamps.
- UNIQUE `(workbookId, recordToken, rowSequenceNumber)`. Partial unique `(slotId, rowSequenceNumber) WHERE status = 'applied'` (durable "this action already applied" claim — attendance parity on `attendance_import_rows_imported_identity_idx`).
- INDEX `(batchId, status)`. INDEX `(slotId, rowSequenceNumber)`. CHECK `rowSequenceNumber > 0`.

### Link on the live ledger

`productionRuns` gets a new nullable `offlineProductionSlotId` column (FK→`offline_production_run_slots` restrict) with a partial unique index `production_runs_offline_slot_unique WHERE offlineProductionSlotId IS NOT NULL` — exact mirror of `invoices.offlineSalesSlotId` (sales-schema.ts:159, 171-173). Similarly, `productionProgressLogs` gets a nullable `offlineImportRowId` (FK→`offline_production_staged_actions` set null) and a partial unique index on `offlineImportIdentity` — mirror of `attendancePunches.offlineImportIdentity`. This secures the one-to-one durable binding between an offline action and the live ledger row it produced. No `offlineImportRowId` is set on rows created by the online path.

### Reconciliation issues

Deferred from v1. The `stock_reconciliation_issues` table is sales-specific (joined to `invoices`/`invoiceItems`). For production, shortfalls at apply time manifest as `status='needs_review' with 'reasonCode':'stock_shortage'` and the action is excluded — the reviewer either re-runs with corrected stock or manually excludes. A production-specific `offline_production_stock_reconciliation_issues` table may arrive in a later phase if operational friction demands it.

### Migration

`bun run db:generate` produces a migration `src/db/migrations/XXXX_offline_production_import.sql`. The schema source-inspection test will load the migration SQL and assert the partial-unique and FK index names actually generated (sales parity).

## 9. Permissions

Six new permission keys in `src/lib/rbac.ts` `PermissionKey` union and the permission registry, plus the path mapping for the offline route:

| Key | kind | Route / role |
|---|---|---|
| `manufacturing.offline.view` | route | `/manufacturing/productions/offline` |
| `manufacturing.offline.workbooks.manage` | action | issue/replace/force-retire/download |
| `manufacturing.offline.upload` | action | upload workbook |
| `manufacturing.offline.review` | action | refresh preview, exclude |
| `manufacturing.offline.post` | action | apply staged actions to live ledger |
| `manufacturing.offline.outage.confirm` | action | RESERVED (unused in v1, since outage is self-declared; kept for forward compatibility with supervisor confirmation) |

Role grants mirror existing attendance/sales offline grants:
- `super-admin` and `admin` get all six.
- Manufacturing roles that already have `manufacturing.run.manage` additionally receive offline workbooks manage + post if granted by the operator's deployment (the spec only seeds admin/super-admin; specific roles are configured via the RBAC UI at deploy time).

Six middleware instances in `src/lib/middlewares.ts`:
- `requireOfflineProductionViewMiddleware`, `requireOfflineProductionWorkbookManageMiddleware`, `requireOfflineProductionUploadMiddleware`, `requireOfflineProductionReviewMiddleware`, `requireOfflineProductionPostMiddleware`, `requireOfflineProductionOutageConfirmMiddleware`.

Navigation entry added under Manufacturing in `src/lib/constants.ts`: "Offline Production" → `/manufacturing/productions/offline`.

`src/lib/rbac.test.ts` permission enum updated with the six keys.

## 10. File structure

### Shared production-offline domain
- Create `src/lib/production/offline/contracts.ts`: enums, Zod inputs, preview/post result types, parsed-workbook types.
- Create `src/lib/production/offline/constants.ts`: template version, run/action capacities, file/ZIP limits, post limit, lease ms.
- Create `src/lib/production/offline/feature-flag.server.ts`: `isOfflineProductionEnabled` / `requireOfflineProductionEnabled` (env `OFFLINE_PRODUCTION_IMPORT_ENABLED`).
- Create `src/lib/production/offline/signing.server.ts`: snapshot hash, sign/verify manifest, sign/verify snapshot, slot token mint.
- Create `src/lib/production/offline/workflow-actors.ts`: `assertDistinctWorkflowActors` (copy; reserved for phase-2 supervisor confirmation).
- Create `src/lib/production/offline/ooxml-guard.server.ts`: strict in-memory OOXML ZIP inspection (copy attendance's hardened version).
- Create `src/lib/production/offline/workbook-template.server.ts`: build .xlsx.
- Create `src/lib/production/offline/workbook-parser.server.ts`: parse and produce typed `ParsedOfflineProductionWorkbook`.
- Create `src/lib/production/offline/preview.server.ts`: `buildAndPersistOfflineProductionPreview` — classify staged actions against live data.
- Create `src/lib/production/offline/posting.server.ts`: `postOfflineProductionBatch`, `acquireBatchLease`, `processReadyAction`, `finalizeBatch`, `safePostError`.
- Create `src/lib/production/offline/reference-snapshot.server.ts`: build the signed snapshot from live recipes/stock.
- Create `src/lib/production/offline/classification.server.ts`: pure classifier (`classifyOfflineProductionAction`).

### Shared online-core extraction
- Modify `src/server-functions/inventory/production/create-production-run-fn.ts`: extract `createProductionRunCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/start-production-fn.ts`: extract `startProductionRunCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/log-production-progress-fn.ts`: extract `logProductionProgressCore` as `createServerOnlyFn` (wraps the existing `applyProductionProgressLog` call).
- Modify `src/server-functions/inventory/production/edit-latest-production-progress-log-fn.ts`: extract `editLatestProgressLogCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/complete-production-fn.ts`: extract `completeProductionRunCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/fail-production-fn.ts`: extract `failProductionRunCore` as `createServerOnlyFn`.

The online fns continue to call the same cores via the server-fn wrappers so existing behavior is byte-identical.

### Database and permissions
- Create `src/db/schemas/offline-production-schema.ts`.
- Modify `src/db/schemas/inventory-schema.ts`: add `offlineProductionSlotId` on `productionRuns`, partial unique index. Add `offlineImportRowId` and `offlineImportIdentity` on `productionProgressLogs`, partial unique index.
- Modify `src/db/index.ts`: merge and export offline production schema.
- Generate `src/db/migrations/XXXX_offline_production_import.sql`.
- Modify `src/lib/rbac.ts`, `src/lib/authz.server.ts`, `src/lib/middlewares.ts`: six permissions + safe system-role seed sync.
- Modify `src/lib/rbac.test.ts`: extend enum.
- Modify `src/lib/constants.ts`: Offline Production navigation item.

### Server functions
- Create `src/server-functions/inventory/production/offline-workbooks-fn.ts`: issue, list, operators, list in-progress runs, download, replace, force-retire.
- Create `src/server-functions/inventory/production/offline-upload-fn.ts`: FormData upload and immutable batch creation.
- Create `src/server-functions/inventory/production/offline-review-fn.ts`: list queues, get batch, refresh preview, exclude action.
- Create `src/server-functions/inventory/production/offline-post-fn.ts`: bounded post/resume call.
- Modify `src/server-functions/reports/offline-report-status-fn.ts`: add `hasUnappliedOfflineProductionActions` field; OR compose in a sibling `offline-production-report-status-fn.ts`.
- Modify online operator screens `src/routes/_protected/operator/$runId.tsx` and `src/routes/_protected/operator/index.tsx`: render lock banner when offline batch pending; disable mutations.

### Client and route
- Create `src/hooks/production/use-offline-production.ts`: query-key factory, queries, mutations, `usePostOfflineProductionBatch` (loop cap 30, invalidate `["production-runs"]`, `["production-run", runId]`, `["operator-production-runs"]`, `["finished-goods"]`, `["factory-floor"]`, `["materials"]`, `["cartons"]`, `["production-runs-sync"]`).
- Create `src/components/manufacturing/offline/offline-production-page.tsx`: permission-driven tab shell (Workbook, Upload & Review, History) — copy `offline-sales-page.tsx` structure.
- Create `src/components/manufacturing/offline/workbook-panel.tsx`: issue/download/replace/force-retire/list.
- Create `src/components/manufacturing/offline/upload-panel.tsx`: outage datetime-local inputs, reason textarea, file input.
- Create `src/components/manufacturing/offline/review-panel.tsx`: per-slot timeline preview, exclude, refresh, post.
- Create `src/components/manufacturing/offline/import-history.tsx`: batch list.
- Create `src/routes/_protected/manufacturing/productions/offline.tsx`: route + permission-scoped loader.
- Modify `src/components/reports/offline-report-pending-banner.tsx` (or sibling): poll production status too.

### Verification
- Source-inspection tests (repo style) under `src/__tests__/` and `src/lib/production/offline/__tests__/`:
  - `offline-production-schema.test.ts`: table names, one-active-factory partial index, slot unique indexes, batch fileSha256 unique, partial-unique `applied` claim, `productionRuns.offlineProductionSlotId` partial unique + migration FK, NO `workbookBytes` blob.
  - `offline-workbooks.test.ts`: six fn middleware wiring, `requireOfflineProductionEnabled()` appears, refuse non-`in_progress` run binding, refuse wrong-operator run, refuse issue when operator already has active, replace/force-retire refuse on unresolved batches, download re-hash + verify sigs, headers `no-store`/`nosniff`, sanitized filename.
  - `offline-upload.test.ts`: xlsx boundary, `[MIN, MAX]` size, outage before/future rules, reason min 5 max 500, bytes released after parse, idempotent re-upload returns existing batch, rejected-upload path (`status:"rejected"`, `lastError:"unsafe_workbook"`, `workbookId:null`), no `readFile`/`writeFile`/`workbookBytes`.
  - `offline-review.test.ts`: refresh never mutates payload business values, exclude only on `needs_review|invalid|blocked`, preview fn wiring.
  - `offline-post.test.ts`: `requireOfflineProductionPostMiddleware` + `requireOfflineProductionEnabled()`, calls `createProductionRunCore`/`startProductionRunCore`/`applyProductionProgressLog`/`editLatestProgressLogCore`/`completeProductionRunCore`/`failProductionRunCore` (NOT reimplemented), `SELECT ... FOR UPDATE` on `productionRuns` + `materialStock` + `finishedGoodsStock` present, `hasOperatorProductionLogs` re-evaluated before offline fail, `[FAILED BATCH RECOVERY]` audit strings preserved (if applicable), safe-error allow-list.
  - `use-offline-production.test.ts`: query keys, cross-domain invalidation list.
  - Banner test: `refetchInterval:30_000` + `hasUnappliedOfflineProductionActions` shared with the sales branch.

## 11. Edge cases and invariants

### State machine (offline-applied, identical to online)
```
(none) ──create_run──> scheduled ──start_run──> in_progress ──log_progress(×N)──> in_progress
                                                       │
                                        ┌──────────────┼──────────────┐
                                        │              │              │
                                  edit_log         complete        fail
                                        │              │         (only if !hasOperatorLogs
                                  rollback            │          re-checked live)
                                  +reapply             │
                                        │              │              │
                                        ▼              ▼              ▼
                                   in_progress    completed      failed (recovery
                                   (or auto-     (shortfall       handled online
                                    complete)     allowed)        later)
```
- `completed` and `failed` are terminal for management.
- Run delete (online only) still forbids `completed` and `in_progress`.
- Cancel is online-only (offline omits it).

### Cross-action ordering within a slot
Staged actions for a slot are evaluated in `rowSequenceNumber` order. The classification treats the cumulative units (live `completedUnits` + Σ `ready log_progress` units) as the virtual state for the Nth action's classification. At apply time, the lock on `productionRuns` plus the `ready`-claim atomicity guarantees the same order is observed live.

### Idempotency
- File-level: `fileSha256` UNIQUE on `offline_production_import_batches` returns the existing batch on re-upload (sales parity).
- Action-level: partial unique `(slotId, rowSequenceNumber) WHERE status='applied'` fires a PG unique-violation on re-delivery → `markDuplicate` with `reasonCode:"already_applied"` (attendance parity on `attendance_import_rows_imported_identity_idx`).
- Complete-level: `completeProductionRunCore` early-returns when the run is already `completed` (online parity).
- Lab reports: out of scope (cannot be edited offline in v1).

### Concurrency
- One operator → no two-batch interleaving. The batch lease still serializes attempts to post the same batch in two sessions (e.g., two browser tabs).
- `SELECT FOR UPDATE` on `productionRuns` during every apply tx — fixes the online race during the offline path. The online path is unchanged and remains racy under concurrent operators, which is acceptable today (only one operator exists), but documented as a known gap.
- `SELECT FOR UPDATE` on `materialStock` rows at factory floor before any decrement (chemical or packaging).
- `SELECT FOR UPDATE` on `finishedGoodsStock` before any FG mutation.

### TOCTOU
- Every apply re-classifies live inside the locked tx (attendance parity). If the live state diverged from classification time, the action is marked and skipped — never applied against stale data.
- `hasOperatorProductionLogs` is re-evaluated server-side inside the tx before `fail` applies (online parity). The offline fail's staged `ready` classification is allowed only if `Σ log_progress units === 0 AND run.completedUnits === 0`.
- `edit_log` re-checks "only latest log by `(createdAt desc, id desc)`" inside the locked tx.

### Tamper resistance
- Snapshot hash re-verified on upload and download (sales parity).
- `safePostError` allow-list filter on apply failures (sales parity) — never echo raw DB internals to the UI.
- Client-provided `operatorId`/`initiatorId`/`createdById`/`performedById` ignored; always stamped from `context.session.user.id` at the server-fn layer.

### Audit and ledger strings
- The audit-log reason strings of the online core helpers are reused unchanged — `[FAILED BATCH RECOVERY]`/`[FAILED BATCH LOSS]`, `Production run <batchId> started`, `Production run <batchId> completed.`, `Production run <batchId> auto-completed.`. Any downstream report that greps these strings continues to work.
- The `offlineImportRowId`/`offlineImportIdentity` written on `productionProgressLogs` mirrors `attendancePunches` and the `invoices.offlineSalesSlotId` pattern — gives an auditable traceback to the offline action row.

### Operator screen lock
- While `hasUnappliedOfflineProductionActions` is true for the operator, the online operator screen renders a lock banner ("Offline batch pending sync. Apply it before logging progress online.") and disables the log/complete/fail buttons. The lock prevents divergence between online-applied and offline-applied actions for the same run.

## 12. Things this design deliberately does NOT do

- No parallel reimplementation of production logic. Every offline-applied action calls the extracted online core helper under a `db.transaction` with stricter locking.
- No supervisor-confirmed outage window (v1; phase 2 may opt in — the schema reserves the `outage.confirm` permission and the `workflow-actors.ts` helper).
- No offline cancel.
- No offline lab reports.
- No offline failed-batch recovery (handled by the existing online recovery flow after the run fails online).
- No production-specific `stock_reconciliation_issues` table in v1 (needs_review + exclude covers it; a dedicated reconciliation table is a phase-2 option).
- No persistence of file bytes, ever (memory-only parse, bytes dereferenced).
- No changes to `src/routeTree.gen.ts`.
- No changes to existing online tests beyond the minimal extraction scaffolding (the extracted `*Core` helpers are wrapped by the original server fns, so online behavior is byte-identical).

## 13. Phase breakdown (informational; the writing-plans skill produces the formal task-level plan)

- Phase 0 — Foundation: feature flag, constants, RBAC + six permissions + nav + workflow-actors stub.
- Phase 1 — Schema + workbook issuance: schema, migration, signing, reference-snapshot, issue/replace/force-retire/download, workbook template, workbook parser.
- Phase 2 — Upload + review: upload (idempotent), preview classification with cross-action sequencer, refresh, exclude.
- Phase 3 — Online-core extraction + post: extract six `*Core` helpers; post applier with `FOR UPDATE` + leasing + per-action tx + cross-domain invalidation; UI page + route + hooks; operator screen lock.
- Phase 4 — Pending banner + housekeeping: report-status fn, banner poll, delete-batch for `rejected|cancelled|completed`.
- Phase 5 (future) — Lab reports offline, optional production reconciliation issues, optional supervisor-confirmed outage.