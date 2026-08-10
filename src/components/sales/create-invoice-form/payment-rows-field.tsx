import {
	Add01Icon,
	BankIcon,
	Cash01Icon,
	Delete02Icon,
	Invoice03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export type PaymentInput = {
	method: "cash" | "bank_transfer" | "cheque";
	amount: number;
	walletId: string;
	reference: string;
	chequeNumber: string;
	chequeBank: string;
	chequeDate: string;
	paymentDate: string;
	sourceRecordId?: string;
	status?: "pending" | "confirmed" | "returned" | "cancelled" | "reversed";
};

type WalletOption = {
	id: string;
	name: string;
	type: string;
};

export function blankPayment(
	method: PaymentInput["method"] = "cash",
): PaymentInput {
	return {
		method,
		amount: 0,
		walletId: "",
		reference: "",
		chequeNumber: "",
		chequeBank: "",
		chequeDate: "",
		paymentDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
	};
}

function normalizedDuplicateKey(payment: PaymentInput) {
	return JSON.stringify([
		payment.method,
		Number(Number(payment.amount || 0).toFixed(2)),
		payment.walletId.trim(),
		payment.reference.trim().toLowerCase(),
		payment.chequeNumber.trim().toLowerCase(),
		payment.chequeBank.trim().toLowerCase(),
		payment.chequeDate,
	]);
}

export function findDuplicatePaymentRows(payments: PaymentInput[]) {
	const seen = new Map<string, number>();
	const duplicates = new Set<number>();
	payments.forEach((payment, index) => {
		const key = normalizedDuplicateKey(payment);
		const firstIndex = seen.get(key);
		if (firstIndex === undefined) {
			seen.set(key, index);
			return;
		}
		duplicates.add(firstIndex);
		duplicates.add(index);
	});
	return duplicates;
}

export function calculatePaymentBreakdown(
	total: number,
	payments: PaymentInput[],
) {
	const invoiceTotal = Number(Math.max(0, total).toFixed(2));
	const countsAsPaid = (payment: PaymentInput) =>
		payment.status ? payment.status === "confirmed" : payment.method === "cash";
	const countsAsPending = (payment: PaymentInput) =>
		payment.status ? payment.status === "pending" : payment.method !== "cash";
	const paidAmount = Number(
		payments
			.filter(countsAsPaid)
			.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
			.toFixed(2),
	);
	const pendingAmount = Number(
		payments
			.filter(countsAsPending)
			.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
			.toFixed(2),
	);
	const allocatedAmount = Number((paidAmount + pendingAmount).toFixed(2));
	return {
		invoiceTotal,
		paidAmount,
		pendingAmount,
		outstandingAmount: Number(
			Math.max(0, invoiceTotal - paidAmount).toFixed(2),
		),
		payLaterAmount: Number(
			Math.max(0, invoiceTotal - allocatedAmount).toFixed(2),
		),
		overAllocatedAmount: Number(
			Math.max(0, allocatedAmount - invoiceTotal).toFixed(2),
		),
	};
}

function paymentMethodLabel(method: PaymentInput["method"]) {
	if (method === "bank_transfer") return "Bank Transfer";
	if (method === "cheque") return "Cheque";
	return "Cash";
}

export function PaymentRowsField({
	form,
	payments,
	wallets,
	readOnly = false,
}: {
	form: any;
	payments: PaymentInput[];
	wallets: WalletOption[];
	readOnly?: boolean;
}) {
	const duplicateRows = findDuplicatePaymentRows(payments);

	function setMethod(index: number, method: PaymentInput["method"]) {
		form.setFieldValue(`payments[${index}].method`, method);
		form.setFieldValue(`payments[${index}].walletId`, "");
		form.setFieldValue(`payments[${index}].reference`, "");
		form.setFieldValue(`payments[${index}].chequeNumber`, "");
		form.setFieldValue(`payments[${index}].chequeBank`, "");
		form.setFieldValue(`payments[${index}].chequeDate`, "");
	}

	return (
		<form.Field name="payments" mode="array">
			{(field: any) => (
				<div className="flex flex-col gap-3">
					{payments.length === 0 && (
						<div className="rounded-xl border border-dashed p-4 text-center">
							<p className="text-sm font-medium">No payment received now</p>
							<p className="mt-1 text-xs text-muted-foreground">
								The invoice will keep the full amount as Outstanding Amount.
							</p>
						</div>
					)}

					{payments.map((payment, index) => {
						const requiredWalletType =
							payment.method === "cash" ? "cash" : "bank";
						const availableWallets = wallets.filter(
							(wallet) => wallet.type === requiredWalletType,
						);
						const duplicate = duplicateRows.has(index);

						return (
							<div
								key={index}
								className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4"
								data-payment-row={index}
							>
								<div className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<div className="flex size-8 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10">
											<HugeiconsIcon
												icon={
													payment.method === "cash"
														? Cash01Icon
														: payment.method === "bank_transfer"
															? BankIcon
															: Invoice03Icon
												}
												strokeWidth={2}
											/>
										</div>
										<div>
											<p className="text-sm font-medium">Payment {index + 1}</p>
											<p className="text-xs text-muted-foreground">
												{paymentMethodLabel(payment.method)}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										{payment.status ? (
											<Badge
												variant={
													payment.status === "confirmed"
														? "default"
														: payment.status === "pending"
															? "secondary"
															: payment.status === "returned" ||
																	payment.status === "reversed"
																? "destructive"
																: "outline"
												}
											>
												{payment.status === "pending"
													? "Pending Verification"
													: payment.status === "returned"
														? "Cheque Returned"
														: payment.status[0].toUpperCase() +
															payment.status.slice(1)}
											</Badge>
										) : payment.method !== "cash" ? (
											<Badge variant="secondary">Pending Verification</Badge>
										) : null}
										{!readOnly && (
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												onClick={() => field.removeValue(index)}
												aria-label={`Remove payment ${index + 1}`}
											>
												<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
											</Button>
										)}
									</div>
								</div>

								<div className="grid gap-4 sm:grid-cols-2">
									<form.Field name={`payments[${index}].method`}>
										{(methodField: any) => (
											<Field>
												<FieldLabel>Method</FieldLabel>
												<Select
													value={methodField.state.value}
													onValueChange={(value) =>
														setMethod(index, value as PaymentInput["method"])
													}
													disabled={readOnly}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="cash">Cash</SelectItem>
														<SelectItem value="bank_transfer">
															Bank Transfer
														</SelectItem>
														<SelectItem value="cheque">Cheque</SelectItem>
													</SelectContent>
												</Select>
											</Field>
										)}
									</form.Field>

									<form.Field name={`payments[${index}].amount`}>
										{(amountField: any) => (
											<Field data-invalid={duplicate || undefined}>
												<FieldLabel>Amount</FieldLabel>
												<Input
													type="number"
													min="0.01"
													step="0.01"
													value={amountField.state.value}
													onFocus={(event) => event.currentTarget.select()}
													onChange={(event) =>
														amountField.handleChange(Number(event.target.value))
													}
													disabled={readOnly}
												/>
												{duplicate && (
													<FieldError>
														This payment duplicates another row.
													</FieldError>
												)}
											</Field>
										)}
									</form.Field>

									<form.Field name={`payments[${index}].walletId`}>
										{(walletField: any) => (
											<Field>
												<FieldLabel>Destination Account</FieldLabel>
												<Select
													value={walletField.state.value}
													onValueChange={walletField.handleChange}
													disabled={readOnly}
												>
													<SelectTrigger>
														<SelectValue
															placeholder={`Select ${requiredWalletType} account`}
														/>
													</SelectTrigger>
													<SelectContent>
														{availableWallets.map((wallet) => (
															<SelectItem key={wallet.id} value={wallet.id}>
																{wallet.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<FieldDescription>
													{payment.method === "cash"
														? "Only cash accounts are shown."
														: "Only bank accounts are shown."}
												</FieldDescription>
											</Field>
										)}
									</form.Field>

									<form.Field name={`payments[${index}].paymentDate`}>
										{(dateField: any) => (
											<Field>
												<FieldLabel>Payment Date and Time</FieldLabel>
												<Input
													type="datetime-local"
													value={dateField.state.value}
													onChange={(event) =>
														dateField.handleChange(event.target.value)
													}
													disabled={readOnly}
												/>
											</Field>
										)}
									</form.Field>
								</div>

								{payment.method === "bank_transfer" && (
									<form.Field name={`payments[${index}].reference`}>
										{(referenceField: any) => (
											<Field>
												<FieldLabel>Transaction Reference</FieldLabel>
												<Input
													value={referenceField.state.value}
													onChange={(event) =>
														referenceField.handleChange(event.target.value)
													}
													placeholder="Bank transaction ID"
													disabled={readOnly}
												/>
											</Field>
										)}
									</form.Field>
								)}

								{payment.method === "cheque" && (
									<div className="grid gap-4 sm:grid-cols-3">
										<form.Field name={`payments[${index}].chequeBank`}>
											{(chequeBankField: any) => (
												<Field>
													<FieldLabel>Cheque Bank</FieldLabel>
													<Input
														value={chequeBankField.state.value}
														onChange={(event) =>
															chequeBankField.handleChange(event.target.value)
														}
														disabled={readOnly}
													/>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].chequeNumber`}>
											{(chequeNumberField: any) => (
												<Field>
													<FieldLabel>Cheque Number</FieldLabel>
													<Input
														value={chequeNumberField.state.value}
														onChange={(event) =>
															chequeNumberField.handleChange(event.target.value)
														}
														disabled={readOnly}
													/>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].chequeDate`}>
											{(chequeDateField: any) => (
												<Field>
													<FieldLabel>Cheque Date</FieldLabel>
													<Input
														type="date"
														value={chequeDateField.state.value}
														onChange={(event) =>
															chequeDateField.handleChange(event.target.value)
														}
														disabled={readOnly}
													/>
												</Field>
											)}
										</form.Field>
									</div>
								)}
							</div>
						);
					})}

					{!readOnly && (
						<Button
							type="button"
							variant="outline"
							onClick={() => field.pushValue(blankPayment())}
							className="w-full border-dashed"
						>
							<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
							Add Payment
						</Button>
					)}
				</div>
			)}
		</form.Field>
	);
}
