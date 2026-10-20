import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schemas/hr-schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Call while holding the attendance/payroll and employee punch-write locks.
export async function adjustCompensatoryReservation(tx: Tx, employeeId: string, previousHours: string | null | undefined, nextHours: string | null | undefined) {
  const previous = Number(previousHours || "0");
  const next = Number(nextHours || "0");
  if (!Number.isFinite(next) || next < 0) throw new Error("Compensatory hours must be finite and nonnegative.");
  if (previous === next) return;
  const employee = await tx.query.employees.findFirst({
    where: eq(employees.id, employeeId),
    columns: { compensatoryHoursBalance: true },
  });
  if (!employee) throw new Error("Employee not found");
  const currentBalance = Number(employee.compensatoryHoursBalance || "0");
  const balance = Number((currentBalance + previous - next).toFixed(2));
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error(`Insufficient compensatory leave balance. Available: ${currentBalance}h, trying to use: ${next}h`);
  }
  await tx.update(employees)
    .set({ compensatoryHoursBalance: balance.toFixed(2) })
    .where(eq(employees.id, employeeId));
}
