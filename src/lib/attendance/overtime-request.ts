export type OvertimeRequestState =
  | "none"
  | "valid"
  | "soft_mismatch"
  | "stale";

export type OvertimeRequestSummary = {
  standardDutyHours: number;
  workedDutyHours: number;
  suggestedOvertimeHours: number;
  requestedOvertimeHours: number;
  state: OvertimeRequestState;
  warning: string | null;
};

export type OvertimeApprovalStatus = "pending" | "approved" | "rejected";

export type OvertimeRevalidationSummary = OvertimeRequestSummary & {
  currentOvertimeStatus: OvertimeApprovalStatus;
  nextOvertimeStatus: OvertimeApprovalStatus;
  shouldResetStatus: boolean;
};

const SOFT_MISMATCH_WARNING =
  "Punches changed. Current OT request is lower than the latest suggested OT. Update it if needed.";

const STALE_WARNING = "Requested OT cannot be more than the suggested OT.";

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeNonNegativeHours(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "string" && value.trim() === "") {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return roundHours(parsed);
}

export function calculateSuggestedOvertimeHours(
  dutyHours: string | number | null | undefined,
  standardDutyHours: number | null | undefined,
) {
  const workedDutyHours = normalizeNonNegativeHours(dutyHours);
  const normalizedStandardDutyHours =
    normalizeNonNegativeHours(standardDutyHours);

  return roundHours(
    Math.max(0, workedDutyHours - normalizedStandardDutyHours),
  );
}

export function normalizeRequestedOvertimeHours(
  overtimeHours: string | number | null | undefined,
) {
  return normalizeNonNegativeHours(overtimeHours);
}

export function buildOvertimeRequestSummary(args: {
  dutyHours: string | number | null | undefined;
  standardDutyHours: number | null | undefined;
  requestedOvertimeHours: string | number | null | undefined;
}): OvertimeRequestSummary {
  const standardDutyHours = normalizeNonNegativeHours(args.standardDutyHours);
  const workedDutyHours = normalizeNonNegativeHours(args.dutyHours);
  const suggestedOvertimeHours = calculateSuggestedOvertimeHours(
    workedDutyHours,
    standardDutyHours,
  );
  const requestedOvertimeHours = normalizeRequestedOvertimeHours(
    args.requestedOvertimeHours,
  );

  let state: OvertimeRequestState = "none";
  let warning: string | null = null;

  if (requestedOvertimeHours > suggestedOvertimeHours) {
    state = "stale";
    warning = STALE_WARNING;
  } else if (
    requestedOvertimeHours > 0 &&
    requestedOvertimeHours < suggestedOvertimeHours
  ) {
    state = "soft_mismatch";
    warning = SOFT_MISMATCH_WARNING;
  } else if (requestedOvertimeHours > 0) {
    state = "valid";
  }

  return {
    standardDutyHours,
    workedDutyHours,
    suggestedOvertimeHours,
    requestedOvertimeHours,
    state,
    warning,
  };
}

function normalizeOvertimeStatus(
  value: string | null | undefined,
): OvertimeApprovalStatus {
  if (value === "approved" || value === "rejected") {
    return value;
  }

  return "pending";
}

export function revalidateOvertimeRequest(args: {
  dutyHours: string | number | null | undefined;
  standardDutyHours: number | null | undefined;
  requestedOvertimeHours: string | number | null | undefined;
  currentOvertimeStatus: string | null | undefined;
}): OvertimeRevalidationSummary {
  const summary = buildOvertimeRequestSummary(args);
  const currentOvertimeStatus = normalizeOvertimeStatus(
    args.currentOvertimeStatus,
  );
  const shouldResetStatus =
    summary.requestedOvertimeHours > 0 && summary.state === "stale";

  return {
    ...summary,
    currentOvertimeStatus,
    nextOvertimeStatus: shouldResetStatus
      ? "pending"
      : currentOvertimeStatus,
    shouldResetStatus,
  };
}
