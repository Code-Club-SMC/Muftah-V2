import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const page = read("src/components/sales/offline/offline-sales-page.tsx");
const workbook = read("src/components/sales/offline/workbook-panel.tsx");
const upload = read("src/components/sales/offline/upload-panel.tsx");
const review = read("src/components/sales/offline/review-panel.tsx");
const stock = read(
  "src/components/sales/offline/stock-reconciliation-panel.tsx",
);
const route = read("src/routes/_protected/sales/offline.tsx");
const navigation = read("src/lib/constants.ts");

describe("offline sales workspace source", () => {
  it("explains the outage flow in three plain steps", () => {
    expect(page).toContain("Keep it ready");
    expect(page).toContain("Work during outage");
    expect(page).toContain("Upload and check");
    expect(page).toContain("database remains the final record");
  });

  it("shows only permission-allowed work areas", () => {
    expect(page).toContain('"sales.offline.workbooks.manage"');
    expect(page).toContain('"sales.offline.upload"');
    expect(page).toContain('"sales.offline.review"');
    expect(page).toContain('"sales.offline.post"');
    expect(page).toContain('"inventory.stock-reconciliation.manage"');
    expect(page).toContain("{canManageWorkbooks && (");
    expect(page).toContain("{canUseReview && (");
    expect(page).toContain("{canManageStock && (");
  });

  it("requires safe workbook replacement and explicit unsafe retirement", () => {
    expect(workbook).toMatch(
      /every used row from the old workbook has been\s+uploaded/,
    );
    expect(workbook).toContain("usedRowsUploaded: true");
    expect(workbook).toContain("Force-retire unsafe workbook?");
    expect(workbook).toContain("reason.trim().length < 5");
    expect(workbook).toContain("remainingSlots <= 50");
  });

  it("sends outage metadata and retains form values after recoverable errors", () => {
    expect(upload).toContain('form.set("file", file)');
    expect(upload).toContain('form.set("outageStartedAt"');
    expect(upload).toContain('form.set("outageEndedAt"');
    expect(upload).toContain('form.set("outageReason"');
    expect(upload).toContain("onSuccess: (result)");
    expect(upload).not.toContain("onError:");
    expect(upload).not.toContain('setOutageStartedAt("")');
    expect(upload).not.toContain('setOutageEndedAt("")');
    expect(upload).not.toContain('setOutageReason("")');
  });

  it("makes every review decision visible and resumable", () => {
    for (const label of [
      "Ready",
      "Warning",
      "Duplicate",
      "Invalid",
      "Needs Review",
      "Posted",
    ]) {
      expect(review).toContain(label);
    }
    expect(review).toContain("issue.source");
    expect(review).toContain("issue.value");
    expect(review).toMatch(/I\s+checked this warning/);
    expect(review).toContain("replacementWalletId");
    expect(review).toContain("Save order decision");
    expect(review).toContain("Post eligible invoices");
  });

  it("resolves stock differences through a real correction record", () => {
    expect(stock).toContain("Counted Adjustment");
    expect(stock).toContain("Missing Production/Transfer Record");
    expect(stock).toContain("resolutionReference");
    expect(stock).toContain("resolutionReason");
    expect(stock).toMatch(/This screen never\s+invents stock/);
  });

  it("adds the protected route and permission-aware navigation", () => {
    expect(route).toContain('createFileRoute("/_protected/sales/offline")');
    expect(route).toContain("context.viewerAccess.permissions");
    expect(navigation).toContain('title: "Offline Invoices"');
    expect(navigation).toContain('url: "/sales/offline"');
  });

  it("does not introduce an offline signature workflow", () => {
    const allOfflineUi = [page, workbook, upload, review, stock].join("\n");
    expect(allOfflineUi.toLowerCase()).not.toContain("signature");
  });
});
