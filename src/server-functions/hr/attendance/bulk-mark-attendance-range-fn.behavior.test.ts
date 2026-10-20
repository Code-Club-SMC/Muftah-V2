import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendance, attendancePunches } from "@/db/schemas/hr-schema";

const mock = vi.hoisted(() => ({
  events: [] as string[],
  db: {
    query: { employees: { findMany: vi.fn() } },
    select: vi.fn(),
    transaction: vi.fn(),
  },
  tx: { execute: vi.fn(), select: vi.fn(), insert: vi.fn() },
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
vi.mock("@/lib/middlewares", () => ({ requireHrManageMiddleware: {} }));
import { bulkMarkAttendanceRangeFn } from "./bulk-mark-attendance-range-fn";

const run = bulkMarkAttendanceRangeFn as unknown as (input: {
  data: unknown;
  context: unknown;
}) => Promise<{ summary: { created: number; skippedPunchDays: number } }>;

beforeEach(() => {
  vi.clearAllMocks();
  mock.events = [];
  mock.db.query.employees.findMany.mockResolvedValue([
    { id: "emp", restDays: [], shifts: [{ start: "08:00", end: "17:00" }] },
  ]);
  mock.db.transaction.mockImplementation(async (callback) => callback(mock.tx));
  // The importer finishes before bulk marking obtains its lock.
  mock.tx.execute.mockImplementation(async () => {
    mock.events.push("lock");
  });
  mock.tx.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: async () => {
        mock.events.push("read");
        if (table === attendance)
          return [
            {
              id: "imported-day",
              employeeId: "emp",
              date: "2026-10-13",
              status: "present",
            },
          ];
        if (table === attendancePunches)
          return [{ employeeId: "emp", attendanceDate: "2026-10-13" }];
        throw new Error("Unexpected table");
      },
    }),
  }));
});

describe("bulk marking alongside device imports", () => {
  it("reads after locking and skips the day a concurrent importer just recorded", async () => {
    const result = await run({
      data: {
        employeeIds: ["emp"],
        startDate: "2026-10-13",
        endDate: "2026-10-13",
        template: { status: "present", entrySource: "manual" },
        conflictStrategy: "overwrite",
      },
      context: { session: { user: { id: "hr" } } },
    });
    expect(mock.db.select).not.toHaveBeenCalled();
    expect(mock.events).toEqual(["lock", "lock", "read", "read"]);
    expect(mock.tx.insert).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ created: 0, skippedPunchDays: 1 });
  });
});
