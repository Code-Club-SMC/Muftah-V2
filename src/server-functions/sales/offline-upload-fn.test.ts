import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const source = read("src/server-functions/sales/offline-upload-fn.ts");
const entries = read("src/server-functions/sales/offline-entries-fn.ts");

describe("offline sales staging boundary", () => {
  it("has no Excel upload any more", () => {
    expect(source).not.toMatch(/xlsx|FormData|spreadsheetml/i);
    expect(source).not.toContain("uploadOfflineSalesWorkbookFn");
    expect(source).not.toContain("parseOfflineSalesWorkbook");
  });

  it("accepts invoices only as bounded entries with a past outage window", () => {
    expect(entries).toContain("offlineEntriesSchema");
    expect(entries).toContain("Outage start must be before outage end");
    expect(entries).toContain("Outage end cannot be in the future");
    expect(entries).toContain("min(5).max(500)");
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
