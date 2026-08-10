import { db, invoiceNumberCounters } from "@/db";
import { eq, sql } from "drizzle-orm";
import { formatOnlineInvoiceNumber } from "./invoice-number";

export type SalesTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

type CounterKind = typeof invoiceNumberCounters.$inferSelect.kind;

async function reserveSerials(
	tx: SalesTransaction,
	kind: CounterKind,
	count: number,
): Promise<{ start: number; end: number }> {
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error("Invoice reservation count is invalid");
	}

	const [row] = await tx
		.update(invoiceNumberCounters)
		.set({
			nextValue: sql`${invoiceNumberCounters.nextValue} + ${count}`,
			updatedAt: sql`now()`,
		})
		.where(eq(invoiceNumberCounters.kind, kind))
		.returning({
			start: sql<number>`${invoiceNumberCounters.nextValue} - ${count}`,
		});

	const start = Number(row?.start);
	const end = start + count - 1;
	if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end)) {
		throw new Error(`Invoice number counter ${kind} is missing or invalid`);
	}

	return { start, end };
}

export async function allocateOnlineInvoiceNumber(
	tx: SalesTransaction,
): Promise<string> {
	const { start } = await reserveSerials(tx, "online", 1);
	return formatOnlineInvoiceNumber(start);
}

export function reserveOfflineInvoiceSerials(
	tx: SalesTransaction,
	count: number,
): Promise<{ start: number; end: number }> {
	return reserveSerials(tx, "offline", count);
}
