import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import {
  useDecideSalesReturn,
  useCompleteSalesReturn,
  useCancelSalesReturn,
  useVoidSalesReturn,
  useSalesReturnDetail,
} from "@/hooks/sales/use-sales-returns";
import { getReturnUnitsPerCarton } from "@/lib/sales/returns/refund-pricing";
import {
  availableReturnActions,
  checkInspection,
  receivedUnits,
  requestedUnits,
  shortUnits,
  type ReturnAction,
} from "@/lib/sales/returns/return-lifecycle";

export type ReturnLifecycleItem = { id: string; label: string; approvedUnits: number };

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
}) {
  const { data: viewer } = useViewerAccess();
  const canRead = !!viewer && hasPermission(viewer.permissions, "sales.view");
  const canApprove = canRead && hasPermission(viewer?.permissions ?? [], "sales.returns.approve");
  const canReceive = canRead && hasPermission(viewer?.permissions ?? [], "inventory.returns.receive");
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

  async function submit(nextAction: ReturnAction) {
    if (submitting.current || pending || !effectiveActions.includes(nextAction)) return;
    if (nextAction !== "approve" && !valid) return;
    submitting.current = true;
    setError("");
    try {
      if (nextAction === "approve" || nextAction === "reject") {
        await decide.mutateAsync({ returnId, action: nextAction, ...(nextAction === "reject" ? { reason: reason.trim() } : {}) });
      } else if (nextAction === "receive") {
        checkInspection(inspection);
        await complete.mutateAsync({ returnId, notes: notes.trim() || undefined, lines: inspection.map(line => ({ returnItemId: line.id, goodUnits: line.goodUnits, damagedUnits: line.damagedUnits, expiredUnits: line.expiredUnits })) });
      } else if (nextAction === "cancel") {
        await cancel.mutateAsync({ returnId, reason: reason.trim() });
      } else {
        await voidReceipt.mutateAsync({ returnId, reason: reason.trim() });
      }
      setAction(null);
      if (nextAction === "receive") onReceiveCompleted?.();
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

  return (
    <div className="flex flex-col gap-2">
      {!hideButtons && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(action => <Button key={action} size="sm" variant={action === "approve" || action === "receive" ? "default" : "outline"} disabled={pending} onClick={() => action === "approve" ? void submit(action) : open(action)}>{labels[action]}</Button>)}
        </div>
      )}
      {!action && error && <p role="alert">{error}</p>}
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
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={dismissDialog}>
                {action === "receive" ? "Close without confirming" : "Close"}
              </Button>
              <Button type="submit" disabled={pending || !valid}>{pending ? "Saving..." : action === "receive" ? "Confirm receipt" : action ? labels[action] : "Confirm"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
