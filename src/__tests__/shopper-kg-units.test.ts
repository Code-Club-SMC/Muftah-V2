import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("shopper stock is shown in KG", () => {
  it.each([
    "src/server-functions/inventory/stock/transfer-stock-fn.ts",
    "src/server-functions/inventory/find-similar-materials-fn.ts",
    "src/server-functions/inventory/stock/get-low-stocks-alert-fn.ts",
    "src/server-functions/inventory/factory-floor/get-consumption-history-fn.ts",
  ])("%s reads the packaging unit from the KG switch", (path) => {
    const source = read(path);
    expect(source).toContain("packagingUnitSql(packagingMaterials.measuredInKg)");
    expect(source).not.toContain("sql<string>`'pcs'`");
  });

  it.each([
    "src/components/inventory/stock-table.tsx",
    "src/components/inventory/factory-floor-container.tsx",
    "src/components/inventory/inventory-details-dialog.tsx",
    "src/components/inventory/edit-material-dialog.tsx",
    "src/components/inventory/add-stock-dialog-form.tsx",
  ])("%s uses packagingUnit for packaging", (path) => {
    expect(read(path)).toContain("packagingUnit(");
  });

  it("prices KG shoppers as KG × price per KG in Add stock", () => {
    const source = read("src/components/inventory/add-stock-dialog-form.tsx");
    expect(source).toContain("pkg.measuredInKg");
    expect(source).toContain("Formula: KG × Price/KG");
  });
});
