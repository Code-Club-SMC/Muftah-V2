import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SalaryAccountDialog } from "./salary-account-dialog";
import {
  useChangeSalaryAccount,
  useRecordSalaryRefund,
  useRecoverOverpaidSalary,
  useUndoSalaryPayment,
} from "@/hooks/hr/use-salary-payments";
import type { RegisterSlipPayment } from "@/server-functions/hr/payroll/salary-payments.server";

type Props = {
  payrollId: string;
  payrollMonth: string;
  employeeId: string;
  name: string;
  payment: RegisterSlipPayment;
  wallets: { id: string; name: string; balance: string }[];
  todayKey: string;
};

type Open = null | "change" | "undo" | "refund" | "recover";

export function SalaryPaymentActions({ payrollId, payrollMonth, employeeId, name, payment, wallets, todayKey }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [reason, setReason] = useState("");
  const change = useChangeSalaryAccount();
  const undo = useUndoSalaryPayment();
  const refund = useRecordSalaryRefund();
  const recover = useRecoverOverpaidSalary();
  const hasPayments = payment.paidFrom !== null;
  const isOverpaid = payment.status === "overpaid";
  if (!hasPayments && !isOverpaid && payment.paid === "0.00") return null;
  const close = () => { setOpen(null); setReason(""); };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" aria-label={`Payment actions for ${name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-none">
          {hasPayments && <DropdownMenuItem onSelect={() => setOpen("change")}>Change account</DropdownMenuItem>}
          {isOverpaid && <DropdownMenuItem onSelect={() => setOpen("recover")}>Recover from next month</DropdownMenuItem>}
          {isOverpaid && <DropdownMenuItem onSelect={() => setOpen("refund")}>Refund received</DropdownMenuItem>}
          <DropdownMenuItem className="text-destructive" onSelect={() => setOpen("undo")}>Undo payment</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {open === "change" && (
        <SalaryAccountDialog
          open onOpenChange={(o) => !o && close()}
          title={`Change account · ${name}`}
          description="The old account gets the money back and the new one is charged. Both show on the Ledger."
          confirmLabel="Change account"
          lines={[{ employeeId, name, amount: payment.paid }]}
          wallets={wallets.filter((w) => !payment.paidFrom?.split(", ").includes(w.name))}
          direction="out" payrollMonth={payrollMonth} todayKey={todayKey} pending={change.isPending}
          onConfirm={({ walletId, paymentDate }) =>
            change.mutate({ payrollId, employeeIds: [employeeId], walletId, paymentDate }, { onSuccess: close })
          }
        />
      )}

      {open === "refund" && (
        <SalaryAccountDialog
          open onOpenChange={(o) => !o && close()}
          title={`Refund received · ${name}`}
          description="The employee handed back the overpaid amount. It goes into the account you choose."
          confirmLabel={`Record ${formatRupees(payment.overpaid)}`}
          lines={[{ employeeId, name, amount: payment.overpaid }]}
          wallets={wallets} direction="in" payrollMonth={payrollMonth} todayKey={todayKey} pending={refund.isPending}
          onConfirm={({ walletId, paymentDate }) =>
            refund.mutate({ payrollId, employeeId, walletId, paymentDate }, { onSuccess: close })
          }
        />
      )}

      {open === "recover" && (
        <ResponsiveDialog open onOpenChange={(o) => !o && close()} title={`Recover from next month · ${name}`}
          description={`${formatRupees(payment.overpaid)} will be deducted from ${name}'s next payslip. No money moves now.`}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-none" onClick={close}>Cancel</Button>
            <Button className="rounded-none" disabled={recover.isPending}
              onClick={() => recover.mutate({ payrollId, employeeId }, { onSuccess: close })}>
              Recover {formatRupees(payment.overpaid)}
            </Button>
          </div>
        </ResponsiveDialog>
      )}

      {open === "undo" && (
        <ResponsiveDialog open onOpenChange={(o) => !o && close()} title={`Undo payment · ${name}`}
          description="The money goes back into its account and the slip returns to Generated. The Ledger keeps both lines.">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="undo-reason">Reason</Label>
              <Textarea id="undo-reason" className="rounded-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Paid twice by mistake" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-none" onClick={close}>Cancel</Button>
              <Button variant="destructive" className="rounded-none" disabled={undo.isPending || reason.trim().length < 3}
                onClick={() => undo.mutate({ payrollId, employeeId, reason }, { onSuccess: close })}>
                Undo payment
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}
