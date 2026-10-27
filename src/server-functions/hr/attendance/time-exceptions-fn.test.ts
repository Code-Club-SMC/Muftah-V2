import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "time-exceptions-fn.ts"), "utf8");

describe("late/early decision server functions", () => {
  it("restricts both list and decide to HR managers (super admin passes via *)", () => {
    expect(source.match(/requireHrManageMiddleware/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/requireHrViewMiddleware/);
  });

  it("locks payroll writes and refuses dates in approved or paid payroll", () => {
    expect(source).toMatch(/lockAttendancePayrollWrites\(tx\)/);
    expect(source).toMatch(/assertAttendanceDatesEditable\(tx,/);
    expect(source).toMatch(/validateTimeExceptionDecision\(/);
  });

  it("appends to history instead of overwriting it", () => {
    expect(source).toMatch(/history:\s*\[\s*\.\.\.row\.history/);
  });

  it("lists only items on present days", () => {
    expect(source).toMatch(/eq\(attendance\.status, "present"\)/);
  });

  it("reads items only after taking the employee locks", () => {
    expect(source.indexOf("lockEmployeePunchWrites(tx")).toBeLessThan(
      source.indexOf("tx.query.attendanceTimeExceptions.findMany"),
    );
  });

  it("refuses decisions on days no longer marked present", () => {
    expect(source).toMatch(/row\.attendance\.status !== "present"/);
  });

  it("caps decided and all views but never pending", () => {
    expect(source).toMatch(/limited = data\.view !== "pending"/);
    expect(source).toMatch(/hasMore/);
  });
});

const helper = readFileSync(resolve(__dirname, "../../../lib/attendance/time-exceptions.server.ts"), "utf8");
const counts = readFileSync(resolve(__dirname, "../get-pending-approval-counts-fn.ts"), "utf8");

describe("pending late/early count", () => {
  it("skips items inside approved or paid payroll", () => {
    expect(helper).toMatch(/inArray\(payrolls\.status, \["approved", "paid"\]\)/);
  });

  it("is shared by the list and the payroll warning, and shown only to HR approvers", () => {
    expect(source).toMatch(/countOpenPendingTimeExceptions\(\)/);
    expect(counts).toMatch(/countOpenPendingTimeExceptions\(\)/);
    expect(counts).toMatch(/hasPermission\(context\.authContext\.permissions, "hr\.manage"\)/);
  });
});
