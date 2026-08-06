import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyOfflineTimeline,
  type TimelineCandidatePunch,
  type TimelinePolicy,
  type TimelinePunch,
} from "./timeline";

function pktIso(date: string, hour: number, minute = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute)).toISOString();
}

const policy: TimelinePolicy = {
  employeeExists: true,
  employeeStatus: "active",
  attendanceStatus: "none",
  payrollStatus: "none",
  confirmedWindow: {
    startsAt: "2026-06-01T00:00:00+05:00",
    endsAt: "2026-06-01T23:59:59+05:00",
  },
  now: "2026-06-02T00:00:00+05:00",
};

function candidateAt(index: number): TimelineCandidatePunch {
  const direction = index % 2 === 0 ? "in" : "out";
  return {
    id: `row-${index}`,
    employeeId: "emp-1",
    timestamp: pktIso("2026-06-01", 8 + index),
    attendanceDate: "2026-06-01",
    direction,
    source: "offline_excel",
    candidateRowId: `row-${index}`,
    workbookId: "wb-1",
    recordToken: `token-${index}`,
    contentHash: `hash-${index}`,
  };
}

const validAlternatingTimelineArb = fc
  .integer({ min: 1, max: 8 })
  .map((count) => Array.from({ length: count }, (_, index) => candidateAt(index)));

function readyTimeline(result: ReturnType<typeof classifyOfflineTimeline>) {
  expect(result.status).toBe("ready");
  return result.timeline;
}

describe("offline timeline classification properties", () => {
  it("does not depend on candidate input order", () => {
    fc.assert(
      fc.property(validAlternatingTimelineArb, (timeline) => {
        const reversed = [...timeline].reverse();

        expect(
          classifyOfflineTimeline({
            existing: [],
            candidates: reversed,
            policy,
          }),
        ).toEqual(
          classifyOfflineTimeline({
            existing: [],
            candidates: timeline,
            policy,
          }),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("keeps accepted output alternating", () => {
    fc.assert(
      fc.property(validAlternatingTimelineArb, (timeline) => {
        const output = readyTimeline(
          classifyOfflineTimeline({
            existing: [],
            candidates: timeline,
            policy,
          }),
        );

        for (let index = 1; index < output.length; index += 1) {
          expect(output[index].direction).not.toBe(output[index - 1].direction);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("keeps accepted candidate timestamps inside confirmed outage window", () => {
    fc.assert(
      fc.property(validAlternatingTimelineArb, (timeline) => {
        const output = readyTimeline(
          classifyOfflineTimeline({
            existing: [],
            candidates: timeline,
            policy,
          }),
        );
        const startMs = Date.parse(policy.confirmedWindow?.startsAt ?? "");
        const endMs = Date.parse(policy.confirmedWindow?.endsAt ?? "");

        const offlineOutput = output.filter(
          (punch): punch is TimelinePunch & { source: "offline_excel" } =>
            punch.source === "offline_excel",
        );

        for (const punch of offlineOutput) {
          const ms = Date.parse(punch.timestamp);
          expect(ms).toBeGreaterThanOrEqual(startMs);
          expect(ms).toBeLessThanOrEqual(endMs);
        }
      }),
      { numRuns: 50 },
    );
  });
});
