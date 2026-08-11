import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/server-functions/sales/offline-upload-fn.ts"),
  "utf8",
);

describe("offline sales upload boundary", () => {
  it("accepts only bounded xlsx FormData with a past outage", () => {
    expect(source).toContain('endsWith(".xlsx")');
    expect(source).toContain("OFFLINE_SALES_MAX_BYTES");
    expect(source).toContain("Outage start must be before outage end");
    expect(source).toContain("Outage end cannot be in the future");
    expect(source).toContain("min(5).max(500)");
  });

  it("stores only safe rejection metadata and releases file bytes", () => {
    expect(source).toContain('lastError: "unsafe_workbook"');
    expect(source).toContain("bytes = new Uint8Array()");
    expect(source).not.toMatch(/fileBytes|workbookBytes|documentBlob/);
  });

  it("stages normalized rows atomically and treats slots as authoritative", () => {
    expect(source).toContain("db.transaction");
    expect(source).toContain("slot.stagedContentHash === invoice.contentHash");
    expect(source).toContain('status: "conflict"');
    expect(source).toContain("offlineSalesStagedItems");
    expect(source).toContain("offlineSalesStagedPayments");
    expect(source).toContain('status: "preview_ready"');
  });

  it("marks the exported staging helper as server-only", () => {
    expect(source).toContain("createServerOnlyFn");
    expect(source).toContain(
      "export const stageOfflineSalesUpload = createServerOnlyFn",
    );
    expect(source).not.toContain(
      "export async function stageOfflineSalesUpload",
    );
  });
});
