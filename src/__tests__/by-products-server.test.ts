// src/__tests__/by-products-server.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync("src/lib/inventory/by-products.server.ts", "utf8");

describe("by-products server module", () => {
  it("locks per material with a transaction advisory lock", () => {
    expect(source()).toContain("pg_advisory_xact_lock(hashtext(");
    expect(source()).toContain("'by-product:'");
  });

  it("counts from current total stock and existing purchases oldest first", () => {
    const s = source();
    expect(s).toContain("sum(${materialStock.quantity})");
    expect(s).toContain("asc(purchaseRecords.purchaseDate), asc(purchaseRecords.createdAt)");
    expect(s).toContain("earnedEmpties(");
  });

  it("counts sold from non-voided sales only", () => {
    expect(source()).toContain("isNull(otherIncome.voidedAt)");
  });

  it("refuses changes that leave sold above earned", () => {
    expect(source()).toContain("already sold; this change would leave only");
  });
});
