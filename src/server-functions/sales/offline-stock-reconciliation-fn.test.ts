import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/sales/offline-stock-reconciliation-fn.ts",
  ),
  "utf8",
);

describe("offline stock reconciliation boundary", () => {
  it("requires feature flag and stock reconciliation permission", () => {
    expect(source).toContain("requireOfflineSalesEnabled");
    expect(source).toContain("requireStockReconciliationManageMiddleware");
  });

  it("locks the issue and records a human reference before resolving it", () => {
    expect(source).toContain('.for("update")');
    expect(source).toContain("resolutionReference");
    expect(source).toContain("resolutionType");
    expect(source).toContain("resolutionReason");
    expect(source).toContain("context.session.user.id");
    expect(source).toContain('status: "resolved"');
  });

  it("does not change invoice quantities or stock", () => {
    expect(source).not.toContain("invoiceItems");
    expect(source).not.toContain("finishedGoodsStock");
  });
});
