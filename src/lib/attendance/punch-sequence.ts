export type PunchDirection = "in" | "out";

export type TimelinePunch<TId extends string = string> = {
  id: TId;
  direction: PunchDirection;
  timestamp: string | Date;
};

export type CandidatePunch = {
  direction: PunchDirection;
  timestamp: string | Date;
};

export type PunchTimelineIssue<TId extends string = string> = {
  index: number;
  expectedDirection: PunchDirection;
  actualDirection: PunchDirection;
  punch: TimelinePunch<TId>;
};

function toTimestampMs(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

export function sortPunchTimeline<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
) {
  return punches
    .map((punch, index) => ({
      punch,
      index,
      timestampMs: toTimestampMs(punch.timestamp),
    }))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.punch);
}

export function findPunchTimelineIssue<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
): PunchTimelineIssue<TId> | null {
  const sorted = sortPunchTimeline(punches);
  let expectedDirection: PunchDirection = "in";

  for (let index = 0; index < sorted.length; index += 1) {
    const punch = sorted[index];
    if (punch.direction !== expectedDirection) {
      return {
        index,
        expectedDirection,
        actualDirection: punch.direction,
        punch,
      };
    }

    expectedDirection = expectedDirection === "in" ? "out" : "in";
  }

  return null;
}

export function isPunchTimelineValid<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
) {
  return findPunchTimelineIssue(punches) === null;
}

export function canInsertPunch<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
  candidate: CandidatePunch,
) {
  return isPunchTimelineValid([
    ...punches,
    {
      id: "__candidate__" as TId,
      direction: candidate.direction,
      timestamp: candidate.timestamp,
    },
  ]);
}

export function resolveInsertDirection<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
  timestamp: string | Date,
  preferredDirection?: PunchDirection | null,
) {
  const candidateDirections: PunchDirection[] = preferredDirection
    ? [preferredDirection]
    : ["in", "out"];

  for (const direction of candidateDirections) {
    if (canInsertPunch(punches, { direction, timestamp })) {
      return direction;
    }
  }

  return null;
}

export function canDeletePunch<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
  punchId: TId,
) {
  return isPunchTimelineValid(
    punches.filter((punch) => punch.id !== punchId),
  );
}

export function getProtectedDeletePunchIds<TId extends string>(
  punches: readonly TimelinePunch<TId>[],
) {
  const ids = new Set<TId>();

  for (const punch of punches) {
    if (!canDeletePunch(punches, punch.id)) {
      ids.add(punch.id);
    }
  }

  return ids;
}
