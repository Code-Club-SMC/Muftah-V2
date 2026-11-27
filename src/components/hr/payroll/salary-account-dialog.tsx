import { useState } from "react";
import Big from "big.js";
import { Wallet } from "lucide-react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupees } from "@/lib/finance/expense-entry";
import { firstDayOfPayrollMonth, paymentDateError, shortfallMessage } from "@/lib/hr/salary-payments";

export type SalaryAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  lines: { employeeId: string; name: string; amount: string }[];
  wallets: { id: string; name: string; balance: string }[];
  /** Money goes out of the chosen account (pay, change account) or into it (refund). */
  direction: "out" | "in";
  payrollMonth: string;
  todayKey: string;
  pending: boolean;
  /** Date the dialog starts on; today when not given. */
  defaultDate?: string;
  onConfirm: (choice: { walletId: string; paymentDate: string }) => void;
};

/** Start on the first account that can cover the total, so a short account isn't picked by default. */
function defaultWalletId(wallets: SalaryAccountDialogProps["wallets"], total: string, direction: "out" | "in"): string {
  if (direction === "out") {
    const covering = wallets.find((w) => new Big(w.balance).gte(total));
    if (covering) return covering.id;
  }
  return wallets[0]?.id ?? "";
}

export function SalaryAccountDialog(props: SalaryAccountDialogProps) {
  const { open, onOpenChange, title, description, confirmLabel, lines, wallets, direction, payrollMonth, todayKey, pending, defaultDate, onConfirm } = props;
  const total = lines.reduce((sum, line) => sum.plus(line.amount), new Big(0)).toFixed(2);
  const [walletId, setWalletId] = useState(() => defaultWalletId(wallets, total, direction));
  const [paymentDate, setPaymentDate] = useState(defaultDate ?? todayKey);
  const wallet = wallets.find((w) => w.id === walletId);
  const after = wallet ? new Big(wallet.balance)[direction === "out" ? "minus" : "plus"](total).toFixed(2) : null;
  const shortfall = direction === "out" && wallet && new Big(wallet.balance).lt(total)
    ? shortfallMessage(wallet.name, wallet.balance, total)
    : null;
  const dateError = paymentDateError(paymentDate, payrollMonth, todayKey);
  const blocked = !wallet || !!shortfall || !!dateError || pending || lines.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} description={description} icon={Wallet}>
      <div className="space-y-4 min-w-[min(28rem,100%)]">
        <div className="space-y-1.5">
          <Label>Account</Label>
          <Select value={walletId} onValueChange={setWalletId}>
            <SelectTrigger className="rounded-none"><SelectValue placeholder="Choose an account" /></SelectTrigger>
            <SelectContent>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name} · {formatRupees(w.balance)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salary-payment-date">Payment date</Label>
          <Input
            id="salary-payment-date"
            type="date"
            className="rounded-none"
            value={paymentDate}
            min={firstDayOfPayrollMonth(payrollMonth)}
            max={todayKey}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          {dateError && <p className="text-xs text-destructive">{dateError}</p>}
        </div>
        <ul className="max-h-48 overflow-y-auto border border-border divide-y divide-border text-sm">
          {lines.map((line) => (
            <li key={line.employeeId} className="flex justify-between px-3 py-1.5">
              <span>{line.name}</span>
              <span className="tabular-nums">{formatRupees(line.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="text-sm space-y-0.5">
          <p className="font-semibold">Total: {formatRupees(total)}</p>
          {after && <p className="text-muted-foreground">Balance after: {formatRupees(after)}</p>}
          {shortfall && <p className="text-destructive font-medium">{shortfall}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="rounded-none" disabled={blocked} onClick={() => onConfirm({ walletId, paymentDate })}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
