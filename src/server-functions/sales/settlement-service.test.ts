import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	resolve(process.cwd(), "src/server-functions/sales/settlement-service.ts"),
	"utf8",
);

describe("central settlement service contract", () => {
	it("requires a caller-owned transaction and locks the invoice", () => {
		expect(source).toContain("FOR UPDATE");
		expect(source).not.toContain("db.transaction(");
	});

	it("uses conditional payment state transitions", () => {
		expect(source).toContain('eq(payments.status, "pending")');
		expect(source).toContain('eq(payments.status, "confirmed")');
		expect(source).toContain("Payment is no longer pending");
		expect(source).toContain("Payment is no longer confirmed");
	});

	it("keeps all cached totals behind one recalculation path", () => {
		expect(source).toContain("recalculateInvoiceSettlement");
		expect(source).toContain("customers.totalPaidAmount");
		expect(source).toContain("customers.outstandingAmount");
		expect(source).toContain("invoiceAmount: moneyString(totals.totalPrice)");
	});

	it("creates wallet movements only for confirmed payment transitions", () => {
		expect(source).toContain('source: "Customer Payment"');
		expect(source).toContain('source: "Customer Payment Reversal"');
		expect(source).toContain("reversalOfTransactionId");
		expect(source).toContain("effectiveDate");
	});
});
