import Big from "big.js";
import { Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { SupplierReturnRow } from "@/lib/suppliers/supplier-returns";

/** Cancel (before completion) or void (after). Lists what will happen before the click. */
export function SupplierReturnReasonDialog({
  open,
  onOpenChange,
  mode,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "cancel" | "void";
  row: SupplierReturnRow | null;
}) {
  const { cancel, voidNote } = useSupplierReturnMutations();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);
  if (!row) return null;

  const qty = `${new Big(row.quantity).toString()} ${row.unit} ${row.materialName}`;
  const consequences =
    mode === "cancel"
      ? [row.status === "dispatched" ? `${qty} goes back into ${row.warehouseName}.` : "Nothing has moved yet; the request is closed."]
      : [
          `${qty} goes back into ${row.warehouseName}.`,
          new Big(row.appliedToPurchaseAmount).gt(0)
            ? `What we owe on the purchase goes up by ${formatRupees(row.appliedToPurchaseAmount)}.`
            : null,
          new Big(row.refundAmount).gt(0)
            ? `${formatRupees(row.refundAmount)} comes out of ${row.refundWalletName ?? "the account"} again. It can go below zero.`
            : null,
          new Big(row.supplierCreditAmount).gt(0)
            ? `${formatRupees(row.supplierCreditAmount)} supplier credit is taken back.`
            : null,
        ].filter((line): line is string => !!line);
  const pending = cancel.isPending || voidNote.isPending;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "cancel" ? `Cancel ${row.returnNumber}` : `Void ${row.debitNoteNumber ?? row.returnNumber}`}
      description={mode === "cancel" ? "The return is closed and can't be reopened." : "Everything the debit note did is reversed today."}
      icon={Ban}
    >
      <FieldGroup>
        <ul className="list-disc pl-5 text-sm">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Field>
          <FieldLabel htmlFor="return-reason-text">Reason</FieldLabel>
          <Textarea id="return-reason-text" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <Button
          variant="destructive"
          disabled={!reason.trim() || pending}
          onClick={async () => {
            const input = { data: { id: row.id, reason: reason.trim() } };
            if (mode === "cancel") await cancel.mutateAsync(input);
            else await voidNote.mutateAsync(input);
            onOpenChange(false);
          }}
        >
          {mode === "cancel" ? "Cancel return" : "Void debit note"}
        </Button>
      </FieldGroup>
    </ResponsiveDialog>
  );
}
