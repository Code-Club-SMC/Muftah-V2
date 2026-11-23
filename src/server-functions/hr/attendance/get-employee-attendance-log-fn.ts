import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  attendance,
  attendancePunches,
  attendanceTimeExceptions,
  employees,
  payrolls,
} from "@/db/schemas/hr-schema";
import { computeAttendanceFromPunches } from "@/lib/attendance/recompute";
import { syncAttendanceTimeExceptions } from "@/lib/attendance/time-exceptions.server";
import { nowPKTDate } from "@/lib/attendance/time";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, asc, between, eq, gte, inArray, lte } from "drizzle-orm";

export const getEmployeeAttendanceLogFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string(),
      startDate: z.string(), // YYYY-MM-DD
      endDate: z.string(), // YYYY-MM-DD
    }),
  )
  .handler(async ({ data }) => {
    const { employeeId, startDate, endDate } = data;

    const employee = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
    });

    if (!employee) throw new Error("Employee not found");

    const records = await db.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        between(attendance.date, startDate, endDate),
      ),
      orderBy: asc(attendance.date),
      with: { timeExceptions: { columns: { kind: true, minutes: true, status: true } } },
    });

    const punches = await db.query.attendancePunches.findMany({
      where: and(
        eq(attendancePunches.employeeId, employeeId),
        between(attendancePunches.attendanceDate, startDate, endDate),
      ),
      orderBy: [
        asc(attendancePunches.attendanceDate),
        asc(attendancePunches.timestamp),
      ],
    });

    const lockedPayrolls = await db.query.payrolls.findMany({
      where: and(
        lte(payrolls.startDate, endDate),
        gte(payrolls.endDate, startDate),
        inArray(payrolls.status, ["approved", "paid"]),
      ),
      columns: { startDate: true, endDate: true },
    });

    const punchesByDate = punches.reduce<Record<string, typeof punches>>(
      (acc, punch) => {
        if (!acc[punch.attendanceDate]) {
          acc[punch.attendanceDate] = [];
        }
        acc[punch.attendanceDate].push(punch);
        return acc;
      },
      {},
    );

    const shifts = employee.shifts ?? [];
    if (
      shifts.length > 0 &&
      !employee.isOrderBooker &&
      !employee.isSalesman &&
      !employee.isDriver
    ) {
      const recordsToSync = records.filter((r) => {
        const dayPunches = punchesByDate[r.date];
        if (r.status !== "present" || !dayPunches || dayPunches.length === 0)
          return false;
        const hasExceptions = r.timeExceptions && r.timeExceptions.length > 0;
        if (!hasExceptions) return true;
        const hasMissedShiftPunchCount = dayPunches.length < shifts.length * 2;
        const hasMissedShiftException = r.timeExceptions.some(
          (e) => e.kind === "missed_shift",
        );
        return hasMissedShiftPunchCount && !hasMissedShiftException;
      });

      if (recordsToSync.length > 0) {
        await db.transaction(async (tx) => {
          for (const r of recordsToSync) {
            const dayPunches = punchesByDate[r.date]!;
            const computed = computeAttendanceFromPunches(
              dayPunches.map((p) => ({
                direction: p.direction,
                timestamp: p.timestamp,
              })),
              {
                shifts,
                graceMinutes: 15,
                nightShiftStartHour: 20,
              },
            );
            await syncAttendanceTimeExceptions(tx, r, computed.shiftViolations);
          }
        });

        const updatedExceptions =
          await db.query.attendanceTimeExceptions.findMany({
            where: inArray(
              attendanceTimeExceptions.attendanceId,
              recordsToSync.map((r) => r.id),
            ),
            columns: {
              attendanceId: true,
              kind: true,
              minutes: true,
              status: true,
            },
          });

        const exceptionsByAttendanceId = new Map<
          string,
          Array<{ kind: any; minutes: number; status: any }>
        >();
        for (const exc of updatedExceptions) {
          const list = exceptionsByAttendanceId.get(exc.attendanceId) ?? [];
          list.push({
            kind: exc.kind,
            minutes: exc.minutes,
            status: exc.status,
          });
          exceptionsByAttendanceId.set(exc.attendanceId, list);
        }

        for (const r of records) {
          if (exceptionsByAttendanceId.has(r.id)) {
            r.timeExceptions = exceptionsByAttendanceId.get(r.id)!;
          }
        }
      }
    }

    return {
      employee,
      records,
      punchesByDate,
      lockedPayrolls,
      today: nowPKTDate(),
    };
  });
