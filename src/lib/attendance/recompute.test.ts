import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeAttendanceFromPunches, type Punch } from "./recompute";

const opts = {
  shifts: [{ start: "08:00:00", end: "16:00:00" }],
  graceMinutes: 15,
  nightShiftStartHour: 20,
};

const noShifts = {
  shifts: [],
  graceMinutes: 15,
  nightShiftStartHour: 20,
};

const nightOpts = {
  shifts: [{ start: "21:00:00", end: "06:00:00" }],
  graceMinutes: 15,
  nightShiftStartHour: 20,
};

const multiShiftOpts = {
  shifts: [
    { start: "08:00:00", end: "12:00:00" },
    { start: "13:00:00", end: "17:00:00" },
  ],
  graceMinutes: 15,
  nightShiftStartHour: 20,
};

function pktIso(date: string, hour: number, minute = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute)).toISOString();
}

function punch(direction: "in" | "out", date: string, hour: number, minute = 0): Punch {
  return {
    direction,
    timestamp: pktIso(date, hour, minute),
  };
}

function alternatingPunches(count: number): Punch[] {
  return Array.from({ length: count }, (_, index) => ({
    direction: index % 2 === 0 ? "in" : "out",
    timestamp: pktIso("2026-06-01", 8 + Math.floor(index / 2), index % 2 === 0 ? 0 : 30),
  }));
}

describe("computeAttendanceFromPunches", () => {
  it("computes a single completed in/out interval", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8), punch("out", "2026-06-01", 16)],
      opts,
    );

    expect(result).toMatchObject({
      checkIn: "08:00:00",
      checkOut: "16:00:00",
      dutyHours: "8.00",
      isLate: false,
      isNightShift: false,
      earlyDepartureStatus: "none",
      openInCount: 0,
    });
  });

  it("sums split-shift intervals", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8),
        punch("out", "2026-06-01", 12),
        punch("in", "2026-06-01", 13),
        punch("out", "2026-06-01", 17),
      ],
      opts,
    );

    expect(result.checkIn).toBe("08:00:00");
    expect(result.checkOut).toBe("17:00:00");
    expect(result.dutyHours).toBe("8.00");
  });

  it("keeps an open in punch visible without adding duty hours", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8)],
      opts,
    );

    expect(result).toMatchObject({
      checkIn: "08:00:00",
      checkOut: null,
      dutyHours: "0.00",
      earlyDepartureStatus: "pending",
      openInCount: 1,
    });
  });

  it("handles overnight night-shift intervals", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 21),
        punch("out", "2026-06-02", 6),
      ],
      nightOpts,
    );

    expect(result).toMatchObject({
      checkIn: "21:00:00",
      checkOut: "06:00:00",
      dutyHours: "9.00",
      isNightShift: true,
    });
  });

  it("marks early departure when checkout is before the scheduled shift end", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8), punch("out", "2026-06-01", 15, 45)],
      opts,
    );

    expect(result.earlyDepartureStatus).toBe("pending");
  });

  it("marks overnight early departure against the next-day shift end", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 21), punch("out", "2026-06-02", 2)],
      nightOpts,
    );

    expect(result.earlyDepartureStatus).toBe("pending");
  });

  it("does not flag early departure for overnight punches that start after midnight", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-02", 0, 30), punch("out", "2026-06-02", 6)],
      nightOpts,
    );

    expect(result.earlyDepartureStatus).toBe("none");
  });

  it("applies shift grace exactly", () => {
    const atGrace = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8, 15)],
      opts,
    );
    const afterGrace = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8, 16)],
      opts,
    );

    expect(atGrace.isLate).toBe(false);
    expect(afterGrace.isLate).toBe(true);
  });

  it("preserves late state when no shifts are configured", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 10)],
      noShifts,
    );

    expect(result.isLate).toBeNull();
  });

  it("returns an empty row for no punches", () => {
    expect(computeAttendanceFromPunches([], opts)).toEqual({
      checkIn: null,
      checkOut: null,
      dutyHours: "0.00",
      isLate: null,
      isNightShift: false,
      earlyDepartureStatus: "none",
      openInCount: 0,
      shiftViolations: [],
    });
  });

  it("allows zero-duration intervals", () => {
    const result = computeAttendanceFromPunches(
      [punch("in", "2026-06-01", 8), punch("out", "2026-06-01", 8)],
      opts,
    );

    expect(result.dutyHours).toBe("0.00");
  });
});

describe("computeAttendanceFromPunches multi-shift", () => {
  it("detects late on shift 2 but not shift 1", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8, 0),
        punch("out", "2026-06-01", 12, 0),
        punch("in", "2026-06-01", 13, 20),
        punch("out", "2026-06-01", 17, 0),
      ],
      multiShiftOpts,
    );

    expect(result.isLate).toBe(true);
    expect(result.shiftViolations[0].late).toBe(false);
    expect(result.shiftViolations[1].late).toBe(true);
  });

  it("detects early departure on shift 1 but not shift 2", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8, 0),
        punch("out", "2026-06-01", 11, 30),
        punch("in", "2026-06-01", 13, 0),
        punch("out", "2026-06-01", 17, 0),
      ],
      multiShiftOpts,
    );

    expect(result.earlyDepartureStatus).toBe("pending");
    expect(result.shiftViolations[0].earlyDeparture).toBe(true);
    expect(result.shiftViolations[1].earlyDeparture).toBe(false);
  });

  it("flags a missing shift as both late and early departure", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8, 0),
        punch("out", "2026-06-01", 12, 0),
      ],
      multiShiftOpts,
    );

    expect(result.isLate).toBe(true);
    expect(result.earlyDepartureStatus).toBe("pending");
    expect(result.shiftViolations[0].late).toBe(false);
    expect(result.shiftViolations[0].earlyDeparture).toBe(false);
    expect(result.shiftViolations[1].late).toBe(true);
    expect(result.shiftViolations[1].earlyDeparture).toBe(true);
  });

  it("does not police extra punches beyond configured shifts", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8, 0),
        punch("out", "2026-06-01", 12, 0),
        punch("in", "2026-06-01", 13, 0),
        punch("out", "2026-06-01", 17, 0),
        punch("in", "2026-06-01", 18, 0),
        punch("out", "2026-06-01", 22, 0),
      ],
      multiShiftOpts,
    );

    expect(result.shiftViolations).toHaveLength(2);
    expect(result.dutyHours).toBe("12.00");
  });

  it("stores expected and actual times in shiftViolations", () => {
    const result = computeAttendanceFromPunches(
      [
        punch("in", "2026-06-01", 8, 20),
        punch("out", "2026-06-01", 12, 0),
        punch("in", "2026-06-01", 13, 0),
        punch("out", "2026-06-01", 17, 0),
      ],
      multiShiftOpts,
    );

    expect(result.shiftViolations[0]).toMatchObject({
      shiftIndex: 0,
      late: true,
      expectedIn: "08:00:00",
      actualIn: "08:20:00",
      expectedOut: "12:00:00",
      actualOut: "12:00:00",
    });
    expect(result.shiftViolations[1]).toMatchObject({
      shiftIndex: 1,
      late: false,
      earlyDeparture: false,
      expectedIn: "13:00:00",
      actualIn: "13:00:00",
      expectedOut: "17:00:00",
      actualOut: "17:00:00",
    });
  });
});

describe("computeAttendanceFromPunches properties", () => {
  it("is idempotent for arbitrary punch arrays", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            direction: fc.constantFrom<"in" | "out">("in", "out"),
            minuteOffset: fc.integer({ min: 0, max: 36 * 60 }),
          }),
          { maxLength: 20 },
        ),
        (items) => {
          const punches = items.map((item) => ({
            direction: item.direction,
            timestamp: new Date(Date.UTC(2026, 5, 1, 3, 0) + item.minuteOffset * 60_000).toISOString(),
          }));

          expect(computeAttendanceFromPunches(punches, opts)).toEqual(
            computeAttendanceFromPunches(punches, opts),
          );
        },
      ),
    );
  });

  it("keeps generated scan sequences balanced", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 21 }), (count) => {
        const punches = alternatingPunches(count);
        const ins = punches.filter((item) => item.direction === "in").length;
        const outs = punches.filter((item) => item.direction === "out").length;

        expect(Math.abs(ins - outs)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("never returns negative duty hours", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 21 }), (count) => {
        const result = computeAttendanceFromPunches(alternatingPunches(count), opts);

        expect(Number(result.dutyHours)).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
