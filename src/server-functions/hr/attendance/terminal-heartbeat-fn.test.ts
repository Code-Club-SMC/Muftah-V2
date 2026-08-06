import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/attendance/terminal-heartbeat-fn.ts",
  ),
  "utf8",
);

const HOOK_SOURCE = readFileSync(
  resolve(process.cwd(), "src/hooks/attendance/use-terminal-heartbeat.ts"),
  "utf8",
);

describe("terminal heartbeat source safeguards", () => {
  it("is terminal-permission protected and feature-flagged", () => {
    expect(SOURCE).toContain("requireAttendanceTerminalMiddleware");
    expect(SOURCE).toContain("isOfflineAttendanceEnabled()");
    expect(SOURCE).toContain("enabled: false");
  });

  it("uses server time and one row per terminal per minute", () => {
    expect(SOURCE).toContain("const observedAt = new Date()");
    expect(SOURCE).toContain("minuteBucket(observedAt)");
    expect(SOURCE).toContain("context.session.user.id");
    expect(SOURCE).toContain("onConflictDoNothing");
    expect(SOURCE).not.toContain("client");
  });

  it("prunes old heartbeat evidence without blocking normal scans", () => {
    expect(SOURCE).toContain("TERMINAL_HEARTBEAT_RETENTION_DAYS");
    expect(SOURCE).toContain("observedAt.getUTCMinutes() === 0");
    expect(SOURCE).toContain(".delete(attendanceTerminalHeartbeats)");
  });

  it("client hook records best-effort heartbeat only while online", () => {
    expect(HOOK_SOURCE).toContain("if (!isOnline) return");
    expect(HOOK_SOURCE).toContain("recordTerminalHeartbeatFn");
    expect(HOOK_SOURCE).toContain("TERMINAL_HEARTBEAT_INTERVAL_MS");
    expect(HOOK_SOURCE).toContain(".catch(() =>");
    expect(HOOK_SOURCE).toContain("window.clearInterval");
  });
});
