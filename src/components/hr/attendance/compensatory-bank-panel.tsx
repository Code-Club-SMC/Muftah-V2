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
  useCompensatoryLedger,
  useCreateCompensatoryCashOut,
} from "@/hooks/hr/use-compensatory-bank";
import { COMPENSATORY_LEDGER_REASON_LABELS } from "@/lib/attendance/compensatory-ledger";
import { cn } from "@/lib/utils";

const HISTORY_PREVIEW = 8;

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
  const ledger = useCompensatoryLedger(employeeId);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const history = ledger.data ?? [];
  const visibleHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);
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

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Bank history</h4>
        {ledger.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading history...</p>
        ) : ledger.isError ? (
          <p className="text-xs text-destructive">
            Unable to load bank history. {ledger.error.message}
          </p>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {balance > 0
              ? `No changes recorded yet. The current ${balance}h was banked before history started; the next change records it as the opening balance.`
              : "No changes recorded yet."}
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y rounded-lg border text-sm">
              {visibleHistory.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {COMPENSATORY_LEDGER_REASON_LABELS[entry.reason]}
                      {entry.attendanceDate
                        ? ` · ${format(new Date(`${entry.attendanceDate}T12:00:00`), "dd MMM yyyy")}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(entry.createdAt), "dd MMM yyyy, h:mm a")} ·{" "}
                      {entry.actorName ?? "System"}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p
                      className={cn(
                        "font-semibold",
                        entry.changeHours >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400",
                      )}
                    >
                      {entry.changeHours >= 0 ? "+" : "−"}
                      {Math.abs(entry.changeHours).toFixed(2)}h
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Balance {entry.balanceAfter.toFixed(2)}h
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {history.length > HISTORY_PREVIEW && (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => setShowAllHistory((value) => !value)}
              >
                {showAllHistory
                  ? "Show recent changes only"
                  : `Show all ${history.length} changes`}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
