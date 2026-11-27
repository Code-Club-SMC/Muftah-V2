import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { commissionEarnings, orders } from "./sales-erp-schema";

describe("recovery commission schema", () => {
  it("locks the commission terms on the order, both optional for existing rows", () => {
    const columns = getTableConfig(orders).columns;
    const mode = columns.find((c) => c.name === "commission_mode")!;
    const rate = columns.find((c) => c.name === "commission_rate_locked")!;
    expect(mode.notNull).toBe(false);
    expect(rate.notNull).toBe(false);
    expect(rate.getSQLType()).toBe("numeric(7, 4)");
  });

  it("stores one ledger row per payment event and per return event", () => {
    const config = getTableConfig(commissionEarnings);
    expect(config.name).toBe("commission_earnings");
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      "amount", "base_amount", "bearer", "created_at", "created_by_id", "entry_date", "id", "invoice_id", "kind",
      "note", "order_booker_id", "order_id", "paid_in_payslip_id", "payment_id", "rate", "sales_return_id",
    ]);
    const unique = config.indexes.filter((i) => i.config.unique).map((i) => i.config.name).sort();
    expect(unique).toEqual(["commission_earnings_payment_kind_unique", "commission_earnings_return_kind_unique"]);
  });
});
