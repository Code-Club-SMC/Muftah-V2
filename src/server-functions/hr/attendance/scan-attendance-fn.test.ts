import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/attendance/scan-attendance-fn.ts",
  ),
  "utf8",
);

describe("scanAttendanceFn source safeguards", () => {
  it("is restricted to the attendance terminal permission", () => {
    expect(SOURCE).toContain("requireAttendanceTerminalMiddleware");
  });

  it("uses a transaction for accepted scan writes", () => {
    expect(SOURCE).toContain("db.transaction(async (tx)");
    expect(SOURCE).toContain("recomputeAttendanceRow(");
  });

  it("appends punches and never updates the punch ledger from the scan path", () => {
    expect(SOURCE).toContain(".insert(attendancePunches)");
    expect(SOURCE).not.toContain(".update(attendancePunches)");
    expect(SOURCE).not.toContain(".delete(attendancePunches)");
  });

  it("audits rejected and duplicate scan attempts", () => {
    expect(SOURCE).toContain(".insert(attendanceScanAttempts)");
    expect(SOURCE).toContain("invalid_payload");
    expect(SOURCE).toContain("unknown_employee");
    expect(SOURCE).toContain("duplicate_scan");
  });

  it("can resolve barcode scans by employee code", () => {
    expect(SOURCE).toContain("parsedPayload.employeeId");
    expect(SOURCE).toContain("eq(employees.employeeCode, parsedPayload.employeeCode)");
  });

  it("uses server time instead of client supplied attendance timestamps", () => {
    expect(SOURCE).toContain("const now = new Date()");
    expect(SOURCE).not.toContain("data.timestamp");
    expect(SOURCE).not.toContain("data.attendanceDate");
  });
});
