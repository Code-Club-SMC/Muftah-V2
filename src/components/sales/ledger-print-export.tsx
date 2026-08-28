/**
 * Ledger Print/Export Component — Client Format
 * Matches the Accounts Ledger format: Date | Vr. No | Account Description | Debit | Credit | Balance
 * Includes opening balance row, Dr./Cr. suffix, and totals footer
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Printer,
  Download,
  FileSpreadsheet,
  FileText,
  Mail,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { LedgerEntry, LedgerSummary } from "@/lib/ledger-types";

type ExportMode = "print" | "csv" | "pdf";

interface LedgerPrintExportProps {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  entries: LedgerEntry[];
  summary: LedgerSummary;
  customerInfo?: {
    name: string;
    city?: string | null;
    mobileNumber?: string | null;
  };
  loadEntriesForExport?: (exportType: ExportMode) => Promise<LedgerEntry[]>;
  watermark?: string;
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    ntn?: string;
    strn?: string;
    email?: string;
  };
}

export function LedgerPrintExport({
  title, subtitle, periodLabel, entries, summary,
  customerInfo, loadEntriesForExport, watermark, companyInfo,
}: LedgerPrintExportProps) {
  const [includeLineItems] = useState(false);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const fmtPKR = (v: number): string =>
    `PKR ${Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatBalance = (v: number): string => {
    if (v === 0) return "0.00";
    // Positive balance = they owe us (Invoice). Since Invoice is now Credit, it's a Cr balance.
    return `${fmtPKR(Math.abs(v))} ${v > 0 ? "Cr" : "Dr"}`;
  };

  const getDebitAmount = (entry: LedgerEntry) => {
    if (entry.type === "return") {
      return entry.amount;
    }
    if (entry.type === "payment") {
      return entry.amount;
    }
    return 0;
  };

  const getCreditAmount = (entry: LedgerEntry) =>
    entry.type === "invoice" ? entry.totalPrice : 0;

  const resolveExportEntries = async (exportType: ExportMode) => {
    if (!loadEntriesForExport) {
      return entries;
    }
    return await loadEntriesForExport(exportType);
  };

  const handlePrintDocument = async (exportType: "print" | "pdf") => {
    setIsLoading("print");
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups for this site.");
      setIsLoading(null);
      return false;
    }

    try {
      const exportEntries = await resolveExportEntries(exportType);

      const watermarkHtml = watermark
        ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:48px;color:rgba(200,200,200,0.12);pointer-events:none;z-index:9999;white-space:nowrap;font-weight:bold;">${watermark}</div>`
        : "";

      // Build transaction rows
      let totalDebit = 0;
      let totalCredit = 0;

      const rowHtml = exportEntries
        .map((entry) => {
          const isInvoice = entry.type === "invoice";
          const isReturn = entry.type === "return";
          const pay = entry.type === "payment" ? entry : null;

          const debitAmount = getDebitAmount(entry);
          const creditAmount = getCreditAmount(entry);

          totalDebit += debitAmount;
          totalCredit += creditAmount;

          const titleDesc = isInvoice
            ? `Sales Invoice #${entry.invoiceNumber}`
            : isReturn
              ? `Sales Return #${entry.returnNumber}`
              : `Payment (${entry.method.replaceAll("_", " ")})`;

          const subDesc = isInvoice
            ? `${entry.warehouseName ? `${entry.warehouseName} · ` : ""}Paid Amount: ${fmtPKR(entry.paidAmount)} · Returned Amount: ${fmtPKR(entry.returnedAmount)} · Outstanding Amount: ${fmtPKR(entry.outstandingAmount)}`
            : isReturn
              ? `Invoice #${entry.invoiceNumber} · Reason: ${entry.reason}${entry.condition ? ` · Condition: ${entry.condition}` : ""}`
              : `Invoice #${entry.invoiceNumber}${entry.reference ? ` · Ref: ${entry.reference}` : ""}`;

          const desc = `<div style="font-weight:600;color:#1e293b;">${titleDesc}</div><div style="font-size:10px;color:#64748b;margin-top:1px;">${subDesc}</div>`;

          const vrNo = isInvoice
            ? entry.invoiceNumber
            : isReturn
              ? `RET-${entry.returnNumber ?? "—"}`
              : (pay?.reference || "—");

          const creditStyle = isReturn
            ? "color:#b45309;font-weight:600;"
            : creditAmount > 0
              ? "color:#16a34a;font-weight:600;"
              : "color:#94a3b8;";

          let lineItemsHtml = "";
          if (isInvoice && includeLineItems && entry.items && entry.items.length > 0) {
            const liTotal = entry.items.reduce((s, it) => s + Number(it.amount), 0);
            const mismatch = Math.abs(liTotal - entry.totalPrice) > 1;
            lineItemsHtml = `
              <tr><td colspan="6" style="padding:0;border:0;">
                <table style="width:100%;border-collapse:collapse;font-size:9px;background:#fafafa;margin:2px 0;">
                  <thead><tr style="background:#f0f0f0;">
                    <th style="border:1px solid #ddd;padding:3px;text-align:left;">Product</th>
                    <th style="border:1px solid #ddd;padding:3px;text-align:right;">Cartons</th>
                    <th style="border:1px solid #ddd;padding:3px;text-align:right;">Free</th>
                    <th style="border:1px solid #ddd;padding:3px;text-align:right;">Disc.</th>
                    <th style="border:1px solid #ddd;padding:3px;text-align:right;">Price/Carton</th>
                    <th style="border:1px solid #ddd;padding:3px;text-align:right;">Amount</th>
                  </tr></thead>
                  <tbody>
                    ${entry.items.map((item) => `
                      <tr>
                        <td style="border:1px solid #ddd;padding:3px;">${item.pack}</td>
                        <td style="border:1px solid #ddd;padding:3px;text-align:right;">${item.numberOfCartons}</td>
                        <td style="border:1px solid #ddd;padding:3px;text-align:right;color:#22c55e;">${item.freeCartons || 0}</td>
                        <td style="border:1px solid #ddd;padding:3px;text-align:right;color:#f97316;">${item.discountCartons}</td>
                        <td style="border:1px solid #ddd;padding:3px;text-align:right;">${fmtPKR(Number(item.perCartonPrice))}</td>
                        <td style="border:1px solid #ddd;padding:3px;text-align:right;font-weight:600;">${fmtPKR(Number(item.amount))}</td>
                      </tr>
                    `).join("")}
                    <tr style="border-top:1px solid #ccc;">
                      <td colspan="5" style="border:1px solid #ddd;padding:3px;text-align:right;font-weight:600;">Line Items Subtotal:</td>
                      <td style="border:1px solid #ddd;padding:3px;text-align:right;font-weight:600;">${fmtPKR(liTotal)}</td>
                    </tr>
                    <tr>
                      <td colspan="5" style="border:1px solid #ddd;padding:3px;text-align:right;color:#64748b;">Invoice Total:</td>
                      <td style="border:1px solid #ddd;padding:3px;text-align:right;color:#64748b;">${fmtPKR(entry.totalPrice)}</td>
                    </tr>
                    ${mismatch ? `
                    <tr style="background:#fffbeb;">
                      <td colspan="5" style="border:1px solid #ddd;padding:3px;text-align:right;color:#b45309;font-weight:600;">Difference (Rounding/Discount):</td>
                      <td style="border:1px solid #ddd;padding:3px;text-align:right;color:#b45309;font-weight:700;">${fmtPKR(Math.abs(liTotal - entry.totalPrice))} ${liTotal > entry.totalPrice ? "(over)" : "(under)"}</td>
                    </tr>
                    ` : ""}
                  </tbody>
                </table>
              </td></tr>
            `;
          }

          return `
            <tr>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;white-space:nowrap;">${format(new Date(entry.date), "dd-MMM-yyyy")}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;font-weight:600;">${vrNo}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;">${desc}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;${debitAmount > 0 ? "font-weight:600;" : "color:#94a3b8;"}">${debitAmount > 0 ? fmtPKR(debitAmount) : "0.00"}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;${creditStyle}">${creditAmount > 0 ? fmtPKR(creditAmount) : "0.00"}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:700;">${formatBalance(entry.runningBalance)}</td>
            </tr>
            ${lineItemsHtml}
          `;
        })
        .join("");

      const dates = (periodLabel || "").split(" to ");
      const dateFrom = dates[0] || "All";
      const dateTo = dates[1] || "All";

      // Formal client header
      const companyHeaderHtml = `
        <div style="border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;">
          <h1 style="font-size:20px;font-weight:700;font-style:italic;margin-bottom:8px;color:#000;">Accounts Ledger</h1>
          <div style="display:flex;justify-content:space-between;font-size:11px;line-height:1.6;color:#111;">
            <div>
              <div><strong style="display:inline-block;width:80px;">Account No:</strong> ${customerInfo?.name ? customerInfo.name.replace(/[^0-9]/g, "") || "334000409" : "334000409"}</div>
              <div><strong style="display:inline-block;width:80px;">Title:</strong> ${customerInfo?.name || "Customer"}${customerInfo?.city ? ` - ${customerInfo.city}` : ""}</div>
              <div><strong style="display:inline-block;width:80px;">Date From:</strong> ${dateFrom} &nbsp;&nbsp;&nbsp;&nbsp; <strong>To:</strong> ${dateTo}</div>
            </div>
            <div style="text-align:right;">
              <div><strong>Print Date :</strong> ${format(new Date(), "dd-MMM-yyyy")}</div>
            </div>
          </div>
        </div>
      `;

      // Opening balance row
      // Since Invoices (what they owe) are now Credits, a positive balance is a Credit.
      const openingCredit = summary.openingBalance > 0 ? summary.openingBalance : 0;
      const openingDebit = summary.openingBalance < 0 ? Math.abs(summary.openingBalance) : 0;
      const obDebit = openingDebit > 0 ? fmtPKR(openingDebit) : "0.00";
      const obCredit = openingCredit > 0 ? fmtPKR(openingCredit) : "0.00";
      const openingRowHtml = `
        <tr style="background:#fafafa;font-weight:600;">
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;color:#64748b;">—</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;color:#64748b;">—</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;font-weight:700;text-align:center;">Opening Balance</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:600;">${obDebit}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:600;">${obCredit}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:700;">${formatBalance(summary.openingBalance)}</td>
        </tr>
      `;

      // Totals footer rows
      const grandDebit = openingDebit + totalDebit;
      const grandCredit = openingCredit + totalCredit;
      const totalsRowHtml = `
        <tr style="font-weight:700;border-top:1px solid #000;border-bottom:3px double #000;">
          <td colspan="3" style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;"></td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;text-decoration:underline;">${fmtPKR(totalDebit)}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;text-decoration:underline;">${fmtPKR(totalCredit)}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;text-decoration:underline;">${formatBalance(summary.closingBalance)}</td>
        </tr>
        <tr style="font-weight:700;">
          <td colspan="3" style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;">Total With Opening Balance :</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;border-bottom:3px double #000;">${fmtPKR(grandDebit)}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;border-bottom:3px double #000;">${fmtPKR(grandCredit)}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;border-bottom:3px double #000;">${formatBalance(summary.closingBalance)}</td>
        </tr>
      `;

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              @page { size: A4 landscape; margin: 10mm; }
              body { font-family: 'Segoe UI', Arial, sans-serif; padding: 16px; color: #333; }
              table { width: 100%; border-collapse: collapse; }
              th { background: #e8e8e8; border: 1px solid #999; padding: 8px; font-size: 10px; text-align: left;
                   font-weight: 700; text-transform: uppercase; color: #333; border-bottom: 2px solid #333; }
              td { border: 1px solid #ddd; padding: 6px 8px; }
              .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #ccc;
                        font-size: 9px; color: #94a3b8; text-align: center; }
              @media print {
                body { padding: 0; }
                .no-print { display: none !important; }
              }
            </style>
          </head>
          <body>
            ${watermarkHtml}
            ${companyHeaderHtml}
            <table>
              <thead>
                <tr>
                  <th style="width:90px;">Date</th>
                  <th style="width:100px;">Vr. No</th>
                  <th>Account Description</th>
                  <th style="width:120px;text-align:right;">Debit</th>
                  <th style="width:120px;text-align:right;">Credit</th>
                  <th style="width:130px;text-align:right;">Balance</th>
                </tr>
              </thead>
              <tbody>
                ${openingRowHtml}
                ${rowHtml || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px;">No entries</td></tr>`}
                ${totalsRowHtml}
              </tbody>
            </table>
            <div class="footer">
              This is a computer-generated statement. For queries, contact support.<br>
              ${watermark ? `Generated by: ${watermark}` : ""}
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.focus(); printWindow.print(); }, 500);
      toast.success(exportType === "pdf" ? "Print dialog opened. Use Save as PDF." : "Print dialog opened");
      return true;
    } catch (err) {
      printWindow.close();
      toast.error("Failed to prepare ledger export");
      console.error(err);
      return false;
    } finally {
      setIsLoading(null);
    }
  };

  const handlePrint = async () => {
    await handlePrintDocument("print");
  };

  const handleCSV = async () => {
    setIsLoading("csv");
    try {
      const exportEntries = await resolveExportEntries("csv");
      const headers = ["Date", "Vr. No", "Account Description", "Debit", "Credit", "Balance", "Status", "Remarks"];

      // Opening balance row
      // Positive balance (they owe us) = Credit
      const openingCredit = summary.openingBalance > 0 ? summary.openingBalance : 0;
      const openingDebit = summary.openingBalance < 0 ? Math.abs(summary.openingBalance) : 0;
      const obRow = [
        "Opening Balance", "—", "Opening Balance",
        openingDebit > 0 ? String(openingDebit) : "",
        openingCredit > 0 ? String(openingCredit) : "",
        formatBalance(summary.openingBalance), "", "",
      ];

      const rows = exportEntries.map((entry) => {
        const isInvoice = entry.type === "invoice";
        const isReturn = entry.type === "return";
        const date = format(new Date(entry.date), "dd-MMM-yyyy");
        const vrNo = isInvoice
          ? entry.invoiceNumber
          : isReturn
            ? `RET-${entry.returnNumber ?? ""}`
            : (entry.reference || "—");
        const desc = isInvoice
          ? `Sales Invoice #${entry.invoiceNumber} (Paid Amount: ${fmtPKR(entry.paidAmount)}, Returned Amount: ${fmtPKR(entry.returnedAmount)}, Outstanding Amount: ${fmtPKR(entry.outstandingAmount)})`
          : isReturn
            ? `Sales Return #${entry.returnNumber} (Invoice ${entry.invoiceNumber}) - ${entry.reason}`
            : `Payment (${entry.method.replaceAll("_", " ")}) for Invoice ${entry.invoiceNumber}${entry.reference ? ` Ref: ${entry.reference}` : ""}`;
        const debit = getDebitAmount(entry) > 0 ? String(getDebitAmount(entry)) : "";
        const credit = getCreditAmount(entry) > 0 ? String(getCreditAmount(entry)) : "";
        const balance = formatBalance(entry.runningBalance);
        const status = isInvoice || isReturn ? entry.status : "";
        const remarks = isInvoice ? (entry.remarks || "") : (entry.notes || "");

        const baseRow = [date, vrNo, desc, debit, credit, balance, status, remarks];

        const extraRows: string[][] = [];
        if (isInvoice && includeLineItems && entry.items && entry.items.length > 0) {
          const liTotal = entry.items.reduce((s, it) => s + Number(it.amount), 0);
          const mismatch = Math.abs(liTotal - entry.totalPrice) > 1;
          entry.items.forEach((item) => {
            extraRows.push(["", "", item.pack, `Cartons: ${item.numberOfCartons}`, "", fmtPKR(Number(item.amount)), "", ""]);
          });
          extraRows.push(["", "", "Line Items Subtotal:", fmtPKR(liTotal), "", "", "", ""]);
          extraRows.push(["", "", "Invoice Total:", fmtPKR(entry.totalPrice), "", "", "", ""]);
          if (mismatch) {
            const diff = Math.abs(liTotal - entry.totalPrice);
            extraRows.push(["", "", "Difference (Rounding/Discount):", `${fmtPKR(diff)} ${liTotal > entry.totalPrice ? "(over)" : "(under)"}`, "", "", "", ""]);
          }
        }
        return [baseRow, ...extraRows];
      }).flat();

      // Totals row
      const totalDebit = exportEntries.reduce((s, e) => s + getDebitAmount(e), 0);
      const totalCredit = exportEntries.reduce((s, e) => s + getCreditAmount(e), 0);
      const totalsRow = [
        "", "", "Total With Opening Balance:",
        fmtPKR(openingDebit + totalDebit),
        fmtPKR(openingCredit + totalCredit),
        formatBalance(summary.closingBalance), "", "",
      ];

      const allRows = [headers, obRow, ...rows, totalsRow];
      const csv = allRows
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeTitle = (title + "_" + (subtitle || "")).replace(/[^a-z0-9]/gi, "_").toLowerCase();
      link.download = `${safeTitle}_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded successfully");
    } catch (err) {
      toast.error("Failed to generate CSV");
      console.error(err);
    } finally {
      setIsLoading(null);
    }
  };

  const handlePDF = async () => {
    await handlePrintDocument("pdf");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Download className="size-4" /> Export <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Export Options</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handlePrint} disabled={isLoading === "print"} className="cursor-pointer">
            {isLoading === "print" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Printer className="size-4 mr-2" />}
            Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCSV} disabled={isLoading === "csv"} className="cursor-pointer">
            {isLoading === "csv" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <FileSpreadsheet className="size-4 mr-2" />}
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePDF} disabled={isLoading === "print"} className="cursor-pointer">
            {isLoading === "print" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <FileText className="size-4 mr-2" />}
            Save as PDF
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem disabled className="cursor-not-allowed opacity-50">
                  <Mail className="size-4 mr-2" />
                  Email Ledger
                  <span className="ml-auto text-[9px] font-semibold uppercase bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                    Coming Soon
                  </span>
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Email delivery is not yet implemented.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// ── Backward-compatible PrintExportToolbar ────────────────────────────────────

interface PrintExportToolbarProps {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  entries: Array<Record<string, any>>;
  summary: Record<string, any>;
  columns: { key: string; label: string; format?: (val: any, entry: any) => string }[];
  loadEntriesForExport?: (exportType: "print" | "csv" | "pdf") => Promise<Array<Record<string, any>>>;
}

export function PrintExportToolbar({
  title,
  subtitle,
  periodLabel,
  entries,
  summary,
  columns,
  loadEntriesForExport,
}: PrintExportToolbarProps) {
  const fmtPKR = (v: number) => `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

  const formatSummaryValue = (key: string, value: number) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("count")) {
      return value.toLocaleString("en-PK");
    }
    return fmtPKR(value);
  };

  const resolveExportEntries = async (exportType: "print" | "csv") => {
    if (!loadEntriesForExport) {
      return entries;
    }
    return await loadEntriesForExport(exportType);
  };

  const handlePrint = async () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    try {
      const exportEntries = await resolveExportEntries("print");

      const rowHtml = exportEntries
        .map((entry) => {
          const cells = columns
            .map((col) => {
              const raw = entry[col.key];
              const formatted = col.format ? col.format(raw, entry) : String(raw ?? "—");
              const isNum = col.key.includes("amount") || col.key.includes("balance") || col.key.includes("debit") || col.key.includes("credit");
              return `<td style="border:1px solid #ccc;padding:8px;font-size:12px;text-align:${isNum ? "right" : "left"}">${formatted}</td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

      const summaryHtml = Object.entries(summary)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => {
          const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
          return `<div style="font-size:12px;color:#666;">${label}: <strong>${formatSummaryValue(k, v as number)}</strong></div>`;
        })
        .join("");

      const html = `
        <html><head><title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #ccc; padding: 8px; font-size: 12px; }
          th { background: #f5f5f5; text-align: left; }
          .header { margin-bottom: 16px; }
          .summary { margin-top: 16px; padding-top: 12px; border-top: 2px solid #333; }
        </style></head><body>
          <div class="header"><h2>${title}</h2>
            ${subtitle ? `<div style="color:#666;font-size:12px;margin-top:4px;">${subtitle}</div>` : ""}
            ${periodLabel ? `<div style="color:#666;font-size:12px;">Period: ${periodLabel}</div>` : ""}
          </div>
          <table><thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
          <tbody>${rowHtml || `<tr><td colspan="${columns.length}" style="text-align:center;color:#999;">No entries</td></tr>`}</tbody></table>
          <div class="summary">${summaryHtml}</div>
        </body></html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.focus(); printWindow.print(); }, 400);
    } catch (err) {
      printWindow.close();
      console.error(err);
      toast.error("Failed to prepare print export");
    }
  };

  const handleCSV = async () => {
    try {
      const exportEntries = await resolveExportEntries("csv");
      const header = columns.map((c) => c.label).join(",");
      const rows = exportEntries.map((entry) =>
        columns.map((col) => {
          const raw = entry[col.key];
          const formatted = col.format ? col.format(raw, entry) : String(raw ?? "");
          return `"${formatted.replace(/"/g, '""')}"`;
        }).join(",")
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/\s+/g, "_").toLowerCase()}_${format(new Date(), "yyyyMMdd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error("Failed to prepare CSV export");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handlePrint}>
        <Printer className="size-4 mr-1.5" /> Print
      </Button>
      <Button size="sm" variant="outline" onClick={handleCSV}>
        <Download className="size-4 mr-1.5" /> Soft Copy
      </Button>
    </div>
  );
}
