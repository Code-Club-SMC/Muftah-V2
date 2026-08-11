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
  const [includeLineItems] = useState(true);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const fmtPKR = (v: number): string =>
    `PKR ${Math.abs(v).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

  const balLabel = (v: number) => (v >= 0 ? "Dr." : "Cr.");

  const getDebitAmount = (entry: LedgerEntry) =>
    entry.type === "invoice" ? entry.totalPrice : 0;

  const getCreditAmount = (entry: LedgerEntry) => {
    if (entry.type === "return") {
      return entry.amount;
    }
    if (entry.type === "payment") {
      return entry.amount;
    }
    return 0;
  };

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
        ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:48px;color:rgba(200,200,200,0.15);pointer-events:none;z-index:9999;white-space:nowrap;font-weight:bold;">${watermark}</div>`
        : "";

      // Build transaction rows
      let totalDebit = 0;
      let totalCredit = 0;

      const rowHtml = exportEntries
        .map((entry) => {
          const isInvoice = entry.type === "invoice";
          const isReturn = entry.type === "return";
          const pay = entry.type === "payment" ? entry : null;

          // Every invoice is a full debit. Confirmed payments and approved
          // returns are credits.
          const debitAmount = getDebitAmount(entry);
          const creditAmount = getCreditAmount(entry);

          totalDebit += debitAmount;
          totalCredit += creditAmount;

          const desc = isInvoice
            ? `${entry.warehouseName || "Invoice"}<br><span style="font-size:10px;color:#64748b;">Paid Amount: ${fmtPKR(entry.paidAmount)} · Returned Amount: ${fmtPKR(entry.returnedAmount)} · Outstanding Amount: ${fmtPKR(entry.outstandingAmount)}</span>`
            : isReturn
              ? `<span style="color:#b45309;font-weight:600;">Sales Return #${entry.returnNumber}</span><br><span style="font-size:10px;color:#3b82f6;">Invoice #${entry.invoiceNumber}</span><br><span style="font-size:10px;color:#64748b;">Reason: ${entry.reason} · Condition: ${entry.condition}</span>`
              : `Payment (${entry.method.replaceAll("_", " ")})${entry.reference ? `<br><span style="font-size:10px;color:#64748b;">Ref: ${entry.reference}</span>` : ""}<br><span style="font-size:10px;color:#3b82f6;">Invoice #${entry.invoiceNumber}</span>`;

          const vrNo = isInvoice
            ? entry.invoiceNumber
            : isReturn
              ? `RET-${entry.returnNumber ?? "—"}`
              : (pay?.reference || "—");
          const rowBg = isReturn ? "#fff7ed" : !isInvoice ? "#f8fff8" : "#fff";
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
                    <tr style="border-top:2px solid #ccc;">
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
            <tr style="background:${rowBg};">
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;white-space:nowrap;">${format(new Date(entry.date), "dd-MMM-yyyy")}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;font-weight:600;">${vrNo}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;">${desc}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;${debitAmount > 0 ? "font-weight:600;" : "color:#94a3b8;"}">${debitAmount > 0 ? fmtPKR(debitAmount) : "—"}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;${creditStyle}">${creditAmount > 0 ? fmtPKR(creditAmount) : "—"}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:700;">${fmtPKR(entry.runningBalance)} <span style="font-weight:400;font-size:10px;color:#64748b;">${balLabel(entry.runningBalance)}</span></td>
            </tr>
            ${lineItemsHtml}
          `;
        })
        .join("");

      // Company header
      const companyHeaderHtml = companyInfo ? `
        <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:3px solid #1e293b;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:18px;font-weight:700;color:#1e293b;">${companyInfo.name}</div>
              <div style="font-size:10px;color:#64748b;margin-top:3px;">${companyInfo.address}</div>
              <div style="font-size:10px;color:#64748b;">Phone: ${companyInfo.phone}${companyInfo.email ? ` | Email: ${companyInfo.email}` : ""}</div>
              ${companyInfo.ntn ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px;">NTN: ${companyInfo.ntn}${companyInfo.strn ? ` | STRN: ${companyInfo.strn}` : ""}</div>` : ""}
            </div>
            <div style="text-align:right;">
              <div style="font-size:16px;font-weight:700;color:#1e293b;">${title}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">${subtitle || ""}</div>
              <div style="font-size:10px;color:#94a3b8;margin-top:2px;">Print Date: ${format(new Date(), "dd-MMM-yyyy")}</div>
            </div>
          </div>
        </div>
      ` : `
        <div style="border-bottom:3px solid #1e293b;padding-bottom:10px;margin-bottom:12px;">
          <div style="font-size:18px;font-weight:700;">${title}</div>
          <div style="font-size:11px;color:#64748b;">${subtitle || ""}</div>
        </div>
      `;

      // Period info
      const periodHtml = `
        <div style="font-size:10px;color:#64748b;margin-bottom:12px;display:flex;justify-content:space-between;">
          <div>
            <strong style="color:#1e293b;">Account:</strong> ${customerInfo?.name || ""}
            ${customerInfo?.city ? `<br><strong style="color:#1e293b;">City:</strong> ${customerInfo.city}` : ""}
            ${customerInfo?.mobileNumber ? `<br><strong style="color:#1e293b;">Contact:</strong> ${customerInfo.mobileNumber}` : ""}
          </div>
          <div style="text-align:right;">
            <strong style="color:#1e293b;">Period:</strong> ${periodLabel || "All"}
            <br><strong style="color:#1e293b;">Generated by:</strong> ${watermark || "System"}
          </div>
        </div>
      `;

      // Opening balance row
      const openingDebit = summary.openingBalance > 0 ? summary.openingBalance : 0;
      const openingCredit = summary.openingBalance < 0 ? Math.abs(summary.openingBalance) : 0;
      const obDebit = openingDebit > 0 ? fmtPKR(openingDebit) : "—";
      const obCredit = openingCredit > 0 ? fmtPKR(openingCredit) : "—";
      const openingRowHtml = `
        <tr style="background:#f5f5f5;">
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;color:#64748b;">—</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;color:#64748b;">—</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;font-weight:700;">Opening Balance</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:600;">${obDebit}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:600;">${obCredit}</td>
          <td style="border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:right;font-weight:700;">${fmtPKR(summary.openingBalance)} <span style="font-weight:400;font-size:10px;color:#64748b;">${balLabel(summary.openingBalance)}</span></td>
        </tr>
      `;

      // Totals footer row
      const grandDebit = openingDebit + totalDebit;
      const grandCredit = openingCredit + totalCredit;
      const totalsRowHtml = `
        <tr style="background:#f0f0f0;font-weight:700;border-top:3px solid #1e293b;">
          <td colspan="3" style="border:1px solid #ccc;padding:8px;font-size:11px;text-align:right;border-top:3px solid #1e293b;">
            Total With Opening Balance:
          </td>
          <td style="border:1px solid #ccc;padding:8px;font-size:11px;text-align:right;border-top:3px solid #1e293b;">${fmtPKR(grandDebit)}</td>
          <td style="border:1px solid #ccc;padding:8px;font-size:11px;text-align:right;border-top:3px solid #1e293b;">${fmtPKR(grandCredit)}</td>
          <td style="border:1px solid #ccc;padding:8px;font-size:11px;text-align:right;text-decoration:underline;border-top:3px solid #1e293b;">
            ${fmtPKR(summary.closingBalance)} <span style="font-weight:400;font-size:10px;color:#64748b;text-decoration:none;">${balLabel(summary.closingBalance)}</span>
          </td>
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
            ${periodHtml}
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
      const obRow = [
        "Opening Balance", "—", "Opening Balance",
        summary.openingBalance > 0 ? String(summary.openingBalance) : "",
        summary.openingBalance < 0 ? String(Math.abs(summary.openingBalance)) : "",
        String(summary.openingBalance), "", "",
      ];

      const rows = exportEntries.map((entry) => {
        const isInvoice = entry.type === "invoice";
        const isReturn = entry.type === "return";
        const date = format(new Date(entry.date), "dd-MMM-yyyy");
        const vrNo = isInvoice
          ? entry.invoiceNumber
          : isReturn
            ? `RET-${entry.returnNumber ?? ""}`
            : (entry.reference || "");
        const desc = isInvoice
          ? `${entry.warehouseName || "Invoice"} (Paid Amount: ${entry.paidAmount}, Returned Amount: ${entry.returnedAmount}, Outstanding Amount: ${entry.outstandingAmount})`
          : isReturn
            ? `Sales Return #${entry.returnNumber} (Invoice ${entry.invoiceNumber}) - ${entry.reason}`
            : `Payment (${entry.method.replaceAll("_", " ")}) for Invoice ${entry.invoiceNumber}${entry.reference ? ` Ref: ${entry.reference}` : ""}`;
        const debit = isInvoice ? String(entry.totalPrice) : "";
        const credit = !isInvoice ? String(entry.amount) : "";
        const balance = `${entry.runningBalance} ${balLabel(entry.runningBalance)}`;
        const status = isInvoice || isReturn ? entry.status : "";
        const remarks = isInvoice ? (entry.remarks || "") : (entry.notes || "");

        const baseRow = [date, vrNo, desc, debit, credit, balance, status, remarks];

        const extraRows: string[][] = [];
        if (isInvoice && includeLineItems && entry.items && entry.items.length > 0) {
          const liTotal = entry.items.reduce((s, it) => s + Number(it.amount), 0);
          const mismatch = Math.abs(liTotal - entry.totalPrice) > 1;
          entry.items.forEach((item) => {
            extraRows.push(["", "", item.pack, `Cartons: ${item.numberOfCartons}`, "", String(item.amount), "", ""]);
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
      const openingDebit = summary.openingBalance > 0 ? summary.openingBalance : 0;
      const openingCredit = summary.openingBalance < 0 ? Math.abs(summary.openingBalance) : 0;
      const totalDebit = exportEntries.reduce((s, e) => s + getDebitAmount(e), 0);
      const totalCredit = exportEntries.reduce((s, e) => s + getCreditAmount(e), 0);
      const totalsRow = [
        "", "", "Total With Opening Balance:",
        String(openingDebit + totalDebit),
        String(openingCredit + totalCredit),
        `${summary.closingBalance} ${balLabel(summary.closingBalance)}`, "", "",
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
