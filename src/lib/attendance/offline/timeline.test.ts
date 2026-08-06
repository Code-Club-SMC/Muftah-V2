import { describe, expect, it } from "vitest";
import {
  classifyOfflineTimeline,
  groupOfflineRows,
  resolveOfflineAttendanceDate,
  type ClassifiedOfflineRow,
  type TimelineCandidatePunch,
  type TimelinePolicy,
  type TimelinePunch,
} from "./timeline";

function pktIso(date: string, hour: number, minute = 0, second = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour - 5, minute, second),
  ).toISOString();
}

function openPolicy(overrides: TimelinePolicy = {}): TimelinePolicy {
  return {
    employeeExists: true,
    employeeStatus: "active",
    attendanceStatus: "none",
    payrollStatus: "none",
    confirmedWindow: {
      startsAt: "2026-06-01T00:00:00+05:00",
      endsAt: "2026-06-03T23:59:59+05:00",
    },
    now: "2026-06-04T00:00:00+05:00",
    ...overrides,
  };
}

function livePunch(
  id: string,
  direction: "in" | "out",
  date: string,
  hour: number,
  minute = 0,
): TimelinePunch {
  return {
    id,
    employeeId: "emp-1",
    timestamp: pktIso(date, hour, minute),
    attendanceDate: date,
    direction,
    source: "qr_terminal",
  };
}

function offlinePunch(
  id: string,
  direction: "in" | "out",
  date: string,
  hour: number,
  minute = 0,
  overrides: Partial<TimelineCandidatePunch> = {},
): TimelineCandidatePunch {
  return {
    id,
    employeeId: "emp-1",
    timestamp: pktIso(date, hour, minute),
    attendanceDate: date,
    direction,
    source: "offline_excel",
    candidateRowId: id,
    workbookId: "wb-1",
    recordToken: `token-${id}`,
    contentHash: `hash-${id}`,
    ...overrides,
  };
}

function expectReady(result: ReturnType<typeof classifyOfflineTimeline>) {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error("Expected ready timeline");
  }
  return result;
}

describe("resolveOfflineAttendanceDate", () => {
  it("keeps explicit IN on its own PKT calendar date", () => {
    expect(
      resolveOfflineAttendanceDate(
        { direction: "in", timestamp: pktIso("2026-06-01", 8) },
        null,
      ),
    ).toEqual({
      ok: true,
      attendanceDate: "2026-06-01",
      isNightShift: false,
    });
  });

  it("attributes early-morning OUT to the previous open IN date", () => {
    expect(
      resolveOfflineAttendanceDate(
        { direction: "out", timestamp: pktIso("2026-06-02", 6) },
        livePunch("prev-in", "in", "2026-06-01", 22),
      ),
    ).toEqual({
      ok: true,
      attendanceDate: "2026-06-01",
      isNightShift: true,
    });
  });

  it("rejects unsafe OUT punches without an open IN", () => {
    expect(
      resolveOfflineAttendanceDate(
        { direction: "out", timestamp: pktIso("2026-06-01", 17) },
        null,
      ),
    ).toMatchObject({
      ok: false,
      reasonCode: "missing_open_in",
    });
  });

  it("does not back-attribute after-noon checkout", () => {
    expect(
      resolveOfflineAttendanceDate(
        { direction: "out", timestamp: pktIso("2026-06-02", 13) },
        livePunch("prev-in", "in", "2026-06-01", 22),
      ),
    ).toMatchObject({
      ok: false,
      reasonCode: "unmatched_checkout",
    });
  });
});

describe("classifyOfflineTimeline", () => {
  it("accepts online IN plus offline OUT", () => {
    const result = classifyOfflineTimeline({
      existing: [livePunch("online-in", "in", "2026-06-01", 8)],
      candidates: [offlinePunch("offline-out", "out", "2026-06-01", 17)],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "ready",
      attendanceDate: "2026-06-01",
      isNightShift: false,
    });
  });

  it("accepts a complete offline IN/OUT pair", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("offline-in", "in", "2026-06-01", 8),
        offlinePunch("offline-out", "out", "2026-06-01", 17),
      ],
      policy: openPolicy(),
    });

    expect(result.status).toBe("ready");
    expect(result.candidateRows.map((row) => row.candidateRowId)).toEqual([
      "offline-in",
      "offline-out",
    ]);
  });

  it("sorts mixed rows supplied out of order", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("offline-out", "out", "2026-06-01", 17),
        offlinePunch("offline-in", "in", "2026-06-01", 8),
      ],
      policy: openPolicy(),
    });

    expect(result.status).toBe("ready");
    expect(result.timeline.map((punch) => punch.id)).toEqual([
      "offline-in",
      "offline-out",
    ]);
  });

  it("sends IN to IN conflicts to review", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("first-in", "in", "2026-06-01", 8),
        offlinePunch("second-in", "in", "2026-06-01", 9),
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reasonCode: "sequence_conflict",
    });
  });

  it("sends OUT to OUT conflicts to review", () => {
    const result = classifyOfflineTimeline({
      existing: [livePunch("online-in", "in", "2026-06-01", 8)],
      candidates: [
        offlinePunch("first-out", "out", "2026-06-01", 12),
        offlinePunch("second-out", "out", "2026-06-01", 17),
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reasonCode: "sequence_conflict",
    });
  });

  it("marks exact or near online duplicates as duplicate", () => {
    const result = classifyOfflineTimeline({
      existing: [livePunch("online-in", "in", "2026-06-01", 8)],
      candidates: [offlinePunch("offline-in", "in", "2026-06-01", 8, 0, {
        timestamp: pktIso("2026-06-01", 8, 0, 10),
      })],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "duplicate",
      reasonCode: "near_duplicate",
    });
  });

  it("marks exact imported identity as duplicate", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("row-1", "in", "2026-06-01", 8, 0, {
          workbookId: "wb-1",
          recordToken: "token-1",
          contentHash: "same",
        }),
      ],
      importedClaims: [
        { workbookId: "wb-1", recordToken: "token-1", contentHash: "same" },
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "duplicate",
      reasonCode: "already_imported",
    });
  });

  it("sends changed imported identity to review", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("row-1", "in", "2026-06-01", 8, 0, {
          workbookId: "wb-1",
          recordToken: "token-1",
          contentHash: "changed",
        }),
      ],
      importedClaims: [
        { workbookId: "wb-1", recordToken: "token-1", contentHash: "old" },
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reasonCode: "changed_imported_identity",
    });
  });

  it("catches online punch collisions that arrive after upload", () => {
    const result = classifyOfflineTimeline({
      existing: [livePunch("online-out", "out", "2026-06-01", 17)],
      candidates: [
        offlinePunch("offline-in", "in", "2026-06-01", 8),
        offlinePunch("offline-out", "out", "2026-06-01", 18),
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reasonCode: "sequence_conflict",
    });
  });

  it.each(["approved", "paid"] as const)(
    "blocks %s payroll periods",
    (payrollStatus) => {
      const result = classifyOfflineTimeline({
        existing: [],
        candidates: [offlinePunch("offline-in", "in", "2026-06-01", 8)],
        policy: openPolicy({ payrollStatus }),
      });

      expect(result).toMatchObject({
        status: "blocked",
        reasonCode: "payroll_locked",
      });
    },
  );

  it("keeps draft payroll ready but warns", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [offlinePunch("offline-in", "in", "2026-06-01", 8)],
      policy: openPolicy({ payrollStatus: "draft" }),
    });

    const ready = expectReady(result);
    expect(ready.warnings).toContainEqual({
      code: "draft_payroll",
      message: "Draft payroll must be regenerated after import",
    });
  });

  it("invalidates unknown and inactive employees", () => {
    expect(
      classifyOfflineTimeline({
        existing: [],
        candidates: [offlinePunch("unknown", "in", "2026-06-01", 8)],
        policy: openPolicy({ employeeExists: false }),
      }),
    ).toMatchObject({
      status: "invalid",
      reasonCode: "unknown_employee",
    });

    expect(
      classifyOfflineTimeline({
        existing: [],
        candidates: [offlinePunch("inactive", "in", "2026-06-01", 8)],
        policy: openPolicy({ employeeStatus: "inactive" }),
      }),
    ).toMatchObject({
      status: "invalid",
      reasonCode: "inactive_employee",
    });
  });

  it.each(["leave", "holiday", "absent"] as const)(
    "sends %s attendance status to review",
    (attendanceStatus) => {
      const result = classifyOfflineTimeline({
        existing: [],
        candidates: [offlinePunch("offline-in", "in", "2026-06-01", 8)],
        policy: openPolicy({ attendanceStatus }),
      });

      expect(result).toMatchObject({
        status: "needs_review",
        reasonCode: `attendance_${attendanceStatus}`,
      });
    },
  );

  it("keeps rest-day punches ready but warns", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [offlinePunch("rest-day-in", "in", "2026-06-01", 8)],
      policy: openPolicy({ isRestDay: true }),
    });

    const ready = expectReady(result);
    expect(ready.warnings).toContainEqual({
      code: "rest_day",
      message: "Employee is working on a configured rest day",
    });
  });

  it("accepts overnight IN then early-morning OUT on prior attendance date", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [
        offlinePunch("night-in", "in", "2026-06-01", 22),
        offlinePunch("night-out", "out", "2026-06-02", 6),
      ],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "ready",
      attendanceDate: "2026-06-01",
      isNightShift: true,
    });
  });

  it("reviews first event OUT", () => {
    const result = classifyOfflineTimeline({
      existing: [],
      candidates: [offlinePunch("first-out", "out", "2026-06-01", 17)],
      policy: openPolicy(),
    });

    expect(result).toMatchObject({
      status: "needs_review",
      reasonCode: "missing_open_in",
    });
  });

  it("uses neighboring day punches during classification", () => {
    const result = classifyOfflineTimeline({
      existing: [
        livePunch("previous-night-in", "in", "2026-06-01", 22),
        livePunch("next-morning-in", "in", "2026-06-02", 8),
      ],
      candidates: [offlinePunch("night-out", "out", "2026-06-02", 6)],
      policy: openPolicy(),
    });

    const ready = expectReady(result);
    expect(ready.attendanceDate).toBe("2026-06-01");
    expect(result.timeline.map((punch) => punch.id)).toEqual([
      "previous-night-in",
      "night-out",
      "next-morning-in",
    ]);
  });
});

describe("groupOfflineRows", () => {
  it("groups classified rows by employee and attendance date", () => {
    const rows: ClassifiedOfflineRow[] = [
      {
        id: "row-2",
        batchId: "batch-1",
        employeeId: "emp-1",
        attendanceDate: "2026-06-01",
        normalizedTimestamp: pktIso("2026-06-01", 17),
        rawDirection: "OUT",
        status: "ready",
        worksheetRowNumber: 3,
      },
      {
        id: "row-1",
        batchId: "batch-1",
        employeeId: "emp-1",
        attendanceDate: "2026-06-01",
        normalizedTimestamp: pktIso("2026-06-01", 8),
        rawDirection: "IN",
        status: "ready",
        worksheetRowNumber: 2,
      },
      {
        id: "row-3",
        batchId: "batch-1",
        employeeId: "emp-2",
        attendanceDate: "2026-06-01",
        normalizedTimestamp: pktIso("2026-06-01", 9),
        rawDirection: "IN",
        status: "needs_review",
      },
    ];

    const groups = groupOfflineRows(rows);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "emp-1:2026-06-01",
      rowCount: 2,
      readyRowCount: 2,
      status: "ready",
    });
    expect(groups[0].rows.map((row) => row.id)).toEqual(["row-1", "row-2"]);
    expect(groups[1]).toMatchObject({
      key: "emp-2:2026-06-01",
      rowCount: 1,
      readyRowCount: 0,
      status: "needs_review",
    });
  });
});
