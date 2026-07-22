import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HR_DIR = resolve(process.cwd(), "src/server-functions/hr");
const HR_COMPONENTS_DIR = resolve(process.cwd(), "src/components/hr");
const HR_HOOKS_DIR = resolve(process.cwd(), "src/hooks/hr");
const HR_VALIDATORS_DIR = resolve(process.cwd(), "src/lib/validators");
const MIGRATIONS_DIR = resolve(process.cwd(), "src/db/migrations");

describe("hr payroll regressions", () => {
  it("keeps payroll status transitions explicit instead of substring-driven", () => {
    const source = readFileSync(
      resolve(HR_DIR, "payroll/payroll-fn.ts"),
      "utf8",
    );

    expect(source).toContain("const payrollTransitionRules");
    expect(source).toContain("pay: false");
    expect(source).toContain("\"approved-generate\": \"Approved payroll is locked.");
    expect(source).not.toContain(".includes(\"cannot\")");
  });

  it("uses simulation for preview and keeps draft payslip saves wallet-free", () => {
    const dashboardSource = readFileSync(
      resolve(HR_DIR, "payroll/dashboard-fn.ts"),
      "utf8",
    );
    const hookSource = readFileSync(
      resolve(HR_HOOKS_DIR, "use-save-payslip.ts"),
      "utf8",
    );
    const componentSource = readFileSync(
      resolve(HR_COMPONENTS_DIR, "payroll/salary-calculator-form.tsx"),
      "utf8",
    );

    expect(dashboardSource).toContain("simulateEmployeePayslipCore({");
    expect(dashboardSource).toContain("ignorePastUnmarkedDays: true");
    expect(dashboardSource).toContain("const payrollTotalAmount = await syncPayrollTotal");
    expect(dashboardSource).not.toContain("walletId: z.string().optional()");
    expect(hookSource).not.toContain("walletId: string");
    expect(componentSource).toContain("No wallet is debited here.");
    expect(componentSource).not.toContain("Please select a payment account before finalizing.");
  });

  it("keeps historical date windows and side-effect cleanup period-safe", () => {
    const salesPerformanceSource = readFileSync(
      resolve(HR_DIR, "payroll/sales-performance-fn.ts"),
      "utf8",
    );
    const tadaSource = readFileSync(
      resolve(HR_DIR, "rates/tada-rates-fn.ts"),
      "utf8",
    );
    const deleteEmployeeSource = readFileSync(
      resolve(HR_DIR, "employees/delete-employee-fn.ts"),
      "utf8",
    );
    const attendanceSource = readFileSync(
      resolve(HR_DIR, "attendance/bulk-mark-attendance-fn.ts"),
      "utf8",
    );

    expect(salesPerformanceSource).toContain("const monthEndExclusive = addMonths(monthStart, 1)");
    expect(salesPerformanceSource).not.toContain('new Date(`${yearMonth}-31T23:59:59`)');
    expect(tadaSource).toContain("where: lte(tadaRates.effectiveFrom, data.date)");
    expect(deleteEmployeeSource).toContain("await reversePayslipSideEffects(tx, payslip.id)");
    expect(deleteEmployeeSource).toContain("approved or paid payroll history");
    expect(attendanceSource).toContain("checkIn: null");
    expect(attendanceSource).toContain("leaveApprovalStatus: status === \"leave\" ? \"pending\" : \"none\"");
  });

  it("guards cash-moving HR workflows against stale or duplicate processing", () => {
    const payrollSource = readFileSync(
      resolve(HR_DIR, "payroll/payroll-fn.ts"),
      "utf8",
    );
    const advanceSource = readFileSync(
      resolve(HR_DIR, "advances/advances-fn.ts"),
      "utf8",
    );
    const tadaSource = readFileSync(
      resolve(HR_DIR, "payroll/tada-reimbursement-fn.ts"),
      "utf8",
    );
    const coreSource = readFileSync(resolve(HR_DIR, "payroll/core.ts"), "utf8");

    expect(payrollSource).toContain("eq(payrolls.status, \"approved\")");
    expect(payrollSource).toContain("gte(wallets.balance, payableAmount.toString())");
    expect(advanceSource).toContain("eq(salaryAdvances.status, \"pending\")");
    expect(advanceSource).toContain("gte(wallets.balance, advanceAmount.toString())");
    expect(tadaSource).toContain("Some selected TA/DA logs are no longer eligible");
    expect(tadaSource).toContain("gte(wallets.balance, totalAmount.toString())");
    expect(tadaSource).toContain("referenceId: expenseId");
    expect(coreSource).toContain("Commission records changed during payroll generation");
    expect(coreSource).toContain("TA/DA logs changed during payroll generation");
    expect(coreSource).toContain("Salary advance changed during payroll generation");
  });

  it("prevents hard deletion of employees with finance-linked HR history", () => {
    const deleteEmployeeSource = readFileSync(
      resolve(HR_DIR, "employees/delete-employee-fn.ts"),
      "utf8",
    );

    expect(deleteEmployeeSource).toContain("paid salary advances or recovered installments");
    expect(deleteEmployeeSource).toContain("reimbursed TA/DA history");
    expect(deleteEmployeeSource).toContain("isNotNull(salaryAdvances.walletId)");
    expect(deleteEmployeeSource).toContain("isNotNull(travelLogs.reimbursedAt)");
  });

  it("keeps daily attendance limited to eligible active employees", () => {
    const dailyAttendanceSource = readFileSync(
      resolve(HR_DIR, "attendance/get-daily-attendance-fn.ts"),
      "utf8",
    );

    expect(dailyAttendanceSource).toContain("inArray(employees.status, [\"active\", \"on_leave\"])");
    expect(dailyAttendanceSource).toContain("lte(employees.joiningDate, date)");
  });

  it("keeps payroll generation and approval scoped to eligible payroll employees", () => {
    const payrollSource = readFileSync(
      resolve(HR_DIR, "payroll/payroll-fn.ts"),
      "utf8",
    );

    expect(payrollSource).toContain("lte(employees.joiningDate, payroll.endDate)");
    expect(payrollSource).toContain("Cannot approve payroll with ineligible employee payslips.");
    expect(payrollSource).toContain("inArray(attendance.employeeId, payslipEmployeeIds)");
  });

  it("does not double-count attendance deductions in salary previews", () => {
    const componentSource = readFileSync(
      resolve(HR_COMPONENTS_DIR, "payroll/salary-calculator-form.tsx"),
      "utf8",
    );

    expect(componentSource).toContain("calculation.notEmployedDeduction");
    expect(componentSource).not.toContain("grossSalary + totalAttendanceDeduction");
    expect(componentSource).not.toContain("totalDeductions + totalAttendanceDeduction");
  });

  it("allows stale leave type values to be normalized when status changes", () => {
    const validatorSource = readFileSync(
      resolve(HR_VALIDATORS_DIR, "hr-validators.ts"),
      "utf8",
    );

    expect(validatorSource).toContain("Leave type is required when status is leave");
    expect(validatorSource).not.toContain("Leave type must be empty unless status is leave");
  });

  it("preserves punch-derived duty hours when HR saves notes or overtime", () => {
    const attendanceSource = readFileSync(
      resolve(HR_DIR, "attendance/upsert-attendance-fn.ts"),
      "utf8",
    );

    expect(attendanceSource).toContain("submittedDutyHours");
    expect(attendanceSource).toContain("punchDrivenDutyHours");
    expect(attendanceSource).toContain("const hasPunches = Boolean(punchRecord)");
    expect(attendanceSource).toContain("Number.isFinite(parsedHours)");
    expect(attendanceSource).toContain("finalDutyHours = submittedDutyHours");
    expect(attendanceSource).toContain(
      "else if (hasPunches && punchDrivenDutyHours !== null)",
    );
    expect(attendanceSource).toContain(
      "} else if (rest.status === \"present\" && !hasPunches) {",
    );
  });

  it("does not require punch records for order-booker present saves", () => {
    const formSource = readFileSync(
      resolve(HR_COMPONENTS_DIR, "attendance/edit-attendance-form.tsx"),
      "utf8",
    );

    expect(formSource).toContain("presentPunchesLoaded");
    expect(formSource).toContain("const requiresPunches");
    expect(formSource).toContain("!employee.isOrderBooker");
  });

  it("recalculates advance installments after reversing an old draft payslip", () => {
    const coreSource = readFileSync(resolve(HR_DIR, "payroll/core.ts"), "utf8");
    const reversalIndex = coreSource.indexOf("await reversePayslipSideEffects(tx, existingPayslip.id)");
    const recalculationIndex = coreSource.lastIndexOf("recalculateAdvanceDeductionsAfterPayslipReversal");

    expect(reversalIndex).toBeGreaterThan(-1);
    expect(recalculationIndex).toBeGreaterThan(reversalIndex);
    expect(coreSource).toContain("advanceDeductionDelta");
  });

  it("keeps migration history incremental while adding the punch ledger", () => {
    const migrationFiles = readdirSync(MIGRATIONS_DIR);
    const journalSource = readFileSync(
      resolve(MIGRATIONS_DIR, "meta/_journal.json"),
      "utf8",
    );
    const punchLedgerMigration = migrationFiles.find(
      (file) => file.startsWith("0007_") && file.endsWith(".sql"),
    );

    expect(migrationFiles).toContain("0000_solid_gertrude_yorkes.sql");
    expect(migrationFiles).toContain("0006_order_booker_bill_numbers.sql");
    expect(punchLedgerMigration).toBeTruthy();
    expect(journalSource).toContain("0000_solid_gertrude_yorkes");
    expect(journalSource).toContain("0006_order_booker_bill_numbers");
    expect(journalSource).toContain("0007_");
    expect(journalSource).not.toContain("0000_conscious_flatman");

    const migrationSource = readFileSync(
      resolve(MIGRATIONS_DIR, punchLedgerMigration!),
      "utf8",
    );

    expect(migrationSource).toContain('CREATE TABLE "attendance_punches"');
    expect(migrationSource).toContain('ALTER TABLE "attendance" DROP COLUMN "check_in_2"');
    expect(migrationSource).toContain('ALTER TABLE "attendance" DROP COLUMN "check_out_2"');
  });
});
