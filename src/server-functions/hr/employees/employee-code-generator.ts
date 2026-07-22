import { db } from "@/db";
import { employees } from "@/db/schemas/hr-schema";
import { sql } from "drizzle-orm";

/**
 * Transaction type inferred from the application's Drizzle database client.
 * Kept as a type alias so this server-only file remains importable for typing
 * without dragging in the database driver on the client.
 */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function computeNextCode(maxCode: string | null, employeeCount: number): string {
  if (!maxCode) {
    return "EMP-0001";
  }

  const match = maxCode.match(/^EMP-(\d+)$/);
  if (!match) {
    return `EMP-${String((employeeCount ?? 0) + 1).padStart(4, "0")}`;
  }

  const nextNumber = parseInt(match[1], 10) + 1;
  return `EMP-${String(nextNumber).padStart(4, "0")}`;
}

/**
 * Generates the next sequential employee code under a transaction-scoped
 * PostgreSQL advisory lock. This file is server-only and must never be
 * imported by client code.
 */
export async function generateCodeInTx(tx: DbTransaction): Promise<string> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('employee_code_generation'))`,
  );

  const [result] = await tx
    .select({ maxCode: sql<string>`MAX(${employees.employeeCode})` })
    .from(employees);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(employees);

  return computeNextCode(result?.maxCode ?? null, count ?? 0);
}

/**
 * Standalone server-side code generator (opens its own transaction).
 */
export async function generateNextEmployeeCode(): Promise<string> {
  return await db.transaction(async (tx) => generateCodeInTx(tx));
}
