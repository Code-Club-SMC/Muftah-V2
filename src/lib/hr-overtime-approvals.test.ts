import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 5 — overtime approvals query and UI hardening", () => {
  it("approvals server function enriches records with suggestion and stale state", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../server-functions/hr/attendance/get-overtime-approvals-fn.ts"),
      "utf8",
    );

    expect(src).toContain("buildOvertimeRequestSummary");
    expect(src).toContain("suggestedOvertimeHours");
    expect(src).toContain("isOvertimeRequestStale");
    expect(src).toContain("overtimeRequestWarning");
  });

  it("approvals UI disables approve for stale rows", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../components/hr/attendance/overtime-approvals-container.tsx"),
      "utf8",
    );

    expect(src).toContain("isOvertimeRequestStale");
    expect(src).toContain("Needs Recheck");
    expect(src).toMatch(/disabled=\{mutateOT\.isPending \|\| isStale\}/);
  });
});
