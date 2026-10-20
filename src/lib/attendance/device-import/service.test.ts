import { File as NodeFile } from "node:buffer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  attendance,
  attendancePunches,
  employees,
  payrolls,
} from "@/db/schemas/hr-schema";
import {
  deviceAttendanceImports,
  deviceAttendancePersonMappings,
  deviceAttendancePunchClaims,
} from "@/db/schemas/device-attendance-schema";
import { payrollAttendanceInvalidations } from "@/db/schemas/offline-attendance-schema";

const mock = vi.hoisted(() => ({
  db: {
    query: {} as Record<string, unknown>,
    transaction: vi.fn(),
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  recompute: vi.fn(),
}));
vi.mock("@/db", async () => ({
  db: mock.db,
  ...(await import("@/db/schemas/hr-schema")),
  ...(await import("@/db/schemas/offline-attendance-schema")),
}));
vi.mock("../recompute-server", () => ({
  recomputeAttendanceRow: mock.recompute,
}));
import {
  uploadDeviceAttendance,
  previewDeviceAttendance,
  confirmDeviceAttendance,
} from "./service.server";

type Row = Record<string, unknown>;
let tables: Map<unknown, Row[]>;
const rows = (table: unknown) => tables.get(table)!;
function params(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(params);
  if ("value" in value && !Array.isArray(value.value)) return [value.value];
  if ("queryChunks" in value && Array.isArray(value.queryChunks))
    return value.queryChunks.flatMap(params);
  return [];
}
const file = (punches = "08:00, 13:00, 14:00, 17:00", personId = "112009") =>
  new NodeFile(
    [
      "Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\r\n" +
        `${personId},Employee,Factory,2026-10-13,Tue,${punches.split(",").length},"${punches}"`,
    ],
    "total-punches.csv",
    { type: "text/csv" },
  ) as unknown as File;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T12:00:00+05:00"));
  vi.clearAllMocks();
  tables = new Map<unknown, Row[]>([
    [
      employees,
      [
        {
          id: "emp-1",
          employeeCode: "112009",
          firstName: "Employee",
          lastName: "One",
          joiningDate: "2026-01-01",
          shifts: [],
          status: "active",
          isDriver: false,
          isSalesman: false,
          isOrderBooker: false,
        },
      ],
    ],
    [attendance, []],
    [attendancePunches, []],
    [payrolls, []],
    [deviceAttendanceImports, []],
    [deviceAttendancePersonMappings, []],
    [deviceAttendancePunchClaims, []],
    [payrollAttendanceInvalidations, []],
  ]);
  const query: Record<string, unknown> = {};
  for (const [key, table] of Object.entries({
    employees,
    attendance,
    attendancePunches,
    payrolls,
    deviceAttendanceImports,
    deviceAttendancePersonMappings,
    deviceAttendancePunchClaims,
    payrollAttendanceInvalidations,
  })) {
    query[key] = {
      findMany: vi.fn(async (config: { where?: unknown } = {}) => {
        const statuses = params(config.where).filter((value) =>
          ["draft", "approved", "paid"].includes(String(value)),
        );
        return table === payrolls && statuses.length
          ? rows(table).filter((row) => statuses.includes(row.status))
          : [...rows(table)];
      }),
      findFirst: vi.fn(async (config: { where?: unknown } = {}) =>
        table === deviceAttendanceImports
          ? rows(table).find((row) => row.id === params(config.where)[0])
          : rows(table)[0],
      ),
    };
  }
  mock.db.query = query;
  mock.db.transaction.mockImplementation(async (callback) => callback(mock.db));
  mock.db.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: (where: unknown) => ({
        for: async () =>
          rows(table).filter((row) => row.id === params(where)[0]),
      }),
    }),
  }));
  mock.db.insert.mockImplementation((table: unknown) => ({
    values: (value: Row | Row[]) => {
      const created = (Array.isArray(value) ? value : [value]).map(
        (row, i) => ({
          id: row.id ?? `${String(tables.size)}-${rows(table).length + i}`,
          status: "preview",
          createdAt: new Date(),
          ...row,
        }),
      );
      rows(table).push(...created);
      return Object.assign(Promise.resolve(), {
        returning: async () => created,
      });
    },
  }));
  mock.db.update.mockImplementation((table: unknown) => ({
    set: (value: Row) => ({
      where: async () => {
        rows(table).forEach((row) => Object.assign(row, value));
      },
    }),
  }));
});
afterEach(() => vi.useRealTimers());

describe("device import service against live ledger state", () => {
  it("stages source rows and previews without writing attendance", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    expect(preview.rows[0]).toMatchObject({
      status: "ready",
      newPunchCount: 4,
      dutyHours: "8.00",
    });
    expect(rows(deviceAttendanceImports)[0]).toHaveProperty("fileSha256");
    expect(rows(attendancePunches)).toEqual([]);
  });
  it("confirms through the existing punch ledger, claims and recompute", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    const result = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(result.rows[0].status).toBe("imported");
    expect(rows(attendancePunches)).toHaveLength(4);
    expect(rows(attendancePunches).map((p) => p.direction)).toEqual([
      "in",
      "out",
      "in",
      "out",
    ]);
    expect(rows(deviceAttendancePunchClaims)).toHaveLength(4);
    expect(mock.recompute).toHaveBeenCalledWith(
      mock.db,
      "emp-1",
      "2026-10-13",
      expect.any(Object),
    );
  });
  it("rechecks live data and imports no duplicates when confirmation is retried", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    await confirmDeviceAttendance({ importId: preview.importId }, "hr-1");
    const retry = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(retry.rows[0].newPunchCount).toBe(0);
    expect(rows(attendancePunches)).toHaveLength(4);
    expect(rows(deviceAttendancePunchClaims)).toHaveLength(4);
  });
  it("preserves HR deletions on a later upload of the same raw timestamps", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    await confirmDeviceAttendance({ importId: preview.importId }, "hr-1");
    rows(attendancePunches).splice(0);
    rows(deviceAttendancePunchClaims).forEach((claim) => {
      claim.punchId = null;
    });
    const retry = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(retry.rows[0].newPunchCount).toBe(0);
    expect(rows(attendancePunches)).toHaveLength(0);
  });
  it("keeps unmatched people for HR and persists an explicit mapping on confirmation", async () => {
    const preview = await uploadDeviceAttendance(
      file("08:00, 17:00", "device-42"),
      "hr-1",
    );
    expect(preview.rows[0]).toMatchObject({
      status: "needs_review",
      employeeId: null,
    });
    const input = {
      importId: preview.importId,
      mappings: { "device-42": "emp-1" },
    };
    expect((await previewDeviceAttendance(input)).rows[0].newPunchCount).toBe(
      2,
    );
    await confirmDeviceAttendance(input, "hr-1");
    expect(rows(deviceAttendancePersonMappings)[0]).toMatchObject({
      personId: "device-42",
      employeeId: "emp-1",
    });
  });
  it("does not overwrite HR's leave decision made after preview", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    rows(attendance).push({
      date: "2026-10-13",
      status: "leave",
      entrySource: "manual",
    });
    const result = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(result.rows[0].status).toBe("blocked");
    expect(rows(attendancePunches)).toEqual([]);
  });
  it("retains automatic Person ID ownership across uploads", async () => {
    const first = await uploadDeviceAttendance(file(), "hr-1");
    await confirmDeviceAttendance({ importId: first.importId }, "hr-1");
    expect(rows(deviceAttendancePersonMappings)[0]).toMatchObject({
      personId: "112009",
      employeeId: "emp-1",
    });
    const another = await uploadDeviceAttendance(
      file("08:00, 17:00", "different-person"),
      "hr-1",
    );
    await expect(
      previewDeviceAttendance({
        importId: another.importId,
        mappings: { "different-person": "emp-1" },
      }),
    ).rejects.toThrow("already has another device Person ID");
  });
  it("refuses dates in payroll approved after preview", async () => {
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    rows(payrolls).push({
      id: "payroll-1",
      status: "approved",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    const result = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(result.rows[0].status).toBe("blocked");
    expect(rows(attendancePunches)).toEqual([]);
  });
  it("invalidates draft payroll in the same write transaction", async () => {
    rows(payrolls).push({
      id: "payroll-1",
      status: "draft",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    const preview = await uploadDeviceAttendance(file(), "hr-1");
    await confirmDeviceAttendance({ importId: preview.importId }, "hr-1");
    expect(rows(payrollAttendanceInvalidations)[0]).toMatchObject({
      payrollId: "payroll-1",
      deviceImportId: preview.importId,
    });
  });
  it("imports an incomplete day's evidence for manual correction without inventing checkout", async () => {
    const preview = await uploadDeviceAttendance(file("08:00"), "hr-1");
    const result = await confirmDeviceAttendance(
      { importId: preview.importId },
      "hr-1",
    );
    expect(result.rows[0].status).toBe("needs_review");
    expect(rows(attendancePunches)).toHaveLength(1);
    expect(rows(attendancePunches)[0].direction).toBe("in");
  });
});
