import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasTestDatabase)(
	"transactional invoice number allocation",
	() => {
		let db: typeof import("@/db")["db"];
		let invoiceNumberCounters: typeof import("@/db")["invoiceNumberCounters"];
		let allocateOnlineInvoiceNumber: typeof import("@/lib/sales/invoice-number.server")["allocateOnlineInvoiceNumber"];
		let originalNextValue = 1;
		let shouldRestoreCounter = false;

		beforeAll(async () => {
			({ db, invoiceNumberCounters } = await import("@/db"));
			({ allocateOnlineInvoiceNumber } = await import(
				"@/lib/sales/invoice-number.server"
			));

			const current = await db.query.invoiceNumberCounters.findFirst({
				where: (table, { eq }) => eq(table.kind, "online"),
			});
			if (!current)
				throw new Error("Online invoice counter is missing from test database");
			originalNextValue = current.nextValue;

			await db
				.update(invoiceNumberCounters)
				.set({ nextValue: 50_000 })
				.where(eq(invoiceNumberCounters.kind, "online"));
			shouldRestoreCounter = true;
		});

		afterAll(async () => {
			if (!shouldRestoreCounter) return;
			await db
				.update(invoiceNumberCounters)
				.set({ nextValue: originalNextValue })
				.where(eq(invoiceNumberCounters.kind, "online"));
		});

		it("allocates concurrent values once and reuses a rolled-back value", async () => {
			const allocated = await Promise.all([
				db.transaction((tx) => allocateOnlineInvoiceNumber(tx)),
				db.transaction((tx) => allocateOnlineInvoiceNumber(tx)),
			]);

			expect(allocated.sort()).toEqual(["INV-50000", "INV-50001"]);

			await expect(
				db.transaction(async (tx) => {
					expect(await allocateOnlineInvoiceNumber(tx)).toBe("INV-50002");
					throw new Error("force rollback");
				}),
			).rejects.toThrow("force rollback");

			await expect(
				db.transaction((tx) => allocateOnlineInvoiceNumber(tx)),
			).resolves.toBe("INV-50002");
		});
	},
);
