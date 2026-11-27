import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { salaryPayments } from "./hr-schema";

describe("salary payments schema", () => {
  it("links a money event to payroll + employee with checks on shape and reversal", () => {
    const config = getTableConfig(salaryPayments);
    const column = (name: string) => config.columns.find((c) => c.name === name);
    expect(config.name).toBe("salary_payments");
    for (const name of ["payroll_id", "employee_id", "kind", "amount", "payment_date", "status", "recorded_by_id"]) {
      expect(column(name)?.notNull, name).toBe(true);
    }
    for (const name of ["wallet_id", "transaction_id", "advance_id", "reversal_transaction_id", "reversal_reason", "reversed_at", "reversed_by_id"]) {
      expect(column(name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      "salary_payments_amount_check",
      "salary_payments_reversal_check",
      "salary_payments_shape_check",
    ]);
    expect(config.indexes.map((i) => i.config.name)).toContain("salary_payments_payroll_employee_idx");
  });
});
