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
