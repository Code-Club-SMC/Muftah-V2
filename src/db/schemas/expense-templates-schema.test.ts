// src/db/schemas/expense-templates-schema.test.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { expenses, expenseTemplates } from "./finance-schema";

describe("expense templates schema", () => {
  it("stores a repeat with optional amount, account, note and reminder", () => {
    const config = getTableConfig(expenseTemplates);
    const column = (name: string) => config.columns.find((c) => c.name === name);
    expect(config.name).toBe("expense_templates");
    expect(column("name")?.notNull).toBe(true);
    expect(column("category_id")?.notNull).toBe(true);
    for (const name of ["amount", "payee", "wallet_id", "note", "reminder_day", "skipped_month", "archived_at"]) {
      expect(column(name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name)).toContain("expense_templates_reminder_day_check");
  });

  it("links an expense to the template it came from, optional for existing rows", () => {
    const config = getTableConfig(expenses);
    expect(config.columns.find((c) => c.name === "template_id")?.notNull).toBe(false);
    expect(config.indexes.map((i) => i.config.name)).toContain("expenses_template_date_idx");
  });
});
