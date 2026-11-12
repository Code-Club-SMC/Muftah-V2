import Big from "big.js";
import { formatIndianStyle, formatPakistaniNumber } from "@/lib/currency-format";
import { roundMoney } from "../settlement/money";

// Client-safe rules for the sales return lifecycle. No database access here.

export const RETURN_STATUSES = ["requested", "approved", "completed", "rejected", "cancelled", "voided"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  voided: "Voided",
};

export function returnStatusLabel(status: string): string {
  return RETURN_STATUS_LABELS[status as ReturnStatus] ?? status;
}

export type ReturnTab = "to-approve" | "to-receive" | "done" | "all";
export const RETURN_TAB_STATUSES: Record<ReturnTab, ReturnStatus[]> = {
  "to-approve": ["requested"],
  "to-receive": ["approved"],
  done: ["completed", "rejected", "cancelled", "voided"],
  all: [...RETURN_STATUSES],
};

export type ReturnAction = "approve" | "reject" | "receive" | "cancel" | "void";
const ACTION_FROM: Record<ReturnAction, ReturnStatus> = {
  approve: "requested",
  reject: "requested",
  receive: "approved",
  cancel: "approved",
  void: "completed",
};
const ACTION_PAST: Record<ReturnAction, string> = {
  approve: "approved",
  reject: "rejected",
  receive: "received",
  cancel: "cancelled",
  void: "voided",
};

export function assertReturnAction(salesReturn: { status: string; returnNumber: number }, action: ReturnAction): void {
  if (salesReturn.status === ACTION_FROM[action]) return;
  throw new Error(
    `Return #${salesReturn.returnNumber} is ${returnStatusLabel(salesReturn.status).toLowerCase()}, so it can't be ${ACTION_PAST[action]}.`,
  );
}

export function availableReturnActions(status: string, can: { approve: boolean; receive: boolean }): ReturnAction[] {
  const actions: ReturnAction[] = [];
  if (status === "requested" && can.approve) actions.push("approve", "reject");
  if (status === "approved" && can.receive) actions.push("receive");
  if (status === "approved" && can.approve) actions.push("cancel");
  if (status === "completed" && can.approve) actions.push("void");
  return actions;
}

export const RETURN_CONDITIONS = ["good", "damaged", "expired"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export function unitsOf(cartons: number, loose: number, unitsPerCarton: number): number {
  return (cartons || 0) * unitsPerCarton + (loose || 0);
}

export function splitUnits(units: number, unitsPerCarton: number): { cartons: number; loose: number } {
  const size = Math.max(1, unitsPerCarton);
  return { cartons: Math.floor(units / size), loose: units % size };
}

export function formatUnits(units: number, unitsPerCarton: number): string {
  const packs = `${units} ${units === 1 ? "pack" : "packs"}`;
  if (unitsPerCarton <= 1 || units < unitsPerCarton) return packs;
  const { cartons, loose } = splitUnits(units, unitsPerCarton);
  return `${packs} (${cartons} ${cartons === 1 ? "carton" : "cartons"}${loose ? ` + ${loose} loose` : ""})`;
}

export type ReturnLineQuantities = {
  cartonsRequested: number;
  quantityRequested: number;
  goodUnits: number;
  damagedUnits: number;
  expiredUnits: number;
};

export function requestedUnits(item: Pick<ReturnLineQuantities, "cartonsRequested" | "quantityRequested">, unitsPerCarton: number): number {
  return unitsOf(item.cartonsRequested, item.quantityRequested, unitsPerCarton);
}

export function receivedUnits(item: Pick<ReturnLineQuantities, "goodUnits" | "damagedUnits" | "expiredUnits">): number {
  return (item.goodUnits || 0) + (item.damagedUnits || 0) + (item.expiredUnits || 0);
}

export function reservedReturnUnits(status: string, item: ReturnLineQuantities, unitsPerCarton: number): number {
  if (status === "requested" || status === "approved") return requestedUnits(item, unitsPerCarton);
  if (status === "completed") return receivedUnits(item);
  return 0;
}

export type InspectionLine = {
  label: string;
  approvedUnits: number;
  goodUnits: number;
  damagedUnits: number;
  expiredUnits: number;
};

/** Validates the inspection and returns the total received units. */
export function checkInspection(lines: InspectionLine[]): number {
  let total = 0;
  for (const line of lines) {
    for (const value of [line.goodUnits, line.damagedUnits, line.expiredUnits]) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${line.label}: quantities must be whole numbers, 0 or more.`);
      }
    }
    const received = receivedUnits(line);
    if (received > line.approvedUnits) {
      throw new Error(`${line.label}: ${received} received but only ${line.approvedUnits} were approved.`);
    }
    total += received;
  }
  if (total === 0) throw new Error("Nothing was received. Cancel the return instead.");
  return total;
}

export function shortUnits(line: InspectionLine): number {
  return Math.max(0, line.approvedUnits - receivedUnits(line));
}

export function conditionSummary(items: Array<Pick<ReturnLineQuantities, "goodUnits" | "damagedUnits" | "expiredUnits">>): string {
  const totals: Record<ReturnCondition, number> = { good: 0, damaged: 0, expired: 0 };
  for (const item of items) {
    totals.good += item.goodUnits || 0;
    totals.damaged += item.damagedUnits || 0;
    totals.expired += item.expiredUnits || 0;
  }
  return RETURN_CONDITIONS.filter((condition) => totals[condition] > 0).join(", ");
}

export const DEFAULT_RETURN_REASONS: ReadonlyArray<{ name: string; requiresNote: boolean }> = [
  { name: "Damaged in transit", requiresNote: false },
  { name: "Leaking / defective pack", requiresNote: false },
  { name: "Expired or near expiry", requiresNote: false },
  { name: "Wrong item delivered", requiresNote: false },
  { name: "Customer over-ordered", requiresNote: false },
  { name: "Other", requiresNote: true },
];

/** The reason text stored on the return (ledgers and search read this). */
export function returnReasonText(reason: { name: string; requiresNote: boolean }, note?: string | null): string {
  const trimmed = note?.trim() ?? "";
  if (reason.requiresNote && !trimmed) throw new Error(`Add a note for "${reason.name}".`);
  return trimmed ? `${reason.name}: ${trimmed}` : reason.name;
}

export type ReturnCostBasis = { costPerUnit: number; historicalTotalCost: string; dispatchedUnits: number };

/** The cost recorded when the goods left, used to value them when they come back. */
export function returnCostBasis(
  invoiceItem: {
    costOfGoodsSold: string | null;
    costOfGoodsSoldPerUnit: string | null;
    perCartonPrice: string | null;
    dispatchedUnits: number | string | null;
    numberOfCartons: number;
    quantity: number;
  },
  unitsPerCarton: number,
): ReturnCostBasis {
  const totalUnitsInvoiced = unitsOf(invoiceItem.numberOfCartons, invoiceItem.quantity, unitsPerCarton);
  const recordedUnitCost = Number(invoiceItem.costOfGoodsSoldPerUnit);
  const costPerUnit =
    invoiceItem.costOfGoodsSoldPerUnit != null && Number.isFinite(recordedUnitCost) && recordedUnitCost >= 0
      ? recordedUnitCost
      : Number(invoiceItem.perCartonPrice || 0) / unitsPerCarton;
  const dispatchedUnits = Number(invoiceItem.dispatchedUnits) > 0 ? Number(invoiceItem.dispatchedUnits) : totalUnitsInvoiced;
  const recordedTotalCost = Number(invoiceItem.costOfGoodsSold);
  const historicalTotalCost =
    invoiceItem.costOfGoodsSold != null && Number.isFinite(recordedTotalCost) && recordedTotalCost >= 0
      ? new Big(invoiceItem.costOfGoodsSold)
      : new Big(costPerUnit).times(dispatchedUnits);
  return { costPerUnit, historicalTotalCost: historicalTotalCost.toFixed(2), dispatchedUnits };
}

/** Allocates recorded cents cumulatively so split returns keep the residual. */
export function allocateReturnCost(basis: ReturnCostBasis, unitsBefore: number, units: number): string {
  const total = new Big(basis.historicalTotalCost);
  const before = total.times(unitsBefore).div(basis.dispatchedUnits).round(2);
  return total.times(unitsBefore + units).div(basis.dispatchedUnits).round(2).minus(before).toFixed(2);
}

export type ReturnMoneyEvent = { kind: "return" | "void"; date: Date; amount: number; cost: number };

export function returnMoneyEvents(row: {
  status: string;
  totalAmount: string | number;
  completedAt: Date | null;
  voidedAt: Date | null;
  stockTraces: Array<{ kind: string; totalCost: string | number }>;
}): ReturnMoneyEvent[] {
  if (!row.completedAt || (row.status !== "completed" && row.status !== "voided")) return [];
  const amount = Number(row.totalAmount);
  const costOf = (kind: string) =>
    row.stockTraces.filter((trace) => trace.kind === kind).reduce((sum, trace) => sum + Number(trace.totalCost), 0);
  const events: ReturnMoneyEvent[] = [{ kind: "return", date: row.completedAt, amount, cost: costOf("receive") }];
  if (row.status === "voided" && row.voidedAt) {
    // Void traces are stored negative; the reversal's cost is the value taken back out.
    events.push({ kind: "void", date: row.voidedAt, amount, cost: -costOf("void") });
  }
  return events;
}

export function formatCreditNoteNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("Credit note sequence must be a positive integer");
  }
  return `CN-${String(sequence).padStart(4, "0")}`;
}

export function computeReturnCreditSplit(
  returnTotal: number,
  preReturnOpenBalance: number,
): { appliedToInvoiceAmount: number; customerCreditAmount: number } {
  const total = roundMoney(Math.max(0, returnTotal));
  const open = roundMoney(Math.max(0, preReturnOpenBalance));
  const appliedToInvoiceAmount = roundMoney(Math.min(total, open));
  const customerCreditAmount = roundMoney(new Big(total).minus(appliedToInvoiceAmount).toNumber());
  return { appliedToInvoiceAmount, customerCreditAmount };
}

export const VOID_BLOCKED_BY_REFUND = "VOID_BLOCKED_BY_REFUND";

export function formatVoidBlockedByRefundError(params: {
  refundedAmount: number;
  customerId: string;
  customerName: string;
  customerType: string;
}): Error {
  const payload = JSON.stringify({
    code: VOID_BLOCKED_BY_REFUND,
    refundedAmount: roundMoney(params.refundedAmount),
    customerId: params.customerId,
    customerName: params.customerName,
    customerType: params.customerType,
  });
  return new Error(
    `${VOID_BLOCKED_BY_REFUND}:${payload}:Rs ${formatIndianStyle(roundMoney(params.refundedAmount))} of this return's credit was already refunded. Reverse the refund on ${params.customerName}'s page before voiding.`,
  );
}

export function parseVoidBlockedByRefundError(error: unknown): {
  refundedAmount: number;
  customerId: string;
  customerName: string;
  customerType: string;
  displayMessage: string;
} | null {
  if (!(error instanceof Error)) return null;
  const marker = `${VOID_BLOCKED_BY_REFUND}:`;
  const idx = error.message.indexOf(marker);
  if (idx === -1) return null;
  const rest = error.message.slice(idx + marker.length);
  const splitIdx = rest.indexOf("}:");
  if (splitIdx === -1) return null;
  try {
    const parsed = JSON.parse(rest.slice(0, splitIdx + 1));
    return {
      refundedAmount: Number(parsed.refundedAmount),
      customerId: String(parsed.customerId),
      customerName: String(parsed.customerName),
      customerType: String(parsed.customerType ?? "retailer"),
      displayMessage: rest.slice(splitIdx + 2),
    };
  } catch {
    return null;
  }
}
