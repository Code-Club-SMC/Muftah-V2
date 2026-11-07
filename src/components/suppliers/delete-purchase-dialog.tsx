import { useEffect, useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";
import { invalidateStockQueries } from "@/lib/inventory/invalidate-stock";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: {
    id: string;
    materialType: string;
    cost: string;
    quantity: string;
  } | null;
};

export const DeletePurchaseDialog = ({
  open,
  onOpenChange,
  purchase,
}: Props) => {
  const queryClient = useQueryClient();
  const editState = useQuery({
    queryKey: ["purchase-edit-state", purchase?.id],
    queryFn: () => getPurchaseEditStateFn({ data: { id: purchase!.id } }),
    enabled: open && !!purchase,
  });
  const stockLocked = editState.data?.stockLocked ?? false;

  // Money paid from a wallet can go back. Start with everything, to the wallet that paid.
  const paid = editState.data?.refund.paid ?? "0.00";
  const hasPaid = new Big(paid).gt(0);
  const [pickedWalletId, setPickedWalletId] = useState<string | null>(null);
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setPickedWalletId(null);
    setTypedAmount(null);
    setReason("");
  }, [open, purchase?.id]);
  const refundWalletId = pickedWalletId ?? editState.data?.refund.walletId ?? "";
  const refundAmount = typedAmount ?? paid;
  const amountOk = /^\d+(\.\d{1,2})?$/.test(refundAmount) && new Big(refundAmount).lte(paid);
  const refundBlocked = hasPaid && (!amountOk || (new Big(refundAmount).gt(0) && !refundWalletId));
  const stays = amountOk ? new Big(paid).minus(refundAmount) : new Big(0);

  const mutate = useMutation({
    mutationFn: deletePurchaseRecordFn,
    onSuccess: async () => {
      await invalidateStockQueries(queryClient);
      toast.success("Purchase voided successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      close(false);
    },
    onError: (err) =>
      toast.error(err.message || "Failed to void purchase"),
  });

  const close = (next: boolean) => {
    if (!next) {
      setPickedWalletId(null);
      setTypedAmount(null);
      setReason("");
    }
    onOpenChange(next);
  };

  if (!purchase) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title="Void purchase"
      description="Reverse this purchase's stock and selected refund. Original purchase and payment records will be retained."
      icon={Trash2}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 text-red-700 rounded-lg border">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="text-sm">
            This action cannot be undone. Stock from buying <strong>{purchase.quantity}</strong> units
            will be reversed. The original records will remain in history.
          </p>
        </div>

        <Field>
          <FieldLabel htmlFor="void-reason">Reason</FieldLabel>
          <Textarea id="void-reason" value={reason} maxLength={1000} required
            onChange={event => setReason(event.target.value)} />
        </Field>

        {editState.isError ? <p role="alert">Unable to load purchase state. Reopen the dialog to try again.</p> : null}

        {stockLocked ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {PURCHASE_LOCKED_MESSAGE}
          </p>
        ) : null}

        {hasPaid && !stockLocked ? (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">
              <strong>PKR {Number(paid).toLocaleString()}</strong> was paid for this purchase. Choose where it goes back.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Refund to</label>
              <PaymentMethodSelect
                value={refundWalletId}
                onValueChange={setPickedWalletId}
                hidePayLater
                showBalance
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="refund-amount">Refund amount (PKR)</label>
              <Input
                id="refund-amount"
                type="number"
                min="0"
                max={paid}
                step="0.01"
                value={refundAmount}
                onChange={(e) => setTypedAmount(e.target.value)}
              />
              {!amountOk ? (
                <p className="text-xs text-red-600">Enter an amount from 0 to {Number(paid).toLocaleString()}.</p>
              ) : stays.gt(0) ? (
                <p className="text-xs text-muted-foreground">
                  PKR {stays.toNumber().toLocaleString()} will stay in expenses as not refunded.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              mutate.mutate({
                data: hasPaid
                  ? { id: purchase.id, reason: reason.trim(), refundWalletId: refundWalletId || undefined, refundAmount }
                  : { id: purchase.id, reason: reason.trim() },
              })
            }
            disabled={mutate.isPending || stockLocked || !editState.isSuccess || refundBlocked || !reason.trim() || reason.trim().length > 1000}
          >
            {mutate.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Void purchase
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
