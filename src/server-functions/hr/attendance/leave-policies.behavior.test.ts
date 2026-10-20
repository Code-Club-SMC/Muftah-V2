import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { attendance, employees } from "@/db/schemas/hr-schema";

const mock = vi.hoisted(() => ({
  db: { transaction: vi.fn(), query: {} as Record<string, unknown>, select: vi.fn(), update: vi.fn(), insert: vi.fn(), execute: vi.fn() },
  finalized: false, events: [] as string[],
}));
vi.mock("@/db", () => ({ db: mock.db }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (input: unknown) => unknown } | ((input: unknown) => unknown);
  return { middleware() { return this; }, inputValidator(schema: typeof validator) { validator = schema; return this; },
    handler(callback: (input: unknown) => unknown) { return (input: { data: unknown }) => callback({ ...input, data: typeof validator === "function" ? validator(input.data) : validator.parse(input.data) }); } };
} }));
vi.mock("@/lib/middlewares", () => ({ requireHrManageMiddleware: {}, requireHrViewMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@/lib/attendance/recompute-server", () => ({ recomputeAttendanceRow: vi.fn() }));
vi.mock("@/lib/attendance/device-import/payroll.server", () => ({
  lockAttendancePayrollWrites: async () => { mock.events.push("payroll-lock"); },
  assertAttendanceDatesEditable: async () => { if (mock.finalized) throw new Error("approved or paid payroll"); },
  invalidateDeviceAttendanceChanges: async () => { if (mock.finalized) throw new Error("approved or paid payroll"); mock.events.push("invalidate"); },
}));
import { processLeaveApprovalFn } from "./leave-approvals-fn";
import { upsertAttendanceFn } from "./upsert-attendance-fn";
import { upsertAttendanceSchema } from "@/lib/validators/hr-validators";
import { bulkMarkAttendanceFn } from "./bulk-mark-attendance-fn";
import { bulkMarkAttendanceRangeFn } from "./bulk-mark-attendance-range-fn";
import { convertOvertimeToCompOffFn } from "./convert-overtime-fn";
import { processOvertimeFn } from "./process-overtime-fn";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";

type Row = Record<string, any>;
let employee: Row;
let records: Row[];
const dialect = new PgDialect();
function matches(row: Row, where?: SQL) {
  if (!where) return true;
  const query = dialect.sqlToQuery(where);
  for (const item of query.sql.matchAll(/"\w+"\."(\w+)"\s*(=|<>|<=|>=)\s*\$(\d+)/g)) {
    const key = item[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const expected = query.params[Number(item[3]) - 1] as any;
    if (item[2] === "=" && row[key] !== expected) return false;
    if (item[2] === "<>" && row[key] === expected) return false;
    if (item[2] === "<=" && row[key] > expected) return false;
    if (item[2] === ">=" && row[key] < expected) return false;
  }
  return true;
}
const context = { session: { user: { id: "hr", name: "HR" } } };
const decide = processLeaveApprovalFn as unknown as (input: { data: { id: string; status: "approved" | "pending" | "rejected" }; context: typeof context }) => Promise<Row>;
const save = upsertAttendanceFn as unknown as (input: { data: unknown }) => Promise<Row>;
const bulk = bulkMarkAttendanceFn as unknown as (input: { data: unknown }) => Promise<unknown>;
const bulkRange = bulkMarkAttendanceRangeFn as unknown as (input: { data: unknown; context: typeof context }) => Promise<unknown>;
const convert = convertOvertimeToCompOffFn as unknown as (input: { data: unknown }) => Promise<unknown>;
const overtime = processOvertimeFn as unknown as (input: { data: unknown }) => Promise<unknown>;
function input(overrides: Row = {}) {
  return { employeeId: "emp", date: "2026-10-13", status: "leave", leaveType: "compensatory", leaveApprovalStatus: "pending", compensatoryHoursUsed: "8", checkIn: null, checkOut: null, dutyHours: "0", overtimeHours: "0", isLate: false, isNightShift: false, isApprovedLeave: false, overtimeRemarks: null, overtimeStatus: "pending", notes: "Synthetic policy test", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks(); mock.finalized = false; mock.events = [];
  employee = { id: "emp", firstName: "Test", lastName: "Employee", restDays: [0], standardDutyHours: 8, compensatoryHoursBalance: "8", annualLeaveAllowance: 14 };
  records = [{ id: "leave", employeeId: "emp", date: "2026-10-13", status: "leave", leaveType: "compensatory", leaveApprovalStatus: "pending", isApprovedLeave: false, compensatoryHoursUsed: "8", dutyHours: "0" }];
  mock.db.transaction.mockImplementation(async (callback) => callback(mock.db));
  mock.db.execute.mockImplementation(async () => { mock.events.push("employee-lock"); });
  mock.db.query = {
    attendance: { findFirst: async ({ where }: { where: SQL }) => records.find(row => matches(row, where)), findMany: async ({ where }: { where: SQL }) => records.filter(row => matches(row, where)) },
    employees: { findFirst: async () => employee, findMany: async () => [employee] },
    attendancePunches: { findFirst: async () => undefined },
    orderBookers: { findFirst: async () => undefined },
  };
  mock.db.select.mockImplementation(() => ({ from: (table: unknown) => {
    const chain = { innerJoin: () => chain, where: async (where: SQL) => table === attendance ? records.filter(row => matches(row, where)).map(row => ({ ...row, standardDutyHours: employee.standardDutyHours, restDays: employee.restDays, shifts: employee.shifts })) : [] };
    return chain;
  } }));
  mock.db.update.mockImplementation((table) => ({ set: (patch: Row) => ({ where: (where: SQL) => {
    const targets = (table === employees ? [employee] : records).filter(row => matches(row, where));
    for (const target of targets) {
      const values = { ...patch };
      if (table === employees && values.compensatoryHoursBalance && typeof values.compensatoryHoursBalance === "object") {
        const expression = dialect.sqlToQuery(values.compensatoryHoursBalance);
        if (!/coalesce\(.*\) \+ \$1/i.test(expression.sql)) throw new Error("Unsupported test bank expression");
        values.compensatoryHoursBalance = (Number(target.compensatoryHoursBalance) + Number(expression.params[0])).toFixed(2);
      }
      Object.assign(target, values);
    }
    return { returning: async () => targets, then: (resolve: (value: unknown) => unknown) => resolve(targets) };
  } }) }));
  mock.db.insert.mockImplementation(() => ({ values: (values: Row) => ({ onConflictDoUpdate: ({ set }: { set: Row }) => {
    let target = records.find(row => row.employeeId === values.employeeId && row.date === values.date);
    if (target) Object.assign(target, set); else { target = { id: "new", ...values }; records.push(target); }
    return { returning: async () => [target], then: (resolve: (value: unknown) => unknown) => resolve([target]) };
  } }) }));
});

describe("leave policy mutation behavior", () => {
  it("P2 rejection releases the reserved comp hours once without changing leave status", async () => {
    await decide({ data: { id: "leave", status: "rejected" }, context });
    expect(employee.compensatoryHoursBalance).toBe("16.00");
    expect(records[0]).toMatchObject({ status: "leave", leaveApprovalStatus: "rejected", isApprovedLeave: false, compensatoryHoursUsed: "0" });
    await decide({ data: { id: "leave", status: "rejected" }, context });
    expect(employee.compensatoryHoursBalance).toBe("16.00");
  });

  it("P2 saves, revisions and cancellation consume only the delta", async () => {
    await save({ data: input() }); expect(Number(employee.compensatoryHoursBalance)).toBe(8);
    await save({ data: input({ compensatoryHoursUsed: "6" }) }); expect(Number(employee.compensatoryHoursBalance)).toBe(10);
    await save({ data: input({ status: "absent", leaveType: null }) }); expect(Number(employee.compensatoryHoursBalance)).toBe(16);
    await save({ data: input({ status: "absent", leaveType: null }) }); expect(Number(employee.compensatoryHoursBalance)).toBe(16);
  });

  it("P2 order-booker cancellation also releases its reservation", async () => {
    employee.isOrderBooker = true;
    await save({ data: input({ status: "absent", leaveType: null }) });
    expect(Number(employee.compensatoryHoursBalance)).toBe(16);
  });

  it("rejects a comp bank overdraw without changing the reservation or bank", async () => {
    await expect(save({ data: input({ compensatoryHoursUsed: "17" }) })).rejects.toThrow("Insufficient compensatory");
    expect(employee.compensatoryHoursBalance).toBe("8");
    expect(records[0].compensatoryHoursUsed).toBe("8");
  });

  it.each(["single", "range"])("P2 %s bulk cancellation refunds once and clears applied hours", async (kind) => {
    const action = () => kind === "single" ? bulk({ data: { employeeIds: ["emp"], date: "2026-10-13", status: "absent" } }) : bulkRange({ data: { employeeIds: ["emp"], startDate: "2026-10-13", endDate: "2026-10-13", template: { status: "absent", entrySource: "manual" }, conflictStrategy: "overwrite" }, context });
    await action(); await action();
    expect(Number(employee.compensatoryHoursBalance)).toBe(16);
    expect(records[0]).toMatchObject({ status: "absent", leaveType: null, compensatoryHoursUsed: "0" });
  });

  it.each(["single", "range"])("P4 %s bulk refuses a holiday leave charge", async (kind) => {
    records[0].status = "holiday";
    const action = kind === "single" ? bulk({ data: { employeeIds: ["emp"], date: "2026-10-13", status: "leave", leaveType: "annual" } }) : bulkRange({ data: { employeeIds: ["emp"], startDate: "2026-10-13", endDate: "2026-10-13", template: { status: "leave", leaveType: "annual", entrySource: "manual" }, conflictStrategy: "overwrite" }, context });
    await expect(action).rejects.toThrow("holiday");
    expect(records[0].status).toBe("holiday");
    expect(employee.compensatoryHoursBalance).toBe("8");
  });

  it("serializes overtime conversion and refuses a second credit", async () => {
    Object.assign(records[0], { status: "present", dutyHours: "16", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    const data = { employeeId: "emp", attendanceIds: ["leave"] };
    await convert({ data });
    expect(records[0]).toMatchObject({ overtimeCompensationMethod: "comp_off", overtimeStatus: "approved" });
    const writes = mock.db.update.mock.calls.length;
    await expect(convert({ data })).rejects.toThrow("already converted");
    expect(mock.db.update.mock.calls.length).toBe(writes);
    expect(mock.events.slice(0, 2)).toEqual(["payroll-lock", "employee-lock"]);
    await expect(overtime({ data: { id: "leave", status: "rejected" } })).rejects.toThrow("already been credited");
  });

  it("converts eight worked rest-day hours to eight bank hours exactly once", async () => {
    Object.assign(records[0], { date: "2026-10-11", status: "present", dutyHours: "8", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    const data = { employeeId: "emp", attendanceIds: ["leave"] };
    await convert({ data });
    expect(Number(employee.compensatoryHoursBalance)).toBe(16);
    expect(records[0]).toMatchObject({ overtimeCompensationMethod: "comp_off", overtimeStatus: "approved" });
    await expect(convert({ data })).rejects.toThrow("already converted");
    expect(Number(employee.compensatoryHoursBalance)).toBe(16);
  });

  it("refuses banking eight overtime hours from an ordinary eight-hour working day", async () => {
    Object.assign(records[0], { status: "present", dutyHours: "8", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    await expect(convert({ data: { employeeId: "emp", attendanceIds: ["leave"] } })).rejects.toThrow("more than the suggested");
    expect(Number(employee.compensatoryHoursBalance)).toBe(8);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it("approves the eight overtime hours recorded for an eight-hour rest-day shift", async () => {
    Object.assign(records[0], { date: "2026-10-11", status: "present", dutyHours: "8", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    await overtime({ data: { id: "leave", status: "approved" } });
    expect(records[0].overtimeStatus).toBe("approved");
  });

  it("preserves rest-day overtime when a punch-driven attendance request is saved", async () => {
    Object.assign(records[0], { date: "2026-10-11", status: "present", dutyHours: "8", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    mock.db.query.attendancePunches = { findFirst: async () => ({ id: "punch" }) };
    vi.mocked(recomputeAttendanceRow).mockResolvedValue({ ...records[0] } as Awaited<ReturnType<typeof recomputeAttendanceRow>>);
    await save({ data: input({ date: "2026-10-11", status: "present", leaveType: null, overtimeHours: "8", overtimeRemarks: "Rest-day shift", compensatoryHoursUsed: "0" }) });
    expect(records[0].overtimeHours).toBe("8.00");
  });

  it("refuses overtime decisions and conversion for finalized dates", async () => {
    Object.assign(records[0], { status: "present", dutyHours: "16", overtimeHours: "8", overtimeStatus: "pending", compensatoryHoursUsed: "0", leaveType: null });
    mock.finalized = true;
    await expect(convert({ data: { employeeId: "emp", attendanceIds: ["leave"] } })).rejects.toThrow("approved or paid");
    await expect(overtime({ data: { id: "leave", status: "approved" } })).rejects.toThrow("approved or paid");
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it.each(["-1", "NaN", "Infinity"])("rejects invalid comp hours %s at validation", (hours) => {
    expect(() => upsertAttendanceSchema.parse(input({ compensatoryHoursUsed: hours }))).toThrow("finite and nonnegative");
  });

  it("P4 refuses rest-day requests and approval without consuming balances", async () => {
    await expect(save({ data: input({ date: "2026-10-11" }) })).rejects.toThrow("rest day");
    records[0].date = "2026-10-11";
    await expect(decide({ data: { id: "leave", status: "approved" }, context })).rejects.toThrow("rest day");
    expect(employee.compensatoryHoursBalance).toBe("8");
    expect(records[0].leaveApprovalStatus).toBe("pending");
  });

  it("P4 refuses replacing a recorded holiday with leave", async () => {
    records[0].status = "holiday";
    await expect(save({ data: input() })).rejects.toThrow("holiday");
    expect(employee.compensatoryHoursBalance).toBe("8");
  });

  it("guards finalized leave decisions and attendance writes", async () => {
    mock.finalized = true;
    await expect(decide({ data: { id: "leave", status: "approved" }, context })).rejects.toThrow("approved or paid");
    await expect(save({ data: input() })).rejects.toThrow("approved or paid");
    expect(records[0].leaveApprovalStatus).toBe("pending");
  });
});
