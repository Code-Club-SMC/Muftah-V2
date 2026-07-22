import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/lib/attendance/recompute-server.ts"),
  "utf8",
);

describe("recompute attendance server source", () => {
  it("revalidates stored overtime requests from the recomputed duty hours", () => {
    expect(SOURCE).toContain("revalidateOvertimeRequest({");
    expect(SOURCE).toContain("dutyHours: computed.dutyHours");
    expect(SOURCE).toContain(
      "requestedOvertimeHours: existingAttendance?.overtimeHours",
    );
    expect(SOURCE).toContain(
      "currentOvertimeStatus: existingAttendance?.overtimeStatus",
    );
  });

  it("preserves requested OT hours and remarks while letting stale requests fall back to pending", () => {
    expect(SOURCE).toContain(
      "overtimeHours: existingAttendance.overtimeHours ?? \"0.00\"",
    );
    expect(SOURCE).toContain(
      "overtimeStatus: overtimeRevalidation.nextOvertimeStatus",
    );
    expect(SOURCE).toContain(
      "overtimeRemarks: existingAttendance.overtimeRemarks ?? null",
    );
  });

  it("still clears overtime fields when the recompute path explicitly resets manual fields", () => {
    expect(SOURCE).toContain("manualFieldStrategy === \"reset\"");
    expect(SOURCE).toContain("overtimeHours: \"0.00\"");
    expect(SOURCE).toContain("overtimeStatus: \"pending\"");
    expect(SOURCE).toContain("overtimeRemarks: null");
  });
});
