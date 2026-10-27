import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recomputeAttendanceRow, type AttendanceTx } from "./recompute-server";

async function recompute(
  overtimeHours: string,
  endHour: string,
  reset = false,
) {
  let stored: Record<string, unknown> = {
    id: "day",
    status: "present",
    overtimeHours,
    overtimeStatus: "approved",
    overtimeRemarks: "Supervisor approved",
    earlyDepartureStatus: "none",
  };
  const tx = {
    query: {
      employees: {
        findFirst: async () => ({
          id: "emp",
          shifts: [],
          restDays: [],
          standardDutyHours: 8,
        }),
      },
      hrPayrollSettings: {
        findFirst: async () => ({ attendanceGraceMinutes: 15 }),
      },
      attendance: { findFirst: async () => stored },
      attendanceTimeExceptions: { findMany: async () => [] },
      attendancePunches: {
        findMany: async () => [
          {
            timestamp: new Date("2026-10-13T08:00:00+05:00"),
            direction: "in",
            source: "device_import",
          },
          {
            timestamp: new Date(`2026-10-13T${endHour}:00:00+05:00`),
            direction: "out",
            source: "device_import",
          },
        ],
      },
    },
    delete: () => ({ where: async () => undefined }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
          returning: async () => {
            stored = { ...stored, ...set };
            return [stored];
          },
        }),
      }),
    }),
  } as unknown as AttendanceTx;
  return recomputeAttendanceRow(tx, "emp", "2026-10-13", {
    manualFieldStrategy: reset ? "reset" : "preserve",
  });
}

describe("punch recomputation preserves HR overtime decisions", () => {
  it("retains an approved request and its remark while enough hours remain", async () => {
    expect(await recompute("2.00", "18")).toMatchObject({
      dutyHours: "10.00",
      overtimeHours: "2.00",
      overtimeStatus: "approved",
      overtimeRemarks: "Supervisor approved",
    });
  });
  it("returns an excessive approved request to pending when punches shorten the day", async () => {
    expect(await recompute("2.00", "17")).toMatchObject({
      dutyHours: "9.00",
      overtimeHours: "2.00",
      overtimeStatus: "pending",
      overtimeRemarks: "Supervisor approved",
    });
  });
  it("clears overtime fields when HR explicitly resets manual fields", async () => {
    expect(await recompute("2.00", "18", true)).toMatchObject({
      dutyHours: "10.00",
      overtimeHours: "0.00",
      overtimeStatus: "pending",
      overtimeRemarks: null,
    });
  });
});

describe("recompute keeps late/early items in sync", () => {
  const source = readFileSync(resolve(__dirname, "recompute-server.ts"), "utf8");

  it("syncs time exceptions after the attendance upsert", () => {
    const upsertAt = source.indexOf(".onConflictDoUpdate(");
    const syncAt = source.indexOf("syncAttendanceTimeExceptions(");
    expect(syncAt).toBeGreaterThan(upsertAt);
    expect(source).toMatch(/reset:\s*manualFieldStrategy === "reset"/);
  });
});
