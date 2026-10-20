import { File as NodeFile } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, asc, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

// Keep the production handlers, validation and every database operation. Only
// replace the transport/auth boundary so tests can call handlers as HR.
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
        (input: { data: unknown; context: unknown }) =>
          callback({
            ...input,
            data: validator ? validator.parse(input.data) : input.data,
          }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({
  requireHrManageMiddleware: {},
  requireHrViewMiddleware: {},
}));

type Database = typeof import("@/db").db;
type Handler<Result = unknown> = (input: {
  data: Record<string, unknown>;
  context: { session: { user: { id: string } } };
}) => Promise<Result>;
type CorrectionResult = {
  punch: typeof attendancePunches.$inferSelect;
  attendance: typeof attendance.$inferSelect;
};
const configuredUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!configuredUrl)(
  "device attendance on isolated PostgreSQL",
  () => {
    const databaseName = `titan_device_${randomUUID().replaceAll("-", "")}_test`;
    let admin: Pool;
    let db: Database;
    let pool: Pool;
    let created = false;
    let service: typeof import("@/lib/attendance/device-import/service.server");
    let guards: typeof import("@/lib/attendance/device-import/payroll.server");
    let invalidations: typeof import("@/lib/attendance/offline/payroll-invalidation.server");
    let manual: typeof import("@/server-functions/hr/attendance/manual-punches-fn");
    let bulk: Handler;
    let upsert: Handler;
    let actorId: string;
    const previousUrl = process.env.DATABASE_URL;
    const date = "2026-10-01";

    const context = () => ({ session: { user: { id: actorId } } });
    const call = <Result = unknown>(
      handler: unknown,
      data: Record<string, unknown>,
    ) => (handler as Handler<Result>)({ data, context: context() });
    const file = (rows: Array<[string, string, string]>) =>
      new NodeFile(
        [
          "Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\r\n" +
            rows
              .map(
                ([code, day, punches]) =>
                  `${code},Worker,Factory,${day},Thu,${punches.split(",").length},"${punches}"`,
              )
              .join("\r\n"),
        ],
        "total-punches.csv",
        { type: "text/csv" },
      ) as unknown as File;
    const employee = async (
      code = "00112",
      shifts: { start: string; end: string }[] = [],
    ) => {
      const [result] = await db
        .insert(employees)
        .values({
          employeeCode: code,
          firstName: "Worker",
          lastName: code,
          designation: "Operator",
          joiningDate: "2026-01-01",
          shifts,
          restDays: [],
        })
        .returning();
      return result;
    };
    const upload = (code = "00112", punches = "08:00, 17:00", day = date) =>
      service.uploadDeviceAttendance(file([[code, day, punches]]), actorId);
    const confirm = (importId: string) =>
      service.confirmDeviceAttendance({ importId }, actorId);
    const punchesFor = (employeeId: string) =>
      db.query.attendancePunches.findMany({
        where: eq(attendancePunches.employeeId, employeeId),
        orderBy: [asc(attendancePunches.timestamp)],
      });

    beforeAll(async () => {
      const adminUrl = new URL(configuredUrl!);
      if (!adminUrl.pathname.endsWith("_test"))
        throw new Error("Only a test database URL is accepted");
      adminUrl.pathname = "/postgres";
      admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const cleanUrl = new URL(adminUrl);
      cleanUrl.pathname = `/${databaseName}`;
      cleanUrl.searchParams.set(
        "application_name",
        "device-attendance-integration",
      );
      // No module importing the production db is evaluated until its URL is the
      // random database. The configured TEST_DATABASE_URL database is never used.
      process.env.DATABASE_URL = cleanUrl.toString();
      ({ db } = await import("@/db"));
      pool = db.$client;
      expect(
        (await pool.query("SELECT current_database() AS name")).rows[0].name,
      ).toBe(databaseName);
      await migrate(db, { migrationsFolder: "src/db/migrations" });
      service = await import("@/lib/attendance/device-import/service.server");
      guards = await import("@/lib/attendance/device-import/payroll.server");
      invalidations =
        await import("@/lib/attendance/offline/payroll-invalidation.server");
      manual =
        await import("@/server-functions/hr/attendance/manual-punches-fn");
      bulk = (
        await import("@/server-functions/hr/attendance/bulk-mark-attendance-range-fn")
      ).bulkMarkAttendanceRangeFn as unknown as Handler;
      upsert = (
        await import("@/server-functions/hr/attendance/upsert-attendance-fn")
      ).upsertAttendanceFn as unknown as Handler;
    });

    beforeEach(async () => {
      // Assert the target again before the only destructive fixture operation.
      expect(
        (await pool.query("SELECT current_database() AS name")).rows[0].name,
      ).toBe(databaseName);
      await pool.query(
        'TRUNCATE employees, payrolls, device_attendance_imports, "user" CASCADE',
      );
      actorId = randomUUID();
      await db.insert(db._.fullSchema.user).values({
        id: actorId,
        name: "HR integration",
        email: `${actorId}@test.invalid`,
      });
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

    it("applies every immutable generated migration, including device attendance, to an empty database", async () => {
      const journal = JSON.parse(
        await readFile("src/db/migrations/meta/_journal.json", "utf8"),
      ) as { entries: { tag: string }[] };
      expect(
        journal.entries.some((entry) => entry.tag.startsWith("0017_")),
      ).toBe(true);
      const applied = await pool.query(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
      );
      expect(applied.rows[0].count).toBe(journal.entries.length);
      const tables = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      );
      expect(tables.rows.map((row) => row.tablename)).toEqual(
        expect.arrayContaining([
          "device_attendance_imports",
          "device_attendance_person_mappings",
          "device_attendance_punch_claims",
          "payroll_attendance_invalidations",
        ]),
      );
      const columns = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'payroll_attendance_invalidations'",
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(
        expect.arrayContaining(["revision", "device_import_id"]),
      );
    });

    it("imports the exact 52-row, 138-punch workbook by employee code and serializes concurrent retries", async () => {
      const bytes = await readFile(
        "src/__tests__/fixtures/device-attendance/total-punches.xlsx",
      );
      const { parseDevicePunchReport } =
        await import("@/lib/attendance/device-import/parser.server");
      const parsed = await parseDevicePunchReport(bytes);
      const codes = [...new Set(parsed.rows.map((row) => row.personId))];
      expect(codes).toHaveLength(6);
      for (const code of codes) await employee(code);
      const preview = await service.uploadDeviceAttendance(
        new NodeFile([bytes], "client-report.csv") as unknown as File,
        actorId,
      );
      expect(preview.format).toBe("xlsx");
      expect(preview.rows).toHaveLength(52);
      expect(preview.rows.every((row) => row.employeeId !== null)).toBe(true);
      expect(await db.query.attendancePunches.findMany()).toHaveLength(0);
      const staged = await db.query.deviceAttendanceImports.findFirst({
        where: eq(deviceAttendanceImports.id, preview.importId),
      });
      expect(
        staged?.report.rows.reduce((sum, row) => sum + row.punches.length, 0),
      ).toBe(138);
      const results = await Promise.all([
        confirm(preview.importId),
        confirm(preview.importId),
      ]);
      expect(results.every((result) => result.status === "completed")).toBe(
        true,
      );
      expect(await db.query.attendancePunches.findMany()).toHaveLength(138);
      expect(
        await db.query.deviceAttendancePunchClaims.findMany(),
      ).toHaveLength(138);
      const duplicate = await service.uploadDeviceAttendance(
        new NodeFile([bytes], "again.xlsx") as unknown as File,
        actorId,
      );
      await confirm(duplicate.importId);
      expect(await db.query.attendancePunches.findMany()).toHaveLength(138);
      expect(
        await db.query.deviceAttendancePunchClaims.findMany(),
      ).toHaveLength(138);
      expect(
        (await db.query.attendance.findMany()).every(
          (row) => row.status === "present",
        ),
      ).toBe(true);
      expect(
        (
          await db.query.deviceAttendanceImports.findFirst({
            where: eq(deviceAttendanceImports.id, preview.importId),
          })
        )?.resultRows,
      ).toHaveLength(52);
    });

    it("recomputes eight paid hours excluding breaks, persists explicit mappings and rechecks live HR decisions", async () => {
      const staff = await employee();
      const staged = await upload("external-112", "08:00, 13:00, 14:00, 17:00");
      expect(staged.rows[0].employeeId).toBeNull();
      const selection = {
        importId: staged.importId,
        mappings: { "external-112": staff.id },
      };
      expect(
        (await service.previewDeviceAttendance(selection)).rows[0],
      ).toMatchObject({ dutyHours: "8.00", newPunchCount: 4 });
      await service.confirmDeviceAttendance(selection, actorId);
      const day = await db.query.attendance.findFirst({
        where: eq(attendance.employeeId, staff.id),
      });
      expect(day).toMatchObject({
        dutyHours: "8.00",
        entrySource: "biometric",
        status: "present",
      });
      expect(
        (await punchesFor(staff.id)).map((punch) => punch.direction),
      ).toEqual(["in", "out", "in", "out"]);
      expect(
        await db.query.deviceAttendancePersonMappings.findFirst(),
      ).toMatchObject({ personId: "external-112", employeeId: staff.id });
      const later = await upload("external-112", "08:00, 17:00", "2026-10-02");
      expect(later.rows[0].status).toBe("ready");
      await db.insert(attendance).values({
        employeeId: staff.id,
        date: "2026-10-02",
        status: "leave",
        entrySource: "manual",
      });
      expect((await confirm(later.importId)).rows[0].status).toBe("blocked");
      expect(await punchesFor(staff.id)).toHaveLength(4);
    });

    it("closes a cross-upload overnight shift on its original date without absorbing a daytime missed checkout", async () => {
      const night = await employee("night", [{ start: "20:00", end: "06:00" }]);
      await confirm((await upload("night", "20:00")).importId);
      await expect(
        guards.assertDeviceAttendanceResolved(db, night.id, date, date),
      ).rejects.toThrow("needs HR review");
      const morning = await upload("night", "06:00", "2026-10-02");
      await confirm(morning.importId);
      expect(
        (await punchesFor(night.id)).map((punch) => [
          punch.attendanceDate,
          punch.direction,
        ]),
      ).toEqual([
        [date, "in"],
        [date, "out"],
      ]);
      expect(
        await db.query.attendance.findFirst({
          where: eq(attendance.employeeId, night.id),
        }),
      ).toMatchObject({ date, dutyHours: "10.00", isNightShift: true });
      await expect(
        guards.assertDeviceAttendanceResolved(db, night.id, date, "2026-10-02"),
      ).resolves.toBeUndefined();
      expect(
        await db.query.attendance.findFirst({
          where: and(
            eq(attendance.employeeId, night.id),
            eq(attendance.date, "2026-10-02"),
          ),
        }),
      ).toBeUndefined();
      const day = await employee("day", [{ start: "08:00", end: "17:00" }]);
      await confirm((await upload("day", "08:00")).importId);
      await confirm(
        (await upload("day", "08:00, 17:00", "2026-10-02")).importId,
      );
      expect(
        (await punchesFor(day.id)).map((punch) => [
          punch.attendanceDate,
          punch.direction,
        ]),
      ).toEqual([
        [date, "in"],
        ["2026-10-02", "in"],
        ["2026-10-02", "out"],
      ]);
      await expect(
        guards.assertDeviceAttendanceResolved(db, day.id, date, "2026-10-02"),
      ).rejects.toThrow("needs HR review");
      await db
        .update(attendance)
        .set({ status: "absent" })
        .where(
          and(eq(attendance.employeeId, day.id), eq(attendance.date, date)),
        );
      await expect(
        guards.assertDeviceAttendanceResolved(db, day.id, date, "2026-10-02"),
      ).resolves.toBeUndefined();
    });

    it("retains raw claims and audit through real manual correction, deletion and reupload", async () => {
      const staff = await employee();
      const staged = await upload();
      await confirm(staged.importId);
      const original = (await punchesFor(staff.id))[1];
      await expect(
        call(manual.correctPunchFn, {
          punchId: original.id,
          newTimestamp: `${date}T16:00:00+05:00`,
        }),
      ).rejects.toThrow();
      const corrected = await call<CorrectionResult>(manual.correctPunchFn, {
        punchId: original.id,
        newTimestamp: `${date}T16:00:00+05:00`,
        reason: "Device checkout was incorrect",
      });
      expect(corrected.attendance.dutyHours).toBe("8.00");
      const raw = await db.query.deviceAttendancePunchClaims.findFirst({
        where: eq(deviceAttendancePunchClaims.timestamp, original.timestamp),
      });
      expect(raw).toMatchObject({
        punchId: corrected.punch.id,
        timestamp: original.timestamp,
        attendanceDate: date,
      });
      await confirm((await upload()).importId);
      expect(
        (await punchesFor(staff.id)).map((punch) =>
          punch.timestamp.toISOString(),
        ),
      ).toEqual([`${date}T03:00:00.000Z`, `${date}T11:00:00.000Z`]);
      await expect(
        call(manual.deletePunchFn, { punchId: corrected.punch.id }),
      ).rejects.toThrow();
      await call(manual.deletePunchFn, {
        punchId: corrected.punch.id,
        reason: "Remove incorrect device checkout",
      });
      expect(
        await db.query.deviceAttendancePunchClaims.findFirst({
          where: eq(deviceAttendancePunchClaims.id, raw!.id),
        }),
      ).toMatchObject({ punchId: null, timestamp: original.timestamp });
      await confirm((await upload()).importId);
      expect(await punchesFor(staff.id)).toHaveLength(1);
      expect(
        await db.query.deviceAttendancePunchClaims.findMany(),
      ).toHaveLength(2);
      expect(
        (await db.query.attendancePunchCorrectionAudit.findMany())
          .map((row) => row.action)
          .sort(),
      ).toEqual(["correct", "delete"]);
      await expect(
        guards.assertDeviceAttendanceResolved(db, staff.id, date, date),
      ).rejects.toThrow("needs HR review");

      // A correction can move evidence beyond the report's surrounding day.
      // Raw identity stays on October 1 while review follows the corrected day.
      const remaining = (await punchesFor(staff.id))[0];
      const movedDate = "2026-10-06";
      const moved = await call<CorrectionResult>(manual.correctPunchFn, {
        punchId: remaining.id,
        newTimestamp: `${movedDate}T08:00:00+05:00`,
        reason: "Correct device punch to its actual work day",
      });
      const movedClaim = await db.query.deviceAttendancePunchClaims.findFirst({
        where: eq(deviceAttendancePunchClaims.punchId, moved.punch.id),
      });
      expect(movedClaim).toMatchObject({
        timestamp: remaining.timestamp,
        reportDate: date,
        attendanceDate: movedDate,
      });
      const oldReport = await upload();
      expect(oldReport.rows[0]).toMatchObject({
        status: "needs_review",
        newPunchCount: 0,
        attendanceDates: expect.arrayContaining([movedDate]),
      });
      await confirm(oldReport.importId);
      expect(await punchesFor(staff.id)).toHaveLength(1);
      await db.insert(attendance).values({
        employeeId: staff.id,
        date,
        status: "absent",
        entrySource: "manual",
      });
      await db
        .update(attendance)
        .set({ status: "absent" })
        .where(
          and(
            eq(attendance.employeeId, staff.id),
            eq(attendance.date, movedDate),
          ),
        );
      const resolved = await upload();
      expect(resolved.rows[0]).toMatchObject({
        status: "unchanged",
        newPunchCount: 0,
      });
      await expect(
        guards.assertDeviceAttendanceResolved(db, staff.id, date, movedDate),
      ).resolves.toBeUndefined();
    });

    it("keeps invalidations committed after a generation snapshot unresolved until the next generation", async () => {
      const staff = await employee();
      const [payroll] = await db
        .insert(payrolls)
        .values({ month: "2026-10-01", startDate: date, endDate: "2026-10-31" })
        .returning();
      await confirm((await upload()).importId);
      const snapshot = await db.query.payrollAttendanceInvalidations.findMany({
        columns: { id: true, revision: true },
      });
      expect(snapshot).toHaveLength(1);
      await expect(
        db.transaction((tx) =>
          invalidations.assertPayrollAttendanceCurrent(tx, payroll.id),
        ),
      ).rejects.toThrow("Regenerate payslips");
      const last = (await punchesFor(staff.id))[1];
      await call(manual.correctPunchFn, {
        punchId: last.id,
        newTimestamp: `${date}T16:00:00+05:00`,
        reason: "Correction during payslip generation",
      });
      const changed = await db.query.payrollAttendanceInvalidations.findFirst();
      expect(changed!.revision).toBe(snapshot[0].revision + 1);
      await db.transaction((tx) =>
        invalidations.resolvePayrollAttendanceInvalidations(
          tx,
          payroll.id,
          actorId,
          snapshot,
        ),
      );
      expect(
        (await db.query.payrollAttendanceInvalidations.findFirst())?.resolvedAt,
      ).toBeNull();
      await expect(
        db.transaction((tx) =>
          invalidations.assertPayrollAttendanceCurrent(tx, payroll.id),
        ),
      ).rejects.toThrow("Regenerate payslips");
      const newSnapshot = [{ id: changed!.id, revision: changed!.revision }];
      await db.transaction((tx) =>
        invalidations.resolvePayrollAttendanceInvalidations(
          tx,
          payroll.id,
          actorId,
          newSnapshot,
        ),
      );
      await expect(
        db.transaction((tx) =>
          invalidations.assertPayrollAttendanceCurrent(tx, payroll.id),
        ),
      ).resolves.toBeUndefined();
      expect(
        (await db.query.payrollAttendanceInvalidations.findFirst())
          ?.resolvedByUserId,
      ).toBe(actorId);
    });

    it("blocks imports previewed before approval and manual changes to approved and paid attendance", async () => {
      const staff = await employee();
      await confirm((await upload()).importId);
      const pending = await upload("00112", "08:00, 17:00", "2026-10-02");
      expect(pending.rows[0].status).toBe("ready");
      const [payroll] = await db
        .insert(payrolls)
        .values({
          month: date,
          startDate: date,
          endDate: "2026-10-31",
          status: "approved",
        })
        .returning();
      expect((await confirm(pending.importId)).rows[0].status).toBe("blocked");
      const original = (await punchesFor(staff.id))[1];
      for (const status of ["approved", "paid"]) {
        await db
          .update(payrolls)
          .set({ status })
          .where(eq(payrolls.id, payroll.id));
        await expect(
          call(manual.correctPunchFn, {
            punchId: original.id,
            newTimestamp: `${date}T16:00:00+05:00`,
            reason: "Attempt locked payroll correction",
          }),
        ).rejects.toThrow("approved or paid payroll");
        await expect(
          call(manual.deletePunchFn, {
            punchId: original.id,
            reason: "Attempt locked payroll deletion",
          }),
        ).rejects.toThrow("approved or paid payroll");
        await expect(
          call(manual.addManualPunchFn, {
            employeeId: staff.id,
            timestamp: `${date}T18:00:00+05:00`,
          }),
        ).rejects.toThrow("approved or paid payroll");
      }
      expect(await punchesFor(staff.id)).toHaveLength(2);
      expect(
        await db.query.attendancePunchCorrectionAudit.findMany(),
      ).toHaveLength(0);
    });

    it("makes bulk and single-day manual presence read punches after the queued import releases the shared lock", async () => {
      for (const operation of ["bulk", "upsert"]) {
        const staff = await employee(operation, [
          { start: "08:00", end: "17:00" },
        ]);
        const staged = await upload(operation);
        const blocker = await pool.connect();
        const waitForBlocked = async (count: number) => {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            const result = await pool.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND wait_event = 'advisory'",
              [databaseName],
            );
            if (result.rows[0].count >= count) return;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error(
            `Timed out waiting for ${count} attendance lock waiters`,
          );
        };
        const pending: Promise<unknown>[] = [];
        try {
          await blocker.query("BEGIN");
          await blocker.query(
            "SELECT pg_advisory_xact_lock(hashtext('attendance_payroll_write'))",
          );
          const importing = confirm(staged.importId);
          pending.push(importing);
          await waitForBlocked(1);
          const marking =
            operation === "bulk"
              ? bulk({
                  data: {
                    employeeIds: [staff.id],
                    startDate: date,
                    endDate: date,
                    template: { status: "present", entrySource: "manual" },
                    conflictStrategy: "overwrite",
                  },
                  context: context(),
                })
              : upsert({
                  data: {
                    employeeId: staff.id,
                    date,
                    status: "present",
                    entrySource: "manual",
                    dutyHours: "1.00",
                    checkIn: "09:00",
                    checkOut: "10:00",
                    overtimeHours: null,
                    isLate: null,
                    isNightShift: null,
                    isApprovedLeave: null,
                    overtimeRemarks: null,
                    overtimeStatus: null,
                    notes: null,
                  },
                  context: context(),
                });
          pending.push(marking);
          await waitForBlocked(2);
          await blocker.query("COMMIT");
          await importing;
          const result = await marking;
          if (operation === "bulk")
            expect(result).toMatchObject({
              summary: { created: 0, updated: 0, skippedPunchDays: 1 },
            });
          else
            expect(result).toMatchObject({
              dutyHours: "9.00",
              entrySource: "biometric",
            });
          expect(await punchesFor(staff.id)).toHaveLength(2);
          expect(
            (await punchesFor(staff.id)).every(
              (punch) => punch.source === "device_import",
            ),
          ).toBe(true);
          expect(
            (
              await db.query.attendance.findFirst({
                where: eq(attendance.employeeId, staff.id),
              })
            )?.dutyHours,
          ).toBe("9.00");
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await Promise.allSettled(pending);
        }
      }
    });
  },
);
