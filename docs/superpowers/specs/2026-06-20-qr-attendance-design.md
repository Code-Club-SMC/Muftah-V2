# QR Attendance System — Design Spec

**Date:** 2026-06-20
**Status:** Approved (Sections 1–7)
**Context:** Greenfield — nothing deployed yet, so the design is ideal, not constrained by migrating live data.

---

## 1. Overview

Employees scan a physical ID card (with a printed static QR code) at a fixed **2D desktop barcode scanner** (HID keyboard wedge) connected to a dedicated terminal PC. The terminal runs a kiosk-style web page in this app that shows full-screen success/error feedback. The first scan of a day records check-in (and marks the employee present); subsequent scans alternate out/in with no limit on the number of punches. HR can also record or correct punches manually (e.g. lost card, missed scan), and both QR and manual paths write to the same immutable punch log so the daily attendance row is always a faithful, non-conflicting projection.

**Scope in:**
- New `attendance_punches` + `attendance_scan_attempts` tables.
- Per-employee `shiftStartTime` / `shiftEndTime` columns.
- Dedicated `attendance_terminal` RBAC role + `attendance_terminal.scan` permission + middleware.
- One server function: `scanAttendanceFn` (the terminal scan handler).
- Manual punch operations: `addManualPunchFn`, `deletePunchFn`, `correctPunchFn`.
- Terminal status function: `getTerminalStatusFn`.
- Terminal route `/attendance/scan` + kiosk UI component.
- Evolved manual attendance editor (two-mode: punch timeline vs. status edit).
- Pure recompute engine + back-attribution logic.
- Drizzle migration (additive, zero-downtime).
- Vitest unit / property / source-inspection / component tests.

**Scope out (explicit non-goals):**
- Mobile/phone scanning and GPS geofencing (the chosen device is a fixed desktop scanner).
- Cryptographic / rotating QR codes (the QR is printed on a physical card → permanently static).
- A cron job to auto-close open punches (HR cleans up — explicit decision).
- Card revocation in the QR payload (flagged as a future enhancement, §12.5).
- Refactoring the payslip engine (it keeps reading the `attendance` row unchanged; the `checkIn2`/`checkOut2` removal does not affect it since it reads `dutyHours`). HR attendance *readers* get a small edit to drop `checkIn2`/`checkOut2` reads (per §7.4), but their core read model (the `attendance` row) is unchanged.

---

## 2. Decisions Locked During Brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Scanner = shared 2D desktop barcode scanner (HID keyboard wedge) at a fixed station | Given by user. No camera, no GPS. |
| D2 | Unlimited check-in/check-outs per day | Given by user. Breaks the existing 2-shift `checkIn/Out/2` schema → needs a punch table. |
| D3 | First scan = check-in + marks present; next = check-out; alternates | Given by user. |
| D4 | Dedicated `attendance_terminal` service account (only `attendance_terminal.scan` permission) | User-approved. Clean security boundary; stolen session can only forge punches, not read HR/payroll. |
| D5 | Per-employee `shiftStartTime` / `shiftEndTime` | User-approved. Drives auto `isLate`. |
| D6 | Calendar-day attribution + no auto-close of open punches (HR cleans up) | User-approved. |
| D7 | Reject scan if HR pre-marked `leave` or `holiday` | User-approved. |
| D8 | Reject scan if HR pre-marked `absent` | User-approved (rule 6). |
| D9 | Night shift auto-computed by QR | User-approved → requires the overnight-out back-attribution exception to D6. |
| D10 | Architecture = Approach A: append-only `attendance_punches` as source of truth; daily `attendance` row synchronously recomputed from punches inside one transaction | User-approved. Existing HR/payroll readers unchanged. |
| D11 | Rejected-scan audit table (`attendance_scan_attempts`) | User-approved. |
| D12 | Manual attendance is punch-driven for `present` (HR adds/corrects punches, never edits derived fields directly); direct row edit only for `absent`/`leave`/`holiday` | User-approved. Eliminates the overwrite conflict between manual edits and QR recompute. |

---

## 3. Architecture (Approach A)

```
┌──────────────┐    HID keyboard wedge     ┌────────────────────┐
│  2D Scanner  │ ─────────── types ──────► │  Terminal Route     │
│  (physical)  │   QR string + Enter       │  /attendance/scan   │
└──────────────┘                           │  (kiosk UI, hidden  │
                                           │   focused input)    │
                                           └─────────┬──────────┘
                                                     │ rawPayload (string)
                                                     ▼
                                           ┌────────────────────┐
                                           │ scanAttendanceFn   │  requireAttendanceTerminalMiddleware
                                           │ (createServerFn)   │
                                           └─────────┬──────────┘
                                                     │ single transaction
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                  ┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
                  │ attendance_punches│  │ attendance (recompute)│  │ attendance_scan_  │
                  │  INSERT one row   │  │  UPDATE/INSERT daily  │  │ attempts INSERT   │
                  │  (immutable)      │  │  row from all punches │  │ (rejected only)   │
                  └──────────────────┘  └──────────────────────┘  └──────────────────┘
                                                     │
                                                     ▼ response
                                           {status, direction, employeeName,
                                            employeeCode, message, punchTime,
                                            isLate, dutyHours, isNightShift}
                                                     │
                                                     ▼
                                           Full-screen feedback state
                                           (success green / reject red /
                                            duplicate amber / offline gray)
                                           + WebAudio beep + auto-return to idle
```

**Manual path (HR):**
```
HR user (hr.manage) ──► addManualPunchFn / deletePunchFn / correctPunchFn
                         │ single transaction
                         ▼
                 attendance_punches INSERT/DELETE  ──► recompute attendance row
                 (source="manual", terminalUserId=HR user id)
```

**Why this architecture:**
- The existing `attendance` row is the single read model for HR pages, bulk sheet, employee log, and the payslip engine — all unchanged.
- Punches are an immutable audit log; the derived row is always recomputable and idempotent.
- QR and manual paths write the same punch table → no conflict, no dual source of truth.

---

## 4. Data Model

### 4.1 New table: `attendance_punches` (append-only source of truth)

```ts
// src/db/schemas/hr-schema.ts
export const attendancePunches = pgTable("attendance_punches", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  // Full-precision moment (UTC timestamptz, displayed in PKT) — enables audit + replay defense
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  // PKT calendar date this punch counts toward (drives which attendance row it rolls into)
  attendanceDate: date("attendance_date").notNull(),
  // Alternation within an attendanceDate: first = "in", next = "out", next = "in" ...
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  source: text("source").notNull().default("qr_terminal"), // "qr_terminal" | "manual"
  terminalUserId: text("terminal_user_id").references(() => user.id), // who ran the terminal / which HR user added it
  ...timestamps,
}, (t) => ({
  empDateIdx: index("attendance_punches_emp_date_idx").on(t.employeeId, t.attendanceDate),
  dateIdx:    index("attendance_punches_date_idx").on(t.attendanceDate),
  tsIdx:      index("attendance_punches_ts_idx").on(t.timestamp),
}));
```

**Immutability rule:** the scan path and the manual-add path only ever `INSERT`. The only `DELETE` is the HR admin `deletePunchFn` / `correctPunchFn` (which are explicit correction actions with their own audit trail via the punch's `source`/`terminalUserId`). The scan path never updates or deletes a punch.

**Relations:** `attendancePunchesRelations` → `employee` (one) and `terminalUser` (one, to `user`).

### 4.2 New table: `attendance_scan_attempts` (rejected-scan audit)

```ts
export const attendanceScanAttempts = pgTable("attendance_scan_attempts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  // Nullable: for malformed payloads we can't resolve an employee
  employeeId: text("employee_id").references(() => employees.id),
  payload: text("payload").notNull(),            // raw scanned string, for forensics
  reason: text("reason").notNull(),              // machine-readable: "invalid_payload" | "unknown_employee" | "inactive" | "on_leave" | "on_holiday" | "marked_absent" | "duplicate_scan"
  message: text("message").notNull(),            // human-readable, what the terminal displayed
  terminalUserId: text("terminal_user_id").references(() => user.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => ({
  dateIdx:  index("attendance_scan_attempts_date_idx").on(t.timestamp),
  empIdx:   index("attendance_scan_attempts_emp_idx").on(t.employeeId),
}));
```

Accepted scans are audited via `attendance_punches` (the punch row itself), so this table only captures rejections. Queryable from the HR UI for "I scanned but nothing happened" diagnosis.

### 4.3 New columns on `employees`

```ts
shiftStartTime: time("shift_start_time"),   // null = no auto late-check (isLate preserved)
shiftEndTime:   time("shift_end_time"),     // null = no auto open-punch handling (we chose no auto-close anyway; kept for future use + display)
```

Nullable, no default, no NOT NULL → zero-downtime migration. `isLate` auto-computation only runs when `shiftStartTime` is set; otherwise `isLate` is left untouched (graceful degrade for unconfigured staff, equivalent to "HR sets it").

### 4.4 RBAC additions

- New permission row: `key = "attendance_terminal.scan"`, `moduleKey = "attendance"`, `routePattern = "/attendance/scan"`, `kind = "action"`.
- New system role: `slug = "attendance_terminal"`, `isSystem = true`, `defaultLandingPath = "/attendance/scan"`.
- Role-permission link: `attendance_terminal` → `attendance_terminal.scan` (only this one).
- Because `userRoleAssignments.userId` is the primary key (one role per user), a terminal account can *only* be a terminal — it cannot also hold an HR role, so it cannot read payroll/salaries.
- New middleware in `src/lib/middlewares.ts`:
  ```ts
  export const requireAttendanceTerminalMiddleware = createPermissionMiddleware("attendance_terminal.scan");
  ```
- Add `attendance_terminal.scan` to the permission registry in `src/lib/rbac.ts` and exclude the `/attendance/scan` route from the normal sidebar navigation (it's not a regular app page).

### 4.5 Schema registration

Register `attendancePunches` + `attendanceScanAttempts` in the merged schema (`src/db/index.ts`) so `db.query.attendancePunches` / `db.query.attendanceScanAttempts` work.

---

## 5. QR Payload & Employee Lookup

The printed QR payload (unchanged from the existing ID card component):
```json
{ "type": "TITAN_EMPLOYEE", "id": "<employee.id>", "code": "<employee.employeeCode>", "v": 1 }
```
The QR is **static and permanent** (printed on a physical card). Anti-forgery therefore comes from terminal auth + physical card control + audit, not from the QR (see §9).

The terminal does **not** parse the payload — it forwards the raw scanned string to `scanAttendanceFn`. The server:
1. `JSON.parse` → validate shape: `type === "TITAN_EMPLOYEE"`, `v === 1`, `id` and `code` are non-empty strings. Fail → reject `"invalid_payload"` → log to `attendance_scan_attempts`.
2. Look up `employees` by `id`. If not found, or `employeeCode !== code` → reject `"unknown_employee"`. The `code` cross-check is a mild integrity guard (a card copied with only the `id` won't work).

---

## 6. Scan Rejection Rules

Evaluated in this exact order. The first match wins.

| # | Rule | `reason` | Terminal message | Audit row? |
|---|------|----------|------------------|------------|
| 1 | Malformed payload / wrong type / wrong version | `invalid_payload` | "Invalid card" | yes |
| 2 | Employee not found or `employeeCode` mismatch | `unknown_employee` | "Unknown employee" | yes |
| 3 | `employee.status !== "active"` | `inactive` | "Employee inactive — see HR" | yes |
| 4 | Today is a rest day for this employee (`restDays` array) | — (accept, not reject) | — | no |
| 5 | Existing `attendance` row today with `status = "leave"` or `"holiday"` | `on_leave` / `on_holiday` | "You are on approved leave today — see HR" | yes |
| 6 | Existing `attendance` row today with `status = "absent"` | `marked_absent` | "Marked absent today — see HR" | yes |
| 7 | Last punch for this employee (any date) is < 30s ago | `duplicate_scan` | "Duplicate scan — wait a moment" | yes |
| 8 | (otherwise) | — | accept → insert punch + recompute | — |

**Rest-day scan (rule 4):** accepted. The person is physically present (possibly overtime). Create/update the day's `attendance` row with `status="present"`, `entrySource="qr_terminal"`, and append "Scanned on rest day" to `notes`. HR handles overtime. Rejecting would hide legitimate overtime.

**Double-scan window (rule 7):** 30 seconds, **per employee** (not global), so two employees scanning back-to-back don't block each other. A global per-terminal rate limit (max 60 scans/min) is a cheap add to prevent a broken-scanner flood.

---

## 7. Direction Alternation & Daily-Row Recompute

### 7.1 Direction alternation (per `attendanceDate`)

- Direction alternates **within an `attendanceDate`**, not globally. A new PKT calendar day always starts with `"in"`.
- So `in 08:00 → out 12:00 → in 13:00 → out 17:00` = 2 completed intervals = 8h.
- A day that ends on an open `"in"` → `checkOut = null`; the trailing interval contributes 0 to `dutyHours` until HR fixes it (no auto-close — D6).
- The `"out"` direction is stored on the punch (not derived at read time) so HR can read the sequence directly and a missed punch is visible as a gap, not a silent re-alternation.

### 7.2 Night-shift overnight-out back-attribution (the narrow exception to D6)

Because night shifts are auto-computed (D9), pure calendar-day attribution would split a 22:00→06:00 shift across two days (open "in" on D, orphan "out" on D+1). The exception:

1. **Night-shift-in flag:** an `"in"` punch at/after **20:00** → `isNightShift = true` on that day's row.
2. **Overnight checkout back-attribution:** when a scan arrives that:
   - would be the employee's **first punch of the PKT calendar day**, AND
   - the time is **before 12:00 noon**, AND
   - the employee's most recent punch (any prior day) is an **open `"in"`**:
   - Then this punch is the overnight checkout. Attribute it to the **previous day's** `attendanceDate` (the date of the open "in"), direction `"out"`.
   - Set `isNightShift = true` on that previous day's row.
   - Recompute the previous day → now a complete in→out interval crossing midnight → `dutyHours` correct via the existing +24h logic in `calculateHours`.
   - Do **not** create a new attendance row for today from this punch (today stays empty until the employee clocks in for their next shift).

**Why this honors D6:** it is *not* a general auto-close of all open punches. It only fires when a day's first punch would otherwise be a lone early-morning `"out"` with an open `"in"` yesterday — a condition that *only* occurs for night shifts. Normal day shifts (09:00→17:00) and forgotten checkouts (open "in", no morning scan) are untouched; HR still cleans those up.

**Thresholds (configurable later):** `nightShiftStartHour = 20`, `overnightOutBeforeHour = 12`, timezone `Asia/Karachi`.

### 7.3 Daily-row recompute (inside the same transaction as the punch insert)

After inserting the punch, fetch **all** punches for `(employee, attendanceDate)` ordered by `timestamp` and UPDATE the `attendance` row:

| Field | Recompute source |
|-------|------------------|
| `status` | `"present"` |
| `checkIn` | first `"in"` punch time (HH:mm:ss, PKT) |
| `checkOut` | last `"out"` punch time, or `null` if day ends on open `"in"` |
| `dutyHours` | Σ(`out − in`) for each completed in→out pair; open trailing `"in"` = 0 |
| `isLate` | first `"in"` > `shiftStartTime` + grace (only if `shiftStartTime` set; else **preserved**) |
| `isNightShift` | `true` if any `"in"` punch is at/after `nightShiftStartHour` (20:00), or the day was back-attributed as an overnight checkout |
| `entrySource` | `"qr_terminal"` |
| **Preserved (not touched by recompute):** | `overtimeHours`, `overtimeStatus`, `overtimeRemarks`, `earlyDepartureStatus`, `checkOutReason`, `isApprovedLeave`, `leaveType`, `leaveApprovalStatus`, `notes` |

Preserving overtime/leave/night-shift-manual fields means HR's manual adjustments survive a later scan, and the payslip engine keeps working unchanged. If no `attendance` row exists yet, INSERT one with the computed fields + defaults for the rest.

**Idempotence:** running recompute N times on the same punch set yields the same `attendance` row. Verified by property test (§11.5).

### 7.4 Split shifts & removal of `checkIn2` / `checkOut2`

With unlimited punches, a split shift is just `in→out→in→out` in the punch log. The `attendance` row's `checkIn` = first in, `checkOut` = last out, `dutyHours` = Σ intervals, and the intermediate punches are visible in the manual UI's punch timeline. The fixed two-shift columns are therefore redundant.

Since nothing is in production, the `checkIn2` / `checkOut2` columns are **removed entirely**:
- The migration drops `check_in_2` / `check_out_2` from the `attendance` table.
- All code that reads/writes them is updated to use the punch timeline / recompute output instead. Blast radius (10 source files + schema + seed):
  - `src/db/schemas/hr-schema.ts` — remove the two column definitions.
  - `src/lib/validators/hr-validators.ts` — remove `checkIn2` / `checkOut2` from the upsert schema.
  - `src/server-functions/hr/attendance/upsert-attendance-fn.ts` — remove the `dutyHours2` calc + the `checkIn2`/`checkOut2` write fields.
  - `src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts` — remove `checkIn2`/`checkOut2` from the template + zod schema.
  - `src/hooks/hr/use-bulk-mark-attendance.ts` — remove the two fields from the hook type.
  - `src/components/hr/attendance/edit-attendance-form.tsx` — remove the two `form.Field` blocks + type + initial values.
  - `src/components/hr/attendance/edit-attendance-sheet.tsx` — remove the two fields from the type.
  - `src/components/hr/attendance/attendance-list-table.tsx` — remove the two fields from the row type; split-shift display moves to punch timeline.
  - `src/components/hr/attendance/employee-attendance-log.tsx` — remove the `hasShift2` logic + the shift-2 cell (`record.checkIn2`/`checkOut2`); split-shift display moves to punch timeline.
  - `src/components/hr/attendance/bulk-attendance-sheet.tsx` — remove the `checkIn2`/`checkOut2` state + inputs + payload fields.
  - `src/db/seed-hr.ts` — remove the `checkIn2`/`checkOut2` seed values (seed instead creates punches for split-shift demo rows).
- Split shifts (any number of shifts, not just 2) are displayed via the punch timeline in the manual editor and the employee attendance log.

---

## 8. Manual Attendance (Reconciled with Punches)

### 8.1 Core principle (D12)

| Attendance status | Who writes it | How |
|---|---|---|
| `present` | **punches only** — regardless of whether the punch came from QR or HR | HR adds/corrects punches (`source="manual"`); recompute derives the row |
| `absent` / `leave` / `holiday` | **HR edits the `attendance` row directly** | No punches exist for these; status is a judgment call, not a clock event |

HR never directly edits `checkIn`/`checkOut`/`dutyHours` for a present employee. They edit the *punches*, and the row follows. This eliminates the overwrite conflict between manual edits and QR recompute.

### 8.2 Manual punch operations (new server functions)

| Operation | Server fn | Middleware | What it does |
|---|---|---|---|
| Add a manual punch | `addManualPunchFn` | `requireHrManageMiddleware` | Inserts one punch (`source="manual"`, `terminalUserId` = the HR user's id) → recomputes the day. |
| Delete a punch | `deletePunchFn` | `requireHrManageMiddleware` | Deletes a punch by id → recomputes the day. |
| Correct a punch time | `correctPunchFn` | `requireHrManageMiddleware` | Deletes the old punch + inserts a new one at the corrected time (atomic, one transaction) → recomputes. |

Each writes to `attendance_punches` (insert or delete) + recomputes the `attendance` row in one `db.transaction()`. No new permission needed — HR managers already manage attendance.

### 8.3 Lost-card / missed-checkout workflow (concrete)

1. Employee loses card, can't scan out at end of day.
2. HR opens the employee's attendance for today (existing HR attendance page).
3. The day shows an open `"in"` punch (e.g. 08:03, `source="qr_terminal"`) with no matching `"out"`.
4. HR clicks **"Add manual punch"** → direction auto-suggests `"out"` (from alternation) → HR picks the checkout time (e.g. 17:00) → saves.
5. A punch `(out, 17:00, source="manual", terminalUserId=<HR user>)` is inserted → recompute fills `checkOut=17:00`, `dutyHours=8.97`.
6. The audit trail (punch timeline) shows: `in 08:03 (QR)` → `out 17:00 (manual by admin@…)`. Fully traceable.

Same flow for a missed check-in: HR adds a manual `"in"` punch at the arrival time.

### 8.4 Enhanced manual attendance UI (two-mode editor)

The existing `edit-attendance-form.tsx` / `edit-attendance-sheet.tsx` evolve to a two-mode editor based on status:

**Mode 1 — Present (punch-driven timeline editor):**
- Punch timeline as a vertical list of cards: each punch = direction badge + time + source badge (QR / Manual / Manual by `<user>`) + delete button.
- **"Add punch"** button → time picker + auto-suggested direction (from current alternation) → save.
- **Live recomputed summary** panel: `checkIn`, `checkOut`, `dutyHours`, `isLate`, `isNightShift` — updates as punches change (calls the pure recompute function client-side for instant feedback; server confirms on save).
- **No direct `checkIn`/`checkOut`/`dutyHours` input fields** for present status — those are derived, not editable. HR thinks in punches, not in summary fields.

**Mode 2 — Absent / Leave / Holiday (direct row edit):**
- Status selector (absent / leave / holiday) + leave type + leave approval + notes — same as today.
- No punch timeline (these statuses have no punches).
- If HR switches status from present → absent/leave/holiday, existing punches are **not deleted** (they remain as audit evidence) but the row's `status` changes. Recompute is not triggered for non-present statuses.

**Bulk attendance sheet (existing `bulk-attendance-sheet.tsx`):**
- Stays as-is for marking status (absent/leave/holiday) across many employees.
- If marking "present" in bulk: creates default punches (`in` at `shiftStartTime`, `out` at `shiftEndTime`, `source="manual"`) for employees who have no punches that day — so a bulk "present" mark is also punch-backed and won't be overwritten by a later QR scan. Employees who already have punches that day are skipped (they're already present).

### 8.5 Backward compatibility with existing HR readers

`attendance-list-table.tsx`, `attendance-summary-cards.tsx`, `employee-attendance-log.tsx` all read the `attendance` row — they keep working with `checkIn`/`checkOut`/`dutyHours`/`status` (unchanged columns). The `checkIn2`/`checkOut2` reads in these files are **removed** (per §7.4) and replaced with punch-timeline display for split shifts. Only the **editor** (`edit-attendance-form/sheet`) changes to the two-mode design.

### 8.6 Audit for manual operations

Every manual punch operation records `source="manual"` + `terminalUserId` (the HR user) in `attendance_punches`. The punch timeline itself is the audit log — no separate audit table for manual ops. HR can see exactly who added/corrected each punch and when.

---

## 9. Security: Anti-Forgery & Anti-Replay

The QR is printed on a physical card → **permanently static**. Anyone who photographs a card can replay it. Accepted as a limitation; mitigations:

- **Auth layer:** the terminal account has *only* `attendance_terminal.scan`. A stolen terminal session can forge punches but cannot read HR/payroll. Every punch carries `terminalUserId` for audit.
- **Replay defense:** no cryptographic QR (impossible on a printed card). Mitigations: (a) physical card control, (b) per-employee 30s double-scan window (rule 7), (c) HR reviews the punches + `attendance_scan_attempts` table, (d) anomalies (e.g. an "in" with no matching "out" pattern over days) surface in the existing HR attendance views.
- **Rate limiting:** 30s per-employee window is the primary limiter; a global per-terminal rate limit (max 60 scans/min) prevents a broken-scanner flood.
- **Server authority:** the server stamps `timestamp = now()` and derives `attendanceDate` from PKT server time. The client never supplies a timestamp or date. Terminal clock skew is irrelevant.
- **Card revocation (future enhancement, §12.5):** if a card is stolen, HR marks the employee inactive (rule 3 rejects) until re-issue. A proper revocation column (`employee.cardRevokedAt`) to invalidate old payloads without deactivating the employee is a future enhancement, not blocking.

---

## 10. Terminal Route & UI

### 10.1 Route

`src/routes/attendance/scan.tsx` — a **layout-less** route (sibling to `_protected`, not nested under it) so no sidebar/header renders. `beforeLoad` requires the `attendance_terminal.scan` permission via the existing `_protected`-style pattern; a terminal account logs in at `/login` and is redirected to `/attendance/scan` by `defaultLandingPath`. Unauthorized users are redirected away.

- `<title>`: "Attendance Terminal".
- **Wake-lock:** `navigator.wakeLock.request("screen")` so the station display never sleeps; released on unmount; graceful fallback if unsupported.

### 10.2 Scanner input handling (keyboard wedge)

A 2D desktop scanner is a HID keyboard: it types the QR string fast, then sends `Enter`. The route uses a single hidden `<input>` kept permanently focused:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
const [payload, setPayload] = useState("");
useEffect(() => {
  const refocus = () => inputRef.current?.focus();
  document.addEventListener("click", refocus);
  window.addEventListener("focus", refocus);
  return () => { /* cleanup */ };
}, []);
const onSubmit = async (e: FormEvent) => {
  e.preventDefault();
  const raw = payload.trim();
  setPayload("");
  if (!raw) return;
  await submitScan(raw); // calls scanAttendanceFn, sets result state
  inputRef.current?.focus(); // immediate refocus
};
```

- Input is visually hidden (sr-only) but present in the DOM and focused. No on-screen keyboard — the scanner "types" into it.
- **No debounce** — the scanner's trailing `Enter` is the natural submit trigger; debouncing a HID wedge adds latency and can drop a fast second scan. The server-side 30s double-scan rule (rule 7) is the real anti-double-tap.
- A small "click to refocus" hint appears if the input loses focus (e.g. user clicked elsewhere).

### 10.3 Feedback display (full-screen, glanceable from a distance)

The scan result drives a full-screen state that swaps the entire page content. No list, no history clutter.

| State | Trigger | Visual | Sound |
|-------|---------|--------|-------|
| Idle | no scan yet / 10s after last result | neutral dark screen, "Scan your card" prompt + current PKT time | — |
| Success IN | accepted punch, direction `in` | full-screen green, large employee name, "CHECKED IN 08:03", shift start, late badge if applicable | 1 short beep (success) |
| Success OUT | accepted punch, direction `out` | full-screen green, name, "CHECKED OUT 13:02", current duty hours so far | 1 short beep |
| Rejected | any rule 1–6 | full-screen red, rejection message from server, employee name if resolvable | 2 short beeps (error) |
| Duplicate | rule 7 (<30s) | full-screen amber, "Duplicate scan — wait a moment", name | 1 low beep |
| Connection error | server fn throws / network | full-screen gray, "Scanner offline — check connection", auto-retry indicator | continuous soft alert every 5s |

- **Auto-return to idle** 10 seconds after any success/reject/duplicate (timer resets on new scan).
- **Sound via WebAudio** (no external file): `AudioContext` created on first user gesture (the terminal operator's first click to focus — satisfies browser autoplay policy). Three synthesized tones: success (880Hz), error (220Hz ×2), duplicate (440Hz).
- **No employee photo / no salary / no PII beyond name + code** — the terminal is in a public hallway; only what someone could read off the physical card.

### 10.4 Terminal status footer (always visible, small)

Bottom strip, non-interactive: terminal account name, connection dot (green/gray), punch count today, current PKT clock. Lets a passerby/supervisor see the terminal is alive without a scan.

### 10.5 Data fetching & caching

- The scan calls `scanAttendanceFn(rawPayload)` directly in the form submit handler (a mutation-like action with per-call feedback, not cached server state) → TanStack Query is **not** used for the scan itself. Local React state holds the result.
- A separate `useQuery` polls `getTerminalStatusFn` (today's punch count, terminal identity) every 30s for the footer — cheap, low frequency.

---

## 11. Testing

Vitest with jsdom, `globals: true`, `src/__tests__/setup.ts`. Mix of pure-function, property-based (fast-check), source-inspection, and component tests — matching the codebase convention. No test DB.

### 11.1 Pure-function extraction (testability)

The highest-risk logic is extracted as pure functions (no DB) in `src/lib/attendance/`:

```ts
// src/lib/attendance/recompute.ts
export function computeAttendanceFromPunches(punches: Punch[], opts: {
  shiftStartTime?: string | null;        // "HH:mm:ss"
  graceMinutes: number;                  // 15
  nightShiftStartHour: number;           // 20
  overnightOutBeforeHour: number;        // 12
}): {
  checkIn: string | null;
  checkOut: string | null;
  dutyHours: string;                     // "8.00"
  isLate: boolean | null;                // null = preserved (no shiftStartTime)
  isNightShift: boolean;
  openInCount: number;                   // for HR visibility
}
```

```ts
// src/lib/attendance/back-attribute.ts
export function resolveAttendanceDate(
  incomingTimestamp: Date,
  lastPunch: { direction: "in" | "out"; attendanceDate: string; timestamp: Date } | null,
  opts: { overnightOutBeforeHour: number; tz: "Asia/Karachi" },
): { attendanceDate: string; direction: "in" | "out"; isOvernightCheckout: boolean }
```

```ts
// src/lib/attendance/payload.ts
export function parseQrPayload(raw: string):
  | { ok: true; employeeId: string; employeeCode: string }
  | { ok: false; reason: "invalid_payload" }
```

### 11.2 Recompute unit tests (§4.1 edge cases)

- single `in→out` (8h)
- `in→out→in→out` (Σ intervals)
- open `in` (no `out`) → `checkOut=null`, open interval = 0
- `in` at 21:00, `out` next-day 06:00 → `dutyHours=9`, `isNightShift=true` (after back-attribution)
- `in` exactly at `shiftStartTime+grace` → not late; 1 min after → late
- no `shiftStartTime` → `isLate=null` (preserved)
- empty punches → all nulls / 0
- `in` at 08:00, `out` at 08:00 (zero-duration) → 0h, not an error

### 11.3 Back-attribution unit tests

- first punch ever → `attendanceDate = today PKT`, `in`
- prior punch `out` today → `attendanceDate = today`, `in`
- prior punch `in` yesterday, incoming 09:00 today → back-attributed to yesterday as `out`, `isOvernightCheckout=true`
- prior punch `in` yesterday, incoming 13:00 today (after noon) → **not** back-attributed; new day `in` (orphan open punch left for HR)
- prior punch `in` 2 days ago, incoming 09:00 → orphan; new day `in` (stale open punch is HR's problem)

### 11.4 Payload unit tests

- valid JSON, correct shape → `ok: true`
- wrong `type` → `ok: false`
- wrong `v` → `ok: false`
- missing `id`/`code` → `ok: false`
- not JSON → `ok: false`

### 11.5 Property-based tests (fast-check)

- For any sequence of punches, recomputing twice yields identical `attendance` rows (idempotence).
- For any sequence, the count of `"in"` and `"out"` punches differs by at most 1 (alternation invariant).
- `dutyHours` is always ≥ 0 and equals the sum of completed intervals (never exceeds total span).

### 11.6 Source-inspection tests (server fn — codebase convention)

Per AGENTS.md, server fns that compose DB queries are validated by reading the source and asserting patterns. Tests assert that `scanAttendanceFn` source:
- wraps its writes in `db.transaction(...)`
- inserts into `attendance_punches` (never updates)
- inserts rejected scans into `attendance_scan_attempts` with the right `reason`
- is gated by `requireAttendanceTerminalMiddleware`
- never trusts a client-supplied `attendanceDate` or `timestamp` (derives from server `now()`)

### 11.7 Component test (terminal route — jsdom)

- Renders `/attendance/scan`; the hidden input is focused on mount.
- Submitting a payload calls the scan fn with the raw string; input is cleared + refocused.
- Result state swaps full-screen content (success/reject/duplicate) and auto-returns to idle after the timer.
- Wake-lock request is attempted but failures don't crash.

### 11.8 Not tested (explicit)

- Real DB transactions (no test DB per codebase convention).
- Real scanner hardware (HID wedge behavior verified manually).
- Timezone conversions against live Postgres — unit-tested via `date-fns-tz` in isolation.

---

## 12. Rollout, Migration & Operations

### 12.1 Drizzle migration (mostly additive, one column drop)

Single migration `src/db/migrations/XXXX_add_qr_attendance.sql`:
1. Create `attendance_punches` with indexes (`emp_date`, `date`, `ts`).
2. Create `attendance_scan_attempts` with indexes (`timestamp`, `employeeId`).
3. Add `shiftStartTime` / `shiftEndTime` to `employees` as nullable `time` columns — no default, no NOT NULL.
4. **Drop `check_in_2` / `check_out_2` from `attendance`** (per §7.4; nothing in production, columns are redundant with the punch table). Code cleanup happens in the same PR so no code references the dropped columns.
5. Seed RBAC: insert `attendance_terminal.scan` permission + `attendance_terminal` system role + role-permission link. Idempotent (`ON CONFLICT DO NOTHING` on unique `key`/`slug`).

No data backfill, no downtime (drop column is instant in Postgres). `db:generate` → `db:migrate` (the flow Railway already runs pre-deploy).

### 12.2 Terminal account provisioning

A super-admin creates the terminal user via the existing user-management UI:
1. Create user `terminal-gate` (or one per physical station: `terminal-factory`, `terminal-office`).
2. Assign the `attendance_terminal` role (only role it can have).
3. On the scanner PC: log in once at `/login`; session persists; `defaultLandingPath` sends it to `/attendance/scan`.

**Open operational item — session longevity:** Better Auth sessions have a max age. For an unattended terminal, a 24h logout is operationally painful. Recommend setting a long/non-expiring session for terminal-role accounts specifically (or extending session maxAge for this role). If not configurable per-role, a supervisor re-login is the fallback. Flagged as open, not blocking.

### 12.3 Employee onboarding for QR

- Existing employees: HR opens each employee, sets `shiftStartTime` (and optional `shiftEndTime`), prints the ID card (the print-QR fix already landed) → physical card issued.
- New employees: the existing add-employee flow already captures everything the card needs; HR just sets the shift + prints the card.
- No re-issue needed for this feature — the QR payload `{type,id,code,v:1}` is already on printed cards; the new system reads the same payload.

### 12.4 Rollout phasing (low-risk)

1. **Backend + tests** ship first (migration, pure functions, server fn, RBAC). No UI exposed. Existing HR manual attendance keeps working — new code paths are inert until a terminal account exists and scans.
2. **Terminal route** ships, accessible only to the `attendance_terminal` role. No employee sees it.
3. **Pilot:** set shift times on a few employees, print cards, set up one terminal account on one scanner PC, run for a week alongside the manual HR process. Compare QR-derived rows vs HR manual rows for the pilot employees.
4. **Cutover:** once pilot matches, expand shift config to all employees, roll terminals to all stations. HR manual entry stays available as the permanent fallback (the derived `attendance` row is the same row HR edits, so both paths coexist).

### 12.5 Open operational items

- Per-role session maxAge for terminal accounts (§12.2) — verify Better Auth config or plan a supervisor re-login ritual.
- Physical card replacement for lost cards — same `id`, so a reprinted card with the same payload works. If a card is *stolen*, there's no revocation in the QR (static). Mitigation: HR marks the employee inactive (rule 3 rejects) until re-issue. A future `employee.cardRevokedAt` column to invalidate old payloads is a non-blocking enhancement.
- Monitoring: the terminal footer's connection dot + punch count is the live health signal. Server logs + `attendance_scan_attempts` cover offline diagnosis.
- No backfill: punches start accumulating from go-live; historical `attendance` rows (manual) remain as-is and are never recomputed from punches (no punches exist for them).

---

## 13. Files Touched

| File | Change |
|------|--------|
| `src/db/schemas/hr-schema.ts` | Add `attendancePunches`, `attendanceScanAttempts`, `shiftStartTime`/`shiftEndTime` columns + relations |
| `src/db/index.ts` | Register new tables in the merged schema |
| `src/lib/attendance/recompute.ts` | Pure recompute engine (new) |
| `src/lib/attendance/back-attribute.ts` | Pure back-attribution logic (new) |
| `src/lib/attendance/payload.ts` | Pure QR payload parse/validate (new) |
| `src/lib/middlewares.ts` | Add `requireAttendanceTerminalMiddleware` |
| `src/lib/rbac.ts` | Add `attendance_terminal.scan` permission key + exclude `/attendance/scan` from sidebar nav |
| `src/server-functions/hr/attendance/scan-attendance-fn.ts` | The scan handler (new) |
| `src/server-functions/hr/attendance/get-terminal-status-fn.ts` | Footer status (new) |
| `src/server-functions/hr/attendance/add-manual-punch-fn.ts` | HR manual punch add (new) |
| `src/server-functions/hr/attendance/delete-punch-fn.ts` | HR punch delete (new) |
| `src/server-functions/hr/attendance/correct-punch-fn.ts` | HR punch time correction (new) |
| `src/routes/attendance/scan.tsx` | Terminal route (new, layout-less) |
| `src/components/attendance/scan-terminal.tsx` | The kiosk UI (new) |
| `src/components/hr/attendance/edit-attendance-form.tsx` | Evolve to two-mode editor (punch timeline vs status edit) |
| `src/components/hr/attendance/edit-attendance-sheet.tsx` | Evolve to two-mode editor |
| `src/components/hr/attendance/bulk-attendance-sheet.tsx` | Bulk "present" creates default manual punches; remove `checkIn2`/`checkOut2` state/inputs/payload |
| `src/components/hr/employees/add-employee-form.tsx` | Shift time fields |
| `src/components/hr/employees/edit-employee-form.tsx` | Shift time fields |
| `src/components/hr/attendance/attendance-list-table.tsx` | Remove `checkIn2`/`checkOut2` from row type; split-shift display via punch timeline |
| `src/components/hr/attendance/employee-attendance-log.tsx` | Remove `hasShift2` + shift-2 cell; split-shift display via punch timeline |
| `src/lib/validators/hr-validators.ts` | Remove `checkIn2`/`checkOut2` from upsert schema |
| `src/server-functions/hr/attendance/upsert-attendance-fn.ts` | Remove `dutyHours2` calc + `checkIn2`/`checkOut2` write fields |
| `src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts` | Remove `checkIn2`/`checkOut2` from template + zod schema |
| `src/hooks/hr/use-bulk-mark-attendance.ts` | Remove `checkIn2`/`checkOut2` from hook type |
| `src/db/seed-hr.ts` | Remove `checkIn2`/`checkOut2` seed values; seed split-shift demo rows via punches |
| `src/lib/attendance/recompute.test.ts` | Unit + property tests |
| `src/lib/attendance/back-attribute.test.ts` | Unit tests |
| `src/lib/attendance/payload.test.ts` | Unit tests |
| `src/server-functions/hr/attendance/scan-attendance-fn.test.ts` | Source-inspection tests |
| `src/routes/attendance/scan.test.tsx` | Component test |
| `src/db/migrations/XXXX_add_qr_attendance.sql` | Generated by `db:generate` |

---

## 14. Edge-Case Reference (consolidated)

### 14.1 Punch lifecycle

| Scenario | Behavior |
|----------|----------|
| First scan of a PKT day | direction `"in"`; new `attendance` row inserted if none exists |
| `in → out → in → out ...` | alternation per `attendanceDate`; `dutyHours` = Σ completed in→out intervals |
| Forgotten checkout, no morning scan next day | day ends on open `"in"`; `checkOut=null`; open interval = 0 to `dutyHours`; HR cleans up via `deletePunchFn`/`addManualPunchFn` |
| Night shift: `in` at/after 20:00 | `isNightShift=true` on that day; `attendanceDate` = D |
| Night shift: overnight `out` (first punch of new day, before 12:00, open `in` yesterday) | back-attributed to yesterday as `"out"`; yesterday recomputed with completed interval; today stays empty; `isNightShift=true` on yesterday |
| Scan on a rest day | accepted; `status="present"`; `notes` appended "Scanned on rest day"; HR handles overtime |
| Scan while `status=leave/holiday` | rejected (rule 5); logged |
| Scan while `status=absent` | rejected (rule 6); logged |
| Inactive employee (`status≠active`) | rejected (rule 3); logged |
| Unknown employee / code mismatch | rejected (rule 2); logged |
| Malformed payload / wrong version | rejected (rule 1); logged |
| Double scan < 30s | rejected as duplicate (rule 7); logged |
| Employee with no `shiftStartTime` | `isLate` **preserved** (not auto-computed); `entrySource` still `qr_terminal` |
| HR edits the derived `attendance` row after a scan | preserved fields (overtime, leave, night-shift-manual, notes) survive; a *later* scan re-applies computed fields and re-preserves the manual fields — net effect: manual fields win, computed fields reflect latest punches |
| HR adds/corrects a manual punch | punch inserted/deleted (`source="manual"`); recompute derives the row; timeline shows who did it |
| HR deletes a punch (admin action) | recompute the day's row from remaining punches; `attendance` row stays consistent |
| Punch for a date in the past (impossible from terminal) | server stamps `timestamp = now()`; `attendanceDate` derived server-side from PKT, never trusted from client |
| Clock skew on terminal | server is source of truth for all timestamps; terminal clock irrelevant |
| `attendanceDate` derivation | `timestamp` (UTC `timestamptz`) → PKT date via `date-fns-tz` with `Asia/Karachi`; never `new Date().getDate()` |

### 14.2 Terminal / station

| Scenario | Behavior |
|----------|----------|
| Terminal session expires (Better Auth timeout) | `scanAttendanceFn` throws redirect → browser redirects to `/login?redirect=/attendance/scan`; terminal shows gray "offline" state until re-logged |
| Terminal browser sleeps | wake-lock prevents it; if unsupported, the focus-loss listener + visible "tap to refocus" hint recovers |
| Scanner types partial string then no Enter (stuck) | input cleared on next focus/submit; no submit fires until `Enter` |
| Two employees scan back-to-back fast | each is a separate submit; 30s rule is per-employee, so B isn't blocked by A |
| Network drop mid-scan | server fn throws → gray "offline" state; the punch was not inserted (transaction rolled back); employee rescans when back online |
| Browser tab loses focus | `window.focus` listener refocuses the hidden input |
| Power loss to terminal | punches are server-side durable in Postgres; nothing in-flight on the client is authoritative |
