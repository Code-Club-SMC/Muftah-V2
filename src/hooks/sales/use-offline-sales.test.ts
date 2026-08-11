import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/hooks/sales/use-offline-sales.ts", "utf8");

describe("offline sales hooks source", () => {
  it("uses one hierarchical query-key namespace", () => {
    expect(source).toContain('all: ["offline-sales"] as const');
    for (const key of [
      "workbooks",
      "operators",
      "history",
      "batch",
      "wallets",
      "stockIssues",
    ]) {
      expect(source).toContain(`${key}:`);
    }
  });

  it("downloads transient bytes and never stores workbook contents locally", () => {
    expect(source).toContain("response.blob()");
    expect(source).toContain('response.headers.get("Content-Disposition")');
    expect(source).toContain("window.URL.createObjectURL(blob)");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("indexedDB");
  });

  it("wires review, resumable posting, and stock reconciliation", () => {
    expect(source).toContain("acknowledgeOfflineSalesWarningFn");
    expect(source).toContain("replaceOfflineSalesWalletFn");
    expect(source).toContain("resolveOfflineSalesOrderConflictFn");
    expect(source).toContain("while (result.hasMore && runs < 30)");
    expect(source).toContain("resolveStockReconciliationIssueFn");
    expect(source).toContain("invalidateQueries");
  });
});
