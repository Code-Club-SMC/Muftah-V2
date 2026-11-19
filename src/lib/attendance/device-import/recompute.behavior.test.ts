import { describe, expect, it, vi } from "vitest";
import { recomputeAttendanceRow, type AttendanceTx } from "../recompute-server";
import { compensatoryLedger, employees } from "@/db/schemas/hr-schema";

describe("device attendance recomputation", () => {
  it("clears compensatory usage and refunds once across repeated recomputation", async () => {
    let row: Record<string, unknown> = {
      id: "day",
      status: "leave",
      leaveType: "compensatory",
      compensatoryHoursUsed: "8",
      overtimeHours: "0",
    };
    const refund = vi.fn();
    const history: Record<string, unknown>[] = [];
    const tx = {
      query: {
        employees: {
          findFirst: async () => ({
            id: "emp",
            shifts: [],
            restDays: [0],
            standardDutyHours: 8,
          }),
        },
        hrPayrollSettings: {
          findFirst: async () => ({ attendanceGraceMinutes: 15 }),
        },
        attendance: { findFirst: async () => ({ ...row }) },
        attendanceTimeExceptions: { findMany: async () => [] },
        compensatoryLedger: { findFirst: async () => history[0] },
        attendancePunches: {
          findMany: async () => [
            {
              timestamp: new Date("2026-10-13T08:00:00+05:00"),
              direction: "in",
              source: "device_import",
            },
            {
              timestamp: new Date("2026-10-13T16:00:00+05:00"),
              direction: "out",
              source: "device_import",
            },
          ],
        },
      },
      update: (table: unknown) => {
        expect(table).toBe(employees);
        return { set: () => ({ where: refund }) };
      },
      insert: (table: unknown) => table === compensatoryLedger ? {
        values: (values: Record<string, unknown>) => {
          history.push(values);
          return { returning: async () => [values] };
        },
      } : ({
        values: () => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
            returning: async () => {
              row = { ...row, ...set };
              return [row];
            },
          }),
        }),
      }),
    } as unknown as AttendanceTx;
    await recomputeAttendanceRow(tx, "emp", "2026-10-13");
    await recomputeAttendanceRow(tx, "emp", "2026-10-13");
    await recomputeAttendanceRow(tx, "emp", "2026-10-13");
    expect(refund).toHaveBeenCalledTimes(1);
    expect(history).toMatchObject([
      { reason: "auto_refund", changeHours: "8.00", attendanceDate: "2026-10-13", actorId: null },
    ]);
    expect(row).toMatchObject({
      status: "present",
      dutyHours: "8.00",
      entrySource: "biometric",
      leaveType: null,
      compensatoryHoursUsed: "0",
    });
  });
});
