import Big, { type BigSource } from "big.js";

function parseFiniteMoney(value: BigSource): Big {
	try {
		const parsed = new Big(value);
		if (!Number.isFinite(Number(parsed.toString()))) {
			throw new Error("non-finite");
		}
		return parsed;
	} catch {
		throw new Error("Money amount must be finite");
	}
}

export function roundMoney(value: BigSource): number {
	const result = Number(
		parseFiniteMoney(value).round(2, Big.roundHalfUp).toString(),
	);
	if (!Number.isFinite(result)) throw new Error("Money amount must be finite");
	return result;
}

export function moneyString(value: BigSource): string {
	return parseFiniteMoney(value).round(2, Big.roundHalfUp).toFixed(2);
}
