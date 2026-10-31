import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatRupees } from "@/lib/finance/expense-entry";

export function OverdrawConfirmDialog({
  open,
  onOpenChange,
  walletName,
  balance,
  balanceAfter,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletName: string;
  balance: string;
  balanceAfter: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This account will go below zero</AlertDialogTitle>
          <AlertDialogDescription>
            {`${walletName} has ${formatRupees(balance)} now and will be ${formatRupees(balanceAfter)} after this expense. Save anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Save anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
