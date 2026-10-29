# Late Arrival and Early Departure Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Late and early minutes outside grace become approval items that HR or a super admin decides; payroll only cuts pay for rejected items, and grace minutes are never cut.

**Architecture:** Punch recompute already produces per-shift violations. We add exact late/early minutes to them, derive "time exception" items from them, and persist those items in a new `attendance_time_exceptions` table, reconciled every time a day is recomputed. Payroll loads the items with each attendance row and splits a short day into forgiven minutes (grace, pending, approved) and cut minutes (rejected, plus short time that is neither late nor early). A new Approvals tab and an inline panel in the edit-attendance sheet write decisions through one server function.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (PostgreSQL), Vitest + fast-check, React + TanStack Query, shadcn/ui, lucide-react icons, Big.js in payroll.

**Spec:** `docs/superpowers/specs/2026-10-27-late-early-approvals-spec.md`

## Global Constraints

- No pay cut unless an item is **Rejected**. Pending at payroll time = no cut, payslip says "Not reviewed — no deduction".
- Only users with `hr.manage` (HR) or super admin can see the Late / Early tab or decide items. `requireHrManageMiddleware` covers both (super admin holds `*`).
- Grace = the existing `attendanceGraceMinutes` setting (default 15). Applies separately to arrival and departure. Inside grace: no item to decide, no cut, shown as "grace applied". Past grace: the item covers the **full** minutes.
- "Company work" approval requires a note. "Excuse" and "Reject" notes are optional.
- No monthly cap on approvals.
- Decisions are locked once the payroll covering that date is approved or paid (`assertAttendanceDatesEditable`).
- Every decision appends to the item's history; nothing is silently overwritten.
- Missing check-out or a whole missed shift is **not** an early/late item.
- Present rows with no items (manual HR entry, legacy rows) keep today's short-hours rule unchanged.
- Never edit files under `src/db/migrations/` by hand. Run `bun run db:generate`.
- Never edit `src/routeTree.gen.ts`.
- User-facing copy uses an em dash in "— grace applied", "— no deduction", "— Not reviewed".
- Deviation from spec: attendance badges go in the per-employee attendance log, where day issues already render; the daily list has no issue badges today.
- Deviation from spec: the approvals list shows minutes, not a rupee estimate. The rupee effect is visible on the payslip. (Per-item rupee estimates need the full payroll cycle context and would be misleading as a list column.)

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/attendance/recompute.ts` (modify) | Add `lateMinutes` / `earlyMinutes` to each shift violation; early grace |
| `src/lib/attendance/time-exceptions.ts` (create) | Pure: types, statuses, build desired items, reconcile with existing, split short hours, describe item, validate decision |
| `src/lib/attendance/time-exceptions.test.ts` (create) | Unit tests for the pure module |
| `src/db/schemas/hr-schema.ts` (modify) | `attendanceTimeExceptions` table + relations |
| `src/lib/attendance/time-exceptions.server.ts` (create) | Persist reconciled items inside a transaction |
| `src/lib/attendance/recompute-server.ts` (modify) | Call sync after the attendance upsert |
| `src/lib/payroll-calculator.ts` (modify) | Use items on present short days |
| `src/lib/payroll-time-exceptions.test.ts` (create) | Payroll behaviour tests |
| `src/server-functions/hr/payroll/attendance-records.ts` (create) | One mapper from DB row to `AttendanceRecord` + the `with` clause |
| `src/server-functions/hr/payroll/core.ts` (modify) | Use the mapper in all four places |
| `src/server-functions/hr/attendance/time-exceptions-fn.ts` (create) | List + decide server functions |
| `src/hooks/hr/use-time-exceptions.ts` (create) | Query + mutation hooks |
| `src/server-functions/hr/get-pending-approval-counts-fn.ts` (modify) | Add `lateEarly` count |
| `src/components/hr/payroll/payroll-container.tsx` (modify) | Warning text for pending late/early |
| `src/components/hr/attendance/late-early-approvals-container.tsx` (create) | Approvals tab UI |
| `src/routes/_protected/hr/approvals/index.tsx` (modify) | Add tab, permission-gated |
| `src/components/hr/attendance/time-exception-decisions.tsx` (create) | Inline decide panel for one attendance row |
| `src/components/hr/attendance/edit-attendance-form.tsx` (modify) | Replace "Early Leave Review" select with the panel |
| `src/lib/attendance/day-issues.ts` (modify) | Badges from items |
| `src/server-functions/hr/attendance/get-employee-attendance-log-fn.ts` (modify) | Load items for day issues |

---

### Task 1: Exact late/early minutes and early grace in punch recompute

**Files:**
- Modify: `src/lib/attendance/recompute.ts` (types at top, `computeShiftViolations`)
- Test: `src/lib/attendance/recompute.test.ts`

**Interfaces:**
- Produces: `ShiftViolation` gains `lateMinutes: number | null` and `earlyMinutes: number | null`. `null` means the punch is missing (no item possible). Values are whole minutes, `Math.round`, never negative. `late` stays "outside grace". `earlyDeparture` becomes "outside grace" when there is an OUT punch; when the OUT punch is missing it stays `true` as today (legacy flag, not used for items).

- [ ] **Step 1: Write the failing tests**

Add inside the first `describe` in `src/lib/attendance/recompute.test.ts`, and change the existing early-departure test's checkout from `15, 45` to `15, 44` (15:45 is now exactly at grace):

```ts
  it("records exact late and early minutes per shift", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8, 25), punch("out", "2026-06-01", 15, 50)],
      opts,
    );

    expect(result.shiftViolations[0]).toMatchObject({
      late: true,
      lateMinutes: 25,
      earlyDeparture: false,
      earlyMinutes: 10,
    });
  });

  it("applies grace to early departure exactly", () => {
    const atGrace = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8), punch("out", "2026-06-01", 15, 45)],
      opts,
    );
    const afterGrace = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8), punch("out", "2026-06-01", 15, 44)],
      opts,
    );

    expect(atGrace.earlyDepartureStatus).toBe("none");
    expect(atGrace.shiftViolations[0].earlyMinutes).toBe(15);
    expect(afterGrace.earlyDepartureStatus).toBe("pending");
    expect(afterGrace.shiftViolations[0].earlyMinutes).toBe(16);
  });

  it("reports zero minutes for on-time punches and null for missing ones", () => {
    const onTime = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 7, 50), punch("out", "2026-06-01", 16, 10)],
      opts,
    );
    const openDay = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8)],
      opts,
    );

    expect(onTime.shiftViolations[0]).toMatchObject({ lateMinutes: 0, earlyMinutes: 0 });
    expect(openDay.shiftViolations[0]).toMatchObject({ lateMinutes: 0, earlyMinutes: null });
  });

  it("measures overnight early minutes against the next-day shift end", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 21), punch("out", "2026-06-02", 5, 30)],
      nightOpts,
    );

    expect(result.shiftViolations[0].earlyMinutes).toBe(30);
  });
```

Also extend the existing "flags a missing shift as both late and early departure" test with:

```ts
    expect(result.shiftViolations[1].lateMinutes).toBeNull();
    expect(result.shiftViolations[1].earlyMinutes).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/lib/attendance/recompute.test.ts`
Expected: FAIL — `lateMinutes` undefined, at-grace early still `"pending"`.

- [ ] **Step 3: Implement**

In `ShiftViolation` add after `earlyDeparture: boolean;`:

```ts
  /** Whole minutes after shift start; null when the IN punch is missing. */
  lateMinutes: number | null;
  /** Whole minutes before shift end; null when the OUT punch is missing. */
  earlyMinutes: number | null;
```

Replace the body of the loop in `computeShiftViolations` from `let late = false;` through `violations.push({...})` with:

```ts
    let late = false;
    let earlyDeparture = false;
    let lateMinutes: number | null = null;
    let earlyMinutes: number | null = null;

    if (actualIn) {
      const actualInSec = normalizeForOvernight(actualIn.secondsOfDay, shift, false);
      late = actualInSec > expectedInSec + graceMinutes * 60;
      lateMinutes = Math.max(0, Math.round((actualInSec - expectedInSec) / 60));
    }

    if (actualOut) {
      const actualOutSec = normalizeForOvernight(actualOut.secondsOfDay, shift, true);
      const expectedOutNorm = isOvernightShift(shift)
        ? expectedOutSec + 24 * 3600
        : expectedOutSec;
      earlyDeparture = actualOutSec < expectedOutNorm - graceMinutes * 60;
      earlyMinutes = Math.max(0, Math.round((expectedOutNorm - actualOutSec) / 60));
    } else if (actualIn) {
      earlyDeparture = true;
    } else {
      late = true;
      earlyDeparture = true;
    }

    violations.push({
      shiftIndex: i,
      late,
      earlyDeparture,
      lateMinutes,
      earlyMinutes,
      expectedIn: shift.start,
      actualIn: actualIn?.time,
      expectedOut: shift.end,
      actualOut: actualOut?.time,
    });
```

Update the `shiftViolations` jsonb `$type` in `src/db/schemas/hr-schema.ts` (attendance table) to include the two new optional fields so stored JSON types match:

```ts
      lateMinutes?: number | null;
      earlyMinutes?: number | null;
```

- [ ] **Step 4: Run tests**

Run: `bun run test src/lib/attendance src/lib/hr-shift-support.test.ts src/__tests__/integration/attendance-payroll.test.ts`
Expected: PASS. If a test asserts an early departure between 1 and 15 minutes as `"pending"`, move its checkout one more minute earlier than grace, since grace now applies to departure by spec.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/recompute.ts src/lib/attendance/recompute.test.ts src/db/schemas/hr-schema.ts
git commit -m "feat(hr): measure late and early minutes and apply grace to early departure"
```

---

### Task 2: Pure time-exception module

**Files:**
- Create: `src/lib/attendance/time-exceptions.ts`
- Test: `src/lib/attendance/time-exceptions.test.ts`

**Interfaces:**
- Consumes: `ShiftViolation` from Task 1.
- Produces (all exported from `@/lib/attendance/time-exceptions`):
  - `TIME_EXCEPTION_KINDS = ["late", "early"] as const`, `type TimeExceptionKind`
  - `TIME_EXCEPTION_STATUSES = ["grace", "pending", "approved_official", "approved_excused", "rejected"] as const`, `type TimeExceptionStatus`
  - `TIME_EXCEPTION_DECISIONS = ["pending", "approved_official", "approved_excused", "rejected"] as const`, `type TimeExceptionDecision`
  - `type TimeExceptionHistoryEntry = { status: TimeExceptionStatus; note: string | null; decidedBy: string | null; decidedAt: string }`
  - `type DesiredTimeException = { shiftIndex: number; kind: TimeExceptionKind; minutes: number; withinGrace: boolean }`
  - `buildDesiredTimeExceptions(violations: ShiftViolation[]): DesiredTimeException[]`
  - `type ExistingTimeException = { id: string; shiftIndex: number; kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus }`
  - `reconcileTimeExceptions(existing, desired): { inserts: Array<{ shiftIndex; kind; minutes; status }>; updates: Array<{ id; minutes; status; statusChanged: boolean }>; deleteIds: string[] }`
  - `type PayrollTimeException = { kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus; decidedByName?: string | null }`
  - `splitShortHoursByTimeExceptions(shortHours: number, items: PayrollTimeException[]): { lateHours: number; earlyHours: number; undertimeHours: number }`
  - `formatExceptionMinutes(minutes: number): string`
  - `describeTimeException(item: PayrollTimeException): string`
  - `validateTimeExceptionDecision(input: { currentStatus: TimeExceptionStatus; nextStatus: TimeExceptionDecision; note?: string | null }): void` (throws `Error`)
  - `TIME_EXCEPTION_STATUS_LABELS: Record<TimeExceptionStatus, string>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildDesiredTimeExceptions,
  describeTimeException,
  reconcileTimeExceptions,
  splitShortHoursByTimeExceptions,
  validateTimeExceptionDecision,
} from "./time-exceptions";
import type { ShiftViolation } from "./recompute";

const violation = (overrides: Partial<ShiftViolation>): ShiftViolation => ({
  shiftIndex: 0,
  late: false,
  earlyDeparture: false,
  lateMinutes: 0,
  earlyMinutes: 0,
  ...overrides,
});

describe("buildDesiredTimeExceptions", () => {
  it("creates grace items inside grace and full-minute items past grace", () => {
    expect(
      buildDesiredTimeExceptions([
        violation({ lateMinutes: 10, late: false, earlyMinutes: 25, earlyDeparture: true }),
      ]),
    ).toEqual([
      { shiftIndex: 0, kind: "late", minutes: 10, withinGrace: true },
      { shiftIndex: 0, kind: "early", minutes: 25, withinGrace: false },
    ]);
  });

  it("ignores zero minutes and missing punches", () => {
    expect(
      buildDesiredTimeExceptions([
        violation({ lateMinutes: 0, earlyMinutes: null, earlyDeparture: true }),
        violation({ shiftIndex: 1, lateMinutes: null, earlyMinutes: null, late: true, earlyDeparture: true }),
      ]),
    ).toEqual([]);
  });
});

describe("reconcileTimeExceptions", () => {
  it("inserts new items as pending or grace", () => {
    const plan = reconcileTimeExceptions([], [
      { shiftIndex: 0, kind: "late", minutes: 40, withinGrace: false },
      { shiftIndex: 0, kind: "early", minutes: 5, withinGrace: true },
    ]);
    expect(plan.inserts).toEqual([
      { shiftIndex: 0, kind: "late", minutes: 40, status: "pending" },
      { shiftIndex: 0, kind: "early", minutes: 5, status: "grace" },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("keeps a decision when only the minutes change", () => {
    const plan = reconcileTimeExceptions(
      [{ id: "a", shiftIndex: 0, kind: "late", minutes: 40, status: "rejected" }],
      [{ shiftIndex: 0, kind: "late", minutes: 35, withinGrace: false }],
    );
    expect(plan.updates).toEqual([{ id: "a", minutes: 35, status: "rejected", statusChanged: false }]);
  });

  it("turns a decided item into grace when lateness drops inside grace", () => {
    const plan = reconcileTimeExceptions(
      [{ id: "a", shiftIndex: 0, kind: "late", minutes: 90, status: "approved_official" }],
      [{ shiftIndex: 0, kind: "late", minutes: 5, withinGrace: true }],
    );
    expect(plan.updates).toEqual([{ id: "a", minutes: 5, status: "grace", statusChanged: true }]);
  });

  it("reopens a grace item as pending when it moves past grace", () => {
    const plan = reconcileTimeExceptions(
      [{ id: "a", shiftIndex: 0, kind: "early", minutes: 10, status: "grace" }],
      [{ shiftIndex: 0, kind: "early", minutes: 20, withinGrace: false }],
    );
    expect(plan.updates).toEqual([{ id: "a", minutes: 20, status: "pending", statusChanged: true }]);
  });

  it("skips unchanged items and deletes vanished ones", () => {
    const plan = reconcileTimeExceptions(
      [
        { id: "a", shiftIndex: 0, kind: "late", minutes: 20, status: "pending" },
        { id: "b", shiftIndex: 0, kind: "early", minutes: 30, status: "rejected" },
      ],
      [{ shiftIndex: 0, kind: "late", minutes: 20, withinGrace: false }],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.deleteIds).toEqual(["b"]);
  });
});

describe("splitShortHoursByTimeExceptions", () => {
  it("cuts nothing for grace, pending and approved items", () => {
    expect(
      splitShortHoursByTimeExceptions(2.5, [
        { kind: "late", minutes: 30, status: "pending" },
        { kind: "early", minutes: 120, status: "approved_official" },
      ]),
    ).toEqual({ lateHours: 0, earlyHours: 0, undertimeHours: 0 });
  });

  it("cuts only the rejected part", () => {
    expect(
      splitShortHoursByTimeExceptions(2.5, [
        { kind: "late", minutes: 30, status: "rejected" },
        { kind: "early", minutes: 120, status: "approved_official" },
      ]),
    ).toEqual({ lateHours: 0.5, earlyHours: 0, undertimeHours: 0 });
  });

  it("cuts short time that is neither late nor early as undertime", () => {
    // 8h shift, 30 min late (excused), 1h long lunch gap: worked 6.5h, short 1.5h
    expect(
      splitShortHoursByTimeExceptions(1.5, [{ kind: "late", minutes: 30, status: "approved_excused" }]),
    ).toEqual({ lateHours: 0, earlyHours: 0, undertimeHours: 1 });
  });

  it("drops rounding dust under 0.02 hours", () => {
    expect(
      splitShortHoursByTimeExceptions(0.51, [{ kind: "late", minutes: 30, status: "pending" }]),
    ).toEqual({ lateHours: 0, earlyHours: 0, undertimeHours: 0 });
  });

  it("never cuts more than the actual short hours", () => {
    // Late 1h rejected but stayed 45 min extra: only 0.25h short
    expect(
      splitShortHoursByTimeExceptions(0.25, [{ kind: "late", minutes: 60, status: "rejected" }]),
    ).toEqual({ lateHours: 0.25, earlyHours: 0, undertimeHours: 0 });
  });
});

describe("describeTimeException", () => {
  it("writes the payslip line for each outcome", () => {
    expect(describeTimeException({ kind: "late", minutes: 10, status: "grace" })).toBe(
      "Late arrival 10 min — grace applied — no deduction",
    );
    expect(describeTimeException({ kind: "early", minutes: 120, status: "pending" })).toBe(
      "Early departure 2h — Not reviewed — no deduction",
    );
    expect(
      describeTimeException({ kind: "early", minutes: 125, status: "approved_official", decidedByName: "Usman" }),
    ).toBe("Early departure 2h 5m — Approved (company work) by Usman — no deduction");
    expect(
      describeTimeException({ kind: "late", minutes: 30, status: "approved_excused", decidedByName: "Usman" }),
    ).toBe("Late arrival 30 min — Approved (excused) by Usman — no deduction");
    expect(describeTimeException({ kind: "late", minutes: 30, status: "rejected", decidedByName: "Usman" })).toBe(
      "Late arrival 30 min — Rejected by Usman",
    );
  });
});

describe("validateTimeExceptionDecision", () => {
  it("requires a note for company work", () => {
    expect(() =>
      validateTimeExceptionDecision({ currentStatus: "pending", nextStatus: "approved_official", note: "  " }),
    ).toThrow("A note is required when approving as company work.");
    expect(() =>
      validateTimeExceptionDecision({ currentStatus: "pending", nextStatus: "approved_official", note: "Bank deposit" }),
    ).not.toThrow();
  });

  it("refuses to decide grace items", () => {
    expect(() =>
      validateTimeExceptionDecision({ currentStatus: "grace", nextStatus: "rejected" }),
    ).toThrow("Grace items need no decision.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/lib/attendance/time-exceptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/attendance/time-exceptions.ts`**

```ts
import type { ShiftViolation } from "./recompute";

export const TIME_EXCEPTION_KINDS = ["late", "early"] as const;
export type TimeExceptionKind = (typeof TIME_EXCEPTION_KINDS)[number];

export const TIME_EXCEPTION_STATUSES = [
  "grace",
  "pending",
  "approved_official",
  "approved_excused",
  "rejected",
] as const;
export type TimeExceptionStatus = (typeof TIME_EXCEPTION_STATUSES)[number];

/** Statuses a person can choose. Grace is only ever set by recompute. */
export const TIME_EXCEPTION_DECISIONS = [
  "pending",
  "approved_official",
  "approved_excused",
  "rejected",
] as const;
export type TimeExceptionDecision = (typeof TIME_EXCEPTION_DECISIONS)[number];

export const TIME_EXCEPTION_STATUS_LABELS: Record<TimeExceptionStatus, string> = {
  grace: "Grace",
  pending: "Pending",
  approved_official: "Company work",
  approved_excused: "Excused",
  rejected: "Rejected",
};

export type TimeExceptionHistoryEntry = {
  status: TimeExceptionStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string;
};

export type DesiredTimeException = {
  shiftIndex: number;
  kind: TimeExceptionKind;
  minutes: number;
  withinGrace: boolean;
};

export function buildDesiredTimeExceptions(violations: ShiftViolation[]): DesiredTimeException[] {
  const items: DesiredTimeException[] = [];
  for (const v of violations) {
    if (v.lateMinutes != null && v.lateMinutes > 0) {
      items.push({ shiftIndex: v.shiftIndex, kind: "late", minutes: v.lateMinutes, withinGrace: !v.late });
    }
    if (v.earlyMinutes != null && v.earlyMinutes > 0) {
      items.push({ shiftIndex: v.shiftIndex, kind: "early", minutes: v.earlyMinutes, withinGrace: !v.earlyDeparture });
    }
  }
  return items;
}

export type ExistingTimeException = {
  id: string;
  shiftIndex: number;
  kind: TimeExceptionKind;
  minutes: number;
  status: TimeExceptionStatus;
};

const itemKey = (item: { shiftIndex: number; kind: TimeExceptionKind }) => `${item.shiftIndex}:${item.kind}`;

export function reconcileTimeExceptions(existing: ExistingTimeException[], desired: DesiredTimeException[]) {
  const byKey = new Map(existing.map((item) => [itemKey(item), item]));
  const inserts: Array<{ shiftIndex: number; kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus }> = [];
  const updates: Array<{ id: string; minutes: number; status: TimeExceptionStatus; statusChanged: boolean }> = [];
  const kept = new Set<string>();

  for (const item of desired) {
    const current = byKey.get(itemKey(item));
    if (!current) {
      inserts.push({ shiftIndex: item.shiftIndex, kind: item.kind, minutes: item.minutes, status: item.withinGrace ? "grace" : "pending" });
      continue;
    }
    kept.add(current.id);
    // A decision survives punch corrections; only crossing the grace line resets it.
    const status: TimeExceptionStatus = item.withinGrace
      ? "grace"
      : current.status === "grace"
        ? "pending"
        : current.status;
    if (status !== current.status || item.minutes !== current.minutes) {
      updates.push({ id: current.id, minutes: item.minutes, status, statusChanged: status !== current.status });
    }
  }

  const deleteIds = existing.filter((item) => !kept.has(item.id)).map((item) => item.id);
  return { inserts, updates, deleteIds };
}

export type PayrollTimeException = {
  kind: TimeExceptionKind;
  minutes: number;
  status: TimeExceptionStatus;
  decidedByName?: string | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
// Minutes are whole and duty hours have two decimals, so up to ~1 minute of dust is not a real shortfall.
const DUST_HOURS = 0.02;

export function splitShortHoursByTimeExceptions(shortHours: number, items: PayrollTimeException[]) {
  const sumHours = (filter: (item: PayrollTimeException) => boolean) =>
    items.filter(filter).reduce((total, item) => total + item.minutes, 0) / 60;

  const forgiven = sumHours((item) => item.status !== "rejected");
  const rejectedLate = sumHours((item) => item.kind === "late" && item.status === "rejected");
  const rejectedEarly = sumHours((item) => item.kind === "early" && item.status === "rejected");

  let remaining = Math.max(0, round2(shortHours - forgiven));
  const lateHours = round2(Math.min(remaining, rejectedLate));
  remaining = round2(remaining - lateHours);
  const earlyHours = round2(Math.min(remaining, rejectedEarly));
  remaining = round2(remaining - earlyHours);

  return { lateHours, earlyHours, undertimeHours: remaining < DUST_HOURS ? 0 : remaining };
}

export function formatExceptionMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function describeTimeException(item: PayrollTimeException): string {
  const label = `${item.kind === "late" ? "Late arrival" : "Early departure"} ${formatExceptionMinutes(item.minutes)}`;
  const by = item.decidedByName ? ` by ${item.decidedByName}` : "";
  switch (item.status) {
    case "grace":
      return `${label} — grace applied — no deduction`;
    case "pending":
      return `${label} — Not reviewed — no deduction`;
    case "approved_official":
      return `${label} — Approved (company work)${by} — no deduction`;
    case "approved_excused":
      return `${label} — Approved (excused)${by} — no deduction`;
    case "rejected":
      return `${label} — Rejected${by}`;
  }
}

export function validateTimeExceptionDecision(input: {
  currentStatus: TimeExceptionStatus;
  nextStatus: TimeExceptionDecision;
  note?: string | null;
}) {
  if (input.currentStatus === "grace") {
    throw new Error("Grace items need no decision.");
  }
  if (input.nextStatus === "approved_official" && !input.note?.trim()) {
    throw new Error("A note is required when approving as company work.");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test src/lib/attendance/time-exceptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/time-exceptions.ts src/lib/attendance/time-exceptions.test.ts
git commit -m "feat(hr): add pure late/early time-exception rules"
```

---

### Task 3: Database table

**Files:**
- Modify: `src/db/schemas/hr-schema.ts`
- Generated: new migration under `src/db/migrations/` (by the generator only)

**Interfaces:**
- Consumes: constants and types from Task 2.
- Produces: `attendanceTimeExceptions` table, `attendanceTimeExceptionRelations` (`attendance`, `employee`, `decidedByUser`), and `attendanceRelations.timeExceptions` (many).

- [ ] **Step 1: Add the table**

At the top of `hr-schema.ts`, add the import:

```ts
import {
  TIME_EXCEPTION_KINDS,
  TIME_EXCEPTION_STATUSES,
  type TimeExceptionHistoryEntry,
} from "@/lib/attendance/time-exceptions";
```

Directly after the `attendance` table definition (it closes at the `);` near line 265), add:

```ts
// --- LATE / EARLY APPROVAL ITEMS ---
// One row per shift per kind. Recompute keeps them in sync with punches; HR decides them.
export const attendanceTimeExceptions = pgTable(
  "attendance_time_exceptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    attendanceId: text("attendance_id")
      .notNull()
      .references(() => attendance.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    date: date("date").notNull(),
    shiftIndex: integer("shift_index").notNull(),
    kind: text("kind", { enum: TIME_EXCEPTION_KINDS }).notNull(),
    minutes: integer("minutes").notNull(),
    status: text("status", { enum: TIME_EXCEPTION_STATUSES }).notNull().default("pending"),
    note: text("note"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at"),
    history: jsonb("history").$type<TimeExceptionHistoryEntry[]>().default([]).notNull(),
    ...timestamps,
  },
  (table) => ({
    attendanceItemIdx: uniqueIndex("attendance_time_exceptions_item_idx").on(
      table.attendanceId,
      table.shiftIndex,
      table.kind,
    ),
    statusDateIdx: index("attendance_time_exceptions_status_date_idx").on(table.status, table.date),
    employeeDateIdx: index("attendance_time_exceptions_employee_date_idx").on(table.employeeId, table.date),
  }),
);
```

Change `attendanceRelations` to:

```ts
export const attendanceRelations = relations(attendance, ({ one, many }) => ({
  employee: one(employees, {
    fields: [attendance.employeeId],
    references: [employees.id],
  }),
  timeExceptions: many(attendanceTimeExceptions),
}));

export const attendanceTimeExceptionRelations = relations(attendanceTimeExceptions, ({ one }) => ({
  attendance: one(attendance, {
    fields: [attendanceTimeExceptions.attendanceId],
    references: [attendance.id],
  }),
  employee: one(employees, {
    fields: [attendanceTimeExceptions.employeeId],
    references: [employees.id],
  }),
  decidedByUser: one(user, {
    fields: [attendanceTimeExceptions.decidedBy],
    references: [user.id],
  }),
}));
```

Make sure `src/db/index.ts` picks the new exports up (it spreads the schema module; confirm by `grep -n "hr-schema" src/db/index.ts`).

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: one new `00NN_*.sql` creating `attendance_time_exceptions` with the three indexes and FKs. Read it; do not edit it.

- [ ] **Step 3: Apply locally and typecheck**

Run: `docker compose up -d && bun run db:migrate && bun run typecheck`
Expected: migration applies, typecheck passes.

- [ ] **Step 4: Commit**

```bash
git add src/db/schemas/hr-schema.ts src/db/migrations
git commit -m "feat(hr): add attendance time exceptions table"
```

---

### Task 4: Keep items in sync on every recompute

**Files:**
- Create: `src/lib/attendance/time-exceptions.server.ts`
- Modify: `src/lib/attendance/recompute-server.ts` (end of `recomputeAttendanceRow`)
- Test: `src/lib/attendance/recompute-server.test.ts` (source-inspection style already used there)

**Interfaces:**
- Consumes: `reconcileTimeExceptions`, `buildDesiredTimeExceptions` (Task 2), `attendanceTimeExceptions` (Task 3), `AttendanceTx` from `recompute-server.ts`.
- Produces: `syncAttendanceTimeExceptions(tx: AttendanceTx, row: { id: string; employeeId: string; date: string }, violations: ShiftViolation[], options?: { reset?: boolean }): Promise<void>`.

All attendance writers that use punches (device import, offline confirmation, manual punches, upsert, bulk range) go through `recomputeAttendanceRow`, so this one hook covers them. When a day loses all punches the attendance row is deleted and the items cascade away.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/attendance/recompute-server.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("recompute keeps late/early items in sync", () => {
  const source = readFileSync(resolve(__dirname, "recompute-server.ts"), "utf8");

  it("syncs time exceptions after the attendance upsert", () => {
    const upsertAt = source.indexOf(".onConflictDoUpdate(");
    const syncAt = source.indexOf("syncAttendanceTimeExceptions(");
    expect(syncAt).toBeGreaterThan(upsertAt);
    expect(source).toMatch(/reset:\s*manualFieldStrategy === "reset"/);
  });
});
```

(If the file already imports `readFileSync`/`resolve` or `describe`, reuse those imports instead of duplicating.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/lib/attendance/recompute-server.test.ts`
Expected: FAIL — `syncAttendanceTimeExceptions(` not found.

- [ ] **Step 3: Implement `src/lib/attendance/time-exceptions.server.ts`**

```ts
import { eq, inArray } from "drizzle-orm";
import { attendanceTimeExceptions } from "@/db/schemas/hr-schema";
import type { AttendanceTx } from "./recompute-server";
import type { ShiftViolation } from "./recompute";
import { buildDesiredTimeExceptions, reconcileTimeExceptions } from "./time-exceptions";

export async function syncAttendanceTimeExceptions(
  tx: AttendanceTx,
  row: { id: string; employeeId: string; date: string },
  violations: ShiftViolation[],
  options: { reset?: boolean } = {},
) {
  if (options.reset) {
    await tx.delete(attendanceTimeExceptions).where(eq(attendanceTimeExceptions.attendanceId, row.id));
  }

  const existing = options.reset
    ? []
    : await tx.query.attendanceTimeExceptions.findMany({
        where: eq(attendanceTimeExceptions.attendanceId, row.id),
      });
  const plan = reconcileTimeExceptions(existing, buildDesiredTimeExceptions(violations));
  const now = new Date();

  if (plan.deleteIds.length) {
    await tx.delete(attendanceTimeExceptions).where(inArray(attendanceTimeExceptions.id, plan.deleteIds));
  }

  for (const update of plan.updates) {
    const previous = existing.find((item) => item.id === update.id)!;
    await tx
      .update(attendanceTimeExceptions)
      .set({
        minutes: update.minutes,
        status: update.status,
        ...(update.statusChanged
          ? {
              note: null,
              decidedBy: null,
              decidedAt: null,
              history: [
                ...previous.history,
                { status: update.status, note: "Recomputed from punches", decidedBy: null, decidedAt: now.toISOString() },
              ],
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(attendanceTimeExceptions.id, update.id));
  }

  if (plan.inserts.length) {
    await tx.insert(attendanceTimeExceptions).values(
      plan.inserts.map((item) => ({
        attendanceId: row.id,
        employeeId: row.employeeId,
        date: row.date,
        ...item,
      })),
    );
  }
}
```

- [ ] **Step 4: Call it from `recomputeAttendanceRow`**

In `src/lib/attendance/recompute-server.ts` add the import:

```ts
import { syncAttendanceTimeExceptions } from "./time-exceptions.server";
```

Replace the final `return upserted ?? null;` with:

```ts
  if (upserted) {
    await syncAttendanceTimeExceptions(tx, upserted, computed.shiftViolations, {
      reset: manualFieldStrategy === "reset",
    });
  }

  return upserted ?? null;
```

- [ ] **Step 5: Run tests**

Run: `bun run test src/lib/attendance src/server-functions/hr/attendance`
Expected: PASS. Source-inspection tests that pin the exact tail of `recomputeAttendanceRow` may need the new lines added to their expectation.

- [ ] **Step 6: Manual check against the local DB**

Run `bun run dev`, open HR → Attendance, add manual punches for one employee: IN 09:25, OUT 17:00 on a 09:00–17:00 shift. Then run:

```bash
docker compose exec -T db psql -U postgres -d titan -c "select kind, minutes, status from attendance_time_exceptions order by created_at desc limit 5;"
```

(Use the DB name and user from `.env` if they differ.) Expected: one row `late | 25 | pending`. Change the IN punch to 09:10, rerun: same row now `late | 10 | grace`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/time-exceptions.server.ts src/lib/attendance/recompute-server.ts src/lib/attendance/recompute-server.test.ts
git commit -m "feat(hr): sync late/early items whenever attendance is recomputed"
```

---

### Task 5: Payroll cuts only rejected minutes

**Files:**
- Modify: `src/lib/payroll-calculator.ts` (`AttendanceRecord` type ~line 39; present-day branch ~line 521)
- Test: `src/lib/payroll-time-exceptions.test.ts`

**Interfaces:**
- Consumes: `PayrollTimeException`, `splitShortHoursByTimeExceptions`, `describeTimeException` (Task 2).
- Produces: `AttendanceRecord.timeExceptions?: PayrollTimeException[]`. When present and non-empty on a short present day, the new rule applies; otherwise the old rule is untouched.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { calculatePayslip, type AttendanceRecord, type EmployeeData } from "./payroll-calculator";
import { DEFAULT_BASIC_SALARY_DEDUCTION_POLICY } from "./types/hr-types";
import type { PayrollTimeException } from "./attendance/time-exceptions";

// 26000 basic, 26 working days, 8h shift => Rs 125 per hour of basic.
const employee: EmployeeData = {
  id: "emp", employeeCode: "E1", firstName: "Ali", lastName: "Khan", designation: "Staff",
  cnic: null, bankName: null, bankAccountNumber: null, basicSalary: "26000", standardDutyHours: 8, restDays: [0],
  allowanceConfig: [],
  basicSalaryDeductionPolicy: DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
};
const cycle = { month: "2026-10-01", startDate: "2026-09-16", endDate: "2026-10-15" };
const day = (dutyHours: string, timeExceptions?: PayrollTimeException[]): AttendanceRecord => ({
  date: "2026-09-16", status: "present", dutyHours, overtimeHours: "0", isNightShift: false, timeExceptions,
});
const slip = (record: AttendanceRecord) => calculatePayslip(employee, [record], cycle);

describe("late/early approvals in payroll", () => {
  it("does not cut a pending early departure and says so", () => {
    const result = slip(day("6.00", [{ kind: "early", minutes: 120, status: "pending" }]));
    expect(result.totalDeductions).toBe(0);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      type: "earlyLeaving",
      description: "Early departure 2h — Not reviewed — no deduction",
      isWaived: true,
    }));
  });

  it("does not cut grace minutes", () => {
    const result = slip(day("7.83", [{ kind: "late", minutes: 10, status: "grace" }]));
    expect(result.totalDeductions).toBe(0);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      description: "Late arrival 10 min — grace applied — no deduction",
    }));
  });

  it("does not cut company work", () => {
    const result = slip(day("6.00", [{ kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" }]));
    expect(result.totalDeductions).toBe(0);
  });

  it("cuts only the rejected item on a day with two items", () => {
    // 30 min late rejected + 2h early company work => only 0.5h cut = Rs 63 (62.5 rounded)
    const result = slip(day("5.50", [
      { kind: "late", minutes: 30, status: "rejected", decidedByName: "Usman" },
      { kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" },
    ]));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(63);
    expect(result.totalUndertimeHours).toBe(0.5);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({
      description: "Late arrival 30 min — Rejected by Usman",
      isWaived: false,
    }));
  });

  it("still cuts short time that is neither late nor early", () => {
    // 30 min late excused, plus 1h long break => 1h cut = Rs 125
    const result = slip(day("6.50", [{ kind: "late", minutes: 30, status: "approved_excused" }]));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(125);
    expect(result.explanationLog).toContainEqual(expect.objectContaining({ type: "undertime", value: 1 }));
  });

  it("keeps the old rule for rows without items", () => {
    const result = slip(day("7.00"));
    expect(result.deductionBreakdownByOccasion.undertime).toBe(125);
  });

  it("lets the month-level waiver cancel a rejected cut", () => {
    const result = calculatePayslip(employee, [day("7.00", [{ kind: "late", minutes: 60, status: "rejected" }])], cycle, undefined, undefined, { waiveUndertime: true });
    expect(result.deductionBreakdownByOccasion.undertime).toBe(0);
  });
});
```

Before running, open `calculatePayslip`'s signature (line ~759) and fix the last test's call so the adjustments object lands in the right parameter position; copy the argument order used in `src/lib/payroll-attendance-waivers.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/payroll-time-exceptions.test.ts`
Expected: FAIL — pending/grace/approved days are still cut.

- [ ] **Step 3: Implement**

In `payroll-calculator.ts`, add the import:

```ts
import {
  describeTimeException,
  splitShortHoursByTimeExceptions,
  type PayrollTimeException,
} from "./attendance/time-exceptions";
```

In `AttendanceRecord`, after `earlyDepartureStatus?: string; ...`:

```ts
  /**
   * Late/early approval items for this day. When present on a short day, only rejected
   * minutes (and short time that is neither late nor early) are cut. Undefined = old rule.
   */
  timeExceptions?: PayrollTimeException[];
```

Insert a new branch immediately **before** the existing `} else if (record.status === "present" && dutyHours < standardDutyHours) {` branch:

```ts
    } else if (
      record.status === "present" &&
      dutyHours < standardDutyHours &&
      record.timeExceptions &&
      record.timeExceptions.length > 0
    ) {
      const shortHours = Number((standardDutyHours - dutyHours).toFixed(2));
      const split = splitShortHoursByTimeExceptions(shortHours, record.timeExceptions);
      totalUndertimeHours += split.lateHours + split.earlyHours + split.undertimeHours;
      const isW = checkWaived("undertime");

      for (const item of record.timeExceptions) {
        explanationLog.push({
          date: record.date,
          type: item.kind === "late" ? "lateArrival" : "earlyLeaving",
          description: describeTimeException(item),
          value: +(item.minutes / 60).toFixed(2),
          unit: "hrs",
          isWaived: item.status !== "rejected" || isW,
        });
      }
      if (split.lateHours > 0) applyOccasionDeduction(split.lateHours, "lateArrival", "absent", "undertime", isW);
      if (split.earlyHours > 0) applyOccasionDeduction(split.earlyHours, "earlyLeaving", "absent", "undertime", isW);
      if (split.undertimeHours > 0) {
        explanationLog.push({
          date: record.date,
          type: "undertime",
          description: "Short hours not explained by late arrival or early departure",
          value: split.undertimeHours,
          unit: "hrs",
          isWaived: isW,
        });
        applyOccasionDeduction(split.undertimeHours, "undertime", "absent", "undertime", isW);
      }
```

`checkWaived` already folds in per-date exemptions (`exemptedDates`) for the record being processed; confirm by reading its definition, and if it takes the date as an argument, pass `record.date` the same way the existing branch does.

- [ ] **Step 4: Run all payroll tests**

Run: `bun run test src/lib/payroll src/__tests__/integration/attendance-payroll.test.ts`
Expected: PASS (existing tests have no `timeExceptions`, so they take the old branch).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll-calculator.ts src/lib/payroll-time-exceptions.test.ts
git commit -m "feat(payroll): cut pay only for rejected late/early minutes"
```

---

### Task 6: Load items into payroll

**Files:**
- Create: `src/server-functions/hr/payroll/attendance-records.ts`
- Create: `src/server-functions/hr/payroll/attendance-records.test.ts`
- Modify: `src/server-functions/hr/payroll/core.ts` (the four `rawAttendance` / `yearAttendanceRaw` mappers at ~460, ~659, ~1031, ~1222)

**Interfaces:**
- Consumes: Task 3 relations, Task 5 `AttendanceRecord.timeExceptions`.
- Produces: `payrollAttendanceWith` (drizzle `with` clause) and `toPayrollAttendanceRecord(row: PayrollAttendanceRow): AttendanceRecord`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { toPayrollAttendanceRecord } from "./attendance-records";

const base = {
  date: "2026-10-01", status: "present", dutyHours: "6.00", overtimeHours: "0", isNightShift: false,
  isApprovedLeave: false, leaveType: null, overtimeStatus: "pending", overtimeCompensationMethod: "payout",
  compensatoryHoursUsed: "0", isLate: false, earlyDepartureStatus: "pending",
} as const;

describe("toPayrollAttendanceRecord", () => {
  it("maps items with the decider's name", () => {
    const record = toPayrollAttendanceRecord({
      ...base,
      timeExceptions: [
        { kind: "early", minutes: 120, status: "approved_official", decidedByUser: { name: "Usman" } },
      ],
    } as never);
    expect(record.timeExceptions).toEqual([
      { kind: "early", minutes: 120, status: "approved_official", decidedByName: "Usman" },
    ]);
  });

  it("leaves items undefined when the row was loaded without them", () => {
    expect(toPayrollAttendanceRecord(base as never).timeExceptions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/server-functions/hr/payroll/attendance-records.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { attendance, attendanceTimeExceptions } from "@/db/schemas/hr-schema";
import type { AttendanceRecord } from "@/lib/payroll-calculator";

type TimeExceptionRow = Pick<typeof attendanceTimeExceptions.$inferSelect, "kind" | "minutes" | "status"> & {
  decidedByUser?: { name: string } | null;
};

export type PayrollAttendanceRow = typeof attendance.$inferSelect & {
  timeExceptions?: TimeExceptionRow[];
};

/** Drizzle `with` clause: load late/early items and who decided them. */
export const payrollAttendanceWith = {
  timeExceptions: {
    columns: { kind: true, minutes: true, status: true },
    with: { decidedByUser: { columns: { name: true } } },
  },
} as const;

export function toPayrollAttendanceRecord(r: PayrollAttendanceRow): AttendanceRecord {
  return {
    date: r.date,
    status: r.status,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
    timeExceptions: r.timeExceptions?.map((item) => ({
      kind: item.kind,
      minutes: item.minutes,
      status: item.status,
      decidedByName: item.decidedByUser?.name ?? null,
    })),
  };
}
```

In `core.ts`:
1. `import { payrollAttendanceWith, toPayrollAttendanceRecord } from "./attendance-records";`
2. For the two **payroll-period** queries (`rawAttendance` in `generateEmployeePayslipCore` ~460 and `simulateEmployeePayslipCore` ~1031): add `with: payrollAttendanceWith,` to `findMany`, and replace the inline `.map((r) => ({ ... }))` with `.map(toPayrollAttendanceRecord)`.
3. For the two **yearly Bradford** queries (`yearAttendanceRaw` ~659 and ~1222): replace the inline map with `.map(toPayrollAttendanceRecord)` and do **not** add `with` (Bradford does not need items).

Before replacing each inline map, diff it against the mapper fields; if any site maps an extra field, add it to the mapper rather than dropping it.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test src/server-functions/hr/payroll && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/hr/payroll/attendance-records.ts src/server-functions/hr/payroll/attendance-records.test.ts src/server-functions/hr/payroll/core.ts
git commit -m "feat(payroll): load late/early decisions into payslip generation"
```

---

### Task 7: List and decide server functions, hooks, pending count

**Files:**
- Create: `src/server-functions/hr/attendance/time-exceptions-fn.ts`
- Create: `src/server-functions/hr/attendance/time-exceptions-fn.test.ts`
- Create: `src/hooks/hr/use-time-exceptions.ts`
- Modify: `src/server-functions/hr/get-pending-approval-counts-fn.ts`
- Modify: `src/components/hr/payroll/payroll-container.tsx` (`PendingApprovalsWarning`, ~line 762)

**Interfaces:**
- Consumes: Tasks 2–3; `requireHrManageMiddleware`; `lockAttendancePayrollWrites`, `assertAttendanceDatesEditable`, `invalidateDeviceAttendanceChanges` from `@/lib/attendance/device-import/payroll.server`; `lockEmployeePunchWrites` from `./punch-write-lock`.
- Produces:
  - `getTimeExceptionsFn({ data: { view: "pending" | "decided" | "all"; from?: string; to?: string; attendanceId?: string } })` → `{ items: TimeExceptionListItem[]; pendingCount: number }`
  - `type TimeExceptionListItem = { id; attendanceId; employeeId; employeeCode; employeeName; department: string | null; date; shiftIndex; kind; minutes; status; note: string | null; decidedByName: string | null; decidedAt: Date | null; expectedTime: string | null; actualTime: string | null }`
  - `decideTimeExceptionsFn({ data: { ids: string[]; status: TimeExceptionDecision; note?: string } })` → `{ updated: number }`
  - Hooks: `useTimeExceptions(view, attendanceId?)` (query key `["time-exceptions", view, attendanceId ?? null]`) and `useDecideTimeExceptions()`.
  - `getPendingApprovalCountsFn` result gains `lateEarly: number` (included in `total`).

- [ ] **Step 1: Write the failing source-inspection test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "time-exceptions-fn.ts"), "utf8");

describe("late/early decision server functions", () => {
  it("restricts both list and decide to HR managers (super admin passes via *)", () => {
    expect(source.match(/requireHrManageMiddleware/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/requireHrViewMiddleware/);
  });

  it("locks payroll writes and refuses dates in approved or paid payroll", () => {
    expect(source).toMatch(/lockAttendancePayrollWrites\(tx\)/);
    expect(source).toMatch(/assertAttendanceDatesEditable\(tx,/);
    expect(source).toMatch(/validateTimeExceptionDecision\(/);
  });

  it("appends to history instead of overwriting it", () => {
    expect(source).toMatch(/history:\s*\[\s*\.\.\.row\.history/);
  });

  it("lists only items on present days", () => {
    expect(source).toMatch(/eq\(attendance\.status, "present"\)/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/server-functions/hr/attendance/time-exceptions-fn.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement `time-exceptions-fn.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendance, attendanceTimeExceptions, employees } from "@/db/schemas/hr-schema";
import { user } from "@/db/schemas/auth-schema";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import {
  assertAttendanceDatesEditable,
  invalidateDeviceAttendanceChanges,
  lockAttendancePayrollWrites,
} from "@/lib/attendance/device-import/payroll.server";
import {
  TIME_EXCEPTION_DECISIONS,
  validateTimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";
import { lockEmployeePunchWrites } from "./punch-write-lock";

export const getTimeExceptionsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      view: z.enum(["pending", "decided", "all"]).default("pending"),
      from: z.string().optional(),
      to: z.string().optional(),
      attendanceId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const filters: SQL[] = [eq(attendance.status, "present")];
    if (data.view === "pending") filters.push(eq(attendanceTimeExceptions.status, "pending"));
    if (data.view === "decided")
      filters.push(inArray(attendanceTimeExceptions.status, ["approved_official", "approved_excused", "rejected"]));
    // Grace rows are display-only; the approvals list hides them unless one row is requested.
    if (!data.attendanceId) filters.push(ne(attendanceTimeExceptions.status, "grace"));
    if (data.attendanceId) filters.push(eq(attendanceTimeExceptions.attendanceId, data.attendanceId));
    if (data.from) filters.push(gte(attendanceTimeExceptions.date, data.from));
    if (data.to) filters.push(lte(attendanceTimeExceptions.date, data.to));

    const rows = await db
      .select({
        id: attendanceTimeExceptions.id,
        attendanceId: attendanceTimeExceptions.attendanceId,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        date: attendanceTimeExceptions.date,
        shiftIndex: attendanceTimeExceptions.shiftIndex,
        kind: attendanceTimeExceptions.kind,
        minutes: attendanceTimeExceptions.minutes,
        status: attendanceTimeExceptions.status,
        note: attendanceTimeExceptions.note,
        decidedByName: user.name,
        decidedAt: attendanceTimeExceptions.decidedAt,
        shiftViolations: attendance.shiftViolations,
      })
      .from(attendanceTimeExceptions)
      .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
      .innerJoin(employees, eq(attendanceTimeExceptions.employeeId, employees.id))
      .leftJoin(user, eq(attendanceTimeExceptions.decidedBy, user.id))
      .where(and(...filters))
      .orderBy(desc(attendanceTimeExceptions.date), employees.firstName);

    const items = rows.map(({ firstName, lastName, shiftViolations, ...row }) => {
      const shift = shiftViolations?.find((v) => v.shiftIndex === row.shiftIndex);
      return {
        ...row,
        employeeName: `${firstName} ${lastName}`.trim(),
        expectedTime: (row.kind === "late" ? shift?.expectedIn : shift?.expectedOut) ?? null,
        actualTime: (row.kind === "late" ? shift?.actualIn : shift?.actualOut) ?? null,
      };
    });

    const pending = await db
      .select({ id: attendanceTimeExceptions.id })
      .from(attendanceTimeExceptions)
      .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
      .where(and(eq(attendanceTimeExceptions.status, "pending"), eq(attendance.status, "present")));

    return { items, pendingCount: pending.length };
  });

export type TimeExceptionListItem = Awaited<ReturnType<typeof getTimeExceptionsFn>>["items"][number];

export const decideTimeExceptionsFn = createServerFn({ method: "POST" })
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      ids: z.array(z.string()).min(1).max(500),
      status: z.enum(TIME_EXCEPTION_DECISIONS),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const deciderId = context.authContext.session.user.id;
    return await db.transaction(async (tx) => {
      await lockAttendancePayrollWrites(tx);
      const rows = await tx.query.attendanceTimeExceptions.findMany({
        where: inArray(attendanceTimeExceptions.id, data.ids),
      });
      if (rows.length !== new Set(data.ids).size) {
        throw new Error("Some late/early items no longer exist. Refresh and try again.");
      }
      for (const row of rows) {
        validateTimeExceptionDecision({ currentStatus: row.status, nextStatus: data.status, note: data.note });
      }

      await assertAttendanceDatesEditable(tx, [...new Set(rows.map((row) => row.date))]);

      const datesByEmployee = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!datesByEmployee.has(row.employeeId)) datesByEmployee.set(row.employeeId, new Set());
        datesByEmployee.get(row.employeeId)!.add(row.date);
      }
      for (const [employeeId, dates] of datesByEmployee) {
        await lockEmployeePunchWrites(tx, employeeId);
        await invalidateDeviceAttendanceChanges(tx, employeeId, [...dates]);
      }

      const now = new Date();
      const note = data.note || null;
      const decided = data.status !== "pending";
      for (const row of rows) {
        await tx
          .update(attendanceTimeExceptions)
          .set({
            status: data.status,
            note,
            decidedBy: decided ? deciderId : null,
            decidedAt: decided ? now : null,
            history: [...row.history, { status: data.status, note, decidedBy: deciderId, decidedAt: now.toISOString() }],
            updatedAt: now,
          })
          .where(eq(attendanceTimeExceptions.id, row.id));
      }

      return { updated: rows.length };
    });
  });
```

Check `lockEmployeePunchWrites`'s signature in `punch-write-lock.ts`; it is called as `(tx, employeeId)` in `process-overtime-fn.ts`, so match that. If `createServerFn` elsewhere in this folder is called without `{ method: "POST" }` for mutations, follow that local convention instead.

- [ ] **Step 4: Hooks `src/hooks/hr/use-time-exceptions.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  decideTimeExceptionsFn,
  getTimeExceptionsFn,
} from "@/server-functions/hr/attendance/time-exceptions-fn";
import type { TimeExceptionDecision } from "@/lib/attendance/time-exceptions";

export type TimeExceptionView = "pending" | "decided" | "all";

export const useTimeExceptions = (view: TimeExceptionView, attendanceId?: string) =>
  useQuery({
    queryKey: ["time-exceptions", view, attendanceId ?? null],
    queryFn: () => getTimeExceptionsFn({ data: { view, attendanceId } }),
  });

const DECISION_TOAST: Record<TimeExceptionDecision, string> = {
  approved_official: "Approved as company work",
  approved_excused: "Excused",
  rejected: "Rejected",
  pending: "Moved back to pending",
};

export const useDecideTimeExceptions = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[]; status: TimeExceptionDecision; note?: string }) =>
      decideTimeExceptionsFn({ data }),
    onSuccess: (result, variables) => {
      for (const key of [
        "time-exceptions",
        "pending-approval-counts",
        "attendance",
        "daily-attendance",
        "employee-attendance-log",
        "payroll",
        "payrolls",
        "payslip-preview",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`${DECISION_TOAST[variables.status]} (${result.updated})`);
    },
    onError: (err) => toast.error(err.message || "Failed to save decision"),
  });
};
```

- [ ] **Step 5: Pending count**

In `get-pending-approval-counts-fn.ts`, import `attendanceTimeExceptions` and add before the `return`:

```ts
        // Pending late/early items on present days
        const pendingLateEarly = await db
            .select({ id: attendanceTimeExceptions.id })
            .from(attendanceTimeExceptions)
            .innerJoin(attendance, eq(attendanceTimeExceptions.attendanceId, attendance.id))
            .where(
                and(
                    eq(attendanceTimeExceptions.status, "pending"),
                    eq(attendance.status, "present")
                )
            );
```

Return `lateEarly: pendingLateEarly.length` and add it to `total`.

In `PendingApprovalsWarning` (`payroll-container.tsx`), add after the advances line:

```ts
  if (counts.lateEarly > 0) parts.push(`${counts.lateEarly} late/early item${counts.lateEarly !== 1 ? "s" : ""} (will not be deducted)`);
```

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test src/server-functions/hr && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/hr/attendance/time-exceptions-fn.ts src/server-functions/hr/attendance/time-exceptions-fn.test.ts src/hooks/hr/use-time-exceptions.ts src/server-functions/hr/get-pending-approval-counts-fn.ts src/components/hr/payroll/payroll-container.tsx
git commit -m "feat(hr): add late/early list and decision server functions"
```

---

### Task 8: Late / Early tab on the Approvals page

**Files:**
- Create: `src/components/hr/attendance/late-early-approvals-container.tsx`
- Modify: `src/routes/_protected/hr/approvals/index.tsx`

**Interfaces:**
- Consumes: `useTimeExceptions`, `useDecideTimeExceptions`, `TimeExceptionListItem` (Task 7); `formatExceptionMinutes`, `TIME_EXCEPTION_STATUS_LABELS` (Task 2); `useViewerAccess` from `@/hooks/use-viewer-access`; `hasPermission` from `@/lib/rbac`.
- Produces: `LateEarlyApprovalsContainer` (no props).

- [ ] **Step 1: Build the container**

```tsx
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Briefcase, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GenericEmpty } from "@/components/custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import {
  useDecideTimeExceptions,
  useTimeExceptions,
  type TimeExceptionView,
} from "@/hooks/hr/use-time-exceptions";
import {
  formatExceptionMinutes,
  TIME_EXCEPTION_STATUS_LABELS,
  type TimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";

type PendingDecision = { ids: string[]; status: TimeExceptionDecision };

const DECISION_TITLES: Record<TimeExceptionDecision, string> = {
  approved_official: "Approve as company work",
  approved_excused: "Excuse",
  rejected: "Reject",
  pending: "Move back to pending",
};

const shortTime = (value: string | null) => (value ? value.slice(0, 5) : "—");

export function LateEarlyApprovalsContainer() {
  const [view, setView] = useState<TimeExceptionView>("pending");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [note, setNote] = useState("");
  const { data, isLoading } = useTimeExceptions(view);
  const decide = useDecideTimeExceptions();

  const departments = useMemo(
    () => [...new Set((data?.items ?? []).map((item) => item.department).filter(Boolean))] as string[],
    [data],
  );
  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (item) =>
        (department === "all" || item.department === department) &&
        (!term || item.employeeName.toLowerCase().includes(term) || item.employeeCode.toLowerCase().includes(term)),
    );
  }, [data, search, department]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const open = (ids: string[], status: TimeExceptionDecision) => {
    setNote("");
    setDecision({ ids, status });
  };
  const noteRequired = decision?.status === "approved_official";
  const confirm = () => {
    if (!decision) return;
    decide.mutate(
      { ...decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setDecision(null);
          setSelected(new Set());
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => { setView(v as TimeExceptionView); setSelected(new Set()); }}>
          <TabsList>
            <TabsTrigger value="pending">Pending ({data?.pendingCount ?? 0})</TabsTrigger>
            <TabsTrigger value="decided">Decided</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search employee or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-56"
        />
        {departments.length > 0 && (
          <select
            aria-label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            <span className="self-center text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => open([...selected], "approved_official")}>
              <Briefcase className="size-3.5" /> Company work
            </Button>
            <Button size="sm" variant="outline" onClick={() => open([...selected], "approved_excused")}>
              <Check className="size-3.5" /> Excuse
            </Button>
            <Button size="sm" variant="outline" onClick={() => open([...selected], "rejected")}>
              <X className="size-3.5" /> Reject
            </Button>
          </div>
        )}
      </div>

      {!isLoading && items.length === 0 ? (
        <GenericEmpty
          icon={HREmptyIllustration}
          title={view === "pending" ? "Nothing to review" : "No late or early items"}
          description="Late arrivals and early departures past the grace period appear here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(items.map((item) => item.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Checkbox aria-label={`Select ${item.employeeName}`} checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{item.employeeName}</div>
                  <div className="text-xs text-muted-foreground">{item.employeeCode}{item.department ? ` · ${item.department}` : ""}</div>
                </TableCell>
                <TableCell>{format(parseISO(item.date), "dd MMM yyyy")}</TableCell>
                <TableCell>{item.kind === "late" ? "Late arrival" : "Early departure"}</TableCell>
                <TableCell>{shortTime(item.expectedTime)}</TableCell>
                <TableCell>{shortTime(item.actualTime)}</TableCell>
                <TableCell>{formatExceptionMinutes(item.minutes)}</TableCell>
                <TableCell>
                  <Badge variant={item.status === "rejected" ? "destructive" : item.status === "pending" ? "outline" : "secondary"}>
                    {TIME_EXCEPTION_STATUS_LABELS[item.status]}
                  </Badge>
                  {item.decidedByName && (
                    <div className="mt-1 text-xs text-muted-foreground">by {item.decidedByName}{item.note ? ` — ${item.note}` : ""}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Company work" onClick={() => open([item.id], "approved_official")}><Briefcase className="size-4" /></Button>
                    <Button size="sm" variant="ghost" title="Excuse" onClick={() => open([item.id], "approved_excused")}><Check className="size-4" /></Button>
                    <Button size="sm" variant="ghost" title="Reject" onClick={() => open([item.id], "rejected")}><X className="size-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={!!decision} onOpenChange={(isOpen) => !isOpen && setDecision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decision ? DECISION_TITLES[decision.status] : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision?.status === "rejected"
                ? `${decision.ids.length} item(s) will be deducted from salary.`
                : `${decision?.ids.length ?? 0} item(s) will not be deducted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={noteRequired ? "What was the company work? (required)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={decide.isPending || (noteRequired && !note.trim())} onClick={confirm}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Check `GenericEmpty`'s props by opening `src/components/custom/empty.tsx` and how `overtime-approvals-container.tsx` calls it; match that call shape exactly.

- [ ] **Step 2: Add the tab**

In `src/routes/_protected/hr/approvals/index.tsx`:
1. Imports: `LateEarlyApprovalsContainer`, `getTimeExceptionsFn`, `useViewerAccess` from `@/hooks/use-viewer-access`, `hasPermission` from `@/lib/rbac`, and `Timer` from `lucide-react`.
2. Loader: add

```ts
    void queryClient.prefetchQuery({
      queryKey: ["time-exceptions", "pending", null],
      queryFn: () => getTimeExceptionsFn({ data: { view: "pending" } }),
    });
```

The prefetch fails with 403 for users without `hr.manage`; `prefetchQuery` swallows errors, so this is safe.
3. `type ApprovalTab = "overtime" | "leave" | "lateEarly" | "advances" | "removal";`
4. In `ApprovalsPage`: `const { data: viewerAccess } = useViewerAccess(); const canDecideLateEarly = !!viewerAccess && hasPermission(viewerAccess.permissions, "hr.manage");`
5. After the Leave `TabsTrigger`, render only when `canDecideLateEarly`:

```tsx
              {canDecideLateEarly && (
                <TabsTrigger
                  value="lateEarly"
                  className="gap-2 px-4 h-8 text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-background data-[state=active]: rounded-md transition-all"
                >
                  <Timer className="size-3.5 opacity-70" />
                  Late / Early
                </TabsTrigger>
              )}
```

6. Matching content after the leave `TabsContent`:

```tsx
            {canDecideLateEarly && (
              <TabsContent value="lateEarly" className="mt-0 outline-none">
                <Suspense fallback={<GenericLoader title="Loading late/early items" description="Fetching pending items..." />}>
                  <LateEarlyApprovalsContainer />
                </Suspense>
              </TabsContent>
            )}
```

7. Update the header description to "Review and manage overtime, leave, late/early, salary advance, and employee removal requests."

- [ ] **Step 3: Verify in the browser**

Run `bun run typecheck`, then `bun run dev`. Log in as an HR manager and open `/hr/approvals` → Late / Early. Using the punches from Task 4 (25 min late): the row shows. Click Company work: the confirm button stays disabled until a note is typed. Confirm, and the row leaves Pending and shows under Decided "Company work by <name> — <note>". Log in as a user with only `hr.view`: the tab is not shown.

- [ ] **Step 4: Commit**

```bash
git add src/components/hr/attendance/late-early-approvals-container.tsx src/routes/_protected/hr/approvals/index.tsx
git commit -m "feat(hr): add Late / Early approvals tab"
```

---

### Task 9: Inline decisions in the edit-attendance sheet

**Files:**
- Create: `src/components/hr/attendance/time-exception-decisions.tsx`
- Modify: `src/components/hr/attendance/edit-attendance-form.tsx` (the `<form.Field name="earlyDepartureStatus">` block, ~lines 1990–2060)
- Test: `src/components/hr/attendance/edit-attendance-form.behavior.test.tsx` (only if it asserts the old "Early Leave Review" select)

**Interfaces:**
- Consumes: Task 7 hooks; Task 2 formatting and labels.
- Produces: `TimeExceptionDecisions({ attendanceId }: { attendanceId: string | undefined })`.

The old early-departure select ("Approved" meant "cut pay") contradicts the new rule, so it is replaced. The form still submits whatever `earlyDepartureStatus` value it holds; that column is now legacy and no longer read by payroll for days that have items.

- [ ] **Step 1: Build the panel**

```tsx
import { useState } from "react";
import { Briefcase, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { useDecideTimeExceptions, useTimeExceptions } from "@/hooks/hr/use-time-exceptions";
import {
  formatExceptionMinutes,
  TIME_EXCEPTION_STATUS_LABELS,
  type TimeExceptionDecision,
} from "@/lib/attendance/time-exceptions";

export function TimeExceptionDecisions({ attendanceId }: { attendanceId: string | undefined }) {
  const { data: viewerAccess } = useViewerAccess();
  const canDecide = !!viewerAccess && hasPermission(viewerAccess.permissions, "hr.manage");
  const { data } = useTimeExceptions("all", attendanceId);
  const decide = useDecideTimeExceptions();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (!attendanceId || !canDecide) return null;
  const items = data?.items ?? [];
  if (items.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">No late arrival or early departure on this day.</p>;
  }

  const save = (id: string, status: TimeExceptionDecision) =>
    decide.mutate({ ids: [id], status, note: notes[id]?.trim() || undefined });

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const label = `${item.kind === "late" ? "Late arrival" : "Early departure"} ${formatExceptionMinutes(item.minutes)}`;
        if (item.status === "grace") {
          return (
            <div key={item.id} className="text-[13px] text-muted-foreground">
              {label} — grace applied
            </div>
          );
        }
        const note = notes[item.id] ?? item.note ?? "";
        return (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2 text-[13px] font-medium">
              <span>{label}</span>
              <Badge variant={item.status === "rejected" ? "destructive" : item.status === "pending" ? "outline" : "secondary"}>
                {TIME_EXCEPTION_STATUS_LABELS[item.status]}
              </Badge>
            </div>
            <Input
              placeholder="Note (required for company work)"
              value={note}
              onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))}
              className="h-8 text-[13px]"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={decide.isPending || !note.trim()} onClick={() => save(item.id, "approved_official")}>
                <Briefcase className="size-3.5" /> Company work
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={decide.isPending} onClick={() => save(item.id, "approved_excused")}>
                <Check className="size-3.5" /> Excuse
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={decide.isPending} onClick={() => save(item.id, "rejected")}>
                <X className="size-3.5" /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Buttons use `type="button"` so they don't submit the surrounding attendance form.

- [ ] **Step 2: Replace the old block**

In `edit-attendance-form.tsx`, replace the whole `<form.Field name="earlyDepartureStatus"> ... </form.Field>` block with:

```tsx
                      <Field className="space-y-1.5 mt-2">
                        <div className="rounded-xl border border-border/60 bg-background p-5 shadow-sm">
                          <div className="flex items-start gap-4">
                            <div className="p-2 bg-muted rounded-lg shrink-0 border border-border/40">
                              <Info aria-hidden="true" className="size-5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 space-y-3">
                              <div className="space-y-1">
                                <FieldLabel className="text-[14px] font-bold text-foreground/90">
                                  Late / Early Review
                                </FieldLabel>
                                <p className="text-[12.5px] leading-relaxed text-muted-foreground font-medium">
                                  Pay is cut only for items marked Rejected. Save punch changes first; items update after saving.
                                </p>
                              </div>
                              <TimeExceptionDecisions attendanceId={attendance?.id} />
                            </div>
                          </div>
                        </div>
                      </Field>
```

Add `import { TimeExceptionDecisions } from "./time-exception-decisions";`. Check the variable holding the current attendance row in this component (it is referenced as `attendance?.isLate` near line 1354) and use its `id`; if `id` is not on that prop type, add `id?: string` to the prop type at ~line 929 and pass it from `edit-attendance-sheet.tsx`.

Remove imports and the `EarlyDepartureStatus` type that become unused. Leave `earlyDepartureStatus` in form default values and in the auto-populate logic so submit payloads don't change.

- [ ] **Step 3: Run tests and typecheck**

Run: `bun run test src/components/hr/attendance && bun run typecheck`
Expected: PASS. If a behavior test looks up the "Early departure status" combobox, replace that assertion with one that the "Late / Early Review" heading renders.

- [ ] **Step 4: Verify in the browser**

Open an attendance day with a 25-minute late item in the edit sheet. Click Reject: the badge turns to Rejected and the Late / Early tab count drops by one.

- [ ] **Step 5: Commit**

```bash
git add src/components/hr/attendance/time-exception-decisions.tsx src/components/hr/attendance/edit-attendance-form.tsx src/components/hr/attendance/edit-attendance-sheet.tsx src/components/hr/attendance/edit-attendance-form.behavior.test.tsx
git commit -m "feat(hr): decide late/early items from the attendance sheet"
```

---

### Task 10: Badges in the employee attendance log

**Files:**
- Modify: `src/lib/attendance/day-issues.ts`
- Modify: `src/server-functions/hr/attendance/get-employee-attendance-log-fn.ts` (~line 32)
- Modify: `src/components/hr/attendance/employee-attendance-log.tsx` (~line 229, only if it builds `record` by picking fields)
- Test: `src/lib/attendance/day-issues.test.ts`

**Interfaces:**
- Consumes: Task 2 `formatExceptionMinutes`, `TIME_EXCEPTION_STATUS_LABELS`, `TimeExceptionKind`, `TimeExceptionStatus`.
- Produces: `DayIssueRecord.timeExceptions?: Array<{ kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus }>`. When present, the `late` and `early_departure` issues come from items; when absent, the old logic runs.

- [ ] **Step 1: Write the failing tests**

Add to `day-issues.test.ts` (reuse the file's existing helpers for `employee`, `date`, `today`, and a present `record`; the snippet below assumes a `baseInput` helper. If none exists, build the input the same way the existing "late" test does):

```ts
  it("labels late/early items with their outcome", () => {
    const issues = getDayIssues({
      ...baseInput,
      record: {
        ...baseInput.record!,
        isLate: true,
        timeExceptions: [
          { kind: "late", minutes: 40, status: "pending" },
          { kind: "early", minutes: 120, status: "approved_official" },
        ],
      },
    });
    expect(issues).toContainEqual({ kind: "late", severity: "action", label: "Late (40 min · Pending)" });
    expect(issues).toContainEqual({ kind: "early_departure", severity: "info", label: "Early departure (2h · Company work)" });
  });

  it("shows grace as info and rejected as a deduction", () => {
    const issues = getDayIssues({
      ...baseInput,
      record: {
        ...baseInput.record!,
        timeExceptions: [
          { kind: "late", minutes: 10, status: "grace" },
          { kind: "early", minutes: 30, status: "rejected" },
        ],
      },
    });
    expect(issues).toContainEqual({ kind: "late", severity: "info", label: "Late (10 min · Grace)" });
    expect(issues).toContainEqual({ kind: "early_departure", severity: "deduction", label: "Early departure (30 min · Rejected)" });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/attendance/day-issues.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `day-issues.ts`, import from `./time-exceptions` and add to `DayIssueRecord`:

```ts
  timeExceptions?: Array<{ kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus }> | null;
```

Replace the `if (record.isLate) { ... }` and `if (record.earlyDepartureStatus ...) { ... }` blocks with:

```ts
    if (record.timeExceptions?.length) {
      for (const item of record.timeExceptions) {
        const severity: DayIssueSeverity =
          item.status === "pending" ? "action" : item.status === "rejected" ? "deduction" : "info";
        add(
          item.kind === "late" ? "late" : "early_departure",
          severity,
          `(${formatExceptionMinutes(item.minutes)} · ${TIME_EXCEPTION_STATUS_LABELS[item.status]})`,
        );
      }
    } else {
      const shift = employee.shifts?.[0];
      if (record.isLate) {
        const late = minutesBetween(shift?.start, record.checkIn);
        add("late", "deduction", late ? `(${late}m)` : undefined);
      }
      if (record.earlyDepartureStatus && record.earlyDepartureStatus !== "none") {
        // ... keep the existing early-departure block body here unchanged ...
      }
    }
```

Move the existing early-departure block body into the `else` exactly as it is now. The existing rule after it ("Late only costs pay when the day ends up short") must only demote `late` when there are no items; wrap it in `if (!record.timeExceptions?.length)`.

In `get-employee-attendance-log-fn.ts`, add to the `attendance.findMany`:

```ts
      with: { timeExceptions: { columns: { kind: true, minutes: true, status: true } } },
```

If `employee-attendance-log.tsx` passes the record through as-is, nothing more is needed; if it copies individual fields into `record`, add `timeExceptions: r.timeExceptions`.

- [ ] **Step 4: Run tests**

Run: `bun run test src/lib/attendance && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/day-issues.ts src/lib/attendance/day-issues.test.ts src/server-functions/hr/attendance/get-employee-attendance-log-fn.ts src/components/hr/attendance/employee-attendance-log.tsx
git commit -m "feat(hr): show late/early outcomes in the attendance log"
```

---

### Task 11: Full verification

- [ ] **Step 1: Whole suite, typecheck, build**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all pass. Report any failure with its output; do not skip.

- [ ] **Step 2: End-to-end check of the spec examples**

With `bun run dev`, for one test employee on a 09:00–17:00 shift in an open (draft) payroll month:
1. Day A: IN 09:10, OUT 17:00 → log shows "Late (10 min · Grace)"; payslip preview line "Late arrival 10 min — grace applied — no deduction", no cut.
2. Day B: IN 09:00, OUT 15:00 → Late / Early tab shows a 2h early item. Approve as company work with note "Bank deposit" → payslip line "Early departure 2h — Approved (company work) by <you> — no deduction".
3. Day C: IN 09:30, OUT 17:00, reject → payslip cuts 30 minutes.
4. Day D: IN 09:40, OUT 17:00, leave pending → payroll page warning lists "1 late/early item (will not be deducted)"; payslip line "Not reviewed — no deduction".
5. Approve the payroll, then try to decide Day D → error "Attendance belongs to approved or paid payroll...".

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Commit any leftovers**

```bash
git status
git add -A && git commit -m "chore(hr): late/early approvals verification fixes"
```

(Skip the commit if nothing changed.)
