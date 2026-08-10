import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertSettlementDueDate, calculateSettlement } from "./math";
import { moneyString, roundMoney } from "./money";

describe("invoice settlement money", () => {
	it("rounds PKR values to two decimals using half-up rounding", () => {
		expect(roundMoney(1.005)).toBe(1.01);
		expect(roundMoney("499.999")).toBe(500);
		expect(moneyString("12.5")).toBe("12.50");
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	])("rejects non-finite money input %s", (value) => {
		expect(() => roundMoney(value)).toThrow("Money amount must be finite");
	});
});

describe("invoice settlement math", () => {
	it("keeps pending instruments inside Outstanding Amount", () => {
		expect(
			calculateSettlement(100_000, [
				{ amount: 50_000, status: "confirmed", method: "cash" },
				{ amount: 10_000, status: "pending", method: "cheque" },
			]),
		).toEqual({
			totalPrice: 100_000,
			paidAmount: 50_000,
			pendingAmount: 10_000,
			outstandingAmount: 50_000,
			payLaterAmount: 40_000,
			paymentStatus: "partially_paid",
		});
	});

	it("ignores returned, cancelled, and reversed payment rows", () => {
		expect(
			calculateSettlement(1_000, [
				{ amount: 100, status: "returned", method: "cheque" },
				{ amount: 200, status: "cancelled", method: "bank_transfer" },
				{ amount: 300, status: "reversed", method: "cash" },
			]),
		).toEqual({
			totalPrice: 1_000,
			paidAmount: 0,
			pendingAmount: 0,
			outstandingAmount: 1_000,
			payLaterAmount: 1_000,
			paymentStatus: "unpaid",
		});
	});

	it("counts a confirmed expense offset as settlement", () => {
		expect(
			calculateSettlement(500, [
				{ amount: 500, status: "confirmed", method: "expense_offset" },
			]).paymentStatus,
		).toBe("paid");
	});

	it("rejects confirmed plus pending allocation above invoice total", () => {
		expect(() =>
			calculateSettlement(100, [
				{ amount: 80, status: "confirmed", method: "cash" },
				{ amount: 30, status: "pending", method: "bank_transfer" },
			]),
		).toThrow("Payments cannot exceed invoice total");
	});

	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid payment amount %s", (amount) => {
		expect(() =>
			calculateSettlement(100, [
				{ amount, status: "confirmed", method: "cash" },
			]),
		).toThrow("Payment amount must be greater than zero");
	});

	it("rejects a negative or non-finite invoice total", () => {
		expect(() => calculateSettlement(-1, [])).toThrow(
			"Invoice total cannot be negative",
		);
		expect(() => calculateSettlement(-0.001, [])).toThrow(
			"Invoice total cannot be negative",
		);
		expect(() => calculateSettlement(Number.NaN, [])).toThrow(
			"Invoice total must be finite",
		);
	});

	it("requires Payment Due Date only for a true pay-later amount", () => {
		const fullyAllocatedToPending = calculateSettlement(100, [
			{ amount: 100, status: "pending", method: "cheque" },
		]);
		expect(() =>
			assertSettlementDueDate(fullyAllocatedToPending),
		).not.toThrow();

		const payLater = calculateSettlement(100, [
			{ amount: 25, status: "confirmed", method: "cash" },
		]);
		expect(() => assertSettlementDueDate(payLater)).toThrow(
			"Payment Due Date is required when an amount remains payable later",
		);
		expect(() =>
			assertSettlementDueDate(payLater, new Date("2026-08-10T00:00:00+05:00")),
		).not.toThrow();
		expect(() =>
			assertSettlementDueDate(payLater, new Date("invalid")),
		).toThrow("Payment Due Date is invalid");
	});

	it("always preserves Paid Amount plus Outstanding Amount", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 10_000_000 }),
				fc.integer({ min: 0, max: 10_000_000 }),
				(totalPaisa, paidCandidate) => {
					const paidPaisa = Math.min(totalPaisa, paidCandidate);
					const result = calculateSettlement(
						totalPaisa / 100,
						paidPaisa === 0
							? []
							: [
									{
										amount: paidPaisa / 100,
										status: "confirmed",
										method: "cash",
									},
								],
					);

					expect(roundMoney(result.paidAmount + result.outstandingAmount)).toBe(
						result.totalPrice,
					);
				},
			),
		);
	});
});
