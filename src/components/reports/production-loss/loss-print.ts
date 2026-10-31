import type { LossPrintData } from "@/server-functions/reports/production-loss-fn";
import { LOSS_TAB_LABELS } from "@/lib/production/loss-report";
import { formatLossRange } from "@/lib/production/loss-display";

const COMPANY_NAME = "Muftah Chemical Pvt Ltd.";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Same look as the Production QC print, but landscape for the wide tables.
const PRINT_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; background: #fff; }
.sheet { display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 10px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.brand img { width: 44px; height: 44px; object-fit: contain; }
.doc { text-align: right; }
.doc h1 { font-size: 16px; }
.doc p { color: #4b5563; font-size: 11px; }
.filters { color: #374151; }
.summary { display: flex; flex-wrap: wrap; border: 1px solid #9ca3af; }
.summary div { padding: 6px 10px; border-right: 1px solid #9ca3af; }
.summary div:last-child { border-right: 0; }
.summary span { display: block; color: #4b5563; font-size: 10px; text-transform: uppercase; }
.summary b { font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td, th { border: 1px solid #9ca3af; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #e5e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.num { text-align: right; white-space: nowrap; }
tr.over td { color: #b91c1c; font-weight: 700; }
tr.total td { font-weight: 700; background: #f3f4f6; }
.signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 30px; break-inside: avoid; }
.sign { border-top: 1.5px solid #111827; padding-top: 6px; color: #4b5563; }
`;

export function productionLossPrintHtml(data: LossPrintData, printedAt = new Date(), origin = window.location.origin) {
  const title = `Production Loss Report · ${LOSS_TAB_LABELS[data.tab]}`;
  const cellClass = (index: number) => (data.columns[index]?.numeric ? ' class="num"' : "");
  const head = data.columns.map((column, i) => `<th${cellClass(i)}>${escapeHtml(column.label)}</th>`).join("");
  const body = data.rows.map((row) => `<tr${row.over ? ' class="over"' : ""}>${row.cells.map((cell, i) =>
    `<td${cellClass(i)}>${row.over && data.columns[i]?.percent ? "▲" : ""}${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n");
  const totals = `<tr class="total">${data.totals.map((cell, i) => `<td${cellClass(i)}>${escapeHtml(cell)}</td>`).join("")}</tr>`;
  const summary = data.summary.map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`).join("");
  const printed = printedAt.toLocaleString("en-PK", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  // The page footer repeats the print time and page number on every page.
  const pageRule = `@page { size: A4 landscape; margin: 12mm 12mm 16mm;
  @bottom-left { content: ${JSON.stringify(`Printed ${printed}`)}; font: 10px Arial, Helvetica, sans-serif; color: #6b7280; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 10px Arial, Helvetica, sans-serif; color: #6b7280; } }`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${pageRule}${PRINT_STYLES}</style>
</head>
<body>
<main class="sheet">
  <header class="head">
    <div class="brand"><img src="${origin}/company-logo.svg" alt="" />${COMPANY_NAME}</div>
    <div class="doc">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(formatLossRange(data.dateFrom, data.dateTo))}</p>
    </div>
  </header>
  <p class="filters">Filters: ${escapeHtml(data.filtersText)}</p>
  <section class="summary">${summary}</section>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot>${totals}</tfoot>
  </table>
  <section class="signs">
    <div class="sign">Prepared by</div>
    <div class="sign">Approved by (name and signature)</div>
    <div class="sign">Date</div>
  </section>
</main>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

export function printProductionLoss(data: LossPrintData) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.write(productionLossPrintHtml(data));
  printWindow.document.close();
  return true;
}
