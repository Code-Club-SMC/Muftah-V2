import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	resolve(process.cwd(), "src/server-functions/sales/payment-settlement-fn.ts"),
	"utf8",
);
const reconciliationSource = readFileSync(
	resolve(process.cwd(), "src/server-functions/sales/reconciliation-fn.ts"),
	"utf8",
);
const paymentsSource = readFileSync(
	resolve(process.cwd(), "src/server-functions/sales/payments-fn.ts"),
	"utf8",
);

describe("payment settlement server functions", () => {
	it("uses exact finance permissions", () => {
		expect(source).toContain(
			".middleware([requirePaymentVerificationMiddleware])",
		);
		expect(source).toContain(".middleware([requirePaymentReversalMiddleware])");
	});

	it("routes every mutation through the settlement service", () => {
		expect(source).toContain("confirmPendingPayment(tx, {");
		expect(source).toContain("resolvePendingPayment(tx, {");
		expect(source).toContain("reverseConfirmedPayment(tx, {");
		expect(source).not.toContain(".update(wallets)");
		expect(source).not.toContain(".update(customers)");
		expect(source).not.toContain(".update(invoices)");
	});

	it("keeps method actions separate and validates reasons", () => {
		expect(source).toContain(
			'requirePaymentMethod(tx, data.paymentId, "bank_transfer")',
		);
		expect(source).toContain(
			'requirePaymentMethod(tx, data.paymentId, "cheque")',
		);
		expect(source).toContain("reason: z.string().trim().min(3).max(500)");
		expect(source).toContain('resolution: "returned"');
		expect(source).toContain('resolution: "cancelled"');
	});

	it("routes single, batch, and expense-offset recovery through settlement", () => {
		expect(reconciliationSource.match(/recordRecoveryPayment\(tx, \{/g)).toHaveLength(
			2,
		);
		expect(reconciliationSource).toContain("allocationGroupId");
		expect(reconciliationSource).not.toContain(".update(wallets)");
		expect(reconciliationSource).not.toContain(".update(customers)");
		expect(reconciliationSource).not.toContain(".update(invoices)");

		expect(paymentsSource).toContain("return recordRecoveryPayment(tx, {");
		expect(paymentsSource).toContain('method: "expense_offset"');
		expect(paymentsSource).toContain('source: "Expense Offset"');
		expect(paymentsSource).not.toContain(".update(customers)");
	});
});
