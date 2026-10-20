import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { attendancePunches, employees, payrolls } from "@/db/schemas/hr-schema";
import { deviceAttendancePunchClaims } from "@/db/schemas/device-attendance-schema";
import {
  attendancePunchCorrectionAudit,
  payrollAttendanceInvalidations,
} from "@/db/schemas/offline-attendance-schema";

const mock = vi.hoisted(() => ({
  db: {
    query: {} as Record<string, unknown>,
    transaction: vi.fn(),
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  recompute: vi.fn(),
}));
vi.mock("@/db", async () => ({
  db: mock.db,
  ...(await import("@/db/schemas/hr-schema")),
  ...(await import("@/db/schemas/offline-attendance-schema")),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware() {
      return this;
    },
    inputValidator() {
      return this;
    },
    handler(callback: unknown) {
      return callback;
    },
  }),
}));
vi.mock("@/lib/middlewares", () => ({
  requireHrManageMiddleware: {},
  requireHrViewMiddleware: {},
}));
vi.mock("@/lib/attendance/recompute-server", () => ({
  recomputeAttendanceRow: mock.recompute,
}));
import {
  addManualPunchFn,
  correctPunchFn,
  deletePunchFn,
  getEmployeePunchesFn,
} from "./manual-punches-fn";
import { assertDeviceAttendanceResolved } from "@/lib/attendance/device-import/payroll.server";
import { planDeviceEmployeeRows } from "@/lib/attendance/device-import/timeline";

type Row = Record<string, unknown>;
let tables: Map<unknown, Row[]>;
const rows = (table: unknown) => tables.get(table)!;
const camel = (key: string) =>
  key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const dialect = new PgDialect();

// Apply the production query's filters, including date ranges and claim IDs.
function matches(row: Row, where?: SQL) {
  if (!where) return true;
  const query = dialect.sqlToQuery(where);
  for (const match of query.sql.matchAll(
    /"\w+"\."(\w+)"\s*(=|<>|<=|>=)\s*\$(\d+)/g,
  )) {
    const actual = row[camel(match[1])] as string;
    const expected = query.params[Number(match[3]) - 1] as string;
    if (match[2] === "=" && actual !== expected) return false;
    if (match[2] === "<>" && actual === expected) return false;
    if (match[2] === "<=" && actual > expected) return false;
    if (match[2] === ">=" && actual < expected) return false;
  }
  for (const match of query.sql.matchAll(/"\w+"\."(\w+)" in \(([^)]+)\)/g)) {
    const values = [...match[2].matchAll(/\$(\d+)/g)].map(
      (value) => query.params[Number(value[1]) - 1],
    );
    if (!values.includes(row[camel(match[1])])) return false;
  }
  return true;
}

const context = { session: { user: { id: "hr-1" } } };
const correct = correctPunchFn as unknown as (input: {
  data: {
    punchId: string;
    newTimestamp: string;
    attendanceDate?: string;
    reason?: string;
  };
  context: typeof context;
}) => Promise<{ punch: typeof attendancePunches.$inferSelect }>;
const remove = deletePunchFn as unknown as (input: {
  data: { punchId: string; reason?: string };
  context: typeof context;
}) => Promise<unknown>;
const add = addManualPunchFn as unknown as (input: {
  data: { employeeId: string; timestamp: string };
  context: typeof context;
}) => Promise<unknown>;
const sourceDate = "2026-09-30";
const targetDate = "2026-10-01";

beforeEach(() => {
  vi.clearAllMocks();
  tables = new Map<unknown, Row[]>([
    [employees, [{ id: "emp-1" }]],
    [
      attendancePunches,
      [
        {
          id: "raw-punch",
          employeeId: "emp-1",
          timestamp: new Date(`${sourceDate}T08:00:00+05:00`),
          attendanceDate: sourceDate,
          direction: "in",
          source: "device_import",
          note: null,
          terminalUserId: "hr-1",
          offlineImportRowId: null,
          offlineImportIdentity: null,
        },
      ],
    ],
    [
      deviceAttendancePunchClaims,
      [
        {
          id: "claim-1",
          importId: "import-1",
          employeeId: "emp-1",
          timestamp: new Date(`${sourceDate}T08:00:00+05:00`),
          reportDate: sourceDate,
          attendanceDate: sourceDate,
          direction: "in",
          punchId: "raw-punch",
        },
      ],
    ],
    [payrolls, []],
    [payrollAttendanceInvalidations, []],
    [attendancePunchCorrectionAudit, []],
  ]);
  for (const [name, table] of Object.entries({
    employees,
    attendancePunches,
    deviceAttendancePunchClaims,
    payrolls,
    payrollAttendanceInvalidations,
  })) {
    mock.db.query[name] = {
      findMany: async ({ where }: { where?: SQL } = {}) =>
        rows(table).filter((row) => matches(row, where)),
      findFirst: async ({ where }: { where?: SQL } = {}) =>
        rows(table).find((row) => matches(row, where)),
    };
  }
  mock.db.transaction.mockImplementation(async (callback) => {
    const snapshot = new Map(
      [...tables].map(([table, values]) => [table, structuredClone(values)]),
    );
    try {
      return await callback(mock.db);
    } catch (error) {
      tables = snapshot;
      throw error;
    }
  });
  let serial = 0;
  mock.db.insert.mockImplementation((table: unknown) => ({
    values: (value: Row) => {
      const created = { id: `new-${++serial}`, ...value };
      rows(table).push(created);
      return Object.assign(Promise.resolve(), {
        returning: async () => [created],
      });
    },
  }));
  mock.db.update.mockImplementation((table: unknown) => ({
    set: (values: Row) => ({
      where: async (where: SQL) => {
        rows(table)
          .filter((row) => matches(row, where))
          .forEach((row) => Object.assign(row, values));
      },
    }),
  }));
  mock.db.delete.mockImplementation((table: unknown) => ({
    where: async (where: SQL) => {
      const deleted = rows(table).filter((row) => matches(row, where));
      tables.set(
        table,
        rows(table).filter((row) => !deleted.includes(row)),
      );
      if (table === attendancePunches) {
        for (const claim of rows(deviceAttendancePunchClaims)) {
          if (deleted.some((punch) => punch.id === claim.punchId))
            claim.punchId = null;
        }
      }
    },
  }));
});

describe("manual corrections of imported punches", () => {
  it("exposes the audit requirement to the editor after an imported punch becomes manual", async () => {
    const corrected = await correct({
      data: {
        punchId: "raw-punch",
        newTimestamp: `${targetDate}T08:00:00+05:00`,
        reason: "Correct imported date",
      },
      context,
    });
    const list = getEmployeePunchesFn as unknown as (input: {
      data: { employeeId: string; date: string };
    }) => Promise<
      Array<{ id: string; source: string; requiresCorrectionReason: boolean }>
    >;
    const punches = await list({
      data: { employeeId: "emp-1", date: targetDate },
    });
    expect(punches).toEqual([
      expect.objectContaining({
        id: corrected.punch.id,
        source: "manual",
        requiresCorrectionReason: true,
      }),
    ]);
  });
  it.each(["approved", "paid"])(
    "rejects a move into %s target payroll with no device claim",
    async (status) => {
      rows(payrolls).push({
        id: "target-payroll",
        status,
        startDate: targetDate,
        endDate: "2026-10-31",
      });
      await expect(
        correct({
          data: {
            punchId: "raw-punch",
            newTimestamp: `${targetDate}T08:00:00+05:00`,
            reason: "Correct imported date",
          },
          context,
        }),
      ).rejects.toThrow("approved or paid payroll");
      expect(rows(attendancePunches)[0].id).toBe("raw-punch");
      expect(rows(deviceAttendancePunchClaims)[0].punchId).toBe("raw-punch");
    },
  );

  it("invalidates draft payrolls on both sides of a cross-period correction", async () => {
    rows(payrolls).push(
      {
        id: "source-payroll",
        status: "draft",
        startDate: "2026-09-01",
        endDate: sourceDate,
      },
      {
        id: "target-payroll",
        status: "draft",
        startDate: targetDate,
        endDate: "2026-10-31",
      },
    );
    await correct({
      data: {
        punchId: "raw-punch",
        newTimestamp: `${targetDate}T08:00:00+05:00`,
        reason: "Correct imported date",
      },
      context,
    });
    expect(rows(payrollAttendanceInvalidations)).toEqual([
      expect.objectContaining({
        payrollId: "source-payroll",
        deviceImportId: "import-1",
        affectedSummary: {
          employeeIds: ["emp-1"],
          attendanceDates: [sourceDate],
        },
      }),
      expect.objectContaining({
        payrollId: "target-payroll",
        deviceImportId: "import-1",
        affectedSummary: {
          employeeIds: ["emp-1"],
          attendanceDates: [targetDate],
        },
      }),
    ]);
  });

  it("keeps raw identity and links through successive corrections and replay", async () => {
    const rawIdentity = { ...rows(deviceAttendancePunchClaims)[0] };
    const first = await correct({
      data: {
        punchId: "raw-punch",
        newTimestamp: `${targetDate}T08:00:00+05:00`,
        reason: "Correct imported date",
      },
      context,
    });
    const second = await correct({
      data: {
        punchId: first.punch.id,
        newTimestamp: "2026-10-02T09:00:00+05:00",
        reason: "Correct date again",
      },
      context,
    });
    expect(rows(deviceAttendancePunchClaims)).toEqual([
      {
        ...rawIdentity,
        punchId: second.punch.id,
        attendanceDate: "2026-10-02",
      },
    ]);
    expect(rows(attendancePunchCorrectionAudit)).toHaveLength(2);
    const replay = planDeviceEmployeeRows({
      rows: [
        {
          rowNumber: 2,
          personId: "person-1",
          personName: "Employee",
          department: "Factory",
          date: sourceDate,
          punches: ["08:00"],
          reportedCount: 1,
          issues: [],
        },
      ],
      existingPunches: rows(attendancePunches) as unknown as Parameters<
        typeof planDeviceEmployeeRows
      >[0]["existingPunches"],
      claims: rows(deviceAttendancePunchClaims) as unknown as Parameters<
        typeof planDeviceEmployeeRows
      >[0]["claims"],
      attendanceRows: [],
      lockedDates: new Set(),
      shifts: [],
      now: new Date("2026-10-14T12:00:00+05:00"),
    });
    expect(replay[0].punches).toEqual([]);
    expect(replay[0].attendanceDates).toEqual(["2026-10-02"]);
    const reader = {
      query: { ...mock.db.query, attendance: { findMany: async () => [] } },
    } as unknown as Parameters<typeof assertDeviceAttendanceResolved>[0];
    await expect(
      assertDeviceAttendanceResolved(
        reader,
        "emp-1",
        "2026-10-02",
        "2026-10-02",
      ),
    ).rejects.toThrow("2026-10-02 needs HR review");
  });

  it.each(["correct", "delete"])(
    "requires an audit reason to %s a previously corrected device punch",
    async (action) => {
      const { punch } = await correct({
        data: {
          punchId: "raw-punch",
          newTimestamp: `${targetDate}T08:00:00+05:00`,
          reason: "Correct imported date",
        },
        context,
      });
      const operation =
        action === "correct"
          ? correct({
              data: {
                punchId: punch.id,
                newTimestamp: `${targetDate}T09:00:00+05:00`,
              },
              context,
            })
          : remove({ data: { punchId: punch.id }, context });
      await expect(operation).rejects.toThrow();
      expect(rows(attendancePunches)[0].id).toBe(punch.id);
    },
  );

  it("retains the corrected date's claim and audit when HR deletes the replacement", async () => {
    const { punch } = await correct({
      data: {
        punchId: "raw-punch",
        newTimestamp: `${targetDate}T08:00:00+05:00`,
        reason: "Correct imported date",
      },
      context,
    });
    await remove({
      data: { punchId: punch.id, reason: "Remove incorrect punch" },
      context,
    });
    expect(rows(attendancePunches)).toEqual([]);
    expect(rows(deviceAttendancePunchClaims)[0]).toMatchObject({
      punchId: null,
      attendanceDate: targetDate,
      reportDate: sourceDate,
      timestamp: new Date(`${sourceDate}T08:00:00+05:00`),
    });
    expect(
      rows(attendancePunchCorrectionAudit).map((row) => row.action),
    ).toEqual(["correct", "delete"]);
  });

  it("preserves unfinalized manual correction behavior without device provenance", async () => {
    rows(attendancePunches)[0].source = "manual";
    tables.set(deviceAttendancePunchClaims, []);
    const result = await correct({
      data: {
        punchId: "raw-punch",
        newTimestamp: `${sourceDate}T09:00:00+05:00`,
      },
      context,
    });
    expect(result.punch.timestamp).toEqual(
      new Date(`${sourceDate}T09:00:00+05:00`),
    );
    expect(rows(attendancePunchCorrectionAudit)).toEqual([]);
  });

  it("blocks manual punch correction in approved payroll without device provenance", async () => {
    rows(attendancePunches)[0].source = "manual";
    tables.set(deviceAttendancePunchClaims, []);
    rows(payrolls).push({
      id: "legacy-payroll", status: "approved", startDate: "2026-09-01", endDate: sourceDate,
    });
    await expect(correct({
      data: { punchId: "raw-punch", newTimestamp: `${sourceDate}T09:00:00+05:00` }, context,
    })).rejects.toThrow("approved or paid payroll");
  });

  it.each(["add", "delete", "correct"])(
    "applies the corrected date's payroll guard on later %s",
    async (action) => {
      const { punch } = await correct({
        data: {
          punchId: "raw-punch",
          newTimestamp: `${targetDate}T08:00:00+05:00`,
          reason: "Correct imported date",
        },
        context,
      });
      rows(payrolls).push({
        id: "target-payroll",
        status: "approved",
        startDate: targetDate,
        endDate: "2026-10-31",
      });
      const operation =
        action === "add"
          ? add({
              data: {
                employeeId: "emp-1",
                timestamp: `${targetDate}T17:00:00+05:00`,
              },
              context,
            })
          : action === "delete"
            ? remove({
                data: { punchId: punch.id, reason: "Remove incorrect punch" },
                context,
              })
            : correct({
                data: {
                  punchId: punch.id,
                  newTimestamp: `${targetDate}T09:00:00+05:00`,
                  reason: "Correct time again",
                },
                context,
              });
      await expect(operation).rejects.toThrow("approved or paid payroll");
    },
  );
});
