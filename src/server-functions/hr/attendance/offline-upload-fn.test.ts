import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/server-functions/hr/attendance/offline-upload-fn.ts"),
  "utf8",
);

describe("offline attendance workbook upload function", () => {
  it("uses POST FormData, feature flag, and upload permission", () => {
    expect(source).toContain('createServerFn({ method: "POST" })');
    expect(source).toContain("data instanceof FormData");
    expect(source).toContain("requireOfflineAttendanceEnabled()");
    expect(source).toContain("requireOfflineAttendanceUploadMiddleware");
  });

  it("parses bytes once and stores metadata plus immutable row attempts", () => {
    expect(source).toContain("await file.arrayBuffer()");
    expect(source).toContain("parseOfflineAttendanceWorkbook(bytes)");
    expect(source).toContain("attendanceImportBatches");
    expect(source).toContain("attendanceImportRows");
    expect(source).toContain("attendanceOutageWindows");
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("readFile");
    expect(source).not.toContain("workbookBytes");
    expect(source).not.toContain("fileBytes");
  });

  it("stores rejected unsafe uploads as safe metadata only", () => {
    expect(source).toContain('status: "rejected"');
    expect(source).toContain('lastError: "unsafe_workbook"');
    expect(source).toContain("fileSha256");
    expect(source).toContain("byteSize");
  });
});
