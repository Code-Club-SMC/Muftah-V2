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
    expect(page).toContain("Prepare once");
    expect(page).toContain("Work during outage");
    expect(page).toContain("Send and review");
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

  it("only offers an emergency retire, with a reason", () => {
    expect(workbook).toContain("Retire these invoice numbers?");
    expect(workbook).toContain("Computer lost or stolen");
    expect(workbook).toContain("reason.trim().length < 5");
    expect(workbook).toContain("remainingSlots <= 50");
    expect(workbook).not.toContain("useReplaceOfflineSalesWorkbook");
    expect(workbook).not.toContain("useIssueOfflineSalesWorkbook");
    expect(workbook).not.toContain("Replace the invoice numbers?");
  });

  it("has no Excel workbook download or upload on any screen", () => {
    const screens = [page, workbook, upload, review].join("\n");
    expect(screens).not.toMatch(/xlsx|Excel/i);
    expect(workbook).not.toContain("Download");
    expect(upload).not.toContain("FormData");
  });

  it("sends a backup file with outage metadata and retains form values after recoverable errors", () => {
    expect(upload).toContain("useUploadOfflineSalesBackup");
    expect(upload).toContain("outageStartedAt: toPktIso(outageStartedAt)");
    expect(upload).toContain("outageEndedAt: toPktIso(outageEndedAt)");
    expect(upload).toContain("outageReason: outageReason.trim()");
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
    expect(stock).toMatch(/Marking resolved never changes\s+stock/);
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
