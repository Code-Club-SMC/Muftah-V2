import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COMPONENTS_DIR = resolve("src/components/hr/attendance");
const SERVER_DIR = resolve("src/server-functions/hr/attendance");

const bulkSheetSource = readFileSync(
  resolve(COMPONENTS_DIR, "bulk-attendance-sheet.tsx"),
  "utf8",
);
const attendanceListSource = readFileSync(
  resolve(COMPONENTS_DIR, "attendance-list-table.tsx"),
  "utf8",
);
const employeeLogSource = readFileSync(
  resolve(COMPONENTS_DIR, "employee-attendance-log.tsx"),
  "utf8",
);
const dailySource = readFileSync(
  resolve(SERVER_DIR, "get-daily-attendance-fn.ts"),
  "utf8",
);
const logSource = readFileSync(
  resolve(SERVER_DIR, "get-employee-attendance-log-fn.ts"),
  "utf8",
);
const bulkSource = readFileSync(
  resolve(SERVER_DIR, "bulk-mark-attendance-range-fn.ts"),
  "utf8",
);

describe("phase 6 attendance source", () => {
  it("keeps bulk present punch-driven instead of sending direct present times", () => {
    expect(bulkSheetSource).toContain("Present is punch-driven");
    expect(bulkSheetSource).toContain("Bulk present creates one `IN` punch");
    expect(bulkSheetSource).not.toContain("TimeField");
    expect(bulkSheetSource).not.toContain("Check-In");
    expect(bulkSheetSource).not.toContain("Check-Out");
  });

  it("creates manual punches for bulk present and recomputes the row", () => {
    expect(bulkSource).toContain("presentPunchRows");
    expect(bulkSource).toContain(".insert(attendancePunches)");
    expect(bulkSource).toContain("recomputeAttendanceRow");
    expect(bulkSource).toContain('manualFieldStrategy: "reset"');
    expect(bulkSource).toContain("skippedPunchDays");
    expect(bulkSource).toContain("skippedMissingShift");
    expect(bulkSource).not.toContain("template.checkIn");
    expect(bulkSource).not.toContain("template.checkOut");
  });

  it("feeds punch timelines into the standard staff list and employee log", () => {
    expect(dailySource).toContain("dailyPunches");
    expect(dailySource).toContain("attendancePunches");
    expect(logSource).toContain("punchesByDate");
    expect(logSource).toContain("attendancePunches");
    expect(attendanceListSource).toContain('header: "First Punch In"');
    expect(attendanceListSource).toContain('header: "Last Punch Out"');
    expect(employeeLogSource).toContain('header: "Punch Timeline"');
    expect(employeeLogSource).toContain("punchesByDate");
  });
});
