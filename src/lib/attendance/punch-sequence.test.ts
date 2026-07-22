import { describe, expect, it } from "vitest";
import {
  canDeletePunch,
  findPunchTimelineIssue,
  resolveInsertDirection,
} from "./punch-sequence";

function punch(
  id: string,
  direction: "in" | "out",
  timestamp: string,
) {
  return { id, direction, timestamp };
}

describe("punch sequence rules", () => {
  it("rejects duplicate same-direction inserts", () => {
    const punches = [punch("a", "in", "2026-07-02T09:00:00+05:00")];

    expect(
      resolveInsertDirection(
        punches,
        "2026-07-02T09:05:00+05:00",
        "in",
      ),
    ).toBeNull();
  });

  it("rejects inserts that break the middle of a completed pair", () => {
    const punches = [
      punch("a", "in", "2026-07-02T09:00:00+05:00"),
      punch("b", "out", "2026-07-02T17:00:00+05:00"),
    ];

    expect(
      resolveInsertDirection(
        punches,
        "2026-07-02T12:00:00+05:00",
        "in",
      ),
    ).toBeNull();
    expect(
      resolveInsertDirection(
        punches,
        "2026-07-02T12:00:00+05:00",
        "out",
      ),
    ).toBeNull();
  });

  it("protects punches whose removal would break alternation", () => {
    const punches = [
      punch("a", "in", "2026-07-02T09:00:00+05:00"),
      punch("b", "out", "2026-07-02T12:00:00+05:00"),
      punch("c", "in", "2026-07-02T13:00:00+05:00"),
      punch("d", "out", "2026-07-02T17:00:00+05:00"),
    ];

    expect(canDeletePunch(punches, "a")).toBe(false);
    expect(canDeletePunch(punches, "b")).toBe(false);
    expect(canDeletePunch(punches, "c")).toBe(false);
    expect(canDeletePunch(punches, "d")).toBe(true);
  });

  it("flags the first bad direction in an invalid timeline", () => {
    const issue = findPunchTimelineIssue([
      punch("a", "in", "2026-07-02T09:00:00+05:00"),
      punch("b", "in", "2026-07-02T09:05:00+05:00"),
    ]);

    expect(issue).not.toBeNull();
    expect(issue?.index).toBe(1);
    expect(issue?.expectedDirection).toBe("out");
    expect(issue?.actualDirection).toBe("in");
  });
});
