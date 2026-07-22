import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/components/hr/attendance/manual-punch-timeline.tsx",
  "utf8",
);
const formSource = readFileSync(
  "src/components/hr/attendance/edit-attendance-form.tsx",
  "utf8",
);

describe("manual punch timeline UI source", () => {
  it("uses manual punch server functions instead of editing derived times directly", () => {
    expect(source).toContain("useAddManualPunch");
    expect(source).toContain("useCorrectPunch");
    expect(source).toContain("useDeletePunch");
    expect(source).toContain("computeAttendanceFromPunches");
    expect(formSource).toContain("ManualPunchTimeline");
    expect(formSource).not.toContain("<TimeInput");
  });

  it("keeps present records punch-driven", () => {
    expect(formSource).toContain("presentWithoutPunches");
    expect(formSource).toContain("Add at least one punch to save as Present");
    expect(formSource).toContain("Punch changes save immediately");
  });

  it("supports night-shift manual fallback by separating timestamp from attendance date", () => {
    expect(source).toContain("datetime-local");
    expect(source).toContain("attendanceDate: date");
    expect(source).toContain("+05:00");
    expect(source).toContain("For night shift checkout");
  });

  it("guards fast add clicks and blocks unsafe deletes in the UI", () => {
    expect(source).toContain("addPunchLockRef");
    expect(source).toContain("setIsAddingLocked(true)");
    expect(source).toContain("getProtectedDeletePunchIds");
    expect(source).toContain("Delete the latest related punch first");
  });

  it("does not let HR force punch direction manually", () => {
    expect(source).toContain("System decides from time order");
    expect(source).toContain("Next expected punch");
    expect(source).not.toContain('SelectItem value="in"');
    expect(source).not.toContain('SelectItem value="out"');
  });
});
