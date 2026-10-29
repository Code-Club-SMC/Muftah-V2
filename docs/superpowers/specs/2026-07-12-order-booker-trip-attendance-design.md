# Order-Booker Trip-Driven Attendance — Design Spec

**Date:** 2026-07-12
**Status:** Approved
**Scope:** Backoffice HR/Sales operator flow only. Self-portal is explicitly out of scope for this design.

---

## 1. Overview

Order bookers do not use punch-based attendance. Their daily presence is driven by trip activity:

- if at least one valid trip exists on a working day, the order booker is `present`
- if no trip exists on a working day and HR has not manually marked the day, the day is `pending/review`
- trips are not allowed on rest days
- trips are not allowed on dates manually marked as `holiday`, `leave`, or `absent`

This design reuses the existing trip-entry surfaces instead of introducing parallel UIs:

- `src/components/sales/create-trip-dialog.tsx` remains the no-order visit flow
- `src/components/sales/create-order-pad-dialog.tsx` remains the order + trip flow

Both flows must write the same trip model and must participate in the same attendance sync rules.

---

## 2. Current State Analysis

The current codebase has the pieces needed for this feature, but they are not connected correctly.

### 2.1 What already exists

- Order bookers are tracked as HR employees with `isOrderBooker = true`.
- Backoffice users can already create order-booker trips through:
  - `src/components/sales/create-trip-dialog.tsx`
  - `src/components/sales/create-order-pad-dialog.tsx`
- Trips are stored in `order_booker_trips`.
- Payroll already reads `order_booker_trips` for TA/DA and commission.
- HR attendance already has a separate order-booker tab and a separate order-booker detail/log route.

### 2.2 Current problems

- `getDailyAttendanceFn` excludes order bookers from the daily attendance dataset, so the HR attendance page is not truly trip-driven today.
- Trip creation does not sync attendance presence.
- `pending/review` does not exist as a real business state yet. There is no explicit system rule for unresolved working days.
- The order-booker detail/log UI currently reads old attendance snapshot fields like `areaVisited`, `saleAmount`, `recoveryAmount`, and `petrolAmount`.
- Those attendance snapshot fields are not the right source of truth for a multi-trip, multi-order day.
- `create-order-pad-dialog.tsx` currently includes embedded trip fields and creates a trip inline, but it is heavy, sluggish, and overly coupled.

### 2.3 Design conclusion from current state

The correct source of truth split is:

- `attendance` = daily status read model for HR and payroll
- `order_booker_trips` = operational trip source
- `orders` and their links = commercial activity source

This design keeps that split clear and removes the old assumption that order-booker marketing details should live inside one attendance row.

---

## 3. Locked Business Rules

These rules were explicitly approved during design.

### 3.1 Presence rules

- Order bookers are not punch-based.
- A working day becomes `present` when at least one valid trip exists for that employee on that day.
- A working day with no trip and no manual attendance row is shown as `pending/review`.
- `pending/review` is a UI/computed state, not a new DB attendance status.

### 3.2 Empty trip meaning

An “empty trip” does **not** mean a blank trip.

It means:

- the order booker did make a real field visit
- but no order was booked on that visit

Therefore:

- trip `destination/area` stays required
- trip `shopType` is required
- trip `distanceKm` may be `0`

### 3.3 Shop type

Every trip must capture:

- `old`
- `new`

This applies to both:

- no-order trips from `create-trip-dialog`
- order-linked trips from `create-order-pad-dialog`

### 3.4 Rest days and holidays

- Trips cannot exist on an employee rest day.
- Trips cannot exist on a manually marked holiday.
- The ERP does not currently have a global holiday engine.
- `holiday` remains an HR-marked status only.
- `holiday` means public/company holiday, for example Eid holidays.

### 3.5 Leave rules

- `leave` remains a normal attendance status.
- `special leave` remains a leave type under `leave`.
- Trips cannot be created on a day manually marked `leave`.

### 3.6 Manual attendance rules

If no trip exists for a working day, HR/operator may manually mark:

- `present`
- `absent`
- `leave`
- `holiday`

If HR/operator marks `present` without any trip:

- a reason/remark is required

### 3.7 Trip conflict rules

If one or more trips already exist on a date:

- that date is locked to `present`
- HR cannot manually change it to `absent`, `leave`, or `holiday`
- if the trip is wrong, the trip must be edited or deleted first

### 3.8 Manual override precedence

Manual decisions win over auto-sync.

This means:

- if a date has a manual attendance row, trip sync must not overwrite it
- this includes manual `present`, manual `absent`, manual `leave`, and manual `holiday`

To return control back to trip sync, HR uses:

- `Return to Trip-Driven Status`

That action:

- removes the manual override
- recalculates from current trips
- if trips exist, the date becomes trip-driven `present`
- if no trips exist, the date becomes `pending/review`

### 3.9 No-trip working days

If a working day has no trip and no manual row:

- the UI shows `pending/review`
- payroll must not silently ignore it
- payroll should block until the day is resolved

---

## 4. Recommended Architecture

### 4.1 Core model

Use trip-sync attendance rows.

That means:

- trips remain the source event
- attendance remains the daily read model
- attendance rows for order bookers are created or removed automatically from trip activity

This is preferred over live on-the-fly derivation because:

- payroll already reads `attendance`
- HR screens already read `attendance`
- reporting remains consistent
- fewer hidden query mismatches

### 4.2 Source-of-truth boundaries

- `order_booker_trips` is the source of truth for visit activity
- `attendance` is the source of truth for daily status after sync
- `orders` are the source of truth for booked commercial work
- order-booker detail pages must read trip/order data directly for marketing data, not legacy attendance snapshot fields

### 4.3 No new trip UIs

The design must reuse the current dialogs:

- `src/components/sales/create-trip-dialog.tsx`
- `src/components/sales/create-order-pad-dialog.tsx`

The work is:

- unify their trip data contract
- improve their UX and performance
- fix validation and blocking logic

It is **not**:

- adding a third parallel trip-entry modal
- building a separate order-booker attendance trip form

---

## 5. Data Model Changes

### 5.1 `order_booker_trips`

Add required trip metadata needed by the new business rule.

Add:

- `shopType` with values:
  - `old`
  - `new`

Keep:

- `destination` required
- `distanceKm` nonnegative
- `vehicleType`
- `fuelCost`
- `tadaAmount`
- `notes`

### 5.2 `attendance`

Do not add a new `pending` attendance status.

`pending/review` means:

- working day
- no trip
- no manual row

Use `entrySource` to distinguish order-booker auto-sync rows:

- `order_booker_trip`

Manual order-booker rows stay:

- `manual`

No punch-oriented fields are meaningful for order-booker trip presence:

- `checkIn = null`
- `checkOut = null`
- `dutyHours = employee.standardDutyHours`
- `isLate = false`
- `isNightShift = false`
- `overtimeHours = 0`
- `earlyDepartureStatus = "none"`

Reason:

- order bookers are non-punch-based
- a valid trip-based `present` day should count as a full present day for salary attendance purposes
- this avoids accidental short-hours or undertime deductions in payroll

### 5.3 Legacy attendance marketing fields

The existing order-booker fields on `attendance`:

- `areaVisited`
- `isCompanyVehicle`
- `paymentMode`
- `distanceKm`
- `perKmRate`
- `petrolAmount`
- `saleAmount`
- `recoveryAmount`
- `returnAmount`
- `shopType`
- `slipNumbers`

should not be treated as the long-term source of truth for this feature.

Reason:

- one attendance row cannot faithfully represent a multi-trip day
- one attendance row cannot faithfully represent multiple orders on one day
- daily marketing detail belongs to trips/orders, not attendance status

Design decision:

- attendance sync uses `attendance` only for daily status
- order-booker logs and summaries should move to trip/order sources

---

## 6. Trip Validation Rules

Every trip create/update path must enforce the same rule set.

### 6.1 Required fields

For both dialogs:

- order booker
- date
- destination / area
- shop type

### 6.2 Allowed values

- `distanceKm >= 0`
- `distanceKm = 0` is allowed
- notes optional
- vehicle type remains current behavior
- fuel cost remains current behavior

### 6.3 Blocked dates

Trip creation or trip date-change must be rejected when the target employee/date is:

- a rest day
- manually marked `holiday`
- manually marked `leave`
- manually marked `absent`

### 6.4 Allowed dates

Trip creation is allowed when:

- it is a normal working day
- there is no blocking manual non-present row
- or there is a manual `present` row

If a manual `present` row already exists and a trip is later added:

- trip creation is allowed
- attendance status remains `present`
- the manual row is preserved unless HR explicitly clears it with `Return to Trip-Driven Status`

### 6.5 Error messaging

Errors must be direct and operator-friendly, for example:

- `Trip cannot be logged on this employee's rest day`
- `This date is marked as holiday. Clear the manual status first`
- `This date is marked as leave. Clear the manual status first`
- `This date is marked as absent. Clear the manual status first`

---

## 7. Attendance Sync Lifecycle

Trip sync must run for all backoffice trip mutations.

### 7.1 On trip create

When a trip is created:

1. Resolve the linked HR employee through `orderBooker.employeeId`
2. Convert the trip date to PKT business date
3. Validate the date is allowed
4. Check whether a manual attendance row already exists
5. If a manual row exists:
   - do not overwrite it
   - keep the trip
   - leave the row as-is
6. If no manual row exists:
   - upsert `attendance` as trip-driven `present`
   - set `entrySource = order_booker_trip`

### 7.2 On trip update

Trip updates must recompute attendance safely.

If the trip stays on the same date:

- keep the day `present`
- only touch trip-driven rows
- never overwrite manual rows

If the trip moves to a new date:

- recompute the old date
- recompute the new date
- validate the new date before commit

### 7.3 On trip delete

When a trip is deleted:

- if other trips still exist on that employee/date, keep the date `present`
- if it was the last trip:
  - if the attendance row is trip-driven, delete that row so the day becomes `pending/review`
  - if the attendance row is manual, keep the manual row untouched

### 7.4 Transaction rule

Trip write and attendance sync must run in the same transaction.

This applies to:

- `createOrderBookerTripFn`
- `updateOrderBookerTripFn`
- `deleteOrderBookerTripFn`
- inline trip creation inside `createOrderFn`

---

## 8. Shared Backoffice Trip Contract

Two existing flows create trips today:

- empty/no-order trip via `create-trip-dialog.tsx`
- order-linked trip via `create-order-pad-dialog.tsx`

They must write the same trip shape.

### 8.1 Contract

Shared trip fields:

- `tripDate`
- `destination`
- `shopType`
- `distanceKm`
- `vehicleType`
- `fuelCost`
- `notes`

### 8.2 Order-linked trips

`create-order-pad-dialog.tsx` must continue to create a brand-new trip per submitted order.

Approved rule:

- no “attach to existing trip” behavior
- each order-pad submission creates its own new trip row

This matches the current operator mental model and avoids complex trip-attachment flows.

---

## 9. UI Behavior

### 9.1 HR daily attendance screen

Order bookers should appear in the HR attendance page as real data, not as an empty tab.

On a normal working day:

- trip exists => `Present`
- no trip and no manual row => `Pending / Review`

On a rest day:

- `Rest Day`

On manually marked day with no trip:

- `Present`
- `Absent`
- `Leave`
- `Holiday`

If a trip exists that day:

- show the day as locked to `Present`
- disable non-present manual statuses
- show helper text explaining that the trip must be corrected first

### 9.2 Manual edit behavior

If no trip exists, HR/operator may edit the day.

If `Present` is selected without trip:

- `remarks` is required

If `Leave` is selected:

- leave type is required
- includes `Special Leave`

### 9.3 Manual override UX

Manual rows should be clearly labeled, for example:

- `Manual Override`

Manual rows should expose:

- `Return to Trip-Driven Status`

This action is only meaningful on manual rows.

### 9.4 Trip entry dialogs

#### `src/components/sales/create-trip-dialog.tsx`

Keep it as the no-order visit dialog.

Required improvements:

- add `shopType`
- add date-blocking validation and clear error states
- preserve the simple small-dialog flow

#### `src/components/sales/create-order-pad-dialog.tsx`

Keep it as the order + trip dialog.

Required improvements:

- add `shopType`
- align trip field rules with `create-trip-dialog.tsx`
- fix current sluggishness
- improve validation clarity
- improve structure without replacing the feature with a new UI

### 9.5 Order-booker detail/log pages

The order-booker detail/log views should no longer depend on old attendance snapshot fields for sales/travel detail.

They should be rebuilt around:

- trips
- orders linked through `tripId`
- real TA/DA
- real order totals

Attendance should supply daily status only.

---

## 10. `create-order-pad-dialog.tsx` Refactor Direction

This dialog is explicitly called out as buggy, sluggish, and poor UX.

The design direction is to improve it in place.

### 10.1 Problems to address

- too much state lives in one component
- trip data and order-line data are tightly coupled
- many recalculations happen across the entire form
- error messages are not precise enough

### 10.2 Approved direction

Refactor into focused sections/components:

- order header
- trip section
- item lines
- summary

Use shared trip validation/state rules between:

- `create-trip-dialog.tsx`
- `create-order-pad-dialog.tsx`

Performance goal:

- no obvious lag during normal typing, line edits, or product/recipe changes

This is a UX hardening task, not a redesign into a new workflow.

---

## 11. Payroll Impact

### 11.1 What stays the same

Order bookers remain non-punch-based.

They do not use:

- late arrival
- undertime
- early leave
- night shift
- overtime

TA/DA and commission continue to come from:

- `order_booker_trips`
- commission records

For salary attendance math:

- any order-booker `present` row, whether trip-driven or manual-present, should behave like a full present day
- this means `dutyHours` must be normalized to the employee's standard duty hours instead of `0`

### 11.2 What changes

Payroll must stop silently ignoring unresolved working days for order bookers.

If a working day has:

- no trip
- no manual attendance row

then that day is `pending/review`, and payroll should block until resolved.

This avoids paying with hidden missing-day ambiguity.

---

## 12. Server Design

### 12.1 Shared trip validation helper

Create a shared server-side validation path so every trip mutation uses identical business rules.

Suggested responsibilities:

- resolve linked employee
- compute PKT business date
- check rest day
- check blocking manual attendance row

### 12.2 Shared trip-sync helper

Create a shared transaction-safe helper to sync order-booker attendance from trip mutations.

Suggested responsibilities:

- inspect remaining trip count for employee/date
- upsert trip-driven `present`
- delete trip-driven row when last trip is removed
- ignore manual rows

### 12.3 `createOrderFn`

`createOrderFn` currently creates an inline trip itself.

Under this design it must:

- use the same shared trip rules as `createOrderBookerTripFn`
- include `shopType`
- run attendance sync in the same transaction as trip + order creation

### 12.4 `updateOrderBookerTripFn`

If trip date changes:

- validate the new target date
- recompute old date
- recompute new date

This is a mandatory regression guard.

---

## 13. Testing Requirements

Add targeted regression coverage for the approved rules.

### 13.1 Trip sync

- trip on working day auto-marks `present`
- deleting the last trip returns the day to `pending/review`
- same-day second trip keeps one `present` status
- trip date edit recomputes both old and new dates

### 13.2 Blocking rules

- trip blocked on rest day
- trip blocked on manual `holiday`
- trip blocked on manual `leave`
- trip blocked on manual `absent`

### 13.3 Manual attendance

- manual `present` without trip requires remark
- manual row is not overwritten by trip sync
- `Return to Trip-Driven Status` works with and without trips

### 13.4 Dialog contract

- `create-trip-dialog.tsx` and `create-order-pad-dialog.tsx` both submit the same required trip fields
- both require `shopType`
- both allow `distanceKm = 0`

### 13.5 Payroll

- unresolved order-booker working day blocks payroll
- trip-driven `present` counts as resolved attendance

---

## 14. Non-Goals

This design does not include:

- self-portal redesign
- global holiday calendar engine
- trip attachment to existing trips from order-pad
- punch logic for order bookers
- using legacy attendance marketing snapshot fields as the primary long-term model

---

## 15. Final Recommendation

Implement order-booker attendance as trip-driven attendance rows backed by the existing trip system.

Do not add new trip-entry UIs.

Instead:

- strengthen the two current dialogs
- unify their trip contract
- add required `shopType`
- sync attendance automatically from trip mutations
- make payroll block unresolved pending/review days
- move order-booker detail reporting toward trip/order sources instead of overloaded attendance snapshot fields

This is the lowest-risk design that fits the current ERP shape and the client’s business rule.
