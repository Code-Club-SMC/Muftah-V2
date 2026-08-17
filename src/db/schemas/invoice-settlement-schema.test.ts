import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { transactions } from "./finance-schema";
import { payments, slipRecords } from "./sales-erp-schema";
import { customers, invoiceNumberCounters, invoices } from "./sales-schema";

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("invoice settlement database contract", () => {
  it("defines transactional public invoice counters", () => {
    expect(getTableConfig(invoiceNumberCounters).name).toBe("invoice_number_counters");
    expect(columnNames(invoiceNumberCounters)).toEqual(["kind", "next_value", "updated_at"]);
    expect(checkNames(invoiceNumberCounters)).toContain(
      "invoice_number_counters_next_value_check",
    );
  });

  it("uses clear customer and invoice settlement fields", () => {
    expect(columnNames(customers)).toEqual(
      expect.arrayContaining(["total_paid_amount", "outstanding_amount"]),
    );
    expect(columnNames(customers)).not.toEqual(expect.arrayContaining(["payment", "credit"]));

    expect(columnNames(invoices)).toEqual(
      expect.arrayContaining([
        "invoice_number",
        "source",
        "paid_amount",
        "returned_amount",
        "outstanding_amount",
        "payment_due_date",
        "payment_status",
      ]),
    );
    expect(columnNames(invoices)).not.toEqual(
      expect.arrayContaining(["account", "cash", "credit", "credit_return_date", "slip_number"]),
    );
    expect(indexNames(invoices)).toEqual(
      expect.arrayContaining(["invoices_invoice_number_unique", "invoices_order_id_unique"]),
    );
  });

  it("defines auditable payment lifecycle constraints", () => {
    expect(columnNames(payments)).toEqual(
      expect.arrayContaining([
        "wallet_id",
        "status",
        "reference",
        "cheque_number",
        "cheque_bank",
        "cheque_date",
        "payment_date",
        "effective_date",
        "source",
        "source_record_id",
        "allocation_group_id",
        "confirmed_by_id",
        "confirmed_at",
        "resolved_by_id",
        "resolved_at",
        "resolution_reason",
      ]),
    );
    expect(checkNames(payments)).toEqual(
      expect.arrayContaining([
        "payments_amount_positive_check",
        "payments_method_status_check",
        "payments_method_details_check",
        "payments_confirmation_check",
        "payments_resolution_check",
      ]),
    );
    expect(indexNames(payments)).toContain("payments_source_record_unique");
  });

  it("uses unambiguous slip totals and effective wallet dates", () => {
    expect(columnNames(slipRecords)).toEqual(
      expect.arrayContaining([
        "invoice_amount",
        "paid_amount",
        "returned_amount",
        "outstanding_amount",
      ]),
    );
    expect(columnNames(slipRecords)).not.toEqual(
      expect.arrayContaining(["amount_due", "amount_recovered"]),
    );
    expect(columnNames(transactions)).toEqual(
      expect.arrayContaining(["effective_date", "reversal_of_transaction_id"]),
    );
    expect(indexNames(transactions)).toEqual(
      expect.arrayContaining([
        "transactions_effective_date_idx",
        "transactions_reversal_unique",
      ]),
    );
  });

  it("defines invoice number counters in the squashed baseline migration", () => {
    const baselinePath = resolve(
      process.cwd(),
      "src/db/migrations/0000_overconfident_nocturne.sql",
    );
    const baseline = readFileSync(baselinePath, "utf8");

    expect(baseline).toContain("invoice_number_counters");
    expect(baseline).not.toMatch(/\bTRUNCATE\b/i);
    expect(baseline).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("seeds invoice number counters idempotently", () => {
    const seedPath = resolve(
      process.cwd(),
      "src/db/migrations/0001_seed_invoice_counters.sql",
    );
    const seed = readFileSync(seedPath, "utf8");

    expect(seed).toContain('INSERT INTO "invoice_number_counters"');
    expect(seed).toMatch(/ON CONFLICT.*DO NOTHING/i);
    expect(seed).not.toMatch(/\bTRUNCATE\b/i);
    expect(seed).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(seed).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});
