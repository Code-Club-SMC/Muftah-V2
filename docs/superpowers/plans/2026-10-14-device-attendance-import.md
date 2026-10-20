# Device attendance import implementation plan

> **For agentic workers:** Use subagent-driven-development for independent task implementation and task review. The user authorized continuous execution; no additional design approval is required.

**Goal:** Replace barcode capture with HR uploads while preserving the attendance ledger, manual editor and payroll behavior.

**Architecture:** Parse the native device report into typed daily snapshots, preview live conflicts and append only unclaimed safe events under employee locks. Persist source snapshots and durable raw-event claims, route corrections through the existing editor, and protect payroll freshness.

**Tech Stack:** Bun, strict TypeScript, TanStack Start/Query, existing zip.js/saxes, Drizzle/PostgreSQL, existing shadcn UI.

**Spec:** `docs/superpowers/specs/2026-10-14-device-attendance-import-design.md`

## Global constraints

- Work in current feature checkout; preserve all existing unrelated dirty files. Do not commit unrelated user changes or create deployment side effects.
- No new runtime dependencies. Files are limited to 10 MiB and 20,000 report rows.
- Only generator writes SQL/snapshots/journal; create a forward migration without applying it to application databases. Validate it only in a disposable local test database.
- Accept CSV and XLSX by content, including XLSX renamed .csv. Use PKT and integer minutes.
- Preserve HR corrections and historical punches; no automatic absence; support current-day and multi-day uploads.
- Shared contracts live in `src/lib/attendance/device-import/contracts.ts`.

## Task 1: Native report parser

Files: create `device-import/contracts.ts`, `parser.server.ts`, `parser.test.ts` under `src/lib/attendance`.

Produces `parseDevicePunchReport(bytes: Uint8Array): Promise<DevicePunchReport>`.
`DevicePunchReport = { format: "csv" | "xlsx"; rows: DevicePunchReportRow[] }`.
`DevicePunchReportRow = { rowNumber: number; personId: string; personName: string; department: string; date: string | null; punches: string[]; reportedCount: number | null; issues: string[] }`.

- [x] Define shared parser contracts and the preview interfaces recorded below.
- [x] Write and execute parser tests before implementing, including the supplied workbook and an actual CSV string containing a quoted punch list.
- [x] Implement bounded content detection, CSV quoting and native XLSX cell decoding using existing zip.js/saxes and shared XLSX guard.
- [x] Validate strict dates, times, duplicate days, count mismatches, numeric spreadsheet time fractions and formula rejection. Malformed row data becomes row issues; structurally invalid files throw useful errors.
- [x] Verify fixture using `expect(result.rows).toHaveLength(52)` and `expect(result.rows.reduce((n,r)=>n+r.punches.length,0)).toBe(138)`; add CSV and invalid edge assertions.
- [x] Independent spec/quality review; fix material findings before completing task.

## Task 2: Durable import and ledger integration

Files: create `src/db/schemas/device-attendance-schema.ts`, `device-import/timeline.ts`, `device-import/service.server.ts`, `device-import/payroll.server.ts`, server function `src/server-functions/hr/attendance/device-import-fn.ts`, and meaningful behavior tests. Modify schema registration, punch source union, existing manual punch corrections, recomputation, payroll invalidation and narrow payroll guards.

Consumes parser interfaces above. Produces `uploadDeviceAttendanceFn` with FormData containing `file`; `previewDeviceAttendanceFn` and `confirmDeviceAttendanceFn` taking `{ importId: string; mappings?: Record<string,string> }`; `listDeviceAttendanceImportsFn` for recent uploads.

Shared UI contract:
```ts
type DeviceImportRowStatus = "ready" | "unchanged" | "needs_review" | "blocked" | "imported";
type DeviceImportRowPreview = {
  rowNumber: number; personId: string; personName: string;
  employeeId: string | null; employeeName: string | null;
  date: string | null; punchTimes: string[];
  status: DeviceImportRowStatus; messages: string[];
  newPunchCount: number; dutyHours: string | null;
};
type DeviceImportPreview = {
  importId: string; filename: string; format: "csv" | "xlsx";
  status: "preview" | "completed"; rows: DeviceImportRowPreview[];
  employees: { id: string; employeeCode: string; name: string }[];
};
```

- [x] Add typed snapshot, person-mapping and durable raw-punch-claim tables. Preserve claims with nullable punch references after HR deletion. Broaden payroll invalidations to accept a device upload origin.
- [x] Write deterministic planner tests for duplicate/no-op, paired breaks, current open IN, overnight across dates/uploads, corrected/deleted claims and manual conflicts.
- [x] Implement live preview/confirmation with HR-manage middleware, server-side file limits, source rows saved, persisted mapping checks, deterministic lock ordering, no existing ledger mutations, bounded inserts and live sequence checks.
- [x] Reuse recompute for affected dates; correct the repeated compensatory refund only where the new import/manual path reaches it. Preserve manual status decisions.
- [x] Mark device imports in existing punch timeline, require correction reasons and preserve durable claims through corrections/deletions.
- [x] Serialize approval/import using a shared payroll lock; invalidate drafts; block unresolved imported punch days. Capture generation-start invalidations and resolve only that captured set.
- [x] Generate forward migration through `bun run db:generate`; inspect generated output without manual edits.
- [x] Execute behavior and authorization tests, then independent task review and fixes.

## Task 3: HR upload UI and scanner retirement

Files: create `src/components/hr/attendance/device-import-sheet.tsx`, hook `src/hooks/hr/use-device-attendance.ts`; modify attendance container, manual timeline source labels, scanner route and scan server mutation.

Consumes the four server functions and shared UI types from Task 2. The upload sheet accepts `.csv,.xlsx`, displays report dates/rows/new punches/review count, editable employee mappings for unknown people, confirm action and per-row links/actions into the existing attendance editor. Add recent import access so exceptions remain reviewable after closing the sheet.

- [x] Build UI with existing components, HR manage permission, disabled pending actions and accessible labels; reuse existing editor for correction.
- [x] Add behavior tests for upload, preview, confirmation, mapping, exceptions and errors. Await related Query invalidations on successful writes.
- [x] Redirect scanner route only for HR viewers; show access denied otherwise. Disable scanner mutation before any database write, while retaining historical data and identifiers.
- [x] Review actual form/route wiring, run feature tests and independent spec/quality review.

## Task 4: Verification and completion

- [x] Run all affected attendance/payroll/permission tests, typecheck and production build; distinguish pre-existing baseline errors from introduced errors.
- [x] Obtain final independent review of all feature changes. Address material findings and rerun affected checks.
- [x] Run `graphify update .` after code edits, update this plan and execution ledger, and report migration/deployment requirements accurately. Do not apply database migrations or publish.

## Execution rulings

The current checkout is already a feature branch with extensive user changes. Implementation stays here rather than moving or copying those changes. Reviews use scoped working-tree diffs rather than commits, so no user changes are accidentally committed. The exact bytes of the client fixture, not its filename, determine the parser. Existing business policy is the authority; unresolved or unsafe import interpretation goes to HR rather than prompting the user for implementation choices.

## Completed verification

All tasks are implemented and independently reviewed. See `2026-10-14-device-attendance-import-verification.md` for test evidence, decisions and release requirements. Application migration/deployment remains a release action.
