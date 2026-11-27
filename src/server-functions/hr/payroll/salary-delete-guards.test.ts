import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("salary payments block deletes", () => {
  it("a payroll with salary payments can't be deleted", () => {
    const source = read("src/server-functions/hr/payroll/payroll-fn.ts");
    const fn = source.slice(source.indexOf("export const deletePayrollFn"));
    const guard = fn.indexOf("This payroll has salary payments. Undo them before deleting the payroll.");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fn.indexOf("tx.delete(payslips)"));
  });

  it("an employee with salary payments can't be deleted", () => {
    const source = read("src/server-functions/hr/employees/delete-employee-fn.ts");
    const fn = source.slice(source.indexOf("export const approveEmployeeDeletionFn"));
    const guard = fn.indexOf("Cannot delete an employee with salary payments. Archive the employee instead.");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fn.indexOf("reversePayslipSideEffects"));
  });
});
