import { describe, expect, it } from "vitest";
import {
	formatOfflineInvoiceNumber,
	formatOnlineInvoiceNumber,
} from "./invoice-number";

describe("public invoice number formatting", () => {
	it("formats online numbers from their own sequence", () => {
		expect(formatOnlineInvoiceNumber(42)).toBe("INV-42");
	});

	it("formats offline numbers with factory, business date, and padded serial", () => {
		expect(formatOfflineInvoiceNumber("F01", "2026-08-10", 7)).toBe(
			"OFF-F01-20260810-007",
		);
		expect(formatOfflineInvoiceNumber("F01", "2026-08-10", 1_234)).toBe(
			"OFF-F01-20260810-1234",
		);
	});

	it.each([
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid serial %s", (serial) => {
		expect(() => formatOnlineInvoiceNumber(serial)).toThrow(
			"Invoice serial is invalid",
		);
	});

	it.each([
		"F 01",
		"f01",
		"F1",
		"F001",
		"X01",
	])("rejects invalid factory code %s", (factoryCode) => {
		expect(() =>
			formatOfflineInvoiceNumber(factoryCode, "2026-08-10", 1),
		).toThrow("Factory code is invalid");
	});

	it.each([
		"2026-8-10",
		"10-08-2026",
		"2026-02-30",
		"not-a-date",
	])("rejects invalid business date %s", (businessDate) => {
		expect(() => formatOfflineInvoiceNumber("F01", businessDate, 1)).toThrow(
			"Business date is invalid",
		);
	});
});
