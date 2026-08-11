import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/sales/offline/reference-snapshot.server.ts"),
  "utf8",
);

describe("offline sales reference snapshot", () => {
  it("contains only existing distributors, eligible orders, and factory stock", () => {
    expect(source).toContain('eq(customers.customerType, "distributor")');
    expect(source).toContain('inArray(orders.status, ["pending", "confirmed"])');
    expect(source).toContain("linkedOrderIds.has(order.id)");
    expect(source).toContain('eq(warehouses.type, "factory_floor")');
  });

  it("captures locked prices, discount rules, WAC, and payment accounts", () => {
    expect(source).toContain("entityRecipeRates.entityType");
    expect(source).toContain("defaultPrice?.invoicePricePerPack");
    expect(source).toContain('eq(discountRules.ruleType, "free_units")');
    expect(source).toContain("weightedAverageCostPerPack");
    expect(source).toContain('wallet.type === "cash" || wallet.type === "bank"');
  });
});
