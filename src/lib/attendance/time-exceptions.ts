import type { ShiftViolation } from "./recompute";

export const TIME_EXCEPTION_KINDS = ["late", "early"] as const;
export type TimeExceptionKind = (typeof TIME_EXCEPTION_KINDS)[number];

export const TIME_EXCEPTION_STATUSES = [
  "grace",
  "pending",
  "approved_official",
  "approved_excused",
  "rejected",
] as const;
export type TimeExceptionStatus = (typeof TIME_EXCEPTION_STATUSES)[number];

/** Statuses a person can choose. Grace is only ever set by recompute. */
export const TIME_EXCEPTION_DECISIONS = [
  "pending",
  "approved_official",
  "approved_excused",
  "rejected",
] as const;
export type TimeExceptionDecision = (typeof TIME_EXCEPTION_DECISIONS)[number];

export const TIME_EXCEPTION_STATUS_LABELS: Record<TimeExceptionStatus, string> = {
  grace: "Grace",
  pending: "Pending",
  approved_official: "Company work",
  approved_excused: "Excused",
  rejected: "Rejected",
};

export type TimeExceptionHistoryEntry = {
  status: TimeExceptionStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string;
};

export type DesiredTimeException = {
  shiftIndex: number;
  kind: TimeExceptionKind;
  minutes: number;
  withinGrace: boolean;
};

export function buildDesiredTimeExceptions(violations: ShiftViolation[]): DesiredTimeException[] {
  const items: DesiredTimeException[] = [];
  for (const v of violations) {
    if (v.lateMinutes != null && v.lateMinutes > 0) {
      items.push({ shiftIndex: v.shiftIndex, kind: "late", minutes: v.lateMinutes, withinGrace: !v.late });
    }
    if (v.earlyMinutes != null && v.earlyMinutes > 0) {
      items.push({ shiftIndex: v.shiftIndex, kind: "early", minutes: v.earlyMinutes, withinGrace: !v.earlyDeparture });
    }
  }
  return items;
}

export type ExistingTimeException = {
  id: string;
  shiftIndex: number;
  kind: TimeExceptionKind;
  minutes: number;
  status: TimeExceptionStatus;
};

const itemKey = (item: { shiftIndex: number; kind: TimeExceptionKind }) => `${item.shiftIndex}:${item.kind}`;

export function reconcileTimeExceptions(existing: ExistingTimeException[], desired: DesiredTimeException[]) {
  const byKey = new Map(existing.map((item) => [itemKey(item), item]));
  const inserts: Array<{ shiftIndex: number; kind: TimeExceptionKind; minutes: number; status: TimeExceptionStatus }> = [];
  const updates: Array<{ id: string; minutes: number; status: TimeExceptionStatus; statusChanged: boolean }> = [];
  const kept = new Set<string>();

  for (const item of desired) {
    const current = byKey.get(itemKey(item));
    if (!current) {
      inserts.push({
        shiftIndex: item.shiftIndex,
        kind: item.kind,
        minutes: item.minutes,
        status: item.withinGrace ? "grace" : "pending",
      });
      continue;
    }
    kept.add(current.id);
    // A decision survives punch corrections; only crossing the grace line resets it.
    const status: TimeExceptionStatus = item.withinGrace
      ? "grace"
      : current.status === "grace"
        ? "pending"
        : current.status;
    if (status !== current.status || item.minutes !== current.minutes) {
      updates.push({ id: current.id, minutes: item.minutes, status, statusChanged: status !== current.status });
    }
  }

  const deleteIds = existing.filter((item) => !kept.has(item.id)).map((item) => item.id);
  return { inserts, updates, deleteIds };
}

export type PayrollTimeException = {
  kind: TimeExceptionKind;
  minutes: number;
  status: TimeExceptionStatus;
  decidedByName?: string | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
// Minutes are whole and duty hours have two decimals, so up to ~1 minute of dust is not a real shortfall.
const DUST_HOURS = 0.02;

export function splitShortHoursByTimeExceptions(shortHours: number, items: PayrollTimeException[]) {
  const sumHours = (filter: (item: PayrollTimeException) => boolean) =>
    items.filter(filter).reduce((total, item) => total + item.minutes, 0) / 60;

  const forgiven = sumHours((item) => item.status !== "rejected");
  const rejectedLate = sumHours((item) => item.kind === "late" && item.status === "rejected");
  const rejectedEarly = sumHours((item) => item.kind === "early" && item.status === "rejected");

  let remaining = Math.max(0, round2(shortHours - forgiven));
  const lateHours = round2(Math.min(remaining, rejectedLate));
  remaining = round2(remaining - lateHours);
  const earlyHours = round2(Math.min(remaining, rejectedEarly));
  remaining = round2(remaining - earlyHours);

  return { lateHours, earlyHours, undertimeHours: remaining < DUST_HOURS ? 0 : remaining };
}

export function formatExceptionMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function describeTimeException(item: PayrollTimeException): string {
  const label = `${item.kind === "late" ? "Late arrival" : "Early departure"} ${formatExceptionMinutes(item.minutes)}`;
  const by = item.decidedByName ? ` by ${item.decidedByName}` : "";
  switch (item.status) {
    case "grace":
      return `${label} — grace applied — no deduction`;
    case "pending":
      return `${label} — Not reviewed — no deduction`;
    case "approved_official":
      return `${label} — Approved (company work)${by} — no deduction`;
    case "approved_excused":
      return `${label} — Approved (excused)${by} — no deduction`;
    case "rejected":
      return `${label} — Rejected${by}`;
  }
}

export function validateTimeExceptionDecision(input: {
  currentStatus: TimeExceptionStatus;
  nextStatus: TimeExceptionDecision;
  note?: string | null;
}) {
  if (input.currentStatus === "grace") {
    throw new Error("Grace items need no decision.");
  }
  if (input.nextStatus === "approved_official" && !input.note?.trim()) {
    throw new Error("A note is required when approving as company work.");
  }
}
