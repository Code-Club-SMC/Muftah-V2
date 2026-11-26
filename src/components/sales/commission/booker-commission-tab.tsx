import { Fragment, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBookerCommissionMonth } from "@/hooks/sales/use-recovery-commission";
import { formatPKR } from "@/lib/currency-format";
import { MonthPicker } from "./month-picker";

const ENTRY_LABEL: Record<string, (bearer: string | null) => string> = {
  payment: () => "Payment received",
  payment_reversal: (bearer) => (bearer === "company" ? "Reversed payment (company bears the loss)" : "Reversed payment (deducted from booker)"),
  return_clawback: () => "Return after payment (taken back)",
  return_clawback_undo: () => "Return voided (added back)",
};

export function BookerCommissionTab({ orderBookerId, month, onMonthChange }: { orderBookerId: string; month: string; onMonthChange: (month: string) => void }) {
  const { data, isLoading } = useBookerCommissionMonth(orderBookerId, month);
  const [open, setOpen] = useState<string | null>(null);
  const s = data?.summary;
  const tiles = [["Delivered", s?.delivered], ["Collected", s?.collected], ["Earned", s?.earned], ["Waiting", s?.waiting]] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Earned only on money collected, at each order's locked rate.</p>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>
      <section aria-label="Month totals" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold tabular-nums">{formatPKR(value ?? 0, false)}</p></CardContent>
          </Card>
        ))}
      </section>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="text-[11px]">Invoice</TableHead>
              <TableHead className="text-right text-[11px]">Delivered</TableHead>
              <TableHead className="text-right text-[11px]">Returned</TableHead>
              <TableHead className="text-right text-[11px]">Collected</TableHead>
              <TableHead className="text-right text-[11px]">Still owed</TableHead>
              <TableHead className="text-right text-[11px]">Rate</TableHead>
              <TableHead className="text-right text-[11px]">Commission earned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !data?.invoices.length ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No invoices with money owed or collected.</TableCell></TableRow>
            ) : data.invoices.map((inv) => (
              <Fragment key={inv.invoiceId}>
                <TableRow>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Show payments for ${inv.invoiceNumber}`}
                      onClick={() => setOpen(open === inv.invoiceId ? null : inv.invoiceId)}>
                      {open === inv.invoiceId ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.delivered, false)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.returned, false)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.collected, false)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.stillOwed, false)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {inv.mode === "recovery" ? `${Number(inv.rate)}%` : inv.mode === "delivery_paid" ? "Paid on delivery" : "No commission"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">{formatPKR(inv.earnedSoFar, false)}</TableCell>
                </TableRow>
                {open === inv.invoiceId && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/30">
                      {inv.entries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No commission yet. It is earned when money for this invoice is confirmed.</p>
                      ) : (
                        <ul className="space-y-1 text-sm">
                          {inv.entries.map((e) => (
                            <li key={e.id} className="flex flex-wrap justify-between gap-2">
                              <span className="flex flex-wrap gap-x-2">
                                <span className="text-muted-foreground tabular-nums">{format(new Date(e.entryDate), "dd MMM yyyy")}</span>
                                <span>{ENTRY_LABEL[e.kind]?.(e.bearer) ?? e.kind}</span>
                                {e.note ? <span className="text-muted-foreground">{e.note}</span> : null}
                              </span>
                              <span className="tabular-nums">
                                <span className="text-muted-foreground">on {formatPKR(e.base, false)}: </span>
                                {formatPKR(e.amount, false)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
