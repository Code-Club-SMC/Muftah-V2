import { createId } from "@paralleldrive/cuid2";
import type { db as rootDb } from "@/db";
import { wallets, transactions } from "@/db/schemas/finance-schema";
import { payments, slipRecords } from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import type {
	PaymentInput,
	PaymentMethod,
	PaymentSource,
	PaymentStatus,
	SettlementPayment,
	SettlementTotals,
} from "@/lib/sales/settlement/contracts";
import {
	assertSettlementDueDate,
	calculateSettlement,
} from "@/lib/sales/settlement/math";
import { moneyString, roundMoney } from "@/lib/sales/settlement/money";
import { and, eq, sql } from "drizzle-orm";
import { recordInvoiceTimelineEvent } from "./invoice-timeline-log";

export type SalesTransaction = Parameters<
	Parameters<typeof rootDb.transaction>[0]
>[0];
export type PaymentRecord = typeof payments.$inferSelect;
type InvoiceRecord = typeof invoices.$inferSelect;

export type InitialPaymentInput = PaymentInput & {
	allocationGroupId?: string;
	notes?: string;
};

export type CreateInitialPaymentsInput = {
	invoiceId: string;
	actorId: string;
	source: "invoice_creation" | "offline_import";
	payments: InitialPaymentInput[];
};

export type ExpenseOffsetPaymentInput = {
	method: "expense_offset";
	amount: number;
	paymentDate: Date;
	expenseType: string;
	sourceRecordId: string;
	allocationGroupId?: string;
	reference?: string;
	notes?: string;
};

export type RecoveryPaymentInput =
	| (PaymentInput & { allocationGroupId?: string; notes?: string })
	| ExpenseOffsetPaymentInput;

export type RecordRecoveryPaymentInput = {
	invoiceId: string;
	actorId: string;
	payment: RecoveryPaymentInput;
};

export type ConfirmPaymentInput = {
	paymentId: string;
	actorId: string;
	effectiveDate: Date;
};

export type ResolvePaymentInput = {
	paymentId: string;
	actorId: string;
	resolution: "returned" | "cancelled";
	reason: string;
	paymentDueDate?: Date;
};

export type ReversePaymentInput = {
	paymentId: string;
	actorId: string;
	effectiveDate: Date;
	reason: string;
	paymentDueDate?: Date;
};

type PreparedPayment = {
	method: PaymentMethod;
	amount: number;
	walletId: string | null;
	reference: string | null;
	chequeNumber: string | null;
	chequeBank: string | null;
	chequeDate: Date | null;
	expenseType: string | null;
	paymentDate: Date;
	sourceRecordId: string | null;
	allocationGroupId: string | null;
	notes: string | null;
};

function cleanOptional(value: string | undefined): string | null {
	const cleaned = value?.trim();
	return cleaned ? cleaned : null;
}

function assertValidDate(value: Date, label: string): void {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		throw new Error(`${label} is invalid`);
	}
}

function preparePayment(input: RecoveryPaymentInput): PreparedPayment {
	if (!Number.isFinite(input.amount)) {
		throw new Error("Payment amount must be greater than zero");
	}
	const amount = roundMoney(input.amount);
	if (amount <= 0) throw new Error("Payment amount must be greater than zero");
	assertValidDate(input.paymentDate, "Payment date");

	if (input.method === "expense_offset") {
		const expenseType = cleanOptional(input.expenseType);
		const sourceRecordId = cleanOptional(input.sourceRecordId);
		if (!expenseType) throw new Error("Expense type is required");
		if (!sourceRecordId) throw new Error("Payment identity is required");
		return {
			method: input.method,
			amount,
			walletId: null,
			reference: cleanOptional(input.reference),
			chequeNumber: null,
			chequeBank: null,
			chequeDate: null,
			expenseType,
			paymentDate: input.paymentDate,
			sourceRecordId,
			allocationGroupId: cleanOptional(input.allocationGroupId),
			notes: cleanOptional(input.notes),
		};
	}

	const walletId = cleanOptional(input.walletId);
	const reference = cleanOptional(input.reference);
	const chequeNumber = cleanOptional(input.chequeNumber);
	const chequeBank = cleanOptional(input.chequeBank);

	if (!walletId) throw new Error("Destination account is required");
	if (input.method === "bank_transfer" && !reference) {
		throw new Error("Bank reference is required");
	}
	if (input.method === "cheque") {
		if (!chequeNumber) throw new Error("Cheque number is required");
		if (!chequeBank) throw new Error("Cheque bank is required");
		if (!input.chequeDate) throw new Error("Cheque date is required");
		assertValidDate(input.chequeDate, "Cheque date");
	}

	return {
		method: input.method,
		amount,
		walletId,
		reference,
		chequeNumber,
		chequeBank,
		chequeDate: input.chequeDate ?? null,
		expenseType: null,
		paymentDate: input.paymentDate,
		sourceRecordId: cleanOptional(input.sourceRecordId),
		allocationGroupId: cleanOptional(input.allocationGroupId),
		notes: cleanOptional(input.notes),
	};
}

function initialStatus(method: PaymentMethod): PaymentStatus {
	return method === "cash" || method === "expense_offset"
		? "confirmed"
		: "pending";
}

async function lockInvoice(
	tx: SalesTransaction,
	invoiceId: string,
): Promise<InvoiceRecord> {
	await tx.execute(
		sql`SELECT ${invoices.id} FROM ${invoices} WHERE ${invoices.id} = ${invoiceId} FOR UPDATE`,
	);

	const invoice = await tx.query.invoices.findFirst({
		where: eq(invoices.id, invoiceId),
	});
	if (!invoice) throw new Error("Invoice not found");
	if (invoice.status === "voided")
		throw new Error("Voided invoice cannot accept payments");
	return invoice;
}

function paymentForMath(payment: {
	amount: string | number;
	method: PaymentMethod;
	status: PaymentStatus;
}): SettlementPayment {
	return {
		amount: Number(payment.amount),
		method: payment.method,
		status: payment.status,
	};
}

async function listSettlementPayments(
	tx: SalesTransaction,
	invoiceId: string,
): Promise<SettlementPayment[]> {
	const rows = await tx.query.payments.findMany({
		where: eq(payments.invoiceId, invoiceId),
		columns: { amount: true, method: true, status: true },
	});
	return rows.map(paymentForMath);
}

async function assertWalletType(
	tx: SalesTransaction,
	walletId: string,
	method: Exclude<PaymentMethod, "expense_offset">,
): Promise<void> {
	const wallet = await tx.query.wallets.findFirst({
		where: eq(wallets.id, walletId),
		columns: { id: true, type: true },
	});
	if (!wallet) throw new Error("Destination account was not found");

	const expectedType = method === "cash" ? "cash" : "bank";
	if (wallet.type !== expectedType) {
		throw new Error(
			method === "cash"
				? "Cash payment requires a cash account"
				: "Bank transfer or cheque requires a bank account",
		);
	}
}

async function creditWalletForPayment(
	tx: SalesTransaction,
	payment: PaymentRecord,
	actorId: string,
): Promise<void> {
	if (payment.method === "expense_offset") return;
	if (!payment.walletId || !payment.effectiveDate) {
		throw new Error("Confirmed payment is missing account information");
	}

	const expectedType = payment.method === "cash" ? "cash" : "bank";
	const [wallet] = await tx
		.update(wallets)
		.set({ balance: sql`${wallets.balance} + ${payment.amount}` })
		.where(
			and(eq(wallets.id, payment.walletId), eq(wallets.type, expectedType)),
		)
		.returning({ id: wallets.id });
	if (!wallet) {
		throw new Error(
			expectedType === "cash"
				? "Cash payment requires a cash account"
				: "Bank transfer or cheque requires a bank account",
		);
	}

	await tx.insert(transactions).values({
		id: createId(),
		walletId: payment.walletId,
		type: "credit",
		amount: payment.amount,
		source: "Customer Payment",
		referenceId: payment.id,
		effectiveDate: payment.effectiveDate,
		performedById: actorId,
	});
}

async function insertPayment(
	tx: SalesTransaction,
	invoice: InvoiceRecord,
	actorId: string,
	source: PaymentSource,
	prepared: PreparedPayment,
): Promise<PaymentRecord> {
	const status = initialStatus(prepared.method);
	const now = new Date();
	const [payment] = await tx
		.insert(payments)
		.values({
			id: createId(),
			customerId: invoice.customerId,
			invoiceId: invoice.id,
			amount: moneyString(prepared.amount),
			method: prepared.method,
			status,
			walletId: prepared.walletId,
			reference: prepared.reference,
			chequeNumber: prepared.chequeNumber,
			chequeBank: prepared.chequeBank,
			chequeDate: prepared.chequeDate,
			expenseType: prepared.expenseType,
			recordedById: actorId,
			paymentDate: prepared.paymentDate,
			effectiveDate: status === "confirmed" ? prepared.paymentDate : null,
			source,
			sourceRecordId: prepared.sourceRecordId,
			allocationGroupId: prepared.allocationGroupId,
			confirmedById: status === "confirmed" ? actorId : null,
			confirmedAt: status === "confirmed" ? now : null,
			notes: prepared.notes,
		})
		.returning();
	if (!payment) throw new Error("Payment could not be recorded");
	return payment;
}

async function validatePreparedWallets(
	tx: SalesTransaction,
	preparedPayments: PreparedPayment[],
): Promise<void> {
	for (const payment of preparedPayments) {
		if (payment.method === "expense_offset" || !payment.walletId) continue;
		await assertWalletType(tx, payment.walletId, payment.method);
	}
}

function assertNoDuplicatePayments(preparedPayments: PreparedPayment[]): void {
	const seen = new Set<string>();
	for (const payment of preparedPayments) {
		const identity = JSON.stringify([
			payment.method,
			payment.amount,
			payment.walletId,
			payment.reference,
			payment.chequeNumber,
			payment.chequeBank,
			payment.chequeDate?.toISOString() ?? null,
			payment.paymentDate.toISOString(),
		]);
		if (seen.has(identity))
			throw new Error("Duplicate payment row is not allowed");
		seen.add(identity);
	}
}

async function assertProposedSettlement(
	tx: SalesTransaction,
	invoice: InvoiceRecord,
	newPayments: PreparedPayment[],
): Promise<void> {
	const existing = await listSettlementPayments(tx, invoice.id);
	const proposed = newPayments.map((payment) => ({
		amount: payment.amount,
		method: payment.method,
		status: initialStatus(payment.method),
	}));
	const totals = calculateSettlement(Number(invoice.totalPrice), [
		...existing,
		...proposed,
	]);
	assertSettlementDueDate(totals, invoice.paymentDueDate);
}

export async function recalculateInvoiceSettlement(
	tx: SalesTransaction,
	invoiceId: string,
	options?: {
		totalPrice?: number;
		paymentDueDate?: Date | null;
	},
): Promise<SettlementTotals> {
	const invoice = await lockInvoice(tx, invoiceId);
	const totalPrice = options?.totalPrice ?? Number(invoice.totalPrice);
	const paymentDueDate =
		options && "paymentDueDate" in options
			? options.paymentDueDate
			: invoice.paymentDueDate;
	const totals = calculateSettlement(
		totalPrice,
		await listSettlementPayments(tx, invoice.id),
	);
	assertSettlementDueDate(totals, paymentDueDate);

	const paidDelta = roundMoney(totals.paidAmount - Number(invoice.paidAmount));
	const outstandingDelta = roundMoney(
		totals.outstandingAmount - Number(invoice.outstandingAmount),
	);

	await tx
		.update(invoices)
		.set({
			...(options?.totalPrice !== undefined
				? { totalPrice: moneyString(totals.totalPrice) }
				: {}),
			...(options && "paymentDueDate" in options ? { paymentDueDate } : {}),
			paidAmount: moneyString(totals.paidAmount),
			outstandingAmount: moneyString(totals.outstandingAmount),
			paymentStatus: totals.paymentStatus,
		})
		.where(eq(invoices.id, invoice.id));

	await tx
		.update(slipRecords)
		.set({
			invoiceAmount: moneyString(totals.totalPrice),
			paidAmount: moneyString(totals.paidAmount),
			outstandingAmount: moneyString(totals.outstandingAmount),
			status:
				totals.outstandingAmount === 0
					? "closed"
					: totals.paidAmount > 0
						? "partially_recovered"
						: "open",
		})
		.where(eq(slipRecords.invoiceId, invoice.id));

	if (paidDelta !== 0 || outstandingDelta !== 0) {
		await tx
			.update(customers)
			.set({
				totalPaidAmount: sql`${customers.totalPaidAmount} + ${paidDelta}`,
				outstandingAmount: sql`${customers.outstandingAmount} + ${outstandingDelta}`,
			})
			.where(eq(customers.id, invoice.customerId));
	}

	return totals;
}

export async function createInitialPayments(
	tx: SalesTransaction,
	input: CreateInitialPaymentsInput,
): Promise<PaymentRecord[]> {
	const invoice = await lockInvoice(tx, input.invoiceId);
	const existing = await listSettlementPayments(tx, invoice.id);
	if (existing.length > 0) throw new Error("Initial payments already exist");

	const preparedPayments = input.payments.map(preparePayment);
	if (
		input.source === "offline_import" &&
		preparedPayments.some((payment) => !payment.sourceRecordId)
	) {
		throw new Error("Offline payment identity is required");
	}
	assertNoDuplicatePayments(preparedPayments);
	await validatePreparedWallets(tx, preparedPayments);
	await assertProposedSettlement(tx, invoice, preparedPayments);

	const created: PaymentRecord[] = [];
	for (const prepared of preparedPayments) {
		const payment = await insertPayment(
			tx,
			invoice,
			input.actorId,
			input.source,
			prepared,
		);
		if (payment.status === "confirmed") {
			await creditWalletForPayment(tx, payment, input.actorId);
		}
		created.push(payment);

		await recordInvoiceTimelineEvent(
			{
				invoiceId: invoice.id,
				eventType: "payment",
				title:
					payment.status === "confirmed"
						? `Paid Amount recorded: PKR ${payment.amount}`
						: `Payment pending verification: PKR ${payment.amount}`,
				metadata: {
					paymentId: payment.id,
					method: payment.method,
					status: payment.status,
				},
				actorId: input.actorId,
				eventDate: payment.paymentDate,
			},
			tx,
		);
	}

	await recalculateInvoiceSettlement(tx, invoice.id);
	return created;
}

export async function recordRecoveryPayment(
	tx: SalesTransaction,
	input: RecordRecoveryPaymentInput,
): Promise<PaymentRecord> {
	const invoice = await lockInvoice(tx, input.invoiceId);
	const prepared = preparePayment(input.payment);
	if (!prepared.sourceRecordId) throw new Error("Payment identity is required");
	await validatePreparedWallets(tx, [prepared]);
	await assertProposedSettlement(tx, invoice, [prepared]);

	const source: PaymentSource =
		prepared.method === "expense_offset" ? "adjustment" : "recovery";
	const payment = await insertPayment(
		tx,
		invoice,
		input.actorId,
		source,
		prepared,
	);
	if (payment.status === "confirmed") {
		await creditWalletForPayment(tx, payment, input.actorId);
	}

	await recalculateInvoiceSettlement(tx, invoice.id);
	await recordInvoiceTimelineEvent(
		{
			invoiceId: invoice.id,
			eventType: "payment",
			title:
				payment.status === "confirmed"
					? `Recovery recorded: PKR ${payment.amount}`
					: `Recovery pending verification: PKR ${payment.amount}`,
			metadata: {
				paymentId: payment.id,
				method: payment.method,
				status: payment.status,
				allocationGroupId: payment.allocationGroupId,
			},
			actorId: input.actorId,
			eventDate: payment.paymentDate,
		},
		tx,
	);
	return payment;
}

async function findPaymentOrThrow(
	tx: SalesTransaction,
	paymentId: string,
): Promise<PaymentRecord> {
	const payment = await tx.query.payments.findFirst({
		where: eq(payments.id, paymentId),
	});
	if (!payment) throw new Error("Payment not found");
	return payment;
}

export async function confirmPendingPayment(
	tx: SalesTransaction,
	input: ConfirmPaymentInput,
): Promise<PaymentRecord> {
	assertValidDate(input.effectiveDate, "Effective date");
	const current = await findPaymentOrThrow(tx, input.paymentId);
	await lockInvoice(tx, current.invoiceId);
	const now = new Date();

	const [changed] = await tx
		.update(payments)
		.set({
			status: "confirmed",
			effectiveDate: input.effectiveDate,
			confirmedById: input.actorId,
			confirmedAt: now,
		})
		.where(
			and(eq(payments.id, input.paymentId), eq(payments.status, "pending")),
		)
		.returning();
	if (!changed) throw new Error("Payment is no longer pending");

	await creditWalletForPayment(tx, changed, input.actorId);
	await recalculateInvoiceSettlement(tx, changed.invoiceId);
	await recordInvoiceTimelineEvent(
		{
			invoiceId: changed.invoiceId,
			eventType: "payment",
			title:
				changed.method === "cheque"
					? `Cheque Cleared: PKR ${changed.amount}`
					: `Bank transfer confirmed: PKR ${changed.amount}`,
			metadata: { paymentId: changed.id, method: changed.method },
			actorId: input.actorId,
			eventDate: input.effectiveDate,
		},
		tx,
	);
	return changed;
}

export async function resolvePendingPayment(
	tx: SalesTransaction,
	input: ResolvePaymentInput,
): Promise<PaymentRecord> {
	const reason = cleanOptional(input.reason);
	if (!reason) throw new Error("Resolution reason is required");
	if (input.paymentDueDate) {
		assertValidDate(input.paymentDueDate, "Payment Due Date");
	}

	const current = await findPaymentOrThrow(tx, input.paymentId);
	await lockInvoice(tx, current.invoiceId);
	if (input.resolution === "returned" && current.method !== "cheque") {
		throw new Error("Only a cheque can be marked Cheque Returned");
	}

	const now = new Date();
	const [changed] = await tx
		.update(payments)
		.set({
			status: input.resolution,
			resolvedById: input.actorId,
			resolvedAt: now,
			resolutionReason: reason,
		})
		.where(
			and(eq(payments.id, input.paymentId), eq(payments.status, "pending")),
		)
		.returning();
	if (!changed) throw new Error("Payment is no longer pending");

	if (input.paymentDueDate) {
		await tx
			.update(invoices)
			.set({ paymentDueDate: input.paymentDueDate })
			.where(eq(invoices.id, changed.invoiceId));
	}
	await recalculateInvoiceSettlement(tx, changed.invoiceId);

	await recordInvoiceTimelineEvent(
		{
			invoiceId: changed.invoiceId,
			eventType: "payment",
			title:
				input.resolution === "returned"
					? `Cheque Returned: PKR ${changed.amount}`
					: `Pending payment cancelled: PKR ${changed.amount}`,
			description:
				input.resolution === "returned"
					? `Bank did not clear this cheque. ${reason}`
					: reason,
			metadata: {
				paymentId: changed.id,
				resolution: input.resolution,
				reason,
			},
			actorId: input.actorId,
		},
		tx,
	);
	return changed;
}

export async function reverseConfirmedPayment(
	tx: SalesTransaction,
	input: ReversePaymentInput,
): Promise<PaymentRecord> {
	assertValidDate(input.effectiveDate, "Reversal date");
	const reason = cleanOptional(input.reason);
	if (!reason) throw new Error("Reversal reason is required");
	if (input.paymentDueDate) {
		assertValidDate(input.paymentDueDate, "Payment Due Date");
	}

	const current = await findPaymentOrThrow(tx, input.paymentId);
	await lockInvoice(tx, current.invoiceId);
	const now = new Date();
	const [changed] = await tx
		.update(payments)
		.set({
			status: "reversed",
			resolvedById: input.actorId,
			resolvedAt: now,
			resolutionReason: reason,
		})
		.where(
			and(eq(payments.id, input.paymentId), eq(payments.status, "confirmed")),
		)
		.returning();
	if (!changed) throw new Error("Payment is no longer confirmed");

	if (changed.method !== "expense_offset") {
		const originalMovement = await tx.query.transactions.findFirst({
			where: and(
				eq(transactions.referenceId, changed.id),
				eq(transactions.source, "Customer Payment"),
				eq(transactions.type, "credit"),
			),
		});
		if (!originalMovement) {
			throw new Error("Original wallet payment movement was not found");
		}

		await tx
			.update(wallets)
			.set({ balance: sql`${wallets.balance} - ${changed.amount}` })
			.where(eq(wallets.id, originalMovement.walletId));
		await tx.insert(transactions).values({
			id: createId(),
			walletId: originalMovement.walletId,
			type: "debit",
			amount: changed.amount,
			source: "Customer Payment Reversal",
			referenceId: changed.id,
			effectiveDate: input.effectiveDate,
			reversalOfTransactionId: originalMovement.id,
			performedById: input.actorId,
		});
	}

	if (input.paymentDueDate) {
		await tx
			.update(invoices)
			.set({ paymentDueDate: input.paymentDueDate })
			.where(eq(invoices.id, changed.invoiceId));
	}
	await recalculateInvoiceSettlement(tx, changed.invoiceId);

	await recordInvoiceTimelineEvent(
		{
			invoiceId: changed.invoiceId,
			eventType: "payment",
			title: `Payment reversed: PKR ${changed.amount}`,
			description: reason,
			metadata: { paymentId: changed.id, reason },
			actorId: input.actorId,
			eventDate: input.effectiveDate,
		},
		tx,
	);
	return changed;
}
