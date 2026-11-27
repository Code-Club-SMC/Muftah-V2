import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SLIP_PAYMENT_LABELS, type SlipPaymentStatus } from "@/lib/hr/salary-payments";
import type { RegisterSlipPayment } from "@/server-functions/hr/payroll/salary-payments.server";

const TONE: Record<SlipPaymentStatus, string> = {
  unpaid: "bg-emerald-500 text-white",
  paid: "bg-blue-600 text-white",
  balance_due: "bg-amber-500 text-white",
  overpaid: "bg-rose-500 text-white",
  nothing_to_pay: "bg-muted text-muted-foreground",
};

export function SalaryPaymentBadge({ payment }: { payment: RegisterSlipPayment }) {
  const detail =
    payment.status === "balance_due" ? `${formatRupees(payment.due)} still to pay`
    : payment.status === "overpaid" ? `${formatRupees(payment.overpaid)} overpaid`
    : null;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge className={cn("border-none text-[10px] px-2 py-0.5 h-5 font-semibold uppercase tracking-wider w-fit rounded-none", TONE[payment.status])}>
        {SLIP_PAYMENT_LABELS[payment.status]}
      </Badge>
      <span className="text-xs font-semibold text-foreground tabular-nums">{formatRupees(payment.net)}</span>
      {payment.paidFrom && <span className="text-[11px] text-muted-foreground">from {payment.paidFrom}</span>}
      {detail && <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{detail}</span>}
    </div>
  );
}
