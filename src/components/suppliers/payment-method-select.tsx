import { useQuery } from "@tanstack/react-query";
import { BanknoteIcon, Building2, Loader2, AlertCircle } from "lucide-react";
import { getWalletsListFn } from "@/server-functions/finance-fn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface PaymentMethodSelectProps {
  value: string; // walletId or "pay_later"
  onValueChange: (value: string) => void;
  disabled?: boolean;
  hidePayLater?: boolean;
  showBalance?: boolean;
}

export const PaymentMethodSelect = ({
  value,
  onValueChange,
  disabled,
  hidePayLater = false,
  showBalance = false,
}: PaymentMethodSelectProps) => {
  const {
    data: wallets = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["wallets"],
    queryFn: getWalletsListFn,
  });

  const options = isError ? [] : wallets;
  const selectedWallet = showBalance && value && value !== "pay_later"
    ? options.find((w) => w.id === value)
    : null;

  return (
    <div className="space-y-1.5">
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled || isLoading}
      >
        <SelectTrigger>
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading accounts...
            </span>
          ) : (
            <SelectValue placeholder="Select payment method" />
          )}
        </SelectTrigger>
        <SelectContent>
          {!hidePayLater && <SelectItem value="pay_later">Pay Later</SelectItem>}
          {options.map((wallet) => (
            <SelectItem key={wallet.id} value={wallet.id}>
              <div className="flex items-center gap-2">
                {wallet.type === "bank" ? (
                  <Building2 className="size-3.5 text-blue-600" />
                ) : (
                  <BanknoteIcon className="size-3.5 text-violet-600" />
                )}
                <span>{wallet.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showBalance && selectedWallet && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          Available balance:
          <span className={`font-semibold ${parseFloat(selectedWallet.balance ?? "0") <= 0 ? "text-red-500" : "text-emerald-600"}`}>
            PKR {parseFloat(selectedWallet.balance ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </p>
      )}

      {isError && (
        <Badge variant="destructive" className="gap-1 text-xs font-normal">
          <AlertCircle className="size-3" />
          Failed to load accounts — only Pay Later available
        </Badge>
      )}
    </div>
  );
};
