import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  claims: vi.fn(),
  punches: vi.fn(),
  records: vi.fn(),
  payrolls: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("../offline/payroll-invalidation.server", () => ({
  invalidateDraftPayrollsForAttendance: mock.invalidate,
}));
vi.mock("@/db", async () => ({
  db: { query: {} },
  ...(await import("@/db/schemas/hr-schema")),
  ...(await import("@/db/schemas/offline-attendance-schema")),
}));
import {
  assertDeviceAttendanceResolved,
  invalidateDeviceAttendanceChanges,
} from "./payroll.server";
const reader = {
  query: {
    deviceAttendancePunchClaims: { findMany: mock.claims },
    attendancePunches: { findMany: mock.punches },
    attendance: { findMany: mock.records },
    payrolls: { findMany: mock.payrolls },
  },
} as unknown as Parameters<typeof assertDeviceAttendanceResolved>[0];
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
function setup(status = "present", out = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00+05:00"));
  mock.claims.mockResolvedValue([{ attendanceDate: "2026-10-13" }]);
  mock.records.mockResolvedValue([{ date: "2026-10-13", status }]);
  mock.punches.mockResolvedValue([
    {
      id: "in",
      timestamp: new Date("2026-10-13T08:00:00+05:00"),
      attendanceDate: "2026-10-13",
      direction: "in",
    },
    ...(out
      ? [
          {
            id: "out",
            timestamp: new Date("2026-10-13T17:00:00+05:00"),
            attendanceDate: "2026-10-13",
            direction: "out",
          },
        ]
      : []),
  ]);
}
describe("device attendance payroll review gate", () => {
  it("blocks a past day with an unmatched imported IN", async () => {
    setup("present", false);
    await expect(
      assertDeviceAttendanceResolved(reader, "emp", "2026-10-01", "2026-10-31"),
    ).rejects.toThrow("needs HR review");
  });
  it("allows HR's explicit absence decision without inventing a checkout", async () => {
    setup("absent", false);
    await expect(
      assertDeviceAttendanceResolved(reader, "emp", "2026-10-01", "2026-10-31"),
    ).resolves.toBeUndefined();
  });
  it("allows completed intervals", async () => {
    setup();
    await expect(
      assertDeviceAttendanceResolved(reader, "emp", "2026-10-01", "2026-10-31"),
    ).resolves.toBeUndefined();
  });
  it("keeps deleted punch evidence unresolved until HR decides the day", async () => {
    setup();
    mock.punches.mockResolvedValue([]);
    mock.records.mockResolvedValue([]);
    await expect(
      assertDeviceAttendanceResolved(reader, "emp", "2026-10-01", "2026-10-31"),
    ).rejects.toThrow("needs HR review");
  });
  it("does not treat today's ongoing shift as a historical missing checkout", async () => {
    setup("present", false);
    mock.claims.mockResolvedValue([{ attendanceDate: "2026-10-14" }]);
    await expect(
      assertDeviceAttendanceResolved(reader, "emp", "2026-10-01", "2026-10-31"),
    ).resolves.toBeUndefined();
    expect(mock.punches).not.toHaveBeenCalled();
  });
});

describe("device correction payroll dates", () => {
  const tx = reader as Parameters<typeof invalidateDeviceAttendanceChanges>[0];
  it("checks a move's approved destination even when only its origin has a claim", async () => {
    mock.claims.mockResolvedValue([
      { attendanceDate: "2026-09-30", importId: "import-1" },
    ]);
    mock.payrolls.mockResolvedValue([
      { startDate: "2026-10-01", endDate: "2026-10-31", status: "approved" },
    ]);
    await expect(
      invalidateDeviceAttendanceChanges(tx, "emp", [
        "2026-09-30",
        "2026-10-01",
      ]),
    ).rejects.toThrow("approved or paid payroll");
    expect(mock.invalidate).not.toHaveBeenCalled();
  });
  it("invalidates both affected dates using the available import origin", async () => {
    mock.claims.mockResolvedValue([
      { attendanceDate: "2026-09-30", importId: "import-1" },
    ]);
    mock.payrolls.mockResolvedValue([]);
    await invalidateDeviceAttendanceChanges(tx, "emp", [
      "2026-09-30",
      "2026-10-01",
      "2026-10-01",
    ]);
    expect(mock.invalidate.mock.calls.map(([, input]) => input)).toEqual([
      {
        deviceImportId: "import-1",
        employeeId: "emp",
        attendanceDate: "2026-09-30",
      },
      {
        deviceImportId: "import-1",
        employeeId: "emp",
        attendanceDate: "2026-10-01",
      },
    ]);
  });
  it("invalidates manual salary inputs even without a device claim", async () => {
    mock.claims.mockResolvedValue([]);
    mock.payrolls.mockResolvedValue([]);
    await invalidateDeviceAttendanceChanges(tx, "emp", ["2026-10-01"]);
    expect(mock.payrolls).toHaveBeenCalled();
    expect(mock.invalidate).toHaveBeenCalledWith(tx, {
      employeeId: "emp",
      attendanceDate: "2026-10-01",
    });
  });
  it("refuses a manual leave change in finalized payroll without a device claim", async () => {
    mock.claims.mockResolvedValue([]);
    mock.payrolls.mockResolvedValue([
      { startDate: "2026-09-16", endDate: "2026-10-15", status: "paid" },
    ]);
    await expect(
      invalidateDeviceAttendanceChanges(tx, "emp", ["2026-10-01"]),
    ).rejects.toThrow("approved or paid payroll");
    expect(mock.invalidate).not.toHaveBeenCalled();
  });
});
