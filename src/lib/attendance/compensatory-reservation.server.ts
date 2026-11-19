import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { compensatoryLedger, employees } from "@/db/schemas/hr-schema";
import {
  reservationReason,
  type CompensatoryLedgerReason,
  type CompensatoryReservationKind,
} from "./compensatory-ledger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CompensatoryAudit = {
  attendanceId?: string | null;
  attendanceDate?: string | null;
  cashOutId?: string | null;
  note?: string | null;
  /** Null or omitted when the system made the change. */
  actorId?: string | null;
};

/**
 * The only way to change an employee's banked comp-off hours. Updates the
 * balance and writes one history row. Call while holding the attendance/payroll
 * and employee punch-write locks.
 */
export async function changeCompensatoryBalance(
  tx: Tx,
  employeeId: string,
  changeHours: number,
  reason: CompensatoryLedgerReason,
  audit: CompensatoryAudit = {},
) {
  if (!Number.isFinite(changeHours)) throw new Error("Compensatory hours must be finite.");
  const change = Number(changeHours.toFixed(2));
  if (change === 0) return null;
  const employee = await tx.query.employees.findFirst({
    where: eq(employees.id, employeeId),
    columns: { compensatoryHoursBalance: true },
  });
  if (!employee) throw new Error("Employee not found");
  const currentBalance = Number(employee.compensatoryHoursBalance || "0");
  const balance = Number((currentBalance + change).toFixed(2));
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error(`Insufficient compensatory leave balance. Available: ${currentBalance}h, trying to use: ${-change}h`);
  }

  // Balances from before history existed get one opening row, so the history adds up.
  if (currentBalance !== 0) {
    const anyEntry = await tx.query.compensatoryLedger.findFirst({
      where: and(eq(compensatoryLedger.employeeId, employeeId)),
      columns: { id: true },
    });
    if (!anyEntry) {
      await tx.insert(compensatoryLedger).values({
        employeeId,
        changeHours: currentBalance.toFixed(2),
        balanceAfter: currentBalance.toFixed(2),
        reason: "opening_balance",
        note: "Balance before history started",
      });
    }
  }

  await tx.update(employees)
    .set({ compensatoryHoursBalance: balance.toFixed(2) })
    .where(eq(employees.id, employeeId));
  const [entry] = await tx.insert(compensatoryLedger).values({
    employeeId,
    changeHours: change.toFixed(2),
    balanceAfter: balance.toFixed(2),
    reason,
    attendanceId: audit.attendanceId ?? null,
    attendanceDate: audit.attendanceDate ?? null,
    cashOutId: audit.cashOutId ?? null,
    note: audit.note ?? null,
    actorId: audit.actorId ?? null,
  }).returning();
  return entry;
}

/**
 * Moves a reservation from previousHours to nextHours (comp leave, bank cover or cash-out).
 * Hours reserved leave the bank; hours released go back.
 */
export async function adjustCompensatoryReservation(
  tx: Tx,
  employeeId: string,
  previousHours: string | null | undefined,
  nextHours: string | null | undefined,
  audit: CompensatoryAudit & { kind: CompensatoryReservationKind },
) {
  const previous = Number(previousHours || "0");
  const next = Number(nextHours || "0");
  if (!Number.isFinite(next) || next < 0) throw new Error("Compensatory hours must be finite and nonnegative.");
  if (previous === next) return;
  const change = previous - next;
  const { kind, ...rest } = audit;
  await changeCompensatoryBalance(tx, employeeId, change, reservationReason(kind, change), rest);
}
