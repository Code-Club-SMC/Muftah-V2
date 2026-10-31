import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  BanknoteIcon,
  Building2,
  CheckCircle2Icon,
  Loader2,
} from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDepositToWallet } from "@/hooks/finance/use-finance";
import { formatRupees, getBalanceAfter } from "@/lib/finance/expense-entry";
import type { FinanceWalletSummary } from "@/lib/types/finance-types";

export function DepositSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: FinanceWalletSummary[];
  preselectedWalletId: string | null;
}) {
  const [walletId, setWalletId] = useState(preselectedWalletId || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useDepositToWallet();

  // Start clean on each open, on the account it was opened for (the expense form passes its own).
  useEffect(() => {
    if (!open) return;
    setWalletId(preselectedWalletId || "");
    setAmount("");
    setDescription("");
  }, [open, preselectedWalletId]);

  const effectiveWalletId = walletId || preselectedWalletId || "";
  const selectedWallet = wallets.find((w) => w.id === effectiveWalletId);

  const handleSubmit = () => {
    if (mutation.isPending) return;
    const parsedAmount = parseFloat(amount);
    if (!effectiveWalletId) return toast.error("Please select an account");
    if (!parsedAmount || parsedAmount <= 0)
      return toast.error("Please enter a valid amount");

    mutation.mutate(
      {
        data: {
          walletId: effectiveWalletId,
          amount: parsedAmount,
          description: description.trim() || "Manual Deposit",
          source: "Manual Deposit",
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setAmount("");
          setDescription("");
          setWalletId("");
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Deposit Money"
      description="Add funds to a cash box or bank account."
      icon={ArrowDownIcon}
    >
      <div className="space-y-6 py-4">
        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Deposit Into
          </Label>
          <Select value={effectiveWalletId} onValueChange={setWalletId}>
            <SelectTrigger className="h-11 rounded-none shadow-none border-border focus:ring-1 focus:ring-primary">
              <SelectValue placeholder="Select account..." />
            </SelectTrigger>
            <SelectContent className="rounded-none shadow-none border-border">
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id} className="rounded-none">
                  <div className="flex items-center gap-2">
                    {w.type === "bank" ? (
                      <Building2 className="size-3.5 text-blue-500" />
                    ) : (
                      <BanknoteIcon className="size-3.5 text-violet-500" />
                    )}
                    <span className="font-bold">{w.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWallet && (
            <div className="flex items-center justify-between p-3 bg-muted/20 border border-border">
              <span className="text-[11px] font-bold uppercase  text-muted-foreground">
                Current Balance
              </span>
              <span className="text-sm font-black tabular-nums">
                {formatRupees(selectedWallet.balance || "0")}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Amount (PKR)
          </Label>
          <Input
            type="number"
            min="1"
            placeholder="Enter amount..."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 text-lg font-mono rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          {selectedWallet && parseFloat(amount) > 0 && (
            <p className="text-[10px] text-emerald-600 font-bold uppercase  flex items-center gap-1">
              <CheckCircle2Icon className="size-3" />
              New balance:{" "}
              {formatRupees(getBalanceAfter(selectedWallet.balance, 0, parseFloat(amount)))}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label className="text-[11px] font-bold uppercase  text-muted-foreground">
            Description (Optional)
          </Label>
          <Input
            placeholder="e.g., Sales revenue, Bank deposit..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-11 rounded-none shadow-none border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
        </div>

        <div className="flex justify-end gap-3 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none shadow-none border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-none shadow-none bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {mutation.isPending && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            Confirm Deposit
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

