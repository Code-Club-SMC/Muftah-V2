import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";

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

  const mutate = useMutation({
    mutationFn: deletePurchaseRecordFn,
    onSuccess: () => {
      toast.success("Purchase record deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err.message || "Failed to delete purchase record"),
  });

  if (!purchase) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
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

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutate.mutate({ data: { id: purchase.id } })}
            disabled={mutate.isPending}
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
