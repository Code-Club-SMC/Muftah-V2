import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertDistinctWorkflowActors } from "./workflow-actors";

const PREVIEW_SOURCE = readFileSync(
  resolve(process.cwd(), "src/lib/attendance/offline/preview.server.ts"),
  "utf8",
);

describe("offline attendance preview actor rules", () => {
  it("prevents the operator from confirming their own outage", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "user-1",
        supervisorUserId: "user-1",
        reviewerUserId: null,
      }),
    ).toThrow("Operator cannot confirm their own outage");
  });

  it("requires the final reviewer to differ from operator and supervisor", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "user-1",
        supervisorUserId: "user-2",
        reviewerUserId: "user-1",
      }),
    ).toThrow("Final reviewer must be different from operator");

    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "user-1",
        supervisorUserId: "user-2",
        reviewerUserId: "user-2",
      }),
    ).toThrow("Final reviewer must be different from supervisor");
  });

  it("allows three distinct workflow actors", () => {
    expect(() =>
      assertDistinctWorkflowActors({
        operatorUserId: "operator",
        supervisorUserId: "supervisor",
        reviewerUserId: "reviewer",
      }),
    ).not.toThrow();
  });
});

describe("offline attendance preview source safeguards", () => {
  it("classifies against live data and persists row outcomes", () => {
    expect(PREVIEW_SOURCE).toContain("classifyOfflineTimeline");
    expect(PREVIEW_SOURCE).toContain("loadRelevantLiveData");
    expect(PREVIEW_SOURCE).toContain(".update(attendanceImportRows)");
    expect(PREVIEW_SOURCE).toContain("updateBatchCounts");
    expect(PREVIEW_SOURCE).toContain("status: \"preview_ready\"");
  });

  it("keeps imported and excluded rows immutable during preview refresh", () => {
    expect(PREVIEW_SOURCE).toContain('row.status !== "imported"');
    expect(PREVIEW_SOURCE).toContain('row.status !== "excluded"');
  });

  it("uses payroll, attendance, employee, punch, and heartbeat context", () => {
    expect(PREVIEW_SOURCE).toContain("attendancePunches");
    expect(PREVIEW_SOURCE).toContain("attendanceTerminalHeartbeats");
    expect(PREVIEW_SOURCE).toContain("payrollStatusForDate");
    expect(PREVIEW_SOURCE).toContain("attendanceStatusForDate");
    expect(PREVIEW_SOURCE).toContain("isRestDay");
  });

  it("does not store workbook bytes or expose row tokens in queue items", () => {
    const queueItemType = PREVIEW_SOURCE.slice(
      PREVIEW_SOURCE.indexOf("export type OfflineImportQueueItem"),
      PREVIEW_SOURCE.indexOf("export type OfflineImportQueues"),
    );

    expect(PREVIEW_SOURCE).not.toContain("workbookBytes");
    expect(PREVIEW_SOURCE).not.toContain("fileBytes");
    expect(PREVIEW_SOURCE).not.toContain("arrayBuffer");
    expect(queueItemType).not.toContain("recordToken");
  });
});
