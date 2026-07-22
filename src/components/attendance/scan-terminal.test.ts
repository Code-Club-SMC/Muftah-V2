import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/components/attendance/scan-terminal.tsx",
  "utf8",
);
const routeSource = readFileSync(
  "src/routes/attendance/scan.tsx",
  "utf8",
);
const navigationSource = readFileSync("src/lib/constants.ts", "utf8");

describe("scan terminal UI source", () => {
  it("mounts the scanner outside the protected layout and keeps it out of the sidebar", () => {
    expect(routeSource).toContain('createFileRoute("/attendance/scan")');
    expect(routeSource).toContain("beforeLoad");
    expect(routeSource).toContain("getViewerAccessFn");
    expect(routeSource).toContain("hasPermission");
    expect(routeSource).toContain("component: ScanTerminal");
    expect(navigationSource).not.toContain('title: "Attendance Terminal"');
    expect(navigationSource).not.toContain('url: "/attendance/scan"');
  });

  it("keeps a hidden scanner input focused and submits raw payloads", () => {
    expect(source).toContain('aria-label="Raw card scan payload"');
    expect(source).toContain("autoFocus");
    expect(source).toContain("focusInput");
    expect(source).toContain("scanAttendanceFn");
    expect(source).toContain("rawPayload: payload");
    expect(source).toContain("fixed barcode scanner");
  });

  it("handles kiosk concerns without making them hard requirements", () => {
    expect(source).toContain("wakeLock");
    expect(source).toContain("catch(() =>");
    expect(source).toContain("AudioContext");
    expect(source).toContain("setTimeout");
    expect(source).toContain("10_000");
  });
});
