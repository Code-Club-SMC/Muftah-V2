import { describe, expect, it } from "vitest";
import {
  allocateReturnCost,
  assertReturnAction,
  availableReturnActions,
  checkInspection,
  computeReturnCreditSplit,
  conditionSummary,
  DEFAULT_RETURN_REASONS,
  formatCreditNoteNumber,
  formatUnits,
  receivedUnits,
  requestedUnits,
  reservedReturnUnits,
  RETURN_TAB_STATUSES,
  returnCostBasis,
  returnMoneyEvents,
  returnReasonText,
  returnStatusLabel,
  shortUnits,
  splitUnits,
  unitsOf,
} from "./return-lifecycle";

const line = { cartonsRequested: 2, quantityRequested: 3, goodUnits: 0, damagedUnits: 0, expiredUnits: 0 };

describe("return lifecycle rules", () => {
  it("names statuses and groups them into work-queue tabs", () => {
    expect(returnStatusLabel("requested")).toBe("Requested");
    expect(returnStatusLabel("voided")).toBe("Voided");
    expect(RETURN_TAB_STATUSES["to-approve"]).toEqual(["requested"]);
    expect(RETURN_TAB_STATUSES["to-receive"]).toEqual(["approved"]);
    expect(RETURN_TAB_STATUSES.done).toEqual(["completed", "rejected", "cancelled", "voided"]);
    expect(RETURN_TAB_STATUSES.all).toHaveLength(6);
  });

  it("allows each action only from its own status", () => {
    expect(() => assertReturnAction({ status: "requested", returnNumber: 4 }, "approve")).not.toThrow();
    expect(() => assertReturnAction({ status: "approved", returnNumber: 4 }, "receive")).not.toThrow();
    expect(() => assertReturnAction({ status: "approved", returnNumber: 4 }, "cancel")).not.toThrow();
    expect(() => assertReturnAction({ status: "completed", returnNumber: 4 }, "void")).not.toThrow();
    expect(() => assertReturnAction({ status: "completed", returnNumber: 12 }, "receive"))
      .toThrow("Return #12 is completed, so it can't be received.");
    expect(() => assertReturnAction({ status: "requested", returnNumber: 3 }, "cancel"))
      .toThrow("Return #3 is requested, so it can't be cancelled.");
    expect(() => assertReturnAction({ status: "approved", returnNumber: 3 }, "approve"))
      .toThrow("Return #3 is approved, so it can't be approved.");
  });

  it("offers only the next steps the user has rights for", () => {
    const both = { approve: true, receive: true };
    expect(availableReturnActions("requested", both)).toEqual(["approve", "reject"]);
    expect(availableReturnActions("approved", both)).toEqual(["receive", "cancel"]);
    expect(availableReturnActions("approved", { approve: false, receive: true })).toEqual(["receive"]);
    expect(availableReturnActions("completed", both)).toEqual(["void"]);
    expect(availableReturnActions("completed", { approve: false, receive: true })).toEqual([]);
    expect(availableReturnActions("voided", both)).toEqual([]);
  });

  it("converts between cartons and packs", () => {
    expect(unitsOf(2, 3, 4)).toBe(11);
    expect(splitUnits(11, 4)).toEqual({ cartons: 2, loose: 3 });
    expect(splitUnits(5, 1)).toEqual({ cartons: 5, loose: 0 });
    expect(splitUnits(5, 0)).toEqual({ cartons: 5, loose: 0 });
    expect(formatUnits(11, 4)).toBe("11 packs (2 cartons + 3 loose)");
    expect(formatUnits(8, 4)).toBe("8 packs (2 cartons)");
    expect(formatUnits(3, 4)).toBe("3 packs");
    expect(formatUnits(1, 1)).toBe("1 pack");
  });

  it("reserves requested units while open and only received units once completed", () => {
    expect(requestedUnits(line, 4)).toBe(11);
    const received = { ...line, goodUnits: 6, damagedUnits: 2, expiredUnits: 1 };
    expect(receivedUnits(received)).toBe(9);
    expect(reservedReturnUnits("requested", line, 4)).toBe(11);
    expect(reservedReturnUnits("approved", line, 4)).toBe(11);
    expect(reservedReturnUnits("completed", received, 4)).toBe(9);
    for (const status of ["rejected", "cancelled", "voided"]) {
      expect(reservedReturnUnits(status, received, 4)).toBe(0);
    }
  });

  it("checks inspected quantities and reports shortfalls", () => {
    const ok = { label: "Mango 1L", approvedUnits: 10, goodUnits: 6, damagedUnits: 1, expiredUnits: 0 };
    expect(checkInspection([ok])).toBe(7);
    expect(shortUnits(ok)).toBe(3);
    expect(() => checkInspection([{ ...ok, goodUnits: 10 }]))
      .toThrow("Mango 1L: 11 received but only 10 were approved.");
    expect(() => checkInspection([{ ...ok, goodUnits: -1 }]))
      .toThrow("Mango 1L: quantities must be whole numbers, 0 or more.");
    expect(() => checkInspection([{ ...ok, goodUnits: 1.5 }]))
      .toThrow("Mango 1L: quantities must be whole numbers, 0 or more.");
    expect(() => checkInspection([{ ...ok, goodUnits: 0, damagedUnits: 0 }]))
      .toThrow("Nothing was received. Cancel the return instead.");
  });

  it("summarises line conditions for ledgers", () => {
    expect(conditionSummary([{ goodUnits: 4, damagedUnits: 0, expiredUnits: 0 }])).toBe("good");
    expect(conditionSummary([
      { goodUnits: 4, damagedUnits: 1, expiredUnits: 0 },
      { goodUnits: 0, damagedUnits: 0, expiredUnits: 2 },
    ])).toBe("good, damaged, expired");
    expect(conditionSummary([])).toBe("");
  });

  it("seeds the six reason codes and builds the stored reason text", () => {
    expect(DEFAULT_RETURN_REASONS.map((reason) => reason.name)).toEqual([
      "Damaged in transit",
      "Leaking / defective pack",
      "Expired or near expiry",
      "Wrong item delivered",
      "Customer over-ordered",
      "Other",
    ]);
    expect(DEFAULT_RETURN_REASONS.filter((reason) => reason.requiresNote).map((reason) => reason.name)).toEqual(["Other"]);
    expect(returnReasonText({ name: "Damaged in transit", requiresNote: false })).toBe("Damaged in transit");
    expect(returnReasonText({ name: "Damaged in transit", requiresNote: false }, "  box crushed ")).toBe("Damaged in transit: box crushed");
    expect(returnReasonText({ name: "Other", requiresNote: true }, "Changed brand")).toBe("Other: Changed brand");
    expect(() => returnReasonText({ name: "Other", requiresNote: true }, "  ")).toThrow('Add a note for "Other".');
  });

  it("uses the recorded invoice cost and allocates it without losing cents", () => {
    const item = {
      costOfGoodsSold: "1.00", costOfGoodsSoldPerUnit: "0.3333", perCartonPrice: "40",
      dispatchedUnits: 3, numberOfCartons: 0, quantity: 3,
    };
    const basis = returnCostBasis(item, 1);
    expect(basis).toEqual({ costPerUnit: 0.3333, historicalTotalCost: "1.00", dispatchedUnits: 3 });
    expect([allocateReturnCost(basis, 0, 1), allocateReturnCost(basis, 1, 1), allocateReturnCost(basis, 2, 1)])
      .toEqual(["0.33", "0.34", "0.33"]);
    const noCost = returnCostBasis({ ...item, costOfGoodsSold: null, costOfGoodsSoldPerUnit: null, dispatchedUnits: 0 }, 4);
    expect(noCost).toEqual({ costPerUnit: 10, historicalTotalCost: "30.00", dispatchedUnits: 3 });
  });

  it("dates a return on completion and its reversal on the void date", () => {
    const completedAt = new Date("2026-10-05T10:00:00Z");
    const voidedAt = new Date("2026-11-02T09:00:00Z");
    const traces = [
      { kind: "receive", totalCost: "30.00" },
      { kind: "void", totalCost: "-28.50" },
    ];
    expect(returnMoneyEvents({ status: "approved", totalAmount: "100.00", completedAt: null, voidedAt: null, stockTraces: [] })).toEqual([]);
    expect(returnMoneyEvents({ status: "completed", totalAmount: "100.00", completedAt, voidedAt: null, stockTraces: traces.slice(0, 1) }))
      .toEqual([{ kind: "return", date: completedAt, amount: 100, cost: 30 }]);
    expect(returnMoneyEvents({ status: "voided", totalAmount: "100.00", completedAt, voidedAt, stockTraces: traces })).toEqual([
      { kind: "return", date: completedAt, amount: 100, cost: 30 },
      { kind: "void", date: voidedAt, amount: 100, cost: 28.5 },
    ]);
  });
});

describe("credit note formatting and split allocation", () => {
  it("formats CN-XXXX padded to 4 digits and expands past 9999 without truncation", () => {
    expect(formatCreditNoteNumber(1)).toBe("CN-0001");
    expect(formatCreditNoteNumber(42)).toBe("CN-0042");
    expect(formatCreditNoteNumber(10000)).toBe("CN-10000");
  });

  it("splits return amount between open invoice balance and customer store credit without negatives", () => {
    expect(computeReturnCreditSplit(3000, 5000)).toEqual({
      appliedToInvoiceAmount: 3000,
      customerCreditAmount: 0,
    });
    expect(computeReturnCreditSplit(4500, 3000)).toEqual({
      appliedToInvoiceAmount: 3000,
      customerCreditAmount: 1500,
    });
    expect(computeReturnCreditSplit(2000, 0)).toEqual({
      appliedToInvoiceAmount: 0,
      customerCreditAmount: 2000,
    });
    expect(computeReturnCreditSplit(1000.05, 333.33)).toEqual({
      appliedToInvoiceAmount: 333.33,
      customerCreditAmount: 666.72,
    });
  });
});
