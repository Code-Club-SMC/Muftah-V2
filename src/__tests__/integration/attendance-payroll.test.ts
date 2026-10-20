import { File as NodeFile } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWANCES, BASIC_POLICY, CYCLE, LEAVE_TYPES, MANDATORY_CASES, REAL_EMPLOYEES, SOURCE, WORKING_DATES } from "../e2e/attendance-payroll.fixtures";
import { assertPayrollTestUrl } from "../e2e/attendance-payroll.safety";

// Capture only the transport. Both forms of production validators still run.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (value: unknown) => unknown } | ((value: unknown) => unknown) | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (value: typeof validator) => { validator = value; return builder; },
    handler: (handler: (input: { data: unknown; context: unknown }) => unknown) =>
      (input: { data: unknown; context: unknown }) => handler({ ...input, data: typeof validator === "function" ? validator(input.data) : validator?.parse(input.data) ?? input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireHrManageMiddleware: {}, requireHrViewMiddleware: {}, requireSalesManageMiddleware: {}, requireSalesViewMiddleware: {} }));

type Manifest = { scenario: "controlled" | "real"; database: string; employees: { id: string; code: string; revisionId: string; net: number; deductions: number }[]; walletId: string; actors: { kind: string; userId: string }[] };
type Comparison = { field: string; expected: unknown; actual: unknown };
type Check = { name: string; caseIds: string[]; passed: boolean; expected: unknown; actual: unknown; comparisons: Comparison[] };
type Handler = (input: { data: Record<string, unknown>; context: unknown }) => Promise<any>;
const limitation = "Production validators, handlers, transactions and PostgreSQL run unchanged. Only server-function transport and middleware are captured; authenticated HR context is supplied explicitly. These calls do not establish HTTP authentication or RBAC enforcement. Browser results report that coverage separately.";
const enabled = Boolean(process.env.PAYROLL_E2E_DIRECTORY);

describe.runIf(enabled)("attendance to payroll, real PostgreSQL lifecycle", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db");
  let manifest: Manifest;
  let payroll: typeof import("@/server-functions/hr/payroll/payroll-fn");
  let core: typeof import("@/server-functions/hr/payroll/core");
  let upsert: Handler, leave: Handler, overtime: Handler, convert: Handler;
  let manual: typeof import("@/server-functions/hr/attendance/manual-punches-fn");
  let service: typeof import("@/lib/attendance/device-import/service.server");
  const checks: Check[] = [];
  let comparisons: Comparison[] = [];
  const evidence = resolve(process.env.PAYROLL_E2E_EVIDENCE ?? "/tmp/payroll-e2e-integration-evidence");
  const call = (handler: unknown, data: Record<string, unknown>) => {
    const user = { id: manifest.actors.find(actor => actor.kind === "hr")!.userId, name: "Payroll E2E HR" };
    const session = { user };
    return (handler as Handler)({ data, context: { session, authContext: { session } } });
  };
  const test = (name: string, caseIds: string[], fn: () => Promise<unknown>) => it(name, async () => {
    comparisons = [];
    try {
      const actual = await fn();
      checks.push({ name, caseIds, passed: true, expected: "All named assertions and recorded literal comparisons pass", actual: actual ?? "assertions passed", comparisons });
    } catch (error) {
      checks.push({ name, caseIds, passed: false, expected: "All named assertions and recorded literal comparisons pass", actual: error instanceof Error ? error.message : String(error), comparisons });
      throw error;
    }
  });
  const compare = (field: string, actual: unknown, expected: unknown) => {
    comparisons.push({ field, expected, actual });
    expect(actual, field).toEqual(expected);
  };
  const period = { month: CYCLE.storedMonth, startDate: CYCLE.start, endDate: CYCLE.end };
  const day = async (employeeId: string, date: string, changes: Record<string, unknown> = {}) => call(upsert, {
    employeeId, date, status: "present", entrySource: "manual", checkIn: "09:00", checkOut: "17:00", dutyHours: "8.00", overtimeHours: "0", isLate: false, isNightShift: false, isApprovedLeave: false,
    leaveApprovalStatus: "none", earlyDepartureStatus: "none", overtimeRemarks: null, overtimeStatus: "pending", notes: "Synthetic payroll E2E baseline; not device evidence", ...changes,
  });
  const request = (id: string, type: string, date = "2026-10-01", hours = "0") => day(id, date, { status: "leave", leaveType: type, leaveApprovalStatus: "pending", compensatoryHoursUsed: hours });
  const approveLeave = (id: string, status = "approved") => call(leave, { id, status });
  const preview = (id: string, options = {}) => core.simulateEmployeePayslipCore({ employeeId: id, payrollId: "simulation", payrollPeriod: period, ...options });
  const balance = (id: string) => db.query.employees.findFirst({ where: eq(schema.employees.id, id) }).then(row => ({ annual: row!.annualLeaveBalance, sick: row!.sickLeaveBalance, comp: Number(row!.compensatoryHoursBalance) }));
  const exact = async (id: string, net: number, deductions: number, options = {}) => {
    const result = await preview(id, options);
    compare(`${id} net salary`, result.calculation.netSalary, net);
    compare(`${id} total deductions`, result.calculation.totalDeductions, deductions);
    expect(result.calculation.grossSalary - result.calculation.totalDeductions).toBe(net);
    expect(Object.values(result.calculation.componentDeductions).reduce((a, b) => a + b, 0)).toBe(deductions);
    expect(Object.values(result.calculation.deductionBreakdownByOccasion).reduce((a, b) => a + b, 0)).toBe(deductions);
    return result;
  };
  async function reset() {
    expect((await db.$client.query("select current_database() name")).rows[0].name).toBe(manifest.database);
    assertPayrollTestUrl(process.env.TEST_DATABASE_URL!);
    await db.$client.query("TRUNCATE employees, payrolls, device_attendance_imports CASCADE");
    // Each independent matrix case starts after the browser lifecycle evidence.
    await db.delete(schema.transactions).where(eq(schema.transactions.walletId, manifest.walletId));
    await db.update(schema.wallets).set({ balance: "1000000" }).where(eq(schema.wallets.id, manifest.walletId));
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: BASIC_POLICY });
  }
  async function employee(changes: Partial<typeof schema.employees.$inferInsert> = {}, allowances = ALLOWANCES) {
    const [row] = await db.insert(schema.employees).values({ employeeCode: randomUUID(), firstName: "Synthetic", lastName: "Lifecycle", designation: "Standard staff", joiningDate: CYCLE.start, basicSalary: "26000", allowanceConfig: allowances, restDays: [0], shifts: [{ start: "09:00", end: "17:00" }], compensatoryHoursBalance: "16", ...changes }).returning();
    await db.insert(schema.salaryRevisions).values({ employeeId: row.id, revisionDate: "2026-01-01", basicSalary: "26000", allowanceConfig: allowances, reason: "Independent lifecycle prerequisite" });
    for (const date of WORKING_DATES) await day(row.id, date);
    return row;
  }
  const create = async () => (await call(payroll.createPayrollFn, { month: CYCLE.month, processedBy: manifest.actors[0].userId })).payroll;
  const generate = (id: string) => call(payroll.generatePayslipsFn, { payrollId: id });
  const approve = (id: string) => call(payroll.approvePayrollFn, { payrollId: id });
  const pay = (id: string) => call(payroll.markPayrollAsPaidFn, { payrollId: id, walletId: manifest.walletId });
  const importRows = async (code: string, punches: string, date = "2026-10-01") => {
    const content = `Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\n${code},Synthetic,E2E,${date},Thursday,${punches.split(",").length},"${punches}"\n`;
    const staged = await service.uploadDeviceAttendance(new NodeFile([content], "lifecycle.csv") as unknown as File, manifest.actors[0].userId);
    await service.confirmDeviceAttendance({ importId: staged.importId }, manifest.actors[0].userId);
    return staged;
  };

  beforeAll(async () => {
    const url = assertPayrollTestUrl(process.env.TEST_DATABASE_URL!);
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(new Date().toISOString().slice(0, 10) > CYCLE.end).toBe(true);
    manifest = JSON.parse(await readFile(resolve(process.env.PAYROLL_E2E_DIRECTORY!, "manifest.json"), "utf8"));
    expect(manifest.database).toBe(url.pathname.slice(1));
    schema = await import("@/db"); db = schema.db;
    payroll = await import("@/server-functions/hr/payroll/payroll-fn");
    core = await import("@/server-functions/hr/payroll/core");
    upsert = (await import("@/server-functions/hr/attendance/upsert-attendance-fn")).upsertAttendanceFn as unknown as Handler;
    leave = (await import("@/server-functions/hr/attendance/leave-approvals-fn")).processLeaveApprovalFn as unknown as Handler;
    overtime = (await import("@/server-functions/hr/attendance/process-overtime-fn")).processOvertimeFn as unknown as Handler;
    convert = (await import("@/server-functions/hr/attendance/convert-overtime-fn")).convertOvertimeToCompOffFn as unknown as Handler;
    manual = await import("@/server-functions/hr/attendance/manual-punches-fn");
    service = await import("@/lib/attendance/device-import/service.server");
  });
  afterAll(async () => {
    await mkdir(evidence, { recursive: true });
    const coveredIds = new Set(checks.flatMap(check => check.caseIds));
    await writeFile(resolve(evidence, "integration-results.json"), JSON.stringify({ tier: "integration", scenario: manifest?.scenario, database: manifest?.database, passed: checks.length > 0 && checks.every(check => check.passed), checks, browserDraftPrerequisiteVerified: checks.some(check => check.name.startsWith("browser drafts") && check.passed), notCoveredByThisInvocation: MANDATORY_CASES.filter(id => !coveredIds.has(id)), transportAuthLimitation: limitation }, null, 2));
    await db?.$client.end();
  });

  test("browser drafts retain exact literals through generation, approval and concurrent payment", ["P01", "P03", "P04", "P06", ...(process.env.PAYROLL_E2E_SCENARIO === "real" ? ["REAL_FILE"] : [])], async () => {
    const original = await db.query.payslips.findMany();
    expect(original).toHaveLength(manifest.employees.length);
    for (const person of manifest.employees) {
      const slip = original.find(row => row.employeeId === person.id)!;
      expect(Number(slip.netSalary)).toBe(person.net);
      expect(Number(slip.totalDeductions)).toBe(person.deductions);
      expect(slip.salaryRevisionId).toBe(person.revisionId);
    }
    expect((await db.query.transactions.findMany())).toHaveLength(0);
    const existing = await db.query.payrolls.findMany();
    expect(existing).toHaveLength(1);
    const cycle = existing[0];
    await generate(cycle.id);
    const regenerated = await db.query.payslips.findMany();
    for (const person of manifest.employees) {
      const slip = regenerated.find(row => row.employeeId === person.id)!;
      compare(`${person.code} regenerated draft`, { net: Number(slip.netSalary), deductions: Number(slip.totalDeductions), revision: slip.salaryRevisionId }, { net: person.net, deductions: person.deductions, revision: person.revisionId });
    }
    const expectedTotal = manifest.employees.reduce((sum, person) => sum + person.net, 0);
    if (manifest.scenario === "real") {
      expect(expectedTotal).toBe(244329);
      expect(original.reduce((sum, row) => sum + Number(row.totalDeductions), 0)).toBe(13071);
      expect(await db.query.attendance.findMany()).toHaveLength(166);
      const attendanceRows = await db.query.attendance.findMany();
      const workingRows = attendanceRows.filter(row => (WORKING_DATES as readonly string[]).includes(row.date));
      compare("original-file working status totals", {
        present: workingRows.filter(row => row.status === "present").length,
        absent: workingRows.filter(row => row.status === "absent").length,
        approvedLeave: workingRows.filter(row => row.status === "leave" && row.leaveApprovalStatus === "approved" && row.isApprovedLeave).length,
        restDayRecords: attendanceRows.length - workingRows.length,
      }, { present: 147, absent: 5, approvedLeave: 4, restDayRecords: 10 });
      expect((await db.$client.query("select count(*)::int n from device_attendance_punch_claims")).rows[0].n).toBe(138);
    }
    compare("approved browser-fixture payroll total", Number((await approve(cycle.id)).totalAmount), expectedTotal);
    const after = await Promise.all(manifest.employees.map(person => balance(person.id)));
    for (const [index, person] of manifest.employees.entries()) {
      compare(`${person.code} approved fixture balances`, after[index], {
        annual: ["112009", "E2E02"].includes(person.code) ? 13 : 14,
        sick: ["113016", "E2E03"].includes(person.code) ? 9 : 10,
        comp: ["110001", "E2E05"].includes(person.code) ? 8 : person.code === "E2E06" ? 12 : 0,
      });
    }
    await expect(approve(cycle.id)).rejects.toThrow();
    expect(await Promise.all(manifest.employees.map(person => balance(person.id)))).toEqual(after);
    const attempts = await Promise.allSettled([pay(cycle.id), pay(cycle.id)]);
    compare("concurrent browser-fixture payment successes", attempts.filter(result => result.status === "fulfilled").length, 1);
    const ledger = await db.query.transactions.findMany();
    compare("browser-fixture payment ledger rows", ledger.length, 1);
    compare("browser-fixture ledger debit", Number(ledger[0].amount), expectedTotal);
    compare("browser-fixture remaining wallet", Number((await db.query.wallets.findFirst({ where: eq(schema.wallets.id, manifest.walletId) }))!.balance), 1000000 - expectedTotal);
    await expect(pay(cycle.id)).rejects.toThrow();
    if (manifest.scenario === "real") {
      const staged = await service.uploadDeviceAttendance(new NodeFile([await readFile(SOURCE.path)], "original.csv") as unknown as File, manifest.actors[0].userId);
      await service.confirmDeviceAttendance({ importId: staged.importId }, manifest.actors[0].userId);
      expect(await db.query.attendance.findMany()).toHaveLength(166);
      expect((await db.$client.query("select count(*)::int n from device_attendance_punch_claims")).rows[0].n).toBe(138);
      expect((await db.query.payslips.findMany()).map(row => Number(row.netSalary)).sort()).toEqual(REAL_EMPLOYEES.map(row => row.net).sort());
    }
    return { expectedTotal, walletDebit: expectedTotal, balances: after, concurrentPaymentSuccesses: 1 };
  });

  test("baseline and all four real leave decision paths use exact salaries and repeat safely", ["A01", "L01", "L02", "L03", "L04", "L05", "L06", "L11", "L16"], async () => {
    await reset();
    const { leaveTypeEnum } = await import("@/db/schemas/hr-schema");
    expect(leaveTypeEnum.enumValues).toEqual(expect.arrayContaining([...LEAVE_TYPES]));
    expect(leaveTypeEnum.enumValues).toHaveLength(4);
    const staff = await employee();
    expect((await exact(staff.id, 42900, 0)).calculation.daysPresent).toBe(26);
    const cycle = await create();
    const details = [];
    for (const [type, net, deduction] of [["annual", 42800, 100], ["sick", 42900, 0], ["special", 42400, 500], ["compensatory", 42900, 0]] as const) {
      const requestRow = await request(staff.id, type, "2026-10-01", type === "compensatory" ? "8" : "0");
      expect(requestRow).toMatchObject({ status: "leave", leaveType: type, leaveApprovalStatus: "pending", isApprovedLeave: false, dutyHours: "0.00" });
      await generate(cycle.id);
      const pendingBalance = await balance(staff.id); const pendingSlips = await db.query.payslips.findMany();
      await expect(approve(cycle.id)).rejects.toThrow(/unresolved/);
      compare(`${type} failed pending approval preserves balances`, await balance(staff.id), pendingBalance);
      expect(await db.query.payslips.findMany()).toEqual(pendingSlips);
      compare(`${type} pending payroll stays draft`, (await db.query.payrolls.findFirst({ where: eq(schema.payrolls.id, cycle.id) }))!.status, "draft");
      compare(`${type} pending approval does not debit wallet`, Number((await db.query.wallets.findFirst({ where: eq(schema.wallets.id, manifest.walletId) }))!.balance), 1000000);
      const approved = await approveLeave(requestRow.id);
      expect(approved).toMatchObject({ leaveApprovalStatus: "approved", isApprovedLeave: true });
      const approvedPreview = await exact(staff.id, net, deduction);
      compare(`${type} approved payroll summary`, { approved: approvedPreview.calculation.daysLeave, unapproved: approvedPreview.calculation.daysUnapprovedLeave }, { approved: 1, unapproved: 0 });
      const once = await balance(staff.id);
      await approveLeave(requestRow.id);
      expect(await balance(staff.id)).toEqual(once);
      await approveLeave(requestRow.id, "rejected");
      await approveLeave(requestRow.id, "rejected");
      const rejected = await db.query.attendance.findFirst({ where: eq(schema.attendance.id, requestRow.id) });
      expect(rejected).toMatchObject({ status: "leave", leaveApprovalStatus: "rejected", isApprovedLeave: false });
      // Rejected comp uses the existing unapproved-leave annual allowance flags.
      await exact(staff.id, type === "compensatory" ? 42800 : net, type === "compensatory" ? 100 : deduction);
      if (type === "compensatory") expect((await balance(staff.id)).comp).toBe(16);
      details.push({ type, approvedNet: net, deduction });
      await day(staff.id, "2026-10-01");
    }
    const partial = await request(staff.id, "compensatory", "2026-10-01", "4");
    await approveLeave(partial.id);
    await exact(staff.id, 42400, 500);
    expect((await balance(staff.id)).comp).toBe(12);
    await day(staff.id, "2026-10-01");
    for (const type of [undefined, "casual", "unpaid"]) await expect(request(staff.id, type as string)).rejects.toThrow();
    expect((await db.query.attendance.findFirst({ where: and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")) }))!.status).toBe("present");
    return details;
  });

  test("comp reservations refund once, reject invalid values, and serialize competing spends/conversions", ["L10", "L12", "L14", "P07"], async () => {
    await reset(); const staff = await employee();
    await request(staff.id, "compensatory", "2026-10-01", "8");
    await request(staff.id, "compensatory", "2026-10-01", "8");
    expect((await balance(staff.id)).comp).toBe(8);
    await request(staff.id, "compensatory", "2026-10-01", "6");
    expect((await balance(staff.id)).comp).toBe(10);
    await day(staff.id, "2026-10-01"); expect((await balance(staff.id)).comp).toBe(16);
    for (const hours of ["-1", "NaN", "Infinity", "17"]) await expect(request(staff.id, "compensatory", "2026-10-01", hours)).rejects.toThrow();
    expect((await balance(staff.id)).comp).toBe(16);
    await db.update(schema.employees).set({ compensatoryHoursBalance: "8" }).where(eq(schema.employees.id, staff.id));
    const spends = await Promise.allSettled([request(staff.id, "compensatory", "2026-10-01", "8"), request(staff.id, "compensatory", "2026-10-02", "8")]);
    expect(spends.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(staff.id)).comp).toBe(0);
    for (const date of ["2026-10-01", "2026-10-02"]) await day(staff.id, date);
    const worked = await day(staff.id, "2026-10-01", { dutyHours: "16", checkOut: "01:00", overtimeHours: "8", overtimeRemarks: "Synthetic actual overtime" });
    const conversions = await Promise.allSettled([call(convert, { employeeId: staff.id, attendanceIds: [worked.id] }), call(convert, { employeeId: staff.id, attendanceIds: [worked.id] })]);
    expect(conversions.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(staff.id)).comp).toBe(16);
    const used = await request(staff.id, "compensatory", "2026-10-02", "8"); await approveLeave(used.id);
    expect((await balance(staff.id)).comp).toBe(8);
    expect((await exact(staff.id, 42900, 0)).calculation.overtimeAmount).toBe(0);
    return { competingSpends: 1, competingConversions: 1, finalComp: 8, cashOvertime: 0 };
  });

  test("comp conversion competes with two spends without granting or spending hours twice", ["L12", "L14", "P07"], async () => {
    await reset(); const staff = await employee({ compensatoryHoursBalance: "8" });
    const worked = await day(staff.id, "2026-10-01", { dutyHours: "16", checkOut: "01:00", overtimeHours: "8", overtimeRemarks: "Synthetic simultaneous conversion and spends" });
    const results = await Promise.allSettled([
      call(convert, { employeeId: staff.id, attendanceIds: [worked.id] }),
      request(staff.id, "compensatory", "2026-10-02", "8"),
      request(staff.id, "compensatory", "2026-10-03", "8"),
    ]);
    compare("conversion succeeds once", results[0].status, "fulfilled");
    const spends = results.slice(1).filter(result => result.status === "fulfilled").length;
    expect(spends).toBeGreaterThanOrEqual(1); expect(spends).toBeLessThanOrEqual(2);
    compare("serialized comp bank conserves hours", (await balance(staff.id)).comp, 16 - 8 * spends);
    await expect(call(convert, { employeeId: staff.id, attendanceIds: [worked.id] })).rejects.toThrow(/already converted/);
    compare("repeat conversion cannot credit again", (await balance(staff.id)).comp, 16 - 8 * spends);
    const result = await preview(staff.id);
    compare("converted hours cannot also receive cash", result.calculation.overtimeAmount, 0);
    return { conversionSuccesses: 1, successfulSpends: spends, bank: (await balance(staff.id)).comp };
  });

  async function historicalAnnual(id: string, count: number, year = "2026") {
    const dates = ["01-01", "01-02", "01-03", "01-05", "01-06", "01-07", "01-08", "01-09", "01-10", "01-12", "01-13", "01-14", "01-15", "01-16"];
    await db.insert(schema.attendance).values(dates.slice(0, count).map(date => ({ employeeId: id, date: `${year}-${date}`, status: "leave" as const, leaveType: "annual" as const, leaveApprovalStatus: "approved" as const, isApprovedLeave: true })));
    const [prior] = await db.insert(schema.payrolls).values({ month: `${year}-02-01`, startDate: `${year}-01-01`, endDate: `${year}-01-31`, status: "approved" }).returning();
    await db.insert(schema.payslips).values({ payrollId: prior.id, employeeId: id, basicSalary: "26000", grossSalary: "42900", netSalary: "42900", totalDeductions: "0" });
  }

  test("annual boundary and concurrent decisions preserve previously approved same-year entitlement", ["L07", "L08", "L14", "P04", "P07"], async () => {
    await reset(); const staff = await employee(); await historicalAnnual(staff.id, 13);
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, annualLeave: true } });
    const a = await request(staff.id, "annual", "2026-10-01"); const b = await request(staff.id, "annual", "2026-10-02");
    const decisions = await Promise.all([approveLeave(a.id), approveLeave(b.id)]);
    expect(decisions.filter(row => row.isApprovedLeave)).toHaveLength(1);
    expect(decisions.filter(row => !row.isApprovedLeave)[0].notes).toContain("exhausted");
    expect((await balance(staff.id)).annual).toBe(0);
    await exact(staff.id, 41700, 1200);
    const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
    expect((await balance(staff.id)).annual).toBe(0);
    await expect(approve(cycle.id)).rejects.toThrow();
    expect((await balance(staff.id)).annual).toBe(0);
    return { priorPaidDates: 13, competingPaidDecisions: 1, unpaidDecision: 1, balance: 0, net: 41700 };
  });

  test("single excess annual date has the independent default and enabled basic-policy literals", ["L07", "L08"], async () => {
    const actual = [];
    for (const enabled of [false, true]) {
      await reset(); const staff = await employee(); await historicalAnnual(staff.id, 14);
      await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, annualLeave: enabled } });
      const row = await approveLeave((await request(staff.id, "annual")).id);
      compare("exhausted annual request remains approved unpaid", { decision: row.leaveApprovalStatus, paid: row.isApprovedLeave }, { decision: "approved", paid: false });
      expect(row.notes).toContain("exhausted");
      const calculation = await exact(staff.id, enabled ? 41800 : 42800, enabled ? 1100 : 100);
      compare("annual basic deduction follows enabled policy", calculation.calculation.componentDeductions.basicSalary, enabled ? 1000 : 0);
      const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
      compare("exhausted annual balance", (await balance(staff.id)).annual, 0);
      actual.push({ basicPolicy: enabled, net: calculation.calculation.netSalary });
    }
    return actual;
  });

  test("each leave type survives regeneration and payroll approval with exactly one balance charge", ["L01", "L02", "L03", "L04", "P04"], async () => {
    const actual = [];
    for (const type of LEAVE_TYPES) {
      await reset(); const staff = await employee();
      await approveLeave((await request(staff.id, type, "2026-10-01", type === "compensatory" ? "8" : "0")).id);
      const expected = { annual: type === "annual" ? 13 : 14, sick: type === "sick" ? 9 : 10, comp: type === "compensatory" ? 8 : 16 };
      const before = await balance(staff.id);
      compare(`${type} decision-stage balance`, before, { annual: type === "annual" ? 13 : 14, sick: 10, comp: type === "compensatory" ? 8 : 16 });
      const cycle = await create(); await generate(cycle.id); await generate(cycle.id);
      compare(`${type} regeneration does not spend balances`, await balance(staff.id), before);
      await approve(cycle.id);
      compare(`${type} payroll approval balance`, await balance(staff.id), expected);
      await expect(approve(cycle.id)).rejects.toThrow();
      compare(`${type} repeated approval balance`, await balance(staff.id), expected);
      actual.push({ type, balance: await balance(staff.id) });
    }
    return actual;
  });

  test("each pending type can be rejected directly and comp rejection refunds once", ["L05", "L06", "L10", "L14"], async () => {
    await reset(); const staff = await employee(); const actual = [];
    for (const type of LEAVE_TYPES) {
      const row = await request(staff.id, type, "2026-10-01", type === "compensatory" ? "8" : "0");
      const before = await balance(staff.id);
      const pending = await preview(staff.id);
      compare(`${type} preview leaves reservation unchanged`, await balance(staff.id), before);
      compare(`${type} pending leave summary`, { approved: pending.calculation.daysLeave, unapproved: pending.calculation.daysUnapprovedLeave }, { approved: 0, unapproved: 1 });
      await approveLeave(row.id, "rejected"); await approveLeave(row.id, "rejected");
      compare(`${type} rejected balance`, await balance(staff.id), { annual: 14, sick: 10, comp: 16 });
      const stored = await db.query.attendance.findFirst({ where: eq(schema.attendance.id, row.id) });
      compare(`${type} rejected stored leave`, { status: stored!.status, type: stored!.leaveType, paid: stored!.isApprovedLeave, approval: stored!.leaveApprovalStatus, hours: Number(stored!.compensatoryHoursUsed) }, { status: "leave", type, paid: false, approval: "rejected", hours: 0 });
      const approvals = await call((await import("@/server-functions/hr/attendance/leave-approvals-fn")).getLeaveApprovalsFn, { status: "all" });
      compare(`${type} rejected requests summary`, approvals.stats, { pendingCount: 0, approvedCount: 0, rejectedCount: 1 });
      const result = await exact(staff.id, type === "special" ? 42400 : type === "sick" ? 42900 : 42800, type === "special" ? 500 : type === "sick" ? 0 : 100);
      compare(`${type} rejected payroll counts`, { approved: result.calculation.daysLeave, unapproved: result.calculation.daysUnapprovedLeave }, { approved: 0, unapproved: 1 });
      actual.push({ type, net: result.calculation.netSalary });
      await day(staff.id, "2026-10-01");
    }
    return actual;
  });

  test("company policy inheritance, enabled and disabled employee overrides and allowance flags", ["L08", "L09"], async () => {
    await reset();
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, sickLeave: true } });
    const inherited = await employee({ basicSalaryDeductionPolicyOverrideEnabled: false, basicSalaryDeductionPolicyOverride: BASIC_POLICY });
    const overridden = await employee({ basicSalaryDeductionPolicyOverrideEnabled: true, basicSalaryDeductionPolicyOverride: BASIC_POLICY });
    for (const staff of [inherited, overridden]) await approveLeave((await request(staff.id, "sick")).id);
    await exact(inherited.id, 41900, 1000); await exact(overridden.id, 42900, 0);
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, specialLeave: true } });
    await approveLeave((await request(inherited.id, "special")).id); await exact(inherited.id, 41400, 1500);
    const fuel = await employee({}, ALLOWANCES.map(item => item.id === "conveyance" ? { ...item, id: "fuel", name: "Fuel allowance" } : item));
    await approveLeave((await request(fuel.id, "annual")).id);
    const fuelCalc = await exact(fuel.id, 42800, 100); expect(fuelCalc.calculation.componentDeductions.fuel).toBe(100);
    const custom = await employee({}, ALLOWANCES.map(item => item.id === "technical" ? { ...item, deductions: { ...item.deductions, sickLeave: true } } : item));
    await approveLeave((await request(custom.id, "sick")).id); await exact(custom.id, 42800, 100);
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, annualLeave: true } });
    await approveLeave((await request(inherited.id, "annual")).id); await exact(inherited.id, 42800, 100);
    return { inheritedSick: 41900, overriddenSick: 42900, special: 41400, fuel: 42800, customSick: 42800, paidAnnualBasicEnabled: 42800 };
  });

  test("December/January entitlement uses leave year; sick usage clamps and ignores nonworking legacy leave", ["L13", "L15", "P04"], async () => {
    await reset(); const staff = await employee();
    await historicalAnnual(staff.id, 14, "2025");
    const january = await request(staff.id, "annual", "2026-01-20");
    expect((await approveLeave(january.id)).isApprovedLeave).toBe(true);
    await historicalAnnual(staff.id, 1);
    const sickDates = WORKING_DATES.slice(0, 11);
    for (const date of sickDates) await approveLeave((await request(staff.id, "sick", date)).id);
    const approvedSick = (await db.query.attendance.findMany()).filter(row => row.leaveType === "sick" && row.isApprovedLeave);
    compare("eleventh sick day retains its approved type", approvedSick.length, 11);
    await exact(staff.id, 42900, 0);
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, sickLeave: true } });
    await exact(staff.id, 31900, 11000);
    await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: BASIC_POLICY });
    // Historical fixture intentionally includes a legacy nonworking approved row.
    await db.insert(schema.attendance).values({ employeeId: staff.id, date: "2026-10-04", status: "leave", leaveType: "annual", leaveApprovalStatus: "approved", isApprovedLeave: true });
    const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
    expect(await balance(staff.id)).toMatchObject({ annual: 12, sick: 0, comp: 16 });
    expect((await db.query.payslips.findFirst({ where: eq(schema.payslips.payrollId, cycle.id) }))!.daysLeave).toBe(11);
    return { annual: 12, sick: 0, approvedSickUsage: 11, legacyRestDayCharge: 0 };
  });

  test("January payroll excludes prior December usage and overlapping approved coverage counts dates once", ["L13", "P04"], async () => {
    await reset(); const staff = await employee({ joiningDate: "2025-01-01" });
    for (let offset = 0; offset < 31; offset++) {
      const date = new Date(Date.UTC(2025, 11, 16 + offset));
      if (date.getUTCDay() !== 0) await day(staff.id, date.toISOString().slice(0, 10));
    }
    await approveLeave((await request(staff.id, "annual", "2025-12-30")).id);
    await approveLeave((await request(staff.id, "annual", "2026-01-01")).id);
    const january = (await call(payroll.createPayrollFn, { month: "2026-01", processedBy: manifest.actors[0].userId })).payroll;
    await generate(january.id); await approve(january.id);
    compare("January counts only its leave year", await balance(staff.id), { annual: 13, sick: 10, comp: 16 });

    await reset(); const second = await employee(); await historicalAnnual(second.id, 1);
    const [overlap] = await db.insert(schema.payrolls).values({ month: "2026-03-01", startDate: "2026-01-01", endDate: "2026-02-28", status: "approved" }).returning();
    await db.insert(schema.payslips).values({ payrollId: overlap.id, employeeId: second.id, basicSalary: "26000", grossSalary: "42900", netSalary: "42900", totalDeductions: "0" });
    await approveLeave((await request(second.id, "annual")).id);
    const current = await create(); await generate(current.id); await approve(current.id);
    compare("overlapping payrolls count one historical date once", await balance(second.id), { annual: 12, sick: 10, comp: 16 });
    return { januaryAnnual: 13, overlappingCoverageAnnual: 12 };
  });

  test("rest days and holidays reject leave without balances; holiday changes divisor to 25", ["L15", "A11"], async () => {
    await reset(); const staff = await employee();
    for (const type of LEAVE_TYPES) await expect(request(staff.id, type, "2026-10-04", type === "compensatory" ? "8" : "0")).rejects.toThrow(/rest day/);
    expect(await balance(staff.id)).toEqual({ annual: 14, sick: 10, comp: 16 });
    await day(staff.id, "2026-10-02", { status: "holiday" });
    for (const type of LEAVE_TYPES) await expect(request(staff.id, type, "2026-10-02", type === "compensatory" ? "8" : "0")).rejects.toThrow(/holiday/);
    await approveLeave((await request(staff.id, "annual")).id);
    const result = await exact(staff.id, 42796, 104);
    expect(result.calculation.calculationMeta.calendarDaysInMonth).toBe(25);
    return { divisor: 25, annualConveyance: 104, net: 42796 };
  });

  test("missing expected working date stays unmarked until HR resolves its daily status", ["A11"], async () => {
    await reset(); const staff = await employee();
    const baseline = await exact(staff.id, 42900, 0);
    compare("rest days create no unmarked alarm", baseline.calculation.unmarkedDays, 0);
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
    await expect(preview(staff.id)).rejects.toThrow(/PAST_UNMARKED_DAYS:1/);
    const cycle = await create(); await expect(generate(cycle.id)).rejects.toThrow(/PAST_UNMARKED_DAYS:1/);
    compare("missing record is not inferred absence", (await db.query.attendance.findMany()).filter(row => row.status === "absent").length, 0);
    compare("failed generation saves no salary", (await db.query.payslips.findMany()).length, 0);
    await day(staff.id, "2026-10-01", { status: "absent" });
    const result = await exact(staff.id, 41300, 1600);
    return { resolvedNet: result.calculation.netSalary, resolvedAbsences: result.calculation.daysAbsent };
  });

  test("absence, undertime flags, accumulated half rupees, overtime decisions and multiplier", ["A02", "A03", "A05", "A13"], async () => {
    await reset(); const staff = await employee();
    await day(staff.id, "2026-10-01", { status: "absent" }); await exact(staff.id, 41300, 1600);
    for (const flags of [{ isLate: true }, { earlyDepartureStatus: "pending" }, { isLate: true, earlyDepartureStatus: "pending" }]) {
      await day(staff.id, "2026-10-01", { dutyHours: "6", ...flags }); await exact(staff.id, 42650, 250);
    }
    await day(staff.id, "2026-10-01", { dutyHours: "7.98", earlyDepartureStatus: "pending" }); await exact(staff.id, 42897, 3);
    await day(staff.id, "2026-10-02", { dutyHours: "7.98", earlyDepartureStatus: "pending" }); await exact(staff.id, 42895, 5);
    await day(staff.id, "2026-10-02");
    const worked = await day(staff.id, "2026-10-01", { dutyHours: "10", overtimeHours: "2", overtimeRemarks: "Synthetic cash OT" });
    await exact(staff.id, 42900, 0);
    const cycle = await create(); await generate(cycle.id); await expect(approve(cycle.id)).rejects.toThrow(/unresolved/);
    await call(overtime, { id: worked.id, status: "rejected" }); await exact(staff.id, 42900, 0);
    await call(overtime, { id: worked.id, status: "approved" }); await exact(staff.id, 43150, 0);
    await exact(staff.id, 43275, 0, { additionalAmounts: { overtimeMultiplier: 1.5 } });
    const fraction = await day(staff.id, "2026-10-01", { dutyHours: "8.02", overtimeHours: "0.02", overtimeRemarks: "Synthetic half rupee OT" });
    await call(overtime, { id: fraction.id, status: "approved" }); await exact(staff.id, 42903, 0);
    await expect(day(staff.id, "2026-10-01", { dutyHours: "8", overtimeHours: "3", overtimeRemarks: "Over eligible hours" }).then(row => call(overtime, { id: row.id, status: "approved" }))).rejects.toThrow();
    return { absence: 41300, sixHours: 42650, oneSmallDeduction: 3, accumulatedDeduction: 5, overtime: 250, overtime150Percent: 375, overtimeHalfRupee: 3 };
  });

  test("real import breaks, overnight separate uploads and daytime missing checkout", ["A04", "A06", "A07", "A08"], async () => {
    await reset(); const staff = await employee();
    // Baseline is a prerequisite; remove only the day whose input is under test.
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(staff.employeeCode, "09:00, 12:00, 13:00, 17:00"); await exact(staff.id, 42775, 125);
    const night = await employee({ shifts: [{ start: "20:00", end: "04:00" }] });
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, night.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(night.employeeCode, "20:00");
    const cycle = await create(); await expect(generate(cycle.id)).rejects.toThrow(/needs HR review/);
    await expect(core.generateEmployeePayslipCore({ employeeId: night.id, payrollId: cycle.id, payrollPeriod: period, ignorePastUnmarkedDays: true, attendanceAdjustments: { waiveAll: true } }, manifest.actors[0].userId)).rejects.toThrow(/needs HR review/);
    await importRows(night.employeeCode, "04:00", "2026-10-02"); await exact(night.id, 43400, 0);
    const daytime = await employee();
    for (const date of ["2026-10-01", "2026-10-02"]) await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, daytime.id), eq(schema.attendance.date, date)));
    await importRows(daytime.employeeCode, "09:00"); await importRows(daytime.employeeCode, "09:00, 17:00", "2026-10-02");
    await expect(generate(cycle.id)).rejects.toThrow(/needs HR review/);
    const punches = await db.query.attendancePunches.findMany({ where: eq(schema.attendancePunches.employeeId, daytime.id) });
    expect(punches).toHaveLength(3);
    expect(punches.filter(punch => punch.attendanceDate === "2026-10-01")).toHaveLength(1);
    return { breakNet: 42775, overnightNet: 43400, invalidDayGeneration: "rejected", daytimePunches: 3 };
  });

  test("one upload attributes overnight checkout to IN date and keeps next normal duty separate", ["A06"], async () => {
    await reset(); const staff = await employee({ shifts: [{ start: "20:00", end: "04:00" }] });
    for (const date of ["2026-10-01", "2026-10-02"]) await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, date)));
    const content = `Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\n${staff.employeeCode},Synthetic,E2E,2026-10-01,Thursday,1,"20:00"\n${staff.employeeCode},Synthetic,E2E,2026-10-02,Friday,3,"04:00, 09:00, 17:00"\n`;
    const staged = await service.uploadDeviceAttendance(new NodeFile([content], "overnight.csv") as unknown as File, manifest.actors[0].userId);
    await service.confirmDeviceAttendance({ importId: staged.importId }, manifest.actors[0].userId);
    const days = (await db.query.attendance.findMany({ where: eq(schema.attendance.employeeId, staff.id), orderBy: (table, { asc }) => [asc(table.date)] })).filter(row => ["2026-10-01", "2026-10-02"].includes(row.date));
    compare("overnight and normal duty dates", days.map(row => ({ date: row.date, hours: Number(row.dutyHours), night: row.isNightShift })), [{ date: "2026-10-01", hours: 8, night: true }, { date: "2026-10-02", hours: 8, night: false }]);
    const result = await exact(staff.id, 43400, 0);
    compare("single night allowance", result.calculation.nightShiftAllowanceAmount, 500);
    return { days: days.map(row => row.date), net: result.calculation.netSalary };
  });

  test("deleted imported checkout can be resolved as every supported leave type", ["A10"], async () => {
    const actual = [];
    for (const type of LEAVE_TYPES) {
      await reset(); const staff = await employee();
      await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
      await importRows(staff.employeeCode, "09:00, 17:00");
      const punch = await db.query.attendancePunches.findFirst({ where: and(eq(schema.attendancePunches.employeeId, staff.id), eq(schema.attendancePunches.direction, "out")) });
      await call(manual.deletePunchFn, { punchId: punch!.id, reason: `Synthetic ${type} explicit HR resolution` });
      await importRows(staff.employeeCode, "09:00, 17:00");
      const row = await request(staff.id, type, "2026-10-01", type === "compensatory" ? "8" : "0"); await approveLeave(row.id);
      const result = await exact(staff.id, type === "annual" ? 42800 : type === "special" ? 42400 : 42900, type === "annual" ? 100 : type === "special" ? 500 : 0);
      const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
      compare(`${type} deleted source remains deleted`, (await db.query.attendancePunches.findMany()).length, 1);
      actual.push({ type, net: result.calculation.netSalary });
    }
    return actual;
  });

  test("correction, deletion, replay, stale drafts and finalized mutation guards retain source evidence", ["A09", "A10", "P02", "P05"], async () => {
    await reset(); const staff = await employee();
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(staff.employeeCode, "09:00, 15:00"); await exact(staff.id, 42650, 250);
    const cycle = await create(); await generate(cycle.id);
    const sourceClaims = async () => (await db.$client.query("select id, import_id, timestamp, report_date, attendance_date, direction from device_attendance_punch_claims order by timestamp")).rows;
    const originalClaims = await sourceClaims();
    const punches = await db.query.attendancePunches.findMany({ where: eq(schema.attendancePunches.employeeId, staff.id), orderBy: (table, { asc }) => [asc(table.timestamp)] });
    const corrected = await call(manual.correctPunchFn, { punchId: punches[1].id, newTimestamp: "2026-10-01T17:00:00+05:00", reason: "Synthetic correction to actual full duty" });
    await expect(approve(cycle.id)).rejects.toThrow(/Regenerate/);
    await importRows(staff.employeeCode, "09:00, 15:00");
    compare("correction and replay retain original claim identity and timestamp", await sourceClaims(), originalClaims);
    compare("corrected source claim follows replacement punch", (await db.$client.query("select punch_id from device_attendance_punch_claims where direction='out'")).rows[0].punch_id, corrected.punch.id);
    await exact(staff.id, 42900, 0); await generate(cycle.id);
    expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42900);
    await call(manual.deletePunchFn, { punchId: corrected.punch.id, reason: "Synthetic deletion lineage test" });
    await importRows(staff.employeeCode, "09:00, 15:00");
    compare("deletion and replay retain immutable raw claims", await sourceClaims(), originalClaims);
    compare("deleted source claim keeps its tombstone", (await db.$client.query("select punch_id from device_attendance_punch_claims where direction='out'")).rows[0].punch_id, null);
    expect(await db.query.attendancePunches.findMany({ where: eq(schema.attendancePunches.employeeId, staff.id) })).toHaveLength(1);
    expect((await db.$client.query("select count(*)::int n from device_attendance_punch_claims")).rows[0].n).toBe(2);
    await expect(generate(cycle.id)).rejects.toThrow(/needs HR review/);
    // Daily status explicitly overrides unresolved raw evidence.
    await day(staff.id, "2026-10-01", { status: "absent" }); await generate(cycle.id); await exact(staff.id, 41300, 1600);
    await approve(cycle.id);
    const before = await db.query.attendance.findMany(); const balances = await balance(staff.id); const slips = await db.query.payslips.findMany();
    for (const state of ["approved", "paid"]) {
      if (state === "paid") { await db.update(schema.wallets).set({ balance: "1000000" }).where(eq(schema.wallets.id, manifest.walletId)); await pay(cycle.id); }
      await expect(day(staff.id, "2026-10-01")).rejects.toThrow(/approved or paid/);
      await expect(call(manual.correctPunchFn, { punchId: punches[0].id, newTimestamp: "2026-10-01T10:00:00+05:00", reason: "Locked change" })).rejects.toThrow(/approved or paid/);
      await expect(call(manual.deletePunchFn, { punchId: punches[0].id, reason: "Locked deletion" })).rejects.toThrow(/approved or paid/);
      await expect(call(manual.addManualPunchFn, { employeeId: staff.id, timestamp: "2026-10-01T18:00:00+05:00" })).rejects.toThrow(/approved or paid/);
      await expect(call(overtime, { id: before.find(row => row.date === "2026-10-01")!.id, status: "approved" })).rejects.toThrow(/approved or paid/);
      expect(await db.query.attendance.findMany()).toEqual(before); expect(await balance(staff.id)).toEqual(balances);
      expect((await db.query.payslips.findMany()).map(row => row.netSalary)).toEqual(slips.map(row => row.netSalary));
    }
    compare("correction and deletion preserve reason and actor", (await db.query.attendancePunchCorrectionAudit.findMany()).map(row => ({ action: row.action, reason: row.reason, actor: row.changedByUserId })).sort((a, b) => a.action.localeCompare(b.action)), [
      { action: "correct", reason: "Synthetic correction to actual full duty", actor: manifest.actors[0].userId },
      { action: "delete", reason: "Synthetic deletion lineage test", actor: manifest.actors[0].userId },
    ]);
    return { initialNet: 42650, correctedNet: 42900, explicitAbsentNet: 41300, remainingPunches: 1, claims: 2 };
  });

  test("coverage and pending guards reject incomplete payroll; insufficient payment rolls back", ["P03", "P06"], async () => {
    await reset(); const first = await employee(); const second = await employee(); const cycle = await create();
    await expect(approve(cycle.id)).rejects.toThrow(/no payslips|Regenerate/);
    await core.generateEmployeePayslipCore({ employeeId: first.id, payrollId: cycle.id, payrollPeriod: period }, manifest.actors[0].userId);
    await expect(approve(cycle.id)).rejects.toThrow(/incomplete/);
    await generate(cycle.id);
    await db.update(schema.employees).set({ status: "terminated" }).where(eq(schema.employees.id, second.id));
    await expect(approve(cycle.id)).rejects.toThrow(/ineligible/);
    await db.update(schema.employees).set({ status: "active" }).where(eq(schema.employees.id, second.id));
    // The unique index must reject duplicate coverage before approval can see it.
    await expect(db.insert(schema.payslips).values({ payrollId: cycle.id, employeeId: first.id, basicSalary: "26000", grossSalary: "42900", totalDeductions: "0", netSalary: "42900" })).rejects.toThrow();
    await approve(cycle.id);
    await db.update(schema.wallets).set({ balance: "1" }).where(eq(schema.wallets.id, manifest.walletId));
    const ledger = await db.query.transactions.findMany(); await expect(pay(cycle.id)).rejects.toThrow(/Insufficient/);
    compare("insufficient payment keeps approved payroll", (await db.query.payrolls.findFirst({ where: eq(schema.payrolls.id, cycle.id) }))!.status, "approved");
    compare("insufficient payment keeps wallet balance", Number((await db.query.wallets.findFirst({ where: eq(schema.wallets.id, manifest.walletId) }))!.balance), 1);
    expect(await db.query.transactions.findMany()).toEqual(ledger);
    await db.update(schema.wallets).set({ balance: "1000000" }).where(eq(schema.wallets.id, manifest.walletId));
    const competing = await Promise.allSettled([pay(cycle.id), pay(cycle.id)]);
    compare("concurrent independent payments succeed once", competing.filter(result => result.status === "fulfilled").length, 1);
    compare("independent payment leaves exact wallet", Number((await db.query.wallets.findFirst({ where: eq(schema.wallets.id, manifest.walletId) }))!.balance), 914200);
    const payments = await db.query.transactions.findMany({ where: eq(schema.transactions.referenceId, cycle.id) });
    compare("independent payment ledger rows", payments.length, 1); compare("independent payment ledger amount", Number(payments[0].amount), 85800);
    await expect(pay(cycle.id)).rejects.toThrow();
    return { empty: "rejected", incomplete: "rejected", ineligible: "rejected", duplicate: "constraint rejected", insufficientFunds: "rolled back" };
  });

  test("finalized cycles refuse import, leave decisions, overtime conversion and direct draft saves atomically", ["P05"], async () => {
    await reset(); const staff = await employee();
    const leaveRow = await request(staff.id, "annual"); await approveLeave(leaveRow.id);
    const worked = await day(staff.id, "2026-10-02", { dutyHours: "16", checkOut: "01:00", overtimeHours: "8", overtimeRemarks: "Synthetic eligible locked overtime" });
    await call(overtime, { id: worked.id, status: "approved" });
    const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
    const snapshot = async () => ({ attendance: await db.query.attendance.findMany({ orderBy: (table, { asc }) => [asc(table.id)] }), punches: await db.query.attendancePunches.findMany(), balances: await balance(staff.id), payslips: await db.query.payslips.findMany(), payroll: await db.query.payrolls.findMany(), wallet: await db.query.wallets.findMany(), transactions: await db.query.transactions.findMany() });
    for (const state of ["approved", "paid"]) {
      if (state === "paid") { await db.update(schema.wallets).set({ balance: "1000000" }).where(eq(schema.wallets.id, manifest.walletId)); await pay(cycle.id); }
      const before = await snapshot();
      const blocked = await importRows(staff.employeeCode, "08:00, 18:00", "2026-10-03");
      compare(`${state} import reports blocked salary input`, blocked.rows.map(row => row.status), ["blocked"]);
      await expect(approveLeave(leaveRow.id, "rejected")).rejects.toThrow(/approved or paid/);
      await expect(call(convert, { employeeId: staff.id, attendanceIds: [worked.id] })).rejects.toThrow(/approved or paid/);
      await expect(call((await import("@/server-functions/hr/attendance/bulk-mark-attendance-fn")).bulkMarkAttendanceFn, { employeeIds: [staff.id], date: "2026-10-03", status: "absent" })).rejects.toThrow(/approved or paid/);
      await expect(call((await import("@/server-functions/hr/attendance/bulk-mark-attendance-range-fn")).bulkMarkAttendanceRangeFn, { employeeIds: [staff.id], startDate: "2026-10-03", endDate: "2026-10-03", template: { status: "leave", leaveType: "sick", entrySource: "manual" }, conflictStrategy: "overwrite" })).rejects.toThrow(/approved or paid/);
      await expect(generate(cycle.id)).rejects.toThrow(/locked|immutable/);
      await expect(core.generateEmployeePayslipCore({ employeeId: staff.id, payrollId: cycle.id, payrollPeriod: period }, manifest.actors[0].userId)).rejects.toThrow(/Only draft/);
      compare(`${state} failed actions preserve salary and financial state`, await snapshot(), before);
    }
    return { guardedStates: ["approved", "paid"], guardedActions: ["import", "leave decision", "comp conversion", "bulk daily status", "bulk leave range", "generation", "direct save"] };
  });

  test("leave approval competing with generation cannot finalize stale salary", ["P02", "P07"], async () => {
    await reset(); const staff = await employee(); const cycle = await create();
    const requested = await request(staff.id, "annual");
    const outcome = await Promise.allSettled([approveLeave(requested.id), generate(cycle.id)]);
    expect(outcome.every(result => result.status === "fulfilled")).toBe(true);
    // Either the generation snapshot includes the change or stale approval refuses it.
    try {
      await approve(cycle.id);
      expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42800);
    } catch (error) {
      expect(String(error)).toMatch(/Regenerate/);
      await generate(cycle.id); await approve(cycle.id);
    }
    expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42800);
    return { approvalNet: 42800, concurrentHandlers: 2 };
  });

  test("approval between regenerated employee saves cannot let cleanup delete approved coverage", ["P03", "P05", "P07"], async () => {
    await reset(); await employee(); await employee(); const cycle = await create(); await generate(cycle.id);
    const gate = 176320261;
    const client = await db.$client.connect();
    const settle = <T,>(promise: Promise<T>) => promise.then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
    let generation: ReturnType<typeof settle> | undefined;
    let approval: ReturnType<typeof settle> | undefined;
    const waitForWaitingLocks = async (count: number) => {
      for (let attempt = 0; attempt < 400; attempt++) {
        const row = (await db.$client.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())")).rows[0];
        if (row.n >= count) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${count} PostgreSQL advisory lock waiters`);
    };
    try {
      // The real first INSERT waits while holding the production payroll lock.
      // Queue actual approval behind it before allowing the INSERT to commit.
      await client.query("select pg_advisory_lock($1)", [gate]);
      await db.$client.query(`create function payroll_e2e_pause_regeneration() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${gate}); return new; end; $$`);
      await db.$client.query("create trigger payroll_e2e_pause_regeneration before insert on payslips for each row execute function payroll_e2e_pause_regeneration()");
      generation = settle(generate(cycle.id));
      await waitForWaitingLocks(1);
      approval = settle(approve(cycle.id));
      await waitForWaitingLocks(2);
      await client.query("select pg_advisory_unlock($1)", [gate]);
      const [generated, approved] = await Promise.all([generation, approval]);
      compare("approval wins between employee saves", approved.status, "fulfilled");
      compare("remaining regeneration refuses finalized payroll", generated.status, "rejected");
      if (generated.status === "rejected") expect(String(generated.reason)).toMatch(/Only draft/);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [gate]); client.release();
      await Promise.allSettled([generation, approval].filter(Boolean));
      await db.$client.query("drop trigger if exists payroll_e2e_pause_regeneration on payslips");
      await db.$client.query("drop function if exists payroll_e2e_pause_regeneration()");
    }
    const stored = await db.query.payslips.findMany();
    compare("approved payroll retains complete coverage after failed regeneration cleanup", stored.length, 2);
    compare("approved salary values remain intact", stored.map(row => Number(row.netSalary)), [42900, 42900]);
    const approved = await db.query.payrolls.findFirst({ where: eq(schema.payrolls.id, cycle.id) });
    compare("approved payroll total remains consistent", { status: approved!.status, total: Number(approved!.totalAmount) }, { status: "approved", total: 85800 });
    return { payroll: approved!.status, count: stored.length, total: Number(approved!.totalAmount) };
  });

  test("manual attendance and overtime decisions invalidate saved drafts until exact regeneration", ["P02"], async () => {
    await reset(); const staff = await employee(); const cycle = await create(); await generate(cycle.id);
    await day(staff.id, "2026-10-01", { status: "absent" });
    await expect(approve(cycle.id)).rejects.toThrow(/Regenerate/);
    await generate(cycle.id);
    compare("absence regeneration stored net", Number((await db.query.payslips.findFirst())!.netSalary), 41300);
    const worked = await day(staff.id, "2026-10-01", { dutyHours: "10", checkOut: "19:00", overtimeHours: "2", overtimeRemarks: "Synthetic changed overtime decision" });
    await generate(cycle.id); await expect(approve(cycle.id)).rejects.toThrow(/unresolved/);
    await call(overtime, { id: worked.id, status: "approved" });
    await expect(approve(cycle.id)).rejects.toThrow(/Regenerate/);
    await generate(cycle.id); await approve(cycle.id);
    const stored = await db.query.payslips.findFirst();
    compare("overtime regeneration stored net", Number(stored!.netSalary), 43150);
    return { approvedNet: Number(stored!.netSalary) };
  });

  test("captured invalidation revision cannot clear a later attendance change", ["P02"], async () => {
    await reset(); const staff = await employee(); const cycle = await create(); await generate(cycle.id);
    await day(staff.id, "2026-10-01", { status: "absent" });
    const snapshots = (await db.query.payrollAttendanceInvalidations.findMany()).map(row => ({ id: row.id, revision: row.revision }));
    compare("one captured invalidation", snapshots.length, 1);
    await day(staff.id, "2026-10-01", { dutyHours: "6", earlyDepartureStatus: "pending" });
    const { resolvePayrollAttendanceInvalidations } = await import("@/lib/attendance/offline/payroll-invalidation.server");
    const { lockAttendancePayrollWrites } = await import("@/lib/attendance/device-import/payroll.server");
    await db.transaction(async tx => {
      await lockAttendancePayrollWrites(tx);
      await resolvePayrollAttendanceInvalidations(tx, cycle.id, manifest.actors[0].userId, snapshots);
    });
    const later = await db.query.payrollAttendanceInvalidations.findFirst();
    compare("later invalidation revision survives old snapshot", { revision: later!.revision, resolved: later!.resolvedAt !== null }, { revision: snapshots[0].revision + 1, resolved: false });
    await expect(approve(cycle.id)).rejects.toThrow(/Regenerate/);
    await generate(cycle.id); await approve(cycle.id);
    compare("fresh regeneration clears current revision", (await db.query.payrollAttendanceInvalidations.findFirst())!.resolvedAt !== null, true);
    compare("fresh revision saves exact latest salary", Number((await db.query.payslips.findFirst())!.netSalary), 42650);
    return { capturedRevision: snapshots[0].revision, currentRevision: later!.revision, approvedNet: 42650 };
  });

  test("an imported unresolved day cannot approve an older complete salary snapshot", ["A07", "P03"], async () => {
    await reset(); const staff = await employee();
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(staff.employeeCode, "09:00, 17:00");
    const cycle = await create(); await generate(cycle.id);
    const original = await db.query.payslips.findMany();
    const originalLedger = await db.query.transactions.findMany();
    const originalWallet = await db.query.wallets.findMany();
    await importRows(staff.employeeCode, "19:00");
    compare("import retains newly unresolved IN evidence", (await db.query.attendancePunches.findMany()).length, 3);
    await expect(approve(cycle.id)).rejects.toThrow(/Regenerate|needs HR review/);
    await expect(core.generateEmployeePayslipCore({ employeeId: staff.id, payrollId: cycle.id, payrollPeriod: period, ignorePastUnmarkedDays: true, attendanceAdjustments: { waiveAll: true } }, manifest.actors[0].userId)).rejects.toThrow(/needs HR review/);
    compare("unresolved input saves no fabricated salary", await db.query.payslips.findMany(), original);
    compare("failed approval remains draft", (await db.query.payrolls.findFirst())!.status, "draft");
    compare("failed approval has no financial debit", await db.query.transactions.findMany(), originalLedger);
    compare("failed approval preserves wallet", await db.query.wallets.findMany(), originalWallet);
    return { approval: "refused", waivedSave: "refused" };
  });

  test("selective waiver preserves attendance and balances while pending leave still blocks finalization", ["A14"], async () => {
    await reset(); const staff = await employee();
    const requestRow = await request(staff.id, "annual"); await approveLeave(requestRow.id);
    await day(staff.id, "2026-10-02", { status: "absent" });
    const before = await db.query.attendance.findMany(); const originalBalance = await balance(staff.id);
    const waived = await exact(staff.id, 41300, 1600, { attendanceAdjustments: { waiveAnnualLeave: true } });
    expect(waived.calculation.deductionBreakdownByOccasion.annualLeave).toBe(0);
    expect(waived.calculation.unadjustedOccasionDeductions?.annualLeave).toBe(100);
    expect(await db.query.attendance.findMany()).toEqual(before); expect(await balance(staff.id)).toEqual(originalBalance);
    const cycle = await create();
    await request(staff.id, "annual");
    await core.generateEmployeePayslipCore({ employeeId: staff.id, payrollId: cycle.id, payrollPeriod: period, attendanceAdjustments: { waiveAll: true } }, manifest.actors[0].userId);
    await expect(approve(cycle.id)).rejects.toThrow(/unresolved|Regenerate/);
    return { annualWaived: 100, absenceStillDeducted: 1600, pendingFullWaiver: "refused" };
  });

  test("annual, sick, special and undertime selective waivers remove only their named occasion", ["A14"], async () => {
    const actual = [];
    for (const [type, toggle, occasion, deduction] of [
      ["annual", "waiveAnnualLeave", "annualLeave", 100],
      ["sick", "waiveSickLeave", "sickLeave", 1000],
      ["special", "waiveSpecialLeave", "specialLeave", 500],
      ["undertime", "waiveUndertime", "undertime", 250],
    ] as const) {
      await reset(); const staff = await employee();
      if (type === "sick") await db.update(schema.hrPayrollSettings).set({ basicSalaryDeductionPolicy: { ...BASIC_POLICY, sickLeave: true } });
      if (type === "undertime") await day(staff.id, "2026-10-01", { dutyHours: "6", earlyDepartureStatus: "pending" });
      else await approveLeave((await request(staff.id, type)).id);
      await day(staff.id, "2026-10-02", { status: "absent" });
      await exact(staff.id, 41300 - deduction, 1600 + deduction);
      const before = await db.query.attendance.findMany(); const balances = await balance(staff.id);
      const result = await exact(staff.id, 41300, 1600, { attendanceAdjustments: { [toggle]: true } });
      compare(`${type} waived occasion`, result.calculation.deductionBreakdownByOccasion[occasion], 0);
      compare(`${type} original deduction retained`, result.calculation.unadjustedOccasionDeductions?.[occasion], deduction);
      compare(`${type} preserves absence deduction`, result.calculation.deductionBreakdownByOccasion.absent, 1600);
      compare(`${type} waiver is explained`, result.calculation.explanationLog.some(row => row.date === "2026-10-01" && row.isWaived), true);
      compare(`${type} preserves balances`, await balance(staff.id), balances);
      expect(await db.query.attendance.findMany()).toEqual(before);
      actual.push({ type, net: result.calculation.netSalary, waived: result.calculation.unadjustedOccasionDeductions?.[occasion] });
    }
    return actual;
  });

  test("composite fixture reconciles independent occasions, additions and balance usage", ["COMPOSITE"], async () => {
    await reset(); const staff = await employee();
    await day(staff.id, "2026-09-17", { status: "absent" });
    for (const [type, date, hours] of [["sick", "2026-09-21", "0"], ["annual", "2026-09-23", "0"], ["special", "2026-09-25", "0"], ["compensatory", "2026-09-29", "8"]]) await approveLeave((await request(staff.id, type, date, hours)).id);
    await day(staff.id, "2026-10-01", { dutyHours: "6", earlyDepartureStatus: "pending" });
    await day(staff.id, "2026-10-02", { dutyHours: "7", earlyDepartureStatus: "pending" });
    const worked = await day(staff.id, "2026-10-05", { dutyHours: "10", overtimeHours: "2", overtimeRemarks: "Synthetic composite overtime" }); await call(overtime, { id: worked.id, status: "approved" });
    await day(staff.id, "2026-10-07", { checkIn: "20:00", checkOut: "04:00", isNightShift: true });
    const result = await exact(staff.id, 41075, 2575);
    compare("composite period Bradford score and dates", { score: result.calculation.bradfordFactorScore, period: result.calculation.bradfordFactorPeriod }, { score: 27, period: "16 Sep 2026 to 15 Oct 2026" });
    compare("composite calendar-year Bradford score", result.yearlyBradfordScore, 27);
    expect(result.calculation).toMatchObject({ grossSalary: 43650, daysPresent: 21, daysAbsent: 1, daysLeave: 4, overtimeAmount: 250, nightShiftAllowanceAmount: 500, bradfordFactorScore: 27 });
    expect(result.calculation.deductionBreakdownByOccasion).toMatchObject({ absent: 1600, undertime: 375, annualLeave: 100, specialLeave: 500 });
    expect(result.calculation.componentDeductions).toEqual({ basicSalary: 1375, houseRent: 400, utilities: 200, conveyance: 300, mobile: 100, bikeMaintenance: 100, technical: 100, special: 0 });
    const cycle = await create(); await generate(cycle.id); await approve(cycle.id);
    const saved = await db.query.payslips.findFirst({ where: eq(schema.payslips.payrollId, cycle.id) });
    compare("persisted composite period and yearly Bradford", { score: Number(saved!.bradfordFactorScore), period: saved!.bradfordFactorPeriod, yearly: Number(saved!.yearlyBradfordScore) }, { score: 27, period: "16 Sep 2026 to 15 Oct 2026", yearly: 27 });
    expect(await balance(staff.id)).toEqual({ annual: 13, sick: 9, comp: 8 });
    return { gross: 43650, deductions: 2575, net: 41075, balance: await balance(staff.id) };
  });

  test("joining and explicit cutoff prorate separately; revision effective date follows current contract", ["A12"], async () => {
    await reset(); const staff = await employee({ joiningDate: "2026-09-17" });
    const joined = await exact(staff.id, 41250, 1650);
    expect(joined.calculation).toMatchObject({ daysNotEmployed: 1, daysAbsent: 0, daysLeave: 0, notEmployedDeduction: 1650 });
    expect(joined.calculation.deductionBreakdownByOccasion.notEmployed).toBe(1650);
    await db.update(schema.employees).set({ joiningDate: CYCLE.start }).where(eq(schema.employees.id, staff.id));
    await exact(staff.id, 41250, 1650, { earlyCutoffDate: "2026-10-14" });
    const [later] = await db.insert(schema.salaryRevisions).values({ employeeId: staff.id, revisionDate: "2026-10-18", basicSalary: "52000", allowanceConfig: ALLOWANCES, reason: "Effective-date characterization" }).returning();
    const current = await preview(staff.id);
    // Runtime can eventually leave the documented +30 day selection window.
    const today = new Date().toISOString().slice(0, 10);
    if (today <= "2026-11-14") {
      expect(current.salaryRevision.id).toBe(later.id); expect(current.calculation.basicSalary).toBe(52000);
    } else {
      expect(current.salaryRevision.revisionDate).toBe("2026-01-01"); expect(current.calculation.basicSalary).toBe(26000);
    }
    // This historical period is outside the +30-day window on every supported run date.
    // Ignore unmarked dates only for this separate revision-selection characterization.
    const historical = await core.simulateEmployeePayslipCore({ employeeId: staff.id, payrollId: "revision-characterization", payrollPeriod: { month: "2026-09-01", startDate: "2026-08-16", endDate: "2026-09-15" }, ignorePastUnmarkedDays: true });
    compare("historical period selects revision at cycle end", { revision: historical.salaryRevision.revisionDate, basic: historical.calculation.basicSalary }, { revision: "2026-01-01", basic: 26000 });
    const future = (await call(payroll.createPayrollFn, { month: "2099-11", processedBy: manifest.actors[0].userId })).payroll;
    await expect(generate(future.id)).rejects.toThrow(/cutoff|blocked/);
    return { joiningProration: 1650, cutoffProration: 1650, effectiveDate: today <= "2026-11-14" ? "current date" : "cycle end", fullFutureGeneration: "blocked" };
  });

  test("overnight checkout across cycle and calendar boundaries remains attributed to IN date", ["A06"], async () => {
    await reset(); const staff = await employee({ joiningDate: "2026-01-01", shifts: [{ start: "20:00", end: "04:00" }] });
    // Both examples must be historical; future imports are intentionally refused.
    for (const [inDate, outDate] of [["2026-10-15", "2026-10-16"], ["2026-08-31", "2026-09-01"]]) {
      await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, inDate)));
      await importRows(staff.employeeCode, "20:00", inDate); await importRows(staff.employeeCode, "04:00", outDate);
      const punches = await db.query.attendancePunches.findMany({ where: and(eq(schema.attendancePunches.employeeId, staff.id), eq(schema.attendancePunches.attendanceDate, inDate)) });
      expect(punches).toHaveLength(2);
      expect((await db.query.attendance.findFirst({ where: and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, inDate)) }))!.dutyHours).toBe("8.00");
      expect(await db.query.attendance.findFirst({ where: and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, outDate)) })).toBeUndefined();
    }
    await exact(staff.id, 43400, 0);
    return { cycleBoundaryDate: "2026-10-15", calendarBoundaryDate: "2026-08-31", eachDutyHours: 8, octoberNightAddition: 500 };
  });

  test("import and correction compete with generation and approval without stale finalized salary", ["P07"], async () => {
    await reset(); const staff = await employee();
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, staff.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(staff.employeeCode, "09:00, 15:00"); const cycle = await create(); await generate(cycle.id);
    const out = await db.query.attendancePunches.findFirst({ where: and(eq(schema.attendancePunches.employeeId, staff.id), eq(schema.attendancePunches.direction, "out")) });
    const race = await Promise.allSettled([call(manual.correctPunchFn, { punchId: out!.id, newTimestamp: "2026-10-01T17:00:00+05:00", reason: "Synthetic correction racing regeneration" }), generate(cycle.id)]);
    expect(race.every(result => result.status === "fulfilled")).toBe(true);
    try { await approve(cycle.id); } catch (error) { expect(String(error)).toMatch(/Regenerate/); await generate(cycle.id); await approve(cycle.id); }
    expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42900);
    // A new import races approval in its own draft cycle.
    await reset(); const second = await employee();
    await db.delete(schema.attendance).where(and(eq(schema.attendance.employeeId, second.id), eq(schema.attendance.date, "2026-10-01")));
    await importRows(second.employeeCode, "09:00, 15:00");
    const secondCycle = await create(); await generate(secondCycle.id);
    const results = await Promise.allSettled([importRows(second.employeeCode, "17:00, 19:00"), approve(secondCycle.id)]);
    const stored = await db.query.payrolls.findFirst({ where: eq(schema.payrolls.id, secondCycle.id) });
    if (stored!.status === "approved") {
      expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42650);
      expect(await db.query.attendancePunches.findMany()).toHaveLength(2);
    } else {
      await generate(secondCycle.id); await approve(secondCycle.id);
      expect(Number((await db.query.payslips.findFirst())!.netSalary)).toBe(42900);
    }
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    return { correctionFinalNet: 42900, importApprovalOutcome: stored!.status, safeFinalNet: stored!.status === "approved" ? 42650 : 42900 };
  });
});
