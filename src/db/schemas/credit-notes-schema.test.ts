import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  creditNoteCounters,
  customerCreditLots,
  customerCreditMovements,
  customerCreditPaymentAllocations,
  customerRefundAllocations,
  customerRefunds,
  payments,
  salesReturns,
  slipRecords,
} from "./sales-erp-schema";
import { customers, invoices } from "./sales-schema";

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("credit notes & customer credit database contract", () => {
  it("adds credit_balance with non-negative check on customers", () => {
    expect(columnNames(customers)).toContain("credit_balance");
    expect(checkNames(customers)).toContain("customers_credit_balance_nonnegative_check");
  });

  it("adds excess_credited_amount and updated settlement check on invoices and slip_records", () => {
    expect(columnNames(invoices)).toContain("excess_credited_amount");
    expect(checkNames(invoices)).toContain("invoices_settlement_amounts_check");
    expect(columnNames(slipRecords)).toContain("excess_credited_amount");
    expect(checkNames(slipRecords)).toContain("slip_records_settlement_amounts_check");
  });

  it("adds credit note and split settlement columns and partial unique index on sales_returns", () => {
    expect(columnNames(salesReturns)).toEqual(
      expect.arrayContaining([
        "credit_note_number",
        "credit_note_issued_at",
        "applied_to_invoice_amount",
        "customer_credit_amount",
      ]),
    );
    expect(indexNames(salesReturns)).toContain("uq_sales_returns_credit_note_number");
    expect(checkNames(salesReturns)).toEqual(
      expect.arrayContaining([
        "sales_returns_credit_split_nonnegative_check",
        "sales_returns_completion_credit_note_check",
      ]),
    );
  });

  it("allows customer_credit in payments without wallet_id", () => {
    const methodColumn = getTableConfig(payments).columns.find((c) => c.name === "method");
    expect(methodColumn?.enumValues).toContain("customer_credit");
    expect(checkNames(payments)).toEqual(
      expect.arrayContaining(["payments_method_status_check", "payments_method_details_check"]),
    );
  });

  it("defines credit_note_counters and all customer credit/refund tables with conservation checks", () => {
    expect(getTableConfig(creditNoteCounters).name).toBe("credit_note_counters");
    expect(columnNames(creditNoteCounters)).toEqual(["id", "last_number", "updated_at"]);
    expect(checkNames(creditNoteCounters)).toContain("credit_note_counters_last_number_check");

    expect(getTableConfig(customerCreditLots).name).toBe("customer_credit_lots");
    expect(columnNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "customer_id",
        "source_type",
        "source_return_id",
        "source_invoice_id",
        "source_payment_id",
        "credit_note_number",
        "original_amount",
        "remaining_amount",
        "applied_amount",
        "refunded_amount",
        "reclaimed_amount",
        "voided_at",
      ]),
    );
    expect(checkNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "customer_credit_lots_amounts_check",
        "customer_credit_lots_conservation_check",
      ]),
    );
    expect(indexNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "idx_customer_credit_lots_customer_created",
        "idx_customer_credit_lots_source_return",
      ]),
    );

    expect(getTableConfig(customerCreditPaymentAllocations).name).toBe(
      "customer_credit_payment_allocations",
    );
    expect(getTableConfig(customerRefunds).name).toBe("customer_refunds");
    expect(checkNames(customerRefunds)).toContain("customer_refunds_status_check");
    expect(getTableConfig(customerRefundAllocations).name).toBe("customer_refund_allocations");
    expect(getTableConfig(customerCreditMovements).name).toBe("customer_credit_movements");
    expect(indexNames(customerCreditMovements)).toContain("idx_customer_credit_movements_customer");
  });

  it("exports all Phase 4 tables from src/db/index.ts and leaves baseline migration untouched", () => {
    const dbIndex = readFileSync(resolve(process.cwd(), "src/db/index.ts"), "utf8");
    for (const sym of [
      "creditNoteCounters",
      "customerCreditLots",
      "customerCreditPaymentAllocations",
      "customerRefunds",
      "customerRefundAllocations",
      "customerCreditMovements",
    ]) {
      expect(dbIndex).toContain(sym);
    }
  });
});
