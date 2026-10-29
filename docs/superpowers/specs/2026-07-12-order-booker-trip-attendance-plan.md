# Order-Booker Trip-Driven Attendance — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-12-order-booker-trip-attendance-design.md`
**Date:** 2026-07-12

Build order is server-first:

1. data contract and schema safety
2. shared trip-day validation and attendance-sync logic
3. wire all trip mutation paths
4. payroll and daily-attendance semantics
5. HR manual override flow
6. dialog hardening and order-pad refactor
7. order-booker detail/log rebuild
8. regression verification

This feature must not introduce a third trip UI. The implementation must reuse and improve:

- `src/components/sales/create-trip-dialog.tsx`
- `src/components/sales/create-order-pad-dialog.tsx`

The state-of-the-art part is not more screens. It is making trips, attendance, HR overrides, and payroll agree on the same day-state rules with no hidden conflicts.

---

## Phase 1 — Schema and Shared Data Contract

**Goal:** add the minimum schema needed for trip-driven attendance and lock one trip shape used by both backoffice dialogs.

**Why first:** if server payloads and schema are inconsistent, later UI changes will create bad data.

### 1.1 Add `shopType` to `order_booker_trips`

Files:

- `src/db/schemas/sales-erp-schema.ts`
- migration generated in `src/db/migrations/`

Implementation:

- add `shopType` to `orderBookerTrips`
- allowed values:
  - `old`
  - `new`

Migration strategy:

- add the column
- backfill existing rows to `"old"` to keep dev databases valid
- then mark it required at the schema level

Do not rely on greenfield assumptions alone. Make the migration safe for existing local/dev data.

### 1.2 Extend attendance entry-source typing

Files:

- `src/db/schemas/hr-schema.ts`
- `src/components/hr/attendance/attendance-list-table.tsx`
- `src/components/hr/attendance/edit-attendance-sheet.tsx`
- `src/components/hr/attendance/edit-attendance-form.tsx`
- any typed attendance consumers

Implementation:

- extend the implicit `entrySource` domain with:
  - `order_booker_trip`

This is needed so trip-driven rows are distinguishable from:

- `manual`
- `biometric`
- `qr_terminal`

### 1.3 Normalize order-booker present-day semantics

Files:

- spec already corrected
- implementation in later phases must follow it

Rule to carry through the rest of the plan:

- any order-booker `present` day, whether trip-driven or manual-present, must store:
  - `dutyHours = employee.standardDutyHours`

This is the key safeguard that prevents hidden undertime deductions in payroll.

### 1.4 Add shared types for order-booker attendance day state

Create:

- `src/lib/attendance/order-booker-day-state.ts`

Suggested contents:

```ts
export type OrderBookerBlockingStatus =
  | "rest_day"
  | "holiday"
  | "leave"
  | "absent";

export type OrderBookerTripEligibility = {
  employeeId: string;
  orderBookerId: string;
  businessDate: string; // YYYY-MM-DD in PKT
  isRestDay: boolean;
  blockingStatus: OrderBookerBlockingStatus | null;
  hasManualAttendanceRow: boolean;
  manualStatus: "present" | "absent" | "leave" | "holiday" | null;
  existingTripCount: number;
};
```

This gives one consistent language across:

- trip create/update/delete
- HR attendance UI
- validation error mapping

### Verification gate

```bash
bun run db:generate
bun run typecheck
```

Review:

- generated migration includes `shop_type`
- no attendance entry-source type errors remain

---

## Phase 2 — Shared Server Validation and Trip-Sync Helpers

**Goal:** centralize the day-state rules so trip creation logic is identical everywhere.

**Why second:** both trip dialogs and both server mutation paths must agree on exactly the same rules.

### 2.1 Create a shared order-booker trip eligibility helper

Create:

- `src/server-functions/sales/order-booker-trip-day-state.ts`

Responsibilities:

- resolve `orderBookers.employeeId`
- load employee `restDays`, `standardDutyHours`, and status
- compute PKT business date from incoming trip timestamp/date
- detect whether the date is a rest day
- load attendance row for that employee/date
- decide whether the date is blocked by manual status:
  - `holiday`
  - `leave`
  - `absent`
- classify whether an existing attendance row is:
  - manual row
  - trip-driven row
- count existing trips on that employee/date

Return a typed result instead of throwing immediately. Throwing should happen in the mutation wrapper so UI-facing errors stay clear.

### 2.2 Create a shared trip-driven attendance sync helper

Create:

- `src/server-functions/sales/order-booker-trip-sync.ts`

Suggested API:

```ts
export async function syncOrderBookerAttendanceForDate(args: {
  tx: DbTransaction;
  employeeId: string;
  orderBookerId: string;
  businessDate: string;
  standardDutyHours: number;
}): Promise<void>;
```

Behavior:

- query remaining trips for `(orderBookerId, businessDate)`
- load existing attendance row for `(employeeId, businessDate)`
- if manual row exists:
  - do nothing
- if trip count > 0 and no manual row:
  - upsert `attendance` as:
    - `status = "present"`
    - `entrySource = "order_booker_trip"`
    - `checkIn = null`
    - `checkOut = null`
    - `dutyHours = standardDutyHours`
    - `isLate = false`
    - `isNightShift = false`
    - `overtimeHours = "0.00"`
    - `overtimeStatus = "pending"`
    - `earlyDepartureStatus = "none"`
- if trip count = 0 and existing row is trip-driven:
  - delete the attendance row
- if trip count = 0 and existing row is manual:
  - do nothing

### 2.3 Create a shared manual-row classifier

Keep the manual-vs-auto rule explicit in one place.

Suggested helper:

```ts
export function isManualOrderBookerAttendanceRow(
  row: Pick<typeof attendance.$inferSelect, "entrySource"> | null | undefined,
): boolean;
```

Rule:

- `entrySource === "manual"` means manual override
- `entrySource === "order_booker_trip"` means auto trip-driven row

Do not infer this from remarks or status.

### 2.4 Add an optional preview server function for better dialog UX

Create:

- `src/server-functions/sales/get-order-booker-trip-eligibility-fn.ts`

Purpose:

- when `orderBookerId` or trip date changes in either dialog, UI can ask the server:
  - is this date allowed?
  - if not, why?

This avoids “submit and fail” UX on obvious blocked days.

Return:

- `isAllowed`
- `reason`
- `businessDate`
- `existingTripCount`
- `manualStatus`
- `isRestDay`

### Verification gate

Add tests:

- `src/server-functions/sales/order-booker-trip-day-state.test.ts`
- `src/server-functions/sales/order-booker-trip-sync.test.ts`

Cover:

- rest-day detection
- manual leave/holiday/absent blocking
- manual present allowed
- trip-driven present row creation
- last-trip deletion removes auto row
- manual row survives sync untouched

Run:

```bash
bun run test src/server-functions/sales/order-booker-trip-day-state.test.ts src/server-functions/sales/order-booker-trip-sync.test.ts
```

---

## Phase 3 — Wire Trip Mutations End to End

**Goal:** make every backoffice trip mutation enforce the same rules and keep attendance synced inside the same transaction.

**Why third:** this is where the business rule becomes real.

### 3.1 Harden `createOrderBookerTripFn`

File:

- `src/server-functions/sales/order-booker-trips-fn.ts`

Changes:

- require `shopType`
- run day-state validation before insert
- reject blocked dates with clear errors
- after insert, call `syncOrderBookerAttendanceForDate(...)` in the same transaction

### 3.2 Harden `updateOrderBookerTripFn`

File:

- `src/server-functions/sales/order-booker-trips-fn.ts`

Changes:

- support `shopType` updates
- if trip date changes:
  - validate new target date first
  - move the trip
  - sync old date
  - sync new date
- if trip stays on same date:
  - update trip
  - resync same date

This phase must explicitly handle “old date lost its last trip” with no hidden stale present row.

### 3.3 Harden `deleteOrderBookerTripFn`

File:

- `src/server-functions/sales/order-booker-trips-fn.ts`

Changes:

- load the trip before delete
- delete it
- resync its business date in the same transaction

### 3.4 Harden `createOrderFn`

File:

- `src/server-functions/sales/orders-fn.ts`

Changes:

- require `shopType` in inline `trip`
- validate inline trip with the same helper as `createOrderBookerTripFn`
- create the trip and order in one transaction
- sync attendance immediately after trip creation in the same transaction

Important:

- do not add “attach to existing trip”
- each order-pad submission still creates a fresh new trip row

### 3.5 Keep order-linked and empty-trip rows identical

After this phase, the inserted trip shape from:

- `create-trip-dialog.tsx`
- `create-order-pad-dialog.tsx`

must match on all shared fields:

- `tripDate`
- `destination`
- `shopType`
- `distanceKm`
- `vehicleType`
- `fuelCost`
- `notes`

### Verification gate

Add/extend:

- `src/server-functions/sales/order-booker-trips-fn.test.ts`
- `src/server-functions/sales/orders-fn.test.ts`

Cover:

- create trip on working day => attendance auto present
- create trip on blocked day => rejected
- update trip date => old/new dates both recomputed
- delete last trip => auto present removed
- create order with inline trip => trip + order + attendance sync all succeed together

Run:

```bash
bun run test src/server-functions/sales/order-booker-trips-fn.test.ts src/server-functions/sales/orders-fn.test.ts
```

---

## Phase 4 — Payroll and Daily Attendance Semantics

**Goal:** make trip-driven order-booker presence visible to HR and enforce pending-day payroll blocking without reintroducing punch-based logic.

**Why fourth:** the server mutation truth is in place by now, so the reads can safely rely on it.

### 4.1 Include order bookers in daily attendance data

File:

- `src/server-functions/hr/attendance/get-daily-attendance-fn.ts`

Current problem:

- order bookers are filtered out entirely

Changes:

- include active/on-leave order bookers in the HR attendance dataset
- keep salesmen excluded unless a separate future design changes them
- continue returning standard-staff punch data only for punch-driven employees
- for order bookers, no punch requirement and no punch fetch needed

### 4.2 Update HR attendance screen semantics

Files:

- `src/components/hr/attendance/attendance-container.tsx`
- `src/components/hr/attendance/attendance-list-table.tsx`

Changes:

- order-booker tab should now receive real rows
- compute display states as:
  - rest day => `Rest Day`
  - attendance row exists => use saved status
  - no attendance row on working day => `Pending / Review`

Do not infer trip existence directly in the table if attendance sync already guarantees it through `attendance`.

### 4.3 Remove blanket payroll skip for order bookers

File:

- `src/server-functions/hr/payroll/core.ts`

Current problem:

- payroll currently skips missing-attendance blocking for order bookers

Changes:

- keep salesmen excluded if that existing business rule still stands
- stop treating order bookers as fully excluded from attendance validation
- let `unmarkedDays` block payroll for unresolved order-booker working days

### 4.4 Ensure order-booker present rows do not trigger short-hours deductions

Files:

- trip sync helper from Phase 2
- manual HR save logic in later phases
- verify `calculatePayslip` behavior through tests

Key rule:

- any order-booker `present` day must store `dutyHours = standardDutyHours`

This avoids:

- undertime deductions
- short-shift deductions
- late/early side effects from zero-hour rows

### Verification gate

Add/extend:

- `src/lib/hr-payroll-regressions.test.ts`
- `src/lib/hr-payroll-calculator.test.ts`

Cover:

- trip-driven present day behaves as full present day in payroll
- unresolved working day blocks order-booker payroll
- manual absent/leave/holiday continue to behave as expected

Run:

```bash
bun run test src/lib/hr-payroll-regressions.test.ts src/lib/hr-payroll-calculator.test.ts
```

---

## Phase 5 — HR Manual Override Flow

**Goal:** allow HR to resolve no-trip days safely without ever conflicting with real trip-driven present days.

**Why fifth:** this depends on the attendance row now being trustworthy.

### 5.1 Extend attendance edit server rules

File:

- `src/server-functions/hr/attendance/upsert-attendance-fn.ts`

Changes for order bookers:

- if one or more trips exist on that date:
  - reject manual changes to `absent`, `leave`, or `holiday`
- if no trip exists:
  - allow `present`, `absent`, `leave`, `holiday`
- if manual `present` with no trip:
  - require non-empty remarks
- if manual `present` with no trip:
  - set `dutyHours = standardDutyHours`
  - set non-punch flags to safe defaults

### 5.2 Add clear-manual-override action

Create:

- `src/server-functions/hr/attendance/clear-order-booker-manual-override-fn.ts`

Behavior:

- only valid for order bookers
- only valid for manual rows
- if trips exist:
  - delete manual row
  - resync date => trip-driven present
- if no trips exist:
  - delete manual row
  - day becomes pending/review

### 5.3 Tighten client validator/UI contract

Files:

- `src/lib/validators/hr-validators.ts`
- `src/components/hr/attendance/edit-attendance-form.tsx`
- `src/components/hr/attendance/edit-attendance-sheet.tsx`

Changes:

- add explicit support for order-booker manual present remark requirement
- disable non-present choices when trips exist
- show why status is locked
- show `Return to Trip-Driven Status` only for manual order-booker rows

### 5.4 Keep the form simple for order bookers

Order-booker attendance editing should not expose:

- punch timeline
- OT
- late
- early leave
- night shift

The form should focus on:

- status
- leave type
- remarks
- manual override reset

### Verification gate

Add/extend:

- `src/components/hr/attendance/edit-attendance-form.behavior.test.tsx`
- `src/server-functions/hr/attendance/upsert-attendance-fn.test.ts`
- `src/server-functions/hr/attendance/clear-order-booker-manual-override-fn.test.ts`

Cover:

- manual present with no trip requires remark
- manual absent/leave/holiday blocked when trip exists
- clear manual override restores trip-driven present
- clear manual override with no trip restores pending/review

Run:

```bash
bun run test src/components/hr/attendance/edit-attendance-form.behavior.test.tsx src/server-functions/hr/attendance/upsert-attendance-fn.test.ts src/server-functions/hr/attendance/clear-order-booker-manual-override-fn.test.ts
```

---

## Phase 6 — Dialog Hardening and Order Pad Refactor

**Goal:** improve the existing trip/order dialogs instead of replacing them.

**Why sixth:** the server contracts are stable now, so the client can be cleaned up against a fixed backend.

### 6.1 Create shared trip field model for both dialogs

Create:

- `src/lib/sales/order-booker-trip-form.ts`

Suggested contents:

- shared zod schema for client-side trip form
- shared defaults
- shared error mapping helpers

Used by:

- `src/components/sales/create-trip-dialog.tsx`
- `src/components/sales/create-order-pad-dialog.tsx`

### 6.2 Improve `create-trip-dialog.tsx`

File:

- `src/components/sales/create-trip-dialog.tsx`

Changes:

- add `shopType`
- use shared trip schema/defaults
- optionally query `getOrderBookerTripEligibilityFn` when booker/date changes
- disable submit with inline reason if blocked
- keep the dialog small and fast

### 6.3 Refactor `create-order-pad-dialog.tsx`

File:

- `src/components/sales/create-order-pad-dialog.tsx`

Approved direction:

- improve in place
- do not replace with a new UI

Refactor into focused internal components:

- `OrderPadHeaderSection`
- `OrderPadTripSection`
- `OrderPadItemsSection`
- `OrderPadSummarySection`

Performance work:

- narrow `useStore` selectors so trip and item changes do not rerender the whole dialog
- stop broad effects from scanning the full item array unnecessarily
- keep rate auto-population localized per line
- reduce repeated derived calculations in render

UX work:

- better field error messages
- add `shopType`
- align trip section with empty-trip dialog
- preserve “new order creates new trip” behavior

### 6.4 Add client regression coverage

Add/extend:

- `src/components/sales/create-trip-dialog.test.tsx`
- `src/components/sales/create-order-pad-dialog.test.tsx`

Cover:

- both dialogs require `destination`
- both dialogs require `shopType`
- both dialogs allow `distanceKm = 0`
- blocked-day state disables or rejects submit cleanly

### Verification gate

```bash
bun run test src/components/sales/create-trip-dialog.test.tsx src/components/sales/create-order-pad-dialog.test.tsx
bun run typecheck
```

Manual QA:

- no obvious lag when editing trip fields or multiple order lines
- rate auto-population still works
- order submit still creates both order and trip

---

## Phase 7 — Order-Booker Detail/Log Rebuild

**Goal:** stop relying on overloaded attendance snapshot fields for order-booker activity history.

**Why seventh:** trip and attendance sync are stable now, so logs can be rebuilt on real sources.

### 7.1 Introduce a trip/order-backed daily activity query

Create:

- `src/server-functions/hr/attendance/get-order-booker-activity-log-fn.ts`

Responsibilities:

- load attendance rows for status only
- load trips grouped by day
- load orders linked through `tripId`
- compute daily totals:
  - trip count
  - total distance
  - total fuel
  - total TA/DA
  - total order value
  - order count
  - shop mix if useful (`old` vs `new`)

### 7.2 Rebuild order-booker log screen on that query

Files:

- `src/components/hr/attendance/order-booker-attendance-log.tsx`
- `src/components/hr/attendance/order-booker-log-view.tsx`
- related route loader file

Changes:

- daily status comes from attendance/rest-day logic
- marketing/travel/commercial detail comes from trips/orders
- remove dependence on legacy attendance snapshot fields for per-day reporting

### 7.3 Keep attendance log understandable

The rebuilt log should let HR understand:

- was the day present / pending / leave / holiday / rest day
- how many trips happened
- whether shops were old/new
- what distance/fuel/TA happened
- whether any orders were booked

### Verification gate

Add:

- `src/server-functions/hr/attendance/get-order-booker-activity-log-fn.test.ts`
- `src/components/hr/attendance/order-booker-attendance-log.test.tsx`

Cover:

- present day with empty trip
- present day with order-linked trip
- pending day with no trip
- rest day
- holiday/manual leave day

---

## Phase 8 — Final Regression Sweep and Build Verification

**Goal:** prove the feature works end to end and did not break the existing attendance/payroll/order flows.

### 8.1 Add cross-feature regression tests

Create:

- `src/lib/order-booker-trip-attendance-regressions.test.ts`

Source-inspection or targeted logic coverage should assert:

- no separate trip UI was introduced
- both trip flows require `shopType`
- payroll no longer skips unresolved order-booker days
- trip sync helper is used by both trip server paths and order creation

### 8.2 Re-run affected attendance/payroll suites

Recommended command set:

```bash
bun run test src/lib/hr-payroll-regressions.test.ts
bun run test src/lib/hr-payroll-calculator.test.ts
bun run test src/lib/order-booker-trip-attendance-regressions.test.ts
bun run test src/server-functions/sales/order-booker-trips-fn.test.ts
bun run test src/server-functions/sales/orders-fn.test.ts
bun run test src/server-functions/hr/attendance/upsert-attendance-fn.test.ts
```

### 8.3 Full project verification

Run:

```bash
bun run typecheck
bun run build
```

Optional but recommended manual QA scenarios:

1. Create empty trip on working day -> order booker becomes present
2. Delete last trip -> day becomes pending/review
3. Mark no-trip day as manual present with remark -> payroll treats as full day
4. Try trip on rest day -> blocked
5. Create order via order pad -> linked fresh trip + present day
6. Manual leave day -> trip creation blocked
7. Clear manual override -> returns to trip-driven or pending correctly

---

## Final Notes

- Do not create a new trip screen.
- Do not attach orders to existing trips.
- Do not keep using attendance snapshot marketing fields as the main order-booker log model.
- Do not allow order-booker present rows to store `dutyHours = 0`.

The safest delivery path is:

- make server rules authoritative first
- let attendance become a stable trip-driven read model
- then improve the dialogs and logs on top of that stable foundation
