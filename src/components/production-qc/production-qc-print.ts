import type { MixingLabReport } from "@/server-functions/manufacturing/mixing/lab-reports-fn";
import { qcDate } from "./production-qc-report-form";

const COMPANY_NAME = "Muftah Chemical Pvt Ltd.";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PRINT_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4; margin: 14mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111827; background: #fff; }
.sheet { max-width: 760px; margin: 0 auto; padding: 0 2px; display: flex; flex-direction: column; gap: 18px; }
.head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 12px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.brand img { width: 44px; height: 44px; object-fit: contain; }
.doc { text-align: right; }
.doc h1 { font-size: 17px; }
.doc p { color: #4b5563; font-size: 11px; }
.verdict { padding: 9px 12px; border-radius: 4px; font-weight: 700; text-align: center; font-size: 13px; }
.verdict.pass { background: #ecfdf3; border: 1px solid #86efac; color: #166534; }
.verdict.fail { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #9ca3af; padding: 7px 9px; text-align: left; vertical-align: top; }
.info th { width: 18%; background: #f3f4f6; font-size: 11px; }
.info td { width: 32%; font-weight: 600; }
.checks thead th { background: #e5e7eb; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.checks .num { width: 34px; text-align: center; }
.checks .status { width: 70px; text-align: center; font-weight: 700; }
.checks .status.pass { color: #166534; }
.checks .status.fail { color: #b91c1c; }
.checks tr { break-inside: avoid; }
h2 { font-size: 13px; margin-bottom: 6px; }
.notes { border: 1px solid #9ca3af; padding: 9px; white-space: pre-wrap; }
.signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 36px; break-inside: avoid; }
.sign { border-top: 1.5px solid #111827; padding-top: 6px; }
.sign b { display: block; }
.sign span { color: #4b5563; font-size: 11px; }
.foot { display: flex; justify-content: space-between; color: #6b7280; font-size: 10px; border-top: 1px solid #d1d5db; padding-top: 8px; }
`;

export function productionQCPrintHtml(
  report: MixingLabReport,
  batchId?: string,
  printedAt = new Date(),
) {
  const total = report.analysisItems.length;
  const passed = report.analysisItems.filter((check) => check.passed).length;
  const allPassed = passed === total;
  const info: [string, string | null | undefined][] = [
    ["Product", report.productName],
    ["Batch number", batchId],
    ["Lot number", report.lotNumber],
    ["Stock number", report.stockNumber],
    ["Report date", qcDate(report.reportDate)],
    ["Standard reference", report.standardReference],
  ];
  const infoRows = [0, 2, 4]
    .map(
      (start) =>
        `<tr>${info
          .slice(start, start + 2)
          .map(
            ([label, value]) =>
              `<th>${label}</th><td>${escapeHtml(value || "Not specified")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const checkRows = report.analysisItems
    .map(
      (check, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(check.item)}</td>
        <td>${escapeHtml(check.requirement)}</td>
        <td>${escapeHtml(check.result)}</td>
        <td class="status ${check.passed ? "pass" : "fail"}">${check.passed ? "Pass" : "Fail"}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>QC report</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<main class="sheet">
  <header class="head">
    <div class="brand"><img src="${window.location.origin}/company-logo.svg" alt="" />${COMPANY_NAME}</div>
    <div class="doc">
      <h1>Quality Control Report</h1>
      <p>Certificate of analysis</p>
    </div>
  </header>
  <div class="verdict ${allPassed ? "pass" : "fail"}">${
    allPassed
      ? `All ${total} checks passed`
      : `${total - passed} of ${total} checks failed`
  }</div>
  <table class="info"><tbody>${infoRows}</tbody></table>
  <section>
    <h2>Analysis results</h2>
    <table class="checks">
      <thead><tr><th class="num">#</th><th>Check</th><th>Requirement</th><th>Result</th><th class="status">Status</th></tr></thead>
      <tbody>${checkRows}</tbody>
    </table>
  </section>
  ${
    report.notes
      ? `<section><h2>Notes</h2><div class="notes">${escapeHtml(report.notes)}</div></section>`
      : ""
  }
  <section class="signs">
    <div class="sign"><b>${escapeHtml(report.certifiedBy)}</b><span>${escapeHtml(report.certifierTitle || "Tested by")}</span></div>
    <div class="sign"><b>&nbsp;</b><span>Approved by (name and signature)</span></div>
    <div class="sign"><b>&nbsp;</b><span>Date</span></div>
  </section>
  <footer class="foot">
    <span>Recorded by ${escapeHtml(report.createdBy?.name || "Not specified")}</span>
    <span>Printed ${escapeHtml(printedAt.toLocaleString("en-PK", { timeZone: "Asia/Karachi" }))}</span>
  </footer>
</main>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

export function printProductionQCReport(
  report: MixingLabReport,
  batchId?: string,
) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.write(productionQCPrintHtml(report, batchId));
  printWindow.document.title = `QC report ${batchId ?? report.lotNumber ?? ""}`.trim();
  printWindow.document.close();
  return true;
}
