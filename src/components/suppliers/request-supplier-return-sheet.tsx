import Big from "big.js";
import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { usePurchaseReturnable, useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { supplierReturnValue } from "@/lib/suppliers/supplier-returns";

const QTY = /^\d+(\.\d{1,3})?$/;
const short = (value: string) => new Big(value).toString();

export function RequestSupplierReturnSheet({
  open,
  onOpenChange,
  purchaseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseId: string | null;
}) {
  const { data, isLoading } = usePurchaseReturnable(open ? purchaseId : null);
  const { request } = useSupplierReturnMutations();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) {
      setQuantity("");
      setReason("");
      setNotes("");
    }
  }, [open]);

  const valid = QTY.test(quantity) && new Big(quantity).gt(0);
  const tooMuch = !!data && valid && new Big(quantity).gt(data.max);
  const canSubmit = !!data && !data.blockedReason && valid && !tooMuch && reason.trim().length > 0 && !request.isPending;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Return to supplier"
      description={data ? `${data.materialName} back to ${data.supplierName}` : "Send goods back to the supplier"}
      icon={Undo2}
    >
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : data.blockedReason ? (
        <p className="text-sm text-muted-foreground">{data.blockedReason}</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit || !purchaseId) return;
            await request.mutateAsync({ data: { purchaseId, quantity, reason: reason.trim(), notes: notes.trim() } });
            onOpenChange(false);
          }}
        >
          <FieldGroup>
            <p className="text-sm text-muted-foreground">
              {`Up to ${short(data.max)} ${data.unit} left of this purchase in ${data.warehouseName}`}
            </p>
            <Field>
              <FieldLabel htmlFor="return-qty">{`Quantity (${data.unit})`}</FieldLabel>
              <Input
                id="return-qty"
                inputMode="decimal"
                autoFocus
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.trim())}
              />
              {tooMuch && <FieldError>{`Only ${short(data.max)} ${data.unit} can go back`}</FieldError>}
              {valid && !tooMuch && (
                <p className="text-sm font-medium">
                  {`Debit note value: ${formatRupees(supplierReturnValue(quantity, data.unitCost))}`}
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="return-reason">Why is it going back?</FieldLabel>
              <Input
                id="return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Wet bags, wrong grade, extra delivered"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="return-notes">Notes (optional)</FieldLabel>
              <Textarea id="return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Stock stays in the store until you mark the return as dispatched.
            </p>
            <Button type="submit" disabled={!canSubmit}>
              Request return
            </Button>
          </FieldGroup>
        </form>
      )}
    </ResponsiveDialog>
  );
}
