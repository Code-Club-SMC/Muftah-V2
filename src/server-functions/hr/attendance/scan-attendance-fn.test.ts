import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const SOURCE = readFileSync(
  "src/server-functions/hr/attendance/scan-attendance-fn.ts",
  "utf8",
);
const ROUTE = readFileSync("src/routes/attendance/scan.tsx", "utf8");
describe("retired barcode capture", () => {
  it("keeps the old RPC permission protected and rejects capture", () => {
    expect(SOURCE).toContain("requireAttendanceTerminalMiddleware");
    expect(SOURCE).toContain("throw new Error");
    expect(SOURCE).toContain("Barcode attendance has been replaced");
  });
  it("has no database or punch write path", () => {
    expect(SOURCE).not.toContain('from "@/db"');
    expect(SOURCE).not.toContain(".insert(");
    expect(SOURCE).not.toContain(".update(");
    expect(SOURCE).not.toContain(".delete(");
  });
  it("routes HR to attendance without mounting the scanner", () => {
    expect(ROUTE).toContain('to: "/hr/attendance"');
    expect(ROUTE).not.toContain("ScanTerminal");
    expect(ROUTE).toContain("getViewerAccessFn");
  });
});
