import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { purchaseRecords, supplierCreditMovements, supplierReturns } from "./supplier-schema";

const col = (config: ReturnType<typeof getTableConfig>, name: string) => config.columns.find((c) => c.name === name);

describe("supplier returns schema", () => {
  it("adds returned_amount to purchases with a default, so old rows owe the same", () => {
    const config = getTableConfig(purchaseRecords);
    expect(col(config, "returned_amount")?.notNull).toBe(true);
    expect(col(config, "returned_amount")?.default).toBe("0");
    expect(config.checks.map((c) => c.name)).toContain("purchase_returned_amount_ck");
  });

  it("keeps one return per purchase with lifecycle, debit note and money split", () => {
    const config = getTableConfig(supplierReturns);
    expect(config.name).toBe("supplier_returns");
    for (const name of ["return_number", "supplier_id", "purchase_id", "warehouse_id", "lot_id", "quantity", "unit_cost", "total_amount", "reason", "status", "requested_by_id"]) {
      expect(col(config, name)?.notNull, name).toBe(true);
    }
    for (const name of ["debit_note_number", "dispatched_at", "completed_at", "refund_wallet_id", "refund_transaction_id", "cancelled_at", "voided_at"]) {
      expect(col(config, name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name)).toEqual(expect.arrayContaining([
      "supplier_returns_status_ck",
      "supplier_returns_quantity_ck",
      "supplier_returns_debit_note_ck",
      "supplier_returns_refund_wallet_ck",
    ]));
    expect(config.indexes.map((i) => i.config.name)).toEqual(expect.arrayContaining([
      "supplier_returns_number_unique_idx",
      "supplier_returns_debit_note_unique_idx",
      "supplier_returns_supplier_status_idx",
      "supplier_returns_purchase_idx",
    ]));
  });

  it("logs supplier credit as signed movements", () => {
    const config = getTableConfig(supplierCreditMovements);
    expect(config.name).toBe("supplier_credit_movements");
    expect(col(config, "amount")?.notNull).toBe(true);
    expect(config.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["supplier_credit_kind_ck", "supplier_credit_sign_ck"]));
  });
});
