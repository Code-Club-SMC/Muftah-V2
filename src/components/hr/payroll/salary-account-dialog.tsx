import { useState } from "react";
import Big from "big.js";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Wallet } from "lucide-react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupees } from "@/lib/finance/expense-entry";
import { paymentDateError, shortfallMessage } from "@/lib/hr/salary-payments";

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
  /** First day a payment may be dated: the day the (latest made) slip in `lines` was made. */
  earliestDate: string;
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
  const { open, onOpenChange, title, description, confirmLabel, lines, wallets, direction, earliestDate, todayKey, pending, defaultDate, onConfirm } = props;
  const total = lines.reduce((sum, line) => sum.plus(line.amount), new Big(0)).toFixed(2);
  const [walletId, setWalletId] = useState(() => defaultWalletId(wallets, total, direction));
  const [paymentDate, setPaymentDate] = useState(defaultDate ?? todayKey);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wallet = wallets.find((w) => w.id === walletId);
  const after = wallet ? new Big(wallet.balance)[direction === "out" ? "minus" : "plus"](total).toFixed(2) : null;
  const shortfall = direction === "out" && wallet && new Big(wallet.balance).lt(total)
    ? shortfallMessage(wallet.name, wallet.balance, total)
    : null;
  const dateError = paymentDateError(paymentDate, earliestDate, todayKey);
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
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button id="salary-payment-date" variant="outline" className="w-full justify-start gap-2 rounded-none font-normal">
                <CalendarIcon className="size-3.5 shrink-0" />
                {/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? format(parseISO(paymentDate), "d MMM yyyy") : "Choose a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 rounded-none" align="start">
              <Calendar
                mode="single"
                selected={/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? parseISO(paymentDate) : undefined}
                defaultMonth={parseISO(/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? paymentDate : todayKey)}
                disabled={[{ before: parseISO(earliestDate) }, { after: parseISO(todayKey) }]}
                onSelect={(day: Date | undefined) => {
                  if (!day) return;
                  setPaymentDate(format(day, "yyyy-MM-dd"));
                  setPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">From {format(parseISO(earliestDate), "d MMM yyyy")}, when {lines.length > 1 ? "the last of these slips" : "the slip"} was made, up to today.</p>
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
