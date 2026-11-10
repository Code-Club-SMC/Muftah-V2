import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/hooks/sales/use-offline-sales.ts", "utf8");

describe("offline sales hooks source", () => {
  it("uses one hierarchical query-key namespace", () => {
    expect(source).toContain('all: ["offline-sales"] as const');
    for (const key of [
      "workbooks",
      "history",
      "batch",
      "wallets",
      "stockIssues",
    ]) {
      expect(source).toContain(`${key}:`);
    }
  });

  it("has no Excel download or upload and keeps nothing in the browser", () => {
    expect(source).not.toContain("response.blob()");
    expect(source).not.toContain("createObjectURL");
    expect(source).not.toContain("uploadOfflineSalesWorkbookFn");
    expect(source).toContain("sendOfflineSalesEntriesFn");
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
