import Big from "big.js";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { SlipPaymentHistory } from "@/server-functions/hr/payroll/salary-payments.server";

const KIND_TEXT = { payment: "from", refund: "refunded into", recovery: "taken from next salary" } as const;
const DATE_VERB = { payment: "paid", refund: "received", recovery: "recorded" } as const;

export function SalaryPaymentsPanel({ history }: { history: SlipPaymentHistory }) {
  return (
    <section className="mt-4 border border-border p-3 text-sm space-y-2">
      <h3 className="font-semibold">Payments</h3>
      {new Big(history.distributorPaid).gt(0) && (
        <p className="text-muted-foreground">Paid by distributor: {formatRupees(history.distributorPaid)} (already deducted on this slip)</p>
      )}
      {history.payments.length === 0 ? (
        <p className="text-muted-foreground">{history.state.status === "nothing_to_pay" ? "Nothing to pay" : "Not paid yet"}</p>
      ) : (
        <ul className="space-y-1.5">
          {history.payments.map((p) => (
            <li key={p.id} className={cn(p.status === "reversed" && "text-muted-foreground")}>
              <span className={cn(p.status === "reversed" && "line-through decoration-1")}>
                {formatRupees(p.amount)} {KIND_TEXT[p.kind]}{p.walletName ? ` ${p.walletName}` : ""} · {DATE_VERB[p.kind]} {format(parseISO(p.paymentDate), "d MMM yyyy")} · entered {format(p.enteredAt, "d MMM")} by {p.recordedBy ?? "—"}
              </span>
              {p.status === "reversed" && <span className="block no-underline text-xs">Reversed: {p.reversalReason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
