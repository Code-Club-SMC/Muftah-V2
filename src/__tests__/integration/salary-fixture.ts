import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips, salaryPayments } from "@/db/schemas/hr-schema";

/**
 * Each call commits its own payroll in a random far-future year (payroll months are unique),
 * with its own accounts and staff. "Today" for date checks is 3 Dec of that year.
 */
export async function salaryFixture(options: { cash?: string; nets?: string[] } = {}) {
  const id = randomUUID();
  // Fixtures stay committed in the test DB, so pick a year no earlier run has used.
  const usedYears = new Set(
    (await db.select({ month: payrolls.month }).from(payrolls)).map((p) => Number(String(p.month).slice(0, 4))),
  );
  let year = 2200 + Math.floor(Math.random() * 7000);
  while (usedYears.has(year)) year = 2200 + Math.floor(Math.random() * 7000);
  const month = `${year}-11-01`;
  const todayKey = `${year}-12-03`;
  const [actor] = await db.insert(user).values({ id, name: "Accountant", email: `${id}@test.invalid` }).returning();
  const [cash] = await db.insert(wallets).values({ id: `cash-${id}`, name: `Cash ${id.slice(0, 8)}`, type: "cash", balance: options.cash ?? "200000.00" }).returning();
  const [bank] = await db.insert(wallets).values({ id: `bank-${id}`, name: `Bank ${id.slice(0, 8)}`, type: "bank", balance: "500000.00" }).returning();
  const [payroll] = await db.insert(payrolls).values({ month, startDate: `${year}-10-26`, endDate: `${year}-11-25`, status: "draft" }).returning();
  const staff = [];
  for (const [index, net] of (options.nets ?? ["26200.00", "100000.00"]).entries()) {
    const [employee] = await db.insert(employees).values({
      employeeCode: `${id.slice(0, 8)}-${index}`,
      firstName: `Staff${index}`,
      lastName: id.slice(0, 6),
      designation: "Operator",
      joiningDate: "2026-01-01",
    }).returning();
    const [slip] = await db.insert(payslips).values({
      payrollId: payroll.id, employeeId: employee.id, basicSalary: net, grossSalary: net, totalDeductions: "0", netSalary: net,
    }).returning();
    staff.push({ employee, slip, name: `${employee.firstName} ${employee.lastName}` });
  }

  const balanceOf = async (walletId: string) => (await db.select().from(wallets).where(eq(wallets.id, walletId)))[0].balance;
  const rows = async (employeeId: string) =>
    db.select().from(salaryPayments)
      .where(and(eq(salaryPayments.payrollId, payroll.id), eq(salaryPayments.employeeId, employeeId)))
      .orderBy(asc(salaryPayments.createdAt));
  const line = async (transactionId: string) => (await db.select().from(transactions).where(eq(transactions.id, transactionId)))[0];
  /** Simulates a Revise that changes the net (Revise re-inserts the slip; payments stay linked by payroll + employee). */
  const setNet = async (employeeId: string, net: string) =>
    db.update(payslips).set({ netSalary: net, grossSalary: net })
      .where(and(eq(payslips.payrollId, payroll.id), eq(payslips.employeeId, employeeId)));
  const base = { payrollId: payroll.id, todayKey, actorId: actor.id };

  return { id, year, month, todayKey, actor, cash, bank, payroll, staff, base, balanceOf, rows, line, setNet };
}
