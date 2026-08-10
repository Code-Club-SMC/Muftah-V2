import { z } from "zod";

export const paymentMethodSchema = z.enum([
	"cash",
	"bank_transfer",
	"cheque",
	"expense_offset",
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
	walletId: string;
	reference?: string;
	chequeNumber?: string;
	chequeBank?: string;
	chequeDate?: Date;
	paymentDate: Date;
	sourceRecordId?: string;
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
