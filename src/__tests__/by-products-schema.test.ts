import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("by-product schema", () => {
  it("adds container columns and a consistency check on purchases", () => {
    const source = readFileSync("src/db/schemas/supplier-schema.ts", "utf8");
    expect(source).toContain('boolean("by_product_tracked").notNull().default(false)');
    expect(source).toContain('text("container_name")');
    expect(source).toContain('decimal("container_size", { precision: 12, scale: 3 })');
    expect(source).toContain('"purchase_by_product_container"');
  });

  it("links each sale to one material and a whole container count", () => {
    const source = readFileSync("src/db/schemas/finance-schema.ts", "utf8");
    expect(source).toContain('"other_income_one_material"');
    expect(source).toContain('"other_income_whole_quantity"');
    expect(source).toContain('index("other_income_chemical_idx")');
  });
});
