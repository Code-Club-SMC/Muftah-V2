# QR Attendance System — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-20-qr-attendance-design.md`
**Date:** 2026-06-20

Build order is bottom-up: pure logic first (fully testable with no DB), then schema, then RBAC, then server functions, then UI. Each phase ends with a verification gate. Phases 1–3 have zero UI risk and can be merged independently. Phase 4 is the backend core. Phases 5–7 are the UI layers.

---

## Phase 1 — Pure Logic Layer (no DB, no UI)

**Goal:** the recompute engine, back-attribution, and payload parser as pure functions. Fully unit-testable with no database.

**Why first:** everything else depends on these. They're the highest-risk logic (duty hours, late detection, night-shift attribution) and the easiest to test in isolation.

### 1.1 Create `src/lib/attendance/payload.ts`

```ts
export type ParsedPayload =
  | { ok: true; employeeId: string; employeeCode: string }
  | { ok: false; reason: "invalid_payload" };

export function parseQrPayload(raw: string): ParsedPayload
```

- `JSON.parse` → validate `type === "TITAN_EMPLOYEE"`, `v === 1`, `id` + `code` are non-empty strings.
- Catch `SyntaxError` → `invalid_payload`.

### 1.2 Create `src/lib/attendance/recompute.ts`

```ts
export type Punch = {
  direction: "in" | "out";
  timestamp: string;  // ISO string or "HH:mm:ss" — see note
};

export type RecomputeOptions = {
  shiftStartTime: string | null;        // "HH:mm:ss" | null
  graceMinutes: number;                 // 15
  nightShiftStartHour: number;          // 20
};

export type RecomputeResult = {
  checkIn: string | null;               // "HH:mm:ss"
  checkOut: string | null;              // "HH:mm:ss"
  dutyHours: string;                    // "8.00"
  isLate: boolean | null;               // null = preserved (no shiftStartTime)
  isNightShift: boolean;
  openInCount: number;
};

export function computeAttendanceFromPunches(
  punches: Punch[],
  opts: RecomputeOptions,
): RecomputeResult
```

- Sort punches by timestamp.
- `checkIn` = first `"in"` time (formatted HH:mm:ss).
- `checkOut` = last `"out"` time, or `null` if day ends on open `"in"`.
- `dutyHours` = Σ(`out − in`) for each completed in→out pair. Open trailing `"in"` = 0. Use the existing `calculateHours` pattern from `upsert-attendance-fn.ts:9` (handle overnight via +24h).
- `isLate` = first `"in"` > `shiftStartTime` + `graceMinutes`. If `shiftStartTime` is null → `null` (preserved).
- `isNightShift` = any `"in"` punch time >= `nightShiftStartHour` (20:00).
- `openInCount` = count of `"in"` punches that have no matching `"out"` (for HR visibility).

**Time representation note:** punches arrive as full `timestamptz` from the DB, but recompute works with HH:mm:ss within a single `attendanceDate`. The server function will convert `timestamptz` → PKT HH:mm:ss before calling this pure function. PKT = UTC+5, no DST — a fixed `+5h` offset is correct (no `date-fns-tz` dependency needed; implement a `toPKTTime(isoTimestamp: string): string` helper in this file or a shared `src/lib/attendance/time.ts`).

### 1.3 Create `src/lib/attendance/back-attribute.ts`

```ts
export type LastPunch = {
  direction: "in" | "out";
  attendanceDate: string;  // "YYYY-MM-DD"
  timestamp: string;       // ISO string
};

export type BackAttributeOptions = {
  overnightOutBeforeHour: number;  // 12
};

export type ResolveResult = {
  attendanceDate: string;          // "YYYY-MM-DD"
  direction: "in" | "out";
  isOvernightCheckout: boolean;
};

export function resolveAttendanceDate(
  incomingTimestamp: Date,
  lastPunch: LastPunch | null,
  opts: BackAttributeOptions,
): ResolveResult
```

- If `lastPunch` is null → first punch ever → `attendanceDate = today PKT`, `direction = "in"`.
- If `lastPunch.direction === "out"` → new `"in"` on `today PKT`.
- If `lastPunch.direction === "in"` (open "in" from a prior day):
  - If incoming time is before `overnightOutBeforeHour` (12:00) PKT → back-attribute: `attendanceDate = lastPunch.attendanceDate`, `direction = "out"`, `isOvernightCheckout = true`.
  - Else (after noon) → orphan; `attendanceDate = today PKT`, `direction = "in"`, `isOvernightCheckout = false`.

### 1.4 Create `src/lib/attendance/time.ts` (PKT helper)

```ts
// PKT = UTC+5, no DST. Fixed offset is correct.
export function toPKTDate(isoTimestamp: string | Date): string  // "YYYY-MM-DD"
export function toPKTTime(isoTimestamp: string | Date): string  // "HH:mm:ss"
export function nowPKTDate(): string
```

- `toPKTDate`: take UTC timestamp, add 5 hours, format as `YYYY-MM-DD`.
- `toPKTTime`: take UTC timestamp, add 5 hours, format as `HH:mm:ss`.
- `nowPKTDate`: `new Date()` → `toPKTDate`.
- Use `date-fns` (`format`, `addHours`) which is already installed.

### 1.5 Tests — `src/lib/attendance/payload.test.ts`

- valid JSON, correct shape → `ok: true`
- wrong `type` → `ok: false`
- wrong `v` → `ok: false`
- missing `id`/`code` → `ok: false`
- not JSON → `ok: false`

### 1.6 Tests — `src/lib/attendance/recompute.test.ts`

- single `in→out` (8h)
- `in→out→in→out` (Σ intervals)
- open `in` (no `out`) → `checkOut=null`, open interval = 0
- `in` at 21:00, `out` next-day 06:00 → `dutyHours=9`, `isNightShift=true`
- `in` exactly at `shiftStartTime+grace` → not late; 1 min after → late
- no `shiftStartTime` → `isLate=null`
- empty punches → all nulls / 0
- `in` at 08:00, `out` at 08:00 (zero-duration) → 0h, not an error

### 1.7 Tests — `src/lib/attendance/back-attribute.test.ts`

- first punch ever → `attendanceDate = today PKT`, `in`
- prior punch `out` today → `attendanceDate = today`, `in`
- prior punch `in` yesterday, incoming 09:00 today → back-attributed to yesterday as `out`, `isOvernightCheckout=true`
- prior punch `in` yesterday, incoming 13:00 today (after noon) → not back-attributed; new day `in`
- prior punch `in` 2 days ago, incoming 09:00 → orphan; new day `in`

### 1.8 Property tests — in `recompute.test.ts` (fast-check)

- For any punch sequence, recomputing twice yields identical results (idempotence).
- For any sequence, `|count("in") − count("out")| ≤ 1` (alternation invariant).
- `dutyHours ≥ 0` and equals Σ completed intervals.

### Verification gate (Phase 1)

```bash
bun run test src/lib/attendance/
bun run typecheck   # no new errors in attendance/* files
```

---

## Phase 2 — Schema + Migration

**Goal:** new tables, new columns, drop `checkIn2`/`checkOut2`, generate migration.

**Depends on:** Phase 1 (recompute defines what fields the `attendance` row needs).

### 2.1 Edit `src/db/schemas/hr-schema.ts`

- **Add `shiftStartTime` / `shiftEndTime`** to `employees` (nullable `time`, no default):
  ```ts
  shiftStartTime: time("shift_start_time"),
  shiftEndTime: time("shift_end_time"),
  ```
- **Remove `checkIn2` / `checkOut2`** from `attendance` (lines 168–169).
- **Add `attendancePunches` table** (per spec §4.1):
  ```ts
  export const attendancePunches = pgTable("attendance_punches", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    attendanceDate: date("attendance_date").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    source: text("source").notNull().default("qr_terminal"),
    terminalUserId: text("terminal_user_id").references(() => user.id),
    ...timestamps,
  }, (t) => ({
    empDateIdx: index("attendance_punches_emp_date_idx").on(t.employeeId, t.attendanceDate),
    dateIdx: index("attendance_punches_date_idx").on(t.attendanceDate),
    tsIdx: index("attendance_punches_ts_idx").on(t.timestamp),
  }));
  ```
- **Add `attendanceScanAttempts` table** (per spec §4.2):
  ```ts
  export const attendanceScanAttempts = pgTable("attendance_scan_attempts", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").references(() => employees.id),
    payload: text("payload").notNull(),
    reason: text("reason").notNull(),
    message: text("message").notNull(),
    terminalUserId: text("terminal_user_id").references(() => user.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    ...timestamps,
  }, (t) => ({
    dateIdx: index("attendance_scan_attempts_date_idx").on(t.timestamp),
    empIdx: index("attendance_scan_attempts_emp_idx").on(t.employeeId),
  }));
  ```
- **Add relations** for both new tables (employee → many punches; terminalUser → many punches).

### 2.2 Edit `src/db/index.ts`

- Add to the `hrSchema` destructure:
  ```ts
  export const { employees, attendance, attendancePunches, attendanceScanAttempts, payrolls, payslips, ... } = hrSchema;
  ```

### 2.3 Generate migration

```bash
bun run db:generate
```

This generates `src/db/migrations/XXXX_add_qr_attendance.sql` with:
- `CREATE TABLE attendance_punches ...` + 3 indexes
- `CREATE TABLE attendance_scan_attempts ...` + 2 indexes
- `ALTER TABLE employees ADD COLUMN shift_start_time time / shift_end_time time`
- `ALTER TABLE attendance DROP COLUMN check_in_2 / check_out_2`

### 2.4 Apply migration locally

```bash
docker compose up -d          # ensure Postgres on 5433
bun run db:migrate
```

### Verification gate (Phase 2)

```bash
bun run db:studio   # verify tables + columns in Drizzle Studio
bun run typecheck   # schema types are correct
```

---

## Phase 3 — RBAC Registration

**Goal:** register the `attendance_terminal.scan` permission + `attendance_terminal` role in the codebase. Auto-seeded to DB by `ensureRbacSeeded()` on app start — no manual SQL needed.

**Depends on:** nothing (can run parallel to Phase 2).

### 3.1 Edit `src/lib/rbac.ts`

- **`MODULE_KEYS`**: add `"attendance"` to the array (line ~13).
- **`PERMISSION_KEYS`**: add `"attendance_terminal.scan"` to the array (line ~30).
- **`PERMISSION_DEFINITIONS`**: add the definition object:
  ```ts
  {
    key: "attendance_terminal.scan",
    moduleKey: "attendance",
    label: "Scan attendance terminal",
    description: "Use the QR attendance terminal at a fixed scanner station.",
    kind: "route",
    routePattern: "/attendance/scan",
  },
  ```
- **`SYSTEM_ROLE_SLUGS`**: add `"attendance_terminal"` to the array (line ~3).
- **`SYSTEM_ROLE_SEEDS`**: add the role seed:
  ```ts
  {
    slug: "attendance_terminal",
    name: "Attendance Terminal",
    description: "Dedicated kiosk account for QR attendance scanning. Can only punch attendance, nothing else.",
    isSystem: true,
    isArchived: false,
    priority: 10,
    defaultLandingPath: "/attendance/scan",
    permissionKeys: ["attendance_terminal.scan"],
  },
  ```

### 3.2 Edit `src/lib/middlewares.ts`

- Add the terminal middleware at the end of the permission middleware section:
  ```ts
  export const requireAttendanceTerminalMiddleware = createPermissionMiddleware(
    "attendance_terminal.scan",
  );
  ```

### 3.3 Exclude `/attendance/scan` from sidebar navigation

- The sidebar uses `getAccessibleNavigationItems()` which filters `navigations` from `src/lib/constants.ts` by permission. Since `/attendance/scan` is not in the `navigations` array, it won't appear in the sidebar automatically. **No change needed** — just verify it's not listed.

### Verification gate (Phase 3)

```bash
bun run typecheck
bun run test src/lib/rbac.test.ts   # existing RBAC tests still pass
# Start the dev server briefly to trigger ensureRbacSeeded(), then check DB:
bun run db:studio   # verify attendance_terminal.scan permission + attendance_terminal role exist
```

---

## Phase 4 — Server Functions (Backend Core)

**Goal:** the scan handler, manual punch operations, and terminal status function.

**Depends on:** Phase 1 (pure logic), Phase 2 (schema), Phase 3 (middleware).

### 4.1 Create `src/server-functions/hr/attendance/scan-attendance-fn.ts`

The main scan handler. Gated by `requireAttendanceTerminalMiddleware`.

```ts
export const scanAttendanceFn = createServerFn()
  .middleware([requireAttendanceTerminalMiddleware])
  .inputValidator(z.object({ rawPayload: z.string() }))
  .handler(async ({ data, context }) => {
    // 1. Parse payload (Phase 1 pure fn)
    // 2. Reject rules 1-6 (per spec §6)
    // 3. Direction alternation + back-attribution (Phase 1 pure fn)
    // 4. Double-scan check (rule 7: last punch < 30s ago)
    // 5. Single transaction:
    //    a. INSERT attendance_punches
    //    b. Recompute + UPSERT attendance row (per spec §7.3)
    // 6. Return {status, direction, employeeName, ...}
    // Rejections: INSERT attendance_scan_attempts + return rejection
  });
```

**Key implementation details:**
- `terminalUserId` = `context.session.user.id` (from the middleware context).
- `timestamp` = `new Date()` (server time, never client-supplied).
- `attendanceDate` = `nowPKTDate()` (Phase 1 helper), or back-attributed date from `resolveAttendanceDate`.
- Fetch last punch for the employee (across all dates) for: (a) direction alternation, (b) back-attribution, (c) double-scan check.
- Fetch existing `attendance` row for `(employee, attendanceDate)` for rejection rules 5–6 and the recompute upsert.
- Rest-day check: `new Date().getDay()` (PKT) in `employee.restDays` array → accept (rule 4), append "Scanned on rest day" to `notes`.
- All writes in `db.transaction()`.
- Return type:
  ```ts
  | { status: "accepted"; direction: "in" | "out"; employeeName: string; employeeCode: string; punchTime: string; isLate: boolean | null; dutyHours: string; isNightShift: boolean }
  | { status: "rejected"; reason: string; message: string; employeeName?: string }
  | { status: "duplicate"; message: string; employeeName: string }
  ```

### 4.2 Create `src/server-functions/hr/attendance/get-terminal-status-fn.ts`

Gated by `requireAttendanceTerminalMiddleware`. Returns footer data:

```ts
export const getTerminalStatusFn = createServerFn()
  .middleware([requireAttendanceTerminalMiddleware])
  .handler(async () => {
    const today = nowPKTDate();
    const punchCount = await db.select({ count: count() })
      .from(attendancePunches)
      .where(eq(attendancePunches.attendanceDate, today));
    return { punchCount: punchCount[0].count, date: today };
  });
```

### 4.3 Create `src/server-functions/hr/attendance/add-manual-punch-fn.ts`

Gated by `requireHrManageMiddleware`. Used by HR for lost-card / missed-scan corrections.

```ts
export const addManualPunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    employeeId: z.string(),
    timestamp: z.string(),  // ISO — HR picks a date+time
    direction: z.enum(["in", "out"]).optional(), // auto-suggested if omitted
  }))
  .handler(async ({ data, context }) => {
    // 1. Derive attendanceDate from timestamp (toPKTDate)
    // 2. If direction omitted: auto-suggest from alternation
    // 3. Transaction: INSERT punch + recompute attendance row
    // 4. Return the recomputed attendance row
  });
```

### 4.4 Create `src/server-functions/hr/attendance/delete-punch-fn.ts`

Gated by `requireHrManageMiddleware`. Deletes a punch by id + recomputes.

```ts
export const deletePunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ punchId: z.string() }))
  .handler(async ({ data }) => {
    // 1. Fetch punch to get employeeId + attendanceDate
    // 2. Transaction: DELETE punch + recompute attendance row from remaining punches
    // 3. Return recomputed row
  });
```

### 4.5 Create `src/server-functions/hr/attendance/correct-punch-fn.ts`

Gated by `requireHrManageMiddleware`. Atomic delete + insert + recompute.

```ts
export const correctPunchFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    punchId: z.string(),
    newTimestamp: z.string(),  // ISO
  }))
  .handler(async ({ data, context }) => {
    // 1. Fetch old punch
    // 2. Transaction: DELETE old + INSERT new (same direction, new timestamp, source="manual") + recompute
    // 3. Return recomputed row
  });
```

### 4.6 Create a shared recompute helper for server functions

`src/lib/attendance/recompute-server.ts` — wraps the pure `computeAttendanceFromPunches` with DB queries:

```ts
export async function recomputeAttendanceRow(
  tx: Tx,
  employeeId: string,
  attendanceDate: string,
): Promise<void> {
  // 1. Fetch all punches for (employee, date) ordered by timestamp
  // 2. Convert timestamps to PKT HH:mm:ss
  // 3. Fetch employee.shiftStartTime
  // 4. Call computeAttendanceFromPunches (pure fn)
  // 5. UPSERT attendance row with computed fields, preserving manual fields
}
```

This is called by `scanAttendanceFn`, `addManualPunchFn`, `deletePunchFn`, `correctPunchFn` — DRY.

### 4.7 Source-inspection test — `src/server-functions/hr/attendance/scan-attendance-fn.test.ts`

Per AGENTS.md convention (server fns can't be mocked, so inspect source):
- `scanAttendanceFn` source uses `db.transaction(...)`
- inserts into `attendance_punches` (never updates)
- inserts rejected scans into `attendance_scan_attempts`
- is gated by `requireAttendanceTerminalMiddleware`
- never trusts client-supplied timestamp/date (uses `new Date()` / `nowPKTDate()`)

### 4.8 Cleanup `checkIn2`/`checkOut2` references in server functions

- `src/server-functions/hr/attendance/upsert-attendance-fn.ts` — remove `dutyHours2` calc (line 53), remove `checkIn2`/`checkOut2` from `updateData` (lines 80–81).
- `src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts` — remove `checkIn2`/`checkOut2` from template (lines 37–38, 197–198, 205–206) + zod schema (lines 87–88).

### Verification gate (Phase 4)

```bash
bun run typecheck
bun run test src/server-functions/hr/attendance/
```

---

## Phase 5 — Terminal Route + Kiosk UI

**Goal:** the `/attendance/scan` route with full-screen kiosk UI, hidden input for the keyboard wedge, and feedback states.

**Depends on:** Phase 4 (scanAttendanceFn, getTerminalStatusFn).

### 5.1 Create `src/routes/attendance/scan.tsx`

A **layout-less** route (sibling to `_protected`, not nested under it) so no sidebar/header renders.

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";
import { hasPermission } from "@/lib/rbac";

export const Route = createFileRoute("/attendance/scan")({
  beforeLoad: async ({ location }) => {
    const viewerAccess = await getViewerAccessFn();
    if (!viewerAccess) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    if (!hasPermission(viewerAccess.permissions, "attendance_terminal.scan")) {
      throw redirect({ to: viewerAccess.defaultLandingPath });
    }
    return { viewerAccess };
  },
  component: ScanTerminalPage,
});
```

- Note: `routeTree.gen.ts` will auto-regenerate — do NOT edit it manually.

### 5.2 Create `src/components/attendance/scan-terminal.tsx`

The kiosk UI component. Key parts:

1. **Hidden input** (sr-only) kept permanently focused. On submit → call `scanAttendanceFn(rawPayload)` → set result state → clear input → refocus.
2. **Full-screen state-swap** based on result:
   - Idle (dark, "Scan your card" + PKT clock)
   - Success IN (green, name, "CHECKED IN HH:mm", late badge)
   - Success OUT (green, name, "CHECKED OUT HH:mm", duty hours)
   - Rejected (red, message)
   - Duplicate (amber, "Duplicate scan — wait a moment")
   - Connection error (gray, "Scanner offline")
3. **Auto-return to idle** 10s after any result (timer resets on new scan).
4. **WebAudio beeps** — success (880Hz), error (220Hz ×2), duplicate (440Hz). `AudioContext` created on first user gesture (focus click).
5. **Wake-lock** — `navigator.wakeLock.request("screen")` on mount, released on unmount. Graceful fallback.
6. **Footer** — terminal account name, connection dot, today's punch count (polled via `getTerminalStatusFn` every 30s), PKT clock.
7. **Focus management** — `document.addEventListener("click", refocus)` + `window.addEventListener("focus", refocus)` + visible "tap to refocus" hint if focus is lost.

### 5.3 Component test — `src/routes/attendance/scan.test.tsx`

- Renders `/attendance/scan`; hidden input is focused on mount.
- Submitting a payload calls the scan fn; input is cleared + refocused.
- Result state swaps full-screen content; auto-returns to idle after timer.
- Wake-lock request is attempted but failures don't crash.

### 5.4 Hook for terminal status polling

`src/hooks/attendance/use-terminal-status.ts` — thin TanStack Query wrapper:
```ts
export function useTerminalStatus() {
  return useQuery({
    queryKey: ["terminal-status"],
    queryFn: () => getTerminalStatusFn(),
    refetchInterval: 30_000,
  });
}
```

### Verification gate (Phase 5)

```bash
bun run typecheck
bun run test src/routes/attendance/scan.test.tsx
bun run dev   # manually verify: navigate to /attendance/scan (needs terminal account), type a payload, see feedback states
```

---

## Phase 6 — Manual Attendance UI Refactor

**Goal:** evolve the existing HR attendance editor to the two-mode design (punch timeline vs. status edit). Remove all `checkIn2`/`checkOut2` UI.

**Depends on:** Phase 4 (manual punch server functions).

### 6.1 Evolve `src/components/hr/attendance/edit-attendance-form.tsx`

**Mode 1 — Present (punch-driven timeline editor):**
- Replace the `checkIn`/`checkOut`/`checkIn2`/`checkOut2`/`dutyHours` input fields with a **punch timeline list**:
  - Fetch punches for the selected date (new server fn or extend existing query).
  - Each punch = card: direction badge (IN/OUT) + time + source badge (QR / Manual / Manual by `<user>`) + delete button.
  - "Add punch" button → time picker + auto-suggested direction → calls `addManualPunchFn`.
  - Delete button → calls `deletePunchFn`.
- **Live recomputed summary** panel: `checkIn`, `checkOut`, `dutyHours`, `isLate`, `isNightShift` — computed client-side via the pure `computeAttendanceFromPunches` for instant feedback; server confirms on save.
- Remove `form.Field name="checkIn2"` and `form.Field name="checkOut2"` (lines 508, 521).
- Remove `checkIn2`/`checkOut2` from the type (lines 71–72) + initial values (lines 278–279) + the calculateHours deps (lines 153–154).

**Mode 2 — Absent / Leave / Holiday (direct row edit):**
- Keep status selector + leave type + leave approval + notes (same as today).
- No punch timeline (these statuses have no punches).
- If status switches present → absent/leave/holiday: existing punches are not deleted; row's `status` changes; recompute is not triggered.

### 6.2 Evolve `src/components/hr/attendance/edit-attendance-sheet.tsx`

- Remove `checkIn2`/`checkOut2` from the type (lines 13–14).
- Apply the same two-mode design as the form.

### 6.3 Update `src/components/hr/attendance/bulk-attendance-sheet.tsx`

- Remove `checkIn2`/`checkOut2` state (lines 124–125), inputs (lines 360, 365), and payload fields (lines 161–162).
- **Bulk "present"**: instead of writing `checkIn`/`checkOut` directly, call `addManualPunchFn` to create default punches (`in` at `shiftStartTime`, `out` at `shiftEndTime`, source=`"manual"`) for employees who have no punches that day. Employees with existing punches are skipped.

### 6.4 Update `src/components/hr/attendance/attendance-list-table.tsx`

- Remove `checkIn2`/`checkOut2` from the row type (lines 20–21).
- Split-shift display: instead of showing `checkIn2`/`checkOut2` columns, show a single "Punches" column with a count/badge (e.g. "4 punches" or "IN 08:00 → OUT 12:00 → IN 13:00 → OUT 17:00") fetched from the punch table.

### 6.5 Update `src/components/hr/attendance/employee-attendance-log.tsx`

- Remove `hasShift2` logic (line 100) + the shift-2 cell (lines 221–228).
- Split-shift display: show the punch timeline for each day instead of `checkIn2`/`checkOut2`.

### 6.6 Add a punch-fetch server function (if not already in Phase 4)

`src/server-functions/hr/attendance/get-employee-punches-fn.ts` — gated by `requireHrViewMiddleware` (or `requireHrManageMiddleware`):

```ts
export const getEmployeePunchesFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ employeeId: z.string(), date: z.string() }))
  .handler(async ({ data }) => {
    return db.query.attendancePunches.findMany({
      where: (t, { and, eq }) => and(eq(t.employeeId, data.employeeId), eq(t.attendanceDate, data.date)),
      orderBy: (t, { asc }) => [asc(t.timestamp)],
    });
  });
```

### 6.7 Update `src/lib/validators/hr-validators.ts`

- Remove `checkIn2`/`checkOut2` from `upsertAttendanceSchema` (lines 98–99).
- Add `entrySource` enum values: `["biometric", "manual", "qr_terminal"]`.

### 6.8 Update `src/hooks/hr/use-bulk-mark-attendance.ts`

- Remove `checkIn2`/`checkOut2` from the hook type (lines 16–17).

### 6.9 Update `src/db/seed-hr.ts`

- Remove `checkIn2`/`checkOut2` seed values (lines 441–442).
- For split-shift demo rows: seed punches instead (insert into `attendancePunches`).

### Verification gate (Phase 6)

```bash
bun run typecheck
bun run test   # all tests pass
bun run dev    # manually verify: HR attendance page → open an employee → punch timeline works → add/delete punches → bulk present creates punches
```

---

## Phase 7 — Employee Forms (Shift Times)

**Goal:** add `shiftStartTime` / `shiftEndTime` inputs to the add/edit employee forms.

**Depends on:** Phase 2 (schema columns exist).

### 7.1 Update `src/components/hr/employees/add-employee-form.tsx`

- Add `shiftStartTime` + `shiftEndTime` time picker fields (in the "Job Details" section, near `joiningDate` / `designation`).
- Nullable (optional) — no employee is forced to have a shift.
- Include in the form submit payload.

### 7.2 Update `src/components/hr/employees/edit-employee-form.tsx`

- Same fields, pre-populated from the employee record.

### 7.3 Update the employee create/update server functions

- Add `shiftStartTime` / `shiftEndTime` to the zod input validators for employee create/update.
- Add to the DB write fields.
- These are in `src/server-functions/hr/employees/` (find the exact files).

### Verification gate (Phase 7)

```bash
bun run typecheck
bun run dev   # manually verify: add/edit employee → set shift times → save → verify in DB
```

---

## Cross-Cutting — Cleanup & Final Verification

### After all phases:

1. **Grep for leftover `checkIn2`/`checkOut2`/`check_in_2`/`check_out_2` references:**
   ```bash
   rg "checkIn2|checkOut2|check_in_2|check_out_2" src/ --type ts --type tsx
   ```
   Expect zero matches in source (migration snapshots are fine — they're historical).

2. **Full typecheck:**
   ```bash
   bun run typecheck
   ```

3. **Full test suite:**
   ```bash
   bun run test
   ```

4. **Build:**
   ```bash
   bun run build
   ```

5. **Update graphify:**
   ```bash
   graphify update .
   ```

---

## Dependency Graph

```
Phase 1 (pure logic) ──────────┐
                                ├──► Phase 4 (server fns) ──► Phase 5 (terminal UI)
Phase 2 (schema + migration) ──┤                         ╱
                                ├──► Phase 6 (manual UI) ╱
Phase 3 (RBAC) ─────────────────┘
                                
Phase 2 ──► Phase 7 (employee forms)
```

- Phases 1, 2, 3 can run in parallel (no inter-dependencies).
- Phase 4 depends on 1 + 2 + 3.
- Phase 5 depends on 4.
- Phase 6 depends on 4.
- Phase 7 depends on 2 only.
- Phases 5, 6, 7 can run in parallel after their dependencies are met.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| PKT timezone bugs | PKT = UTC+5 fixed (no DST). Manual +5h offset is correct. Unit-tested in Phase 1. |
| Recompute overwrites HR manual fields | Recompute preserves overtime/leave/notes (spec §7.3). Tested in Phase 1. |
| Static QR replay | Accepted limitation. Mitigated by terminal auth + 30s double-scan + audit table. Documented in spec §9. |
| Terminal session expiry | Open item (spec §12.2). Flagged for operational config. Not a code blocker. |
| Migration drops `checkIn2`/`checkOut2` while code still references them | Phase 2 (schema) + Phase 6 (UI cleanup) + Phase 4 (server fn cleanup) must merge together. Do not deploy schema migration without the code cleanup. |
| `routeTree.gen.ts` conflicts | Do not edit manually. It regenerates on `bun run dev` / `bun run build`. |
