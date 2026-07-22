import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dailyAttendanceSource = readFileSync(
  resolve("src/server-functions/hr/attendance/get-daily-attendance-fn.ts"),
  "utf8",
);
const payrollCoreSource = readFileSync(
  resolve("src/server-functions/hr/payroll/core.ts"),
  "utf8",
);
const attendanceTableSource = readFileSync(
  resolve("src/components/hr/attendance/attendance-list-table.tsx"),
  "utf8",
);

describe("order-booker trip attendance phase 4 semantics", () => {
  it("includes order bookers in the daily attendance dataset", () => {
    expect(dailyAttendanceSource).not.toContain("eq(employees.isOrderBooker, false)");
    expect(dailyAttendanceSource).toContain("eq(employees.isSalesman, false)");
    expect(dailyAttendanceSource).toContain(
      "inArray(employees.status, [\"active\", \"on_leave\"])",
    );
    expect(dailyAttendanceSource).toContain("lte(employees.joiningDate, date)");
  });

  it("fetches punch timelines only for standard punch-driven employees", () => {
    expect(dailyAttendanceSource).toContain("const punchDrivenEmployeeIds");
    expect(dailyAttendanceSource).toContain(
      ".filter((employee) => !employee.isOrderBooker)",
    );
    expect(dailyAttendanceSource).toContain(
      "inArray(attendancePunches.employeeId, punchDrivenEmployeeIds)",
    );
  });

  it("blocks missing attendance for order bookers but still skips salesmen", () => {
    expect(payrollCoreSource).toContain("function shouldBlockMissingAttendance");
    expect(payrollCoreSource).toContain("if (employee.isOrderBooker) return true;");
    expect(payrollCoreSource).toContain("return !employee.isSalesman;");
    expect(payrollCoreSource).not.toContain("const isSalesOrOB");
  });

  it("shows no-row order-booker working days as pending review", () => {
    expect(attendanceTableSource).toContain("const PendingReviewBadge");
    expect(attendanceTableSource).toContain("Pending / Review");
    expect(attendanceTableSource).toContain("if (!record) return <PendingReviewBadge />;");
  });
});
