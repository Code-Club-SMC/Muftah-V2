import { useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import {
  useDecideSalesReturn,
  useCompleteSalesReturn,
  useCancelSalesReturn,
  useVoidSalesReturn,
  useSalesReturnDetail,
} from "@/hooks/sales/use-sales-returns";
import { useWallets } from "@/hooks/finance/use-finance";
import { useIssueCustomerRefund } from "@/hooks/sales/use-customer-credit";
import { OverdrawConfirmDialog } from "@/components/finance/overdraw-confirm-dialog";
import { CreditNotePrintDialog } from "./credit-note-print-dialog";
import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
import {
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  parseAmountInput,
} from "@/lib/finance/expense-entry";
import { getReturnUnitsPerCarton } from "@/lib/sales/returns/refund-pricing";
import {
  availableReturnActions,
  checkInspection,
  parseVoidBlockedByRefundError,
  receivedUnits,
  requestedUnits,
  shortUnits,
  type ReturnAction,
} from "@/lib/sales/returns/return-lifecycle";

export type ReturnLifecycleItem = { id: string; label: string; approvedUnits: number };

type SettledCreditNoteResult = {
  returnId: string;
  creditNoteNumber: string;
  totalAmount: number;
  appliedToInvoiceAmount: number;
  customerCreditAmount: number;
  customerId: string;
  customerName: string;
  customerType: string;
  invoiceNumber: string;
  leftoverCreditBalance: number;
};

const labels: Record<ReturnAction, string> = {
  approve: "Approve", reject: "Reject", receive: "Receive", cancel: "Cancel return", void: "Void receipt",
};

export function ReturnLifecycleActions({
  invoiceId,
  returnId,
  returnNumber,
  status,
  items,
  defaultOpenReceive = false,
  hideButtons = false,
  onReceiveCompleted,
  onReceiveClosedWithoutConfirm,
  creditNoteNumber,
}: {
  invoiceId: string;
  returnId: string;
  returnNumber?: number;
  status: string;
  items?: ReturnLifecycleItem[];
  defaultOpenReceive?: boolean;
  hideButtons?: boolean;
  onReceiveCompleted?: () => void;
  onReceiveClosedWithoutConfirm?: () => void;
  creditNoteNumber?: string | null;
}) {
  const { data: viewer } = useViewerAccess();
  const canRead = !!viewer && hasPermission(viewer.permissions, "sales.view");
  const canApprove = canRead && hasPermission(viewer?.permissions ?? [], "sales.returns.approve");
  const canReceive = canRead && hasPermission(viewer?.permissions ?? [], "inventory.returns.receive");
  const canIssueRefund = canRead && hasPermission(viewer?.permissions ?? [], "finance.refunds.issue");
  const actions = availableReturnActions(status, {
    approve: canApprove,
    receive: canReceive,
  });
  const decide = useDecideSalesReturn(invoiceId);
  const complete = useCompleteSalesReturn(invoiceId);
  const cancel = useCancelSalesReturn(invoiceId);
  const voidReceipt = useVoidSalesReturn(invoiceId);
  const pending = decide.isPending || complete.isPending || cancel.isPending || voidReceipt.isPending;
  const submitting = useRef(false);
  const [action, setAction] = useState<ReturnAction | null>(() =>
    defaultOpenReceive && actions.includes("receive") ? "receive" : null,
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Array<{ returnItemId: string; goodUnits: string; damagedUnits: string; expiredUnits: string }>>([]);

  const [settledCreditNote, setSettledCreditNote] = useState<SettledCreditNoteResult | null>(null);
  const [settlementChoice, setSettlementChoice] = useState<"keep" | "refund">("keep");
  const [refundWalletId, setRefundWalletId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundDate, setRefundDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [refundNotes, setRefundNotes] = useState("");
  const [refundError, setRefundError] = useState("");
  const [overdrawOpen, setOverdrawOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const walletsQuery = useWallets({
    enabled: Boolean(settledCreditNote) && settlementChoice === "refund",
  });
  const issueRefund = useIssueCustomerRefund(settledCreditNote?.customerId);

  const selectedWallet = (walletsQuery.data ?? []).find(
    (w: any) => w.id === refundWalletId,
  );

  const needsDetail = action === "receive" && items === undefined;
  const detailQuery = useSalesReturnDetail(needsDetail ? returnId : null);
  const waitingForDetail = needsDetail && (detailQuery.isLoading || detailQuery.isError || !detailQuery.data);
  const effectiveStatus = needsDetail && detailQuery.data ? detailQuery.data.status : status;
  const effectiveActions = availableReturnActions(effectiveStatus, {
    approve: canApprove,
    receive: canReceive,
  });
  const resolvedItems: ReturnLifecycleItem[] = items ?? (
    detailQuery.data
      ? detailQuery.data.items.map(line => ({
          id: line.id,
          label: line.invoiceItem.pack,
          approvedUnits: requestedUnits(line, getReturnUnitsPerCarton(line.invoiceItem)),
        }))
      : []
  );

  // Read current requested limits after a stale-detail refresh; never fill inspection from them.
  const inspection = resolvedItems.map(item => {
    const line = lines.find(line => line.returnItemId === item.id);
    return { ...item, goodUnits: Number(line?.goodUnits ?? ""), damagedUnits: Number(line?.damagedUnits ?? ""), expiredUnits: Number(line?.expiredUnits ?? "") };
  });
  let inspectionError = "";
  try { checkInspection(inspection); } catch (error) { inspectionError = (error as Error).message; }
  const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 500;
  const valid =
    !!action &&
    effectiveActions.includes(action) &&
    !waitingForDetail &&
    (action === "receive" ? resolvedItems.length > 0 && !inspectionError : reasonValid);

  function open(nextAction: ReturnAction) {
    if (submitting.current || !actions.includes(nextAction)) return;
    setError(""); setReason(""); setNotes("");
    setLines((items ?? []).map(item => ({ returnItemId: item.id, goodUnits: "", damagedUnits: "", expiredUnits: "" })));
    setAction(nextAction);
  }

  function updateLineValue(itemId: string, key: "goodUnits" | "damagedUnits" | "expiredUnits", value: string) {
    setLines(current => {
      if (current.some(line => line.returnItemId === itemId)) {
        return current.map(line => (line.returnItemId === itemId ? { ...line, [key]: value } : line));
      }
      return [...current, { returnItemId: itemId, goodUnits: "", damagedUnits: "", expiredUnits: "", [key]: value }];
    });
  }

  function closeScreen4() {
    setSettledCreditNote(null);
    onReceiveCompleted?.();
  }

  async function handleRecordRefund(allowOverdraw: boolean) {
    if (!settledCreditNote || !refundWalletId) return;
    const amount = parseAmountInput(refundAmount);
    if (amount <= 0) return;
    setRefundError("");
    try {
      await issueRefund.mutateAsync({
        customerId: settledCreditNote.customerId,
        amount,
        walletId: refundWalletId,
        refundDate: refundDate ? new Date(refundDate) : undefined,
        notes: refundNotes.trim() || undefined,
        salesReturnId: settledCreditNote.returnId,
        allowOverdraw,
      });
      setOverdrawOpen(false);
      closeScreen4();
    } catch (err) {
      if (isOverdrawConfirmError(err)) {
        setOverdrawOpen(true);
      } else {
        setRefundError(err instanceof Error ? err.message : "Failed to record refund");
      }
    }
  }

  async function submit(nextAction: ReturnAction) {
    if (submitting.current || pending || !effectiveActions.includes(nextAction)) return;
    if (nextAction !== "approve" && !valid) return;
    submitting.current = true;
    setError("");
    try {
      if (nextAction === "approve" || nextAction === "reject") {
        await decide.mutateAsync({ returnId, action: nextAction, ...(nextAction === "reject" ? { reason: reason.trim() } : {}) });
        setAction(null);
      } else if (nextAction === "receive") {
        checkInspection(inspection);
        const result = await complete.mutateAsync({
          returnId,
          notes: notes.trim() || undefined,
          lines: inspection.map(line => ({
            returnItemId: line.id,
            goodUnits: line.goodUnits,
            damagedUnits: line.damagedUnits,
            expiredUnits: line.expiredUnits,
          })),
        });
        if (
          result &&
          typeof result === "object" &&
          "creditNoteNumber" in result &&
          Boolean((result as { creditNoteNumber?: string | null }).creditNoteNumber)
        ) {
          const cn = result as unknown as SettledCreditNoteResult;
          setSettledCreditNote({ ...cn, returnId });
          setSettlementChoice("keep");
          setRefundWalletId("");
          setRefundAmount(String(cn.customerCreditAmount ?? 0));
          setRefundDate(format(new Date(), "yyyy-MM-dd"));
          setRefundNotes("");
          setRefundError("");
          setAction(null);
        } else {
          setAction(null);
          onReceiveCompleted?.();
        }
      } else if (nextAction === "cancel") {
        await cancel.mutateAsync({ returnId, reason: reason.trim() });
        setAction(null);
      } else {
        await voidReceipt.mutateAsync({ returnId, reason: reason.trim() });
        setAction(null);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Return action failed. Your entries have been kept.");
    } finally {
      submitting.current = false;
    }
  }

  function dismissDialog() {
    if (submitting.current) return;
    const closingReceive = action === "receive";
    setAction(null);
    if (closingReceive) {
      toast.warning?.(
        `Receipt not confirmed${returnNumber ? ` for Return #${returnNumber}` : ""}. Return stays approved with no stock or balance change.`,
      );
      onReceiveClosedWithoutConfirm?.();
    }
  }

  const voidBlocked = error ? parseVoidBlockedByRefundError(new Error(error)) : null;

  return (
    <div className="flex flex-col gap-2">
      {!hideButtons && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(action => (
            <Button
              key={action}
              size="sm"
              variant={action === "approve" || action === "receive" ? "default" : "outline"}
              disabled={pending}
              onClick={() => (action === "approve" ? void submit(action) : open(action))}
            >
              {labels[action]}
            </Button>
          ))}
        </div>
      )}
      {voidBlocked ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1.5">
            <p>{voidBlocked.displayMessage}</p>
            <Link
              to={
                voidBlocked.customerType === "distributor"
                  ? "/sales/people/distributors/$customerId"
                  : voidBlocked.customerType === "shopkeeper"
                    ? "/sales/people/shopkeepers/$customerId"
                    : "/sales/customers/$customerId"
              }
              params={{ customerId: voidBlocked.customerId }}
              className="inline-block font-semibold underline"
            >
              Open customer profile to reverse refund
            </Link>
          </AlertDescription>
        </Alert>
      ) : !action && error ? (
        <p role="alert">{error}</p>
      ) : null}
      <Dialog open={!!action} onOpenChange={nextOpen => { if (!nextOpen) dismissDialog(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton={!pending}>
          <form onSubmit={event => { event.preventDefault(); if (action) void submit(action); }} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{action ? labels[action] : "Return"}</DialogTitle>
              <DialogDescription>
                {action === "receive" ? "Enter inspected packs, not cartons. Good packs enter sellable stock; damaged and expired packs stay segregated. Only received packs credit the invoice. This closes the request, including any shortfall."
                  : action === "void" ? "Reverse this receipt's stock and invoice credit. Receipt facts are retained. Stock shortage can block the entire void."
                  : "Give a reason. This releases the request without moving stock or invoice credit."}
              </DialogDescription>
            </DialogHeader>
            {action === "receive" && (
              <div
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
              >
                Receipt is not confirmed yet. Stock and customer balance will not change until you click Confirm receipt.
              </div>
            )}
            <fieldset disabled={pending}>
              <FieldGroup>
                {action === "receive" ? (
                  needsDetail && detailQuery.isLoading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : needsDetail && detailQuery.isError ? (
                    <div className="flex flex-col gap-2">
                      <p role="alert" className="text-sm text-destructive">
                        {detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load return items."}
                      </p>
                      <Button type="button" variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <>
                      {resolvedItems.map(item => {
                        const line = lines.find(line => line.returnItemId === item.id);
                        return <FieldGroup key={item.id}>
                          <p>{item.label}: requested {item.approvedUnits} packs</p>
                          <div className="grid grid-cols-3 gap-3">
                            {(["goodUnits", "damagedUnits", "expiredUnits"] as const).map(key => {
                              const condition = key.replace("Units", "");
                              const id = `${returnId}-${item.id}-${key}`;
                              return <Field key={key}>
                                <Label htmlFor={id}>{item.label} {condition} packs</Label>
                                <Input id={id} type="number" min={0} max={item.approvedUnits} step={1} placeholder="0" value={line?.[key] ?? ""} onChange={event => updateLineValue(item.id, key, event.target.value)} />
                              </Field>;
                            })}
                          </div>
                        </FieldGroup>;
                      })}
                      <p>Received: {inspection.reduce((sum, line) => sum + receivedUnits(line), 0)} packs. Shortfall: {inspection.reduce((sum, line) => sum + shortUnits(line), 0)} packs. The shortfall is released when this receipt closes the request.</p>
                      {inspectionError && <p className="text-destructive">{inspectionError}</p>}
                      <Field><Label htmlFor={`${returnId}-receipt-notes`}>Inspection notes</Label><Textarea id={`${returnId}-receipt-notes`} value={notes} maxLength={1000} onChange={event => setNotes(event.target.value)} /></Field>
                    </>
                  )
                ) : <Field>
                  <Label htmlFor={`${returnId}-action-reason`}>Reason</Label>
                  <Textarea id={`${returnId}-action-reason`} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
                </Field>}
              </FieldGroup>
            </fieldset>
            {action && !effectiveActions.includes(action) && !waitingForDetail && <p role="alert">This action is no longer available. Invoice details have refreshed; your entries are kept.</p>}
            {voidBlocked ? (
              <Alert variant="destructive">
                <AlertDescription className="space-y-1.5">
                  <p>{voidBlocked.displayMessage}</p>
                  <Link
                    to={
                      voidBlocked.customerType === "distributor"
                        ? "/sales/people/distributors/$customerId"
                        : voidBlocked.customerType === "shopkeeper"
                          ? "/sales/people/shopkeepers/$customerId"
                          : "/sales/customers/$customerId"
                    }
                    params={{ customerId: voidBlocked.customerId }}
                    className="inline-block font-semibold underline"
                  >
                    Open customer profile to reverse refund
                  </Link>
                </AlertDescription>
              </Alert>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={dismissDialog}>
                {action === "receive" ? "Close without confirming" : "Close"}
              </Button>
              <Button type="submit" disabled={pending || !valid}>{pending ? "Saving..." : action === "receive" ? "Confirm receipt" : action ? labels[action] : "Confirm"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(settledCreditNote)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !issueRefund.isPending) {
            closeScreen4();
          }
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto" showCloseButton={!issueRefund.isPending}>
          <DialogHeader>
            <DialogTitle>Credit Note Issued</DialogTitle>
            <DialogDescription>
              Return has been completed and Credit Note has been generated.
            </DialogDescription>
          </DialogHeader>

          {settledCreditNote && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-bold">
                    {settledCreditNote.creditNoteNumber}
                  </span>
                  <span className="text-sm font-semibold">{settledCreditNote.customerName}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Invoice #{settledCreditNote.invoiceNumber}
                </p>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                  <div>
                    <span className="text-muted-foreground block">Credit Note Total</span>
                    <span className="font-bold tabular-nums text-sm">
                      {formatRupees(settledCreditNote.totalAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Applied to Invoice</span>
                    <span className="font-semibold tabular-nums text-sm">
                      {formatRupees(settledCreditNote.appliedToInvoiceAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Transferred to Credit</span>
                    <span className="font-semibold tabular-nums text-sm text-emerald-600">
                      {formatRupees(settledCreditNote.customerCreditAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {settledCreditNote.customerCreditAmount > 0 && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="text-xs font-medium">Customer Credit Settlement</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={settlementChoice === "keep" ? "default" : "outline"}
                      onClick={() => setSettlementChoice("keep")}
                    >
                      Keep as Store Credit
                    </Button>
                    {canIssueRefund ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={settlementChoice === "refund" ? "default" : "outline"}
                        onClick={() => setSettlementChoice("refund")}
                      >
                        Refund Cash / Bank Now
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground self-center">
                        Permission finance.refunds.issue required to issue a cash or bank refund.
                      </p>
                    )}
                  </div>

                  {settlementChoice === "refund" && canIssueRefund && (
                    <div className="space-y-3 pt-2 border-t">
                      <div className="space-y-1">
                        <Label htmlFor="refund-account">Refund from account</Label>
                        <Select value={refundWalletId} onValueChange={setRefundWalletId}>
                          <SelectTrigger id="refund-account" aria-label="Refund from account" className="w-full">
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {(walletsQuery.data ?? [])
                              .filter((w: any) => !w.archived)
                              .map((w: any) => (
                                <SelectItem key={w.id} value={w.id}>
                                  {w.name} ({formatRupees(w.balance)})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="refund-amount">Amount</Label>
                          <Input
                            id="refund-amount"
                            type="text"
                            value={refundAmount}
                            onChange={(e) => setRefundAmount(formatAmountInput(e.target.value))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="refund-date">Date</Label>
                          <Input
                            id="refund-date"
                            type="date"
                            value={refundDate}
                            onChange={(e) => setRefundDate(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="refund-notes">Notes</Label>
                        <Input
                          id="refund-notes"
                          placeholder="Optional notes"
                          value={refundNotes}
                          onChange={(e) => setRefundNotes(e.target.value)}
                        />
                      </div>

                      {refundError && (
                        <p role="alert" className="text-xs text-destructive">
                          {refundError}
                        </p>
                      )}

                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!refundWalletId || !parseAmountInput(refundAmount) || issueRefund.isPending}
                          onClick={() => void handleRecordRefund(false)}
                        >
                          {issueRefund.isPending ? "Recording..." : "Record refund"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="flex flex-row items-center justify-between sm:justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPrintOpen(true)}
                  className="gap-1.5"
                >
                  <Printer className="size-4" />
                  Print credit note
                </Button>
                <Button type="button" onClick={closeScreen4}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <OverdrawConfirmDialog
        open={overdrawOpen}
        onOpenChange={setOverdrawOpen}
        walletName={selectedWallet?.name ?? "This account"}
        balance={selectedWallet?.balance ?? "0"}
        balanceAfter={
          selectedWallet
            ? getBalanceAfter(selectedWallet.balance, parseAmountInput(refundAmount))
            : "0"
        }
        onConfirm={() => void handleRecordRefund(true)}
        pending={issueRefund.isPending}
        descriptionLabel="refund"
      />

      {(creditNoteNumber || settledCreditNote) && (
        <CreditNotePrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          returnId={settledCreditNote?.returnId ?? returnId}
        />
      )}
    </div>
  );
}
