import Big from "big.js";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierReturn } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function DebitNotePrintDialog({
  open,
  onOpenChange,
  returnId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string | null;
}) {
  const { data, isLoading } = useSupplierReturn(open ? returnId : null);

  const handlePrint = () => {
    if (!data) return;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup blocked. Please allow popups for this site to print.");
      return;
    }
    const cell = "border:1px solid #cbd5e1;padding:6px 8px;";
    const lines: [string, string][] = (
      [
        ["Taken off what we owe", data.appliedToPurchaseAmount],
        [`Cash back${data.refundWalletName ? ` (${data.refundWalletName})` : ""}`, data.refundAmount],
        ["Kept as supplier credit", data.supplierCreditAmount],
      ] as [string, string][]
    ).filter(([, amount]) => new Big(amount).gt(0));
    const issuedOn = format(new Date(data.completedAt ?? data.requestedAt), "d MMM yyyy");

    win.document.write(`<!doctype html><html><head><title>${escapeHtml(data.debitNoteNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;">
<h1 style="margin:0 0 4px;">Debit Note ${escapeHtml(data.debitNoteNumber)}</h1>
<p style="margin:0 0 16px;color:#475569;">${escapeHtml(issuedOn)} · Return ${escapeHtml(data.returnNumber)}${data.status === "voided" ? " · VOIDED" : ""}</p>
<p><strong>To:</strong> ${escapeHtml(data.supplierName)}${data.supplierPhone ? ` · ${escapeHtml(data.supplierPhone)}` : ""}${data.supplierAddress ? `<br/>${escapeHtml(data.supplierAddress)}` : ""}</p>
<p><strong>Against purchase:</strong> ${escapeHtml(data.purchaseInvoiceNumber ?? "—")} of ${escapeHtml(format(new Date(data.purchaseDate), "d MMM yyyy"))}</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0;">
<thead><tr><th style="${cell}text-align:left;">Item</th><th style="${cell}text-align:right;">Quantity</th><th style="${cell}text-align:right;">Rate</th><th style="${cell}text-align:right;">Amount</th></tr></thead>
<tbody><tr><td style="${cell}">${escapeHtml(data.materialName)}</td><td style="${cell}text-align:right;">${escapeHtml(new Big(data.quantity).toString())} ${escapeHtml(data.unit)}</td>
<td style="${cell}text-align:right;">${escapeHtml(formatRupees(data.unitCost))}</td><td style="${cell}text-align:right;font-weight:600;">${escapeHtml(formatRupees(data.totalAmount))}</td></tr></tbody>
</table>
<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>
${lines.map(([label, amount]) => `<p>${escapeHtml(label)}: <strong>${escapeHtml(formatRupees(amount))}</strong></p>`).join("")}
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`);
    win.document.close();
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={data?.debitNoteNumber ? `Debit note ${data.debitNoteNumber}` : "Debit note"}
      description="Print a copy for the supplier"
      icon={Printer}
    >
      {isLoading || !data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-3 text-sm">
          <p>{`${new Big(data.quantity).toString()} ${data.unit} ${data.materialName} back to ${data.supplierName}: ${formatRupees(data.totalAmount)}`}</p>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 size-4" />
            Print
          </Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}
