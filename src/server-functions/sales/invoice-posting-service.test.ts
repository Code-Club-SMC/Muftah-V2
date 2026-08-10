import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSalesSource = (fileName: string) =>
	readFileSync(
		resolve(process.cwd(), "src/server-functions/sales", fileName),
		"utf8",
	);

describe("shared invoice posting contract", () => {
	const postingSource = readSalesSource("invoice-posting-service.ts");
	const invoiceFnSource = readSalesSource("invoices-fn.ts");
	const commissionSource = readSalesSource("order-booker-commission-calc.ts");
	const schemaSource = readFileSync(
		resolve(process.cwd(), "src/db/zod_schemas.ts"),
		"utf8",
	);

	it("keeps the online handler thin and transaction-owned", () => {
		expect(invoiceFnSource).toContain("db.transaction((tx) =>");
		expect(invoiceFnSource).toContain("postInvoice(tx, {");
		expect(invoiceFnSource).toContain('source: "online"');
		expect(invoiceFnSource).toContain('stockPolicy: "strict"');
		expect(invoiceFnSource).not.toContain(".insert(invoices)");
	});

	it("posts invoice number, stock, order, commission, and settlement together", () => {
		expect(postingSource).toContain("allocateOnlineInvoiceNumber(tx)");
		expect(postingSource).toContain(".insert(invoices)");
		expect(postingSource).toContain(".insert(invoiceItems)");
		expect(postingSource).toContain(".update(finishedGoodsStock)");
		expect(postingSource).toContain(".update(orders)");
		expect(postingSource).toContain("calculateCommissionForOrder(");
		expect(postingSource).toContain(".insert(slipRecords)");
		expect(postingSource).toContain("createInitialPayments(tx, {");
		expect(postingSource).toContain("recordInvoiceTimelineEvent(");
		expect(postingSource).toContain(".update(customers)");
	});

	it("recomputes totals and distributor pricing on the server", () => {
		expect(postingSource).toContain("const totalPayable = roundMoney(");
		expect(postingSource).toContain(
			"netInvoiceAmount + Number(data.expenses ?? 0)",
		);
		expect(postingSource).toContain("buildConfiguredRecipePriceMap({");
		expect(postingSource).toContain("preferConfiguredRate:");
		expect(postingSource).toContain(
			"!item.isPriceOverride && !item.preserveStoredDistributorRate",
		);
		expect(postingSource).toContain("calculateSettlement(");
		expect(postingSource).toContain("assertSettlementDueDate(");
	});

	it("allows offline posting only for an existing distributor", () => {
		expect(postingSource).toContain(
			'input.source === "offline_import" && !customerId',
		);
		expect(postingSource).toContain(
			'customerRecord?.customerType !== "distributor"',
		);
	});

	it("accepts payment rows instead of legacy cash and credit fields", () => {
		expect(schemaSource).toContain("invoicePaymentInputSchema");
		expect(schemaSource).toContain(
			"payments: z.array(invoicePaymentInputSchema).default([])",
		);
		expect(schemaSource).toContain(
			"paymentDueDate: z.coerce.date().optional()",
		);
		expect(schemaSource).not.toContain(
			'account: z.string().min(1, "Select Payment Account")',
		);
		expect(schemaSource).not.toContain(
			"cash: z.number().nonnegative().default(0)",
		);
		expect(schemaSource).not.toContain("creditReturnDate: z.date().optional()");
	});

	it("requires commission writes to use the caller transaction", () => {
		expect(commissionSource).toContain("tx: SalesTransaction");
		expect(commissionSource).not.toContain("tx || db");
		expect(commissionSource).not.toContain('import { db } from "@/db"');
	});
});
