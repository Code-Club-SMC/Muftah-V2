import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  "src/components/hr/attendance/offline/offline-attendance-page.tsx",
  "utf8",
);
const workbookSource = readFileSync(
  "src/components/hr/attendance/offline/workbook-panel.tsx",
  "utf8",
);
const uploadSource = readFileSync(
  "src/components/hr/attendance/offline/upload-panel.tsx",
  "utf8",
);
const routeSource = readFileSync(
  "src/routes/_protected/hr/attendance/offline.tsx",
  "utf8",
);
const navSource = readFileSync("src/lib/constants.ts", "utf8");

describe("offline attendance page source", () => {
  it("explains the operator workflow in plain English", () => {
    expect(pageSource).toContain("Offline attendance");
    expect(pageSource).toContain("Excel fallback");
    expect(pageSource).toContain("Normal setup");
    expect(pageSource).toContain("every day");
    expect(pageSource).toContain("During outage");
    expect(pageSource).toContain("After internet returns");
    expect(pageSource).toContain("Do not create random new file");
  });

  it("keeps workbook management safe and assigned to terminal users", () => {
    expect(workbookSource).toContain("useOfflineAttendanceOperators");
    expect(workbookSource).toContain("Only users with attendance terminal scan permission");
    expect(workbookSource).toContain("selectedOperatorHasActiveWorkbook");
    expect(workbookSource).toContain("Issue workbook");
    expect(workbookSource).toContain("Download");
    expect(workbookSource).toContain("Retire workbook");
  });

  it("uploads Excel as transient data and drives supervisor/reviewer flow", () => {
    expect(uploadSource).toContain("new FormData()");
    expect(uploadSource).toContain('form.set("file", file)');
    expect(uploadSource).toContain("Upload `.xlsx` only");
    expect(uploadSource).toContain("Server reads rows, then discards file bytes");
    expect(uploadSource).toContain("Confirm outage");
    expect(uploadSource).toContain("Import ready rows");
    expect(uploadSource).toContain("useExcludeOfflineImportRows");
    expect(uploadSource).toContain("useConfirmOfflineAttendanceImport");
  });

  it("uses Pakistan-time outage inputs with explicit offset", () => {
    expect(uploadSource).toContain('const PKT_OFFSET = "+05:00"');
    expect(uploadSource).toContain("toPktDateTimeIso");
    expect(uploadSource).toContain('timeZone: "Asia/Karachi"');
  });

  it("registers route and sidebar link through normal route/nav files", () => {
    expect(routeSource).toContain(
      'createFileRoute("/_protected/hr/attendance/offline")',
    );
    expect(routeSource).toContain("offlineAttendanceKeys.workbooks()");
    expect(navSource).toContain('title: "Offline Excel"');
    expect(navSource).toContain('url: "/hr/attendance/offline"');
  });
});
