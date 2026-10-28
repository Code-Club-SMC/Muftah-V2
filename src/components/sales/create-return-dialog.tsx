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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useCreateSalesReturn } from "@/hooks/sales/use-sales-returns";
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
  items: Array<{
    invoiceItem: { id: string } | null;
    cartonsReturned: number;
    quantityReturned: number;
  }>;
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
  const [reason, setReason] = React.useState("");
  const [condition, setCondition] = React.useState<"good" | "damaged" | "expired">("good");
  const [notes, setNotes] = React.useState("");
  const { data: viewerAccess } = useViewerAccess();
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
    line.editingPrice && line.refundPerUnit !== ""
      ? line.refundPerUnit
      : maxRefundByItem.get(line.invoiceItemId) ?? "0.00";

  const isAboveInvoicePrice = (line: (typeof lines)[number]) =>
    line.editingPrice &&
    line.refundPerUnit !== "" &&
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
      if (!['pending', 'approved'].includes(salesReturn.status)) continue;

      for (const returnItem of salesReturn.items) {
        const invoiceItemId = returnItem.invoiceItem?.id;
        const sourceItem = items.find((item) => item.id === invoiceItemId);
        if (!invoiceItemId || !sourceItem) continue;

        const totalUnits =
          (returnItem.cartonsReturned || 0) * getUnitsPerCarton(sourceItem) +
          (returnItem.quantityReturned || 0);

        totals.set(invoiceItemId, (totals.get(invoiceItemId) ?? 0) + totalUnits);
      }
    }

    return totals;
  }, [items, returns]);

  const hasAnyQuantity = lines.some(
    (line) => Number(line.cartonsReturned) > 0 || Number(line.quantityReturned) > 0,
  );

  const totalRefund = React.useMemo(() => {
    return sumMoney(
      lines.map((line) => {
        const sourceItem = items.find((item) => item.id === line.invoiceItemId);
        const unitsPerCarton = sourceItem ? getUnitsPerCarton(sourceItem) : 1;
        const units =
          (Number(line.cartonsReturned) || 0) * unitsPerCarton + (Number(line.quantityReturned) || 0);
        return calculateReturnLineRefund(units, effectiveRefund(line) || "0");
      }),
    );
  }, [items, lines, maxRefundByItem]);

  function resetForm() {
    setReason("");
    setNotes("");
    setCondition("good");
    setLines(emptyLines());
    setPriceOverrideReason("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || !hasAnyQuantity) return;
    if (needsOverrideReason && !priceOverrideReason.trim()) return;

    const returnItems = lines
      .map((line) => ({
        invoiceItemId: line.invoiceItemId,
        cartonsReturned: Number(line.cartonsReturned) || 0,
        quantityReturned: Number(line.quantityReturned) || 0,
        refundPerUnit:
          line.editingPrice && line.refundPerUnit !== "" ? Number(line.refundPerUnit) : undefined,
      }))
      .filter((line) => line.cartonsReturned > 0 || line.quantityReturned > 0);

    createReturn.mutate(
      {
        invoiceId,
        reason: reason.trim(),
        condition,
        notes: notes.trim() || undefined,
        priceOverrideReason: needsOverrideReason ? priceOverrideReason.trim() : undefined,
        items: returnItems,
      },
      {
        onSuccess: () => {
          setOpen(false);
          resetForm();
        },
      },
    );
  }

  const hasReturnableItems = items.some((item) => {
    const unitsPerCarton = getUnitsPerCarton(item);
    const totalInvoicedUnits = item.numberOfCartons * unitsPerCarton + item.quantity;
    const alreadyReservedUnits = returnedUnitsByItem.get(item.id) ?? 0;
    return totalInvoicedUnits - alreadyReservedUnits > 0;
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={!hasReturnableItems}>
            <RotateCcw className="size-4 mr-1.5" />
            Record Return
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Record Sales Return</DialogTitle>
            <DialogDescription>
              Create a return / credit note against this invoice. Returns remain pending until
              approved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="return-reason">Reason</Label>
                <Input
                  id="return-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Damaged in transit"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={condition} onValueChange={(v) => setCondition(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

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
              {!hasReturnableItems ? (
                <p className="text-sm text-muted-foreground">All invoice items have already been fully returned.</p>
              ) : (
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
                          <Label className="text-xs">Cartons</Label>
                          <Input
                            type="number"
                            min={0}
                            max={maxCartons}
                            value={lines[idx].cartonsReturned}
                            onChange={(e) => {
                              const next = [...lines];
                              const clampedCartons = Math.min(Number(e.target.value) || 0, maxCartons);
                              next[idx].cartonsReturned = String(clampedCartons);
                              const nextMaxLooseUnits = Math.max(0, remainingUnits - (clampedCartons * unitsPerCarton));
                              const currentLooseUnits = Number(next[idx].quantityReturned) || 0;
                              if (currentLooseUnits > nextMaxLooseUnits) {
                                next[idx].quantityReturned = String(nextMaxLooseUnits);
                              }
                              setLines(next);
                            }}
                            placeholder="0"
                            disabled={remainingUnits === 0}
                          />
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <Label className="text-xs">Loose Units</Label>
                          <Input
                            type="number"
                            min={0}
                            max={maxLooseUnits}
                            value={lines[idx].quantityReturned}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx].quantityReturned = String(Math.min(Number(e.target.value) || 0, maxLooseUnits));
                              setLines(next);
                            }}
                            placeholder="0"
                            disabled={remainingUnits === 0}
                          />
                        </div>
                        <div className="sm:col-span-4 space-y-1">
                          <Label className="text-xs">Refund per unit</Label>
                          {lines[idx].editingPrice ? (
                            <Input
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
                            <p className="text-xs text-amber-600">Above invoice price</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-muted p-3">
              <span className="text-sm text-muted-foreground">Estimated Total Refund</span>
              <span className="text-lg font-bold tabular-nums">
                PKR {Number(totalRefund).toLocaleString("en-PK", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={
                createReturn.isPending ||
                !hasAnyQuantity ||
                (needsOverrideReason && !priceOverrideReason.trim())
              }>
              {createReturn.isPending ? "Saving..." : "Create Return"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
