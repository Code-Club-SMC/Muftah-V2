import { describe, expect, it } from "vitest";
import {
  buildOvertimeRequestSummary,
  calculateSuggestedOvertimeHours,
  normalizeRequestedOvertimeHours,
  revalidateOvertimeRequest,
} from "./overtime-request";

describe("overtime request rules", () => {
  it("calculates suggested overtime from worked hours and standard hours", () => {
    expect(calculateSuggestedOvertimeHours("10.00", 8)).toBe(2);
  });

  it("marks the request valid when requested OT matches the suggestion", () => {
    expect(
      buildOvertimeRequestSummary({
        dutyHours: "10.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "2.00",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 2,
      requestedOvertimeHours: 2,
      state: "valid",
      warning: null,
    });
  });

  it("marks the request as a soft mismatch when punches suggest more OT", () => {
    expect(
      buildOvertimeRequestSummary({
        dutyHours: "10.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "1.50",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 2,
      requestedOvertimeHours: 1.5,
      state: "soft_mismatch",
      warning:
        "Punches changed. Current OT request is lower than the latest suggested OT. Update it if needed.",
    });
  });

  it("marks the request stale when requested OT is above the suggestion", () => {
    expect(
      buildOvertimeRequestSummary({
        dutyHours: "10.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "3.00",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 2,
      requestedOvertimeHours: 3,
      state: "stale",
      warning: "Requested OT cannot be more than the suggested OT.",
    });
  });

  it("returns none when there is no overtime suggestion and no request", () => {
    expect(
      buildOvertimeRequestSummary({
        dutyHours: "8.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "0.00",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 0,
      requestedOvertimeHours: 0,
      state: "none",
      warning: null,
    });
  });

  it("normalizes invalid request values to zero safely", () => {
    expect(normalizeRequestedOvertimeHours(null)).toBe(0);
    expect(normalizeRequestedOvertimeHours(undefined)).toBe(0);
    expect(normalizeRequestedOvertimeHours("")).toBe(0);
    expect(normalizeRequestedOvertimeHours("abc")).toBe(0);
    expect(normalizeRequestedOvertimeHours(-2)).toBe(0);
  });

  it("resets approved OT back to pending when punches make the request stale", () => {
    expect(
      revalidateOvertimeRequest({
        dutyHours: "9.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "2.00",
        currentOvertimeStatus: "approved",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 1,
      requestedOvertimeHours: 2,
      state: "stale",
      currentOvertimeStatus: "approved",
      nextOvertimeStatus: "pending",
      shouldResetStatus: true,
    });
  });

  it("keeps the current OT status when punches suggest even more time", () => {
    expect(
      revalidateOvertimeRequest({
        dutyHours: "11.00",
        standardDutyHours: 8,
        requestedOvertimeHours: "2.00",
        currentOvertimeStatus: "approved",
      }),
    ).toMatchObject({
      suggestedOvertimeHours: 3,
      requestedOvertimeHours: 2,
      state: "soft_mismatch",
      currentOvertimeStatus: "approved",
      nextOvertimeStatus: "approved",
      shouldResetStatus: false,
    });
  });
});
