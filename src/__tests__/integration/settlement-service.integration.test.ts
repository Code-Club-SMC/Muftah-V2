import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasTestDatabase)("invoice settlement service", () => {
	let db: typeof import("@/db")["db"];
	let schema: typeof import("@/db");
	let service: typeof import("@/server-functions/sales/settlement-service");

	const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const userId = `settlement-user-${runId}`;
	const warehouseId = `settlement-warehouse-${runId}`;
	const customerId = `settlement-customer-${runId}`;
	const invoiceId = `settlement-invoice-${runId}`;
	const slipId = `settlement-slip-${runId}`;
	const cashWalletId = `settlement-cash-${runId}`;
	const bankWalletId = `settlement-bank-${runId}`;
	const invoiceNumber = `TEST-SETTLEMENT-${runId}`;
	const dueDate = new Date("2026-09-10T00:00:00+05:00");

	async function cleanFixture(): Promise<void> {
		const paymentRows = await db.query.payments.findMany({
			where: eq(schema.payments.invoiceId, invoiceId),
			columns: { id: true },
		});
		const paymentIds = paymentRows.map((payment) => payment.id);

		await db
			.delete(schema.invoiceTimelineEvents)
			.where(eq(schema.invoiceTimelineEvents.invoiceId, invoiceId));
		if (paymentIds.length > 0) {
			await db
				.delete(schema.transactions)
				.where(
					and(
						inArray(schema.transactions.referenceId, paymentIds),
						eq(schema.transactions.source, "Customer Payment Reversal"),
					),
				);
			await db
				.delete(schema.transactions)
				.where(inArray(schema.transactions.referenceId, paymentIds));
		}
		await db
			.delete(schema.payments)
			.where(eq(schema.payments.invoiceId, invoiceId));
		await db
			.delete(schema.slipRecords)
			.where(eq(schema.slipRecords.id, slipId));
		await db.delete(schema.invoices).where(eq(schema.invoices.id, invoiceId));
		await db
			.delete(schema.customers)
			.where(eq(schema.customers.id, customerId));
		await db
			.delete(schema.wallets)
			.where(inArray(schema.wallets.id, [cashWalletId, bankWalletId]));
		await db
			.delete(schema.warehouses)
			.where(eq(schema.warehouses.id, warehouseId));
		await db.delete(schema.user).where(eq(schema.user.id, userId));
	}

	beforeAll(async () => {
		schema = await import("@/db");
		db = schema.db;
		service = await import("@/server-functions/sales/settlement-service");

		await cleanFixture();
		await db.insert(schema.user).values({
			id: userId,
			name: "Settlement Test User",
			email: `${userId}@example.test`,
		});
		await db.insert(schema.warehouses).values({
			id: warehouseId,
			name: "Settlement Test Warehouse",
			address: "Test address",
			city: "Lahore",
			state: "Punjab",
			latitude: "31.52040000",
			longitude: "74.35870000",
		});
		await db.insert(schema.customers).values({
			id: customerId,
			name: "Settlement Test Customer",
			totalSale: "100.00",
			totalPaidAmount: "0.00",
			outstandingAmount: "100.00",
		});
		await db.insert(schema.wallets).values([
			{
				id: cashWalletId,
				name: "Settlement Test Cash",
				type: "cash",
				balance: "0.00",
			},
			{
				id: bankWalletId,
				name: "Settlement Test Bank",
				type: "bank",
				balance: "0.00",
			},
		]);
		await db.insert(schema.invoices).values({
			id: invoiceId,
			customerId,
			invoiceNumber,
			amount: "100.00",
			totalPrice: "100.00",
			paidAmount: "0.00",
			outstandingAmount: "100.00",
			paymentDueDate: dueDate,
			warehouseId,
			performedById: userId,
		});
		await db.insert(schema.slipRecords).values({
			id: slipId,
			slipNumber: `TEST-SLIP-${runId}`,
			invoiceId,
			customerId,
			invoiceAmount: "100.00",
			paidAmount: "0.00",
			outstandingAmount: "100.00",
		});
	});

	afterAll(async () => {
		if (!db) return;
		await cleanFixture();
	});

	it("moves money once and keeps pending payments out of Paid Amount", async () => {
		const [cashPayment, bankPayment] = await db.transaction((tx) =>
			service.createInitialPayments(tx, {
				invoiceId,
				actorId: userId,
				source: "invoice_creation",
				payments: [
					{
						method: "cash",
						amount: 20,
						walletId: cashWalletId,
						paymentDate: new Date("2026-08-10T10:00:00+05:00"),
					},
					{
						method: "bank_transfer",
						amount: 30,
						walletId: bankWalletId,
						reference: "TEST-BANK-1",
						paymentDate: new Date("2026-08-10T10:05:00+05:00"),
					},
				],
			}),
		);

		expect(cashPayment?.status).toBe("confirmed");
		expect(bankPayment?.status).toBe("pending");
		await expectSettlement({
			paidAmount: "20.00",
			outstandingAmount: "80.00",
			cashBalance: "20.00",
			bankBalance: "0.00",
		});

		const confirmations = await Promise.allSettled([
			db.transaction((tx) =>
				service.confirmPendingPayment(tx, {
					paymentId: bankPayment!.id,
					actorId: userId,
					effectiveDate: new Date("2026-08-11T09:00:00+05:00"),
				}),
			),
			db.transaction((tx) =>
				service.confirmPendingPayment(tx, {
					paymentId: bankPayment!.id,
					actorId: userId,
					effectiveDate: new Date("2026-08-11T09:00:00+05:00"),
				}),
			),
		]);
		expect(
			confirmations.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			confirmations.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		await expectSettlement({
			paidAmount: "50.00",
			outstandingAmount: "50.00",
			cashBalance: "20.00",
			bankBalance: "30.00",
		});

		const bankMovements = await db.query.transactions.findMany({
			where: and(
				eq(schema.transactions.referenceId, bankPayment!.id),
				eq(schema.transactions.source, "Customer Payment"),
			),
		});
		expect(bankMovements).toHaveLength(1);

		const cheque = await db.transaction((tx) =>
			service.recordRecoveryPayment(tx, {
				invoiceId,
				actorId: userId,
				payment: {
					method: "cheque",
					amount: 10,
					walletId: bankWalletId,
					chequeNumber: "TEST-CHEQUE-1",
					chequeBank: "Test Bank",
					chequeDate: new Date("2026-08-12T00:00:00+05:00"),
					paymentDate: new Date("2026-08-12T10:00:00+05:00"),
					sourceRecordId: `test-cheque-${runId}`,
				},
			}),
		);
		expect(cheque.status).toBe("pending");

		await db.transaction((tx) =>
			service.resolvePendingPayment(tx, {
				paymentId: cheque.id,
				actorId: userId,
				resolution: "returned",
				reason: "Test bank did not clear it",
			}),
		);
		expect(
			await db.query.transactions.findMany({
				where: eq(schema.transactions.referenceId, cheque.id),
			}),
		).toHaveLength(0);

		await db.transaction((tx) =>
			service.reverseConfirmedPayment(tx, {
				paymentId: cashPayment!.id,
				actorId: userId,
				effectiveDate: new Date("2026-08-13T10:00:00+05:00"),
				reason: "Test correction",
			}),
		);
		await expect(
			db.transaction((tx) =>
				service.reverseConfirmedPayment(tx, {
					paymentId: cashPayment!.id,
					actorId: userId,
					effectiveDate: new Date("2026-08-13T10:01:00+05:00"),
					reason: "Duplicate test correction",
				}),
			),
		).rejects.toThrow("Payment is no longer confirmed");
		await expectSettlement({
			paidAmount: "30.00",
			outstandingAmount: "70.00",
			cashBalance: "0.00",
			bankBalance: "30.00",
		});

		await expect(
			db.transaction((tx) =>
				service.recordRecoveryPayment(tx, {
					invoiceId,
					actorId: userId,
					payment: {
						method: "cheque",
						amount: 80,
						walletId: bankWalletId,
						chequeNumber: "TEST-CHEQUE-OVER",
						chequeBank: "Test Bank",
						chequeDate: new Date("2026-08-14T00:00:00+05:00"),
						paymentDate: new Date("2026-08-14T10:00:00+05:00"),
						sourceRecordId: `test-over-${runId}`,
					},
				}),
			),
		).rejects.toThrow("Payments cannot exceed invoice total");
	});

	async function expectSettlement(expected: {
		paidAmount: string;
		outstandingAmount: string;
		cashBalance: string;
		bankBalance: string;
	}): Promise<void> {
		const invoice = await db.query.invoices.findFirst({
			where: eq(schema.invoices.id, invoiceId),
		});
		const slip = await db.query.slipRecords.findFirst({
			where: eq(schema.slipRecords.id, slipId),
		});
		const customer = await db.query.customers.findFirst({
			where: eq(schema.customers.id, customerId),
		});
		const cashWallet = await db.query.wallets.findFirst({
			where: eq(schema.wallets.id, cashWalletId),
		});
		const bankWallet = await db.query.wallets.findFirst({
			where: eq(schema.wallets.id, bankWalletId),
		});

		expect(invoice?.paidAmount).toBe(expected.paidAmount);
		expect(invoice?.outstandingAmount).toBe(expected.outstandingAmount);
		expect(slip?.paidAmount).toBe(expected.paidAmount);
		expect(slip?.outstandingAmount).toBe(expected.outstandingAmount);
		expect(customer?.totalPaidAmount).toBe(expected.paidAmount);
		expect(customer?.outstandingAmount).toBe(expected.outstandingAmount);
		expect(cashWallet?.balance).toBe(expected.cashBalance);
		expect(bankWallet?.balance).toBe(expected.bankBalance);
	}
});
