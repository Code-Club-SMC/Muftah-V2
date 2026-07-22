import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manualPunchSource = readFileSync(
  "src/server-functions/hr/attendance/manual-punches-fn.ts",
  "utf8",
);
const scanSource = readFileSync(
  "src/server-functions/hr/attendance/scan-attendance-fn.ts",
  "utf8",
);
const lockSource = readFileSync(
  "src/server-functions/hr/attendance/punch-write-lock.ts",
  "utf8",
);

describe("manual punch server source", () => {
  it("serializes punch writes and validates full punch order", () => {
    expect(lockSource).toContain("pg_advisory_xact_lock");
    expect(manualPunchSource).toContain("lockEmployeePunchWrites");
    expect(manualPunchSource).toContain("resolveInsertDirection");
    expect(manualPunchSource).toContain("canDeletePunch");
    expect(manualPunchSource).toContain(
      "This punch breaks the IN/OUT order",
    );
  });

  it("applies the same employee lock to scan punches", () => {
    expect(scanSource).toContain("lockEmployeePunchWrites");
    expect(scanSource).toContain("await lockEmployeePunchWrites(tx, employee.id)");
  });

  it("keeps overtime revalidation centralized in recomputeAttendanceRow", () => {
    expect(manualPunchSource).toContain("recomputeAttendanceRow(");
    expect(scanSource).toContain("recomputeAttendanceRow(");
    expect(manualPunchSource).not.toContain("revalidateOvertimeRequest");
    expect(scanSource).not.toContain("revalidateOvertimeRequest");
  });
});
