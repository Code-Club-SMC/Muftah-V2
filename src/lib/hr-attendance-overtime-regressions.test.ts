import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  revalidateOvertimeRequest,
  buildOvertimeRequestSummary,
} from "./attendance/overtime-request";
import { sumApprovedOvertimeHours } from "./payroll-calculator";

describe("Phase 7 — attendance/payroll overtime regressions", () => {
  it("approved request becomes pending again when punches make it stale", () => {
    const revalidation = revalidateOvertimeRequest({
      dutyHours: "9.00",
      standardDutyHours: 8,
      requestedOvertimeHours: "2.00",
      currentOvertimeStatus: "approved",
    });

    expect(revalidation.currentOvertimeStatus).toBe("approved");
    expect(revalidation.shouldResetStatus).toBe(true);
    expect(revalidation.nextOvertimeStatus).toBe("pending");
  });

  it("valid approved request stays approved when punches still support it", () => {
    const revalidation = revalidateOvertimeRequest({
      dutyHours: "10.00",
      standardDutyHours: 8,
      requestedOvertimeHours: "2.00",
      currentOvertimeStatus: "approved",
    });

    expect(revalidation.shouldResetStatus).toBe(false);
    expect(revalidation.nextOvertimeStatus).toBe("approved");
  });

  it("stale approved row stops paying because status returns to pending", () => {
    const summary = buildOvertimeRequestSummary({
      dutyHours: "9.00",
      standardDutyHours: 8,
      requestedOvertimeHours: "2.00",
    });

    expect(summary.state).toBe("stale");

    const revalidation = revalidateOvertimeRequest({
      dutyHours: "9.00",
      standardDutyHours: 8,
      requestedOvertimeHours: "2.00",
      currentOvertimeStatus: "approved",
    });

    // Payroll only pays approved hours.
    const payableHours = sumApprovedOvertimeHours([
      {
        date: "2026-07-01",
        status: "present",
        dutyHours: "9.00",
        overtimeHours: "2.00",
        isNightShift: false,
        overtimeStatus: revalidation.nextOvertimeStatus,
      },
    ]);

    expect(payableHours).toBe(0);
  });

  it("recompute-server imports and uses revalidateOvertimeRequest", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "./attendance/recompute-server.ts"),
      "utf8",
    );

    expect(src).toContain("revalidateOvertimeRequest");
    expect(src).toContain("nextOvertimeStatus");
  });
});
