import {
  OFFLINE_DUPLICATE_WINDOW_MS,
  OFFLINE_OVERNIGHT_OUT_BEFORE_HOUR,
} from "./constants";
import { toPKTDate, toPKTTime } from "../time";

export type TimelineSource = "qr_terminal" | "manual" | "offline_excel";
export type TimelineDirection = "in" | "out";

export type TimelinePunch = {
  id: string;
  employeeId: string;
  timestamp: string;
  attendanceDate: string;
  direction: TimelineDirection;
  source: TimelineSource;
  candidateRowId?: string;
  workbookId?: string;
  recordToken?: string;
  contentHash?: string;
};

export type ExplicitPunchInput = {
  timestamp: string | Date;
  direction: TimelineDirection;
};

export type ResolvedOfflinePunch =
  | { ok: true; attendanceDate: string; isNightShift: boolean }
  | { ok: false; reasonCode: string; message: string };

export type TimelineCandidatePunch = TimelinePunch & {
  source: "offline_excel";
  candidateRowId: string;
};

export type ImportedIdentityClaim = {
  workbookId: string;
  recordToken: string;
  contentHash: string;
  punchId?: string | null;
};

export type OfflineTimelineWarning = {
  code: "draft_payroll" | "rest_day";
  message: string;
};

export type TimelinePolicy = {
  employeeExists?: boolean;
  employeeStatus?: string | null;
  attendanceStatus?: string | null;
  isRestDay?: boolean;
  payrollStatus?: "none" | "draft" | "approved" | "paid";
  confirmedWindow?: {
    startsAt: string;
    endsAt: string;
  };
  now?: string;
  duplicateWindowMs?: number;
};

export type TimelineClassificationInput = {
  existing: TimelinePunch[];
  candidates: TimelineCandidatePunch[];
  importedClaims?: ImportedIdentityClaim[];
  policy?: TimelinePolicy;
};

export type ClassifiedTimelineCandidate = {
  candidateRowId: string;
  attendanceDate: string;
  isNightShift: boolean;
};

export type TimelineClassification =
  | {
      status: "ready";
      attendanceDate: string;
      isNightShift: boolean;
      warnings: OfflineTimelineWarning[];
      timeline: TimelinePunch[];
      candidateRows: ClassifiedTimelineCandidate[];
    }
  | {
      status: "duplicate";
      reasonCode: "already_imported" | "near_duplicate";
      message: string;
      timeline: TimelinePunch[];
      candidateRows: ClassifiedTimelineCandidate[];
    }
  | {
      status: "needs_review";
      reasonCode: string;
      message: string;
      timeline: TimelinePunch[];
      candidateRows: ClassifiedTimelineCandidate[];
    }
  | {
      status: "invalid";
      reasonCode: string;
      message: string;
      timeline: TimelinePunch[];
      candidateRows: ClassifiedTimelineCandidate[];
    }
  | {
      status: "blocked";
      reasonCode: string;
      message: string;
      timeline: TimelinePunch[];
      candidateRows: ClassifiedTimelineCandidate[];
    };

export type ClassifiedOfflineRow = {
  id: string;
  batchId?: string | null;
  employeeId: string | null;
  attendanceDate: string | null;
  normalizedTimestamp: string | null;
  rawDirection: string | null;
  status:
    | "pending"
    | "ready"
    | "duplicate"
    | "needs_review"
    | "invalid"
    | "blocked"
    | "imported"
    | "excluded";
  worksheetRowNumber?: number;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  isNightShift?: boolean;
  isRestDay?: boolean;
  warnings?: OfflineTimelineWarning[];
};

export type OfflineEmployeeDayGroup = {
  key: string;
  batchId: string | null;
  employeeId: string;
  attendanceDate: string;
  status: ClassifiedOfflineRow["status"];
  rowCount: number;
  readyRowCount: number;
  isNightShift: boolean;
  isRestDay: boolean;
  rows: ClassifiedOfflineRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timestampMs(value: string | Date): number {
  return asDate(value)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function calendarDayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function isPreviousCalendarDate(previous: string, next: string): boolean {
  return calendarDayNumber(next) - calendarDayNumber(previous) === 1;
}

function sourceRank(source: TimelineSource): number {
  if (source === "qr_terminal") return 0;
  if (source === "manual") return 1;
  return 2;
}

function directionRank(direction: TimelineDirection): number {
  return direction === "in" ? 0 : 1;
}

function normalizePunch(punch: TimelinePunch): TimelinePunch | null {
  const date = asDate(punch.timestamp);
  if (!date) return null;

  return {
    ...punch,
    timestamp: date.toISOString(),
  };
}

function sortTimeline(punches: TimelinePunch[]): TimelinePunch[] {
  return [...punches].sort((left, right) => {
    const leftMs = timestampMs(left.timestamp);
    const rightMs = timestampMs(right.timestamp);
    if (leftMs !== rightMs) return leftMs - rightMs;

    const directionDelta =
      directionRank(left.direction) - directionRank(right.direction);
    if (directionDelta !== 0) return directionDelta;

    const sourceDelta = sourceRank(left.source) - sourceRank(right.source);
    if (sourceDelta !== 0) return sourceDelta;

    return left.id.localeCompare(right.id);
  });
}

function emptyTimelineClassification(
  status: TimelineClassification["status"],
  reasonCode: string,
  message: string,
): TimelineClassification {
  if (status === "duplicate") {
    return {
      status,
      reasonCode: "near_duplicate",
      message,
      timeline: [],
      candidateRows: [],
    };
  }

  return {
    status,
    reasonCode,
    message,
    timeline: [],
    candidateRows: [],
  } as TimelineClassification;
}

function policyInvalidResult(input: {
  timeline: TimelinePunch[];
  candidateRows: ClassifiedTimelineCandidate[];
  reasonCode: string;
  message: string;
}): TimelineClassification {
  return {
    status: "invalid",
    reasonCode: input.reasonCode,
    message: input.message,
    timeline: input.timeline,
    candidateRows: input.candidateRows,
  };
}

function policyBlockedResult(input: {
  timeline: TimelinePunch[];
  candidateRows: ClassifiedTimelineCandidate[];
  reasonCode: string;
  message: string;
}): TimelineClassification {
  return {
    status: "blocked",
    reasonCode: input.reasonCode,
    message: input.message,
    timeline: input.timeline,
    candidateRows: input.candidateRows,
  };
}

function policyReviewResult(input: {
  timeline: TimelinePunch[];
  candidateRows: ClassifiedTimelineCandidate[];
  reasonCode: string;
  message: string;
}): TimelineClassification {
  return {
    status: "needs_review",
    reasonCode: input.reasonCode,
    message: input.message,
    timeline: input.timeline,
    candidateRows: input.candidateRows,
  };
}

function isWithinWindow(candidate: TimelinePunch, policy: TimelinePolicy) {
  if (!policy.confirmedWindow) return true;
  const candidateMs = timestampMs(candidate.timestamp);
  return (
    candidateMs >= timestampMs(policy.confirmedWindow.startsAt) &&
    candidateMs <= timestampMs(policy.confirmedWindow.endsAt)
  );
}

function isFuture(candidate: TimelinePunch, policy: TimelinePolicy) {
  if (!policy.now) return false;
  return timestampMs(candidate.timestamp) > timestampMs(policy.now);
}

function candidateIdentity(candidate: TimelineCandidatePunch) {
  if (!candidate.workbookId || !candidate.recordToken) return null;
  return {
    workbookId: candidate.workbookId,
    recordToken: candidate.recordToken,
  };
}

function claimForCandidate(
  candidate: TimelineCandidatePunch,
  claims: ImportedIdentityClaim[],
) {
  const identity = candidateIdentity(candidate);
  if (!identity) return null;

  return (
    claims.find(
      (claim) =>
        claim.workbookId === identity.workbookId &&
        claim.recordToken === identity.recordToken,
    ) ?? null
  );
}

function hasSameDirectionNearPunch(
  candidate: TimelinePunch,
  others: TimelinePunch[],
  windowMs: number,
) {
  const candidateMs = timestampMs(candidate.timestamp);

  return others.some(
    (other) =>
      other.employeeId === candidate.employeeId &&
      other.direction === candidate.direction &&
      Math.abs(timestampMs(other.timestamp) - candidateMs) <= windowMs,
  );
}

function hasNearCandidateCollision(
  candidates: TimelineCandidatePunch[],
  windowMs: number,
) {
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (
        left.employeeId === right.employeeId &&
        left.direction === right.direction &&
        Math.abs(timestampMs(left.timestamp) - timestampMs(right.timestamp)) <=
          windowMs
      ) {
        return true;
      }
    }
  }

  return false;
}

export function resolveOfflineAttendanceDate(
  input: ExplicitPunchInput,
  previous: TimelinePunch | null,
): ResolvedOfflinePunch {
  const incomingTimestamp = asDate(input.timestamp);
  if (!incomingTimestamp) {
    return {
      ok: false,
      reasonCode: "invalid_timestamp",
      message: "Punch timestamp is not valid",
    };
  }

  const pktCalendarDate = toPKTDate(incomingTimestamp);

  if (input.direction === "in") {
    return {
      ok: true,
      attendanceDate: pktCalendarDate,
      isNightShift: false,
    };
  }

  if (!previous || previous.direction !== "in") {
    return {
      ok: false,
      reasonCode: "missing_open_in",
      message: "OUT has no open IN",
    };
  }

  if (previous.attendanceDate === pktCalendarDate) {
    return {
      ok: true,
      attendanceDate: pktCalendarDate,
      isNightShift: false,
    };
  }

  const pktHour = Number(toPKTTime(incomingTimestamp).slice(0, 2));
  if (
    isPreviousCalendarDate(previous.attendanceDate, pktCalendarDate) &&
    pktHour < OFFLINE_OVERNIGHT_OUT_BEFORE_HOUR
  ) {
    return {
      ok: true,
      attendanceDate: previous.attendanceDate,
      isNightShift: true,
    };
  }

  return {
    ok: false,
    reasonCode: "unmatched_checkout",
    message: "OUT cannot be matched safely",
  };
}

export function classifyOfflineTimeline(
  input: TimelineClassificationInput,
): TimelineClassification {
  if (input.candidates.length === 0) {
    return emptyTimelineClassification(
      "invalid",
      "no_candidates",
      "No offline punches were supplied",
    );
  }

  const existing = input.existing.map(normalizePunch);
  const candidates = input.candidates.map(normalizePunch);
  if (existing.includes(null) || candidates.includes(null)) {
    return emptyTimelineClassification(
      "invalid",
      "invalid_timestamp",
      "One or more punch timestamps are not valid",
    );
  }

  const normalizedExisting = existing as TimelinePunch[];
  const normalizedCandidates = candidates as TimelineCandidatePunch[];
  const timeline = sortTimeline([
    ...normalizedExisting,
    ...normalizedCandidates,
  ]);
  const candidateRows: ClassifiedTimelineCandidate[] = [];

  const policy = input.policy ?? {};
  if (policy.employeeExists === false) {
    return policyInvalidResult({
      timeline,
      candidateRows,
      reasonCode: "unknown_employee",
      message: "Employee code does not match an employee",
    });
  }

  if (policy.employeeStatus && policy.employeeStatus !== "active") {
    return policyInvalidResult({
      timeline,
      candidateRows,
      reasonCode: "inactive_employee",
      message: "Employee is not active",
    });
  }

  const importedClaims = input.importedClaims ?? [];
  const matchedClaims = normalizedCandidates
    .map((candidate) => ({
      candidate,
      claim: claimForCandidate(candidate, importedClaims),
    }))
    .filter((entry) => entry.claim);

  if (
    matchedClaims.length === normalizedCandidates.length &&
    matchedClaims.every(
      ({ candidate, claim }) => candidate.contentHash === claim?.contentHash,
    )
  ) {
    return {
      status: "duplicate",
      reasonCode: "already_imported",
      message: "This workbook row was already imported",
      timeline,
      candidateRows,
    };
  }

  const changedClaim = matchedClaims.find(
    ({ candidate, claim }) => candidate.contentHash !== claim?.contentHash,
  );
  if (changedClaim) {
    return policyReviewResult({
      timeline,
      candidateRows,
      reasonCode: "changed_imported_identity",
      message:
        "This workbook row identity was already imported with different values",
    });
  }

  const duplicateWindowMs =
    policy.duplicateWindowMs ?? OFFLINE_DUPLICATE_WINDOW_MS;
  const nearExisting = normalizedCandidates.filter((candidate) =>
    hasSameDirectionNearPunch(candidate, normalizedExisting, duplicateWindowMs),
  );
  if (nearExisting.length === normalizedCandidates.length) {
    return {
      status: "duplicate",
      reasonCode: "near_duplicate",
      message: "Offline punch is already present in the live timeline",
      timeline,
      candidateRows,
    };
  }

  if (hasNearCandidateCollision(normalizedCandidates, duplicateWindowMs)) {
    return policyReviewResult({
      timeline,
      candidateRows,
      reasonCode: "duplicate_candidate",
      message: "Two offline rows look like the same punch",
    });
  }

  const outsideWindow = normalizedCandidates.find(
    (candidate) => !isWithinWindow(candidate, policy),
  );
  if (outsideWindow) {
    return policyBlockedResult({
      timeline,
      candidateRows,
      reasonCode: "outside_confirmed_outage",
      message: "Punch time is outside the confirmed outage window",
    });
  }

  const futureCandidate = normalizedCandidates.find((candidate) =>
    isFuture(candidate, policy),
  );
  if (futureCandidate) {
    return policyBlockedResult({
      timeline,
      candidateRows,
      reasonCode: "future_timestamp",
      message: "Future attendance punches cannot be imported",
    });
  }

  if (policy.payrollStatus === "approved" || policy.payrollStatus === "paid") {
    return policyBlockedResult({
      timeline,
      candidateRows,
      reasonCode: "payroll_locked",
      message: "Payroll for this attendance date is already approved or paid",
    });
  }

  if (
    policy.attendanceStatus === "leave" ||
    policy.attendanceStatus === "holiday" ||
    policy.attendanceStatus === "absent"
  ) {
    return policyReviewResult({
      timeline,
      candidateRows,
      reasonCode: `attendance_${policy.attendanceStatus}`,
      message: "Existing attendance status needs HR review before import",
    });
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const current = timeline[index];
    const previous = [...timeline]
      .slice(0, index)
      .reverse()
      .find((punch) => punch.employeeId === current.employeeId);

    if (
      previous &&
      previous.direction === current.direction &&
      previous.employeeId === current.employeeId
    ) {
      return policyReviewResult({
        timeline,
        candidateRows,
        reasonCode: "sequence_conflict",
        message: "Punch order would create two INs or two OUTs in a row",
      });
    }

    if (current.source !== "offline_excel" || !current.candidateRowId) {
      continue;
    }

    const resolved = resolveOfflineAttendanceDate(current, previous ?? null);
    if (!resolved.ok) {
      return policyReviewResult({
        timeline,
        candidateRows,
        reasonCode: resolved.reasonCode,
        message: resolved.message,
      });
    }

    candidateRows.push({
      candidateRowId: current.candidateRowId,
      attendanceDate: resolved.attendanceDate,
      isNightShift: resolved.isNightShift,
    });
  }

  const attendanceDates = new Set(
    candidateRows.map((candidate) => candidate.attendanceDate),
  );
  if (attendanceDates.size !== 1) {
    return policyReviewResult({
      timeline,
      candidateRows,
      reasonCode: "multiple_attendance_dates",
      message: "Offline rows belong to more than one attendance date",
    });
  }

  const warnings: OfflineTimelineWarning[] = [];
  if (policy.payrollStatus === "draft") {
    warnings.push({
      code: "draft_payroll",
      message: "Draft payroll must be regenerated after import",
    });
  }

  if (policy.isRestDay) {
    warnings.push({
      code: "rest_day",
      message: "Employee is working on a configured rest day",
    });
  }

  return {
    status: "ready",
    attendanceDate: [...attendanceDates][0] ?? toPKTDate(new Date()),
    isNightShift: candidateRows.some((candidate) => candidate.isNightShift),
    warnings,
    timeline,
    candidateRows,
  };
}

export function groupOfflineRows(
  rows: ClassifiedOfflineRow[],
): OfflineEmployeeDayGroup[] {
  const groups = new Map<string, OfflineEmployeeDayGroup>();

  for (const row of rows) {
    if (!row.employeeId || !row.attendanceDate) continue;

    const key = `${row.employeeId}:${row.attendanceDate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.rowCount += 1;
      existing.readyRowCount += row.status === "ready" ? 1 : 0;
      existing.isNightShift ||= row.isNightShift === true;
      existing.isRestDay ||= row.isRestDay === true;
      if (existing.status === "ready" && row.status !== "ready") {
        existing.status = row.status;
      }
      continue;
    }

    groups.set(key, {
      key,
      batchId: row.batchId ?? null,
      employeeId: row.employeeId,
      attendanceDate: row.attendanceDate,
      status: row.status,
      rowCount: 1,
      readyRowCount: row.status === "ready" ? 1 : 0,
      isNightShift: row.isNightShift === true,
      isRestDay: row.isRestDay === true,
      rows: [row],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => {
        const leftTime = left.normalizedTimestamp ?? "";
        const rightTime = right.normalizedTimestamp ?? "";
        if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
        return (left.worksheetRowNumber ?? 0) - (right.worksheetRowNumber ?? 0);
      }),
    }))
    .sort((left, right) => {
      const employeeDelta = left.employeeId.localeCompare(right.employeeId);
      if (employeeDelta !== 0) return employeeDelta;
      return left.attendanceDate.localeCompare(right.attendanceDate);
    });
}
