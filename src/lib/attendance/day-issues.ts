import { calculateTotalShiftHours } from "./time";
import {
  formatExceptionMinutes,
  splitShortHoursByTimeExceptions,
  TIME_EXCEPTION_STATUS_LABELS,
  type TimeExceptionKind,
  type TimeExceptionStatus,
} from "./time-exceptions";

export type DayIssueKind =
  | "no_punches"
  | "missing_checkout"
  | "missing_checkin"
  | "late"
  | "early_departure"
  | "undertime"
  | "bank_cover"
  | "overtime_pending"
  | "overtime_approved"
  | "overtime_rejected"
  | "rest_day_work"
  | "holiday_punches"
  | "leave_punches"
  | "leave_pending"
  | "unpaid_leave"
  | "comp_off_short"
  | "absent"
  | "payroll_locked"
  | "not_employed";

/** action = HR must decide; deduction = costs the employee pay; info = nothing to do */
export type DayIssueSeverity = "action" | "deduction" | "info";

export type DayIssue = {
  kind: DayIssueKind;
  severity: DayIssueSeverity;
  label: string;
};

export const dayIssueLabels: Record<DayIssueKind, string> = {
  no_punches: "No punches on workday",
  missing_checkout: "Missing checkout",
  missing_checkin: "Missing check-in",
  late: "Late",
  early_departure: "Early departure",
  undertime: "Undertime",
  bank_cover: "Covered from bank",
  overtime_pending: "Overtime pending",
  overtime_approved: "Overtime approved",
  overtime_rejected: "Overtime rejected",
  rest_day_work: "Worked rest day",
  holiday_punches: "Punched on holiday",
  leave_punches: "Punched on leave day",
  leave_pending: "Leave pending",
  unpaid_leave: "Unpaid leave",
  comp_off_short: "Comp-off short",
  absent: "Absent",
  payroll_locked: "Payroll locked",
  not_employed: "Not employed",
};

export type DayIssueRecord = {
  status: string;
  checkIn?: string | null;
  checkOut?: string | null;
  dutyHours?: string | null;
  overtimeHours?: string | null;
  overtimeStatus?: string | null;
  overtimeCompensationMethod?: string | null;
  isLate?: boolean | null;
  earlyDepartureStatus?: string | null;
  leaveType?: string | null;
  leaveApprovalStatus?: string | null;
  isApprovedLeave?: boolean | null;
  compensatoryHoursUsed?: string | null;
  timeExceptions?: Array<{
    kind: TimeExceptionKind;
    minutes: number;
    status: TimeExceptionStatus;
  }> | null;
};

export type DayIssuePunch = { direction: "in" | "out" };

export type DayIssueEmployee = {
  joiningDate: string;
  restDays?: number[] | null;
  shifts?: { start: string; end: string }[] | null;
  standardDutyHours?: number | null;
};

export type DayIssueInput = {
  date: string;
  today: string;
  employee: DayIssueEmployee;
  record?: DayIssueRecord | null;
  punches: DayIssuePunch[];
  lockedPayroll: boolean;
};

export function standardHoursFor(employee: DayIssueEmployee) {
  const shiftHours = calculateTotalShiftHours(employee.shifts);
  return shiftHours > 0 ? shiftHours : employee.standardDutyHours || 8;
}

export function isRestDate(date: string, restDays?: number[] | null) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (restDays ?? [0]).includes(weekday);
}

function toMinutes(value?: string | null) {
  const match = value ? /^(\d{1,2}):(\d{2})/.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** Minutes between a scheduled time and an actual time; null when they don't form a same-day pair. */
function minutesBetween(from?: string | null, to?: string | null) {
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

export function getDayIssues(input: DayIssueInput): DayIssue[] {
  const { date, today, employee, record, punches } = input;
  const issues: DayIssue[] = [];
  const add = (
    kind: DayIssueKind,
    severity: DayIssueSeverity,
    detail?: string,
  ) =>
    issues.push({
      kind,
      severity,
      label: detail
        ? `${dayIssueLabels[kind]} ${detail}`
        : dayIssueLabels[kind],
    });

  if (date < employee.joiningDate) {
    add("not_employed", "info");
    return issues;
  }
  if (input.lockedPayroll) add("payroll_locked", "info");
  if (date > today) return issues;

  const restDay = isRestDate(date, employee.restDays);
  const standard = standardHoursFor(employee);
  const status = record?.status;

  if (!record) {
    if (!punches.length && !restDay && date < today) add("no_punches", "action");
    return issues;
  }

  if (status === "absent") add("absent", "deduction", "(full day)");
  if (status === "holiday" && punches.length) add("holiday_punches", "action");

  if (status === "leave") {
    if (punches.length) add("leave_punches", "action");
    if (record.leaveApprovalStatus === "pending") add("leave_pending", "action");
    if (
      record.leaveApprovalStatus === "rejected" ||
      (record.leaveApprovalStatus === "approved" &&
        !record.isApprovedLeave &&
        record.leaveType !== "compensatory")
    )
      add("unpaid_leave", "deduction");
    if (
      record.leaveType === "compensatory" &&
      record.leaveApprovalStatus === "approved"
    ) {
      const short =
        standard - Number(record.compensatoryHoursUsed || "0");
      if (short > 0.009)
        add("comp_off_short", "deduction", `(${formatHours(short)} uncovered)`);
    }
  }

  if (status === "present") {
    // A present row without punches is an HR decision, so only punch days are checked.
    if (punches.length) {
      if (punches[0].direction === "out") add("missing_checkin", "action");
      if (punches.at(-1)!.direction === "in" && date < today)
        add("missing_checkout", "action");
    }

    if (restDay && (punches.length || Number(record.dutyHours || "0") > 0))
      add("rest_day_work", "action");

    const timeExceptions = record.timeExceptions ?? [];
    if (timeExceptions.length) {
      // Only rejected items cost pay; pending ones wait for HR.
      for (const item of timeExceptions) {
        const severity: DayIssueSeverity =
          item.status === "pending"
            ? "action"
            : item.status === "rejected"
              ? "deduction"
              : "info";
        add(
          item.kind === "late" ? "late" : "early_departure",
          severity,
          `(${formatExceptionMinutes(item.minutes)} · ${TIME_EXCEPTION_STATUS_LABELS[item.status]})`,
        );
      }
    } else {
      const shift = employee.shifts?.[0];
      if (record.isLate) {
        const late = minutesBetween(shift?.start, record.checkIn);
        add("late", "deduction", late ? `(${late}m)` : undefined);
      }
      if (record.earlyDepartureStatus && record.earlyDepartureStatus !== "none") {
        const lastShift = employee.shifts?.at(-1);
        const early = minutesBetween(record.checkOut, lastShift?.end);
        const detail = [
          early ? `${formatHours(early / 60)}` : null,
          record.earlyDepartureStatus,
        ]
          .filter(Boolean)
          .join(", ");
        add(
          "early_departure",
          record.earlyDepartureStatus === "pending" ? "action" : "info",
          `(${detail})`,
        );
      }
    }

    const cover = Number(record.compensatoryHoursUsed || "0");
    const duty = Number(record.dutyHours || "0") + cover;
    if (cover > 0) add("bank_cover", "info", `(${formatHours(cover)})`);
    // Short hours on an incomplete or still-open day are not real undertime yet.
    const incomplete =
      punches.at(-1)?.direction === "in" ||
      issues.some((issue) => issue.kind === "missing_checkin");
    // With items, late/early minutes have their own badges, so undertime is only the rest (same split as payroll).
    const undertime =
      timeExceptions.length && duty < standard
        ? splitShortHoursByTimeExceptions(standard - duty, timeExceptions).undertimeHours
        : standard - duty;
    if (!restDay && !incomplete && undertime > 0.009)
      add("undertime", "deduction", `(${formatHours(undertime)})`);
    // Late only costs pay when the day ends up short; otherwise it is a record.
    const late = issues.find((issue) => issue.kind === "late");
    if (!timeExceptions.length && late && !issues.some((issue) => issue.kind === "undertime"))
      late.severity = "info";
  }

  const overtime = Number(record.overtimeHours || "0");
  if (overtime > 0) {
    const hours = `(${formatHours(overtime)}${
      record.overtimeCompensationMethod === "comp_off" ? ", comp-off" : ""
    })`;
    if (record.overtimeStatus === "approved")
      add("overtime_approved", "info", hours);
    else if (record.overtimeStatus === "rejected")
      add("overtime_rejected", "info", hours);
    else add("overtime_pending", "action", hours);
  }

  return issues;
}
