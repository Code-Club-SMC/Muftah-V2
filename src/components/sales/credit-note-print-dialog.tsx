import { format } from "date-fns";
import { AlertCircle, Printer } from "lucide-react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSalesReturnDetail } from "@/hooks/sales/use-sales-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { receivedUnits } from "@/lib/sales/returns/return-lifecycle";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string | null;
}

export function CreditNotePrintDialog({ open, onOpenChange, returnId }: Props) {
  const { data, isLoading, isError } = useSalesReturnDetail(open ? returnId : null);

  const handlePrint = () => {
    if (!data) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const issuedAt = data.creditNoteIssuedAt ?? data.completedAt ?? data.returnDate;
    const itemRows = data.items
      .map((item) => {
        const qty = receivedUnits(item);
        return `
          <tr>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;">${item.invoiceItem?.pack ?? "Item"}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.goodUnits}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.damagedUnits}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.expiredUnits}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${qty}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${formatRupees(item.refundPerUnit)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;font-weight:600;">${formatRupees(item.totalRefund)}</td>
          </tr>`;
      })
      .join("");
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Credit Note ${data.creditNoteNumber ?? `#${data.returnNumber}`}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
    th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
    .split { margin-top: 16px; margin-left: auto; width: 320px; font-size: 12px; }
    .split div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
    .watermark { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 64px; color: rgba(220, 38, 38, 0.14); font-weight: 800; pointer-events: none; }
  </style>
</head>
<body>
  ${data.status === "voided" ? '<div class="watermark">VOIDED</div>' : ""}
  <div class="header">
    <div>
      <h1 style="margin:0;font-size:22px;">CREDIT NOTE</h1>
      <div style="font-size:13px;font-weight:700;margin-top:4px;">${data.creditNoteNumber ?? `RET-${data.returnNumber}`}</div>
      <div style="font-size:11px;color:#475569;">Return #${data.returnNumber} · Invoice #${data.invoice?.invoiceNumber ?? "—"}</div>
    </div>
    <div style="text-align:right;font-size:12px;">
      <div><strong>Issued:</strong> ${issuedAt ? format(new Date(issuedAt), "dd MMM yyyy") : "—"}</div>
      <div><strong>Customer:</strong> ${data.customer?.name ?? "—"}</div>
      ${data.customer?.city ? `<div>${data.customer.city}</div>` : ""}
      ${data.customer?.mobileNumber ? `<div>${data.customer.mobileNumber}</div>` : ""}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:right;">Good</th>
        <th style="text-align:right;">Damaged</th>
        <th style="text-align:right;">Expired</th>
        <th style="text-align:right;">Received</th>
        <th style="text-align:right;">Per Unit</th>
        <th style="text-align:right;">Line Credit</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="split">
    <div><span>Credit Note Total</span><strong>${formatRupees(data.totalAmount)}</strong></div>
    <div><span>Applied to Invoice Balance</span><span>${formatRupees(data.appliedToInvoiceAmount ?? 0)}</span></div>
    <div><span>Transferred to Store Credit</span><span>${formatRupees(data.customerCreditAmount ?? 0)}</span></div>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
    win.document.write(html);
    win.document.close();
  };

  return (
    <ResponsiveDialog
      title="Print Credit Note"
      description="Preview and print the issued Credit Note"
      open={open}
      onOpenChange={onOpenChange}
      className="lg:min-w-[70vw]"
      icon={Printer}
    >
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError || !data ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <AlertCircle className="size-10 text-destructive" />
          <p className="text-sm text-destructive">Failed to load Credit Note details.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold">
                  {data.creditNoteNumber ?? `RET-${data.returnNumber}`}
                </span>
                <Badge variant={data.status === "voided" ? "destructive" : "default"}>
                  {data.status === "voided" ? "Voided" : "Completed"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Return #{data.returnNumber} · Invoice #{data.invoice?.invoiceNumber}
                {data.invoice?.date ? ` (${format(new Date(data.invoice.date), "dd MMM yyyy")})` : ""}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{data.customer?.name}</p>
              {(data.customer?.city || data.customer?.mobileNumber) && (
                <p className="text-xs text-muted-foreground">
                  {[data.customer.city, data.customer.mobileNumber].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>

          {data.status === "voided" && data.voidReason && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Voided: {data.voidReason}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm font-medium">{item.invoiceItem?.pack ?? "Item"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{item.goodUnits}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{item.damagedUnits}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{item.expiredUnits}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{receivedUnits(item)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatRupees(item.refundPerUnit)}</TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">{formatRupees(item.totalRefund)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Credit Note Total</p>
              <p className="text-base font-bold tabular-nums">{formatRupees(data.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Applied to Invoice</p>
              <p className="text-base font-semibold tabular-nums">
                {formatRupees(data.appliedToInvoiceAmount ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transferred to Store Credit</p>
              <p className="text-base font-semibold tabular-nums text-emerald-600">
                {formatRupees(data.customerCreditAmount ?? 0)}
              </p>
            </div>
          </div>

          {!!data.refunds?.length && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Linked Customer Refunds</p>
              {data.refunds.map((refund: any) => (
                <div key={refund.id} className="flex items-center justify-between text-xs">
                  <span>
                    {format(new Date(refund.refundDate), "dd MMM yyyy")} · {refund.wallet?.name ?? "Account"} ({refund.status})
                  </span>
                  <span className="font-semibold tabular-nums">{formatRupees(refund.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" onClick={handlePrint} className="gap-1.5">
              <Printer className="size-4" />
              Print credit note
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}
