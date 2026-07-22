import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 6 — process overtime action guard", () => {
  it("rejects approving stale overtime requests at server level", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "./process-overtime-fn.ts"),
      "utf8",
    );

    expect(src).toContain("buildOvertimeRequestSummary");
    expect(src).toContain('state === "stale"');
    expect(src).toContain("throw new Error");
    expect(src).toContain("Cannot approve");
  });
});
