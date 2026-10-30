import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("actual use writes happen in one transaction through lot stock", () => {
  it("mixing completion runs inside the caller's transaction", () => {
    expect(read("src/server-functions/manufacturing/mixing/complete-mixing-run-fn.ts")).toContain("db.transaction(");
    const core = read("src/server-functions/manufacturing/mixing/complete-mixing-run-core.server.ts");
    expect(core).toContain("takeLotPicks(tx");
    expect(core).toContain("oldestFirst: true");
    expect(core).toContain("moveLotStock(tx");
    expect(core).not.toContain("db.transaction(");
    expect(core).not.toMatch(/update\(materialStock\)/);
  });
  it("packing takes lot picks that add up to Used", () => {
    const core = read("src/server-functions/manufacturing/packaging/batch-packing-core.server.ts");
    expect(core).toContain("required: used");
    expect(core).toContain("oldestFirst: true");
    expect(core).not.toContain("required: packingBulk(need.total");
  });
  it("mixing start is oldest-first and transfers stay free", () => {
    expect(read("src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts")).toContain("oldestFirst: true");
    expect(read("src/server-functions/inventory/stock/transfer-stock-core.server.ts")).not.toContain("oldestFirst");
  });
  it("logging output no longer completes a batch", () => {
    expect(read("src/server-functions/manufacturing/mixing/log-mixing-progress-fn.ts")).not.toContain("completeMixingRunCore");
  });
  it("adjustments write a reasoned row", () => {
    expect(read("src/server-functions/inventory/stock/adjust-stock-fn.ts")).toContain("insert(materialAdjustments)");
    expect(read("src/server-functions/inventory/update-material-fn.ts")).toContain("insert(materialAdjustments)");
  });
});
