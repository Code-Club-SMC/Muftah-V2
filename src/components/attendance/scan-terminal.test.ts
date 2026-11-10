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

describe("retired scan terminal route and legacy UI", () => {
  it("keeps the old URL authenticated, directs HR to attendance, and never mounts the retired scanner", () => {
    expect(routeSource).toContain('createFileRoute("/attendance/scan")');
    expect(routeSource).toContain("beforeLoad");
    expect(routeSource).toContain("getViewerAccessFn");
    expect(routeSource).toContain("hasPermission");
    expect(routeSource).toContain('throw redirect({ to: "/login", search: { redirect: location.href } })');
    expect(routeSource).toContain('hasPermission(viewerAccess.permissions, "hr.view")');
    expect(routeSource).toContain('throw redirect({ to: "/hr/attendance" })');
    expect(routeSource).toContain("component: RetiredAttendanceTerminal");
    expect(routeSource).toContain("Attendance recording has moved");
    expect(routeSource).toContain("HR now uploads the device punch report");
    expect(routeSource).not.toContain("component: ScanTerminal");
    expect(navigationSource).not.toContain('title: "Attendance Terminal"');
    expect(navigationSource).not.toContain('url: "/attendance/scan"');
  });

  it("keeps a hidden scanner input focused and submits raw payloads", () => {
    expect(source).toContain('aria-label="Raw card scan payload"');
    expect(source).toContain("autoFocus");
    expect(source).toContain("focusInput");
    expect(source).toContain("scanAttendanceFn");
    expect(source).toContain("rawPayload: payload");
    expect(source).toContain("2D Barcode Scanner");
  });

  it("handles kiosk concerns without making them hard requirements", () => {
    expect(source).toContain("wakeLock");
    expect(source).toContain("catch(() =>");
    expect(source).toContain("AudioContext");
    expect(source).toContain("setTimeout");
    expect(source).toContain("10_000");
  });

  it("shows honest online/offline state and Excel fallback guidance", () => {
    expect(source).toContain("useTerminalHeartbeat(isOnline)");
    expect(source).toContain("const isOnline = statusQuery.isSuccess");
    expect(source).toContain("System Offline");
    expect(source).toContain("Record attendance in assigned Excel workbook");
    expect(source).toContain(
      "Internet unavailable. Record this IN/OUT event in the assigned attendance workbook.",
    );
    expect(source).not.toContain("const isOnline = !statusQuery.isError");
  });
});
