import { useId, useState } from "react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  useCancelCompensatoryCashOut,
  useCompensatoryCashOuts,
  useCreateCompensatoryCashOut,
} from "@/hooks/hr/use-compensatory-bank";

type Props = {
  employeeId: string;
  balance: number;
  canManage: boolean;
};

const kindLabels = {
  cash_out: "Cash-out",
  final_settlement: "Final settlement",
} as const;

export function CompensatoryBankPanel({ employeeId, balance, canManage }: Props) {
  const inputId = useId();
  const [hours, setHours] = useState("");
  const cashOuts = useCompensatoryCashOuts(employeeId);
  const create = useCreateCompensatoryCashOut();
  const cancel = useCancelCompensatoryCashOut();
  const busy = create.isPending || cancel.isPending;
  const requested = Number(hours);
  const validHours = requested > 0 && requested <= balance;

  return (
    <section
      aria-label="Comp-off bank"
      className="flex flex-col gap-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Comp-off bank</h3>
          <p className="text-2xl font-bold tabular-nums">{balance}h</p>
          <p className="text-xs text-muted-foreground">
            Use on a short day from its row below, cash out at the overtime
            rate, or settle when the employee leaves.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-36">
              <FieldLabel htmlFor={inputId}>Hours to cash out</FieldLabel>
              <Input
                id={inputId}
                type="number"
                min={0}
                max={balance}
                step={0.5}
                value={hours}
                disabled={busy || balance <= 0}
                onChange={(event) => setHours(event.target.value)}
              />
            </Field>
            <Button
              disabled={busy || !validHours}
              onClick={() =>
                create.mutate(
                  { employeeId, kind: "cash_out", hours: requested },
                  { onSuccess: () => setHours("") },
                )
              }
            >
              Cash out
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy || balance <= 0}>
                  Final settlement
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Settle the whole bank?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All {balance}h leave the bank now and are paid at the
                    overtime rate in the next payslip generated for this
                    employee. Use this when the employee is leaving.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep bank</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      create.mutate({ employeeId, kind: "final_settlement" })
                    }
                  >
                    Settle {balance}h
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      {canManage && hours !== "" && !validHours && (
        <FieldDescription className="text-destructive">
          Enter between 0 and {balance} hours.
        </FieldDescription>
      )}

      {cashOuts.data && cashOuts.data.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {cashOuts.data.map((item) => {
            const payroll = item.payslip?.payroll;
            const status =
              item.status === "cancelled"
                ? { label: "Cancelled", className: "text-muted-foreground" }
                : payroll
                  ? {
                      label: `In ${format(new Date(payroll.month), "MMM yyyy")} payslip (${payroll.status})`,
                      className:
                        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    }
                  : {
                      label: "Waiting for next payslip",
                      className:
                        "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
                    };
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div>
                  <p className="font-medium">
                    {kindLabels[item.kind]} · {Number(item.hours)}h
                    {item.amount
                      ? ` · PKR ${Math.round(Number(item.amount)).toLocaleString()}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Recorded {item.requestedDate}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={status.className}>
                    {status.label}
                  </Badge>
                  {canManage &&
                    item.status === "pending" &&
                    !item.paidInPayslipId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => cancel.mutate(item.id)}
                      >
                        Cancel
                      </Button>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
