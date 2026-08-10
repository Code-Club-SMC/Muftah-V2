function assertValidSerial(serial: number): void {
	if (!Number.isSafeInteger(serial) || serial < 1) {
		throw new Error("Invoice serial is invalid");
	}
}

function isValidBusinessDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

	const parsed = new Date(`${value}T00:00:00.000Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

export function formatOnlineInvoiceNumber(serial: number): string {
	assertValidSerial(serial);
	return `INV-${serial}`;
}

export function formatOfflineInvoiceNumber(
	factoryCode: string,
	businessDate: string,
	serial: number,
): string {
	if (!/^F\d{2}$/.test(factoryCode)) {
		throw new Error("Factory code is invalid");
	}
	if (!isValidBusinessDate(businessDate)) {
		throw new Error("Business date is invalid");
	}
	assertValidSerial(serial);

	return `OFF-${factoryCode}-${businessDate.replaceAll("-", "")}-${String(serial).padStart(3, "0")}`;
}
