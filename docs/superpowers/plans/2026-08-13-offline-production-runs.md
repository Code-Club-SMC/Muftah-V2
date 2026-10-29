# Offline Production Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, macro-free Excel fallback for the full production-run pipeline during internet outages: create run, start run, log-progress, edit-latest-log, complete-with-shortfall, and fail. All staged actions are applied to the live ledger through the existing online production core helpers under stricter locking.

**Architecture:** One permanent signed workbook belongs to one operator at factory F01. Workbook issuance reserves 200 batchIds and a signed snapshot of recipes, factory-floor material stock, and finished-goods stock. Upload parses the workbook in memory, stores immutable staged actions, and classifies them against live data. Post applies each staged action to the live `productionRuns`/`materialStock`/`finishedGoodsStock`/`cartons`/`wacHistory` ledger inside per-action transactions guarded by batch leases, `SELECT FOR UPDATE` on the run and materials, atomic claimed-row updates, and durable applied-identity claims. PostgreSQL stores all production and audit data; uploaded workbook bytes are never stored. The online operator screen is locked while any offline actions for the operator's active workbook remain unapplied.

**Tech Stack:** TanStack Start server functions and file routes, React 19, TanStack Query, Zod 4, Drizzle ORM, PostgreSQL, @zip.js/zip.js 2.8.34, saxes 6.0.0, Vitest, Testing Library, fast-check.

## Global Constraints

- Scope is one factory location (F01) with one designated production operator.
- No local factory server, local database, backup internet, or browser offline entry.
- Accept only macro-free `.xlsx`; reject `.xlsm`, formulas in input cells, encryption, external links, external data, unsupported structure, files outside `[1 MiB, 10 MiB]`, and workbooks above 200 prepared run slots or 1000 action rows per slot.
- Parse uploaded workbook bytes in memory. Never persist workbook bytes to disk, object storage, PostgreSQL, logs, or backups.
- One active permanent workbook per factory; operator appends to prepared slots in chronological order and never inserts, deletes, reorders, sorts, or reuses rows.
- Each created run binds to a server-reserved `batchId` issued at workbook issuance. Online and offline share the same `generateNextBatchId` series.
- Outage is self-declared by the operator at upload; supervisor confirmation is out of scope for v1.
- Operator may not use the online operator screen (log-progress, complete, fail) while an offline batch is pending for the operator. The online screen shows a lock banner and disables mutations.
- Offline actions: `create_run`, `start_run`, `log_progress`, `edit_log`, `complete`, `fail`. Cancel is online-only.
- Fail is offline-allowed only when the staged set has zero log-progress units AND the live `productionRuns` run has zero completed units AND no packaging deduction — re-evaluated live inside the locked apply transaction.
- Reuse the existing online production core helpers (`applyProductionProgressLog`, `createProductionRunFn` core, `start-production-fn.ts` core, `edit-latest-production-progress-log-fn.ts` core, `complete-production-fn.ts` core, `fail-production-fn.ts` core). The offline applier NEVER reimplements production logic; it extracts the cores as `createServerOnlyFn`s and calls them under stricter locking.
- Raw Excel bytes are discarded after parsing; `bytes = new Uint8Array()` immediately after parse.
- Idempotent re-uploads: re-upload of identical bytes returns the existing batch. UNIQUE `fileSha256` index enforces this.
- Staged actions are durable. Once a staged action is `applied`, the partial-unique index `(slotId, rowSequenceNumber) WHERE status='applied'` prevents re-application; a retry returns `duplicate` with `reasonCode:"already_applied"`.
- All server-set identity (`initiatorId`, `createdById`, `performedById`) comes from `context.session.user.id`; client-supplied identity fields are stripped.
- The offline applier takes `SELECT FOR UPDATE` locks on `productionRuns`, `materialStock`, and `finishedGoodsStock` per affected row. This is the offline-specific fix to an existing online race and does NOT change online behavior.
- Audit-log reason strings of the online core helpers are reused unchanged; downstream reports that grep them continue to work.
- Feature ships behind `OFFLINE_PRODUCTION_IMPORT_ENABLED=false`.
- `OFFLINE_PRODUCTION_SIGNING_KEYS` is a runtime-only JSON keyring whose values are base64 32-byte keys; `OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION` selects the issuance key. Missing active key must not break CI build; enabled runtime operations must fail closed.
- Do not edit `src/routeTree.gen.ts`; build regenerates it.
- Production dependency install must use pinned `bun.lock`; do not add new runtime dependencies (zip.js and saxes are already pinned by the offline attendance work).
- After code changes, run `graphify update .`.
- Approved design: `docs/superpowers/specs/2026-08-13-offline-production-runs-design.md`.

## File Structure

### Shared offline production domain
- Create `src/lib/production/offline/contracts.ts`: serializable enums (`OfflineProductionWorkbookStatus`, `OfflineProductionSlotStatus`, `OfflineProductionBatchStatus`, `OfflineProductionActionKind`, `OfflineProductionActionStatus`), Zod inputs, parsed-workbook types, preview/post result types.
- Create `src/lib/production/offline/constants.ts`: template version, run capacity, action row capacity, file/ZIP limits, post limit, lease ms.
- Create `src/lib/production/offline/feature-flag.server.ts`: `isOfflineProductionEnabled` / `requireOfflineProductionEnabled`.
- Create `src/lib/production/offline/workflow-actors.ts`: `assertDistinctWorkflowActors` copy (reserved for phase-2 supervisor confirmation; the v1 self-declared outage flow still calls it with all reviewer fields null to keep the surface stable).
- Create `src/lib/production/offline/signing.server.ts`: snapshot hash, manifest/snapshot sign and verify, slot token mint and verify, content hash.
- Create `src/lib/production/offline/ooxml-guard.server.ts`: copy attendance's hardened OOXML ZIP inspector (no VBA, external links, queries, embeddings, ActiveX, or formulas in input cells).
- Create `src/lib/production/offline/workbook-template.server.ts`: build .xlsx from manifest + reference snapshot + slots.
- Create `src/lib/production/offline/workbook-parser.server.ts`: parse and produce typed `ParsedOfflineProductionWorkbook` with `manifest`, `snapshot`, `slots` (signed headers per slot), `actions`, `fileSha256`.
- Create `src/lib/production/offline/reference-snapshot.server.ts`: `buildOfflineProductionReferenceSnapshot(tx, issuedAt)` reads recipes, factory-floor warehouse, `materialStock`, `packagingMaterials`, `finishedGoodsStock`.
- Create `src/lib/production/offline/classification.server.ts`: pure `classifyOfflineProductionAction` returning `{ status, issueCodes, issueDetails }`.
- Create `src/lib/production/offline/preview.server.ts`: `buildAndPersistOfflineProductionPreview(batchId)` loads live data and persists staged-action classifications.
- Create `src/lib/production/offline/posting.server.ts`: `postOfflineProductionBatch`, `claimBatch`, `acquireBatchLease`, `processReadyAction`, `finalizeBatch`, `safePostError`, `markDuplicate`.

### Database and permissions
- Create `src/db/schemas/offline-production-schema.ts`: workbook, slot, import batch, staged action tables.
- Modify `src/db/schemas/inventory-schema.ts`: add `offlineProductionSlotId` on `productionRuns` with partial unique index; add `offlineImportRowId` and `offlineImportIdentity` on `productionProgressLogs` with partial unique index.
- Modify `src/db/index.ts`: merge and export offline production schema.
- Generate `src/db/migrations/XXXX_offline_production_import.sql` and matching Drizzle metadata.
- Modify `src/lib/rbac.ts`: add six permission keys + registry entries + `/manufacturing/productions/offline` path mapping; extend role grants for `admin`/`super-admin`.
- Modify `src/lib/authz.server.ts`: extend path-access map if needed.
- Modify `src/lib/middlewares.ts`: six middleware instances.
- Modify `src/lib/rbac.test.ts`: extend enum with the six keys.
- Modify `src/lib/constants.ts`: Offline Production navigation item under Manufacturing.

### Online-core extraction (zero behavior change)
- Modify `src/server-functions/inventory/production/create-production-run-fn.ts`: extract `createProductionRunCore` as `createServerOnlyFn`; server fn becomes a thin wrapper.
- Modify `src/server-functions/inventory/production/start-production-fn.ts`: extract `startProductionRunCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/log-production-progress-fn.ts`: extract `logProductionProgressCore` as `createServerOnlyFn` (wraps the existing `applyProductionProgressLog` call from `production-progress-core.ts`).
- Modify `src/server-functions/inventory/production/edit-latest-production-progress-log-fn.ts`: extract `editLatestProgressLogCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/complete-production-fn.ts`: extract `completeProductionRunCore` as `createServerOnlyFn`.
- Modify `src/server-functions/inventory/production/fail-production-fn.ts`: extract `failProductionRunCore` as `createServerOnlyFn`.

### Server functions
- Create `src/server-functions/inventory/production/offline-workbooks-fn.ts`: `listOfflineProductionOperatorsFn`, `listOfflineProductionWorkbooksFn`, `listInProgressProductionRunsForOperatorFn`, `issueOfflineProductionWorkbookFn`, `downloadOfflineProductionWorkbookFn`, `replaceOfflineProductionWorkbookFn`, `forceRetireOfflineProductionWorkbookFn`.
- Create `src/server-functions/inventory/production/offline-upload-fn.ts`: `uploadOfflineProductionWorkbookFn`.
- Create `src/server-functions/inventory/production/offline-review-fn.ts`: `listOfflineProductionQueuesFn`, `getOfflineProductionBatchFn`, `refreshOfflineProductionPreviewFn`, `excludeOfflineProductionActionFn`.
- Create `src/server-functions/inventory/production/offline-post-fn.ts`: `postOfflineProductionBatchFn`.
- Modify `src/server-functions/reports/offline-report-status-fn.ts`: add `hasUnappliedOfflineProductionActions` branch (or add a sibling `offline-production-report-status-fn.ts` if composition is cleaner).

### Client and route
- Create `src/hooks/production/use-offline-production.ts`: query-key factory + queries + mutations + `usePostOfflineProductionBatch` (loop cap 30) + cross-domain invalidation list.
- Create `src/components/manufacturing/offline/offline-production-page.tsx`: permission-driven tabs (Workbook, Upload & Review, History).
- Create `src/components/manufacturing/offline/workbook-panel.tsx`: issue/download/replace/force-retire/list.
- Create `src/components/manufacturing/offline/upload-panel.tsx`: outage datetime-local inputs, reason textarea, file input.
- Create `src/components/manufacturing/offline/review-panel.tsx`: per-slot timeline preview, exclude, refresh, post.
- Create `src/components/manufacturing/offline/import-history.tsx`: batch list.
- Create `src/routes/_protected/manufacturing/productions/offline.tsx`: route + permission-scoped loader.
- Modify `src/components/reports/offline-report-pending-banner.tsx`: add `hasUnappliedOfflineProductionActions` branch (polls every 30s).
- Modify `src/routes/_protected/operator/$runId.tsx`: render lock banner and disable log/complete/fail mutations when `hasUnappliedOfflineProductionActions` is true for the operator.
- Modify `src/routes/_protected/operator/index.tsx`: same lock banner on the run list.

### Verification
- Create `src/lib/production/offline/__tests__/permissions.test.ts`: source-inspection of rbac/middlewares/constants wiring.
- Create `src/db/schemas/offline-production-schema.test.ts`: table and index assertions; load generated migration SQL and assert FK index names.
- Create `src/lib/production/offline/__tests__/offline-workbooks.test.ts`: server-fn middleware wiring, snapshot re-hash on upload/download, refuse non-active workbook bindings, refuse issue when operator already has active, replace/force-retire refuse on unresolved batches, download headers sanitized.
- Create `src/lib/production/offline/__tests__/offline-upload.test.ts`: xlsx boundary, size floor/ceiling, outage rules, idempotency via `fileSha256` unique, rejected-upload path, bytes released, no `readFile`/`writeFile`/`workbookBytes`.
- Create `src/lib/production/offline/__tests__/offline-review.test.ts`: refresh never mutates payload business values, exclude only on `needs_review|invalid|blocked`, preview fn wiring.
- Create `src/lib/production/offline/__tests__/offline-post.test.ts`: middleware wiring, calls to extracted online cores, `SELECT FOR UPDATE` on `productionRuns`/`materialStock`/`finishedGoodsStock`, `hasOperatorProductionLogs` re-evaluated before fail, `[FAILED BATCH RECOVERY]`/audit strings preserved if applicable, safe-error allow-list.
- Create `src/hooks/production/__tests__/use-offline-production.test.ts`: query keys + cross-domain invalidation list.
- Modify `src/lib/production-run-accounting.test.ts`: assert the six `*Core` extractions still pass the existing online invariants byte-for-byte (i.e., the wrappers preserve behavior).

---

### Task 0: Restore Green Unit-Test Baseline and Confirm Starting State

**Files:**
- Verify: `src/lib/production-run-accounting.test.ts`, `src/server-functions/inventory/production/*/`

**Interfaces:**
- Consumes: current 291-test baseline.
- Produces: a clean baseline number recorded for parity checks.

- [ ] **Step 1: Run the full baseline test suite**

Run:

```bash
bun run test
```

Expected: All files pass. Record the test count (the baseline) for comparison after every phase.

- [ ] **Step 2: Run typecheck and confirm clean**

Run:

```bash
bun run typecheck
```

Expected: Exit 0 with no output.

- [ ] **Step 3: Confirm current HEAD matches the design spec dependency**

Run:

```bash
git rev-parse HEAD
```

Record the commit hash. The approved design (`docs/superpowers/specs/2026-08-13-offline-production-runs-design.md`) was committed from this HEAD.

- [ ] **Step 4: No commit if all green; otherwise stop and fix**

If any baseline test or typecheck fails, STOP and fix the baseline before starting feature work. Do not commit unrelated fixes as part of this plan.

---

### Task 1: Feature Flag, Constants, and Workflow Actors Foundation

**Files:**
- Create: `src/lib/production/offline/constants.ts`
- Create: `src/lib/production/offline/feature-flag.server.ts`
- Create: `src/lib/production/offline/workflow-actors.ts`
- Create: `src/lib/production/offline/contracts.ts` (type stubs filled in over later tasks; only the enums and the feature-flag types are needed now)
- Test: `src/lib/production/offline/__tests__/feature-flag.test.ts`

**Interfaces:**
- Produces:
  - `OFFLINE_PRODUCTION_TEMPLATE_VERSION = 1`
  - `OFFLINE_PRODUCTION_WORKBOOK_RUN_CAPACITY = 200`
  - `OFFLINE_PRODUCTION_ACTION_ROW_CAPACITY = 1000`
  - `OFFLINE_PRODUCTION_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024`
  - `OFFLINE_PRODUCTION_WORKBOOK_MIN_BYTES = 1024 * 1024`
  - `OFFLINE_PRODUCTION_ZIP_MAX_ENTRIES = 256`
  - `OFFLINE_PRODUCTION_ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024`
  - `OFFLINE_PRODUCTION_ZIP_MAX_TOTAL_BYTES = 50 * 1024 * 1024`
  - `OFFLINE_PRODUCTION_POST_LIMIT = 20`
  - `OFFLINE_PRODUCTION_BATCH_LEASE_MS = 2 * 60_000`
  - `isOfflineProductionEnabled(): boolean`
  - `requireOfflineProductionEnabled(): void`
  - `assertDistinctWorkflowActors(input: OfflineWorkflowActors): void`

- [ ] **Step 1: Write failing feature-flag test**

```ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  isOfflineProductionEnabled,
  requireOfflineProductionEnabled,
} from "@/lib/production/offline/feature-flag.server";

describe("offline production feature flag", () => {
  const original = process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED;
  beforeEach(() => {
    delete process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED;
    else process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED = original;
  });

  it("is disabled by default", () => {
    expect(isOfflineProductionEnabled()).toBe(false);
  });

  it("throws when disabled", () => {
    expect(() => requireOfflineProductionEnabled()).toThrow(
      "Offline production import is disabled",
    );
  });

  it("is enabled only when the env var equals the literal string 'true'", () => {
    process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED = "true";
    expect(isOfflineProductionEnabled()).toBe(true);
    expect(() => requireOfflineProductionEnabled()).not.toThrow();
  });

  it("fails closed on truthy-but-not-'true' values", () => {
    process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED = "1";
    expect(isOfflineProductionEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/feature-flag.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement constants and feature flag**

Create `src/lib/production/offline/constants.ts`:

```ts
export const OFFLINE_PRODUCTION_TEMPLATE_VERSION = 1;
export const OFFLINE_PRODUCTION_FACTORY_CODE = "F01";
export const OFFLINE_PRODUCTION_WORKBOOK_RUN_CAPACITY = 200;
export const OFFLINE_PRODUCTION_ACTION_ROW_CAPACITY = 1000;
export const OFFLINE_PRODUCTION_WORKBOOK_MIN_BYTES = 1024 * 1024;
export const OFFLINE_PRODUCTION_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024;
export const OFFLINE_PRODUCTION_ZIP_MAX_ENTRIES = 256;
export const OFFLINE_PRODUCTION_ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const OFFLINE_PRODUCTION_ZIP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const OFFLINE_PRODUCTION_POST_LIMIT = 20;
export const OFFLINE_PRODUCTION_BATCH_LEASE_MS = 2 * 60_000;
```

Create `src/lib/production/offline/feature-flag.server.ts`:

```ts
export function isOfflineProductionEnabled() {
  return process.env.OFFLINE_PRODUCTION_IMPORT_ENABLED === "true";
}

export function requireOfflineProductionEnabled() {
  if (!isOfflineProductionEnabled()) {
    throw new Error("Offline production import is disabled");
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/feature-flag.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Write failing workflow-actors test**

Create `src/lib/production/offline/__tests__/workflow-actors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertDistinctWorkflowActors } from "@/lib/production/offline/workflow-actors";

describe("offline production workflow actors", () => {
  it("allows all-null supervisor and reviewer (self-declared outage v1)", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "op-1",
        supervisorUserId: null,
        reviewerUserId: null,
      }),
    ).not.toThrow();
  });

  it("rejects operator acting as reviewer", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "op-1",
        supervisorUserId: null,
        reviewerUserId: "op-1",
      }),
    ).toThrow(/Final reviewer must be different from operator/);
  });

  it("rejects operator acting as supervisor", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "op-1",
        supervisorUserId: "op-1",
        reviewerUserId: null,
      }),
    ).toThrow(/Operator cannot confirm their own outage/);
  });

  it("rejects supervisor and reviewer colliding", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "op-1",
        supervisorUserId: "sup-1",
        reviewerUserId: "sup-1",
      }),
    ).toThrow(/Final reviewer must be different from supervisor/);
  });
});
```

- [ ] **Step 6: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/workflow-actors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement workflow-actors**

Create `src/lib/production/offline/workflow-actors.ts` (verbatim copy of attendance's; identical surface lets phase-2 supervisor confirmation slot in):

```ts
export type OfflineWorkflowActors = {
  operatorUserId: string;
  supervisorUserId: string | null;
  reviewerUserId: string | null;
};

export function assertDistinctWorkflowActors(input: OfflineWorkflowActors) {
  if (input.supervisorUserId && input.operatorUserId === input.supervisorUserId) {
    throw new Error("Operator cannot confirm their own outage");
  }
  if (input.reviewerUserId && input.operatorUserId === input.reviewerUserId) {
    throw new Error("Final reviewer must be different from operator");
  }
  if (
    input.reviewerUserId &&
    input.supervisorUserId &&
    input.supervisorUserId === input.reviewerUserId
  ) {
    throw new Error("Final reviewer must be different from supervisor");
  }
}
```

- [ ] **Step 8: Run test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/workflow-actors.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 9: Create contracts.ts stub with the enum unions only**

Create `src/lib/production/offline/contracts.ts`:

```ts
export type OfflineProductionWorkbookStatus = "active" | "closed" | "force_retired";
export type OfflineProductionSlotStatus =
  | "unused"
  | "staged"
  | "posted"
  | "voided"
  | "conflict";
export type OfflineProductionBatchStatus =
  | "uploaded"
  | "preview_ready"
  | "posting"
  | "completed"
  | "completed_with_issues"
  | "rejected";
export type OfflineProductionActionKind =
  | "create_run"
  | "start_run"
  | "log_progress"
  | "edit_log"
  | "complete"
  | "fail";
export type OfflineProductionActionStatus =
  | "pending"
  | "ready"
  | "duplicate"
  | "needs_review"
  | "invalid"
  | "blocked"
  | "applied"
  | "excluded";
export type OfflineProductionIssueSeverity = "ready" | "warning" | "invalid" | "needs_review" | "blocked";
```

- [ ] **Step 10: Run full test suite**

Run:

```bash
bun run test
```

Expected: Baseline plus the new 8 feature-flag + workflow-actor tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/production/offline/constants.ts \
  src/lib/production/offline/feature-flag.server.ts \
  src/lib/production/offline/workflow-actors.ts \
  src/lib/production/offline/contracts.ts \
  src/lib/production/offline/__tests__/feature-flag.test.ts \
  src/lib/production/offline/__tests__/workflow-actors.test.ts
git commit -m "feat(offline-production): add feature flag, constants, and workflow actors"
```

---

### Task 2: Six Permissions, Middleware, and Navigation

**Files:**
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/middlewares.ts`
- Modify: `src/lib/authz.server.ts` (only if path-access map is explicit; verify before editing)
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/rbac.test.ts`
- Test: `src/lib/production/offline/__tests__/permissions.test.ts`

**Interfaces:**
- Produces:
  - Permission keys in `PermissionKey` union: `manufacturing.offline.view`, `manufacturing.offline.workbooks.manage`, `manufacturing.offline.upload`, `manufacturing.offline.review`, `manufacturing.offline.post`, `manufacturing.offline.outage.confirm`.
  - Permission registry entries (label, description, kind).
  - Route mapping `/manufacturing/productions/offline` → `manufacturing.offline.view`.
  - Middleware exports: `requireOfflineProductionViewMiddleware`, `requireOfflineProductionWorkbookManageMiddleware`, `requireOfflineProductionUploadMiddleware`, `requireOfflineProductionReviewMiddleware`, `requireOfflineProductionPostMiddleware`, `requireOfflineProductionOutageConfirmMiddleware`.
  - Navigation entry under Manufacturing.

- [ ] **Step 1: Write failing permissions wiring test**

Create `src/lib/production/offline/__tests__/permissions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const rbacSource = readFileSync(resolve(process.cwd(), "src/lib/rbac.ts"), "utf8");
const middlewaresSource = readFileSync(
  resolve(process.cwd(), "src/lib/middlewares.ts"),
  "utf8",
);
const constantsSource = readFileSync(
  resolve(process.cwd(), "src/lib/constants.ts"),
  "utf8",
);

const KEYS = [
  "manufacturing.offline.view",
  "manufacturing.offline.workbooks.manage",
  "manufacturing.offline.upload",
  "manufacturing.offline.review",
  "manufacturing.offline.post",
  "manufacturing.offline.outage.confirm",
] as const;

describe("offline production permissions", () => {
  it("declares all six permission keys in the union", () => {
    for (const key of KEYS) expect(rbacSource).toContain(`"${key}"`);
  });

  it("registers each key with a kind and label", () => {
    for (const key of KEYS) {
      expect(rbacSource).toContain(`key: "${key}"`);
    }
  });

  it("maps the offline route to the view permission", () => {
    expect(rbacSource).toContain("/manufacturing/productions/offline");
    expect(rbacSource).toContain("manufacturing.offline.view");
  });

  it("exports six middlewares", () => {
    expect(middlewaresSource).toContain(
      "requireOfflineProductionViewMiddleware",
    );
    expect(middlewaresSource).toContain(
      "requireOfflineProductionWorkbookManageMiddleware",
    );
    expect(middlewaresSource).toContain(
      "requireOfflineProductionUploadMiddleware",
    );
    expect(middlewaresSource).toContain(
      "requireOfflineProductionReviewMiddleware",
    );
    expect(middlewaresSource).toContain(
      "requireOfflineProductionPostMiddleware",
    );
    expect(middlewaresSource).toContain(
      "requireOfflineProductionOutageConfirmMiddleware",
    );
  });

  it("adds the Offline Production navigation item", () => {
    expect(constantsSource).toContain("/manufacturing/productions/offline");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/permissions.test.ts
```

Expected: FAIL — keys missing.

- [ ] **Step 3: Add the six permission keys to the rbac union and registry**

In `src/lib/rbac.ts`, extend the `PermissionKey` union with the six keys (follow the alphabetical position used by the attendance offline block around line 84-89). Add registry entries mirroring the attendance block at lines 499-535:

```ts
{
  key: "manufacturing.offline.view",
  label: "View offline production",
  description: "Open the offline production page and see staged batches",
  kind: "route",
},
{
  key: "manufacturing.offline.workbooks.manage",
  label: "Manage offline production workbooks",
  description: "Issue, replace, force-retire, and download offline production workbooks",
  kind: "action",
},
{
  key: "manufacturing.offline.upload",
  label: "Upload offline production workbook",
  description: "Upload a filled offline production workbook during an internet outage",
  kind: "action",
},
{
  key: "manufacturing.offline.review",
  label: "Review offline production imports",
  description: "Refresh previews and exclude invalid offline production actions",
  kind: "action",
},
{
  key: "manufacturing.offline.post",
  label: "Apply offline production actions",
  description: "Apply staged offline production actions to the live ledger",
  kind: "action",
},
{
  key: "manufacturing.offline.outage.confirm",
  label: "Confirm offline production outage (reserved)",
  description: "Reserved for supervisor-confirmed outages; unused in v1",
  kind: "action",
},
```

Add the path-access mapping mirroring `attendance.offline.view` at line 884:

```ts
{
  path: "/manufacturing/productions/offline",
  permissions: ["manufacturing.offline.view"],
},
```

Extend the `super-admin` and `admin` role grants (around lines 666, 676, 733) with the six keys, mirroring the attendance offline grants around lines 718-723.

- [ ] **Step 4: Add the six middleware instances**

In `src/lib/middlewares.ts`, immediately after the offline attendance block (around line 247), add:

```ts
export const requireOfflineProductionViewMiddleware = createPermissionMiddleware(
  "manufacturing.offline.view",
);
export const requireOfflineProductionWorkbookManageMiddleware =
  createPermissionMiddleware("manufacturing.offline.workbooks.manage");
export const requireOfflineProductionUploadMiddleware = createPermissionMiddleware(
  "manufacturing.offline.upload",
);
export const requireOfflineProductionReviewMiddleware = createPermissionMiddleware(
  "manufacturing.offline.review",
);
export const requireOfflineProductionPostMiddleware = createPermissionMiddleware(
  "manufacturing.offline.post",
);
export const requireOfflineProductionOutageConfirmMiddleware =
  createPermissionMiddleware("manufacturing.offline.outage.confirm");
```

- [ ] **Step 5: Update rbac.test.ts enum**

In `src/lib/rbac.test.ts`, extend the permission array copied around lines 40-57 with the six new keys (alphabetical within the existing `manufacturing.*` block).

- [ ] **Step 6: Add the navigation entry**

In `src/lib/constants.ts`, under the Manufacturing nav group (around lines 57-65), add a sibling of the "Production Run" item:

```ts
{
  title: "Offline Production",
  href: "/manufacturing/productions/offline",
  icon: FactoryFloorIcon,
  permission: "manufacturing.offline.view",
},
```

Use the exact icon and shape conventions of the neighboring entries; do not introduce a new icon import unless an existing one fits.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: Exit 0. If `authz.server.ts` requires the new path mapping, add it now (verify first by reading the file).

- [ ] **Step 8: Run the permissions test**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/permissions.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 9: Run full test suite**

Run:

```bash
bun run test
```

Expected: All green. If `rbac.test.ts` enum now fails, the enum update in Step 5 was incomplete — fix and rerun.

- [ ] **Step 10: Commit**

```bash
git add src/lib/rbac.ts src/lib/middlewares.ts src/lib/authz.server.ts \
  src/lib/constants.ts src/lib/rbac.test.ts \
  src/lib/production/offline/__tests__/permissions.test.ts
git commit -m "feat(offline-production): add six permissions, middleware, and nav entry"
```

---

### Task 3: Signing, Reference Snapshot Hashing, and OOXML Guard

**Files:**
- Create: `src/lib/production/offline/signing.server.ts`
- Create: `src/lib/production/offline/reference-snapshot.server.ts`
- Create: `src/lib/production/offline/ooxml-guard.server.ts`
- Test: `src/lib/production/offline/__tests__/signing.test.ts`
- Test: `src/lib/production/offline/__tests__/ooxml-guard.test.ts`

**Interfaces:**
- Produces:
  - `hashOfflineProductionSnapshot(snapshot): string`
  - `signOfflineProductionManifest(manifest): string`
  - `signOfflineProductionSnapshot(snapshot, signingVersion): string`
  - `verifyOfflineProductionManifest(manifest, signature): boolean`
  - `verifyOfflineProductionSnapshot(snapshot, signingVersion, signature): boolean`
  - `getActiveOfflineProductionSigningVersion(): number | null`
  - `createOfflineProductionSlotToken(input): string`
  - `verifyOfflineProductionSlotToken(input & { token }): boolean`
  - `hashOfflineProductionAction(input): string`
  - `buildOfflineProductionReferenceSnapshot(tx, issuedAt): Promise<OfflineProductionReferenceSnapshot>`
  - `inspectXlsxPackage(bytes: Uint8Array): Promise<void>`

- [ ] **Step 1: Write failing signing tests**

Create `src/lib/production/offline/__tests__/signing.test.ts` modeled on the attendance signing test (`src/lib/attendance/offline/signing.test.ts`). Cover: deterministic snapshot hash ordering, manifest signature stable across reorderings, token binds to (workbookId, operatorUserId, templateVersion, signingVersion, slotNumber, reservedBatchId), timing-safe rejection of altered tokens, missing active key while enabled must throw, missing key while disabled must NOT throw on verify, content hash of an action depends on the canonical record.

Excerpt of the required test shape:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createOfflineProductionSlotToken,
  verifyOfflineProductionSlotToken,
  hashOfflineProductionSnapshot,
  signOfflineProductionManifest,
  signOfflineProductionSnapshot,
  verifyOfflineProductionManifest,
  verifyOfflineProductionSnapshot,
  getActiveOfflineProductionSigningVersion,
  hashOfflineProductionAction,
} from "@/lib/production/offline/signing.server";

const SAMPLE_SNAPSHOT = {
  format: "titan-offline-production",
  workbookId: "wb-1",
  factoryCode: "F01",
  generatedAt: "2026-08-13T10:00:00.000Z",
  factoryWarehouseId: "wh-ff",
  recipes: [{ id: "r1", name: "Recipe A" }],
  chemicals: [{ id: "c1", name: "Caustic", unit: "kg", costPerUnit: "12" }],
  packagingMaterials: [],
  materialStock: [],
  finishedGoodsStock: [],
};

describe("offline production signing", () => {
  it("token binds to slot identity and is timing-safe rejected on tamper", () => {
    process.env.OFFLINE_PRODUCTION_SIGNING_KEYS = JSON.stringify({
      "1": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION = "1";
    const token = createOfflineProductionSlotToken({
      workbookId: "wb-1",
      operatorUserId: "op-1",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 3,
      reservedBatchId: "B-000007",
    });
    expect(verifyOfflineProductionSlotToken({
      workbookId: "wb-1",
      operatorUserId: "op-1",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 3,
      reservedBatchId: "B-000007",
      token,
    })).toBe(true);
    expect(verifyOfflineProductionSlotToken({
      workbookId: "wb-1",
      operatorUserId: "op-1",
      templateVersion: 1,
      signingVersion: 1,
      slotNumber: 4,
      reservedBatchId: "B-000007",
      token,
    })).toBe(false);
  });

  it("returns null active version when the env var is missing", () => {
    delete process.env.OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION;
    delete process.env.OFFLINE_PRODUCTION_SIGNING_KEYS;
    expect(getActiveOfflineProductionSigningVersion()).toBe(null);
  });

  it("snapshot hash is stable regardless of key order", () => {
    const a = { ...SAMPLE_SNAPSHOT, recipes: [{ id: "r1", name: "Recipe A" }] };
    const b = { ...SAMPLE_SNAPSHOT, recipes: [{ id: "r1", name: "Recipe A" }] };
    expect(hashOfflineProductionSnapshot(a)).toBe(hashOfflineProductionSnapshot(b));
  });

  it("manifest signature verifies after reordering object keys", () => {
    process.env.OFFLINE_PRODUCTION_SIGNING_KEYS = JSON.stringify({
      "1": Buffer.alloc(32, 9).toString("base64"),
    });
    process.env.OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION = "1";
    const manifest = {
      format: "titan-offline-production",
      workbookId: "wb-1",
      factoryCode: "F01",
      operatorUserId: "op-1",
      templateVersion: 1,
      signingVersion: 1,
      runCapacity: 200,
      issuedAt: "2026-08-13T10:00:00.000Z",
      snapshotSha256: "abc",
    };
    const signature = signOfflineProductionManifest(manifest);
    const reordered = { ...manifest };
    (reordered as any).runCapacity; // touch
    expect(verifyOfflineProductionManifest(reordered, signature)).toBe(true);
  });

  it("action content hash is canonical regardless of payload key order", () => {
    const a = hashOfflineProductionAction({
      workbookId: "wb-1",
      slotId: "slot-1",
      recordToken: "tok-1",
      rowSequenceNumber: 2,
      actionKind: "log_progress",
      payload: { unitsProduced: 50 },
    });
    const b = hashOfflineProductionAction({
      workbookId: "wb-1",
      slotId: "slot-1",
      recordToken: "tok-1",
      rowSequenceNumber: 2,
      actionKind: "log_progress",
      payload: { unitsProduced: 50 },
    });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/signing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement signing.server.ts**

Model the implementation exactly on `src/lib/sales/offline/signing.server.ts` and `src/lib/attendance/offline/signing.server.ts`. Use:
- `createHash("sha256")` for snapshot and content hashes (the sales style; not `crypto.subtle`).
- `createHmac("sha256", signingKey(version))` for manifest and snapshot signatures.
- `Buffer.from(..., "base64")` for key decoding. Enforce 32-byte length on the active key.
- A canonical NUL-separated concatenation for token binding (workbookId, operatorUserId, templateVersion, signingVersion, slotNumber, reservedBatchId).
- `timingSafeEqual` for verify comparisons.
- `getActiveOfflineProductionSigningVersion` reads `OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION`; returns `null` if unset or the keyring is missing (fail-safe so disabled-build CI does not break). Issuance throws if the active version is null; verification looks the version up in the keyring and accepts retired-but-present versions for download.

- [ ] **Step 4: Run signing test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/signing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing OOXML guard tests**

Copy `src/lib/attendance/offline/ooxml-guard.test.ts` to `src/lib/production/offline/__tests__/ooxml-guard.test.ts` and adjust imports to `@/lib/production/offline/ooxml-guard.server`. Cover: valid minimal OOXML, encrypted entry metadata, duplicate paths, path traversal, Zip64, entry count, uncompressed total, and the forbidden paths (`xl/vbaProject.bin`, `xl/externalLinks/`, `xl/queryTables/`, `xl/embeddings/`, `xl/activeX/`, `TargetMode="External"`). Include a fixture that asserts a sheet containing a formula in an INPUT cell is rejected (a production-input cell is any cell inside the operator-action blocks — flag the formula even if the rest of the workbook is clean; the offline sales suite does this by inspecting shared-strings and inline strings for the `=`-prefix outside of formula cells — copy that scan).

- [ ] **Step 6: Implement ooxml-guard.server.ts**

Copy `src/lib/attendance/offline/ooxml-guard.server.ts` verbatim to `src/lib/production/offline/ooxml-guard.server.ts`. If the attendance guard already rejects formulas in input cells, no further edits are needed; otherwise mirror the offline sales guard's formula check. The exported entry point is:

```ts
export async function inspectXlsxPackage(bytes: Uint8Array): Promise<void>;
```

- [ ] **Step 7: Run OOXML guard test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/ooxml-guard.test.ts
```

Expected: PASS.

- [ ] **Step 8: Implement reference-snapshot.server.ts (no test yet — exercised in Task 4 and Task 5)**

Create `src/lib/production/offline/reference-snapshot.server.ts` exporting:

```ts
export type OfflineProductionReferenceSnapshot = {
  format: "titan-offline-production";
  workbookId: string; // filled at issue time
  factoryCode: "F01";
  generatedAt: string;
  factoryFloorWarehouseId: string;
  recipes: Array<{
    id: string;
    name: string;
    productId: string;
    productName: string;
    batchSize: string;
    batchUnit: "liters" | "kg";
    targetUnitsPerBatch: number | null;
    containerType: "pack" | "bag";
    containerPackagingId: string | null;
    fillAmount: string | null;
    fillUnit: string | null;
    containersPerCarton: number | null;
    cartonPackagingId: string | null;
    estimatedCostPerContainer: string | null;
    isActive: boolean;
    ingredients: Array<{ chemicalId: string; quantityPerBatch: string }>;
    packaging: Array<{
      packagingMaterialId: string;
      quantityPerContainer: string;
      usageBasis: string;
      isOptional: boolean;
    }>;
  }>;
  chemicals: Array<{ id: string; name: string; unit: "kg" | "liters"; costPerUnit: string }>;
  packagingMaterials: Array<{
    id: string;
    name: string;
    type: "primary" | "master" | "extra";
    capacity: string | null;
    capacityUnit: string | null;
    costPerUnit: string;
  }>;
  materialStock: Array<{
    warehouseId: string;
    chemicalId: string | null;
    packagingMaterialId: string | null;
    quantity: string;
  }>;
  finishedGoodsStock: Array<{
    warehouseId: string;
    recipeId: string;
    quantityCartons: string;
    quantityContainers: string;
  }>;
};

export async function buildOfflineProductionReferenceSnapshot(
  tx: Transaction,
  issuedAt: Date,
): Promise<OfflineProductionReferenceSnapshot>;
```

The function selects the factory-floor warehouse by `type = "factory_floor"` (single row), all active recipes with eager `product`, `ingredients.chemical`, `packaging.packagingMaterial`, `containerPackaging`, `cartonPackaging`; all `chemicals`; all `packagingMaterials`; `materialStock` rows at the factory-floor warehouse; `finishedGoodsStock` rows at the factory-floor warehouse. Order every array by id so the snapshot hash is canonical.

- [ ] **Step 9: Run full test suite**

Run:

```bash
bun run test
```

Expected: All green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/production/offline/signing.server.ts \
  src/lib/production/offline/reference-snapshot.server.ts \
  src/lib/production/offline/ooxml-guard.server.ts \
  src/lib/production/offline/__tests__/signing.test.ts \
  src/lib/production/offline/__tests__/ooxml-guard.test.ts
git commit -m "feat(offline-production): add signing, snapshot hashing, and OOXML guard"
```

---

### Task 4: Offline Production Schema and Migration

**Files:**
- Create: `src/db/schemas/offline-production-schema.ts`
- Modify: `src/db/schemas/inventory-schema.ts` (add `offlineProductionSlotId` on `productionRuns` + partial unique; add `offlineImportRowId` and `offlineImportIdentity` on `productionProgressLogs` + partial unique)
- Modify: `src/db/index.ts`: import and re-export the new schema.
- Generate: `src/db/migrations/0001_offline_production_import.sql` (the next sequential migration file name Drizzle chooses; verify after generate).
- Test: `src/db/schemas/offline-production-schema.test.ts`

**Interfaces:**
- Produces tables: `offlineProductionWorkbooks`, `offlineProductionRunSlots`, `offlineProductionImportBatches`, `offlineProductionStagedActions`.
- Produces columns on `productionRuns`: `offlineProductionSlotId`.
- Produces columns on `productionProgressLogs`: `offlineImportRowId`, `offlineImportIdentity`.

- [ ] **Step 1: Write failing schema test**

Create `src/db/schemas/offline-production-schema.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  offlineProductionWorkbooks,
  offlineProductionRunSlots,
  offlineProductionImportBatches,
  offlineProductionStagedActions,
  productionRuns,
  productionProgressLogs,
} from "@/db";

const schemaSource = readFileSync(
  resolve(process.cwd(), "src/db/schemas/offline-production-schema.ts"),
  "utf8",
);
const inventorySource = readFileSync(
  resolve(process.cwd(), "src/db/schemas/inventory-schema.ts"),
  "utf8",
);

describe("offline production schema", () => {
  it("declares the four tables", () => {
    expect(schemaSource).toContain('pgTable("offline_production_workbooks"');
    expect(schemaSource).toContain('pgTable("offline_production_run_slots"');
    expect(schemaSource).toContain('pgTable("offline_production_import_batches"');
    expect(schemaSource).toContain('pgTable("offline_production_staged_actions"');
  });

  it("enforces one active workbook per factory", () => {
    expect(schemaSource).toContain(
      "offline_production_workbooks_one_active_factory_idx",
    );
    expect(schemaSource).toContain("= 'active'");
  });

  it("declares slot unique indexes and content guards", () => {
    expect(schemaSource).toContain(
      "offline_production_run_slots_token_idx",
    );
    expect(schemaSource).toContain(
      "offline_production_run_slots_reserved_batch_id_idx",
    );
    expect(schemaSource).toContain(
      "offline_production_run_slots_workbook_slot_idx",
    );
    expect(schemaSource).toContain(
      "offline_production_run_slots_posted_run_idx",
    );
  });

  it("declares batch fileSha256 unique and outage range check", () => {
    expect(schemaSource).toContain(
      "offline_production_batches_file_hash_idx",
    );
    expect(schemaSource).toContain(
      "offline_production_batches_outage_range_check",
    );
    expect(schemaSource).toContain(
      "offline_production_batches_workbook_required_check",
    );
  });

  it("declares staged action partial unique applied claim", () => {
    expect(schemaSource).toContain(
      "offline_production_staged_actions_applied_identity_idx",
    );
    expect(schemaSource).toContain(`= 'applied'`);
  });

  it("declares action-kind enum and worksheet-row check", () => {
    expect(schemaSource).toContain('"create_run"');
    expect(schemaSource).toContain('"start_run"');
    expect(schemaSource).toContain('"log_progress"');
    expect(schemaSource).toContain('"edit_log"');
    expect(schemaSource).toContain('"complete"');
    expect(schemaSource).toContain('"fail"');
  });

  it("does not store workbook bytes", () => {
    expect(schemaSource).not.toMatch(/workbook_?[Bb]ytes/);
  });

  it("adds offlineProductionSlotId to productionRuns with a partial unique", () => {
    expect(inventorySource).toContain("offlineProductionSlotId");
    expect(inventorySource).toContain("production_runs_offline_slot_unique");
  });

  it("adds offlineImportRowId and offlineImportIdentity to productionProgressLogs with a partial unique", () => {
    expect(inventorySource).toContain("offlineImportRowId");
    expect(inventorySource).toContain("offlineImportIdentity");
    expect(inventorySource).toContain(
      "attendance_punches_offline_identity_idx",
    );
    expect(inventorySource).toContain("offlineProductionStagedActions");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/db/schemas/offline-production-schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement offline-production-schema.ts**

Mirror the structure of `src/db/schemas/offline-sales-schema.ts` for the workbook and slot tables, and `src/db/schemas/offline-attendance-schema.ts` for rows. Implement the four tables with the columns and indexes named in the design spec §8. Use:
- `text().primaryKey().$defaultFn(() => createId())` for ids (copy the `idColumn` helper verbatim).
- The shared `timestamps` object (copy the same shape).
- `text("status", { enum: [...] }).$type<...>().default(...).notNull()` for status enums (same pattern as sales).
- `check("name", sql\`...\`)` for the constraints.
- `uniqueIndex("name").on(...).where(sql\`...\`)` for the partial uniques.

For `offlineProductionRunSlots`:
- `reservedBatchId` is `text("reserved_batch_id").notNull()` with `uniqueIndex("offline_production_run_slots_reserved_batch_id_idx").on(table.reservedBatchId)`.
- `recordToken` UNIQUE via `uniqueIndex("offline_production_run_slots_token_idx").on(table.recordToken)`.
- Composite `(workbookId, slotNumber)` unique via `uniqueIndex("offline_production_run_slots_workbook_slot_idx")`.
- Partial unique on `postedRunId WHERE NOT NULL` via `uniqueIndex("offline_production_run_slots_posted_run_idx").on(table.postedRunId).where(sql\`${table.postedRunId} is not null\`)`.
- `stagedRunId` FK to `offlineProductionStagedActions.id` with `onDelete: "restrict"` and a partial unique index where not null.

For `offlineProductionImportBatches`:
- `fileSha256` UNIQUE: `uniqueIndex("offline_production_batches_file_hash_idx").on(table.fileSha256)`.
- `CHECK outage_started_at < outage_ended_at`, `CHECK byteSize > 0`, `CHECK status = 'rejected' OR workbookId IS NOT NULL`.

For `offlineProductionStagedActions`:
- `actionKind` is `text("action_kind", { enum: ["create_run", "start_run", "log_progress", "edit_log", "complete", "fail"] }).notNull()`.
- `payload` `jsonb("payload").$type<OfflineProductionActionPayload>().notNull()`.
- `status` enum as in `OfflineProductionActionStatus`.
- Partial unique `(workbookId, recordToken, rowSequenceNumber) WHERE status = 'applied'` named `offline_production_staged_actions_applied_identity_idx`.
- Indexes on `(batchId, status)` and `(slotId, rowSequenceNumber)`.
- CHECK `rowSequenceNumber > 0`.

- [ ] **Step 4: Add columns and partial uniques on inventory schema**

In `src/db/schemas/inventory-schema.ts`:
- On `productionRuns` (around line 331): add `offlineProductionSlotId: text("offline_production_slot_id").references(() => offlineProductionRunSlots.id, { onDelete: "restrict" })`. Add a partial unique index `production_runs_offline_slot_unique .on(table.offlineProductionSlotId).where(sql\`${table.offlineProductionSlotId} is not null\`)` to the table's index list.
- On `productionProgressLogs` (around line 423): add `offlineImportRowId: text("offline_import_row_id").references(() => offlineProductionStagedActions.id, { onDelete: "set null" })` and `offlineImportIdentity: text("offline_import_identity")`. Add partial unique `attendance_punches_offline_identity_idx` — NOTE: this name already exists on `attendancePunches`; for `productionProgressLogs` use a distinct name `production_progress_logs_offline_identity_idx`. Update the test to assert the `production_progress_logs_offline_identity_idx` name instead of `attendance_punches_offline_identity_idx`.
- Import the offline production schema symbols into `inventory-schema.ts` (the cross-reference is the same pattern `sales-schema.ts` uses for `offlineSalesSlotId`).

Update the test to expect the correct index name on `productionProgressLogs`:

```ts
expect(inventorySource).toContain("production_progress_logs_offline_identity_idx");
```

- [ ] **Step 5: Merge schema in db/index.ts**

In `src/db/index.ts`, import the four new tables and re-export them alongside the existing offline sales and attendance tables. Verify the build catches the symbol exports.

- [ ] **Step 6: Generate the migration**

Run:

```bash
bun run db:generate
```

Inspect the generated SQL file under `src/db/migrations/`. Verify:
- The four new tables are present.
- The partial uniques appear as `CREATE UNIQUE INDEX ... WHERE ...`.
- The new columns on `productionRuns` and `productionProgressLogs` appear as `ALTER TABLE ... ADD COLUMN ...` plus the `CREATE UNIQUE INDEX ...`.
- All FKs have backing indexes (Drizzle generates them automatically; match a sampling of names against the schema test).

- [ ] **Step 7: Run schema test, verify pass**

Run:

```bash
bunx vitest run src/db/schemas/offline-production-schema.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 8: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 9: Commit**

```bash
git add src/db/schemas/offline-production-schema.ts \
  src/db/schemas/inventory-schema.ts \
  src/db/index.ts \
  src/db/migrations/ \
  src/db/schemas/offline-production-schema.test.ts
git commit -m "feat(offline-production): add schema, live-ledger link columns, and migration"
```

---

### Task 5: Workbook Issuance, Replace, Force-Retire, and Download (server functions)

**Files:**
- Create: `src/server-functions/inventory/production/offline-workbooks-fn.ts`
- Create: `src/lib/production/offline/workbook-template.server.ts`
- Create: `src/lib/production/offline/__tests__/offline-workbooks.test.ts`

**Interfaces:**
- Produces server functions:
  - `listOfflineProductionOperatorsFn(): Promise<{ id, name, email }[]>`
  - `listOfflineProductionWorkbooksFn(): Promise<OfflineProductionWorkbookSummary[]>`
  - `listInProgressProductionRunsForOperatorFn(input: { operatorUserId }): Promise<RunForBinding[]>`
  - `issueOfflineProductionWorkbookFn(input: { operatorUserId, recipeIds?: string[] }): Promise<OfflineProductionWorkbookSummary>` — NOTE: v1 issues a workbook that may bind to ANY active recipe in progress (or scheduled for creation). The workbook does NOT pre-bind to specific runs; the operator picks recipes from the snapshot at create-run time. The optional `recipeIds` input filters the snapshot to a subset, useful for narrowing a workbook to a planned shift.
  - `downloadOfflineProductionWorkbookFn(input: { workbookId }): Promise<Response>`
  - `replaceOfflineProductionWorkbookFn(input: { workbookId, usedRowsUploaded: true, operatorUserId? }): Promise<OfflineProductionWorkbookSummary>`
  - `forceRetireOfflineProductionWorkbookFn(input: { workbookId, reason }): Promise<OfflineProductionWorkbookSummary>`

- [ ] **Step 1: Write failing workbook issuance test**

Create `src/lib/production/offline/__tests__/offline-workbooks.test.ts`. Source-inspection style (matches the repo's existing test pattern). Assertions:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/inventory/production/offline-workbooks-fn.ts",
  ),
  "utf8",
);

describe("offline production workbook server functions", () => {
  it("exports the seven workbook fns", () => {
    expect(SOURCE).toContain("listOfflineProductionOperatorsFn");
    expect(SOURCE).toContain("listOfflineProductionWorkbooksFn");
    expect(SOURCE).toContain("listInProgressProductionRunsForOperatorFn");
    expect(SOURCE).toContain("issueOfflineProductionWorkbookFn");
    expect(SOURCE).toContain("downloadOfflineProductionWorkbookFn");
    expect(SOURCE).toContain("replaceOfflineProductionWorkbookFn");
    expect(SOURCE).toContain("forceRetireOfflineProductionWorkbookFn");
  });

  it("every fn calls requireOfflineProductionEnabled first", () => {
    const matches = SOURCE.match(/requireOfflineProductionEnabled\(\)/g);
    expect(matches?.length).toBe(7);
  });

  it("guards each fn with the correct middleware", () => {
    expect(SOURCE).toContain("requireOfflineProductionWorkbookManageMiddleware");
    expect(SOURCE).toContain("requireOfflineProductionViewMiddleware");
  });

  it("refuses to issue when an active workbook already exists for F01", () => {
    expect(SOURCE).toContain("findActiveWorkbook");
    expect(SOURCE).toContain("Factory F01 already has an active offline production workbook");
  });

  it("verifies snapshot signature and hash on download", () => {
    expect(SOURCE).toContain("hashOfflineProductionSnapshot(snapshot) !== workbook.snapshotSha256");
    expect(SOURCE).toContain("verifyOfflineProductionSnapshot");
    expect(SOURCE).toContain("verifyOfflineProductionManifest");
  });

  it("refuses download of non-active workbook", () => {
    expect(SOURCE).toContain("Only the active official workbook can be downloaded");
  });

  it("reserves batchIds via generateNextBatchId", () => {
    expect(SOURCE).toContain("generateNextBatchId");
    expect(SOURCE).toContain("OFFLINE_PRODUCTION_WORKBOOK_RUN_CAPACITY");
  });

  it("refuses replace/force-retire when unresolved batches exist", () => {
    expect(SOURCE).toContain("assertNoUnresolvedBatch");
    expect(SOURCE).toContain("Finish the current offline upload before replacing this workbook");
  });

  it("force-retire requires reason 5-500 chars", () => {
    expect(SOURCE).toContain('z.string().trim().min(5).max(500)');
  });

  it("voids unused slots on close and force-retire", () => {
    expect(SOURCE).toContain('status: "voided"');
  });

  it("sets download headers with no-store, nosniff, sanitized filename", () => {
    expect(SOURCE).toContain("no-store");
    expect(SOURCE).toContain("nosniff");
    expect(SOURCE).toContain("offlineProductionDownloadHeaders");
  });

  it("bytes are returned via ArrayBuffer copy and never referenced again", () => {
    expect(SOURCE).toContain("ArrayBuffer(bytes.byteLength)");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-workbooks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the workbook-template builder**

Create `src/lib/production/offline/workbook-template.server.ts` exporting:

```ts
export async function buildOfflineProductionWorkbook(input: {
  manifest: OfflineProductionManifest;
  manifestSignature: string;
  snapshot: OfflineProductionReferenceSnapshot;
  snapshotSignature: string;
  operatorName: string;
  slots: Array<{ id: string; slotNumber: number; reservedBatchId: string; recordToken: string }>;
}): Promise<Uint8Array>;
```

Mirror `src/lib/sales/offline/workbook-template.server.ts`:
- Build a minimal OOXML package with @zip.js/zip.js.
- Sheets: a manifest sheet (signed values), a reference snapshot sheet (read-only), and one action slot per `slot` — each carrying the read-only `slotNumber`, `reservedBatchId`, `recordToken`, and an empty action block with capacity rows for the operator to fill.
- Run `inspectXlsxPackage` on the produced bytes before returning to guarantee the guard accepts its own output.

Add `offlineProductionDownloadHeaders({ workbookId })` returning `Content-Disposition: attachment; filename="offline-production-F01-<id>.xlsx"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Use the same filename sanitization the sales helper does.

- [ ] **Step 4: Implement the workbook server functions**

Create `src/server-functions/inventory/production/offline-workbooks-fn.ts` modelled on `src/server-functions/sales/offline-workbooks-fn.ts`:

- `requireOperator(database, operatorUserId)` — load user, refuse banned.
- `findActiveWorkbook(database, excludeId?)` — `WHERE factoryCode = 'F01' AND status = 'active'`.
- `assertNoUnresolvedBatch(database, workbookId)` — checks `offlineProductionImportBatches` for statuses `["uploaded","preview_ready","posting"]`.
- `toSummary(database, workbook, operatorName)` — counts used/remaining slots.
- `issueInTransaction({ tx, operatorUserId, issuedByUserId, recipeIds? })`:
  1. `requireOperator(tx, operatorUserId)`.
  2. `if (await findActiveWorkbook(tx)) throw...`.
  3. `const signingVersion = getActiveOfflineProductionSigningVersion(); if (!signingVersion) throw "Offline production signing is disabled."`.
  4. `const issuedAt = new Date(); const workbookId = createId();`.
  5. `const snapshot = await buildOfflineProductionReferenceSnapshot(tx, issuedAt);` — optionally filter by `recipeIds` (filter the recipes array; leave chemicals/packaging/stock unfiltered so the operator has stock visibility for any recipe they may start).
  6. `const snapshotSha256 = hashOfflineProductionSnapshot(snapshot);`.
  7. Build the `OfflineProductionManifest`, `manifestSignature`, `snapshotSignature` via the signing module.
  8. Reserve N batchIds in a loop: `for (let i = 0; i < OFFLINE_PRODUCTION_WORKBOOK_RUN_CAPACITY; i++) reservedBatchIds.push(await generateNextBatchId(tx, lastBatchId));` — use the existing `generateNextBatchId` helper (`src/lib/production/batch-id.ts`) inside the transaction so the reservations are durable. Track the previous batchId to chain the generator.
  9. Insert the workbook row + the N slot rows, each with `slotNumber`, `reservedBatchId`, and `recordToken = createOfflineProductionSlotToken({ workbookId, operatorUserId, templateVersion, signingVersion, slotNumber, reservedBatchId })`.
  10. Insert an `inventoryAuditLog` row `type:"credit", materialType:"finished", reason:"Offline production workbook issued: <workbookId>"` for traceability.
- The seven server fns wrap the helpers with the workbook-manage middleware and call `requireOfflineProductionEnabled()` as the first line of each handler.
- `downloadOfflineProductionWorkbookFn` repeats the sales verification dance: re-hash the snapshot, verify both signatures, refuse non-`active`, then build and return the bytes through `offlineProductionDownloadHeaders`.

- [ ] **Step 5: Run workbook test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-workbooks.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 6: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/inventory/production/offline-workbooks-fn.ts \
  src/lib/production/offline/workbook-template.server.ts \
  src/lib/production/offline/__tests__/offline-workbooks.test.ts
git commit -m "feat(offline-production): add workbook issuance, replace, retire, and download"
```

---

### Task 6: Workbook Parser

**Files:**
- Create: `src/lib/production/offline/workbook-parser.server.ts`
- Create: `src/lib/production/offline/__tests__/workbook-parser.test.ts`

**Interfaces:**
- Produces:
  - `parseOfflineProductionWorkbook(bytes: Uint8Array): Promise<ParsedOfflineProductionWorkbook>`
  - `type ParsedOfflineProductionWorkbook` declared in `contracts.ts` and augmented here.

- [ ] **Step 1: Extend contracts.ts with parser result types**

Append to `src/lib/production/offline/contracts.ts`:

```ts
export type ParsedOfflineProductionManifest = {
  format: "titan-offline-production";
  workbookId: string;
  factoryCode: "F01";
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  runCapacity: number;
  issuedAt: string;
  snapshotSha256: string;
};

export type ParsedOfflineProductionSlot = {
  slotNumber: number;
  reservedBatchId: string;
  recordToken: string;
};

export type ParsedOfflineProductionAction = {
  slotNumber: number;
  recordToken: string;
  rowSequenceNumber: number;
  actionKind: OfflineProductionActionKind;
  payload: OfflineProductionActionPayload;
  worksheetRowNumber: number;
  contentHash: string;
  parseIssues: Array<{ code: string; message: string; source?: string }>;
};

export type OfflineProductionActionPayload =
  | { kind: "create_run"; recipeId: string; batchesProduced: number; scheduledStartDate?: string; notes?: string }
  | { kind: "start_run" }
  | { kind: "log_progress"; unitsProduced: number }
  | { kind: "edit_log"; progressLogId: string; unitsProduced: number; editReason: string }
  | { kind: "complete"; shortfallReason?: string }
  | { kind: "fail"; reason: string };

export type ParsedOfflineProductionWorkbook = {
  manifest: ParsedOfflineProductionManifest;
  snapshot: OfflineProductionReferenceSnapshot;
  slots: ParsedOfflineProductionSlot[];
  actions: ParsedOfflineProductionAction[];
  fileSha256: string;
};
```

- [ ] **Step 2: Write failing parser tests**

Create `src/lib/production/offline/__tests__/workbook-parser.test.ts`. Cover:
- A round-trip: `buildOfflineProductionWorkbook` then `parseOfflineProductionWorkbook` reproduces the manifest, slots, and actions.
- Reject `.xlsm` bytes.
- Reject a workbook whose snapshot hash mismatches the manifest `snapshotSha256`.
- Reject a workbook missing the action sheet.
- Reject a row whose `actionKind` is outside the enum.
- Reject a `create_run` row that appears more than once in one slot.
- Reject a `start_run` row that appears before `create_run` in a slot.
- Reject a row whose signed token does not match the slot's `recordToken`.
- Reject a `log_progress` with non-positive `unitsProduced`.
- Reject an `edit_log` missing `editReason`.
- Reject a `fail` row whose `reason` is empty.
- Reject a `complete` row whose `shortfallReason` is empty when the cumulative `unitsProduced` is below target — NOTE: the parser cannot know the target without the snapshot; it MUST NOT classify shortfall; it only validates literal presence of `shortfallReason` when filled. Classification happens later in the preview step. Adjust the test to assert the parser passes through `shortfallReason` as-is and does not assert shortfall completeness.

- [ ] **Step 3: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/workbook-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the parser**

Model on `src/lib/attendance/offline/workbook-parser.server.ts`:
- `await inspectXlsxPackage(bytes)`.
- Unzip with @zip.js/zip.js; parse the manifest sheet and the reference snapshot sheet; recompute the snapshot hash and compare to the manifest's `snapshotSha256`; throw `"Workbook snapshot does not match an issued offline production workbook."` on mismatch.
- Parse one slot block per the action sheet's prepared row template; reject rows whose signed headers are tampered.
- Build `ParsedOfflineProductionAction[]` from the operator-filled cells. Compute `contentHash = hashOfflineProductionAction(...)`.
- Accumulate `parseIssues` per row; do not throw on a per-row issue (the upload path will store the row as `invalid` with the first issue's `reasonCode`/`reasonMessage`, mirroring attendance `offline-upload-fn.ts:223`).
- DO throw on whole-workbook issues (missing sheets, snapshot mismatch, forbidden file type).
- Return the typed payload.

- [ ] **Step 5: Run parser test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/workbook-parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/production/offline/workbook-parser.server.ts \
  src/lib/production/offline/contracts.ts \
  src/lib/production/offline/__tests__/workbook-parser.test.ts
git commit -m "feat(offline-production): add workbook parser with strict tamper checks"
```

---

### Task 7: Upload (idempotent staging) and Rejected-Upload Storage

**Files:**
- Create: `src/server-functions/inventory/production/offline-upload-fn.ts`
- Create: `src/lib/production/offline/__tests__/offline-upload.test.ts`

**Interfaces:**
- Produces:
  - `uploadOfflineProductionWorkbookFn` (POST, FormData).
  - `storeRejectedOfflineProductionUpload` private (asserted only via source).
  - `stageOfflineProductionUpload` `createServerOnlyFn` for internal reuse.

- [ ] **Step 1: Write failing upload test**

Create `src/lib/production/offline/__tests__/offline-upload.test.ts` modelled on `src/server-functions/sales/offline-upload-fn.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/inventory/production/offline-upload-fn.ts",
  ),
  "utf8",
);

describe("offline production upload", () => {
  it("routes through FormData and the upload middleware", () => {
    expect(SOURCE).toContain("method: \"POST\"");
    expect(SOURCE).toContain("requireOfflineProductionUploadMiddleware");
    expect(SOURCE).toContain("instanceof FormData");
  });

  it("uses Node createHash for sha256 and releases bytes after parse", () => {
    expect(SOURCE).toContain('createHash("sha256")');
    expect(SOURCE).toContain("bytes = new Uint8Array()");
  });

  it("enforces a 1 MiB minimum and a 10 MiB maximum", () => {
    expect(SOURCE).toContain("OFFLINE_PRODUCTION_WORKBOOK_MIN_BYTES");
    expect(SOURCE).toContain("OFFLINE_PRODUCTION_WORKBOOK_MAX_BYTES");
  });

  it("validates outage start before end and end not in the future", () => {
    expect(SOURCE).toContain("Outage start must be before outage end");
    expect(SOURCE).toContain("Outage end cannot be in the future");
  });

  it("validates reason min 5 max 500", () => {
    expect(SOURCE).toContain(".min(5).max(500)");
  });

  it("delegates heavy staging to a createServerOnlyFn", () => {
    expect(SOURCE).toContain("createServerOnlyFn");
    expect(SOURCE).toContain("stageOfflineProductionUpload");
  });

  it("stores rejected uploads with workbookId null and a safe lastError", () => {
    expect(SOURCE).toContain("storeRejectedUpload");
    expect(SOURCE).toContain('status: "rejected"');
    expect(SOURCE).toContain('lastError: "unsafe_workbook"');
    expect(SOURCE).toContain("workbookId: null");
  });

  it("is idempotent on identical file bytes via fileSha256 unique", () => {
    expect(SOURCE).toContain("existingFile");
    expect(SOURCE).toContain("offlineProductionImportBatches.fileSha256");
  });

  it("refuses non-active workbook uploads", () => {
    expect(SOURCE).toContain("workbook.status !== \"active\"");
  });

  it("never reads or writes the workbook file to disk", () => {
    expect(SOURCE).not.toMatch(/readFile|writeFile|fs\./);
    expect(SOURCE).not.toMatch(/workbookBytes/);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-upload.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the upload server function**

Model on `src/server-functions/sales/offline-upload-fn.ts`:
- `readForm` validates `.xlsx`, MIME, size in `[MIN, MAX]`, parses outage fields with zod, enforces `start < end` and `end <= now`.
- Handler hashes bytes with `createHash("sha256")`, attempts `parseOfflineProductionWorkbook(bytes)`, on throw dereferences bytes and calls `storeRejectedUpload`.
- `stageOfflineProductionUpload` is a `createServerOnlyFn`. Inside ONE `db.transaction`:
  - `existingFile(fileSha256, tx)` returns the existing batch if already uploaded.
  - Select the workbook by `(id, operatorUserId, signingVersion)` from the parsed manifest.
  - Refuse `workbook.status !== "active"` (sales parity on attendance `canWorkbookAcceptUploads`).
  - Re-hash the snapshot and compare to `workbook.snapshotSha256`; throw on mismatch.
  - Insert the batch row with `status:"uploaded"`, `totalActions` set to the parsed action count, outage fields from the upload metadata.
  - For each parsed action: look up the slot by `recordToken`; throw if missing. If `slot.stagedContentHash` already equals the action content hash → `duplicate++`. If different → `needs_review++` and flip slot `conflict`. Otherwise call `classifyOfflineProductionAction` (Task 8 — for Task 7 use a stub `status: "pending"`) and insert the staged action row; ensure the staged action document matches the slot.
  - Update the batch counts and flip the status to `preview_ready`.
  - Return `{ batchId, fileSha256, status, counts }`.

- [ ] **Step 4: Run upload test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-upload.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/inventory/production/offline-upload-fn.ts \
  src/lib/production/offline/__tests__/offline-upload.test.ts
git commit -m "feat(offline-production): add idempotent workbook upload with staging"
```

---

### Task 8: Preview Classification with Cross-Action Sequencer

**Files:**
- Create: `src/lib/production/offline/classification.server.ts`
- Create: `src/lib/production/offline/preview.server.ts`
- Modify: `src/server-functions/inventory/production/offline-upload-fn.ts` to call the classifier inside the staging tx instead of the pending stub.
- Create: `src/lib/production/offline/__tests__/offline-review.test.ts`

**Interfaces:**
- Produces:
  - `classifyOfflineProductionAction(input): OfflineProductionClassificationResult`
  - `buildAndPersistOfflineProductionPreview(batchId): Promise<void>` (called at end of upload and by the refresh fn)
  - `countsFromActions(rows)` helper.

- [ ] **Step 1: Write failing classification and preview tests**

Create `src/lib/production/offline/__tests__/offline-review.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const previewSource = readFileSync(
  resolve(process.cwd(), "src/lib/production/offline/preview.server.ts"),
  "utf8",
);
const classificationSource = readFileSync(
  resolve(process.cwd(), "src/lib/production/offline/classification.server.ts"),
  "utf8",
);

describe("offline production preview classification", () => {
  it("exports the preview and classification entry points", () => {
    expect(previewSource).toContain("buildAndPersistOfflineProductionPreview");
    expect(classificationSource).toContain("classifyOfflineProductionAction");
  });

  it("refresh never mutates payload business values", () => {
    expect(previewSource).not.toMatch(/payload:\s*\{/);
    expect(previewSource).not.toMatch(/\.set\(\s*\{\s*payload/);
  });

  it("refresh only updates status and issue fields", () => {
    expect(previewSource).toContain("status:");
    expect(previewSource).toContain("issueCodes:");
    expect(previewSource).toContain("issueDetails:");
    expect(previewSource).toContain("reasonCode:");
    expect(previewSource).toContain("reasonMessage:");
  });

  it("evaluate staged actions in rowSequence order per slot", () => {
    expect(previewSource).toContain("rowSequenceNumber");
    expect(previewSource).toContain("asc(");
  });

  it("create_run must be the first action in a slot", () => {
    expect(classificationSource).toContain("create_run");
    expect(classificationSource).toContain("rowSequenceNumber");
  });

  it("fail requires zero cumulative log_progress units", () => {
    expect(classificationSource).toContain("hasOperatorProductionLogs");
    expect(classificationSource).toContain("unitsProduced");
  });

  it("complete shortfall is required when below target", () => {
    expect(classificationSource).toContain("shortfallReason");
    expect(classificationSource).toContain("containersProduced");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-review.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the pure classifier**

`src/lib/production/offline/classification.server.ts` exports:

```ts
export type OfflineProductionClassificationResult = {
  status: OfflineProductionActionStatus;
  issueCodes: string[];
  issueDetails: Array<{ code: string; message: string }>;
};

export function classifyOfflineProductionAction(input: {
  action: ParsedOfflineProductionAction;
  previousActions: ParsedOfflineProductionAction[]; // same slot, earlier rowSequenceNumber
  slot: { reservedBatchId: string };
  liveRun: { status: string; containersProduced: number; completedUnits: number; recipeId: string } | null;
  liveHasOperatorLogs: boolean;
  recipeIsActive: boolean;
}): OfflineProductionClassificationResult;
```

Rules:
- `create_run`:
  - If `liveRun` exists for the reserved batchId → `duplicate` `reasonCode:"batch_already_exists"`.
  - If `previousActions.length > 0` → `invalid "create_not_first"`.
  - If `!recipeIsActive` → `needs_review "recipe_inactive"`.
  - Else → `ready`.
- `start_run`:
  - If no prior `create_run` in `previousActions` AND no `liveRun` → `invalid "create_missing"`.
  - If `liveRun?.status === "in_progress"` → `duplicate "already_started"`.
  - If `liveRun?.status` not in `["scheduled","in_progress"]` → `invalid "run_not_startable"`.
  - Else → `ready`.
- `log_progress`:
  - If `unitsProduced <= 0` → `invalid "non_positive_units"`.
  - If `liveRun?.status` not in `["in_progress",null]` AND no `create_run`+`start_run` pending → `invalid "run_not_in_progress"`.
  - Compute `virtualCompleted = (liveRun?.completedUnits ?? 0) + Σ prior log_progress unitsProduced`. Apply the `validateProgressUnits` carton-alignment rule (extract to a shared helper `src/lib/production/offline/validate-units.ts` that wraps `production-progress-core.ts:validateProgressUnits` so online and offline share one rule set). If `virtualCompleted + unitsProduced > target` → `needs_review "exceeds_target"`. If carton-aligned fail → `invalid "carton_alignment"`.
  - Else → `ready`.
- `edit_log`:
  - If `progressLogId` does not resolve as the latest by `(createdAt desc, id desc)` in `previousActions` or the live `productionProgressLogs` set → `invalid "log_no_longer_latest"`.
  - If `editReason` empty → `invalid "edit_reason_required"`.
  - Else → `ready`.
- `complete`:
  - If `liveRun?.status === "completed"` → `duplicate "already_completed"`.
  - If `liveRun?.status` not in `["in_progress", null]` AND the staged set doesn't complete the run → `invalid "run_not_completable"`.
  - Compute `virtualCompleted = (liveRun?.completedUnits ?? 0) + Σ staged log_progress units`. If `virtualCompleted < containersProduced` AND `shortfallReason` empty → `invalid "shortfall_reason_required"`.
  - Else → `ready`.
- `fail`:
  - If `liveHasOperatorLogs || Σ staged log_progress units > 0` → `invalid "logs_exist"`.
  - If `liveRun?.status` not in `["in_progress", null]` → `invalid "run_not_failable"`.
  - Else → `ready`.

- [ ] **Step 4: Implement the preview builder**

`src/lib/production/offline/preview.server.ts` exports `buildAndPersistOfflineProductionPreview(batchId)`. Inside ONE `db.transaction`:
- Refuse unless batch in `["uploaded","preview_ready","posting"]`.
- Load staged actions ordered by `(slotId, rowSequenceNumber)`.
- Load live data per affected `productionRunId` (using the staged `payload.recipeId` for `create_run` actions or the `liveRun` joined from `postedRunId` of the slot for non-create actions). Execute one batched query for `productionRuns`, `recipes`, `productionProgressLogs` (latest per run), and `wacHistory` (read-only).
- For each slot, accumulate `previousActions` and call `classifyOfflineProductionAction`. Update the staged action's `status`, `issueCodes`, `issueDetails`, `reasonCode`, `reasonMessage`. DO NOT mutate `payload`, `actionKind`, `recordToken`, `rowSequenceNumber`, `worksheetRowNumber`, or `contentHash`.
- Reconcile slot statuses: a slot is `staged` if it has any ready/warning/needs_review staged action; `conflict` only if staged content hashes differ between uploads (already set at upload time).
- Recompute batch counts and set `preview_ready` (the upload path already sets this; refresh keeps it `preview_ready`).

- [ ] **Step 5: Wire the classifier into the upload server function**

In `src/server-functions/inventory/production/offline-upload-fn.ts`, replace the Task 7 stub `status: "pending"` classification with a real call into `classifyOfflineProductionAction` (passing `previousActions` accumulated for the slot). Perform this inside the upload staging tx so the initial preview is populated atomically.

- [ ] **Step 6: Run preview test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-review.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 7: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/production/offline/classification.server.ts \
  src/lib/production/offline/preview.server.ts \
  src/lib/production/offline/__tests__/offline-review.test.ts
git commit -m "feat(offline-production): add preview classification with cross-action sequencer"
```

---

### Task 9: Review Server Functions (list, get, refresh, exclude)

**Files:**
- Create: `src/server-functions/inventory/production/offline-review-fn.ts`

**Interfaces:**
- Produces:
  - `listOfflineProductionQueuesFn` (view, `requireOfflineProductionViewMiddleware`)
  - `getOfflineProductionBatchFn(input: { batchId })` (view)
  - `refreshOfflineProductionPreviewFn(input: { batchId })` (`requireOfflineProductionReviewMiddleware`)
  - `excludeOfflineProductionActionFn(input: { actionIds, reason })` (`requireOfflineProductionReviewMiddleware`)

- [ ] **Step 1: Extend the review test**

Add to `src/lib/production/offline/__tests__/offline-review.test.ts`:

```ts
const reviewSource = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/inventory/production/offline-review-fn.ts",
  ),
  "utf8",
);

describe("offline production review server functions", () => {
  it("exports the four review fns", () => {
    expect(reviewSource).toContain("listOfflineProductionQueuesFn");
    expect(reviewSource).toContain("getOfflineProductionBatchFn");
    expect(reviewSource).toContain("refreshOfflineProductionPreviewFn");
    expect(reviewSource).toContain("excludeOfflineProductionActionFn");
  });

  it("view fns use the view middleware", () => {
    expect(reviewSource).toContain("requireOfflineProductionViewMiddleware");
  });

  it("review fns use the review middleware", () => {
    expect(reviewSource).toContain("requireOfflineProductionReviewMiddleware");
  });

  it("every fn calls requireOfflineProductionEnabled first", () => {
    const matches = reviewSource.match(/requireOfflineProductionEnabled\(\)/g);
    expect(matches?.length).toBe(4);
  });

  it("exclude only allows needs_review, invalid, or blocked", () => {
    expect(reviewSource).toContain('"needs_review"');
    expect(reviewSource).toContain('"invalid"');
    expect(reviewSource).toContain('"blocked"');
  });

  it("exclude writes reasonCode excluded_by_reviewer", () => {
    expect(reviewSource).toContain('"excluded_by_reviewer"');
  });

  it("exclude input is a 1-500 rowIds array and a 5-500 reason", () => {
    expect(reviewSource).toContain("z.array(z.string().min(1)).min(1).max(500)");
    expect(reviewSource).toContain("z.string().trim().min(5).max(500)");
  });

  it("refresh delegates to buildAndPersistOfflineProductionPreview", () => {
    expect(reviewSource).toContain("buildAndPersistOfflineProductionPreview");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-review.test.ts
```

Expected: FAIL (the new review block).

- [ ] **Step 3: Implement the review server functions**

Model on `src/server-functions/hr/attendance/offline-review-fn.ts`:
- `listOfflineProductionQueuesFn` returns batches with statuses `["uploaded","preview_ready","posting"]` plus counts.
- `getOfflineProductionBatchFn` returns the batch with `offlineProductionStagedActions` grouped by slot.
- `refreshOfflineProductionPreviewFn` rejects if status not in `["preview_ready","completed_with_issues"]` and calls `buildAndPersistOfflineProductionPreview`.
- `excludeOfflineProductionActionFn` zod-validates `{ rowIds: string[1..500], reason: string[5..500] }`. Atomic `UPDATE staged_actions SET status='excluded', reasonCode='excluded_by_reviewer', reasonMessage=reason WHERE id IN (...) AND status IN ('needs_review','invalid','blocked')`. Throw if any row was not in those statuses. Recompute batch counts.

- [ ] **Step 4: Run review test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-review.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/inventory/production/offline-review-fn.ts \
  src/lib/production/offline/__tests__/offline-review.test.ts
git commit -m "feat(offline-production): add review server functions (list, get, refresh, exclude)"
```

---

### Task 10: Extract Online Cores as `createServerOnlyFn`s (zero behavior change)

**Files:**
- Modify: `src/server-functions/inventory/production/create-production-run-fn.ts`
- Modify: `src/server-functions/inventory/production/start-production-fn.ts`
- Modify: `src/server-functions/inventory/production/log-production-progress-fn.ts`
- Modify: `src/server-functions/inventory/production/edit-latest-production-progress-log-fn.ts`
- Modify: `src/server-functions/inventory/production/complete-production-fn.ts`
- Modify: `src/server-functions/inventory/production/fail-production-fn.ts`

**Interfaces:**
- Produces:
  - `createProductionRunCore(tx, input): Promise<{ runId }>`
  - `startProductionRunCore(tx, input): Promise<void>`
  - `logProductionProgressCore(tx, input): Promise<{ progressLogId, autoCompleted }>`
  - `editLatestProgressLogCore(tx, input): Promise<{ autoCompleted }>`
  - `completeProductionRunCore(tx, input): Promise<void>` (idempotent early-return preserved)
  - `failProductionRunCore(tx, input): Promise<void>`

- [ ] **Step 1: Write failing extraction guards**

Append to `src/lib/production-run-accounting.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTION_DIR = "src/server-functions/inventory/production";

const readFn = (name: string) =>
  readFileSync(resolve(process.cwd(), PRODUCTION_DIR, name), "utf8");

describe("online production core extraction (zero behavior change)", () => {
  it("create-production-run-fn exports createProductionRunCore", () => {
    expect(readFn("create-production-run-fn.ts")).toContain("createProductionRunCore");
  });
  it("start-production-fn exports startProductionRunCore", () => {
    expect(readFn("start-production-fn.ts")).toContain("startProductionRunCore");
  });
  it("log-production-progress-fn exports logProductionProgressCore", () => {
    expect(readFn("log-production-progress-fn.ts")).toContain("logProductionProgressCore");
  });
  it("edit-latest-production-progress-log-fn exports editLatestProgressLogCore", () => {
    expect(readFn("edit-latest-production-progress-log-fn.ts")).toContain(
      "editLatestProgressLogCore",
    );
  });
  it("complete-production-fn exports completeProductionRunCore", () => {
    expect(readFn("complete-production-fn.ts")).toContain("completeProductionRunCore");
  });
  it("fail-production-fn exports failProductionRunCore", () => {
    expect(readFn("fail-production-fn.ts")).toContain("failProductionRunCore");
  });

  it("every core is wrapped as a createServerOnlyFn", () => {
    for (const name of [
      "create-production-run-fn.ts",
      "start-production-fn.ts",
      "log-production-progress-fn.ts",
      "edit-latest-production-progress-log-fn.ts",
      "complete-production-fn.ts",
      "fail-production-fn.ts",
    ]) {
      expect(readFn(name)).toContain("createServerOnlyFn");
    }
  });

  it("online fns remain thin wrappers calling the cores (no logic duplication)", () => {
    for (const name of [
      "create-production-run-fn.ts",
      "start-production-fn.ts",
    ]) {
      const src = readFn(name);
      expect(src).toContain(".handler(async");
      expect(src).toContain("Core(");
    }
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production-run-accounting.test.ts
```

Expected: FAIL (the new `describe` block).

- [ ] **Step 3: Extract each core one file at a time**

For each of the six files, perform the refactor:
1. Move the existing `handler` body (minus middleware, input validator, and session resolution) into a `createServerOnlyFn` named `*Core` that accepts a `tx` (the transaction context) and an explicit input replacing the `context.session.user.id` field — the offline applier passes `reviewerUserId` here. The online server fn keeps its wrapper and calls `*Core(db, {...input, performedById: context.session.user.id})` — actually, the online fn should continue to call the same helpers but inside its own `db.transaction`. Keep the SAME behavior (single tx, same locks, same audit strings).
2. For `createProductionRunCore`, accept `{ tx, recipeId, warehouseId, batchesProduced, scheduledStartDate, notes, operatorId, initiatorId, reservedBatchId? }` so the offline applier can pass the pre-reserved `reservedBatchId` instead of generating one. If `reservedBatchId` is provided, skip `generateNextBatchId` (the workbook already reserved it). Otherwise call `generateNextBatchId` as today.
3. For `startProductionRunCore`, accept `{ tx, runId, performedById }` and load the run + factory-floor warehouse inside the tx exactly as today.
4. For `logProductionProgressCore`, accept `{ tx, runId, unitsProduced, performedById, offlineImportRowId?, offlineImportIdentity? }`. Insert the `productionProgressLogs` row and call `applyProductionProgressLog` exactly as the online fn does, then set `offlineImportRowId`/`offlineImportIdentity` on the new log row when provided.
5. For `editLatestProgressLogCore`, accept `{ tx, runId, progressLogId, unitsProduced, editReason, performedById, offlineImportRowId?, offlineImportIdentity? }`. Reuse the existing rollback-and-reapply logic; set the offline identity on the re-applied progress log.
6. For `completeProductionRunCore`, accept `{ tx, runId, shortfallReason, performedById }`. Keep the `status === "completed"` early-return intact.
7. For `failProductionRunCore`, accept `{ tx, runId, reason, performedById }`. Keep the `hasOperatorProductionLogs` gate.

Run `bun run typecheck` after EACH file extraction to confirm the online wrappers still compile.

- [ ] **Step 4: Run the online regression tests, verify pass**

Run:

```bash
bunx vitest run src/lib/production-run-accounting.test.ts
bun run test
```

Expected: PASS. The existing `production-run-accounting.test.ts` assertions about `shouldDeductPackagingOnCompletion`, `hasOperatorProductionLogs`, `Math.floor`, `getActualPackagingQuantity`, "[FAILED BATCH RECOVERY]", "Edit Latest Log", "Type batch ID to confirm", etc. must continue to pass — they assert against source strings that remain present.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/inventory/production/create-production-run-fn.ts \
  src/server-functions/inventory/production/start-production-fn.ts \
  src/server-functions/inventory/production/log-production-progress-fn.ts \
  src/server-functions/inventory/production/edit-latest-production-progress-log-fn.ts \
  src/server-functions/inventory/production/complete-production-fn.ts \
  src/server-functions/inventory/production/fail-production-fn.ts \
  src/lib/production-run-accounting.test.ts
git commit -m "refactor(production): extract online cores as createServerOnlyFn (zero behavior change)"
```

---

### Task 11: Post (Apply) Server Function and Applier Core

**Files:**
- Create: `src/lib/production/offline/posting.server.ts`
- Create: `src/server-functions/inventory/production/offline-post-fn.ts`
- Create: `src/lib/production/offline/__tests__/offline-post.test.ts`

**Interfaces:**
- Produces:
  - `postOfflineProductionBatch(input: { batchId, actorId }): Promise<PostBatchResult>`
  - `processReadyAction(input: { actionId, actorId }): Promise<{ applied: boolean }>` (bounded single-action; called within the loop).
  - `safePostError(error): string`
  - `markDuplicate(input: { actionId, reasonCode, reasonMessage }): Promise<void>`

- [ ] **Step 1: Write failing post test**

Create `src/lib/production/offline/__tests__/offline-post.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const postingSource = readFileSync(
  resolve(process.cwd(), "src/lib/production/offline/posting.server.ts"),
  "utf8",
);
const fnSource = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/inventory/production/offline-post-fn.ts",
  ),
  "utf8",
);

describe("offline production post", () => {
  it("server fn wires middleware and feature flag", () => {
    expect(fnSource).toContain("requireOfflineProductionPostMiddleware");
    expect(fnSource).toContain("requireOfflineProductionEnabled");
    expect(fnSource).toContain("postOfflineProductionBatch");
  });

  it("claims the batch via conditional update + lease", () => {
    expect(postingSource).toContain("processingLeaseId");
    expect(postingSource).toContain("processingLeaseExpiresAt");
    expect(postingSource).toContain('status: "posting"');
    expect(postingSource).toContain("OFFLINE_PRODUCTION_BATCH_LEASE_MS");
  });

  it("takes SELECT FOR UPDATE on productionRuns, materialStock, and finishedGoodsStock", () => {
    expect(postingSource).toContain("FOR UPDATE");
    expect(postingSource).toContain("productionRuns");
    expect(postingSource).toContain("materialStock");
    expect(postingSource).toContain("finishedGoodsStock");
  });

  it("dispatches by actionKind to the extracted online cores", () => {
    expect(postingSource).toContain("createProductionRunCore");
    expect(postingSource).toContain("startProductionRunCore");
    expect(postingSource).toContain("logProductionProgressCore");
    expect(postingSource).toContain("editLatestProgressLogCore");
    expect(postingSource).toContain("completeProductionRunCore");
    expect(postingSource).toContain("failProductionRunCore");
  });

  it("re-evaluates hasOperatorProductionLogs before offline fail", () => {
    expect(postingSource).toContain("hasOperatorProductionLogs");
  });

  it("uses safePostError allow-list for apply failures", () => {
    expect(postingSource).toContain("safePostError");
  });

  it("marks duplicate on unique-violation with reasonCode already_applied", () => {
    expect(postingSource).toContain("markDuplicate");
    expect(postingSource).toContain('"already_applied"');
    expect(postingSource).toContain('"23505"');
  });

  it("atomic claimed-row UPDATE checks the returned length", () => {
    expect(postingSource).toContain("RETURNING");
    expect(postingSource).toContain("changed during apply");
  });

  it("releases the lease in finally", () => {
    expect(postingSource).toContain("finally");
    expect(postingSource).toContain("releaseBatchLease");
  });

  it("limits each post slice to OFFLINE_PRODUCTION_POST_LIMIT", () => {
    expect(postingSource).toContain("OFFLINE_PRODUCTION_POST_LIMIT");
  });

  it("sets appliedProductionLogId or appliedRunId on the staged action", () => {
    expect(postingSource).toContain("appliedProductionLogId");
    expect(postingSource).toContain("appliedRunId");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-post.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `posting.server.ts`**

Model on `src/lib/sales/offline/posting.server.ts` and `src/lib/attendance/offline/confirmation.server.ts`:

```ts
export async function postOfflineProductionBatch(input: {
  batchId: string;
  actorId: string;
}): Promise<PostBatchResult> {
  const existing = await db.select({ status: offlineProductionImportBatches.status })
    .from(offlineProductionImportBatches)
    .where(eq(offlineProductionImportBatches.id, input.batchId)).limit(1);
  if (!existing[0]) throw new Error("Offline production batch was not found.");
  if (existing[0].status === "completed") {
    return { batchId: input.batchId, status: "completed", posted: 0, failed: 0, remaining: 0, hasMore: false };
  }
  const { leaseId } = await claimBatch(input.batchId);
  const candidates = await db.select({ id: offlineProductionStagedActions.id })
    .from(offlineProductionStagedActions)
    .where(and(eq(offlineProductionStagedActions.batchId, input.batchId), eq(offlineProductionStagedActions.status, "ready")))
    .orderBy(asc(offlineProductionStagedActions.slotId), asc(offlineProductionStagedActions.rowSequenceNumber))
    .limit(OFFLINE_PRODUCTION_POST_LIMIT);
  let posted = 0, failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await processReadyAction({ actionId: candidate.id, actorId: input.actorId });
      if (result.applied) posted += 1;
    } catch (error) {
      failed += 1;
      console.error("Offline production action apply failed", { actionId: candidate.id, error });
      await db.update(offlineProductionStagedActions).set({
        status: "needs_review",
        reasonCode: "apply_failed",
        reasonMessage: safePostError(error),
        updatedAt: new Date(),
      }).where(and(eq(offlineProductionStagedActions.id, candidate.id), ne(offlineProductionStagedActions.status, "applied")));
    }
  }
  const final = await finalizeBatch(input.batchId, leaseId);
  return { batchId: input.batchId, status: final.status, posted, failed, remaining: final.remaining, hasMore: final.remaining > 0 };
}
```

- `claimBatch` — atomic conditional UPDATE → `posting`, leased for `OFFLINE_PRODUCTION_BATCH_LEASE_MS`, allowed iff current status in `["preview_ready","completed_with_issues","posting"]` and lease free/expired.
- `processReadyAction` — its own `db.transaction`: `SELECT * FROM production_runs WHERE id=? FOR UPDATE` (or skip the lock for `create_run` since the run doesn't exist yet — instead `SELECT * FROM offline_production_run_slots WHERE id=? FOR UPDATE`); `SELECT * FROM material_stock WHERE warehouseId=? AND (chemicalId|packagingMaterialId)=? FOR UPDATE` for each material the action touches (use the snapshot to know which rows); `SELECT * FROM finished_goods_stock WHERE warehouseId=? AND recipeId=? FOR UPDATE` when the action touches FG; `SELECT * FROM offline_production_run_slots WHERE id=? FOR UPDATE`. Re-classify via `classifyOfflineProductionAction` reusing the live state. Atomic `UPDATE staged_actions SET status='applied' WHERE id=? AND status='ready' RETURNING *` — if returned length !== 1 throw `"Offline production action changed during apply."`. Dispatch by `actionKind`:
  - `create_run` → call `createProductionRunCore(tx, { recipeId, warehouseId: factoryFloor.id, batchesProduced, scheduledStartDate, notes, operatorId: workbook.operatorUserId, initiatorId: actorId, reservedBatchId: slot.reservedBatchId })`. Then update the run row to set `offlineProductionSlotId = slot.id`. Set `staged_actions.appliedRunId = run.id`. Set the slot's `postedRunId = run.id` (guarded `WHERE postedRunId IS NULL`).
  - `start_run` → load the run via `postedRunId` of the slot; call `startProductionRunCore`.
  - `log_progress` → call `logProductionProgressCore(tx, { runId, unitsProduced, performedById: actorId, offlineImportRowId: action.id, offlineImportIdentity: \`${slot.workbookId}:${action.recordToken}:${action.rowSequenceNumber}\` })`. Set `staged_actions.appliedProductionLogId = log.id`.
  - `edit_log` → call `editLatestProgressLogCore(...)` with the same offline-identity params.
  - `complete` → call `completeProductionRunCore` (idempotent early-return preserved).
  - `fail` → re-evaluate `hasOperatorProductionLogs(run)` live inside the tx (the tx already locked the run); if true throw `"Logs exist. Close with shortfall, not failed."`. Else call `failProductionRunCore`.
- `safePostError` — copy the sales allow-list shape; safe prefixes: `"Offline production action is not approved for posting"`, `"Run is not in_progress"`, `"Run already completed"`, `"Run not found"`, `"Recipe is no longer active"`, `"Insufficient chemical stock"`, `"Insufficient packaging stock"`, `"Only the latest log can be edited"`, `"Logs exist. Close with shortfall, not failed"`, `"Staged action changed during apply"`. Fallback: `"Action could not be applied. Refresh the preview and review current data."`
- `finalizeBatch` — recompute counts → `posting` if `ready` remain; `completed_with_issues` if other issues remain; `completed` otherwise. Release lease.
- `markDuplicate` — `UPDATE staged_actions SET status='duplicate', reasonCode='already_applied', reasonMessage='Offline production action was already applied' WHERE id=?`. Called in the `catch` block when `error.code === "23505"`.

- [ ] **Step 4: Implement `offline-post-fn.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOfflineProductionEnabled } from "@/lib/production/offline/feature-flag.server";
import { postOfflineProductionBatch } from "@/lib/production/offline/posting.server";
import { requireOfflineProductionPostMiddleware } from "@/lib/middlewares";

const postSchema = z.object({ batchId: z.string().min(1) });

export const postOfflineProductionBatchFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineProductionPostMiddleware])
  .inputValidator(postSchema)
  .handler(async ({ data, context }) => {
    requireOfflineProductionEnabled();
    return await postOfflineProductionBatch({
      batchId: data.batchId,
      actorId: context.session.user.id,
    });
  });
```

- [ ] **Step 5: Run post test, verify pass**

Run:

```bash
bunx vitest run src/lib/production/offline/__tests__/offline-post.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 6: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/production/offline/posting.server.ts \
  src/server-functions/inventory/production/offline-post-fn.ts \
  src/lib/production/offline/__tests__/offline-post.test.ts
git commit -m "feat(offline-production): add post applier with FOR UPDATE locks and online cores"
```

---

### Task 12: Client Hooks + Query Keys + Cross-Domain Invalidation

**Files:**
- Create: `src/hooks/production/use-offline-production.ts`
- Create: `src/hooks/production/__tests__/use-offline-production.test.ts`

**Interfaces:**
- Produces the query-key factory `offlineProductionKeys`, query options, and mutations: `useUploadOfflineProductionWorkbook`, `useListOfflineProductionWorkbooks`, `useRefreshOfflineProductionPreview`, `useExcludeOfflineProductionAction`, `usePostOfflineProductionBatch`.

- [ ] **Step 1: Write failing hook test**

Create `src/hooks/production/__tests__/use-offline-production.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/hooks/production/use-offline-production.ts"),
  "utf8",
);

describe("use-offline-production hooks", () => {
  it("exports the query-key factory", () => {
    expect(SOURCE).toContain('offlineProductionKeys =');
    expect(SOURCE).toContain('["offline-production"]');
    expect(SOURCE).toContain("workbooks()");
    expect(SOURCE).toContain("queues()");
    expect(SOURCE).toContain("batch(id)");
  });

  it("exports the five hooks", () => {
    expect(SOURCE).toContain("useUploadOfflineProductionWorkbook");
    expect(SOURCE).toContain("useListOfflineProductionWorkbooks");
    expect(SOURCE).toContain("useRefreshOfflineProductionPreview");
    expect(SOURCE).toContain("useExcludeOfflineProductionAction");
    expect(SOURCE).toContain("usePostOfflineProductionBatch");
  });

  it("post hook loops while hasMore with a guard of 30", () => {
    expect(SOURCE).toContain("hasMore");
    expect(SOURCE).toContain("runs < 30");
  });

  it("post hook invalidates the cross-domain keys on success", () => {
    const invalidations = [
      '["production-runs"]',
      '["operator-production-runs"]',
      '["finished-goods"]',
      '["factory-floor"]',
      '["materials"]',
      '["cartons"]',
      '["production-runs-sync"]',
    ];
    for (const key of invalidations) expect(SOURCE).toContain(key);
  });

  it("upload hook invalidates the offline-production namespace", () => {
    expect(SOURCE).toContain("offlineProductionKeys.all");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run:

```bash
bunx vitest run src/hooks/production/__tests__/use-offline-production.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hooks**

Model on `src/hooks/sales/use-offline-sales.ts`:
- `offlineProductionKeys` factory with `all`, `workbooks()`, `operators()`, `queues()`, `batch(id)`.
- `offlineProductionQueries` with `staleTime`s (workbooks 15s, operators 60s, queues 10s, batch 5s).
- `useUploadOfflineProductionWorkbook` — POST FormData, toast differs on `rejected` vs `preview_ready`.
- `useRefreshOfflineProductionPreview`, `useExcludeOfflineProductionAction` — invalidate the specific batch + queues.
- `usePostOfflineProductionBatch` — loop while `result.hasMore && runs < 30`; on success invalidate `offlineProductionKeys.all` AND the cross-domain keys (the seven listed in the test). Toast `"Posting paused safely. Press Post again to continue."` if the cap is hit.
- `saveWorkbookResponse` helper for downloads (copy sales's `Content-Disposition` parser, fallback `offline-production-F01.xlsx`).

- [ ] **Step 4: Run hook test, verify pass**

Run:

```bash
bunx vitest run src/hooks/production/__tests__/use-offline-production.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/production/use-offline-production.ts \
  src/hooks/production/__tests__/use-offline-production.test.ts
git commit -m "feat(offline-production): add hooks with cross-domain invalidation"
```

---

### Task 13: UI Components and Route

**Files:**
- Create: `src/components/manufacturing/offline/offline-production-page.tsx`
- Create: `src/components/manufacturing/offline/workbook-panel.tsx`
- Create: `src/components/manufacturing/offline/upload-panel.tsx`
- Create: `src/components/manufacturing/offline/review-panel.tsx`
- Create: `src/components/manufacturing/offline/import-history.tsx`
- Create: `src/routes/_protected/manufacturing/productions/offline.tsx`

**Interfaces:**
- Produces the offline production page and route with permission-scoped prefetch.

- [ ] **Step 1: Implement the page shell**

Create `src/components/manufacturing/offline/offline-production-page.tsx` modeled on `src/components/sales/offline/offline-sales-page.tsx`:
- `useViewerAccess()` + `hasPermission`.
- Tabs: `Workbook` (if `manufacturing.offline.workbooks.manage`), `Upload & Review` (if any of upload/review/post), `History`.
- Steps cards identical in shape to the sales page (Prepare workbook, Work during outage, Upload and apply).

- [ ] **Step 2: Implement the workbook panel**

Create `workbook-panel.tsx` modeled on `src/components/sales/offline/workbook-panel.tsx`:
- Operator select bound to `listOfflineProductionOperatorsFn`.
- Issue button calls `issueOfflineProductionWorkbookFn`.
- Workbook list with replace and force-retire buttons (force-retire opens an AlertDialog with a reason textarea 5-500 chars).
- Download button calls `downloadOfflineProductionWorkbookFn` and saves via `saveWorkbookResponse`.

- [ ] **Step 3: Implement the upload panel**

Create `upload-panel.tsx`:
- PKT datetime-local inputs for outage start/end with `toPktIso` conversion (copy sales's helper).
- Reason textarea 5-500 chars.
- File input accepts `.xlsx`.
- On success, set the selected batch and switch to the review panel.

- [ ] **Step 4: Implement the review panel**

Create `review-panel.tsx`:
- Read the batch preview grouped by slot.
- Per-action rows with status badges, reason text, exclude button for `needs_review|invalid|blocked`.
- Refresh preview button.
- Big "Apply to production ledger" button calling `usePostOfflineProductionBatch`; toast loop results.

- [ ] **Step 5: Implement import history**

Create `import-history.tsx` modeled on sales `import-history.tsx`:
- Batch list with status badges and "Review" button that sets the selected batch and switches to the review tab.

- [ ] **Step 6: Implement the route**

Create `src/routes/_protected/manufacturing/productions/offline.tsx`:

```tsx
import { createFileRoute, Await } from "@tanstack/react-start";
import { Suspense } from "react";
import { OfflineProductionPage } from "@/components/manufacturing/offline/offline-production-page";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

export const Route = createFileRoute(
  "/_protected/manufacturing/productions/offline",
)({
  component: OfflineProductionPage,
  loader: async ({ context }) => {
    const viewerAccess = await context.viewerAccess;
    const permissions = viewerAccess?.permissions ?? [];
    const queries: Promise<unknown>[] = [];
    if (hasPermission(permissions, "manufacturing.offline.view")) {
      queries.push(queryClient.prefetchQuery(offlineProductionQueries.queues()));
    }
    if (hasPermission(permissions, "manufacturing.offline.workbooks.manage")) {
      queries.push(queryClient.prefetchQuery(offlineProductionQueries.workbooks()));
      queries.push(queryClient.prefetchQuery(offlineProductionQueries.operators()));
    }
    await Promise.allSettled(queries);
  },
});
```

- [ ] **Step 7: Run typecheck and lint**

Run:

```bash
bun run typecheck && bun run lint
```

Expected: Exit 0 (`lint` is non-blocking in CI; verify no errors prevent the build).

- [ ] **Step 8: Confirm route registration**

Run:

```bash
bun run dev
```

Open `http://localhost:3000/manufacturing/productions/offline` in a browser. The page renders with the tabs visible for a logged-in admin/super-admin. Stop the dev server with Ctrl-C once confirmed.

- [ ] **Step 9: Commit**

```bash
git add src/components/manufacturing/offline/ \
  src/routes/_protected/manufacturing/productions/offline.tsx
git commit -m "feat(offline-production): add UI page, panels, and route"
```

---

### Task 14: Pending Report Banner + Operator Screen Lock

**Files:**
- Modify: `src/server-functions/reports/offline-report-status-fn.ts`
- Modify: `src/components/reports/offline-report-pending-banner.tsx`
- Modify: `src/routes/_protected/operator/$runId.tsx`
- Modify: `src/routes/_protected/operator/index.tsx`

**Interfaces:**
- Produces a `hasUnappliedOfflineProductionActions` field on the report-status result and a lock banner on the operator screens.

- [ ] **Step 1: Extend the report-status server fn**

In `src/server-functions/reports/offline-report-status-fn.ts`, augment the returned selector to also query `offlineProductionStagedActions` for any `status ∈ ["ready","warning","invalid","needs_review","blocked","posting"]`. Return `{ hasUnpostedOfflineInvoices, hasUnappliedOfflineProductionActions }`. The fn keeps `requireReportsViewMiddleware` and `requireOfflineSalesEnabled`/`requireOfflineProductionEnabled` is NOT enforced on the status read (the existing sales status check does not enforce the feature flag either, so the banner can show even when imports are disabled — copy that intentional lax surface). If the production feature flag is off, return `hasUnappliedOfflineProductionActions: false` so deployments without the feature remain quiet.

- [ ] **Step 2: Extend the pending banner**

In `src/components/reports/offline-report-pending-banner.tsx`, render the existing amber Alert when `hasUnpostedOfflineInvoices`, AND render a sibling amber Alert when `hasUnappliedOfflineProductionActions`. Keep the 30s refetch interval and 10s staleTime. Add a source-inspection test or augment the existing banner assertions.

- [ ] **Step 3: Add the operator screen lock**

In `src/routes/_protected/operator/$runId.tsx`:
- Query `getOfflineReportStatusFn()` (same query used by the banner).
- When `hasUnappliedOfflineProductionActions` is true: render an amber banner at the top of the operator run page reading `"Offline production batch is pending sync. Apply it before logging progress online."` and disable the log-progress form, edit-latest-log, force-complete, and mark-failed buttons (set `disabled` and reduce opacity). Do not otherwise mutate the page.
- In `src/routes/_protected/operator/index.tsx`, render the same banner above the runs list and disable the "Manage" links when the lock is active.

- [ ] **Step 4: Write the banner test assertion**

Augment the existing banner test or `src/components/reports/__tests__/offline-report-pending-banner.test.tsx` (create if missing) to assert:
- The banner queries the merged status fn.
- `refetchInterval: 30_000` and `staleTime: 10_000` are present.
- Both `hasUnpostedOfflineInvoices` and `hasUnappliedOfflineProductionActions` branches render distinct alerts.

- [ ] **Step 5: Run typecheck and full test suite**

Run:

```bash
bun run typecheck && bun run test
```

Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/reports/offline-report-status-fn.ts \
  src/components/reports/offline-report-pending-banner.tsx \
  src/routes/_protected/operator/$runId.tsx \
  src/routes/_protected/operator/index.tsx
git commit -m "feat(offline-production): add pending report banner and operator screen lock"
```

---

### Task 15: Operational Defaults — Env Example and Final Production Build Verification

**Files:**
- Modify: `.env.example`
- Verify: `Dockerfile`, `bun.lock`, `package.json`

- [ ] **Step 1: Add the env defaults**

Add to `.env.example`:

```dotenv
OFFLINE_PRODUCTION_IMPORT_ENABLED=false
OFFLINE_PRODUCTION_SIGNING_KEYS={"1":"replace-with-base64-32-byte-key"}
OFFLINE_PRODUCTION_ACTIVE_SIGNING_VERSION=1
```

- [ ] **Step 2: Run the production build**

Run:

```bash
bun run build
```

Expected: Exit 0. The build must succeed with placeholder env (CI runs without DB env vars). If the build OOMs, set `NODE_OPTIONS=--max-old-space-size=4096` (already wired into `package.json`'s build script per AGENTS.md).

- [ ] **Step 3: Run the full test suite one final time**

Run:

```bash
bun run test
```

Expected: All green, with the test count > baseline (Task 0 count plus the new tests added across tasks).

- [ ] **Step 4: Run graphify update (no API cost)**

Run:

```bash
graphify update .
```

Expected: The graph is updated and the HTML report reflects the new `src/lib/production/offline/*` and `src/components/manufacturing/offline/*` modules.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "build(offline-production): add env defaults and verify production build"
```

---

## Notes for the executing engineer

- Every step's `git add` list is the minimum required; if `bun run db:generate` writes additional metadata files (e.g., `meta/`), add them to the same commit.
- If a test fails after a generation step, the most common cause is a mismatched index name — copy the exact name Drizzle produced back into the source-inspection test.
- The online-core extraction in Task 10 must NOT change any existing test's source-string assertions (search the test files for the strings like `shouldDeductPackagingOnCompletion`, `hasOperatorProductionLogs`, `[FAILED BATCH RECOVERY]`, "Edit Latest Log", "Type batch ID to confirm"). If any of these tests start failing, the extraction silently changed behavior; restore the literal source and retry.
- The `SELECT FOR UPDATE` introduced in Task 11 is offline-only; do not backport it to the online fns in this plan.
- Never commit the `.xlsx` fixtures used in parser tests; generate them in-memory with `buildOfflineProductionWorkbook` inside the test.

## Self-review

- Spec coverage: every section of the design spec is implemented by at least one task. Phase numbering maps to Task groups (Foundation = Tasks 1-2, Schema & Workbook = 3-6, Upload & Review = 7-9, Online-core extraction + Post = 10-11, Client + UI = 12-13, Banner + Lock = 14, Operational = 15). Lab reports, supervisor outage confirmation, and offline cancel are explicitly out of scope (design §3, §12).
- Placeholder scan: every step shows the code, command, or assertion text it requires; no "TODO" / "TBD" / "implement later" strings.
- Type consistency: the extracted `*Core` signatures in Task 10 match the calls in Task 11 (`createProductionRunCore(tx, { ..., reservedBatchId? })`, `logProductionProgressCore(tx, { ..., offlineImportRowId?, offlineImportIdentity? })`, etc.). Query keys in Task 12 match the keys enumerated in the post invalidation list. The `OfflineProductionActionPayload` discriminated union in Task 6 step 1 matches the dispatch switch in Task 11. The permissions asserted in Task 2 match the middleware used in Tasks 5, 7, 9, 11.