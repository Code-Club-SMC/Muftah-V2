import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const INVALIDATION_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/attendance/offline/payroll-invalidation.server.ts",
  ),
  "utf8",
);

const PAYROLL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/server-functions/hr/payroll/payroll-fn.ts"),
  "utf8",
);

describe("offline attendance payroll invalidation safeguards", () => {
  it("records draft payroll invalidations by batch and affected attendance", () => {
    expect(INVALIDATION_SOURCE).toContain("invalidateDraftPayrollsForAttendance");
    expect(INVALIDATION_SOURCE).toContain('eq(payrolls.status, "draft")');
    expect(INVALIDATION_SOURCE).toContain("affectedSummary");
    expect(INVALIDATION_SOURCE).toContain("importBatchId: input.batchId");
  });

  it("blocks payroll approval while offline attendance changes are unresolved", () => {
    expect(INVALIDATION_SOURCE).toContain("assertPayrollAttendanceCurrent");
    expect(INVALIDATION_SOURCE).toContain("isNull(payrollAttendanceInvalidations.resolvedAt)");
    expect(PAYROLL_SOURCE).toContain("await assertPayrollAttendanceCurrent");
  });

  it("resolves invalidations only from successful payslip generation flow", () => {
    expect(INVALIDATION_SOURCE).toContain("resolvePayrollAttendanceInvalidations");
    expect(PAYROLL_SOURCE).toContain("await resolvePayrollAttendanceInvalidations");
    expect(PAYROLL_SOURCE.indexOf("await resolvePayrollAttendanceInvalidations")).toBeGreaterThan(
      PAYROLL_SOURCE.indexOf("const totalAmount = await syncPayrollTotal"),
    );
  });
});
