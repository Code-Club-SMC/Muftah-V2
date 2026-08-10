import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	blankPayment,
	calculatePaymentBreakdown,
	findDuplicatePaymentRows,
	type PaymentInput,
} from "./payment-rows-field";

const PAYMENT_ROWS_SOURCE = resolve(
	process.cwd(),
	"src/components/sales/create-invoice-form/payment-rows-field.tsx",
);
const SETTLEMENT_SOURCE = resolve(
	process.cwd(),
	"src/components/sales/create-invoice-form/settlement-section.tsx",
);

function payment(
	method: PaymentInput["method"],
	amount: number,
	overrides: Partial<PaymentInput> = {},
): PaymentInput {
	return {
		...blankPayment(method),
		amount,
		walletId: method === "cash" ? "cash-wallet" : "bank-wallet",
		...overrides,
	};
}

describe("invoice payment rows", () => {
	it("calculates paid, pending, outstanding, and true pay-later amounts", () => {
		const result = calculatePaymentBreakdown(1_000, [
			payment("cash", 250),
			payment("bank_transfer", 300, { reference: "TRX-1" }),
			payment("cheque", 200, {
				chequeBank: "HBL",
				chequeNumber: "123",
				chequeDate: "2026-08-10",
			}),
		]);

		expect(result).toEqual({
			invoiceTotal: 1_000,
			paidAmount: 250,
			pendingAmount: 500,
			outstandingAmount: 750,
			payLaterAmount: 250,
			overAllocatedAmount: 0,
		});
	});

	it("uses lifecycle status when showing existing invoice payment history", () => {
		const result = calculatePaymentBreakdown(1_000, [
			payment("bank_transfer", 400, { status: "confirmed" }),
			payment("cheque", 200, { status: "returned" }),
			payment("cheque", 100, { status: "pending" }),
		]);

		expect(result.paidAmount).toBe(400);
		expect(result.pendingAmount).toBe(100);
		expect(result.outstandingAmount).toBe(600);
		expect(result.payLaterAmount).toBe(500);
	});

	it("finds duplicate instrument rows after normalizing text", () => {
		const rows = [
			payment("bank_transfer", 100, { reference: " TRX-9 " }),
			payment("bank_transfer", 100, { reference: "trx-9" }),
		];

		expect([...findDuplicatePaymentRows(rows)]).toEqual([0, 1]);
	});

	it("keeps method fields, wallet filtering, array controls, and read-only edit mode", () => {
		const source = readFileSync(PAYMENT_ROWS_SOURCE, "utf8");
		const settlement = readFileSync(SETTLEMENT_SOURCE, "utf8");

		expect(source).toContain('<SelectItem value="cash">Cash</SelectItem>');
		expect(source).toContain('value="bank_transfer"');
		expect(source).toContain('<SelectItem value="cheque">Cheque</SelectItem>');
		expect(source).toContain('payment.method === "cash" ? "cash" : "bank"');
		expect(source).toContain("field.pushValue(blankPayment())");
		expect(source).toContain("field.removeValue(index)");
		expect(source).toContain("disabled={readOnly}");
		expect(settlement).toContain('name="paymentDueDate"');
		expect(settlement).toContain("breakdown.payLaterAmount > 0");
		expect(settlement).toContain("Pending Verification");
		expect(settlement).toContain("Outstanding Amount");
	});
});
