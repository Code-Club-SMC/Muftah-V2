import {
	AlertCircleIcon,
	BankIcon,
	CheckmarkCircle02Icon,
	Clock01Icon,
	Invoice01Icon,
	RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	type PaymentSettlementRow,
	type PaymentSettlementView,
	useCancelBankTransfer,
	useClearCheque,
	useConfirmBankTransfer,
	usePaymentSettlements,
	useReturnCheque,
	useReversePayment,
} from "@/hooks/sales/use-payment-settlement";
import { formatPKRPrecise } from "@/lib/currency-format";

type SettlementAction =
	| "confirm-bank"
	| "clear-cheque"
	| "return-cheque"
	| "cancel-bank"
	| "reverse";

type DialogState = {
	action: SettlementAction;
	payment: PaymentSettlementRow;
};

const actionCopy: Record<
	SettlementAction,
	{ title: string; description: string; submit: string; destructive?: boolean }
> = {
	"confirm-bank": {
		title: "Confirm bank transfer",
		description:
			"Confirm only after the money appears in the selected company account.",
		submit: "Confirm transfer",
	},
	"clear-cheque": {
		title: "Mark cheque as cleared",
		description:
			"Use the date the bank actually cleared and received this cheque.",
		submit: "Cheque Cleared",
	},
	"return-cheque": {
		title: "Mark cheque as returned",
		description: "Bank did not clear this cheque.",
		submit: "Cheque Returned",
		destructive: true,
	},
	"cancel-bank": {
		title: "Cancel bank transfer",
		description:
			"Use this when the transfer could not be verified or was entered by mistake.",
		submit: "Cancel transfer",
		destructive: true,
	},
	reverse: {
		title: "Reverse confirmed payment",
		description:
			"This removes the payment from the invoice and adds the amount back to Outstanding Amount.",
		submit: "Reverse payment",
		destructive: true,
	},
};

function toLocalDateTimeValue(date = new Date()) {
	return format(date, "yyyy-MM-dd'T'HH:mm");
}

function displayDate(value: Date | string | null | undefined) {
	return value ? format(new Date(value), "dd MMM yyyy, h:mm a") : "—";
}

function methodLabel(method: PaymentSettlementRow["method"]) {
	switch (method) {
		case "bank_transfer":
			return "Bank transfer";
		case "cheque":
			return "Cheque";
		case "expense_offset":
			return "Expense offset";
		default:
			return "Cash";
	}
}

function statusLabel(status: PaymentSettlementRow["status"]) {
	switch (status) {
		case "pending":
			return "Pending Verification";
		case "confirmed":
			return "Confirmed";
		case "returned":
			return "Cheque Returned";
		case "cancelled":
			return "Cancelled";
		case "reversed":
			return "Reversed";
	}
}

function statusVariant(status: PaymentSettlementRow["status"]) {
	if (status === "confirmed") return "default" as const;
	if (status === "pending") return "secondary" as const;
	if (status === "returned" || status === "reversed") {
		return "destructive" as const;
	}
	return "outline" as const;
}

export function PaymentVerificationPage() {
	const [view, setView] = useState<PaymentSettlementView>("pending");
	const [page, setPage] = useState(1);
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [effectiveDate, setEffectiveDate] = useState(toLocalDateTimeValue);
	const [paymentDueDate, setPaymentDueDate] = useState("");
	const [reason, setReason] = useState("");

	const filters = useMemo(() => ({ view, page, limit: 25 }), [view, page]);
	const settlementQuery = usePaymentSettlements(filters);
	const confirmBank = useConfirmBankTransfer();
	const clearCheque = useClearCheque();
	const returnCheque = useReturnCheque();
	const cancelBank = useCancelBankTransfer();
	const reversePayment = useReversePayment();

	const activeMutation =
		dialog?.action === "confirm-bank"
			? confirmBank
			: dialog?.action === "clear-cheque"
				? clearCheque
				: dialog?.action === "return-cheque"
					? returnCheque
					: dialog?.action === "cancel-bank"
						? cancelBank
						: reversePayment;

	function openDialog(action: SettlementAction, payment: PaymentSettlementRow) {
		setEffectiveDate(toLocalDateTimeValue());
		setPaymentDueDate(
			payment.invoice?.paymentDueDate
				? format(new Date(payment.invoice.paymentDueDate), "yyyy-MM-dd")
				: "",
		);
		setReason("");
		setDialog({ action, payment });
	}

	function closeDialog() {
		if (!activeMutation.isPending) setDialog(null);
	}

	async function submitAction() {
		if (!dialog) return;
		const paymentId = dialog.payment.id;
		const dueDate = paymentDueDate
			? new Date(`${paymentDueDate}T12:00:00`)
			: undefined;

		try {
			switch (dialog.action) {
				case "confirm-bank":
					await confirmBank.mutateAsync({
						paymentId,
						effectiveDate: new Date(effectiveDate),
					});
					break;
				case "clear-cheque":
					await clearCheque.mutateAsync({
						paymentId,
						effectiveDate: new Date(effectiveDate),
					});
					break;
				case "return-cheque":
					await returnCheque.mutateAsync({
						paymentId,
						reason,
						paymentDueDate: dueDate,
					});
					break;
				case "cancel-bank":
					await cancelBank.mutateAsync({
						paymentId,
						reason,
						paymentDueDate: dueDate,
					});
					break;
				case "reverse":
					await reversePayment.mutateAsync({
						paymentId,
						effectiveDate: new Date(effectiveDate),
						reason,
						paymentDueDate: dueDate,
					});
					break;
			}
			setDialog(null);
		} catch {
			// Keep the dialog and entered values open so the operator can retry.
		}
	}

	const needsEffectiveDate =
		dialog?.action === "confirm-bank" ||
		dialog?.action === "clear-cheque" ||
		dialog?.action === "reverse";
	const needsReason =
		dialog?.action === "return-cheque" ||
		dialog?.action === "cancel-bank" ||
		dialog?.action === "reverse";
	const canSubmit =
		Boolean(dialog) &&
		(!needsEffectiveDate || Boolean(effectiveDate)) &&
		(!needsReason || reason.trim().length >= 3);

	return (
		<div className="flex min-h-full flex-col gap-6">
			<header className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex max-w-2xl flex-col gap-2">
					<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
						<HugeiconsIcon icon={BankIcon} strokeWidth={2} />
						Finance control desk
					</div>
					<h1 className="text-3xl font-bold tracking-tight">
						Payment Verification
					</h1>
					<p className="text-muted-foreground">
						Check bank transfers and cheques before they reduce an
						invoice&apos;s Outstanding Amount.
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={() => settlementQuery.refetch()}
					disabled={settlementQuery.isFetching}
				>
					{settlementQuery.isFetching ? (
						<Spinner />
					) : (
						<HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
					)}
					Refresh
				</Button>
			</header>

			<Card>
				<CardHeader className="border-b">
					<CardTitle>
						{view === "pending"
							? "Payments waiting for review"
							: "Payment history"}
					</CardTitle>
					<CardDescription>
						{view === "pending"
							? "These amounts are still included in Outstanding Amount."
							: "Confirmed, returned, cancelled, and reversed payment records."}
					</CardDescription>
					<CardAction>
						<Badge variant={view === "pending" ? "secondary" : "outline"}>
							{settlementQuery.data?.total ?? 0} records
						</Badge>
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					<Tabs
						value={view}
						onValueChange={(value) => {
							setView(value as PaymentSettlementView);
							setPage(1);
						}}
					>
						<TabsList aria-label="Payment verification views">
							<TabsTrigger value="pending">
								<HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
								Pending Verification
							</TabsTrigger>
							<TabsTrigger value="history">
								<HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
								Payment History
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{settlementQuery.isPending ? (
						<div className="flex min-h-72 items-center justify-center gap-2 text-muted-foreground">
							<Spinner />
							Loading payments...
						</div>
					) : settlementQuery.isError ? (
						<Empty className="min-h-72 border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
								</EmptyMedia>
								<EmptyTitle>Could not load payments</EmptyTitle>
								<EmptyDescription>
									Check the connection and try again. No payment was changed.
								</EmptyDescription>
							</EmptyHeader>
							<Button
								type="button"
								variant="outline"
								onClick={() => settlementQuery.refetch()}
							>
								Try again
							</Button>
						</Empty>
					) : settlementQuery.data.data.length === 0 ? (
						<Empty className="min-h-72 border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HugeiconsIcon icon={Invoice01Icon} strokeWidth={2} />
								</EmptyMedia>
								<EmptyTitle>
									{view === "pending"
										? "Nothing needs review"
										: "No payment history yet"}
								</EmptyTitle>
								<EmptyDescription>
									{view === "pending"
										? "New bank transfers and cheques will appear here."
										: "Completed payment decisions will appear here."}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Invoice / distributor</TableHead>
									<TableHead>Method</TableHead>
									<TableHead>Payment details</TableHead>
									<TableHead>Date recorded</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Amount</TableHead>
									<TableHead className="text-right">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{settlementQuery.data.data.map((payment) => (
									<TableRow key={payment.id}>
										<TableCell>
											<div className="flex flex-col gap-1">
												<span className="font-medium">
													{payment.invoice?.invoiceNumber ?? "Unknown invoice"}
												</span>
												<span className="text-xs text-muted-foreground">
													{payment.customer?.name ?? "Unknown distributor"}
												</span>
											</div>
										</TableCell>
										<TableCell>{methodLabel(payment.method)}</TableCell>
										<TableCell>
											<div className="flex max-w-56 flex-col gap-1 text-xs">
												{payment.method === "cheque" && (
													<span>
														{payment.chequeBank} · Cheque {payment.chequeNumber}
													</span>
												)}
												{payment.method === "bank_transfer" && (
													<span>Reference: {payment.reference}</span>
												)}
												<span className="text-muted-foreground">
													Account: {payment.wallet?.name ?? "Not available"}
												</span>
											</div>
										</TableCell>
										<TableCell>
											<div className="flex flex-col gap-1">
												<span>{displayDate(payment.paymentDate)}</span>
												{payment.status === "pending" && (
													<span className="text-xs text-muted-foreground">
														Waiting {payment.ageDays} day
														{payment.ageDays === 1 ? "" : "s"}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={statusVariant(payment.status)}>
												{statusLabel(payment.status)}
											</Badge>
										</TableCell>
										<TableCell className="text-right font-semibold tabular-nums">
											{formatPKRPrecise(payment.amount)}
										</TableCell>
										<TableCell>
											<div className="flex justify-end gap-2">
												{payment.status === "pending" &&
													payment.method === "bank_transfer" && (
														<>
															<Button
																size="sm"
																onClick={() =>
																	openDialog("confirm-bank", payment)
																}
															>
																Confirm
															</Button>
															<Button
																size="sm"
																variant="outline"
																onClick={() =>
																	openDialog("cancel-bank", payment)
																}
															>
																Cancel
															</Button>
														</>
													)}
												{payment.status === "pending" &&
													payment.method === "cheque" && (
														<>
															<Button
																size="sm"
																onClick={() =>
																	openDialog("clear-cheque", payment)
																}
															>
																Cheque Cleared
															</Button>
															<Button
																size="sm"
																variant="destructive"
																onClick={() =>
																	openDialog("return-cheque", payment)
																}
															>
																Cheque Returned
															</Button>
														</>
													)}
												{payment.status === "confirmed" &&
													payment.method !== "expense_offset" && (
														<Button
															size="sm"
															variant="outline"
															onClick={() => openDialog("reverse", payment)}
														>
															Reverse
														</Button>
													)}
												{payment.status !== "pending" &&
													payment.status !== "confirmed" && (
														<span className="text-xs text-muted-foreground">
															No action
														</span>
													)}
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
				{settlementQuery.data && settlementQuery.data.pageCount > 1 && (
					<CardFooter className="justify-between border-t">
						<span className="text-sm text-muted-foreground">
							Page {page} of {settlementQuery.data.pageCount}
						</span>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={page === 1}
								onClick={() => setPage((value) => value - 1)}
							>
								Previous
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={page >= settlementQuery.data.pageCount}
								onClick={() => setPage((value) => value + 1)}
							>
								Next
							</Button>
						</div>
					</CardFooter>
				)}
			</Card>

			<Dialog
				open={Boolean(dialog)}
				onOpenChange={(open) => !open && closeDialog()}
			>
				<DialogContent>
					{dialog && (
						<>
							<DialogHeader>
								<DialogTitle>{actionCopy[dialog.action].title}</DialogTitle>
								<DialogDescription>
									{actionCopy[dialog.action].description}
								</DialogDescription>
							</DialogHeader>

							<div className="rounded-xl border bg-muted/30 p-4">
								<div className="flex items-center justify-between gap-4">
									<div className="flex flex-col gap-1">
										<span className="font-medium">
											{dialog.payment.invoice?.invoiceNumber}
										</span>
										<span className="text-xs text-muted-foreground">
											{dialog.payment.customer?.name}
										</span>
									</div>
									<span className="font-semibold tabular-nums">
										{formatPKRPrecise(dialog.payment.amount)}
									</span>
								</div>
							</div>

							<FieldGroup>
								{needsEffectiveDate && (
									<Field>
										<FieldLabel htmlFor="settlement-effective-date">
											{dialog.action === "reverse"
												? "Reversal date and time"
												: "Money received date and time"}
										</FieldLabel>
										<Input
											id="settlement-effective-date"
											type="datetime-local"
											value={effectiveDate}
											onChange={(event) => setEffectiveDate(event.target.value)}
											required
										/>
									</Field>
								)}
								{needsReason && (
									<>
										<Field>
											<FieldLabel htmlFor="settlement-reason">
												Reason
											</FieldLabel>
											<Textarea
												id="settlement-reason"
												value={reason}
												onChange={(event) => setReason(event.target.value)}
												placeholder="Write a clear reason for the audit history"
												rows={3}
												required
											/>
											<FieldDescription>
												At least 3 characters. This note stays in the invoice
												history.
											</FieldDescription>
										</Field>
										<Field>
											<FieldLabel htmlFor="settlement-due-date">
												New Payment Due Date (optional)
											</FieldLabel>
											<Input
												id="settlement-due-date"
												type="date"
												value={paymentDueDate}
												onChange={(event) =>
													setPaymentDueDate(event.target.value)
												}
											/>
											<FieldDescription>
												Leave unchanged unless the distributor received a new
												payment date.
											</FieldDescription>
										</Field>
									</>
								)}
							</FieldGroup>

							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={closeDialog}
									disabled={activeMutation.isPending}
								>
									Keep unchanged
								</Button>
								<Button
									type="button"
									variant={
										actionCopy[dialog.action].destructive
											? "destructive"
											: "default"
									}
									onClick={submitAction}
									disabled={!canSubmit || activeMutation.isPending}
								>
									{activeMutation.isPending && <Spinner />}
									{actionCopy[dialog.action].submit}
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
