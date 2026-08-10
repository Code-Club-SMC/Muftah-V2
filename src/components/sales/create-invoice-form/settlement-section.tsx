import {
	AlertCircle,
	ArrowRight,
	Calendar,
	CheckCircle2,
	CreditCard,
} from "lucide-react";
import { z } from "zod";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	blankPayment,
	calculatePaymentBreakdown,
	findDuplicatePaymentRows,
	PaymentRowsField,
	type PaymentInput,
} from "./payment-rows-field";
import { PKR, Section } from "./utils";

type WalletOption = {
	id: string;
	name: string;
	type: string;
};

type SettlementSectionProps = {
	form: any;
	totalAmount: number;
	totalProfit: number;
	expenses: number;
	isRetailerInvoice: boolean;
	invoiceDiscount: number;
	totalPayable: number;
	payments: PaymentInput[];
	wallets: WalletOption[];
	isEditing: boolean;
	handleFocus: (event: React.FocusEvent<HTMLInputElement>) => void;
};

export const SettlementSection = ({
	form,
	totalAmount,
	totalProfit,
	expenses,
	isRetailerInvoice,
	invoiceDiscount,
	totalPayable,
	payments,
	wallets,
	isEditing,
	handleFocus,
}: SettlementSectionProps) => {
	const roundedTotalProfit = Math.round(totalProfit);
	const breakdown = calculatePaymentBreakdown(totalPayable, payments);
	const cashWallet = wallets.find((wallet) => wallet.type === "cash");
	const duplicateRows = findDuplicatePaymentRows(payments);

	function setFullCashPayment() {
		if (!cashWallet) return;
		form.setFieldValue("payments", [
			{
				...blankPayment("cash"),
				amount: Number(totalPayable.toFixed(2)),
				walletId: cashWallet.id,
			},
		]);
	}

	return (
		<div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
			<div className="lg:col-span-2">
				<Section icon={CreditCard} title="Invoice Expense & Notes" step={4}>
					<div className="flex flex-col gap-4">
						<form.Field
							name="expenses"
							validators={{
								onChange: z.number().min(0, "Invalid amount"),
								onSubmit: z.number().min(0, "Invalid amount"),
							}}
						>
							{(field: any) => (
								<Field>
									<FieldLabel>Invoice Expense Amount</FieldLabel>
									<div className="relative">
										<Input
											type="number"
											min="0"
											step="0.01"
											className="pl-7"
											onFocus={handleFocus}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(
													event.target.value === ""
														? 0
														: Number(event.target.value),
												)
											}
											placeholder="0"
											aria-label="Expense amount"
										/>
										<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
											₨
										</span>
									</div>
									<FieldDescription>
										Shipping, loading charges, etc.
									</FieldDescription>
								</Field>
							)}
						</form.Field>

						<form.Field name="expensesDescription">
							{(field: any) => (
								<Field>
									<FieldLabel>Invoice Expense Details (optional)</FieldLabel>
									<Textarea
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										rows={2}
										placeholder="e.g. Loading charges, freight"
									/>
								</Field>
							)}
						</form.Field>

						<form.Field name="remarks">
							{(field: any) => (
								<Field>
									<FieldLabel>Remarks (optional)</FieldLabel>
									<Textarea
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										rows={2}
										placeholder="Invoice notes"
									/>
								</Field>
							)}
						</form.Field>

						{isRetailerInvoice && (
							<>
								<form.Field name="invoiceDiscount">
									{(field: any) => (
										<Field>
											<FieldLabel>Discount</FieldLabel>
											<Input
												type="number"
												min="0"
												step="0.01"
												value={field.state.value}
												onFocus={handleFocus}
												onChange={(event) =>
													field.handleChange(Number(event.target.value))
												}
											/>
											<FieldDescription>
												General-invoice discount.
											</FieldDescription>
										</Field>
									)}
								</form.Field>
								<form.Field name="invoiceDiscountDescription">
									{(field: any) => (
										<Field>
											<FieldLabel>Discount Note (optional)</FieldLabel>
											<Textarea
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												rows={2}
											/>
										</Field>
									)}
								</form.Field>
							</>
						)}
					</div>
				</Section>
			</div>

			<div className="lg:col-span-3">
				<Section
					icon={CreditCard}
					title="Settlement"
					subtitle={
						isEditing
							? "Existing payments are read-only. Use finance actions to change them."
							: "Add any payment received now, or leave the remainder for later."
					}
					step={5}
				>
					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Net Items Total</span>
								<span className="font-semibold tabular-nums">
									{PKR(totalAmount)}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Profit</span>
								<span
									className={cn(
										"font-semibold tabular-nums",
										roundedTotalProfit >= 0
											? "text-emerald-600"
											: "text-destructive",
									)}
								>
									{PKR(roundedTotalProfit)}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="flex items-center gap-1 text-muted-foreground">
									<ArrowRight className="size-3" /> Invoice Expense
								</span>
								<span className="font-semibold tabular-nums">
									{expenses > 0 ? PKR(expenses) : "—"}
								</span>
							</div>
							{isRetailerInvoice && (
								<div className="flex items-center justify-between text-sm">
									<span className="flex items-center gap-1 text-muted-foreground">
										<ArrowRight className="size-3" /> Discount
									</span>
									<span className="font-semibold tabular-nums">
										{invoiceDiscount > 0 ? `- ${PKR(invoiceDiscount)}` : "—"}
									</span>
								</div>
							)}
							<Separator />
						</div>

						{!isEditing && totalPayable > 0 && (
							<div className="grid gap-2 sm:grid-cols-2">
								<Button
									type="button"
									variant="outline"
									onClick={setFullCashPayment}
									disabled={!cashWallet}
								>
									<CheckCircle2 /> Paid in Full (Cash)
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => form.setFieldValue("payments", [])}
								>
									<CreditCard /> Pay Later
								</Button>
							</div>
						)}

						<PaymentRowsField
							form={form}
							payments={payments}
							wallets={wallets}
							readOnly={isEditing}
						/>

						{breakdown.overAllocatedAmount > 0 && (
							<div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="mt-0.5 size-4 shrink-0" />
								<div>
									<p className="font-medium">Payment amount is too high</p>
									<p className="text-xs">
										Reduce payments by {PKR(breakdown.overAllocatedAmount)}.
									</p>
								</div>
							</div>
						)}
						{duplicateRows.size > 0 && (
							<div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="mt-0.5 size-4 shrink-0" />
								Duplicate payment rows must be changed or removed.
							</div>
						)}

						<div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
							{[
								["Invoice Total", breakdown.invoiceTotal],
								["Paid Amount", breakdown.paidAmount],
								["Pending Verification", breakdown.pendingAmount],
								["Outstanding Amount", breakdown.outstandingAmount],
							].map(([label, amount]) => (
								<div key={label} className="flex flex-col gap-1 bg-card p-3">
									<span className="text-xs text-muted-foreground">{label}</span>
									<span className="font-semibold tabular-nums">
										{PKR(Number(amount))}
									</span>
								</div>
							))}
						</div>

						{breakdown.pendingAmount > 0 && (
							<p className="text-xs text-muted-foreground">
								Bank transfers and cheques stay inside Outstanding Amount until
								finance confirms them.
							</p>
						)}

						{breakdown.payLaterAmount > 0 && (
							<form.Field name="paymentDueDate">
								{(field: any) => (
									<Field data-invalid={!field.state.value || undefined}>
										<FieldLabel className="flex items-center gap-1.5">
											<Calendar className="size-3.5" /> Payment Due Date
											<span className="text-destructive">*</span>
										</FieldLabel>
										<DatePicker
											date={
												field.state.value
													? new Date(field.state.value)
													: undefined
											}
											onChange={(date) => {
												if (!date) {
													field.handleChange("");
													return;
												}
												field.handleChange(formatDateInput(date));
											}}
											placeholder="Select payment due date"
											className="w-full"
										/>
										<FieldDescription>
											The distributor will pay {PKR(breakdown.payLaterAmount)}{" "}
											later.
										</FieldDescription>
									</Field>
								)}
							</form.Field>
						)}
					</div>
				</Section>
			</div>
		</div>
	);
};

function formatDateInput(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
