export type CartonStatus =
  | "PARTIAL"
  | "COMPLETE"
  | "SEALED"
  | "DISPATCHED"
  | "ARCHIVED"
  | "RETIRED"
  | "ON_HOLD";

export type AdjustmentType =
  | "TOP_UP"
  | "REMOVAL"
  | "MANUAL_OVERRIDE"
  | "BULK_ADJUST"
  | "MERGE_IN"
  | "MERGE_OUT"
  | "REPACK"
  | "RETIRE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "DISPATCH_PARTIAL"
  | "DISPATCH_FULL"
  | "RETURN_GOOD"
  | "RETURN_DAMAGED"
  | "RECONCILIATION"
  | "INTEGRITY_CORRECTION"
  | "QC_HOLD_APPLIED"
  | "QC_HOLD_CLEARED"
  | "QC_HOLD_CONDEMNED"
  | "UNSEALED";

export type StockCountSessionStatus =
  | "OPEN"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED";

export type StockCountLineStatus =
  | "PENDING"
  | "WITHIN_TOLERANCE"
  | "FLAGGED"
  | "APPROVED"
  | "REJECTED";

export type IntegrityAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export type ReturnCondition = "GOOD" | "DAMAGED";

export type ProductionRunCloseStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export const CARTON_STATUSES = [
  "PARTIAL",
  "COMPLETE",
  "SEALED",
  "DISPATCHED",
  "ARCHIVED",
  "RETIRED",
  "ON_HOLD",
] as const;

export const ADJUSTMENT_TYPES = [
  "TOP_UP",
  "REMOVAL",
  "MANUAL_OVERRIDE",
  "BULK_ADJUST",
  "MERGE_IN",
  "MERGE_OUT",
  "REPACK",
  "RETIRE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "DISPATCH_PARTIAL",
  "DISPATCH_FULL",
  "RETURN_GOOD",
  "RETURN_DAMAGED",
  "RECONCILIATION",
  "INTEGRITY_CORRECTION",
  "QC_HOLD_APPLIED",
  "QC_HOLD_CLEARED",
  "QC_HOLD_CONDEMNED",
  "UNSEALED",
] as const;

export const REMOVAL_REASONS = ["QC_FAIL", "DAMAGED", "TRANSFER", "OTHER"] as const;
export const RETIRE_REASONS = ["LOST", "DESTROYED", "CONDEMNED", "OTHER"] as const;
export const HOLD_OUTCOMES = ["CLEARED", "CONDEMNED"] as const;
export const BULK_ADJUST_STRATEGIES = ["SKIP", "CAP"] as const;

export const TOLERANCE_PACKS = 2;
export const TOLERANCE_PCT = 5;
export const MIN_YIELD_THRESHOLD = 80;

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  TOP_UP: "Top-Up",
  REMOVAL: "Removal",
  MANUAL_OVERRIDE: "Override",
  BULK_ADJUST: "Bulk Adjust",
  MERGE_IN: "Merge In",
  MERGE_OUT: "Merge Out",
  REPACK: "Repack",
  RETIRE: "Retired",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  DISPATCH_PARTIAL: "Dispatch (Partial)",
  DISPATCH_FULL: "Dispatch (Full)",
  RETURN_GOOD: "Return — Good",
  RETURN_DAMAGED: "Return — Damaged",
  RECONCILIATION: "Stock Count",
  INTEGRITY_CORRECTION: "Integrity Fix",
  QC_HOLD_APPLIED: "QC Hold Applied",
  QC_HOLD_CLEARED: "QC Hold Cleared",
  QC_HOLD_CONDEMNED: "QC — Condemned",
  UNSEALED: "Unsealed",
};

export const CARTON_STATUS_LABELS: Record<CartonStatus, string> = {
  PARTIAL: "Partial",
  COMPLETE: "Complete",
  SEALED: "Sealed",
  DISPATCHED: "Dispatched",
  ARCHIVED: "Archived",
  RETIRED: "Retired",
  ON_HOLD: "QC Hold",
};