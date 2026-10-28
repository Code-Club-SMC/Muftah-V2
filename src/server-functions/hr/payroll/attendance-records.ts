import type { attendance, attendanceTimeExceptions } from "@/db/schemas/hr-schema";
import type { AttendanceRecord } from "@/lib/payroll-calculator";

type TimeExceptionRow = Pick<typeof attendanceTimeExceptions.$inferSelect, "kind" | "minutes" | "status"> & {
  decidedByUser?: { name: string } | null;
};

export type PayrollAttendanceRow = typeof attendance.$inferSelect & {
  timeExceptions?: TimeExceptionRow[];
};

/** Drizzle `with` clause: load late/early items and who decided them. */
export const payrollAttendanceWith = {
  timeExceptions: {
    columns: { kind: true, minutes: true, status: true },
    with: { decidedByUser: { columns: { name: true } } },
  },
} as const;

export function toPayrollAttendanceRecord(r: PayrollAttendanceRow): AttendanceRecord {
  return {
    date: r.date,
    status: r.status,
    dutyHours: r.dutyHours,
    overtimeHours: r.overtimeHours,
    isNightShift: r.isNightShift || false,
    isApprovedLeave: r.isApprovedLeave ?? false,
    leaveType: r.leaveType ?? null,
    overtimeStatus: r.overtimeStatus ?? "pending",
    overtimeCompensationMethod: r.overtimeCompensationMethod as "payout" | "comp_off" | undefined,
    compensatoryHoursUsed: r.compensatoryHoursUsed,
    isLate: r.isLate ?? false,
    earlyDepartureStatus: r.earlyDepartureStatus ?? "none",
    timeExceptions: r.timeExceptions?.map((item) => ({
      kind: item.kind,
      minutes: item.minutes,
      status: item.status,
      decidedByName: item.decidedByUser?.name ?? null,
    })),
  };
}
