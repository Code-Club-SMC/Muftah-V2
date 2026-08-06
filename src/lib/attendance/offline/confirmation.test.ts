import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CONFIRMATION_SOURCE = readFileSync(
  resolve(process.cwd(), "src/lib/attendance/offline/confirmation.server.ts"),
  "utf8",
);

const SERVER_FN_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/attendance/offline-confirm-fn.ts",
  ),
  "utf8",
);

describe("offline attendance final confirmation source safeguards", () => {
  it("uses a renewable batch lease and bounded processing", () => {
    expect(CONFIRMATION_SOURCE).toContain("OFFLINE_BATCH_LEASE_MS");
    expect(CONFIRMATION_SOURCE).toContain("OFFLINE_CONFIRM_GROUP_LIMIT");
    expect(CONFIRMATION_SOURCE).toContain("processingLeaseId");
    expect(CONFIRMATION_SOURCE).toContain("renewBatchLease");
    expect(CONFIRMATION_SOURCE).toContain("releaseBatchLease");
  });

  it("locks employee punch writes and reclassifies live data before insert", () => {
    expect(CONFIRMATION_SOURCE).toContain("lockEmployeePunchWrites");
    expect(CONFIRMATION_SOURCE).toContain("classifyOfflineTimeline");
    expect(CONFIRMATION_SOURCE).toContain("loadImportedClaims");
    expect(CONFIRMATION_SOURCE).toContain("attendancePunches");
  });

  it("creates durable offline punch claims and recomputes attendance", () => {
    expect(CONFIRMATION_SOURCE).toContain('status: "imported"');
    expect(CONFIRMATION_SOURCE).toContain("offlineImportRowId");
    expect(CONFIRMATION_SOURCE).toContain("offlineImportIdentity");
    expect(CONFIRMATION_SOURCE).toContain("recomputeAttendanceRow");
  });

  it("handles duplicate claims without overwriting live data", () => {
    expect(CONFIRMATION_SOURCE).toContain("isUniqueViolation");
    expect(CONFIRMATION_SOURCE).toContain("markGroupDuplicate");
    expect(CONFIRMATION_SOURCE).toContain("already_imported");
  });

  it("keeps operator, supervisor, and reviewer distinct", () => {
    expect(CONFIRMATION_SOURCE).toContain("assertDistinctWorkflowActors");
    expect(CONFIRMATION_SOURCE).toContain("reviewedByUserId");
    expect(CONFIRMATION_SOURCE).toContain("Only the original reviewer can resume");
  });
});

describe("offline attendance final confirmation server function", () => {
  it("requires review permission and feature flag", () => {
    expect(SERVER_FN_SOURCE).toContain("requireOfflineImportReviewMiddleware");
    expect(SERVER_FN_SOURCE).toContain("requireOfflineAttendanceEnabled()");
    expect(SERVER_FN_SOURCE).toContain("processOfflineImportSlice");
  });
});
