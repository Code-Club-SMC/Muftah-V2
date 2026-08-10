import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { payments } from "@/db/schemas/sales-erp-schema";
import {
	requirePaymentReversalMiddleware,
	requirePaymentVerificationMiddleware,
} from "@/lib/middlewares";
import {
	confirmPendingPayment,
	resolvePendingPayment,
	reverseConfirmedPayment,
	type SalesTransaction,
} from "./settlement-service";

const confirmSchema = z.object({
	paymentId: z.string().min(1),
	effectiveDate: z.coerce.date(),
});

const resolveSchema = z.object({
	paymentId: z.string().min(1),
	reason: z.string().trim().min(3).max(500),
	paymentDueDate: z.coerce.date().optional(),
});

const reverseSchema = resolveSchema.extend({
	effectiveDate: z.coerce.date(),
});

async function requirePaymentMethod(
	tx: SalesTransaction,
	paymentId: string,
	method: "bank_transfer" | "cheque",
): Promise<void> {
	const payment = await tx.query.payments.findFirst({
		where: eq(payments.id, paymentId),
		columns: { method: true },
	});
	if (!payment) throw new Error("Payment not found");
	if (payment.method !== method) {
		throw new Error(
			method === "cheque"
				? "This action requires a cheque payment"
				: "This action requires a bank transfer payment",
		);
	}
}

export const getPendingPaymentVerificationFn = createServerFn()
	.middleware([requirePaymentVerificationMiddleware])
	.inputValidator((input: unknown) =>
		z
			.object({
				view: z.enum(["pending", "history"]).default("pending"),
				page: z.number().int().positive().default(1),
				limit: z.number().int().min(1).max(100).default(25),
			})
			.parse(input),
	)
	.handler(async ({ data }) => {
		const { db } = await import("@/db");
		const statusCondition =
			data.view === "pending"
				? eq(payments.status, "pending")
				: ne(payments.status, "pending");
		const methodCondition =
			data.view === "pending"
				? and(
						statusCondition,
						// Cash and expense offsets never enter verification.
						ne(payments.method, "cash"),
						ne(payments.method, "expense_offset"),
					)
				: statusCondition;

		const [rows, totalRows] = await Promise.all([
			db.query.payments.findMany({
				where: methodCondition,
				with: {
					invoice: {
						columns: {
							id: true,
							invoiceNumber: true,
							paymentDueDate: true,
						},
					},
					customer: { columns: { id: true, name: true } },
					wallet: { columns: { id: true, name: true, type: true } },
					recordedBy: { columns: { id: true, name: true } },
				},
				orderBy: [desc(payments.paymentDate), desc(payments.createdAt)],
				limit: data.limit,
				offset: (data.page - 1) * data.limit,
			}),
			db.select({ value: count() }).from(payments).where(methodCondition),
		]);

		const now = Date.now();
		return {
			data: rows.map((payment) => ({
				...payment,
				ageDays: Math.max(
					0,
					Math.floor(
						(now - payment.paymentDate.getTime()) / (24 * 60 * 60 * 1000),
					),
				),
			})),
			total: Number(totalRows[0]?.value ?? 0),
			pageCount: Math.max(
				1,
				Math.ceil(Number(totalRows[0]?.value ?? 0) / data.limit),
			),
		};
	});

export const confirmBankTransferFn = createServerFn()
	.middleware([requirePaymentVerificationMiddleware])
	.inputValidator((input: unknown) => confirmSchema.parse(input))
	.handler(async ({ data, context }) => {
		const { db } = await import("@/db");
		return db.transaction(async (tx) => {
			await requirePaymentMethod(tx, data.paymentId, "bank_transfer");
			return confirmPendingPayment(tx, {
				...data,
				actorId: context.session.user.id,
			});
		});
	});

export const clearChequeFn = createServerFn()
	.middleware([requirePaymentVerificationMiddleware])
	.inputValidator((input: unknown) => confirmSchema.parse(input))
	.handler(async ({ data, context }) => {
		const { db } = await import("@/db");
		return db.transaction(async (tx) => {
			await requirePaymentMethod(tx, data.paymentId, "cheque");
			return confirmPendingPayment(tx, {
				...data,
				actorId: context.session.user.id,
			});
		});
	});

export const returnChequeFn = createServerFn()
	.middleware([requirePaymentVerificationMiddleware])
	.inputValidator((input: unknown) => resolveSchema.parse(input))
	.handler(async ({ data, context }) => {
		const { db } = await import("@/db");
		return db.transaction(async (tx) => {
			await requirePaymentMethod(tx, data.paymentId, "cheque");
			return resolvePendingPayment(tx, {
				...data,
				actorId: context.session.user.id,
				resolution: "returned",
			});
		});
	});

export const cancelBankTransferFn = createServerFn()
	.middleware([requirePaymentVerificationMiddleware])
	.inputValidator((input: unknown) => resolveSchema.parse(input))
	.handler(async ({ data, context }) => {
		const { db } = await import("@/db");
		return db.transaction(async (tx) => {
			await requirePaymentMethod(tx, data.paymentId, "bank_transfer");
			return resolvePendingPayment(tx, {
				...data,
				actorId: context.session.user.id,
				resolution: "cancelled",
			});
		});
	});

export const reversePaymentFn = createServerFn()
	.middleware([requirePaymentReversalMiddleware])
	.inputValidator((input: unknown) => reverseSchema.parse(input))
	.handler(async ({ data, context }) => {
		const { db } = await import("@/db");
		return db.transaction((tx) =>
			reverseConfirmedPayment(tx, {
				...data,
				actorId: context.session.user.id,
			}),
		);
	});
