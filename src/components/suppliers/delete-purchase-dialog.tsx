import { useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";
import { PURCHASE_LOCKED_MESSAGE } from "@/lib/inventory/material-lots";

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
  const refundWalletId = pickedWalletId ?? editState.data?.refund.walletId ?? "";
  const refundAmount = typedAmount ?? paid;
  const amountOk = /^\d+(\.\d{1,2})?$/.test(refundAmount) && new Big(refundAmount).lte(paid);
  const refundBlocked = hasPaid && (!amountOk || (new Big(refundAmount).gt(0) && !refundWalletId));
  const stays = amountOk ? new Big(paid).minus(refundAmount) : new Big(0);

  const mutate = useMutation({
    mutationFn: deletePurchaseRecordFn,
    onSuccess: () => {
      toast.success("Purchase record deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["material-lots"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-edit-state"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err.message || "Failed to delete purchase record"),
  });

  const close = (next: boolean) => {
    if (!next) {
      setPickedWalletId(null);
      setTypedAmount(null);
    }
    onOpenChange(next);
  };

  if (!purchase) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title="Delete Purchase Record"
      description="Are you sure you want to delete this purchase record? This will affect the supplier balance."
      icon={Trash2}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 text-red-700 rounded-lg border">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="text-sm">
            This action cannot be undone. This will permanently remove the
            record of buying <strong>{purchase.quantity}</strong> units.
          </p>
        </div>

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
                  ? { id: purchase.id, refundWalletId: refundWalletId || undefined, refundAmount }
                  : { id: purchase.id },
              })
            }
            disabled={mutate.isPending || stockLocked || editState.isLoading || refundBlocked}
          >
            {mutate.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Delete Record
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
