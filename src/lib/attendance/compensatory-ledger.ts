import type { COMPENSATORY_LEDGER_REASONS } from "@/db/schemas/hr-schema";

export type CompensatoryLedgerReason = (typeof COMPENSATORY_LEDGER_REASONS)[number];
export type CompensatoryReservationKind = "comp_leave" | "bank_cover" | "cash_out";

/** A positive change returns hours to the bank; a negative one takes them out. */
export function reservationReason(
  kind: CompensatoryReservationKind,
  change: number,
): CompensatoryLedgerReason {
  const returned = change > 0;
  switch (kind) {
    case "comp_leave":
      return returned ? "comp_leave_released" : "comp_leave_reserved";
    case "bank_cover":
      return returned ? "bank_cover_removed" : "bank_cover_applied";
    case "cash_out":
      return returned ? "cash_out_cancelled" : "cash_out";
  }
}

export const COMPENSATORY_LEDGER_REASON_LABELS: Record<CompensatoryLedgerReason, string> = {
  opening_balance: "Opening balance",
  overtime_converted: "Overtime converted to comp off",
  comp_leave_reserved: "Used for comp-off leave",
  comp_leave_released: "Comp-off leave cancelled or rejected",
  bank_cover_applied: "Covered a short day",
  bank_cover_removed: "Short-day cover removed",
  cash_out: "Cashed out",
  cash_out_cancelled: "Cash-out cancelled",
  auto_refund: "Returned after punches changed",
  manual_adjustment: "Manual balance edit",
};
