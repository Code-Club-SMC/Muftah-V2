import Big from "big.js";
import { describe, expect, it } from "vitest";
import {
  QUEUE_STATUSES,
  formatDebitNoteNumber,
  formatSupplierReturnNumber,
  maxReturnable,
  planLeftover,
  purchaseOwed,
  splitDebitNote,
  supplierReturnValue,
} from "./supplier-returns";

describe("supplier return numbers", () => {
  it("pads to four digits", () => {
    expect(formatSupplierReturnNumber(3)).toBe("SR-0003");
    expect(formatDebitNoteNumber(12)).toBe("DN-0012");
    expect(formatDebitNoteNumber(12345)).toBe("DN-12345");
  });
  it("refuses zero or fractions", () => {
    expect(() => formatDebitNoteNumber(0)).toThrow();
    expect(() => formatSupplierReturnNumber(1.5)).toThrow();
  });
});

describe("purchaseOwed", () => {
  it("is cost less paid less returned", () => {
    expect(purchaseOwed({ cost: "50000", paidAmount: "20000", returnedAmount: "5000" }).toFixed(2)).toBe("25000.00");
  });
  it("treats missing returned as zero and never goes below zero", () => {
    expect(purchaseOwed({ cost: "100", paidAmount: "40" }).toFixed(2)).toBe("60.00");
    expect(purchaseOwed({ cost: "100", paidAmount: "100", returnedAmount: "5" }).toFixed(2)).toBe("0.00");
  });
});

describe("supplierReturnValue", () => {
  it("is quantity times unit cost, rounded half-up to paisa", () => {
    expect(supplierReturnValue("10", "500")).toBe("5000.00");
    expect(supplierReturnValue("0.333", "10.05")).toBe("3.35");
  });
});

describe("maxReturnable", () => {
  it("is the smaller of stock left and store stock, less waiting requests", () => {
    expect(maxReturnable({ stockLeft: "30", storeStock: "45", pendingRequested: "10" })).toBe("20.000");
    expect(maxReturnable({ stockLeft: "30", storeStock: "12.5", pendingRequested: "0" })).toBe("12.500");
  });
  it("never goes below zero", () => {
    expect(maxReturnable({ stockLeft: "5", storeStock: "5", pendingRequested: "8" })).toBe("0.000");
  });
});

describe("splitDebitNote", () => {
  it("clears what is owed first", () => {
    expect(splitDebitNote({ value: "5000", owed: "45000" })).toEqual({ applied: "5000.00", leftover: "0.00" });
  });
  it("leaves the rest over when the purchase is paid", () => {
    expect(splitDebitNote({ value: "5000", owed: "1500" })).toEqual({ applied: "1500.00", leftover: "3500.00" });
    expect(splitDebitNote({ value: "5000", owed: new Big(0) })).toEqual({ applied: "0.00", leftover: "5000.00" });
  });
});

describe("planLeftover", () => {
  it("defaults to all credit", () => {
    expect(planLeftover({ leftover: "5000" })).toEqual({ refund: "0.00", credit: "5000.00" });
  });
  it("splits cash back and credit", () => {
    expect(planLeftover({ leftover: "5000", cashBack: "2000" })).toEqual({ refund: "2000.00", credit: "3000.00" });
  });
  it("refuses more cash than the leftover, or bad numbers", () => {
    expect(() => planLeftover({ leftover: "5000", cashBack: "5000.01" })).toThrow("Cash back can't be more than Rs 5,000");
    expect(() => planLeftover({ leftover: "5000", cashBack: "12.345" })).toThrow("at most 2 decimals");
    expect(() => planLeftover({ leftover: "0", cashBack: "1" })).toThrow();
  });
});

describe("queues", () => {
  it("maps statuses to the three chips", () => {
    expect(QUEUE_STATUSES.to_dispatch).toEqual(["requested"]);
    expect(QUEUE_STATUSES.dispatched).toEqual(["dispatched"]);
    expect(QUEUE_STATUSES.done).toEqual(["completed", "cancelled", "voided"]);
  });
});
