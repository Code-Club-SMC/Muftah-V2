import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useVoidExpense } from "@/hooks/finance/use-finance";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { ExpenseListItem } from "@/lib/types/finance-types";

const MIN_REASON_LENGTH = 3;

export function VoidExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: ExpenseListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  // Keep the last expense on screen while the dialog animates closed after `expense` is cleared.
  const [shown, setShown] = useState<ExpenseListItem | null>(expense);
  const mutation = useVoidExpense();

  useEffect(() => {
    if (expense) setShown(expense);
  }, [expense]);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!shown) return null;

  const confirm = () => {
    if (mutation.isPending) return;
    if (reason.trim().length < MIN_REASON_LENGTH) return void toast.error("Please give a reason");
    mutation.mutate(
      { data: { expenseId: shown.id, reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // A void in progress moves money; do not let the dialog close under it.
        if (!next && mutation.isPending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this expense?</AlertDialogTitle>
          <AlertDialogDescription>
            {`${formatRupees(shown.amount)} goes back to ${shown.wallet?.name ?? "its account"} today. The expense stays in the list, struck through. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Entered twice by mistake"
            maxLength={500}
            disabled={mutation.isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={mutation.isPending || reason.trim().length < MIN_REASON_LENGTH}
          >
            {mutation.isPending ? "Voiding..." : "Void expense"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
