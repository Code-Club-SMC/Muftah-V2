import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attendance, attendancePunches, employees, payrolls } from "@/db/schemas/hr-schema";
import { orderBookers, orderBookerTrips } from "@/db/schemas/sales-erp-schema";

// Production handlers, validation and every database operation run unchanged. Only
// the transport and sign-in boundary are replaced so the test can call them as HR.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown } | undefined;
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: NonNullable<typeof validator>) => {
        validator = schema;
        return builder;
      },
      handler:
        (callback: (input: { data: unknown; context: unknown }) => unknown) =>
        async (input: { data: unknown; context: unknown }) =>
          callback({ ...input, data: validator ? validator.parse(input.data) : input.data }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({ requireHrManageMiddleware: {}, requireHrViewMiddleware: {} }));

type Summary = Record<string, number>;
type Input = { data: Record<string, unknown>; context: { session: { user: { id: string } } } };
const configuredUrl = process.env.TEST_DATABASE_URL;
const SPLIT = [{ start: "07:30", end: "13:00" }, { start: "14:00", end: "16:30" }];
// 2026-10-12 is a Monday; 2026-10-16 is a Friday.
const MON = "2026-10-12";
const TUE = "2026-10-13";
const FRI = "2026-10-16";

describe.skipIf(!configuredUrl)("bulk mark attendance on isolated PostgreSQL", () => {
  const databaseName = `titan_bulk_${randomUUID().replaceAll("-", "")}_test`;
  const previousUrl = process.env.DATABASE_URL;
  let admin: Pool;
  let pool: Pool;
  let created = false;
  let db: typeof import("@/db").db;
  let applyFn: (input: Input) => Promise<{ summary: Summary; message: string }>;
  let previewFn: (input: Input) => Promise<Summary & { blockedReason?: string | null }>;
  let undoFn: (input: Input) => Promise<{ cleared: number; keptEdited: number; message: string }>;
  let previewUndoFn: (input: Input) => Promise<{ willClear: number; keptEdited: number; blockedReason: string | null }>;
  let manual: typeof import("@/server-functions/hr/attendance/manual-punches-fn");
  let actorId: string;

  const run = <T,>(fn: (input: Input) => Promise<T>, employeeIds: string[], status: string, extra: Record<string, unknown> = {}) => {
    const { startDate = MON, endDate = startDate, conflictStrategy = "skip", ...template } = extra;
    return fn({
      data: { employeeIds, startDate, endDate, conflictStrategy, template: { status, ...template } },
      context: { session: { user: { id: actorId } } },
    });
  };
  const apply = (ids: string[], status: string, extra?: Record<string, unknown>) => run(applyFn, ids, status, extra);
  const preview = (ids: string[], status: string, extra?: Record<string, unknown>) => run(previewFn, ids, status, extra);
  const staff = async (extra: Partial<typeof employees.$inferInsert> = {}) =>
    (await db.insert(employees).values({
      employeeCode: randomUUID(), firstName: "Test", lastName: "Worker", designation: "Operator",
      joiningDate: "2026-01-01", shifts: SPLIT, restDays: [5], standardDutyHours: 8, ...extra,
    }).returning())[0];
  const day = async (employeeId: string, date = MON) =>
    db.query.attendance.findFirst({
      where: and(eq(attendance.employeeId, employeeId), eq(attendance.date, date)),
      with: { timeExceptions: true },
    });
  const punches = (employeeId: string, date = MON) =>
    db.query.attendancePunches.findMany({
      where: and(eq(attendancePunches.employeeId, employeeId), eq(attendancePunches.attendanceDate, date)),
      orderBy: [asc(attendancePunches.timestamp)],
    });
  const punch = (employeeId: string, at: string, direction: "in" | "out", attendanceDate = at.slice(0, 10)) =>
    db.insert(attendancePunches).values({ employeeId, attendanceDate, direction, source: "device_import", timestamp: new Date(`${at}+05:00`) });

  beforeAll(async () => {
    const adminUrl = new URL(configuredUrl!);
    if (!adminUrl.pathname.endsWith("_test")) throw new Error("Only a test database URL is accepted");
    adminUrl.pathname = "/postgres";
    admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    ({ db } = await import("@/db"));
    pool = db.$client;
    expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe(databaseName);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    const fns = await import("@/server-functions/hr/attendance/bulk-mark-attendance-range-fn");
    applyFn = fns.bulkMarkAttendanceRangeFn as unknown as typeof applyFn;
    previewFn = fns.previewBulkAttendanceFn as unknown as typeof previewFn;
    undoFn = fns.undoBulkPresentFn as unknown as typeof undoFn;
    previewUndoFn = fns.previewUndoBulkPresentFn as unknown as typeof previewUndoFn;
    manual = await import("@/server-functions/hr/attendance/manual-punches-fn");
  }, 120_000);

  beforeEach(async () => {
    expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe(databaseName);
    await pool.query('TRUNCATE employees, payrolls, order_bookers, "user" CASCADE');
    actorId = randomUUID();
    await db.insert(db._.fullSchema.user).values({ id: actorId, name: "HR", email: `${actorId}@test.invalid` });
  });

  afterAll(async () => {
    try {
      await pool?.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin?.end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  describe("present", () => {
    it("records every shift of the day, so a full day has no shortfall", async () => {
      const worker = await staff();
      await apply([worker.id], "present");
      const times = (await punches(worker.id)).map((p) => `${p.direction} ${p.timestamp.toISOString()}`);
      expect(times).toEqual([
        "in 2026-10-12T02:30:00.000Z", "out 2026-10-12T08:00:00.000Z",
        "in 2026-10-12T09:00:00.000Z", "out 2026-10-12T11:30:00.000Z",
      ]);
      const row = await day(worker.id);
      expect(row).toMatchObject({ status: "present", dutyHours: "8.00", overtimeHours: "0.00", isLate: false, earlyDepartureStatus: "none", entrySource: "manual", checkIn: "07:30:00", checkOut: "16:30:00" });
      expect(row!.timeExceptions).toEqual([]);
    });

    it("records a night shift that ends the next morning", async () => {
      const guard = await staff({ shifts: [{ start: "18:30", end: "06:30" }], restDays: [], standardDutyHours: 12 });
      await apply([guard.id], "present", { startDate: MON, endDate: TUE });
      for (const date of [MON, TUE]) {
        const row = await day(guard.id, date);
        expect(row).toMatchObject({ status: "present", dutyHours: "12.00", isNightShift: true, isLate: false, earlyDepartureStatus: "none" });
        expect(row!.timeExceptions).toEqual([]);
      }
    });

    it("marks field staff present for the day without inventing punches", async () => {
      const driver = await staff({ isDriver: true, shifts: [] });
      const salesman = await staff({ isSalesman: true, standardDutyHours: 9 });
      const result = await apply([driver.id, salesman.id], "present", { notes: "Field work confirmed" });
      expect(result.summary).toMatchObject({ created: 2, skippedMissingShift: 0 });
      expect(await day(driver.id)).toMatchObject({ status: "present", dutyHours: "8.00", checkIn: null, isLate: false, entrySource: "manual", notes: "Field work confirmed" });
      expect(await day(salesman.id)).toMatchObject({ status: "present", dutyHours: "9.00" });
      expect([...(await punches(driver.id)), ...(await punches(salesman.id))]).toEqual([]);
    });

    it("needs a note before resolving a field staff day, as the single-day form does", async () => {
      const driver = await staff({ isDriver: true, shifts: [] });
      expect(await preview([driver.id], "present")).toMatchObject({ willCreate: 1, noteNeeded: true });
      await expect(apply([driver.id], "present", { notes: "   " })).rejects.toThrow(/note/i);
      expect(await day(driver.id)).toBeUndefined();
    });

    it("does not record a shift on top of punches saved under a neighbouring day", async () => {
      const worker = await staff();
      await punch(worker.id, "2026-10-11T22:00:00", "in");
      await punch(worker.id, "2026-10-12T09:00:00", "out", "2026-10-11");
      const result = await apply([worker.id], "present");
      expect(result.summary).toMatchObject({ created: 0, skippedPunchDays: 1 });
      expect(await punches(worker.id)).toEqual([]);
    });

    it.each([[[]], [[{ start: "09:00", end: "09:00" }]], [[{ start: "14:00", end: "16:00" }, { start: "08:00", end: "12:00" }]]])(
      "skips office staff without a usable shift %j", async (shifts) => {
        const worker = await staff({ shifts });
        expect((await apply([worker.id], "present")).summary).toMatchObject({ created: 0, skippedMissingShift: 1 });
        expect(await day(worker.id)).toBeUndefined();
      });

    it("gives back banked hours when a comp-off leave becomes present", async () => {
      const worker = await staff({ compensatoryHoursBalance: "2" });
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "leave", leaveType: "compensatory", leaveApprovalStatus: "approved", compensatoryHoursUsed: "8" });
      await apply([worker.id], "present", { conflictStrategy: "overwrite" });
      expect(await day(worker.id)).toMatchObject({ status: "present", dutyHours: "8.00", leaveType: null, leaveApprovalStatus: "none", isApprovedLeave: false, compensatoryHoursUsed: "0.00" });
      expect((await db.query.employees.findFirst({ where: eq(employees.id, worker.id) }))!.compensatoryHoursBalance).toBe("10.00");
    });

    it("is safe to apply twice and when two people apply together", async () => {
      const worker = await staff();
      await Promise.all([apply([worker.id], "present", { conflictStrategy: "overwrite" }), apply([worker.id], "present", { conflictStrategy: "overwrite" })]);
      await apply([worker.id], "present", { conflictStrategy: "overwrite" });
      expect(await punches(worker.id)).toHaveLength(4);
      expect((await day(worker.id))!.dutyHours).toBe("8.00");
    });
  });

  describe("days it must not touch", () => {
    it.each(["absent", "leave", "holiday", "present"])("keeps a day with real punches when overwriting with %s", async (status) => {
      const worker = await staff();
      await punch(worker.id, `${MON}T07:30:00`, "in");
      await punch(worker.id, `${MON}T16:30:00`, "out");
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "present", dutyHours: "9.00", entrySource: "biometric" });
      const extra = { conflictStrategy: "overwrite", leaveType: status === "leave" ? "annual" : null };
      expect(await preview([worker.id], status, extra)).toMatchObject({ willCreate: 0, willUpdate: 0, skippedPunchDays: 1 });
      expect((await apply([worker.id], status, extra)).summary).toMatchObject({ created: 0, updated: 0, skippedPunchDays: 1 });
      expect(await day(worker.id)).toMatchObject({ status: "present", dutyHours: "9.00", entrySource: "biometric" });
    });

    it("never marks a punched day absent because its attendance row is missing", async () => {
      const worker = await staff();
      await punch(worker.id, `${MON}T07:30:00`, "in");
      expect((await apply([worker.id], "absent")).summary).toMatchObject({ created: 0, skippedPunchDays: 1 });
      expect(await day(worker.id)).toBeUndefined();
    });

    it("keeps recorded field work: trips, deliveries and device days", async () => {
      const ids: string[] = [];
      for (const [role, entrySource] of [["isOrderBooker", "order_booker_trip"], ["isSalesman", "salesman_activity"], ["isDriver", "driver_trip"], ["isDriver", "biometric"]] as const) {
        const person = await staff({ [role]: true, shifts: [] });
        ids.push(person.id);
        await db.insert(attendance).values({ employeeId: person.id, date: MON, status: "present", dutyHours: "8.00", entrySource });
      }
      expect((await apply(ids, "absent", { conflictStrategy: "overwrite", notes: "x" })).summary).toMatchObject({ updated: 0, skippedPunchDays: 4 });
      for (const id of ids) expect((await day(id))!.status).toBe("present");
    });

    it("keeps an order booker's trip day even when HR marked it by hand", async () => {
      const booker = await staff({ isOrderBooker: true, shifts: [] });
      const [linked] = await db.insert(orderBookers).values({ name: "Booker", employeeId: booker.id, phone: "1" } as typeof orderBookers.$inferInsert).returning();
      await db.insert(orderBookerTrips).values({ orderBookerId: linked.id, tripDate: new Date(`${MON}T01:00:00+05:00`), destination: "X" } as unknown as typeof orderBookerTrips.$inferInsert);
      await db.insert(attendance).values({ employeeId: booker.id, date: MON, status: "present", entrySource: "manual", notes: "HR" });
      expect((await apply([booker.id], "absent", { conflictStrategy: "overwrite", notes: "x" })).summary).toMatchObject({ updated: 0, skippedPunchDays: 1 });
      expect(await day(booker.id)).toMatchObject({ status: "present", notes: "HR" });
    });

    it("keeps a day whose overtime was already banked as comp-off", async () => {
      const worker = await staff({ compensatoryHoursBalance: "8" });
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "present", dutyHours: "16", overtimeHours: "8", overtimeStatus: "approved", overtimeCompensationMethod: "comp_off" });
      await apply([worker.id], "absent", { conflictStrategy: "overwrite" });
      expect(await day(worker.id)).toMatchObject({ status: "present", overtimeHours: "8.00" });
    });

    it("skips rest days, days before joining, and existing days", async () => {
      const worker = await staff({ joiningDate: TUE });
      await db.insert(attendance).values({ employeeId: worker.id, date: "2026-10-14", status: "holiday" });
      const extra = { startDate: MON, endDate: FRI };
      const expected = { skippedNotJoined: 1, skippedRestDays: 1, skippedExisting: 1 };
      expect(await preview([worker.id], "absent", extra)).toMatchObject({ ...expected, willCreate: 2 });
      expect((await apply([worker.id], "absent", extra)).summary).toMatchObject({ ...expected, created: 2 });
      expect(await day(worker.id, MON)).toBeUndefined();
      expect(await day(worker.id, FRI)).toBeUndefined();
      expect((await day(worker.id, "2026-10-14"))!.status).toBe("holiday");
    });

    it.each(["present", "absent"])("does not mark future days %s", async (status) => {
      const worker = await staff();
      const extra = { startDate: "2090-01-02", endDate: "2090-01-02" };
      expect(await preview([worker.id], status, extra)).toMatchObject({ willCreate: 0, skippedFuture: 1 });
      expect((await apply([worker.id], status, extra)).summary).toMatchObject({ created: 0, skippedFuture: 1 });
    });

    it("still allows a planned leave or holiday in the future", async () => {
      const worker = await staff({ restDays: [] });
      await apply([worker.id], "holiday", { startDate: "2090-01-02", notes: "Eid" });
      expect(await day(worker.id, "2090-01-02")).toMatchObject({ status: "holiday", notes: "Eid" });
    });
  });

  describe("leave", () => {
    it("skips the weekly rest day instead of refusing the whole range", async () => {
      const worker = await staff();
      const extra = { startDate: "2026-10-15", endDate: "2026-10-17", leaveType: "annual" };
      expect(await preview([worker.id], "leave", extra)).toMatchObject({ willCreate: 2, skippedRestDays: 1 });
      expect((await apply([worker.id], "leave", extra)).summary).toMatchObject({ created: 2, skippedRestDays: 1 });
      expect(await day(worker.id, "2026-10-15")).toMatchObject({ status: "leave", leaveType: "annual", leaveApprovalStatus: "pending", isApprovedLeave: false, dutyHours: "0.00" });
      expect(await day(worker.id, FRI)).toBeUndefined();
    });

    it("never charges leave on a recorded holiday", async () => {
      const worker = await staff();
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "holiday" });
      const extra = { startDate: MON, endDate: TUE, leaveType: "sick", conflictStrategy: "overwrite" };
      expect(await preview([worker.id], "leave", extra)).toMatchObject({ willCreate: 1, willUpdate: 0, skippedHolidays: 1 });
      expect((await apply([worker.id], "leave", extra)).summary).toMatchObject({ created: 1, skippedHolidays: 1 });
      expect((await day(worker.id))!.status).toBe("holiday");
    });

    it("refuses comp-off leave, which needs hours from the bank", async () => {
      const worker = await staff();
      await expect(apply([worker.id], "leave", { leaveType: "compensatory" })).rejects.toThrow();
      await expect(apply([worker.id], "leave", {})).rejects.toThrow(/leave type/i);
    });

    it("returns an approved annual day to the balance when it is replaced", async () => {
      const worker = await staff({ annualLeaveAllowance: 14, annualLeaveBalance: 12, leaveYearStart: "2026-01-01" });
      for (const date of [MON, TUE]) await db.insert(attendance).values({ employeeId: worker.id, date, status: "leave", leaveType: "annual", leaveApprovalStatus: "approved", isApprovedLeave: true });
      await apply([worker.id], "absent", { conflictStrategy: "overwrite" });
      expect((await db.query.employees.findFirst({ where: eq(employees.id, worker.id) }))!.annualLeaveBalance).toBe(13);
    });

    it("returns reserved comp-off hours exactly once", async () => {
      const worker = await staff({ compensatoryHoursBalance: "2" });
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "leave", leaveType: "compensatory", compensatoryHoursUsed: "8" });
      await apply([worker.id], "absent", { conflictStrategy: "overwrite" });
      await apply([worker.id], "holiday", { conflictStrategy: "overwrite" });
      expect((await db.query.employees.findFirst({ where: eq(employees.id, worker.id) }))!.compensatoryHoursBalance).toBe("10.00");
    });
  });

  describe("undo present", () => {
    const range = { startDate: MON, endDate: TUE };
    const undo = (ids: string[], extra = range) => undoFn({ data: { employeeIds: ids, ...extra }, context: { session: { user: { id: actorId } } } });
    const previewUndo = (ids: string[], extra = range) => previewUndoFn({ data: { employeeIds: ids, ...extra }, context: { session: { user: { id: actorId } } } });
    const call = (fn: unknown, data: Record<string, unknown>) => (fn as (input: Input) => Promise<unknown>)({ data, context: { session: { user: { id: actorId } } } });

    it("removes exactly what bulk present added, keeps a record of it, and can be repeated", async () => {
      const worker = await staff();
      const guard = await staff({ shifts: [{ start: "18:30", end: "06:30" }], restDays: [] });
      await apply([worker.id, guard.id], "present", range);
      expect(await previewUndo([worker.id, guard.id])).toMatchObject({ willClear: 4, keptEdited: 0, blockedReason: null });
      expect(await undo([worker.id, guard.id])).toMatchObject({ cleared: 4, keptEdited: 0 });
      expect(await db.query.attendance.findMany()).toEqual([]);
      expect(await db.query.attendancePunches.findMany()).toEqual([]);
      const audit = await db.query.attendancePunchCorrectionAudit.findMany();
      expect(audit).toHaveLength(12);
      expect(audit.every((row) => row.action === "delete" && row.changedByUserId === actorId && row.reason === "Bulk Mark Present undone")).toBe(true);
      expect(await undo([worker.id])).toMatchObject({ cleared: 0, keptEdited: 0 });
      await apply([worker.id], "present", range);
      expect((await day(worker.id))!.dutyHours).toBe("8.00");
      expect(await undo([worker.id], { startDate: TUE, endDate: TUE })).toMatchObject({ cleared: 1 });
      expect((await day(worker.id))!.status).toBe("present");
    });

    it("also undoes present that replaced a hand-marked day, leaving it unmarked", async () => {
      const worker = await staff();
      await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "absent" });
      await apply([worker.id], "present", { conflictStrategy: "overwrite" });
      expect(await undo([worker.id])).toMatchObject({ cleared: 1 });
      expect(await day(worker.id)).toBeUndefined();
    });

    it("never touches device, QR or hand-typed punches, field staff days or other statuses", async () => {
      const real = await staff();
      await punch(real.id, `${MON}T07:30:00`, "in");
      await db.insert(attendance).values({ employeeId: real.id, date: MON, status: "present", entrySource: "biometric" });
      const typed = await staff();
      await call(manual.addManualPunchFn, { employeeId: typed.id, timestamp: `${MON}T07:30:00+05:00`, note: "Bulk Mark" });
      const driver = await staff({ isDriver: true, shifts: [] });
      await apply([driver.id], "present", { notes: "x" });
      const absent = await staff();
      await apply([absent.id], "absent");
      await undo([]);
      for (const person of [real, typed, driver, absent]) expect(await day(person.id)).toBeDefined();
      expect([...(await punches(real.id)), ...(await punches(typed.id))]).toHaveLength(2);
    });

    it("keeps days HR changed afterwards", async () => {
      const people = await Promise.all([staff(), staff(), staff(), staff(), staff()]);
      const [corrected, removed, added, resaved, untouched] = people;
      await apply(people.map((p) => p.id), "present");
      await call(manual.correctPunchFn, { punchId: (await punches(corrected.id))[0].id, newTimestamp: `${MON}T07:40:00+05:00` });
      await call(manual.deletePunchFn, { punchId: (await punches(removed.id))[3].id });
      await call(manual.addManualPunchFn, { employeeId: added.id, timestamp: `${MON}T17:00:00+05:00` });
      const { upsertAttendanceFn } = await import("@/server-functions/hr/attendance/upsert-attendance-fn");
      await call(upsertAttendanceFn, { employeeId: resaved.id, date: MON, status: "present", entrySource: "manual", checkIn: null, checkOut: null, dutyHours: null, overtimeHours: null, isLate: null, isNightShift: null, isApprovedLeave: null, overtimeRemarks: null, overtimeStatus: null, notes: "Checked by HR" });
      expect(await previewUndo(people.map((p) => p.id))).toMatchObject({ willClear: 1, keptEdited: 4 });
      expect(await undo(people.map((p) => p.id))).toMatchObject({ cleared: 1, keptEdited: 4 });
      for (const person of [corrected, removed, added, resaved]) expect((await punches(person.id)).length).toBeGreaterThan(0);
      expect((await day(resaved.id))!.notes).toBe("Checked by HR");
      expect(await day(untouched.id)).toBeUndefined();
    });

    it("keeps a day that a device upload later confirmed", async () => {
      const worker = await staff({ shifts: [{ start: "08:00", end: "17:00" }] });
      await apply([worker.id], "present");
      const service = await import("@/lib/attendance/device-import/service.server");
      const csv = `Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\r\n${worker.employeeCode},W,F,${MON},Mon,2,"08:00, 17:00"`;
      const staged = await service.uploadDeviceAttendance(new File([csv], "x.csv", { type: "text/csv" }), actorId);
      await service.confirmDeviceAttendance({ importId: staged.importId }, actorId);
      expect(await undo([worker.id])).toMatchObject({ cleared: 0, keptEdited: 1 });
      expect((await punches(worker.id)).length).toBeGreaterThanOrEqual(2);
    });

    it("respects approved payroll, flags drafts and checks the range", async () => {
      const worker = await staff();
      await apply([worker.id], "present");
      await db.insert(payrolls).values({ month: "2026-10-01", startDate: MON, endDate: "2026-11-15", status: "draft" } as typeof payrolls.$inferInsert);
      await pool.query("UPDATE payrolls SET status = 'approved'");
      expect((await previewUndo([worker.id])).blockedReason).toMatch(/approved or paid/);
      await expect(undo([worker.id])).rejects.toThrow(/approved or paid/);
      expect(await punches(worker.id)).toHaveLength(4);
      await pool.query("UPDATE payrolls SET status = 'draft'");
      await undo([worker.id]);
      expect((await pool.query("SELECT 1 FROM payroll_attendance_invalidations WHERE resolved_at IS NULL")).rows).toHaveLength(1);
      await expect(undo([worker.id], { startDate: TUE, endDate: MON })).rejects.toThrow(/end date/i);
    });

    it("runs safely against a correction saved at the same moment", async () => {
      const worker = await staff();
      await apply([worker.id], "present");
      const id = (await punches(worker.id))[0].id;
      const [undone, correction] = await Promise.allSettled([undo([worker.id]), call(manual.correctPunchFn, { punchId: id, newTimestamp: `${MON}T07:40:00+05:00` })]);
      // Whoever is first wins completely; never a half-removed day.
      expect(undone.status).toBe("fulfilled");
      expect(await punches(worker.id)).toHaveLength(correction.status === "fulfilled" ? 4 : 0);
    });
  });

  it("clears every old detail when it replaces a hand-marked day", async () => {
    const worker = await staff();
    await db.insert(attendance).values({ employeeId: worker.id, date: MON, status: "present", checkIn: "08:00", checkOut: "12:00", dutyHours: "4", overtimeHours: "1", overtimeRemarks: "x", overtimeStatus: "approved", isLate: true, isNightShift: true, earlyDepartureStatus: "pending", checkOutReason: "x", notes: "old", shiftViolations: [{ shiftIndex: 0, late: true, earlyDeparture: false }] });
    expect((await apply([worker.id], "absent", { conflictStrategy: "overwrite" })).summary).toMatchObject({ updated: 1 });
    expect(await day(worker.id)).toMatchObject({ status: "absent", checkIn: null, checkOut: null, dutyHours: "0.00", overtimeHours: "0.00", overtimeRemarks: null, overtimeStatus: "pending", isLate: false, isNightShift: false, earlyDepartureStatus: "none", checkOutReason: null, notes: null, shiftViolations: [], entrySource: "manual" });
  });

  it("previews exactly what it then saves", async () => {
    const office = await staff();
    const driver = await staff({ isDriver: true, shifts: [], restDays: [0] });
    const noShift = await staff({ shifts: [] });
    await db.insert(attendance).values({ employeeId: office.id, date: TUE, status: "absent" });
    await punch(office.id, "2026-10-14T07:30:00", "in");
    for (const status of ["present", "absent", "leave", "holiday"])
      for (const conflictStrategy of ["skip", "overwrite"]) {
        const extra = { startDate: "2026-10-10", endDate: "2026-10-18", conflictStrategy, notes: "n", leaveType: status === "leave" ? "sick" : null };
        const ids = [office.id, driver.id, noShift.id];
        const { willCreate, willUpdate, ...before } = await preview(ids, status, extra);
        const { created: added, updated, ...after } = (await apply(ids, status, extra)).summary;
        expect({ added, updated }, `${status} ${conflictStrategy}`).toEqual({ added: willCreate, updated: willUpdate });
        for (const key of Object.keys(after)) expect(before[key], `${status} ${conflictStrategy} ${key}`).toBe(after[key]);
      }
  });

  it("with no names chosen marks active staff only", async () => {
    const active = await staff();
    const left = await staff({ status: "resigned" });
    expect((await apply([], "absent")).summary.created).toBe(1);
    expect(await day(left.id)).toBeUndefined();
    expect((await day(active.id))!.status).toBe("absent");
    await expect(apply([left.id], "absent")).rejects.toThrow(/no longer active/i);
  });

  it.each([
    ["backwards", TUE, MON, /end date/i],
    ["not real dates", "2026-02-31", "2026-03-01", /date/i],
    ["too long", "2026-01-01", "2026-12-31", /92/],
  ])("refuses a range that is %s", async (_name, startDate, endDate, message) => {
    const worker = await staff();
    await expect(apply([worker.id], "present", { startDate, endDate })).rejects.toThrow(message);
    await expect(preview([worker.id], "present", { startDate, endDate })).rejects.toThrow(message);
    expect(await db.query.attendancePunches.findMany()).toEqual([]);
  });

  it("changes nothing inside approved payroll and says so in the preview", async () => {
    const worker = await staff();
    await db.insert(payrolls).values({ month: "2026-10-01", startDate: TUE, endDate: "2026-11-15", status: "approved" } as typeof payrolls.$inferInsert);
    const extra = { startDate: MON, endDate: TUE };
    expect((await preview([worker.id], "absent", extra)).blockedReason).toMatch(/approved or paid/);
    await expect(apply([worker.id], "absent", extra)).rejects.toThrow(/approved or paid/);
    expect(await day(worker.id, MON)).toBeUndefined();
    expect((await preview([worker.id], "absent")).blockedReason).toBeNull();
  });

  it("asks for draft payslips to be regenerated after a change", async () => {
    const worker = await staff();
    await db.insert(payrolls).values({ month: "2026-10-01", startDate: MON, endDate: "2026-11-15", status: "draft" } as typeof payrolls.$inferInsert);
    await apply([worker.id], "absent", { startDate: MON, endDate: TUE });
    const { rows } = await pool.query("SELECT affected_summary FROM payroll_attendance_invalidations WHERE resolved_at IS NULL");
    expect(rows).toEqual([{ affected_summary: { employeeIds: [worker.id], attendanceDates: [MON, TUE] } }]);
  });

  it("marks a full month for 40 people in reasonable time", async () => {
    for (let i = 0; i < 40; i++) await staff({ restDays: [] });
    const start = Date.now();
    const { summary } = await apply([], "present", { startDate: "2026-09-16", endDate: "2026-10-15" });
    expect(summary.created).toBe(1200);
    console.log(`40 people x 30 days: ${Date.now() - start} ms`);
  }, 120_000);
});
