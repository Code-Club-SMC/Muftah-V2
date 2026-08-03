# Offline Attendance Excel Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, macro-free Excel fallback for attendance outages that imports individual punches through supervisor confirmation, HR review, idempotent database writes, and existing attendance calculations.

**Architecture:** One permanent signed workbook belongs to one operator. Upload parses the workbook in memory, stores immutable row attempts, merges them with live punches, and confirms safe employee/day groups through short transactions guarded by batch leases, employee advisory locks, and durable record claims. PostgreSQL stores attendance and audit data; uploaded workbook bytes are never stored.

**Tech Stack:** TanStack Start server functions and file routes, React 19, TanStack Query, Zod 4, Drizzle ORM, PostgreSQL, ExcelJS 4.4.0, zip.js 2.8.34, Vitest, Testing Library, fast-check.

## Global Constraints

- Scope is attendance only at one factory location.
- No local factory server, local database, backup internet, or browser offline entry.
- Accept only macro-free `.xlsx`; reject `.xlsm`, formulas in input cells, encryption, external links, external data, unsupported structure, files above 10 MB, and sheets above 20,000 prepared rows.
- Parse uploaded workbook bytes in memory. Never persist workbook bytes to disk, object storage, PostgreSQL, logs, or backups.
- One active permanent workbook per operator; operator appends to prepared rows and never inserts, deletes, reorders, sorts, or reuses rows.
- Workbook contains 20,000 prepared rows and warns below 1,000 unused rows.
- Required operator values: employee code, `YYYY-MM-DD` date, `HH:mm` Asia/Karachi time, explicit `IN|OUT`, optional note up to 500 characters.
- Operator, outage supervisor, and final HR reviewer must be three distinct authenticated users.
- One import batch covers one supervisor-confirmed outage window.
- Exact re-uploads are duplicates. Changed content under an imported identity never overwrites the database.
- Import punches with source `offline_excel`; never import Excel totals or formulas.
- Reuse existing employee punch advisory locks and `recomputeAttendanceRow`.
- Approved and paid payroll periods are blocked. Draft payroll becomes invalid until affected payslips are regenerated.
- Safe employee/attendance-date groups may commit independently; every row must have a known recoverable outcome.
- Feature ships behind `OFFLINE_ATTENDANCE_IMPORT_ENABLED=false`.
- `OFFLINE_ATTENDANCE_SIGNING_KEYS` is a runtime-only JSON keyring whose values are base64 32-byte keys; `OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION` selects issuance key. Missing active key must not break CI build; enabled runtime operations must fail closed.
- Do not edit `src/routeTree.gen.ts`; build regenerates it.
- Production dependency install must use pinned `bun.lock`.
- After code changes, run `graphify update .`.
- Approved design: `docs/superpowers/specs/2026-08-03-offline-attendance-excel-import-design.md`.

## File Structure

### Shared attendance domain

- Create `src/lib/attendance/offline/contracts.ts`: serializable enums, Zod inputs, preview/result types.
- Create `src/lib/attendance/offline/constants.ts`: template, file, ZIP, batch, lease, heartbeat, and retention limits.
- Create `src/lib/attendance/offline/feature-flag.server.ts`: runtime feature/key guards.
- Create `src/lib/attendance/offline/signing.server.ts`: workbook signature, row token, content hash.
- Create `src/lib/attendance/offline/ooxml-guard.server.ts`: strict in-memory OOXML ZIP inspection.
- Create `src/lib/attendance/offline/workbook-template.server.ts`: protected workbook generation.
- Create `src/lib/attendance/offline/workbook-parser.server.ts`: structure and literal-cell parsing.
- Create `src/lib/attendance/offline/timeline.ts`: pure date attribution, timeline merge, grouping, classification.
- Create `src/lib/attendance/offline/preview.server.ts`: load live data and persist preview classifications.
- Create `src/lib/attendance/offline/confirmation.server.ts`: lease and bounded group confirmation.
- Create `src/lib/attendance/offline/payroll-invalidation.server.ts`: payroll block/invalidate/resolve rules.

### Database and permissions

- Create `src/db/schemas/offline-attendance-schema.ts`: workbook, outage, batch, row, heartbeat, correction, and payroll invalidation tables.
- Modify `src/db/schemas/hr-schema.ts`: add `offline_excel` source and offline identity/link fields.
- Modify `src/db/index.ts`: merge and export offline attendance schema.
- Generate `src/db/migrations/0008_offline_attendance_import.sql` and matching Drizzle metadata.
- Modify `src/lib/rbac.ts`, `src/lib/authz.server.ts`, and `src/lib/middlewares.ts`: six permissions and safe system-role seed sync.

### Server functions

- Create `src/server-functions/hr/attendance/offline-workbooks-fn.ts`: issue, list, download, replace, retire.
- Create `src/server-functions/hr/attendance/offline-upload-fn.ts`: FormData upload and immutable batch creation.
- Create `src/server-functions/hr/attendance/offline-review-fn.ts`: supervisor decision, preview, exclude, history.
- Create `src/server-functions/hr/attendance/offline-confirm-fn.ts`: bounded confirm/resume call.
- Create `src/server-functions/hr/attendance/terminal-heartbeat-fn.ts`: minute-bucket heartbeat.
- Modify `src/server-functions/hr/attendance/manual-punches-fn.ts`: reasoned correction audit.
- Modify `src/server-functions/hr/payroll/payroll-fn.ts`: block stale approval and clear invalidation after regeneration.

### Client and route

- Create `src/hooks/hr/use-offline-attendance.ts`: viewer-scoped queries and mutations.
- Create `src/components/hr/attendance/offline/offline-attendance-page.tsx`: permission-aware page shell.
- Create `src/components/hr/attendance/offline/workbook-panel.tsx`: issue/download/replace/retire.
- Create `src/components/hr/attendance/offline/upload-panel.tsx`: upload and outage declaration.
- Create `src/components/hr/attendance/offline/supervisor-panel.tsx`: confirm/reject outage.
- Create `src/components/hr/attendance/offline/review-panel.tsx`: timeline preview, exclude, confirm/resume.
- Create `src/components/hr/attendance/offline/import-history.tsx`: batch and row audit.
- Create `src/routes/_protected/hr/attendance/offline.tsx`: route and user-scoped loader.
- Modify `src/lib/constants.ts`: Offline Attendance navigation item.
- Modify `src/components/attendance/scan-terminal.tsx`: honest connectivity label, heartbeat, Excel fallback message.
- Modify `src/components/hr/attendance/manual-punch-timeline.tsx`: offline source label and correction reason.

### Verification and operations

- Create `vitest.integration.config.ts`: guarded PostgreSQL integration config.
- Create `docker-compose.test.yml`: isolated `titan_offline_test` database on port 5434.
- Create `src/__tests__/integration/offline-attendance-import.integration.test.ts`: concurrency, resume, payroll, and rollback tests.
- Modify `.github/workflows/ci.yml`: required PostgreSQL integration job.
- Create `docs/operations/offline-attendance-runbook.md`: operator, supervisor, HR, recovery, key rotation, and rollout steps.

---

### Task 0: Restore Green Unit-Test Baseline

**Files:**
- Modify: `src/components/attendance/scan-terminal.test.ts`
- Modify: `src/components/hr/employees/employee-id-card.test.ts`

**Interfaces:**
- Consumes: current source-inspection test style.
- Produces: clean 291-test baseline before feature work.

- [ ] **Step 1: Correct stale source targets**

Change scanner assertion to current visible copy:

```ts
expect(source).toContain("2D Barcode Scanner");
```

Change employee-card test source to the implementation that now owns barcode and CR80 constants:

```ts
const SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/hr/employees/employee-card.tsx"),
  "utf8",
);
```

- [ ] **Step 2: Run the two repaired test files**

Run:

```bash
bunx vitest run src/components/attendance/scan-terminal.test.ts src/components/hr/employees/employee-id-card.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3: Run full baseline**

Run:

```bash
bun run test
```

Expected: 47 files pass and 291 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/attendance/scan-terminal.test.ts src/components/hr/employees/employee-id-card.test.ts
git commit -m "test: refresh attendance source safeguards"
```

---

### Task 1: Secure XLSX Boundary and Deterministic Dependencies

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `Dockerfile`
- Modify: `.env.example`
- Create: `src/lib/attendance/offline/constants.ts`
- Create: `src/lib/attendance/offline/feature-flag.server.ts`
- Create: `src/lib/attendance/offline/signing.server.ts`
- Create: `src/lib/attendance/offline/ooxml-guard.server.ts`
- Test: `src/lib/attendance/offline/signing.test.ts`
- Test: `src/lib/attendance/offline/ooxml-guard.test.ts`

**Interfaces:**
- Produces:
  - `requireOfflineAttendanceEnabled(): void`
  - `signWorkbookManifest(input: WorkbookManifest): string`
  - `createRecordToken(input: RecordTokenInput): string`
  - `verifyRecordToken(input: RecordTokenInput & { token: string }): boolean`
  - `hashOfflineRow(input: OfflineRowHashInput): string`
  - `inspectXlsxPackage(bytes: Uint8Array): Promise<void>`

- [ ] **Step 1: Add exact dependencies and pin Docker build**

Run:

```bash
bun add --exact exceljs@4.4.0 @zip.js/zip.js@2.8.34
```

Replace Docker builder install with:

```dockerfile
FROM oven/bun:1.3.12-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
```

Keep current Node 20 runtime stage and command unchanged.

Add:

```dotenv
OFFLINE_ATTENDANCE_IMPORT_ENABLED=false
OFFLINE_ATTENDANCE_SIGNING_KEYS={"1":"replace-with-base64-32-byte-key"}
OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION=1
```

- [ ] **Step 2: Write failing signing tests**

Cover deterministic signatures, row-number binding, operator binding, timing-safe rejection, normalized content hashes, missing key while enabled, and no failure while disabled.

```ts
describe("offline workbook signing", () => {
  it("binds tokens to workbook, operator, version, and row", () => {
    const token = createRecordToken({
      workbookId: "wb-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      rowNumber: 2,
    });

    expect(verifyRecordToken({
      workbookId: "wb-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      rowNumber: 2,
      token,
    })).toBe(true);

    expect(verifyRecordToken({
      workbookId: "wb-1",
      operatorUserId: "operator-1",
      templateVersion: 1,
      rowNumber: 3,
      token,
    })).toBe(false);
  });
});
```

- [ ] **Step 3: Run signing test and verify failure**

Run:

```bash
bunx vitest run src/lib/attendance/offline/signing.test.ts
```

Expected: FAIL because signing exports do not exist.

- [ ] **Step 4: Add constants and signing implementation**

Define exact limits:

```ts
export const OFFLINE_TEMPLATE_VERSION = 1;
export const OFFLINE_WORKBOOK_ROW_CAPACITY = 20_000;
export const OFFLINE_WORKBOOK_LOW_ROWS = 1_000;
export const OFFLINE_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024;
export const OFFLINE_ZIP_MAX_ENTRIES = 256;
export const OFFLINE_ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const OFFLINE_ZIP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const OFFLINE_DUPLICATE_WINDOW_MS = 30_000;
export const OFFLINE_OVERNIGHT_OUT_BEFORE_HOUR = 12;
export const OFFLINE_CONFIRM_GROUP_LIMIT = 25;
export const OFFLINE_BATCH_LEASE_MS = 2 * 60_000;
export const TERMINAL_HEARTBEAT_INTERVAL_MS = 60_000;
export const TERMINAL_HEARTBEAT_RETENTION_DAYS = 90;
```

Feature guard:

```ts
export function requireOfflineAttendanceEnabled() {
  if (process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED !== "true") {
    throw new Error("Offline attendance import is disabled");
  }
}
```

Signing key rules:

```ts
import { Buffer } from "node:buffer";
import { z } from "zod";

function signingKey(version: number) {
  const value = process.env.OFFLINE_ATTENDANCE_SIGNING_KEYS;
  if (!value) throw new Error("OFFLINE_ATTENDANCE_SIGNING_KEYS is required");
  const keyring = z.record(z.string(), z.string()).parse(JSON.parse(value));
  const encoded = keyring[String(version)];
  if (!encoded) throw new Error("Offline attendance signing version is unavailable");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("Offline attendance signing key must decode to 32 bytes");
  }
  return key;
}
```

Use `createHmac("sha256", signingKey(signingVersion))`, base64url output, canonical NUL-separated values, `timingSafeEqual`, and `createHash("sha256")` for content hashes. Issuance reads `OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION`; verification reads the workbook registry version and accepts non-active versions still present in the keyring.

- [ ] **Step 5: Write failing OOXML guard tests**

Build in-memory ZIP fixtures with `ZipWriter`. Cover valid minimal OOXML, encrypted entry metadata, duplicate paths, path traversal, Zip64, entry count, uncompressed total, `xl/vbaProject.bin`, `xl/externalLinks/`, `xl/connections.xml`, `xl/queryTables/`, `xl/embeddings/`, `xl/activeX/`, and `TargetMode="External"` in relationship XML.

- [ ] **Step 6: Implement strict OOXML inspection**

Use:

```ts
const FORBIDDEN_PATHS = [
  "xl/vbaproject.bin",
  "xl/connections.xml",
] as const;

const FORBIDDEN_PREFIXES = [
  "xl/externallinks/",
  "xl/querytables/",
  "xl/embeddings/",
  "xl/activex/",
  "xl/ctrlprops/",
] as const;
```

Construct `ZipReader(new Uint8ArrayReader(bytes), { strictness: "strict", checkAmbiguity: true, maxAppendedDataSize: 0 })`. Reject encrypted, Zip64, duplicate, absolute, backslash, or `..` paths before extracting content. Sum declared uncompressed sizes before extraction. Read only `.rels` files after verifying each is below the entry limit, parse them as XML, and reject every `Relationship` whose `TargetMode` equals `External` case-insensitively. Always close reader in `finally`.

- [ ] **Step 7: Run focused security tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/signing.test.ts src/lib/attendance/offline/ooxml-guard.test.ts
```

Expected: PASS.

- [ ] **Step 8: Audit and build dependencies**

Run:

```bash
bun audit
bun run build
docker build -t titan-offline-attendance-plan-check .
```

Expected: build commands pass. If audit reports a high or critical issue attributable to either new package, stop and replace that dependency before continuing.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock Dockerfile .env.example src/lib/attendance/offline
git commit -m "build: add secure xlsx processing foundation"
```

---

### Task 2: Offline Attendance Data Model and Migration

**Files:**
- Create: `src/db/schemas/offline-attendance-schema.ts`
- Modify: `src/db/schemas/hr-schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/migrations/0008_offline_attendance_import.sql`
- Create: `src/db/migrations/meta/0008_snapshot.json`
- Modify: `src/db/migrations/meta/_journal.json`
- Test: `src/db/schemas/offline-attendance-schema.test.ts`

**Interfaces:**
- Produces tables:
  - `attendanceOfflineWorkbooks`
  - `attendanceOutageWindows`
  - `attendanceImportBatches`
  - `attendanceImportRows`
  - `attendanceTerminalHeartbeats`
  - `attendancePunchCorrectionAudit`
  - `payrollAttendanceInvalidations`

- [ ] **Step 1: Write failing schema contract test**

Use Drizzle `getTableConfig` to assert table names, foreign keys, check constraints, indexes, and the durable partial unique claim:

```ts
const rows = getTableConfig(attendanceImportRows);

expect(rows.name).toBe("attendance_import_rows");
expect(rows.uniqueIndexes.some((index) =>
  index.config.name === "attendance_import_rows_imported_identity_idx"
)).toBe(true);
```

Also assert `attendancePunches.source` type accepts `offline_excel`, and fields `offlineImportRowId` and `offlineImportIdentity` exist.

- [ ] **Step 2: Run schema test and verify failure**

Run:

```bash
bunx vitest run src/db/schemas/offline-attendance-schema.test.ts
```

Expected: FAIL because schema file does not exist.

- [ ] **Step 3: Define workflow types and tables**

Use these exact state unions:

```ts
export type OfflineWorkbookStatus = "active" | "retired" | "replaced";
export type OfflineOutageStatus = "pending" | "confirmed" | "rejected";
export type OfflineBatchStatus =
  | "uploaded"
  | "awaiting_supervisor"
  | "preview_ready"
  | "importing"
  | "completed"
  | "completed_with_issues"
  | "cancelled"
  | "rejected";
export type OfflineRowStatus =
  | "pending"
  | "ready"
  | "duplicate"
  | "needs_review"
  | "invalid"
  | "blocked"
  | "imported"
  | "excluded";
```

Required database fields:

```ts
attendanceOfflineWorkbooks: {
  id, assignedOperatorUserId, templateVersion, rowCapacity, signingVersion,
  status, issuedByUserId, replacedByWorkbookId, retiredByUserId,
  retiredReason, issuedAt, retiredAt, createdAt, updatedAt
}

attendanceOutageWindows: {
  id, workbookId, startsAt, endsAt, reason, status, declaredByUserId,
  confirmedByUserId, confirmedAt, rejectedAt, createdAt, updatedAt
}

attendanceImportBatches: {
  id, workbookIdNullable, outageWindowIdNullable, uploadedByUserId,
  reviewedByUserId, originalFilename, fileSha256, byteSize, status,
  totalRows, readyRows, duplicateRows, reviewRows, invalidRows, blockedRows,
  importedRows, excludedRows, lastError, processingLeaseId,
  processingLeaseExpiresAt, uploadedAt, reviewedAt, completedAt,
  createdAt, updatedAt
}

attendanceImportRows: {
  id, batchId, workbookId, worksheetRowNumber, recordToken,
  rawEmployeeCode, rawDate, rawTime, rawDirection, rawNote,
  normalizedTimestamp, attendanceDate, employeeId, contentHash,
  status, reasonCode, reasonMessage, punchId, createdAt, updatedAt
}

attendanceTerminalHeartbeats: {
  id, terminalUserId, minuteBucket, observedAt, createdAt
}

attendancePunchCorrectionAudit: {
  id, originalPunchId, originalImportRowId, action, oldValues, newValues,
  reason, changedByUserId, changedAt
}

payrollAttendanceInvalidations: {
  id, payrollId, importBatchId, affectedSummary, createdAt,
  resolvedAt, resolvedByUserId
}
```

Constraints:

- outage `startsAt < endsAt`;
- byte size and row numbers are positive;
- one heartbeat per terminal/minute;
- one active workbook per operator through a partial unique index;
- one row number per batch;
- one unresolved payroll invalidation per payroll/batch;
- partial unique `(workbook_id, record_token) WHERE status = 'imported'`.

- [ ] **Step 4: Extend attendance punches**

Add:

```ts
source: text("source", {
  enum: ["qr_terminal", "manual", "offline_excel"],
}).default("qr_terminal").notNull(),
offlineImportRowId: text("offline_import_row_id"),
offlineImportIdentity: text("offline_import_identity"),
```

Add unique partial index on `offlineImportIdentity` when non-null. The durable claim remains the imported row partial unique index even after a punch is corrected or deleted.

- [ ] **Step 5: Merge schema exports**

Import `offline-attendance-schema` in `src/db/index.ts`, spread it into the Drizzle schema object, and export all seven tables.

- [ ] **Step 6: Generate and inspect migration**

Run:

```bash
bunx drizzle-kit generate --config=drizzle.config.ts --name=offline_attendance_import
```

Expected: `0008_offline_attendance_import.sql`, `0008_snapshot.json`, and journal entry. Inspect SQL for all checks, foreign keys, and partial unique indexes. Do not hand-edit snapshot JSON.

- [ ] **Step 7: Run schema test and build**

Run:

```bash
bunx vitest run src/db/schemas/offline-attendance-schema.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schemas/offline-attendance-schema.ts src/db/schemas/offline-attendance-schema.test.ts src/db/schemas/hr-schema.ts src/db/index.ts src/db/migrations
git commit -m "feat: add offline attendance import schema"
```

---

### Task 3: RBAC and System-Role Seed Synchronization

**Files:**
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/authz.server.ts`
- Modify: `src/lib/middlewares.ts`
- Modify: `src/lib/rbac.test.ts`
- Create: `src/lib/authz-seeding.test.ts`

**Interfaces:**
- Produces permissions:
  - `attendance.offline.view`
  - `attendance.offline.workbooks.manage`
  - `attendance.offline.upload`
  - `attendance.offline.outage.confirm`
  - `attendance.offline.import.review`
  - `attendance.offline.audit.view`

- [ ] **Step 1: Write failing route and permission tests**

```ts
expect(canAccessPath(
  "/hr/attendance/offline",
  ["attendance.offline.view"],
)).toBe(true);
expect(canAccessPath("/hr/attendance/offline", ["hr.view"])).toBe(false);
expect(canAccessPath("/hr/attendance", ["hr.view"])).toBe(true);
```

Source test must assert system seeding computes and inserts missing permission IDs instead of skipping any system role that already has one permission.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bunx vitest run src/lib/rbac.test.ts src/lib/authz-seeding.test.ts
```

Expected: FAIL on missing permission keys and route rule.

- [ ] **Step 3: Add permission definitions and ordering**

Add all six keys to `PERMISSION_KEYS` and `PERMISSION_DEFINITIONS`. Add the specific offline route matcher before generic HR:

```ts
{
  matcher: /^\/hr\/attendance\/offline(?:\/.*)?$/,
  permissions: ["attendance.offline.view"],
},
```

Add all six permissions to the `admin` system seed. Super admin continues using `*`. Custom supervisor/operator/HR roles receive explicit grants through current role management.

- [ ] **Step 4: Synchronize missing system-role grants safely**

Replace the existing “skip when role has any permission” behavior. Query existing permission IDs, calculate only missing seed grants, and insert those with `onConflictDoNothing()`. Never delete existing grants in this startup sync.

- [ ] **Step 5: Export dedicated middleware**

```ts
export const requireOfflineAttendanceViewMiddleware =
  createPermissionMiddleware("attendance.offline.view");
export const requireOfflineWorkbookManageMiddleware =
  createPermissionMiddleware("attendance.offline.workbooks.manage");
export const requireOfflineAttendanceUploadMiddleware =
  createPermissionMiddleware("attendance.offline.upload");
export const requireOfflineOutageConfirmMiddleware =
  createPermissionMiddleware("attendance.offline.outage.confirm");
export const requireOfflineImportReviewMiddleware =
  createPermissionMiddleware("attendance.offline.import.review");
export const requireOfflineAttendanceAuditMiddleware =
  createPermissionMiddleware("attendance.offline.audit.view");
```

- [ ] **Step 6: Run tests**

Run:

```bash
bunx vitest run src/lib/rbac.test.ts src/lib/authz-seeding.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rbac.ts src/lib/authz.server.ts src/lib/middlewares.ts src/lib/rbac.test.ts src/lib/authz-seeding.test.ts
git commit -m "feat: add offline attendance permissions"
```

---

### Task 4: Signed Permanent Workbook Generation and Management

**Files:**
- Create: `src/lib/attendance/offline/contracts.ts`
- Create: `src/lib/attendance/offline/workbook-template.server.ts`
- Create: `src/server-functions/hr/attendance/offline-workbooks-fn.ts`
- Test: `src/lib/attendance/offline/workbook-template.test.ts`
- Test: `src/server-functions/hr/attendance/offline-workbooks-fn.test.ts`

**Interfaces:**
- Produces:
  - `buildOfflineAttendanceWorkbook(input: WorkbookTemplateInput): Promise<Uint8Array>`
  - `listOfflineAttendanceWorkbooksFn`
  - `issueOfflineAttendanceWorkbookFn`
  - `downloadOfflineAttendanceWorkbookFn`
  - `replaceOfflineAttendanceWorkbookFn`
  - `retireOfflineAttendanceWorkbookFn`

- [ ] **Step 1: Define shared contracts**

```ts
export const offlineDirectionSchema = z.enum(["IN", "OUT"]);

export type WorkbookTemplateInput = {
  workbookId: string;
  operatorUserId: string;
  operatorName: string;
  templateVersion: number;
  rowCapacity: number;
};

export type OfflineWorkbookSummary = {
  id: string;
  operatorUserId: string;
  operatorName: string;
  templateVersion: number;
  rowCapacity: number;
  highestSeenRow: number;
  remainingRows: number;
  status: "active" | "retired" | "replaced";
  issuedAt: string;
};
```

Add all batch, row, preview, actor, and count types used by later tasks here; keep them serializable and free of DB model types.

- [ ] **Step 2: Write failing workbook tests**

Assert:

- workbook opens using ExcelJS;
- sheets are exactly `Instructions`, `Attendance`, and very-hidden `System`;
- headers are exact;
- 20,000 rows have valid tokens;
- input cells are unlocked and system cells locked/hidden;
- direction validation is `IN,OUT`;
- date/time display formats are exact;
- sheet protection disables insert/delete/sort;
- workbook passes `inspectXlsxPackage`;
- workbook contains no formulas, links, macros, or employee list.

- [ ] **Step 3: Run test and verify failure**

Run:

```bash
bunx vitest run src/lib/attendance/offline/workbook-template.test.ts
```

Expected: FAIL because generator does not exist.

- [ ] **Step 4: Build workbook template**

Attendance columns:

```ts
[
  { header: "Employee Code", key: "employeeCode", width: 20 },
  { header: "Date (YYYY-MM-DD)", key: "date", width: 20 },
  { header: "Time (HH:mm)", key: "time", width: 16 },
  { header: "Direction", key: "direction", width: 14 },
  { header: "Note", key: "note", width: 45 },
  { header: "_Source Row", key: "sourceRow", hidden: true },
  { header: "_Record Token", key: "recordToken", hidden: true },
] as const
```

System sheet values:

```ts
{
  format: "titan-offline-attendance",
  workbookId,
  operatorUserId,
  templateVersion,
  rowCapacity,
  issuedAt,
  manifestSignature,
}
```

Use literal values only. Protect the sheet with a password derived from the workbook signature for accident prevention; never treat Excel protection as authentication.

- [ ] **Step 5: Write management function tests**

Source and pure-helper tests cover:

- active workbook uniqueness per operator;
- issue records authenticated issuer;
- replacement refuses unresolved batches;
- retirement refuses unresolved batches;
- retired workbook can be downloaded for audit but cannot accept new rows;
- response headers use the assigned operator and workbook ID, sanitized for filename.

- [ ] **Step 6: Implement management server functions**

Every server function calls `requireOfflineAttendanceEnabled()` and uses `requireOfflineWorkbookManageMiddleware`. Download returns:

```ts
return new Response(bytes, {
  headers: {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":
      'attachment; filename="' + safeFilename + '"',
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});
```

Replacement creates new workbook first, links old `replacedByWorkbookId`, and marks old `replaced` in one transaction.

- [ ] **Step 7: Run tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/workbook-template.test.ts src/server-functions/hr/attendance/offline-workbooks-fn.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/attendance/offline/contracts.ts src/lib/attendance/offline/workbook-template.server.ts src/lib/attendance/offline/workbook-template.test.ts src/server-functions/hr/attendance/offline-workbooks-fn.ts src/server-functions/hr/attendance/offline-workbooks-fn.test.ts
git commit -m "feat: issue signed offline attendance workbooks"
```

---

### Task 5: Literal Workbook Parser and Immutable Upload Batch

**Files:**
- Create: `src/lib/attendance/offline/workbook-parser.server.ts`
- Create: `src/server-functions/hr/attendance/offline-upload-fn.ts`
- Test: `src/lib/attendance/offline/workbook-parser.test.ts`
- Test: `src/server-functions/hr/attendance/offline-upload-fn.test.ts`

**Interfaces:**
- Produces:
  - `parseOfflineAttendanceWorkbook(bytes: Uint8Array): Promise<ParsedOfflineWorkbook>`
  - `uploadOfflineAttendanceWorkbookFn({ data: FormData }): Promise<UploadBatchResult>`

```ts
export type ParsedOfflineRow = {
  worksheetRowNumber: number;
  recordToken: string;
  rawEmployeeCode: string;
  rawDate: string;
  rawTime: string;
  rawDirection: string;
  rawNote: string | null;
  normalizedTimestamp: string | null;
  contentHash: string;
  parseIssues: Array<{ code: string; message: string }>;
};

export type ParsedOfflineWorkbook = {
  manifest: WorkbookManifest;
  fileSha256: string;
  rows: ParsedOfflineRow[];
};
```

- [ ] **Step 1: Write failing parser tests**

Cover:

- exact generated workbook;
- blank prepared rows ignored;
- partially filled rows retained as invalid attempts;
- formula with cached value rejected;
- hyperlink rejected;
- changed sheet/header/order rejected;
- invalid manifest signature rejected;
- token moved to another physical row rejected;
- wrong operator/token rejected;
- Excel Date and numeric time normalized;
- `YYYY-MM-DD` and `HH:mm` literal strings normalized;
- invalid time, seconds, AM/PM, future date syntax, note over 500, and bad direction captured as row issues;
- 20,001 used rows rejected.

- [ ] **Step 2: Run parser test and verify failure**

Run:

```bash
bunx vitest run src/lib/attendance/offline/workbook-parser.test.ts
```

Expected: FAIL because parser does not exist.

- [ ] **Step 3: Implement parser in this order**

```ts
await inspectXlsxPackage(bytes);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(bytes));
verifyExactSheets(workbook);
const manifest = readAndVerifyManifest(workbook);
verifyAttendanceHeaders(workbook);
const rows = readLiteralRows(workbook, manifest);
return { manifest, fileSha256: sha256(bytes), rows };
```

Never call `writeFile`, `readFile`, `fs`, or a temporary-file helper. Reject any input cell whose ExcelJS value exposes `formula`, `sharedFormula`, `hyperlink`, or rich/external value objects.

- [ ] **Step 4: Run parser tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/workbook-parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing upload tests**

Validate FormData contract:

```ts
const form = new FormData();
form.set("file", workbookFile);
form.set("outageStartsAt", "2026-08-03T08:00:00+05:00");
form.set("outageEndsAt", "2026-08-03T12:00:00+05:00");
form.set("reason", "Factory internet outage");
```

Cover `.xlsx` extension/MIME/size, workbook owner or permitted intake uploader, active assignment, outage `start < end`, no future end, immutable row attempts, rejected unsafe batch metadata only, and no workbook bytes in insert values or logs.

- [ ] **Step 6: Implement POST FormData upload**

Use `createServerFn({ method: "POST" })` and preserve FormData through validation:

```ts
.inputValidator((data) => {
  if (!(data instanceof FormData)) throw new Error("Expected FormData");
  return data;
})
```

In handler:

1. enforce feature and upload permission;
2. validate `File`, declared window, and reason with Zod;
3. read `await file.arrayBuffer()` once and reject above 10 MB;
4. parse in memory;
5. store pending outage window, awaiting-supervisor batch, and immutable row attempts in one transaction;
6. on unsafe structure, store only hash, size, filename, uploader, status `rejected`, and safe error code;
7. return batch ID and counts.

Never log raw workbook bytes, row note text, or signatures.

- [ ] **Step 7: Run upload tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/workbook-parser.test.ts src/server-functions/hr/attendance/offline-upload-fn.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/attendance/offline/workbook-parser.server.ts src/lib/attendance/offline/workbook-parser.test.ts src/server-functions/hr/attendance/offline-upload-fn.ts src/server-functions/hr/attendance/offline-upload-fn.test.ts
git commit -m "feat: stage offline attendance workbook uploads"
```

---

### Task 6: Pure Timeline Merge and Classification Engine

**Files:**
- Create: `src/lib/attendance/offline/timeline.ts`
- Test: `src/lib/attendance/offline/timeline.test.ts`
- Test: `src/lib/attendance/offline/timeline.property.test.ts`

**Interfaces:**
- Produces:
  - `resolveOfflineAttendanceDate(input: ExplicitPunchInput, previous: TimelinePunch | null): ResolvedOfflinePunch`
  - `classifyOfflineTimeline(input: TimelineClassificationInput): TimelineClassification`
  - `groupOfflineRows(rows: ClassifiedOfflineRow[]): OfflineEmployeeDayGroup[]`

```ts
export type TimelineSource = "qr_terminal" | "manual" | "offline_excel";

export type TimelinePunch = {
  id: string;
  employeeId: string;
  timestamp: string;
  attendanceDate: string;
  direction: "in" | "out";
  source: TimelineSource;
  candidateRowId?: string;
};

export type ResolvedOfflinePunch =
  | { ok: true; attendanceDate: string; isNightShift: boolean }
  | { ok: false; reasonCode: string; message: string };

export type TimelineClassification =
  | { status: "ready"; attendanceDate: string; isNightShift: boolean }
  | { status: "duplicate"; reasonCode: "already_imported" }
  | { status: "needs_review"; reasonCode: string; message: string }
  | { status: "invalid"; reasonCode: string; message: string }
  | { status: "blocked"; reasonCode: string; message: string };
```

- [ ] **Step 1: Write example-based failing tests**

Cover:

- online `08:00 IN` plus offline `17:00 OUT`;
- complete offline `IN/OUT` pair;
- mixed rows supplied out of order;
- `IN → IN` and `OUT → OUT`;
- exact/near duplicate below 30 seconds;
- existing imported identity exact and changed;
- online punch arriving after upload;
- approved/paid payroll block;
- draft payroll warning;
- inactive/unknown employee invalid;
- leave/holiday/absent review;
- rest-day ready with warning;
- overnight `IN 22:00 → OUT 06:00` attributed to prior attendance date;
- after-noon checkout not back-attributed;
- first event `OUT` review;
- neighbor events one day before/after included.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bunx vitest run src/lib/attendance/offline/timeline.test.ts
```

Expected: FAIL because timeline exports do not exist.

- [ ] **Step 3: Implement explicit direction resolver**

Rules:

```ts
if (incoming.direction === "in") {
  return { ok: true, attendanceDate: pktCalendarDate, isNightShift: false };
}

if (!previous || previous.direction !== "in") {
  return { ok: false, reasonCode: "missing_open_in", message: "OUT has no open IN" };
}

if (previous.attendanceDate === pktCalendarDate) {
  return { ok: true, attendanceDate: pktCalendarDate, isNightShift: false };
}

if (
  isPreviousCalendarDate(previous.attendanceDate, pktCalendarDate) &&
  pktHour < OFFLINE_OVERNIGHT_OUT_BEFORE_HOUR
) {
  return {
    ok: true,
    attendanceDate: previous.attendanceDate,
    isNightShift: true,
  };
}

return { ok: false, reasonCode: "unmatched_checkout", message: "OUT cannot be matched safely" };
```

Then sort by timestamp and stable ID, merge existing and candidates, enforce alternating directions, detect the 30-second window, and classify without mutating inputs.

- [ ] **Step 4: Add property tests**

Using fast-check:

```ts
fc.assert(fc.property(validAlternatingTimelineArb, (timeline) => {
  const reversed = [...timeline].reverse();
  expect(classifyOfflineTimeline({
    existing: [],
    candidates: reversed,
    policy: openPolicy,
  })).toEqual(classifyOfflineTimeline({
    existing: [],
    candidates: timeline,
    policy: openPolicy,
  }));
}));
```

Also prove accepted output alternates and never moves timestamps outside the confirmed window.

- [ ] **Step 5: Run timeline tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/timeline.test.ts src/lib/attendance/offline/timeline.property.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance/offline/timeline.ts src/lib/attendance/offline/timeline.test.ts src/lib/attendance/offline/timeline.property.test.ts
git commit -m "feat: classify merged offline attendance timelines"
```

---

### Task 7: Supervisor Confirmation and Live Preview

**Files:**
- Create: `src/lib/attendance/offline/preview.server.ts`
- Create: `src/server-functions/hr/attendance/offline-review-fn.ts`
- Test: `src/lib/attendance/offline/preview.test.ts`
- Test: `src/server-functions/hr/attendance/offline-review-fn.test.ts`

**Interfaces:**
- Produces:
  - `confirmOfflineOutageWindowFn`
  - `rejectOfflineOutageWindowFn`
  - `getOfflineImportQueuesFn`
  - `getOfflineImportBatchFn`
  - `refreshOfflineImportPreviewFn`
  - `excludeOfflineImportRowsFn`
  - `buildAndPersistOfflinePreview(batchId: string): Promise<OfflineImportPreview>`

- [ ] **Step 1: Write failing actor-separation tests**

```ts
expect(() => assertDistinctWorkflowActors({
  operatorUserId: "user-1",
  supervisorUserId: "user-1",
  reviewerUserId: null,
})).toThrow("Operator cannot confirm their own outage");

expect(() => assertDistinctWorkflowActors({
  operatorUserId: "user-1",
  supervisorUserId: "user-2",
  reviewerUserId: "user-2",
})).toThrow("Final reviewer must be different from supervisor");
```

Also cover state transitions, supervisor rejection, actor permissions, confirmed range, and immutable audit timestamps.

- [ ] **Step 2: Run review tests and verify failure**

Run:

```bash
bunx vitest run src/lib/attendance/offline/preview.test.ts src/server-functions/hr/attendance/offline-review-fn.test.ts
```

Expected: FAIL because preview and review functions do not exist.

- [ ] **Step 3: Implement supervisor actions**

Confirmation accepts:

```ts
z.object({
  batchId: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(5).max(500),
})
```

Normalize to `Asia/Karachi`, enforce `start < end <= now`, require distinct operator/supervisor, and update outage plus batch in one transaction. Rejection requires a 5–500 character reason and sets batch `cancelled`.

- [ ] **Step 4: Implement live preview loader**

For parsed rows, bulk-load:

- current employees by code;
- imported claims by workbook/token;
- punches from one day before earliest timestamp through one day after latest;
- attendance summaries/statuses;
- payroll periods;
- relevant terminal heartbeat evidence.

Call pure timeline classifier. Persist normalized fields, status, reason code, and reason message. Recalculate all batch counts in the same transaction. Do not store predicted Excel values.

Apply validation in approved order: exact imported identity first, then literal values and current employee, then confirmed outage window/future/payroll policy, then the combined timeline. This lets old imported rows outside the current outage window remain harmless duplicates.

Return preview grouped by employee and resolved attendance date, with existing and proposed events marked by source.

- [ ] **Step 5: Implement row exclusion and queues**

Exclusion requires review permission and a reason. Only `needs_review`, `invalid`, or `blocked` rows may become `excluded`; imported rows are immutable. Queue queries return only data needed by the current permission and never return signatures or row tokens to normal UI.

- [ ] **Step 6: Run tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/preview.test.ts src/server-functions/hr/attendance/offline-review-fn.test.ts src/lib/attendance/offline/timeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/offline/preview.server.ts src/lib/attendance/offline/preview.test.ts src/server-functions/hr/attendance/offline-review-fn.ts src/server-functions/hr/attendance/offline-review-fn.test.ts
git commit -m "feat: review offline attendance import previews"
```

---

### Task 8: Resumable Confirmation, Durable Claims, and Payroll Protection

**Files:**
- Create: `src/lib/attendance/offline/confirmation.server.ts`
- Create: `src/lib/attendance/offline/payroll-invalidation.server.ts`
- Create: `src/server-functions/hr/attendance/offline-confirm-fn.ts`
- Modify: `src/server-functions/hr/payroll/payroll-fn.ts`
- Create: `vitest.integration.config.ts`
- Create: `docker-compose.test.yml`
- Modify: `package.json`
- Test: `src/lib/attendance/offline/confirmation.test.ts`
- Test: `src/server-functions/hr/payroll/offline-attendance-invalidation.test.ts`
- Test: `src/__tests__/integration/offline-attendance-import.integration.test.ts`
- Test: `src/__tests__/integration/offline-attendance-workflow.integration.test.ts`

**Interfaces:**
- Produces:
  - `confirmOfflineAttendanceImportFn({ data: { batchId } }): ConfirmBatchResult`
  - `processOfflineImportSlice(input: { batchId; reviewerUserId }): Promise<ConfirmBatchResult>`
  - `invalidateDraftPayrollsForAttendance(tx, input): Promise<void>`
  - `assertPayrollAttendanceCurrent(tx, payrollId): Promise<void>`
  - `resolvePayrollAttendanceInvalidations(tx, payrollId, actorId): Promise<void>`

```ts
export type ConfirmBatchResult = {
  batchId: string;
  status: "importing" | "completed" | "completed_with_issues";
  processedGroups: number;
  importedRows: number;
  hasMore: boolean;
  counts: OfflineImportCounts;
};
```

- [ ] **Step 1: Add guarded integration harness**

`vitest.integration.config.ts` must use Node environment, include only `src/__tests__/integration/**/*.test.ts`, and stop unless database name ends with `_test`.

```ts
const value = process.env.TEST_DATABASE_URL;
if (!value || !new URL(value).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must target a database ending in _test");
}
process.env.DATABASE_URL = value;
```

`docker-compose.test.yml` uses PostgreSQL 18, database `titan_offline_test`, and host port 5434.

Add scripts:

```json
{
  "test:integration:attendance": "vitest run --config vitest.integration.config.ts",
  "db:migrate:test": "drizzle-kit migrate --config=drizzle.config.ts"
}
```

- [ ] **Step 2: Write failing integration tests first**

Seed three distinct users and one active employee. Cover:

1. exact row imports once;
2. same batch confirmed concurrently imports once;
3. same identity from two batches imports once;
4. online scan collision while confirmation waits on employee lock becomes review or valid merged timeline;
5. one invalid group does not roll back another valid group;
6. server slice resumes after lease expiry;
7. imported row claim survives punch deletion;
8. approved/paid payroll blocks;
9. draft payroll creates unresolved invalidation;
10. payroll approval fails while invalidation exists;
11. payslip regeneration resolves invalidation;
12. no batch ends with unknown row status.

In `offline-attendance-workflow.integration.test.ts`, exercise the full service workflow: issue workbook, fill literal cells in memory, upload, confirm the outage as a second user, preview and approve as a third user, then verify punches and recalculated attendance. Repeat for exact re-upload, corrected unimported row, changed imported row, overnight shift, mixed row outcomes, interrupted confirmation/resume, and assert that no schema column contains workbook bytes or a storage path. Browser component tests in Tasks 11–12 cover the same user controls and network-error messages.

- [ ] **Step 3: Start isolated DB, migrate, and verify failure**

Run:

```bash
docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bun run db:migrate:test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bun run test:integration:attendance
```

Expected: tests fail because confirmation service does not exist.

- [ ] **Step 4: Implement renewable batch lease**

Acquire with one conditional update where lease is null, expired, or already owned. Lease lasts two minutes. The service processes at most 25 groups, renews before each group, and releases in `finally`. If another worker holds lease, return current status without processing.

- [ ] **Step 5: Implement group transaction**

For each next ready employee/date group:

```ts
await db.transaction(async (tx) => {
  await lockEmployeePunchWrites(tx, employeeId);
  const live = await reloadTimelineAndPolicies(tx, group);
  const decision = classifyOfflineTimeline(live);

  if (decision.status !== "ready") {
    await persistReclassification(tx, group, decision);
    return;
  }

  await claimImportedRows(tx, group.rows);

  for (const row of group.rows) {
    const [punch] = await tx.insert(attendancePunches).values({
      employeeId: row.employeeId,
      timestamp: new Date(row.normalizedTimestamp),
      attendanceDate: row.attendanceDate,
      direction: row.rawDirection.toLowerCase() as "in" | "out",
      source: "offline_excel",
      terminalUserId: workbook.assignedOperatorUserId,
      note: row.rawNote,
      offlineImportRowId: row.id,
      offlineImportIdentity: row.workbookId + ":" + row.recordToken,
    }).returning();

    await markRowImported(tx, row.id, punch.id);
  }

  await recomputeAttendanceRow(tx, employeeId, attendanceDate, {
    forceNightShift: group.isNightShift,
    appendNote: group.isRestDay ? "Scanned on rest day" : undefined,
  });

  await invalidateDraftPayrollsForAttendance(tx, {
    batchId: group.batchId,
    employeeId,
    attendanceDate,
  });
});
```

`claimImportedRows` updates rows to `imported`; the partial unique index is the durable claim. Catch PostgreSQL `23505`, reload the imported claim, and classify the current attempt as duplicate or changed-record review.

- [ ] **Step 6: Add reviewer and state rules**

Final reviewer must differ from operator and supervisor. First confirm sets `reviewedByUserId` and `reviewedAt`; resumes retain that identity. Only `preview_ready` or `importing` batches run. Completed calls return existing counts without writes.

- [ ] **Step 7: Add payroll guards**

Before group insert, query covering payroll. `approved` or `paid` yields blocked rows. `draft` creates `payrollAttendanceInvalidations`.

At start of `approvePayrollFn` transaction:

```ts
await assertPayrollAttendanceCurrent(tx, data.payrollId);
```

After successful complete `generatePayslipsFn` generation:

```ts
await db.transaction((tx) =>
  resolvePayrollAttendanceInvalidations(
    tx,
    payroll.id,
    context.session.user.id,
  ),
);
```

Do not resolve invalidations when generation partially fails.

- [ ] **Step 8: Run unit and integration tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline/confirmation.test.ts src/server-functions/hr/payroll/offline-attendance-invalidation.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bun run test:integration:attendance
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock vitest.integration.config.ts docker-compose.test.yml src/lib/attendance/offline/confirmation.server.ts src/lib/attendance/offline/confirmation.test.ts src/lib/attendance/offline/payroll-invalidation.server.ts src/server-functions/hr/attendance/offline-confirm-fn.ts src/server-functions/hr/payroll/payroll-fn.ts src/server-functions/hr/payroll/offline-attendance-invalidation.test.ts src/__tests__/integration/offline-attendance-import.integration.test.ts src/__tests__/integration/offline-attendance-workflow.integration.test.ts
git commit -m "feat: confirm offline attendance imports safely"
```

---

### Task 9: Reasoned Correction and Deletion Audit

**Files:**
- Modify: `src/server-functions/hr/attendance/manual-punches-fn.ts`
- Modify: `src/server-functions/hr/attendance/manual-punches-fn.test.ts`
- Modify: `src/hooks/hr/use-attendance-punches.ts`
- Modify: `src/components/hr/attendance/manual-punch-timeline.tsx`
- Modify: `src/components/hr/attendance/manual-punch-timeline.behavior.test.tsx`

**Interfaces:**
- Changes:
  - `deletePunchFn({ punchId, reason? })`
  - `correctPunchFn({ punchId, newTimestamp, attendanceDate?, note?, reason? })`

- [ ] **Step 1: Write failing server tests**

Assert:

- normal QR/manual correction keeps optional reason;
- `offline_excel` correction/delete requires trimmed 5–500 character reason;
- audit stores immutable old values before delete;
- correction audit stores replacement punch values;
- audit keeps original import row link;
- imported-row durable identity remains claimed after delete;
- correction and audit commit in same transaction.

- [ ] **Step 2: Run server test and verify failure**

Run:

```bash
bunx vitest run src/server-functions/hr/attendance/manual-punches-fn.test.ts
```

Expected: FAIL on missing reason/audit behavior.

- [ ] **Step 3: Implement audit helper inside transaction**

Use:

```ts
const correctionReasonSchema = z.string().trim().min(5).max(500);

function requireOfflineCorrectionReason(
  punch: typeof attendancePunches.$inferSelect,
  reason: string | undefined,
) {
  if (punch.source !== "offline_excel") return reason?.trim() || null;
  return correctionReasonSchema.parse(reason);
}
```

Insert correction audit before delete, and after replacement punch creation for correction. Store JSON snapshots containing timestamp, attendance date, direction, source, note, terminal user, and offline links.

- [ ] **Step 4: Write failing UI behavior tests**

Render an offline punch and assert:

- badge says `Offline Excel`;
- edit/delete opens reason input;
- action disabled below 5 trimmed characters;
- mutation includes reason;
- normal punch correction remains unchanged.

- [ ] **Step 5: Implement UI reason flow**

Extend `PunchRow.source` with `offline_excel`. Add controlled correction reason only for offline punches. Require confirmation dialog for deletion instead of immediate destructive mutation.

- [ ] **Step 6: Run tests**

Run:

```bash
bunx vitest run src/server-functions/hr/attendance/manual-punches-fn.test.ts src/components/hr/attendance/manual-punch-timeline.behavior.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/hr/attendance/manual-punches-fn.ts src/server-functions/hr/attendance/manual-punches-fn.test.ts src/hooks/hr/use-attendance-punches.ts src/components/hr/attendance/manual-punch-timeline.tsx src/components/hr/attendance/manual-punch-timeline.behavior.test.tsx
git commit -m "feat: audit offline attendance corrections"
```

---

### Task 10: Terminal Heartbeat and Honest Offline Guidance

**Files:**
- Create: `src/server-functions/hr/attendance/terminal-heartbeat-fn.ts`
- Create: `src/hooks/attendance/use-terminal-heartbeat.ts`
- Modify: `src/components/attendance/scan-terminal.tsx`
- Modify: `src/components/attendance/scan-terminal.test.ts`
- Test: `src/server-functions/hr/attendance/terminal-heartbeat-fn.test.ts`

**Interfaces:**
- Produces `recordTerminalHeartbeatFn(): { enabled: boolean; observedAt: string | null }`
- Produces `useTerminalHeartbeat(isOnline: boolean): void`

- [ ] **Step 1: Write failing heartbeat tests**

Cover terminal permission, minute-bucket idempotency, observed server time, hourly pruning older than 90 days, and failure isolation.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bunx vitest run src/server-functions/hr/attendance/terminal-heartbeat-fn.test.ts src/components/attendance/scan-terminal.test.ts
```

Expected: FAIL on missing heartbeat behavior.

- [ ] **Step 3: Implement POST heartbeat**

When feature flag is disabled, return `{ enabled: false, observedAt: null }` without writing. When enabled, insert one row per terminal/minute with `onConflictDoNothing`. At minute zero, delete heartbeats older than 90 days. Return server timestamp. Never trust client clock.

- [ ] **Step 4: Add client heartbeat**

Call immediately after successful terminal status, then every 60 seconds while status query succeeds. Heartbeat failure must not crash scanner or retry aggressively.

- [ ] **Step 5: Correct connectivity UI**

Replace hard-coded footer copy with:

```tsx
<span>{isOnline ? "System Online" : "System Offline"}</span>
<span>
  {isOnline
    ? "All systems operational"
    : "Record attendance in assigned Excel workbook"}
</span>
```

On scan network error, show “Internet unavailable. Record this IN/OUT event in the assigned attendance workbook.” Do not queue scans in browser.

Set `isOnline` from `statusQuery.isSuccess`, not merely the absence of an error, so initial loading never claims connectivity.

- [ ] **Step 6: Run tests**

Run:

```bash
bunx vitest run src/server-functions/hr/attendance/terminal-heartbeat-fn.test.ts src/components/attendance/scan-terminal.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/hr/attendance/terminal-heartbeat-fn.ts src/server-functions/hr/attendance/terminal-heartbeat-fn.test.ts src/hooks/attendance/use-terminal-heartbeat.ts src/components/attendance/scan-terminal.tsx src/components/attendance/scan-terminal.test.ts
git commit -m "feat: record attendance terminal heartbeat"
```

---

### Task 11: Viewer-Scoped Hooks, Route, Workbook, and Upload UI

**Files:**
- Create: `src/hooks/hr/use-offline-attendance.ts`
- Create: `src/components/hr/attendance/offline/offline-attendance-page.tsx`
- Create: `src/components/hr/attendance/offline/workbook-panel.tsx`
- Create: `src/components/hr/attendance/offline/upload-panel.tsx`
- Create: `src/routes/_protected/hr/attendance/offline.tsx`
- Modify: `src/lib/constants.ts`
- Test: `src/hooks/hr/use-offline-attendance.test.tsx`
- Test: `src/components/hr/attendance/offline/workbook-panel.test.tsx`
- Test: `src/components/hr/attendance/offline/upload-panel.test.tsx`

**Interfaces:**
- Produces `offlineAttendanceKeys` with viewer user ID in every key.
- Produces upload result navigation to batch details.
- Produces workbook download from binary `Response`.

- [ ] **Step 1: Write failing hook tests**

```ts
expect(offlineAttendanceKeys.workbooks("viewer-1")).toEqual([
  "offline-attendance",
  "viewer-1",
  "workbooks",
]);
```

Assert mutations invalidate only the current viewer’s keys plus daily attendance after successful import.

- [ ] **Step 2: Implement hooks**

Expose queries for workbooks, queues, batch, and history; mutations for issue, replace, retire, upload, supervisor decision, refresh preview, exclude, and confirm.

Binary download:

```ts
const response = await downloadOfflineAttendanceWorkbookFn({
  data: { workbookId },
});
const blob = await response.blob();
const url = URL.createObjectURL(blob);
const anchor = document.createElement("a");
anchor.href = url;
anchor.download = filenameFromDisposition(response.headers);
anchor.click();
URL.revokeObjectURL(url);
```

- [ ] **Step 3: Write failing workbook/upload component tests**

Cover permission hiding, issue/download lifecycle, replacement warning, low-row warning, file accept `.xlsx`, 10 MB client check, required outage range/reason, no automatic upload, progress, and server error copy.

- [ ] **Step 4: Implement route and shell**

Route loader reads `context.viewerAccess.user.id` and permissions. Prefetch only allowed queries with viewer-scoped keys. Page renders role-specific panels and disabled-feature notice.

Add HR navigation sibling:

```ts
{
  title: "Offline Attendance",
  url: "/hr/attendance/offline",
  icon: AttendanceIcon,
}
```

- [ ] **Step 5: Implement workbook panel**

Show operator, workbook ID suffix, version, issued date, remaining rows, active/replaced/retired state, and exact download/replacement consequences. Destructive retirement requires typed reason and confirmation.

- [ ] **Step 6: Implement upload panel**

Use one FormData instance with file and ISO offset timestamps. Display local Asia/Karachi values before submit. On success show batch ID, pending supervisor state, and row count. Never read workbook in browser beyond client size/name validation.

- [ ] **Step 7: Run tests and build route tree**

Run:

```bash
bunx vitest run src/hooks/hr/use-offline-attendance.test.tsx src/components/hr/attendance/offline/workbook-panel.test.tsx src/components/hr/attendance/offline/upload-panel.test.tsx
bun run build
```

Expected: tests and build pass; generated route tree includes offline route without manual edits.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/hr/use-offline-attendance.ts src/hooks/hr/use-offline-attendance.test.tsx src/components/hr/attendance/offline src/routes/_protected/hr/attendance/offline.tsx src/lib/constants.ts src/routeTree.gen.ts
git commit -m "feat: add offline attendance workbook upload UI"
```

---

### Task 12: Supervisor, HR Review, Import Progress, and Audit UI

**Files:**
- Create: `src/components/hr/attendance/offline/supervisor-panel.tsx`
- Create: `src/components/hr/attendance/offline/review-panel.tsx`
- Create: `src/components/hr/attendance/offline/import-history.tsx`
- Modify: `src/components/hr/attendance/offline/offline-attendance-page.tsx`
- Test: `src/components/hr/attendance/offline/supervisor-panel.test.tsx`
- Test: `src/components/hr/attendance/offline/review-panel.test.tsx`
- Test: `src/components/hr/attendance/offline/import-history.test.tsx`

**Interfaces:**
- Consumes `OfflineImportPreview`, queue hooks, and confirm slice mutation.
- Produces complete three-role workflow and recoverable progress screen.

- [ ] **Step 1: Write failing supervisor tests**

Cover pending queue, operator identity, declared window, heartbeat evidence labeled “supporting evidence”, edited confirmed window, distinct-user error, confirm, and reject reason.

- [ ] **Step 2: Implement supervisor panel**

Display last heartbeat before and first heartbeat after window when present. Never label heartbeat as proof. Confirmation posts exact displayed start/end/reason.

- [ ] **Step 3: Write failing review tests**

Cover:

- counts for ready/duplicate/review/invalid/blocked/imported/excluded;
- grouped timeline with source badges;
- employee server-resolved name;
- existing versus proposed events;
- predicted server summary;
- leave/holiday/absence/rest-day/night-shift/payroll warnings;
- no force-import control for review rows;
- exclude with reason;
- final reviewer separation;
- confirm/resume progress;
- connection failure leaves Resume action;
- completed call does not re-import.

- [ ] **Step 4: Implement review panel**

Timeline renders chronological cards:

```tsx
{group.timeline.map((event) => (
  <li key={event.id}>
    <span>{event.time}</span>
    <span>{event.direction.toUpperCase()}</span>
    <Badge>{sourceLabel(event.source)}</Badge>
  </li>
))}
```

Confirm repeatedly calls bounded server confirmation while `hasMore` is true. Stop on first network error, invalidate batch query, and show Resume. Never assume an interrupted request failed.

- [ ] **Step 5: Write and implement history tests**

History shows batch/workbook suffix, uploader, operator, supervisor, reviewer, file hash prefix, outage range, timestamps, counts, row reasons, imported punch link, exclusions, corrections, and no workbook-download action.

- [ ] **Step 6: Run UI tests**

Run:

```bash
bunx vitest run src/components/hr/attendance/offline/supervisor-panel.test.tsx src/components/hr/attendance/offline/review-panel.test.tsx src/components/hr/attendance/offline/import-history.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/hr/attendance/offline
git commit -m "feat: review and reconcile offline attendance"
```

---

### Task 13: Required Integration CI, Runbook, and Release Verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/operations/offline-attendance-runbook.md`
- Modify: `graphify-out/GRAPH_REPORT.md` and generated graph files through `graphify update .`

**Interfaces:**
- Produces required concurrency gate and operator-facing rollout procedure.

- [ ] **Step 1: Add required PostgreSQL integration job**

Add non-optional job with PostgreSQL 18 service:

```yaml
offline-attendance-integration:
  name: Offline Attendance PostgreSQL
  runs-on: ubuntu-latest
  timeout-minutes: 20
  services:
    postgres:
      image: postgres:18.0-alpine3.22
      env:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: titan_offline_test
      ports:
        - 5432:5432
      options: >-
        --health-cmd "pg_isready -U postgres"
        --health-interval 3s
        --health-timeout 2s
        --health-retries 10
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/titan_offline_test
    TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/titan_offline_test
    OFFLINE_ATTENDANCE_IMPORT_ENABLED: "true"
    OFFLINE_ATTENDANCE_SIGNING_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}'
    OFFLINE_ATTENDANCE_ACTIVE_SIGNING_VERSION: "1"
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: 1.3.12
    - run: bun install --frozen-lockfile
    - run: bun run db:migrate:test
    - run: bun run test:integration:attendance
```

No `continue-on-error`.

- [ ] **Step 2: Write operations runbook**

Include exact procedures:

1. issue and save workbook;
2. daily operator readiness check;
3. outage entry rules;
4. reconnect upload order;
5. supervisor evidence/window confirmation;
6. HR preview meanings;
7. conflict correction;
8. interrupted import resume;
9. workbook replacement;
10. signing-key generation with `openssl rand -base64 32`;
11. signing-key rotation by adding a new keyring version, switching active issuance, replacing every active workbook, finishing all old pending batches, then removing the retired key version;
12. feature-flag pilot enable/disable;
13. database backup and rollback;
14. proof that workbook files are not stored;
15. emergency support contacts as role names, not personal names.

- [ ] **Step 3: Run all focused tests**

Run:

```bash
bunx vitest run src/lib/attendance/offline src/server-functions/hr/attendance src/components/hr/attendance/offline src/components/attendance/scan-terminal.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run integration tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bun run test:integration:attendance
```

Expected: PASS.

- [ ] **Step 5: Run full regression and production build**

Run:

```bash
bun run test
bun run build
```

Expected: all tests pass and production build succeeds.

Run:

```bash
bun run typecheck
```

Current repository has pre-existing typecheck failures. Record the output and require zero diagnostics in any file added or modified by this plan. Do not hide or broaden types to suppress errors.

Keep production feature flag disabled while full typecheck remains red. Handle repository-wide typecheck cleanup as separate work, rerun this gate, and enable production only after `bun run typecheck` passes.

- [ ] **Step 6: Verify no workbook persistence path exists**

Run:

```bash
rg -n "writeFile|writeFileSync|createWriteStream|tmpdir|object.storage|bytea" src/lib/attendance/offline src/server-functions/hr/attendance/offline-*
```

Expected: no disk/object/blob persistence calls. ExcelJS `workbook.xlsx.writeBuffer()` is allowed only in template generation.

- [ ] **Step 7: Update graph and verify clean diff**

Run:

```bash
graphify update .
git status --short
git diff --check
```

Expected: graph current, no whitespace errors, only planned files changed.

- [ ] **Step 8: Pilot verification**

With feature flag enabled in staging:

1. issue one operator workbook;
2. enter online `08:00 IN`, offline `12:00 OUT`, offline `13:00 IN`, online `17:00 OUT`;
3. confirm outage with a different supervisor;
4. review with a third HR account;
5. verify preview timeline and final attendance;
6. upload same workbook twice;
7. interrupt confirmation and resume;
8. test night shift across midnight;
9. verify approved payroll blocks;
10. query application storage and database schema to confirm no Excel bytes exist.

Expected: no duplicates, no silent conflict, clear batch status, and existing scanner remains operational.

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/ci.yml docs/operations/offline-attendance-runbook.md graphify-out
git commit -m "ci: verify offline attendance reconciliation"
```

## Execution Notes

- Keep feature disabled in production until staging pilot passes.
- Stop immediately on migration mismatch, high/critical new dependency vulnerability, uncertain row outcome, or any test that produces duplicate punches.
- Do not combine unrelated audit fixes with feature commits.
- Review every task’s staged diff before commit.
- Keep uploaded workbooks out of logs, fixtures containing real employee data, screenshots, and error telemetry.
