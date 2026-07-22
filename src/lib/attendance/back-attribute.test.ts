import { describe, expect, it } from "vitest";
import { resolveAttendanceDate, type LastPunch } from "./back-attribute";

const opts = { overnightOutBeforeHour: 12 };

function pktDateTime(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute));
}

function lastPunch(
  direction: "in" | "out",
  attendanceDate: string,
): LastPunch {
  return {
    direction,
    attendanceDate,
    timestamp: pktDateTime(attendanceDate, direction === "in" ? 21 : 6).toISOString(),
  };
}

describe("resolveAttendanceDate", () => {
  it("starts first punch as today's check-in", () => {
    expect(resolveAttendanceDate(pktDateTime("2026-06-02", 9), null, opts)).toEqual({
      attendanceDate: "2026-06-02",
      direction: "in",
      isOvernightCheckout: false,
    });
  });

  it("starts a new check-in after an out punch", () => {
    expect(
      resolveAttendanceDate(
        pktDateTime("2026-06-02", 13),
        lastPunch("out", "2026-06-02"),
        opts,
      ),
    ).toEqual({
      attendanceDate: "2026-06-02",
      direction: "in",
      isOvernightCheckout: false,
    });
  });

  it("back-attributes yesterday's open night shift checkout before noon", () => {
    expect(
      resolveAttendanceDate(
        pktDateTime("2026-06-02", 9),
        lastPunch("in", "2026-06-01"),
        opts,
      ),
    ).toEqual({
      attendanceDate: "2026-06-01",
      direction: "out",
      isOvernightCheckout: true,
    });
  });

  it("does not back-attribute after noon", () => {
    expect(
      resolveAttendanceDate(
        pktDateTime("2026-06-02", 13),
        lastPunch("in", "2026-06-01"),
        opts,
      ),
    ).toEqual({
      attendanceDate: "2026-06-02",
      direction: "in",
      isOvernightCheckout: false,
    });
  });

  it("does not back-attribute stale open punches from older days", () => {
    expect(
      resolveAttendanceDate(
        pktDateTime("2026-06-03", 9),
        lastPunch("in", "2026-06-01"),
        opts,
      ),
    ).toEqual({
      attendanceDate: "2026-06-03",
      direction: "in",
      isOvernightCheckout: false,
    });
  });
});

