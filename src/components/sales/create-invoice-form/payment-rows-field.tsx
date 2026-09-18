import {
	Add01Icon,
	BankIcon,
	Cash01Icon,
	Delete02Icon,
	Invoice03Icon,
	SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";
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
	method: "cash" | "bank_transfer" | "digital_wallet" | "cheque" | "expense_offset";
	amount: number;
	walletId: string;
	reference: string;
	senderBankName?: string;
	senderAccountNumber?: string;
	digitalProvider?: string;
	senderMobileNumber?: string;
	senderAccountTitle?: string;
	chequeNumber: string;
	chequeBank: string;
	chequeDate: string;
	paymentDate: string;
	notes?: string;
	instantVerify?: boolean;
	sourceRecordId?: string;
	expenseType?: string;
	expenseEmployeeId?: string;
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
		senderBankName: "",
		senderAccountNumber: "",
		digitalProvider: method === "digital_wallet" ? "EasyPaisa" : "",
		senderMobileNumber: "",
		senderAccountTitle: "",
		chequeNumber: "",
		chequeBank: "",
		chequeDate: "",
		paymentDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
		notes: "",
		instantVerify: false,
		expenseType: "",
		expenseEmployeeId: "",
	};
}

function normalizedDuplicateKey(payment: PaymentInput) {
	return JSON.stringify([
		payment.method,
		Number(Number(payment.amount || 0).toFixed(2)),
		payment.walletId.trim(),
		payment.reference.trim().toLowerCase(),
		(payment.senderBankName || "").trim().toLowerCase(),
		(payment.senderAccountNumber || "").trim().toLowerCase(),
		(payment.digitalProvider || "").trim().toLowerCase(),
		(payment.senderMobileNumber || "").trim().toLowerCase(),
		payment.chequeNumber.trim().toLowerCase(),
		payment.chequeBank.trim().toLowerCase(),
		payment.chequeDate,
	]);
}

export function findDuplicatePaymentRows(payments: PaymentInput[]) {
	const seen = new Map<string, number>();
	const duplicates = new Set<number>();
	payments.forEach((payment, index) => {
		// Existing (already saved) payments have a status and are read-only.
		// Only check NEW payments for duplicates against other new payments.
		if (payment.status) return;
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
		payment.status
			? payment.status === "confirmed"
			: payment.method === "cash" || Boolean(payment.instantVerify);
	const countsAsPending = (payment: PaymentInput) =>
		payment.status
			? payment.status === "pending"
			: payment.method !== "cash" && !payment.instantVerify;
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
	if (method === "digital_wallet") return "Digital Account";
	if (method === "cheque") return "Cheque";
	if (method === "expense_offset") return "Salesman Salary Paid by Distributor";
	return "Cash";
}

import { useGetSalesmen } from "@/hooks/sales/use-sales-people";

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
	const { data: salesmen } = useGetSalesmen();

	function setMethod(index: number, method: PaymentInput["method"]) {
		form.setFieldValue(`payments[${index}].method`, method);
		form.setFieldValue(`payments[${index}].walletId`, "");
		form.setFieldValue(`payments[${index}].reference`, "");
		form.setFieldValue(`payments[${index}].senderBankName`, "");
		form.setFieldValue(`payments[${index}].senderAccountNumber`, "");
		form.setFieldValue(
			`payments[${index}].digitalProvider`,
			method === "digital_wallet" ? "EasyPaisa" : "",
		);
		form.setFieldValue(`payments[${index}].senderMobileNumber`, "");
		form.setFieldValue(`payments[${index}].senderAccountTitle`, "");
		form.setFieldValue(`payments[${index}].chequeNumber`, "");
		form.setFieldValue(`payments[${index}].chequeBank`, "");
		form.setFieldValue(`payments[${index}].chequeDate`, "");
		form.setFieldValue(`payments[${index}].notes`, "");
		form.setFieldValue(`payments[${index}].instantVerify`, false);
		form.setFieldValue(`payments[${index}].expenseType`, method === "expense_offset" ? "salesman_salary" : "");
		form.setFieldValue(`payments[${index}].expenseEmployeeId`, "");
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
					const rowReadOnly = readOnly && Boolean(payment.status);

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
															: payment.method === "digital_wallet"
																? SmartPhone01Icon
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
									{!rowReadOnly && (
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
													disabled={rowReadOnly}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="cash">Cash</SelectItem>
														<SelectItem value="bank_transfer">
															Bank Transfer
														</SelectItem>
														<SelectItem value="digital_wallet">
															Digital Account (EasyPaisa / JazzCash / Raast)
														</SelectItem>
														<SelectItem value="cheque">Cheque</SelectItem>
														<SelectItem value="expense_offset">Salesman Salary Paid by Distributor</SelectItem>
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
													disabled={rowReadOnly}
												/>
												{duplicate && (
													<FieldError>
														This payment duplicates another row.
													</FieldError>
												)}
											</Field>
										)}
									</form.Field>

									{payment.method !== "expense_offset" && (
										<form.Field name={`payments[${index}].walletId`}>
											{(walletField: any) => (
												<Field>
													<FieldLabel>Destination Account</FieldLabel>
													<Select
														value={walletField.state.value}
														onValueChange={walletField.handleChange}
														disabled={rowReadOnly}
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
															: payment.method === "digital_wallet"
																? "Company bank or digital account where funds were received."
																: "Only bank accounts are shown."}
													</FieldDescription>
												</Field>
											)}
										</form.Field>
									)}

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
													disabled={rowReadOnly}
												/>
											</Field>
										)}
									</form.Field>
								</div>
								
								{payment.method === "expense_offset" && (
									<div className="grid gap-4 sm:grid-cols-2">
										<form.Field name={`payments[${index}].expenseEmployeeId`}>
											{(employeeField: any) => (
												<Field>
													<FieldLabel>Select Salesman <span className="text-destructive">*</span></FieldLabel>
													<Select
														value={employeeField.state.value}
														onValueChange={employeeField.handleChange}
														disabled={rowReadOnly}
													>
														<SelectTrigger>
															<SelectValue placeholder="Select salesman whose salary is being offset" />
														</SelectTrigger>
														<SelectContent>
															{salesmen?.filter((s) => s.employeeId).map((s) => (
																<SelectItem key={s.employeeId} value={s.employeeId!}>
																	{s.name}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<FieldDescription>
														Their salary will be marked as paid/advanced in HR.
													</FieldDescription>
												</Field>
											)}
										</form.Field>
									</div>
								)}

								{payment.method === "bank_transfer" && (
									<div className="grid gap-4 sm:grid-cols-3">
										<form.Field name={`payments[${index}].senderBankName`}>
											{(senderBankField: any) => (
												<Field>
													<FieldLabel>
														Distributor Bank Name <span className="text-destructive">*</span>
													</FieldLabel>
													<Input
														value={senderBankField.state.value || ""}
														onChange={(event) =>
															senderBankField.handleChange(event.target.value)
														}
														placeholder="e.g. Meezan Bank, HBL, MCB"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].senderAccountNumber`}>
											{(senderAccountField: any) => (
												<Field>
													<FieldLabel>
														Distributor A/C # / IBAN <span className="text-destructive">*</span>
													</FieldLabel>
													<Input
														value={senderAccountField.state.value || ""}
														onChange={(event) =>
															senderAccountField.handleChange(event.target.value)
														}
														placeholder="e.g. PK36MEZN... or Account #"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].reference`}>
											{(referenceField: any) => (
												<Field>
													<FieldLabel>
														Transaction Reference / ID <span className="text-destructive">*</span>
													</FieldLabel>
													<Input
														value={referenceField.state.value || ""}
														onChange={(event) =>
															referenceField.handleChange(event.target.value)
														}
														placeholder="Bank transaction ID"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
									</div>
								)}

								{payment.method === "digital_wallet" && (
									<div className="grid gap-4 sm:grid-cols-3">
										<form.Field name={`payments[${index}].digitalProvider`}>
											{(providerField: any) => (
												<Field>
													<FieldLabel>
														Platform / Provider <span className="text-destructive">*</span>
													</FieldLabel>
													<Select
														value={providerField.state.value || "EasyPaisa"}
														onValueChange={providerField.handleChange}
														disabled={rowReadOnly}
													>
														<SelectTrigger>
															<SelectValue placeholder="Select platform" />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="EasyPaisa">EasyPaisa</SelectItem>
															<SelectItem value="JazzCash">JazzCash</SelectItem>
															<SelectItem value="Raast">Raast (Instant)</SelectItem>
															<SelectItem value="SadaPay">SadaPay</SelectItem>
															<SelectItem value="NayaPay">NayaPay</SelectItem>
															<SelectItem value="Other">Other Digital</SelectItem>
														</SelectContent>
													</Select>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].senderMobileNumber`}>
											{(mobileField: any) => (
												<Field>
													<FieldLabel>
														Sender Mobile / A/C # <span className="text-destructive">*</span>
													</FieldLabel>
													<Input
														value={mobileField.state.value || ""}
														onChange={(event) =>
															mobileField.handleChange(event.target.value)
														}
														placeholder="e.g. 0300-1234567"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
										<form.Field name={`payments[${index}].reference`}>
											{(referenceField: any) => (
												<Field>
													<FieldLabel>
														Transaction ID (TID) <span className="text-destructive">*</span>
													</FieldLabel>
													<Input
														value={referenceField.state.value || ""}
														onChange={(event) =>
															referenceField.handleChange(event.target.value)
														}
														placeholder="e.g. 2948291823"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
									</div>
								)}

								{payment.method === "cheque" && (
									<div className="space-y-3">
										<div className="grid gap-4 sm:grid-cols-3">
											<form.Field name={`payments[${index}].chequeBank`}>
												{(chequeBankField: any) => (
													<Field>
														<FieldLabel>
															Cheque Bank <span className="text-destructive">*</span>
														</FieldLabel>
														<Input
															value={chequeBankField.state.value || ""}
															onChange={(event) =>
																chequeBankField.handleChange(event.target.value)
															}
															placeholder="e.g. HBL, Meezan Bank"
															disabled={rowReadOnly}
														/>
													</Field>
												)}
											</form.Field>
											<form.Field name={`payments[${index}].chequeNumber`}>
												{(chequeNumberField: any) => (
													<Field>
														<FieldLabel>
															Cheque Number <span className="text-destructive">*</span>
														</FieldLabel>
														<Input
															value={chequeNumberField.state.value || ""}
															onChange={(event) =>
																chequeNumberField.handleChange(event.target.value)
															}
															placeholder="e.g. 10293847"
															disabled={rowReadOnly}
														/>
													</Field>
												)}
											</form.Field>
											<form.Field name={`payments[${index}].chequeDate`}>
												{(chequeDateField: any) => (
													<Field>
														<FieldLabel>
															Cheque Date <span className="text-destructive">*</span>
														</FieldLabel>
														<Input
															type="date"
															value={chequeDateField.state.value || ""}
															onChange={(event) =>
																chequeDateField.handleChange(event.target.value)
															}
															disabled={rowReadOnly}
														/>
													</Field>
												)}
											</form.Field>
										</div>
										<form.Field name={`payments[${index}].reference`}>
											{(referenceField: any) => (
												<Field>
													<FieldLabel>
														Deposit Slip / Memo Ref{" "}
														<span className="text-muted-foreground font-normal">
															(optional)
														</span>
													</FieldLabel>
													<Input
														value={referenceField.state.value || ""}
														onChange={(event) =>
															referenceField.handleChange(event.target.value)
														}
														placeholder="Deposit slip number or tracking memo"
														disabled={rowReadOnly}
													/>
												</Field>
											)}
										</form.Field>
									</div>
								)}

								{payment.method === "cash" && (
									<form.Field name={`payments[${index}].reference`}>
										{(referenceField: any) => (
											<Field>
												<FieldLabel>
													Receipt / Memo Reference{" "}
													<span className="text-muted-foreground font-normal">
														(optional)
													</span>
												</FieldLabel>
												<Input
													value={referenceField.state.value || ""}
													onChange={(event) =>
														referenceField.handleChange(event.target.value)
													}
													placeholder="Cash receipt number or memo"
													disabled={rowReadOnly}
												/>
											</Field>
										)}
									</form.Field>
								)}

								{payment.method !== "cash" && !rowReadOnly && (
									<div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 dark:border-emerald-500/30 dark:bg-emerald-950/10">
										<input
											type="checkbox"
											id={`instant-verify-${index}`}
											checked={Boolean(payment.instantVerify)}
											onChange={(e) =>
												form.setFieldValue(
													`payments[${index}].instantVerify`,
													e.target.checked,
												)
											}
											className="mt-0.5 size-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
										/>
										<label
											htmlFor={`instant-verify-${index}`}
											className="flex flex-col cursor-pointer text-xs"
										>
											<span className="font-semibold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
												<CheckCircle2 className="size-3.5 text-emerald-600" />
												Instant Verification (Confirmed in Bank / Account)
											</span>
											<span className="text-muted-foreground mt-0.5">
												Funds already verified received in company account. Skips the finance verification queue and settles the invoice immediately.
											</span>
										</label>
									</div>
								)}
							</div>
						);
					})}

				<Button
					type="button"
					variant="outline"
					onClick={() => field.pushValue(blankPayment())}
					className="w-full border-dashed"
				>
					<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
					Add Payment
				</Button>
				</div>
			)}
		</form.Field>
	);
}
