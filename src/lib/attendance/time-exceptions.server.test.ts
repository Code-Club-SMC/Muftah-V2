import { describe, expect, it, vi } from "vitest";
import type { AttendanceTx } from "./recompute-server";
import { syncAttendanceTimeExceptions } from "./time-exceptions.server";

describe("syncAttendanceTimeExceptions", () => {
  it("returns a decided item to grace when punches move it inside grace, keeping an audit entry", async () => {
    const existing = {
      id: "item",
      attendanceId: "day",
      employeeId: "emp",
      date: "2026-10-13",
      shiftIndex: 0,
      kind: "late",
      minutes: 90,
      status: "approved_official",
      note: "Client visit",
      decidedBy: "boss",
      decidedAt: new Date("2026-10-13T12:00:00Z"),
      history: [],
    };
    const set = vi.fn(() => ({ where: async () => undefined }));
    const tx = {
      query: { attendanceTimeExceptions: { findMany: async () => [existing] } },
      update: () => ({ set }),
    } as unknown as AttendanceTx;

    await syncAttendanceTimeExceptions(
      tx,
      { id: "day", employeeId: "emp", date: "2026-10-13" },
      [{ shiftIndex: 0, late: false, earlyDeparture: false, lateMinutes: 5, earlyMinutes: null }],
    );

    expect(set).toHaveBeenCalledTimes(1);
    const payload = (set.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      minutes: 5,
      status: "grace",
      note: null,
      decidedBy: null,
      decidedAt: null,
    });
    expect(payload.history).toEqual([
      expect.objectContaining({ status: "grace", note: "Recomputed from punches", decidedBy: null }),
    ]);
  });
});
