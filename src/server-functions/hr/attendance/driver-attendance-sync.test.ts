import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_SOURCE = readFileSync(
  resolve("src/server-functions/hr/attendance/driver-attendance-sync.ts"),
  "utf8",
);

describe("driver-attendance-sync contract", () => {
  it("exports syncDriverAttendanceForDate and constant", () => {
    expect(SYNC_SOURCE).toContain("export const DRIVER_TRIP_ENTRY_SOURCE = \"driver_trip\"");
    expect(SYNC_SOURCE).toContain("export async function syncDriverAttendanceForDate");
  });

  it("checks driverTrips", () => {
    expect(SYNC_SOURCE).toContain("driverTrips");
    expect(SYNC_SOURCE).toContain("driverId");
  });

  it("protects manual HR attendance rows from overwrite", () => {
    expect(SYNC_SOURCE).toContain("entrySource !== DRIVER_TRIP_ENTRY_SOURCE");
    expect(SYNC_SOURCE).toContain("return { status: \"skipped_manual\" }");
  });

  it("deletes auto-generated row when trips drop to zero", () => {
    expect(SYNC_SOURCE).toContain(".delete(attendance)");
    expect(SYNC_SOURCE).toContain("existingAttendance.entrySource === DRIVER_TRIP_ENTRY_SOURCE");
  });

  it("sets checkIn and checkOut to null with standard duty hours", () => {
    expect(SYNC_SOURCE).toContain("checkIn: null");
    expect(SYNC_SOURCE).toContain("checkOut: null");
    expect(SYNC_SOURCE).toContain("dutyHours");
  });
});
