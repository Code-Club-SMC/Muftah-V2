import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { attendance, attendancePunches, db, employees, user } from "@/db";
import { deviceAttendancePersonMappings } from "@/db/schemas/device-attendance-schema";
import { drivers, driverTrips } from "@/db/schemas/sales-erp-schema";
import { confirmDeviceAttendance, previewDeviceAttendance, undoDeviceAttendanceImport, uploadDeviceAttendance } from "@/lib/attendance/device-import/service.server";

async function fixture() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "HR", email: `${id}@test.invalid` }).returning();
  const person = (firstName: string, role: object) => ({ employeeCode: `${firstName}-${id}`, firstName, lastName: "Test", designation: firstName, joiningDate: "2026-01-01", standardDutyHours: 9, ...role });
  const [booker, salesman, driver] = await db.insert(employees).values([
    person("Booker", { isOrderBooker: true }), person("Salesman", { isSalesman: true }), person("Driver", { isDriver: true }),
  ]).returning();
  const upload = async (lines: [string, string, string][]) => uploadDeviceAttendance(new File([
    "Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\r\n" +
      lines.map(([code, date, punches]) => `${code},Someone,Sales,${date},Day,${punches ? punches.split(",").length : 0},"${punches}"`).join("\r\n"),
  ], `${id}.csv`, { type: "text/csv" }), actor.id);
  const day = async (employeeId: string, date: string) => (await db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), eq(attendance.date, date))))[0];
  return { actor, booker, salesman, driver, upload, day };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("field staff in device uploads", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  const own = (preview: { rows: { employeeId: string | null; missingDay?: boolean; status: string }[] }, id: string) =>
    preview.rows.find((row) => row.employeeId === id && !row.missingDay)!.status;

  it("marks each role present for the day without saving punches", async () => {
    const preview = await f.upload([[f.booker.employeeCode, "2026-10-13", "09:00"], [f.salesman.employeeCode, "2026-10-13", "09:00, 18:00"], [f.driver.employeeCode, "2026-10-13", "07:10"]]);
    expect(await f.day(f.booker.id, "2026-10-13")).toBeUndefined();
    const result = await confirmDeviceAttendance({ importId: preview.importId }, f.actor.id);
    for (const person of [f.booker, f.salesman, f.driver]) {
      expect(own(result, person.id)).toBe("imported");
      expect(await f.day(person.id, "2026-10-13")).toMatchObject({ status: "present", dutyHours: "9.00", overtimeHours: "0.00", isLate: false, checkIn: null, entrySource: "biometric" });
      expect(await db.select().from(attendancePunches).where(eq(attendancePunches.employeeId, person.id))).toEqual([]);
      expect(await db.select().from(deviceAttendancePersonMappings).where(eq(deviceAttendancePersonMappings.employeeId, person.id))).toHaveLength(1);
    }
    expect(own(await previewDeviceAttendance({ importId: preview.importId }), f.driver.id)).toBe("unchanged");
  });

  it("links an unknown device ID to field staff", async () => {
    const preview = await f.upload([[`device-${f.actor.id}`, "2026-10-13", "09:00"]]);
    expect(preview.employees.map((e) => e.id)).toContain(f.salesman.id);
    await confirmDeviceAttendance({ importId: preview.importId, mappings: { [`device-${f.actor.id}`]: f.salesman.id } }, f.actor.id);
    expect((await f.day(f.salesman.id, "2026-10-13")).status).toBe("present");
  });

  it("undoes only its own days, even after being confirmed twice", async () => {
    await db.insert(attendance).values({ employeeId: f.booker.id, date: "2026-10-13", status: "present", entrySource: "manual", notes: "HR" });
    await db.insert(attendance).values({ employeeId: f.salesman.id, date: "2026-10-13", status: "leave" });
    const preview = await f.upload([[f.booker.employeeCode, "2026-10-13", "09:00"], [f.salesman.employeeCode, "2026-10-13", "09:00"], [f.driver.employeeCode, "2026-10-12", "09:00"], [f.driver.employeeCode, "2026-10-13", "09:00"]]);
    const result = await confirmDeviceAttendance({ importId: preview.importId }, f.actor.id);
    expect([own(result, f.booker.id), own(result, f.salesman.id)]).toEqual(["unchanged", "blocked"]);
    await confirmDeviceAttendance({ importId: preview.importId }, f.actor.id);
    // HR corrects one of the imported days.
    await db.update(attendance).set({ notes: "Checked by HR" }).where(and(eq(attendance.employeeId, f.driver.id), eq(attendance.date, "2026-10-12")));
    expect(await undoDeviceAttendanceImport(preview.importId, f.actor.id)).toMatchObject({ removedPresentDays: 1 });
    expect(await f.day(f.driver.id, "2026-10-13")).toBeUndefined();
    expect((await f.day(f.driver.id, "2026-10-12")).notes).toBe("Checked by HR");
    expect((await f.day(f.booker.id, "2026-10-13")).notes).toBe("HR");
    expect((await f.day(f.salesman.id, "2026-10-13")).status).toBe("leave");
  });

  it("goes back to the trip record when an import is undone", async () => {
    const [driver] = await db.insert(drivers).values({ name: f.driver.employeeCode, employeeId: f.driver.id }).returning();
    const preview = await f.upload([[f.driver.employeeCode, "2026-10-13", "09:00"]]);
    await confirmDeviceAttendance({ importId: preview.importId }, f.actor.id);
    await db.insert(driverTrips).values({ driverId: driver.id, tripDate: new Date("2026-10-13T10:00:00+05:00"), destination: "Lahore", ratePerKm: "10" });
    await undoDeviceAttendanceImport(preview.importId, f.actor.id);
    expect(await f.day(f.driver.id, "2026-10-13")).toMatchObject({ status: "present", entrySource: "driver_trip" });
  });
});
