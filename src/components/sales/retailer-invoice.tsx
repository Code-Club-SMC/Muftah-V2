import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type RetailerInvoiceItem = {
    sNo: number;
    productName: string;
    hsnCode: string;
    gstRate: number;
    rate: number;
    /** Total packs dispatched (billed + discount). May include "+N" suffix for discount cartons. */
    qty: number | string;
    grossAmount: number;
    /** Matches official label spelling "Net Ammount" */
    netAmount: number;
};

export type RetailerInvoiceData = {
    invoiceNo: number | string;
    /** Display date string, e.g. "4/11/2026" */
    date: string;
    /** e.g. "State Sale" | "Inter-State Sale" */
    saleType: string;
    customer: {
        name: string;
        completeAddress: string;
        phoneNumber: string;
    };
    items: RetailerInvoiceItem[];
    /** CGST rate in %, e.g. 9 for 9% */
    cgstRate: number;
    /** SGST rate in %, e.g. 9 for 9% */
    sgstRate: number;
    totalProfit?: number;
    /** Optional: booked order number this invoice was generated from */
    bookedOrderNo?: string | number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtN(val: number): string {
    return val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtD(val: number): string {
    return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberToWords(n: number): string {
    if (n === 0) return "Zero Rupees Only";

    const ones = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen",
    ];
    const tensArr = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    function convert(num: number): string {
        if (num === 0) return "";
        if (num < 20) return ones[num];
        if (num < 100) return tensArr[Math.floor(num / 10)] + (num % 10 !== 0 ? " " + ones[num % 10] : "");
        if (num < 1_000) return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 !== 0 ? " " + convert(num % 100) : "");
        if (num < 1_00_000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 !== 0 ? " " + convert(num % 1000) : "");
        if (num < 1_00_00_000) return convert(Math.floor(num / 1_00_000)) + " Lakh" + (num % 1_00_000 !== 0 ? " " + convert(num % 1_00_000) : "");
        return convert(Math.floor(num / 1_00_00_000)) + " Crore" + (num % 1_00_00_000 !== 0 ? " " + convert(num % 1_00_00_000) : "");
    }

    const rupees = Math.floor(n);
    const paisa = Math.round((n - rupees) * 100);
    let result = convert(rupees) + " Rupees";
    if (paisa > 0) result += " and " + convert(paisa) + " Paisa";
    return result + " Only";
}

// ── Theme colours ─────────────────────────────────────────────────────────────
const YELLOW = "#FFC000";
const YELLOW_LT = "#FFF2CC";
const GREEN_PROD = "#70AD47";
const BLUE_QTY = "#00B0F0";
const OUTER = "1px solid #999";
const INNER = "1px solid #ccc";

// ── Style helpers ─────────────────────────────────────────────────────────────
const fz = 11;
const cellBase: React.CSSProperties = { padding: "3px 6px", fontSize: fz, border: INNER, verticalAlign: "middle" };
const th = (extra?: React.CSSProperties): React.CSSProperties => ({
    ...cellBase,
    fontWeight: 700,
    background: YELLOW,
    textAlign: "center",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact" as never,
    ...extra,
});
const tdBase: React.CSSProperties = { ...cellBase };
const tdR: React.CSSProperties = { ...cellBase, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const tdC: React.CSSProperties = { ...cellBase, textAlign: "center" };

// ── Component ─────────────────────────────────────────────────────────────────

type RetailerInvoiceViewProps = {
    invoice: RetailerInvoiceData;
    showActions?: boolean;
};

export const RetailerInvoiceView = ({
    invoice,
    showActions = true,
}: RetailerInvoiceViewProps) => {
    const printRef = useRef<HTMLDivElement>(null);

    // ── Computed totals ──────────────────────────────────────────────────────
    const grossTotal = invoice.items.reduce((s, it) => s + it.grossAmount, 0);
    const cgstAmt = grossTotal * invoice.cgstRate / 100;
    const sgstAmt = grossTotal * invoice.sgstRate / 100;
    const grandTotal = grossTotal + cgstAmt + sgstAmt;
    const amtWords = numberToWords(Math.round(grandTotal));
    const MIN_ROWS = 10;
    const blankRows = Math.max(0, MIN_ROWS - invoice.items.length);

    // ── Print ────────────────────────────────────────────────────────────────
    const handlePrint = () => {
        const pw = window.open("", "_blank");
        if (!pw) { window.print(); return; }

        const itemRows = invoice.items.map((it) => `
            <tr>
                <td class="tc">${it.sNo}</td>
                <td class="td-green">${it.productName}</td>
                <td class="tc">${it.hsnCode}</td>
                <td class="tc">${it.gstRate > 0 ? it.gstRate + "%" : ""}</td>
                <td class="tr">${fmtN(it.rate)}</td>
                <td class="td-blue tc">${it.qty !== 0 && it.qty !== "" ? it.qty : ""}</td>
                <td class="tr">${fmtN(it.grossAmount)}</td>
                <td class="tr">${fmtN(it.netAmount)}</td>
            </tr>`
        ).join("");

        const blankHtml = Array(blankRows).fill(`
            <tr>
                <td></td>
                <td class="td-green"></td>
                <td></td><td></td><td></td>
                <td class="td-blue"></td>
                <td></td><td></td>
            </tr>`
        ).join("");

        pw.document.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Invoice #${invoice.invoiceNo} – Muftah Chemical Pvt Ltd</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;}
@media print{@page{margin:8mm;size:A4;}}
.wrap{max-width:800px;margin:0 auto;padding:16px 20px;}

/* ── Header ── */
.co-hdr{background:${YELLOW};padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border:1px solid #ccc;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.co-left{display:flex;align-items:center;gap:10px;}
.co-name{font-size:22px;font-weight:900;letter-spacing:.5px;color:#111;}
.co-sub{font-size:10px;color:#222;margin-top:2px;}

/* ── Customer Detail section ── */
.cd-lbl{background:${YELLOW};font-weight:700;font-size:11px;padding:4px 8px;border:1px solid #ccc;border-bottom:none;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.cd-row{display:flex;gap:0;border:1px solid #ccc;}
.cd-left{flex:1.4;padding:6px 10px;border-right:1px solid #ccc;}
.cd-right{flex:1;padding:6px 10px;}
.cd-field{display:flex;align-items:center;margin-bottom:5px;font-size:11px;}
.cd-field-lbl{font-weight:700;width:140px;flex-shrink:0;}
.cd-field-val{border:1px solid #ccc;flex:1;padding:2px 6px;min-height:18px;}
.cd-field-val-sm{border:1px solid #ccc;padding:2px 6px;min-width:80px;text-align:right;}

/* ── Items table ── */
table{width:100%;border-collapse:collapse;margin-top:8px;}
th{padding:3px 6px;font-size:11px;font-weight:700;background:${YELLOW};border:1px solid #ccc;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
td{padding:3px 6px;font-size:11px;border:1px solid #ccc;vertical-align:middle;}
.tc{text-align:center;}
.tr{text-align:right;font-variant-numeric:tabular-nums;}
.td-green{background:${GREEN_PROD};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.td-blue{background:${BLUE_QTY};-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:center;}

/* ── Bottom section ── */
.bottom{display:flex;gap:12px;margin-top:8px;align-items:flex-start;}
.stamp-grid{flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,28px);gap:0;}
.stamp-cell{border:1px solid #ccc;background:#fff;}
.summary-tbl{width:200px;border-collapse:collapse;}
.summary-tbl th{padding:3px 6px;font-size:11px;font-weight:700;background:${YELLOW};border:1px solid #ccc;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.summary-tbl td{padding:3px 6px;font-size:11px;border:1px solid #ccc;text-align:right;font-variant-numeric:tabular-nums;}
.summary-tbl td.lbl{text-align:left;font-weight:600;}

/* ── Amount in words ── */
.aiw{display:flex;border:1px solid #ccc;border-top:none;font-size:11px;}
.aiw-lbl{background:${YELLOW};font-weight:700;padding:4px 8px;white-space:nowrap;border-right:1px solid #ccc;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.aiw-val{padding:4px 8px;flex:1;}

/* ── Signatures ── */
.sigs{display:flex;justify-content:space-between;padding:40px 20px 10px;}
.sig-blk{text-align:center;width:180px;}
.sig-line{border-top:1px solid #111;padding-top:4px;font-size:11px;font-weight:700;}

/* ── Footer ── */
.footer{background:${YELLOW};text-align:center;font-weight:800;font-size:13px;padding:8px;margin-top:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
</style>
</head>
<body>
<div class="wrap">

  <!-- Company Header -->
  <div class="co-hdr">
    <div class="co-left">
      <img src="/company-logo.svg" alt="Muftah" style="width:50px;height:50px;object-fit:contain;"/>
      <div>
        <div class="co-name">MUFTAH CHEMICAL PVT LTD</div>
        <div class="co-sub">Dagi Jadeed, Nowshera, KPK, Pakistan</div>
        <div class="co-sub">Phone: +92 300 9040816, Email: swash.detergents@gmail.com</div>
      </div>
    </div>
  </div>

  <!-- Customer Detail -->
  <div style="margin-top:10px;">
    <div class="cd-lbl">Customer Detail</div>
    <div class="cd-row">
      <div class="cd-left">
        <div class="cd-field">
          <span class="cd-field-lbl">CUSTOMER NAME</span>
          <span class="cd-field-val">${invoice.customer.name}</span>
        </div>
        <div class="cd-field">
          <span class="cd-field-lbl">COMPLETE ADDRESS</span>
          <span class="cd-field-val">${invoice.customer.completeAddress}</span>
        </div>
        <div class="cd-field" style="margin-bottom:0">
          <span class="cd-field-lbl">PHONE NUMBER</span>
          <span class="cd-field-val">${invoice.customer.phoneNumber}</span>
        </div>
      </div>
      <div class="cd-right">
        <div class="cd-field">
          <span class="cd-field-lbl">INVOICE NO</span>
          <span class="cd-field-val-sm">${invoice.invoiceNo}</span>
        </div>
        <div class="cd-field">
          <span class="cd-field-lbl">DATE</span>
          <span class="cd-field-val-sm">${invoice.date}</span>
        </div>
        ${invoice.bookedOrderNo !== undefined && invoice.bookedOrderNo !== null ? `<div class="cd-field"><span class="cd-field-lbl">BOOKED ORDER #</span><span class="cd-field-val-sm">${invoice.bookedOrderNo}</span></div>` : `<div class="cd-field" style="margin-bottom:0"><span class="cd-field-lbl">SELECT SALE TYPE</span><span style="font-size:11px;">${invoice.saleType}</span></div>`}
      </div>
    </div>
  </div>

  <!-- Products Table -->
  <table>
    <thead>
      <tr>
        <th style="width:5%">S. NO</th>
        <th style="width:22%">Product Name</th>
        <th style="width:10%">HSN Code</th>
        <th style="width:8%">GST Rate</th>
        <th style="width:9%">Rate</th>
        <th style="width:8%">Qty</th>
        <th style="width:14%">Gross Amount</th>
        <th style="width:14%">Net Ammount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${blankHtml}
    </tbody>
  </table>

  <!-- Bottom: stamp grid + summary -->
  <div class="bottom">
    <div class="stamp-grid">
      ${Array(12).fill('<div class="stamp-cell"></div>').join("")}
    </div>
    <div style="flex:1"></div>
    <table class="summary-tbl">
      <thead>
        <tr><th>SUMMARY</th><th>AMOUNT</th></tr>
      </thead>
      <tbody>
        <tr><td class="lbl">Gross Amount</td><td>${grossTotal > 0 ? fmtD(grossTotal) : "0"}</td></tr>
        <tr><td class="lbl">CGST</td><td>${cgstAmt > 0 ? fmtD(cgstAmt) : "0"}</td></tr>
        <tr><td class="lbl">SGST</td><td>${sgstAmt > 0 ? fmtD(sgstAmt) : "0"}</td></tr>
        ${invoice.totalProfit !== undefined ? `<tr><td class="lbl">Total Profit</td><td>${fmtD(invoice.totalProfit)}</td></tr>` : ""}
        <tr><td class="lbl" style="font-weight:800">Grand Total</td><td style="font-weight:800">${grandTotal > 0 ? fmtD(grandTotal) : "0"}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Amount in Words -->
  <div class="aiw">
    <div class="aiw-lbl">Amount In Words</div>
    <div class="aiw-val">${grandTotal > 0 ? amtWords : "0"}</div>
  </div>

  <!-- Signatures -->
  <div class="sigs">
    <div class="sig-blk">
      <div class="sig-line">Customer Signature</div>
    </div>
    <div class="sig-blk">
      <div class="sig-line">Account Signature</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">Thank you for being a part of our journey.</div>

</div>
</body>
</html>`);
        pw.document.close();
        setTimeout(() => { try { pw.focus(); pw.print(); } catch (_) { } }, 400);
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div style={{ maxWidth: 800, margin: "0 auto", background: "#fff", fontFamily: "Arial, sans-serif", color: "#111" }}>

            {showActions && (
                <div className="flex justify-end gap-3 print:hidden py-3 px-4 border-b border-gray-200 mb-4 bg-gray-50">
                    <Button variant="outline" size="sm" onClick={handlePrint} className="h-8 text-xs font-semibold">
                        <Printer className="size-3.5 mr-2" /> Print / Save PDF
                    </Button>
                </div>
            )}

            <div ref={printRef} style={{ padding: "16px 20px" }}>

                {/* ── Company Header (yellow bar) ── */}
                <div style={{
                    background: YELLOW,
                    padding: "8px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: OUTER,
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact" as never,
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <img
                            src="/company-logo.svg"
                            alt="Muftah"
                            style={{ width: 50, height: 50, objectFit: "contain" }}
                        />
                        <div>
                            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 0.5 }}>
                                MUFTAH CHEMICAL PVT LTD
                            </div>
                            <div style={{ fontSize: 10, color: "#222", marginTop: 2 }}>
                                Dagi Jadeed, Nowshera, KPK, Pakistan
                            </div>
                            <div style={{ fontSize: 10, color: "#222" }}>
                                Phone: +92 300 9040816, Email: swash.detergents@gmail.com
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Customer Detail ── */}
                <div style={{ marginTop: 10 }}>
                    {/* Yellow "Customer Detail" label */}
                    <div style={{
                        background: YELLOW,
                        fontWeight: 700,
                        fontSize: fz,
                        padding: "4px 8px",
                        border: OUTER,
                        borderBottom: "none",
                        display: "inline-block",
                        WebkitPrintColorAdjust: "exact",
                        printColorAdjust: "exact" as never,
                    }}>
                        Customer Detail
                    </div>

                    {/* Customer fields row */}
                    <div style={{ display: "flex", border: OUTER }}>

                        {/* Left: name / address / phone */}
                        <div style={{ flex: 1.4, padding: "6px 10px", borderRight: INNER }}>
                            {(
                                [
                                    ["CUSTOMER NAME", invoice.customer.name],
                                    ["COMPLETE ADDRESS", invoice.customer.completeAddress],
                                    ["PHONE NUMBER", invoice.customer.phoneNumber],
                                ] as [string, string][]
                            ).map(([lbl, val]) => (
                                <div key={lbl} style={{ display: "flex", alignItems: "center", marginBottom: 5, fontSize: fz }}>
                                    <span style={{ fontWeight: 700, width: 140, flexShrink: 0 }}>{lbl}</span>
                                    <span style={{ border: INNER, flex: 1, padding: "2px 6px", minHeight: 18 }}>{val}</span>
                                </div>
                            ))}
                        </div>

                        {/* Right: invoice no / date / sale type */}
                        <div style={{ flex: 1, padding: "6px 10px" }}>
                            {(() => {
                                const fields: [string, string][] = [
                                    ["INVOICE NO", String(invoice.invoiceNo)],
                                    ["DATE", invoice.date],
                                ];
                                if (invoice.bookedOrderNo !== undefined && invoice.bookedOrderNo !== null) {
                                    fields.push(["BOOKED ORDER #", String(invoice.bookedOrderNo)]);
                                } else {
                                    fields.push(["SELECT SALE TYPE", invoice.saleType]);
                                }
                                return fields.map(([lbl, val]) => (
                                    <div key={lbl} style={{ display: "flex", alignItems: "center", marginBottom: 5, fontSize: fz }}>
                                        <span style={{ fontWeight: 700, width: 120, flexShrink: 0 }}>{lbl}</span>
                                        <span style={{ border: INNER, padding: "2px 6px", minWidth: 80, textAlign: "right" }}>{val}</span>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>

                {/* ── Products table ── */}
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                    <colgroup>
                        <col style={{ width: "5%" }} />
                        <col style={{ width: "22%" }} />
                        <col style={{ width: "10%" }} />
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "9%" }} />
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "14%" }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th style={th()}>S. NO</th>
                            <th style={th()}>Product Name</th>
                            <th style={th()}>HSN Code</th>
                            <th style={th()}>GST Rate</th>
                            <th style={th()}>Rate</th>
                            <th style={th()}>Qty</th>
                            <th style={th()}>Gross Amount</th>
                            <th style={th()}>Net Ammount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Data rows */}
                        {invoice.items.map((it) => (
                            <tr key={it.sNo}>
                                <td style={tdC}>{it.sNo}</td>
                                <td style={{ ...tdBase, background: GREEN_PROD, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as never }}>
                                    {it.productName}
                                </td>
                                <td style={tdC}>{it.hsnCode}</td>
                                <td style={tdC}>{it.gstRate > 0 ? `${it.gstRate}%` : ""}</td>
                                <td style={tdR}>{it.rate > 0 ? fmtN(it.rate) : ""}</td>
                                <td style={{ ...tdC, background: BLUE_QTY, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as never }}>
                                    {it.qty !== 0 && it.qty !== "" ? it.qty : ""}
                                </td>
                                <td style={tdR}>{it.grossAmount > 0 ? fmtN(it.grossAmount) : ""}</td>
                                <td style={tdR}>{it.netAmount > 0 ? fmtN(it.netAmount) : ""}</td>
                            </tr>
                        ))}

                        {/* Blank filler rows to match template look */}
                        {Array(blankRows).fill(null).map((_, i) => (
                            <tr key={`blank-${i}`} style={{ height: 22 }}>
                                <td style={cellBase}></td>
                                <td style={{ ...cellBase, background: GREEN_PROD, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as never }}></td>
                                <td style={cellBase}></td>
                                <td style={cellBase}></td>
                                <td style={cellBase}></td>
                                <td style={{ ...cellBase, background: BLUE_QTY, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as never }}></td>
                                <td style={cellBase}></td>
                                <td style={cellBase}></td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* ── Bottom section: stamp grid + summary ── */}
                <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "flex-start" }}>

                    {/* Left: stamp/verification grid (4×3) */}
                    <div style={{
                        flex: 1,
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gridTemplateRows: "repeat(3, 28px)",
                    }}>
                        {Array(12).fill(null).map((_, i) => (
                            <div key={i} style={{ border: INNER }}></div>
                        ))}
                    </div>

                    <div style={{ flex: 1 }}></div>

                    {/* Right: summary table */}
                    <table style={{ width: 200, borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={th({ textAlign: "left" })}>SUMMARY</th>
                                <th style={th()}>AMOUNT</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={{ ...tdBase, fontWeight: 600 }}>Gross Amount</td>
                                <td style={tdR}>{grossTotal > 0 ? fmtD(grossTotal) : "0"}</td>
                            </tr>
                            <tr>
                                <td style={{ ...tdBase, fontWeight: 600 }}>CGST</td>
                                <td style={tdR}>{cgstAmt > 0 ? fmtD(cgstAmt) : "0"}</td>
                            </tr>
                            <tr>
                                <td style={{ ...tdBase, fontWeight: 600 }}>SGST</td>
                                <td style={tdR}>{sgstAmt > 0 ? fmtD(sgstAmt) : "0"}</td>
                            </tr>
                            {invoice.totalProfit !== undefined && (
                                <tr>
                                    <td style={{ ...tdBase, fontWeight: 600 }}>Total Profit</td>
                                    <td style={tdR}>{fmtD(invoice.totalProfit)}</td>
                                </tr>
                            )}
                            <tr>
                                <td style={{ ...tdBase, fontWeight: 800 }}>Grand Total</td>
                                <td style={{ ...tdR, fontWeight: 800 }}>{grandTotal > 0 ? fmtD(grandTotal) : "0"}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* ── Amount in Words ── */}
                <div style={{ display: "flex", border: OUTER, borderTop: "none", fontSize: fz }}>
                    <div style={{
                        background: YELLOW,
                        fontWeight: 700,
                        padding: "4px 8px",
                        whiteSpace: "nowrap",
                        borderRight: INNER,
                        WebkitPrintColorAdjust: "exact",
                        printColorAdjust: "exact" as never,
                    }}>
                        Amount In Words
                    </div>
                    <div style={{ padding: "4px 8px", flex: 1 }}>
                        {grandTotal > 0 ? amtWords : "0"}
                    </div>
                </div>

                {/* ── Signatures ── */}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "40px 20px 10px" }}>
                    {["Customer Signature", "Account Signature"].map((sig) => (
                        <div key={sig} style={{ textAlign: "center", width: 180 }}>
                            <div style={{
                                borderTop: "1px solid #111",
                                paddingTop: 4,
                                fontSize: fz,
                                fontWeight: 700,
                            }}>
                                {sig}
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Footer ── */}
                <div style={{
                    background: YELLOW,
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    padding: 8,
                    marginTop: 16,
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact" as never,
                }}>
                    Thank you for being a part of our journey.
                </div>

            </div>{/* /printRef */}
        </div>
    );
};