import { z } from "zod";

export const paymentMethodSchema = z.enum([
	"cash",
	"bank_transfer",
	"cheque",
	"expense_offset",
	"customer_credit",
]);
export const paymentStatusSchema = z.enum([
	"pending",
	"confirmed",
	"returned",
	"cancelled",
	"reversed",
]);
export const paymentSourceSchema = z.enum([
	"invoice_creation",
	"recovery",
	"offline_import",
	"adjustment",
]);
export const invoicePaymentStatusSchema = z.enum([
	"unpaid",
	"partially_paid",
	"paid",
]);

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentSource = z.infer<typeof paymentSourceSchema>;
export type InvoicePaymentStatus = z.infer<typeof invoicePaymentStatusSchema>;

export type PaymentInput = {
	method: Exclude<PaymentMethod, "expense_offset">;
	amount: number;
	walletId?: string;
	reference?: string;
	chequeNumber?: string;
	chequeBank?: string;
	chequeDate?: Date;
	paymentDate: Date;
	sourceRecordId?: string;
	notes?: string;
	instantVerify?: boolean;
};

export type SettlementPayment = {
	amount: number;
	method: PaymentMethod;
	status: PaymentStatus;
};

export type SettlementTotals = {
	totalPrice: number;
	paidAmount: number;
	pendingAmount: number;
	outstandingAmount: number;
	payLaterAmount: number;
	paymentStatus: InvoicePaymentStatus;
};

export function summarizeDailyClosingBuckets(
	todayPayments: Array<{ method: string; amount: string | number }>,
	todayRefunds: Array<{ amount: string | number; status?: string }> = [],
) {
	const sumMethod = (method: string) =>
		Math.round(
			todayPayments
				.filter((p) => p.method === method)
				.reduce((sum, p) => sum + Number(p.amount), 0) * 100,
		) / 100;
	const totalCash = sumMethod("cash");
	const totalBankTransfer = sumMethod("bank_transfer");
	const totalCheque = sumMethod("cheque");
	const totalExpenseOffset = sumMethod("expense_offset");
	const totalCreditApplied = sumMethod("customer_credit");
	const totalCollected =
		Math.round((totalCash + totalBankTransfer + totalCheque + totalExpenseOffset) * 100) / 100;
	const totalCustomerRefunds =
		Math.round(
			todayRefunds
				.filter((r) => !r.status || r.status === "active")
				.reduce((sum, r) => sum + Number(r.amount), 0) * 100,
		) / 100;
	return {
		totalCash,
		totalBankTransfer,
		totalCheque,
		totalExpenseOffset,
		totalCollected,
		totalCreditApplied,
		totalCustomerRefunds,
	};
}

