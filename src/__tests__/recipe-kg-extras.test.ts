import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("packaging formats refuse KG shoppers as extra items", () => {
  it.each([
    "src/server-functions/inventory/recipes/create-recipe-fn.ts",
    "src/server-functions/inventory/recipes/update-recipe-fn.ts",
  ])("%s", (path) => {
    expect(readFileSync(path, "utf8")).toContain(
      "if (material.measuredInKg) throw new Error(`${material.name} is measured in KG, so it can only be the pack, not an extra item`);",
    );
  });
});
