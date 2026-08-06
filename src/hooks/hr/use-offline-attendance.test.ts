import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/hooks/hr/use-offline-attendance.ts",
  "utf8",
);

describe("offline attendance hooks source", () => {
  it("uses one hierarchical query key factory for workbook and import state", () => {
    expect(source).toContain("offlineAttendanceKeys");
    expect(source).toContain('all: ["offline-attendance"] as const');
    expect(source).toContain('workbooks: () => [...offlineAttendanceKeys.all, "workbooks"]');
    expect(source).toContain('operators: () => [...offlineAttendanceKeys.all, "operators"]');
    expect(source).toContain('queues: () => [...offlineAttendanceKeys.all, "queues"]');
    expect(source).toContain("batch: (batchId: string)");
  });

  it("wires all offline attendance server functions through query hooks", () => {
    for (const serverFunction of [
      "listOfflineAttendanceWorkbooksFn",
      "listOfflineAttendanceOperatorsFn",
      "uploadOfflineAttendanceWorkbookFn",
      "getOfflineImportQueuesFn",
      "getOfflineImportBatchFn",
      "confirmOfflineOutageWindowFn",
      "rejectOfflineOutageWindowFn",
      "refreshOfflineImportPreviewFn",
      "excludeOfflineImportRowsFn",
      "confirmOfflineAttendanceImportFn",
    ]) {
      expect(source).toContain(serverFunction);
    }
  });

  it("downloads workbook bytes without storing Excel in app state", () => {
    expect(source).toContain("response.blob()");
    expect(source).toContain('response.headers.get("Content-Disposition")');
    expect(source).toContain("window.URL.createObjectURL(blob)");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("indexedDB");
  });

  it("invalidates related queues, previews, and live attendance after mutations", () => {
    expect(source).toContain("invalidateQueries");
    expect(source).toContain("offlineAttendanceKeys.workbooks()");
    expect(source).toContain("offlineAttendanceKeys.queues()");
    expect(source).toContain("offlineAttendanceKeys.batch(result.batchId)");
    expect(source).toContain('queryKey: ["daily-attendance"]');
    expect(source).toContain('queryKey: ["employee-attendance-log"]');
  });
});
