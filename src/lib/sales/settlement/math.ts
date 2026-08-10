import Big from "big.js";
import type { SettlementPayment, SettlementTotals } from "./contracts";
import { roundMoney } from "./money";

function sumPayments(
	payments: SettlementPayment[],
	status: SettlementPayment["status"],
): number {
	const sum = payments
		.filter((payment) => payment.status === status)
		.reduce(
			(total, payment) => total.plus(roundMoney(payment.amount)),
			new Big(0),
		);

	return roundMoney(sum);
}

export function calculateSettlement(
	totalPrice: number,
	payments: SettlementPayment[],
): SettlementTotals {
	if (!Number.isFinite(totalPrice))
		throw new Error("Invoice total must be finite");
	if (totalPrice < 0) throw new Error("Invoice total cannot be negative");

	const total = roundMoney(totalPrice);

	for (const payment of payments) {
		if (!Number.isFinite(payment.amount) || roundMoney(payment.amount) <= 0) {
			throw new Error("Payment amount must be greater than zero");
		}
	}

	const paidAmount = sumPayments(payments, "confirmed");
	const pendingAmount = sumPayments(payments, "pending");
	const allocatedAmount = new Big(paidAmount).plus(pendingAmount);

	if (allocatedAmount.gt(total)) {
		throw new Error("Payments cannot exceed invoice total");
	}

	const outstandingAmount = roundMoney(new Big(total).minus(paidAmount));
	const payLaterAmount = roundMoney(
		new Big(outstandingAmount).minus(pendingAmount),
	);
	const paymentStatus =
		paidAmount === 0
			? "unpaid"
			: outstandingAmount === 0
				? "paid"
				: "partially_paid";

	return {
		totalPrice: total,
		paidAmount,
		pendingAmount,
		outstandingAmount,
		payLaterAmount,
		paymentStatus,
	};
}

export function assertSettlementDueDate(
	totals: SettlementTotals,
	paymentDueDate?: Date | null,
): void {
	if (paymentDueDate && Number.isNaN(paymentDueDate.getTime())) {
		throw new Error("Payment Due Date is invalid");
	}

	if (totals.payLaterAmount > 0 && !paymentDueDate) {
		throw new Error(
			"Payment Due Date is required when an amount remains payable later",
		);
	}
}
