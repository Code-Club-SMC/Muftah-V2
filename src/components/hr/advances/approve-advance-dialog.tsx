import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useApproveSalaryAdvance } from "@/hooks/hr/use-salary-advances";
import {
  Loader2,
  CheckCircle2,
  Building2,
  BanknoteIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getWalletsListFn } from "@/server-functions/finance-fn";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const ApproveAdvanceDialog = ({
  open,
  onOpenChange,
  advanceId,
  amount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  advanceId: string | null;
  amount: string | null;
}) => {
  const mutate = useApproveSalaryAdvance();
  const [walletId, setWalletId] = useState("");

  const { data: wallets = [], isLoading: isWalletsLoading } = useQuery({
    queryKey: ["wallets"],
    queryFn: getWalletsListFn,
    enabled: open, // Only fetch when dialog opens
  });

  const selectedWallet = wallets.find((w) => w.id === walletId);
  const parsedAmount = parseFloat(amount || "0");
  const currentBalance = parseFloat(selectedWallet?.balance || "0");
  const insufficientFunds = !!selectedWallet && parsedAmount > currentBalance;

  const handleApprove = async () => {
    if (!advanceId) return;
    if (!walletId) {
      toast.error("Please select a wallet to deduct the advance from");
      return;
    }
    if (insufficientFunds) {
      toast.error(
        `Insufficient balance in "${selectedWallet?.name}". Available: PKR ${currentBalance.toLocaleString()}`,
      );
      return;
    }

    await mutate.mutateAsync(
      {
        data: {
          advanceId,
          walletId,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setWalletId("");
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setWalletId("");
      }}
      title="Approve Salary Advance"
      description="Approve this advance to deduct it from a finance wallet and disburse the amount."
      icon={CheckCircle2}
    >
      <div className="space-y-6 py-4">
        {/* Amount Card */}
        <div className="p-4 bg-muted/30 rounded-xl border flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground uppercase ">
            Amount to Pay
          </span>
          <span className="text-xl font-black text-primary tabular-nums">
            ₨ {parsedAmount.toLocaleString()}
          </span>
        </div>

        {/* Wallet Selection */}
        <div className="space-y-3">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Pay From Wallet
          </Label>
          <Select
            value={walletId}
            onValueChange={setWalletId}
            disabled={isWalletsLoading}
          >
            <SelectTrigger className="h-11 font-medium">
              <SelectValue
                placeholder={
                  isWalletsLoading
                    ? "Loading wallets..."
                    : "Select account to debit..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  <div className="flex items-center gap-2">
                    {w.type === "bank" ? (
                      <Building2 className="size-3.5 text-blue-600" />
                    ) : (
                      <BanknoteIcon className="size-3.5 text-violet-600" />
                    )}
                    <span className="font-medium">{w.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 tabular-nums">
                      ₨ {parseFloat(w.balance || "0").toLocaleString()}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Balance Indicator */}
          {selectedWallet && (
            <div
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                insufficientFunds
                  ? "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800"
                  : "bg-muted/30 border-muted-foreground/5"
              }`}
            >
              <span className="text-xs font-semibold text-muted-foreground">
                Available Balance
              </span>
              <span
                className={`text-sm font-black tabular-nums ${
                  insufficientFunds ? "text-rose-600" : ""
                }`}
              >
                ₨ {currentBalance.toLocaleString()}
              </span>
            </div>
          )}

          {insufficientFunds && (
            <div className="flex items-center gap-2 text-rose-600 text-xs font-bold p-2 bg-rose-50 dark:bg-rose-950/20 rounded-lg">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              Insufficient funds! You need ₨{" "}
              {(parsedAmount - currentBalance).toLocaleString()} more.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutate.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={mutate.isPending || !walletId || insufficientFunds}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {mutate.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Confirm Approval
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
