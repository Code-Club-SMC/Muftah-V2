import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/server-functions/sales/offline-workbooks-fn.ts"),
  "utf8",
);

describe("offline invoice number lifecycle", () => {
  it("issues exactly one signed 500-slot F01 workbook in one transaction", () => {
    expect(source).toContain("db.transaction");
    expect(source).toContain("buildOfflineSalesReferenceSnapshot(input.tx");
    expect(source).toContain("reserveOfflineInvoiceSerials(");
    expect(source).toContain("OFFLINE_SALES_INVOICE_CAPACITY");
    expect(source).toContain("createOfflineSalesSlotToken");
    expect(source).toContain("Factory F01 already has an active");
  });

  it("renews the numbers only after the last batch is reviewed", () => {
    expect(source).toContain("assertNoUnresolvedBatch");
    expect(source).toContain('status: "closed"');
    expect(source).toContain("replacementWorkbookId");
  });

  it("has no office step to issue or replace numbers", () => {
    expect(source).not.toContain("issueOfflineSalesWorkbookFn");
    expect(source).not.toContain("replaceOfflineSalesWorkbookFn");
    expect(source).not.toContain("listOfflineSalesOperatorsFn");
    expect(source).not.toContain("usedRowsUploaded");
  });

  it("refreshes the price list in place, keeping the invoice numbers", () => {
    expect(source).toContain("refreshSnapshotInPlace");
    expect(source).toContain("options.refreshPrices ? await refreshSnapshotInPlace(tx, active) : active");
    // The signatures are redone with the workbook's own signing version.
    expect(source).toContain("signOfflineSalesSnapshot(snapshot, workbook.signingVersion)");
    // A price list made a moment ago is reused.
    expect(source).toContain("4 * 60_000");
  });

  it("audits force retirement", () => {
    expect(source).toContain("min(5).max(500)");
    expect(source).toContain('status: "force_retired"');
    expect(source).toContain("forceRetiredByUserId");
  });

  it("has no Excel download any more", () => {
    expect(source).not.toContain("downloadOfflineSalesWorkbookFn");
    expect(source).not.toContain("buildOfflineSalesWorkbook");
    expect(source).not.toMatch(/xlsx|spreadsheetml/i);
  });

  it("issues a workbook for the desk without an office step, one at a time", () => {
    expect(source).toContain("ensureDeskWorkbook");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("count(*) filter (where ${offlineSalesInvoiceSlots.status} = 'unused')");
    expect(source).toContain("All invoice numbers are used.");
  });
});
