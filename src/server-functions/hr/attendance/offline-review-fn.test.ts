import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/attendance/offline-review-fn.ts",
  ),
  "utf8",
);

describe("offline attendance review server functions", () => {
  it("exports the supervisor, preview, queue, and exclusion functions", () => {
    expect(SOURCE).toContain("confirmOfflineOutageWindowFn");
    expect(SOURCE).toContain("rejectOfflineOutageWindowFn");
    expect(SOURCE).toContain("getOfflineImportQueuesFn");
    expect(SOURCE).toContain("getOfflineImportBatchFn");
    expect(SOURCE).toContain("refreshOfflineImportPreviewFn");
    expect(SOURCE).toContain("excludeOfflineImportRowsFn");
  });

  it("guards each action with the offline feature flag and permissions", () => {
    expect(SOURCE).toContain("requireOfflineAttendanceEnabled()");
    expect(SOURCE).toContain("requireOfflineAttendanceViewMiddleware");
    expect(SOURCE).toContain("requireOfflineOutageConfirmMiddleware");
    expect(SOURCE).toContain("requireOfflineImportReviewMiddleware");
  });

  it("separates operator and supervisor before confirming or rejecting", () => {
    expect(SOURCE).toContain("assertDistinctWorkflowActors");
    expect(SOURCE).toContain("operatorUserId: workbook.assignedOperatorUserId");
    expect(SOURCE).toContain("supervisorUserId: context.session.user.id");
  });

  it("uses explicit state transitions for supervisor decisions", () => {
    expect(SOURCE).toContain('batch.status !== "awaiting_supervisor"');
    expect(SOURCE).toContain('status: "confirmed"');
    expect(SOURCE).toContain('status: "preview_ready"');
    expect(SOURCE).toContain('status: "rejected"');
    expect(SOURCE).toContain('status: "cancelled"');
  });

  it("builds preview only after supervisor confirmation", () => {
    expect(SOURCE).toContain("return await buildAndPersistOfflinePreview");
    expect(SOURCE).toContain("parseConfirmedRange");
    expect(SOURCE).toContain("endsAt > new Date()");
  });
});
