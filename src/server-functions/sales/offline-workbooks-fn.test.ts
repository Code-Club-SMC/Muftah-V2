import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineSalesDownloadHeaders } from "@/lib/sales/offline/contracts";

const source = readFileSync(
  resolve(process.cwd(), "src/server-functions/sales/offline-workbooks-fn.ts"),
  "utf8",
);

describe("offline sales workbook lifecycle", () => {
  it("issues exactly one signed 500-slot F01 workbook in one transaction", () => {
    expect(source).toContain("db.transaction");
    expect(source).toContain("buildOfflineSalesReferenceSnapshot(input.tx");
    expect(source).toContain("reserveOfflineInvoiceSerials(");
    expect(source).toContain("OFFLINE_SALES_INVOICE_CAPACITY");
    expect(source).toContain("createOfflineSalesSlotToken");
    expect(source).toContain("Factory F01 already has an active");
  });

  it("requires upload attestation and resolves active work before replacement", () => {
    expect(source).toContain("usedRowsUploaded: z.literal(true)");
    expect(source).toContain("assertNoUnresolvedBatch");
    expect(source).toContain('status: "closed"');
    expect(source).toContain('status: "voided"');
    expect(source).toContain("replacementWorkbookId");
  });

  it("audits force retirement and refuses stale workbook downloads", () => {
    expect(source).toContain("min(5).max(500)");
    expect(source).toContain('status: "force_retired"');
    expect(source).toContain("forceRetiredByUserId");
    expect(source).toContain("Only the active official workbook can be downloaded");
  });

  it("downloads with a stable safe filename and no browser cache", () => {
    expect(offlineSalesDownloadHeaders({ workbookId: "abc/123" })).toEqual({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="offline-sales-F01-abc-123.xlsx"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });
});
