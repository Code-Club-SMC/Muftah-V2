import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOfflineWorkbookDownloadHeaders,
  canWorkbookAcceptUploads,
} from "@/lib/attendance/offline/contracts";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/attendance/offline-workbooks-fn.ts",
  ),
  "utf8",
);

describe("offline attendance workbook management functions", () => {
  it("exports guarded workbook management server functions", () => {
    for (const exportName of [
      "listOfflineAttendanceWorkbooksFn",
      "issueOfflineAttendanceWorkbookFn",
      "downloadOfflineAttendanceWorkbookFn",
      "replaceOfflineAttendanceWorkbookFn",
      "retireOfflineAttendanceWorkbookFn",
    ]) {
      expect(source).toContain(`export const ${exportName}`);
    }

    expect(source.match(/requireOfflineAttendanceEnabled\(\)/g)).toHaveLength(5);
    expect(source).toContain("requireOfflineWorkbookManageMiddleware");
  });

  it("keeps workbook rows out of storage and records authenticated issuer metadata", () => {
    expect(source).toContain("issuedByUserId: context.session.user.id");
    expect(source).toContain("assignedOperatorUserId: data.operatorUserId");
    expect(source).toContain("findActiveWorkbookForOperator");
    expect(source).not.toContain("workbookBytes");
    expect(source).not.toContain("fileBytes");
  });

  it("refuses replacement and retirement while unresolved batches exist", () => {
    expect(source).toContain("assertNoUnresolvedImportBatches");
    expect(source).toContain("replaceOfflineAttendanceWorkbookFn");
    expect(source).toContain("retireOfflineAttendanceWorkbookFn");
    expect(source).toContain("UNRESOLVED_IMPORT_BATCH_STATUSES");
  });

  it("allows retired workbook downloads but blocks future uploads", () => {
    const downloadBlock = source.slice(
      source.indexOf("export const downloadOfflineAttendanceWorkbookFn"),
      source.indexOf("export const replaceOfflineAttendanceWorkbookFn"),
    );

    expect(downloadBlock).toContain("downloadOfflineAttendanceWorkbookFn");
    expect(downloadBlock).not.toContain("status");
    expect(canWorkbookAcceptUploads("active")).toBe(true);
    expect(canWorkbookAcceptUploads("retired")).toBe(false);
    expect(canWorkbookAcceptUploads("replaced")).toBe(false);
  });

  it("sanitizes download headers with assigned operator and workbook ID", () => {
    const headers = buildOfflineWorkbookDownloadHeaders({
      operatorName: "Ali / Night Shift",
      workbookId: "wb:123",
    });

    expect(headers["Content-Type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Disposition"]).toBe(
      'attachment; filename="offline-attendance-Ali-Night-Shift-wb-123.xlsx"',
    );
  });
});
