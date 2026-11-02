import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

// The table shows one group per material. Paging by purchase split one material
// across two pages and showed it as two separate groups, so both lists page by material.
describe("supplier purchase lists page by material", () => {
  for (const file of [
    "src/server-functions/suppliers/get-supplier-paginated-purchases-fn.ts",
    "src/server-functions/suppliers/get-supplier-paginated-outstanding-fn.ts",
  ]) {
    it(`${file.split("/").pop()} uses the shared material pager`, () => {
      const source = read(file);
      expect(source).toContain("purchasesPageByMaterial(");
      expect(source).not.toContain(".offset(");
      expect(source).not.toContain("limit,\n      offset");
    });
  }

  it("pages the distinct materials, then loads every purchase of those materials", () => {
    const source = read("src/lib/suppliers/purchase-rows.server.ts");
    const pager = source.slice(source.indexOf("export async function purchasesPageByMaterial"));
    expect(pager).toContain(".groupBy(groupKey)");
    expect(pager).toContain(".limit(limit)");
    expect(pager).toContain("inArray(groupKey");
    // The purchase query itself must not be limited, or a material would be cut in half again.
    const purchaseQuery = pager.slice(pager.indexOf("findMany"));
    expect(purchaseQuery.slice(0, purchaseQuery.indexOf("return {"))).not.toContain("limit");
  });
});
