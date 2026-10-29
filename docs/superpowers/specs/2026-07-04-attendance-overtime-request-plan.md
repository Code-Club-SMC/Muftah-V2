# Attendance Overtime Request — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-04-attendance-overtime-request-design.md`
**Date:** 2026-07-04

Build order is bottom-up:

1. pure overtime request logic
2. attendance save enforcement
3. punch-change revalidation
4. operator form UX
5. admin approval hardening
6. payroll/regression verification

This feature should be implemented without schema changes. The current `attendance` table already has the fields we need:

- `dutyHours`
- `overtimeHours`
- `overtimeStatus`
- `overtimeRemarks`

The state-of-the-art part is not “more tables.” It is making punch truth, operator request, admin approval, and payroll all agree with each other at every step.

---

## Phase 1 — Pure Overtime Request Domain Layer

**Goal:** centralize suggested OT math and stale-request rules into pure functions before touching server functions or UI.

**Why first:** the same rules must be reused by:

- attendance save
- punch recompute
- approvals query
- approval action
- operator UI

### 1.1 Create `src/lib/attendance/overtime-request.ts`

Add a small pure module with typed helpers:

```ts
export type OvertimeRequestState =
  | "none"
  | "valid"
  | "soft_mismatch"
  | "stale";

export type OvertimeRequestSummary = {
  standardDutyHours: number;
  workedDutyHours: number;
  suggestedOvertimeHours: number;
  requestedOvertimeHours: number;
  state: OvertimeRequestState;
  warning: string | null;
};

export function calculateSuggestedOvertimeHours(
  dutyHours: string | number | null | undefined,
  standardDutyHours: number | null | undefined,
): number;

export function normalizeRequestedOvertimeHours(
  overtimeHours: string | number | null | undefined,
): number;

export function buildOvertimeRequestSummary(args: {
  dutyHours: string | number | null | undefined;
  standardDutyHours: number | null | undefined;
  requestedOvertimeHours: string | number | null | undefined;
}): OvertimeRequestSummary;
```

Rules in this module:

- `suggested OT = max(0, worked - standard)`
- `requested <= 0 && suggested <= 0` → `none`
- `requested > suggested` → `stale`
- `requested > 0 && requested < suggested` → `soft_mismatch`
- `requested > 0 && requested <= suggested` → `valid`

Warnings returned here should be the same plain-English strings the UI shows.

### 1.2 Add unit tests

Create:

- `src/lib/attendance/overtime-request.test.ts`

Cover:

- 10h worked, 8h standard → `2h suggested`
- requested = suggested → `valid`
- requested lower than suggested → `soft_mismatch`
- requested higher than suggested → `stale`
- suggested = 0 → `none`
- null/empty inputs normalize safely to `0`

### Verification gate

```bash
bun run test src/lib/attendance/overtime-request.test.ts
```

---

## Phase 2 — Attendance Save Enforcement

**Goal:** make the server the final source of truth for OT request validity.

**Why second:** the UI can guide users, but only the server can stop invalid OT from being stored.

### 2.1 Keep schema validation simple, move context-aware rules server-side

File:

- `src/lib/validators/hr-validators.ts`

Keep the current generic rule:

- OT remarks required when `overtimeHours > 0`

Do **not** try to add “requested OT must be <= suggested OT” here, because that rule depends on:

- recomputed punch-driven `dutyHours`
- employee `standardDutyHours`

That belongs in the server function, not the plain zod schema.

### 2.2 Harden `upsertAttendanceFn`

File:

- `src/server-functions/hr/attendance/upsert-attendance-fn.ts`

For punch-driven present standard-staff rows:

1. recompute the attendance row first
2. derive `suggestedOvertimeHours` from recomputed `dutyHours` and employee `standardDutyHours`
3. normalize submitted requested OT
4. reject save if requested OT is greater than suggested OT
5. if requested OT is `0`:
   - save `overtimeHours = "0.00"`
   - clear `overtimeRemarks`
   - normalize status to non-payable default
6. if requested OT is greater than `0`:
   - keep `overtimeStatus = "pending"` on save
   - save remarks

For non-present rows:

- clear OT fields

For order bookers / non-punch-driven paths:

- leave current logic unchanged unless the product later extends OT to them

### 2.3 Return enough data for UI refresh

When `upsertAttendanceFn` returns the saved row, ensure the client can immediately reflect:

- saved requested OT
- saved OT remarks
- saved OT status

No extra API needed yet if the existing payload already includes these.

### Verification gate

Add or extend:

- `src/server-functions/hr/attendance/upsert-attendance-fn.test.ts`

Cases:

- 10h duty, 8h standard, requested 2h → save succeeds
- 10h duty, 8h standard, requested 3h → save fails
- requested OT > 0 without remarks → save fails
- requested OT = 0 → remarks cleared
- non-present row clears OT fields

Run:

```bash
bun run test src/server-functions/hr/attendance/upsert-attendance-fn.test.ts
```

---

## Phase 3 — Punch Recompute and Stale Request Revalidation

**Goal:** make punch edits automatically re-check OT requests and invalidate stale approvals safely.

**Why third:** this is the integrity core. Without this, old OT requests drift away from punch truth.

### 3.1 Extend recompute server flow

File:

- `src/lib/attendance/recompute-server.ts`

After `computeAttendanceFromPunches(...)` and before upserting the attendance row:

1. calculate `suggestedOvertimeHours`
2. inspect existing `overtimeHours`
3. build overtime request summary
4. if request state is `stale`:
   - keep requested OT hours
   - keep remarks
   - force `overtimeStatus = "pending"`
5. if request is still valid or soft mismatch:
   - preserve existing OT status

Important:

- do **not** silently reduce requested OT
- do **not** delete the operator’s remarks
- do **not** keep `approved` if punches now make the request stale

That preserves auditability and forces human review.

### 3.2 Make punch mutations reuse this automatically

Files already calling `recomputeAttendanceRow(...)`:

- `src/server-functions/hr/attendance/manual-punches-fn.ts`
- `src/server-functions/hr/attendance/scan-attendance-fn.ts`
- any other punch-driven recompute paths

Because they already flow through `recomputeAttendanceRow`, this phase should mostly be implemented once in `recompute-server.ts`, not copied into each mutation handler.

### 3.3 Define one stable warning source

Add helper output or a small adapter so the same stale/mismatch wording can be reused in:

- edit form
- approvals list
- future API consumers

### Verification gate

Add or extend tests around punch-driven recompute:

- `src/server-functions/hr/attendance/manual-punches-fn.test.ts`
- `src/server-functions/hr/attendance/scan-attendance-fn.test.ts`

Cases:

- approved 2h OT becomes pending after punch correction reduces suggestion to 1h
- requested 2h remains valid when suggestion rises to 3h
- request and remarks survive recompute

Run:

```bash
bun run test src/server-functions/hr/attendance/manual-punches-fn.test.ts src/server-functions/hr/attendance/scan-attendance-fn.test.ts
```

---

## Phase 4 — Operator Form UX

**Goal:** make the HR/operator path fast, obvious, and hard to misuse.

**Why fourth:** once the server rules are safe, the form can become smart without risking bad data.

### 4.1 Add suggested OT to the edit form

File:

- `src/components/hr/attendance/edit-attendance-form.tsx`

For punch-driven present standard staff:

- compute local suggested OT from:
  - punch-driven `dutyHours`
  - `employee.standardDutyHours`
- show:
  - `Worked Hours`
  - `Standard Hours`
  - `Suggested OT`

This should be a read-only summary area near the OT input.

### 4.2 Prefill requested OT once, not on every render

The form should prefill `Requested OT Hours` from `Suggested OT` only when:

- row is punch-driven present staff
- there is no existing OT request yet
- suggested OT > 0
- user has not already edited the OT field in this session

Do not keep overwriting the field after the user starts typing.

Implementation note:

- use a one-time “autofilled OT” ref/state guard
- do not hide user edits behind recompute churn

### 4.3 Keep operator within valid bounds

For `Requested OT Hours`:

- allow `0` through suggested OT
- disallow values above suggested OT in the UI
- show clear inline validation

The browser input can use `max`, but server validation still remains mandatory.

### 4.4 Make remarks requirement explicit

If requested OT > 0:

- show `Overtime Reason` label
- helper text that admin will read this before approval
- required marker and inline validation

If requested OT becomes `0`:

- clear reason field client-side too

### 4.5 Show live stale/mismatch warnings

If local summary says:

- `soft_mismatch` → amber warning
- `stale` → red warning, block save if current value still exceeds suggested

This makes punch edits understandable to the operator before the server rejects anything.

### 4.6 Add render-safe tests

Extend:

- `src/components/hr/attendance/edit-attendance-form.test.ts`

Add a new behavior test if needed:

- `src/components/hr/attendance/edit-attendance-form.behavior.test.tsx`

Cases:

- suggested OT appears for 10h worked / 8h standard
- requested OT prefilled once
- user can reduce but not exceed suggestion
- remarks required when requested OT > 0
- stale warning shows when punches reduce suggestion below requested

### Verification gate

```bash
bun run test src/components/hr/attendance/edit-attendance-form.test.ts src/components/hr/attendance/edit-attendance-form.behavior.test.tsx
```

---

## Phase 5 — Admin Approval Query and UI Hardening

**Goal:** give admin the exact context needed to approve or reject, and block stale approvals.

**Why fifth:** approvals must consume the same domain rules already established below.

### 5.1 Enrich approvals query

File:

- `src/server-functions/hr/attendance/get-overtime-approvals-fn.ts`

Extend the selected data with:

- `employees.standardDutyHours`
- computed `suggestedOvertimeHours`
- computed `isOvertimeRequestStale`
- computed `overtimeRequestWarning`

This can be computed after the DB read in TypeScript using the shared pure helper from Phase 1.

### 5.2 Upgrade approvals table

File:

- `src/components/hr/attendance/overtime-approvals-container.tsx`

Change the approvals table to show:

- standard hours
- worked hours
- requested OT
- suggested OT
- operator remarks
- stale state badge

For stale rows:

- show `Needs Recheck`
- disable approve button
- keep reject available

This prevents admin from approving an overstated request.

### 5.3 Keep admin action set simple

Admin actions remain only:

- approve
- reject

No hour editing UI will be introduced.

### Verification gate

Add tests:

- `src/lib/hr-overtime-approvals.test.ts` or similar source/server test

Cases:

- approvals query includes suggestion + stale state
- stale rows disable approval in UI

Run:

```bash
bun run test src/lib/hr-overtime-approvals.test.ts
```

---

## Phase 6 — Approval Action Server Guard

**Goal:** make stale approval impossible even if UI is bypassed.

**Why sixth:** UI guards are helpful; server guards are mandatory.

### 6.1 Harden `processOvertimeFn`

File:

- `src/server-functions/hr/attendance/process-overtime-fn.ts`

Before approving:

1. load the attendance row
2. load the employee standard duty hours
3. build overtime request summary using current `dutyHours` and stored `overtimeHours`
4. if requested status is `approved` and summary is `stale`:
   - reject the action with a clear error
5. if action is `rejected`:
   - allow it even if stale

This protects against:

- stale browser tabs
- concurrent punch edits
- direct RPC misuse

### 6.2 Keep approval semantics unchanged

Do not modify stored requested OT hours here.

Admin is only changing:

- `overtimeStatus`

### 6.3 Update mutation UX

File:

- `src/hooks/hr/use-process-overtime.ts`

If the server rejects approval due to stale OT:

- show a clear toast
- instruct user to ask HR/operator to re-check the attendance row

### Verification gate

Add tests for:

- stale request cannot be approved
- valid request can be approved
- stale request can still be rejected

Run:

```bash
bun run test src/server-functions/hr/attendance/process-overtime-fn.test.ts
```

---

## Phase 7 — Payroll and Regression Verification

**Goal:** confirm the new OT request flow fits the existing payroll engine without hidden regressions.

**Why last:** payroll should consume the new behavior, not be redesigned by it.

### 7.1 Keep payroll formula unchanged

Files to verify, not redesign:

- `src/lib/payroll-calculator.ts`
- `src/components/hr/payroll/salary-calculator-form.tsx`

Expected outcome:

- only approved OT pays
- suggested OT never bypasses approval
- stale OT cannot stay approved after punch changes

### 7.2 Add integration-style regression coverage

Add tests for these end-to-end facts:

- requested OT does not pay while pending
- approved OT pays
- rejected OT pays zero
- approved OT that becomes stale after punch edits returns to pending and stops paying

Suggested files:

- `src/lib/hr-payroll-calculator.test.ts`
- `src/lib/hr-attendance-overtime-regressions.test.ts`

### 7.3 Verify no legacy behavior broke

Re-run current attendance/payroll tests around:

- punch timeline
- attendance upsert
- approvals UI
- payroll calculator

### Verification gate

```bash
bun run test src/lib/hr-payroll-calculator.test.ts src/lib/hr-attendance-overtime-regressions.test.ts
bun run build
```

---

## Delivery Notes

### No migration phase

This plan intentionally avoids schema churn.

That keeps delivery faster and safer because the current data model already supports:

- requested OT hours
- request status
- operator remarks

### Merge strategy

Recommended merge sequence:

1. Phase 1 + Phase 2
2. Phase 3
3. Phase 4
4. Phase 5 + Phase 6
5. Phase 7

This keeps risk isolated and makes regressions easier to localize.

### Acceptance criteria

The feature is done when all of these are true:

- punch-driven present staff see a suggested OT value
- operator cannot request more OT than punches justify
- operator must give a reason for any OT request
- admin can only approve or reject
- stale OT cannot be approved
- punch changes can push approved OT back to pending
- payroll pays only valid approved OT

### Final verification sweep

```bash
bun run test \
  src/lib/attendance/overtime-request.test.ts \
  src/server-functions/hr/attendance/upsert-attendance-fn.test.ts \
  src/server-functions/hr/attendance/manual-punches-fn.test.ts \
  src/server-functions/hr/attendance/process-overtime-fn.test.ts \
  src/components/hr/attendance/edit-attendance-form.test.ts \
  src/components/hr/attendance/edit-attendance-form.behavior.test.tsx \
  src/lib/hr-payroll-calculator.test.ts \
  src/lib/hr-attendance-overtime-regressions.test.ts

bun run build
```

After implementation, refresh the graph:

```bash
graphify update .
```
