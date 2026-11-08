import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useCreateSalesReturn, useReturnReasons } from "@/hooks/sales/use-sales-returns";
import { reservedReturnUnits, type ReturnLineQuantities } from "@/lib/sales/returns/return-lifecycle";
import { Field, FieldGroup } from "@/components/ui/field";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnUnitsPerCarton,
  sumMoney,
} from "@/lib/sales/returns/refund-pricing";
import Big from "big.js";
import { RotateCcw } from "lucide-react";

interface ReturnableItem {
  id: string;
  pack: string;
  numberOfCartons: number;
  quantity: number;
  packsPerCarton: number;
  actualPackSize: number;
  amount: string;
  recipe: { id: string; name: string } | null;
}

interface ExistingReturn {
  status: string;
  items: Array<ReturnLineQuantities & { invoiceItem: { id: string } | null }>;
}

interface CreateReturnDialogProps {
  invoiceId: string;
  invoiceDiscount: string | null;
  items: ReturnableItem[];
  returns: ExistingReturn[];
  trigger?: React.ReactNode;
}

function getUnitsPerCarton(item: ReturnableItem) {
  return getReturnUnitsPerCarton(item);
}

export function CreateReturnDialog({
  invoiceId,
  invoiceDiscount,
  items,
  returns,
  trigger,
}: CreateReturnDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [reasonId, setReasonId] = React.useState("");
  const [reasonNote, setReasonNote] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const { data: viewerAccess } = useViewerAccess();
  const canRequest = !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "sales.view") &&
    hasPermission(viewerAccess.permissions, "sales.returns.create");
  const reasonsQuery = useReturnReasons(open && canRequest);
  const reasons = (reasonsQuery.data ?? []).filter(reason => reason.isActive);
  const selectedReason = reasons.find(reason => reason.id === reasonId);
  const submitting = React.useRef(false);
  const canOverridePrice =
    !!viewerAccess && hasPermission(viewerAccess.permissions, "sales.returns.override-price");
  const maxRefundByItem = React.useMemo(() => {
    const itemsTotal = sumMoney(items.map((item) => item.amount));
    return new Map(
      items.map((item) => [item.id, getMaxRefundPerUnit(item, { invoiceDiscount, itemsTotal })]),
    );
  }, [items, invoiceDiscount]);
  const [priceOverrideReason, setPriceOverrideReason] = React.useState("");
  const emptyLines = () =>
    items.map((item) => ({
      invoiceItemId: item.id,
      cartonsReturned: "",
      quantityReturned: "",
      refundPerUnit: "",
      editingPrice: false,
    }));
  const [lines, setLines] = React.useState(emptyLines);

  const effectiveRefund = (line: (typeof lines)[number]) =>
    canOverridePrice && line.editingPrice && line.refundPerUnit !== "" && Number.isFinite(Number(line.refundPerUnit)) && Number(line.refundPerUnit) >= 0
      ? line.refundPerUnit
      : maxRefundByItem.get(line.invoiceItemId) ?? "0.00";

  const isAboveInvoicePrice = (line: (typeof lines)[number]) =>
    line.editingPrice &&
    line.refundPerUnit !== "" &&
    Number.isFinite(Number(line.refundPerUnit)) &&
    new Big(line.refundPerUnit).gt(maxRefundByItem.get(line.invoiceItemId) ?? "0");

  const needsOverrideReason = lines.some(
    (line) =>
      (Number(line.cartonsReturned) > 0 || Number(line.quantityReturned) > 0) &&
      isAboveInvoicePrice(line),
  );

  const createReturn = useCreateSalesReturn();

  const returnedUnitsByItem = React.useMemo(() => {
    const totals = new Map<string, number>();

    for (const salesReturn of returns) {
      for (const returnItem of salesReturn.items) {
        const invoiceItemId = returnItem.invoiceItem?.id;
        const sourceItem = items.find((item) => item.id === invoiceItemId);
        if (!invoiceItemId || !sourceItem) continue;

        const totalUnits = reservedReturnUnits(salesReturn.status, returnItem, getUnitsPerCarton(sourceItem));

        totals.set(invoiceItemId, (totals.get(invoiceItemId) ?? 0) + totalUnits);
      }
    }

    return totals;
  }, [items, returns]);

  const hasAnyQuantity = lines.some(
    (line) => Number(line.cartonsReturned) > 0 || Number(line.quantityReturned) > 0,
  );
  const validLines = lines.every(line => {
    const item = items.find(item => item.id === line.invoiceItemId);
    if (!item) return false;
    const cartons = Number(line.cartonsReturned);
    const loose = Number(line.quantityReturned);
    const size = getUnitsPerCarton(item);
    const remaining = item.numberOfCartons * size + item.quantity - (returnedUnitsByItem.get(item.id) ?? 0);
    return [cartons, loose].every(value => Number.isInteger(value) && value >= 0) &&
      cartons * size + loose <= Math.max(0, remaining) &&
      (!line.editingPrice || line.refundPerUnit === "" || (Number.isFinite(Number(line.refundPerUnit)) && Number(line.refundPerUnit) >= 0));
  });
  const canSubmit = canRequest && !createReturn.isPending && !reasonsQuery.isFetching && !reasonsQuery.isError &&
    !!selectedReason && (!selectedReason.requiresNote || !!reasonNote.trim()) && reasonNote.trim().length <= 500 &&
    hasAnyQuantity && validLines && (!needsOverrideReason || (!!priceOverrideReason.trim() && priceOverrideReason.trim().length <= 500));

  const totalRefund = React.useMemo(() => {
    return sumMoney(
      lines.map((line) => {
        const sourceItem = items.find((item) => item.id === line.invoiceItemId);
        const unitsPerCarton = sourceItem ? getUnitsPerCarton(sourceItem) : 1;
        const rawUnits =
          (Number(line.cartonsReturned) || 0) * unitsPerCarton + (Number(line.quantityReturned) || 0);
        const units = Number.isFinite(rawUnits) && rawUnits >= 0 ? rawUnits : 0;
        return calculateReturnLineRefund(units, effectiveRefund(line) || "0");
      }),
    );
  }, [items, lines, maxRefundByItem, canOverridePrice]);

  function resetForm() {
    setReasonId("");
    setReasonNote("");
    setNotes("");
    setLines(emptyLines());
    setPriceOverrideReason("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;

    const returnItems = lines
      .map((line) => ({
        invoiceItemId: line.invoiceItemId,
        cartonsReturned: Number(line.cartonsReturned) || 0,
        quantityReturned: Number(line.quantityReturned) || 0,
        refundPerUnit:
          canOverridePrice && line.editingPrice && line.refundPerUnit !== "" ? Number(line.refundPerUnit) : undefined,
      }))
      .filter((line) => line.cartonsReturned > 0 || line.quantityReturned > 0);

    createReturn.mutate(
      {
        invoiceId,
        reasonId,
        reasonNote: reasonNote.trim() || undefined,
        notes: notes.trim() || undefined,
        priceOverrideReason: needsOverrideReason ? priceOverrideReason.trim() : undefined,
        items: returnItems,
      },
      {
        onSuccess: () => {
          setOpen(false);
          resetForm();
        },
        onSettled: () => { submitting.current = false; },
      },
    );
  }

  const hasReturnableItems = items.some((item) => {
    const unitsPerCarton = getUnitsPerCarton(item);
    const totalInvoicedUnits = item.numberOfCartons * unitsPerCarton + item.quantity;
    const alreadyReservedUnits = returnedUnitsByItem.get(item.id) ?? 0;
    return totalInvoicedUnits - alreadyReservedUnits > 0;
  });

  if (!canRequest) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting.current) return;
        setOpen(nextOpen);
        if (!nextOpen) { resetForm(); createReturn.reset(); }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={!hasReturnableItems}>
            <RotateCcw className="size-4 mr-1.5" />
            Request return
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton={!createReturn.isPending}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Request sales return</DialogTitle>
            <DialogDescription>
              Request and approval reserve the requested packs. Only inspected receipt changes stock
              and credits the invoice. A short receipt closes the request and releases the shortfall.
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={createReturn.isPending} className="flex flex-col gap-5 py-4">
            <FieldGroup>
              <Field>
                <Label htmlFor="return-reason">Reason</Label>
                <Select value={reasonId} onValueChange={setReasonId} disabled={reasonsQuery.isFetching || reasonsQuery.isError || !reasons.length}>
                  <SelectTrigger id="return-reason">
                    <SelectValue placeholder="Pick a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {reasons.map(reason => <SelectItem key={reason.id} value={reason.id}>{reason.name}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {reasonsQuery.isFetching && <p role="status">Loading return reasons...</p>}
                {reasonsQuery.isError && <><p role="alert">{reasonsQuery.error.message}</p><Button type="button" variant="outline" onClick={() => void reasonsQuery.refetch()}>Retry reasons</Button></>}
                {reasonsQuery.isSuccess && !reasons.length && <p>No active return reasons. Ask a sales configuration manager.</p>}
              </Field>
              <Field>
                <Label htmlFor="return-reason-note">Reason note</Label>
                <Textarea id="return-reason-note" value={reasonNote} onChange={e => setReasonNote(e.target.value)} maxLength={500} required={selectedReason?.requiresNote} placeholder={selectedReason?.requiresNote ? "Required for this reason" : "Optional reason details"} />
              </Field>
            </FieldGroup>

            <div className="space-y-2">
              <Label htmlFor="return-notes">Notes</Label>
              <Textarea
                id="return-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional internal notes"
                rows={2}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Return Items</Label>
              {!hasReturnableItems && (
                <p className="text-sm text-muted-foreground">All invoice packs are already reserved or received.</p>
              )}
                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const unitsPerCarton = getUnitsPerCarton(item);
                    const totalInvoicedUnits = item.numberOfCartons * unitsPerCarton + item.quantity;
                    const alreadyReservedUnits = returnedUnitsByItem.get(item.id) ?? 0;
                    const remainingUnits = Math.max(0, totalInvoicedUnits - alreadyReservedUnits);
                    const selectedCartons = Number(lines[idx].cartonsReturned) || 0;
                    const maxCartons = Math.floor(remainingUnits / unitsPerCarton);
                    const maxLooseUnits = Math.max(0, remainingUnits - (selectedCartons * unitsPerCarton));

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
                      >
                        <div className="sm:col-span-4 space-y-1">
                          <p className="text-sm font-medium">{item.pack}</p>
                          {item.recipe?.name && (
                            <p className="text-xs text-muted-foreground">{item.recipe.name}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Invoiced: {item.numberOfCartons} carton(s), {item.quantity} loose
                          </p>
                          <p className="text-xs text-emerald-700">
                            Returnable: {Math.floor(remainingUnits / unitsPerCarton)} carton(s), {remainingUnits % unitsPerCarton} loose
                          </p>
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <Label htmlFor={`return-cartons-${item.id}`} className="text-xs">Cartons</Label>
                          <Input
                            id={`return-cartons-${item.id}`}
                            aria-label={`${item.pack} cartons`}
                            type="number"
                            step={1}
                            min={0}
                            max={maxCartons}
                            value={lines[idx].cartonsReturned}
                            onChange={e => setLines(current => current.map((line, index) => index === idx ? { ...line, cartonsReturned: e.target.value } : line))}
                            placeholder="0"
                            disabled={remainingUnits === 0}
                          />
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <Label htmlFor={`return-loose-${item.id}`} className="text-xs">Loose packs</Label>
                          <Input
                            id={`return-loose-${item.id}`}
                            aria-label={`${item.pack} loose packs`}
                            type="number"
                            step={1}
                            min={0}
                            max={maxLooseUnits}
                            value={lines[idx].quantityReturned}
                            onChange={e => setLines(current => current.map((line, index) => index === idx ? { ...line, quantityReturned: e.target.value } : line))}
                            placeholder="0"
                            disabled={remainingUnits === 0}
                          />
                        </div>
                        <div className="sm:col-span-4 space-y-1">
                          <Label htmlFor={`return-price-${item.id}`} className="text-xs">Refund per pack</Label>
                          {lines[idx].editingPrice ? (
                            <Input
                              id={`return-price-${item.id}`}
                              aria-label={`${item.pack} refund per pack`}
                              type="number"
                              min={0}
                              step="0.01"
                              value={lines[idx].refundPerUnit}
                              placeholder={maxRefundByItem.get(item.id)}
                              onChange={(e) => {
                                const next = [...lines];
                                next[idx] = { ...next[idx], refundPerUnit: e.target.value };
                                setLines(next);
                              }}
                              disabled={remainingUnits === 0}
                            />
                          ) : (
                            <p className="h-9 flex items-center text-sm tabular-nums">
                              Rs {maxRefundByItem.get(item.id)}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Invoice price Rs {maxRefundByItem.get(item.id)} per unit
                          </p>
                          {canOverridePrice && !lines[idx].editingPrice && remainingUnits > 0 && (
                            <button
                              type="button"
                              className="text-xs text-primary underline-offset-2 hover:underline"
                              onClick={() => {
                                const next = [...lines];
                                next[idx] = { ...next[idx], editingPrice: true };
                                setLines(next);
                              }}
                            >
                              Change price
                            </button>
                          )}
                          {isAboveInvoicePrice(lines[idx]) && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">Above invoice price</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
            </div>

            {needsOverrideReason && (
              <div className="space-y-2">
                <Label htmlFor="price-override-reason">Why refund above the invoice price?</Label>
                <Textarea
                  id="price-override-reason"
                  value={priceOverrideReason}
                  onChange={(e) => setPriceOverrideReason(e.target.value)}
                  placeholder="Required. Shown to the approver."
                  rows={2}
                  required
                  maxLength={500}
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-muted p-3">
              <span className="text-sm text-muted-foreground">Estimated Total Refund</span>
              <span className="text-lg font-bold tabular-nums">
                PKR {Number(totalRefund).toLocaleString("en-PK", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {!validLines && <p role="alert">Use nonnegative whole packs within the returnable quantity and a valid refund price.</p>}
            {createReturn.isError && <p role="alert">{createReturn.error.message}</p>}
          </fieldset>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm" disabled={createReturn.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {createReturn.isPending ? "Saving..." : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
