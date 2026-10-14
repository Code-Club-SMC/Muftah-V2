import { formatReportDate, formatReportTimestamp } from "@/lib/report-dates";
export interface ReportDocumentHeaderProps {
  title: string;
  period: { dateFrom?: string; dateTo?: string };
  source?: string;
  generatedAt: number;
  basis: string;
  periodLabel?: string;
  scope?: string;
}
export function ReportDocumentHeader({
  title,
  period,
  source,
  generatedAt,
  basis,
  periodLabel = "Period",
  scope,
}: ReportDocumentHeaderProps) {
  return (
    <header className="report-document-header mb-6 border-b pb-4">
      <p className="text-sm font-semibold">Titan ERP</p>
      <h2 className="text-xl font-semibold">
        {title}
        {scope ? ` · ${scope}` : ""}
      </h2>
      <p>
        {periodLabel}: {period.dateFrom && formatReportDate(period.dateFrom)} to{" "}
        {period.dateTo && formatReportDate(period.dateTo)}
      </p>
      {source && <p>Invoice source: {source}</p>}
      <p>
        Generated: {formatReportTimestamp(new Date(generatedAt))} · Currency:
        PKR
      </p>
      <p className="mt-2 text-sm">{basis}</p>
      <p className="report-rounding-note text-xs text-muted-foreground">
        Amounts are rounded to two decimal places. Totals use source precision
        and may differ from the sum of displayed rounded amounts.
      </p>
    </header>
  );
}
/** Shared by standard reports and profitability; natural flow allows long tables to paginate. */
export const REPORT_PRINT_CSS = `
@media print {
  @page {
    size: A4 landscape;
    margin: 11mm;
    @bottom-left { content: "Titan ERP · Operational report · PKR"; font: 8pt Arial, sans-serif; color: #444; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #444; }
  }
  html:has([data-report-document]), body:has([data-report-document]) {
    background: white !important;
    color: #111 !important;
    color-scheme: light;
    font: 9pt/1.4 Arial, sans-serif;
    margin: 0 !important;
    padding: 0 !important;
  }
  /* Remove application siblings entirely, so their height cannot create blank pages. */
  body:has([data-report-document]) *:not(:has([data-report-document])):not([data-report-document]):not([data-report-document] *) {
    display: none !important;
  }
  body *:has([data-report-document]) {
    display: block !important;
    position: static !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    width: auto !important;
    max-width: none !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    transform: none !important;
  }
  [data-report-document] {
    position: static !important;
    display: block !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    font: 9pt/1.4 Arial, sans-serif;
  }
  [data-report-document] * {
    box-shadow: none !important;
    text-shadow: none !important;
    color: #111 !important;
    background-color: transparent !important;
    border-color: #b7b7b7 !important;
    animation: none !important;
    transition: none !important;
    overflow: visible !important;
    max-height: none !important;
  }
  [data-report-document] .print\\:hidden,
  [data-report-document] .print-hidden,
  [data-report-document] button,
  [data-report-document] nav,
  [data-report-document] [role="tooltip"] { display: none !important; }
  [data-report-document] .print\\:block { display: block !important; }
  [data-report-document] .print\\:table-row { display: table-row !important; }
  [data-report-document] .print\\:table { display: table !important; }
  [data-report-document] .report-document-header {
    display: block !important;
    margin: 0 0 5mm !important;
    padding: 0 0 3mm !important;
    border-bottom: 1.5pt solid #222 !important;
    break-inside: avoid;
    font-size: 9pt;
  }
  [data-report-document] .report-document-header p { margin: 1mm 0 !important; font-size: 9pt !important; }
  [data-report-document] .report-document-header h2 { font-size: 16pt !important; margin: 1mm 0 2mm !important; }
  [data-report-document] h2 { font-size: 12pt !important; margin: 4mm 0 2mm; break-after: avoid; }
  [data-report-document] h3 { font-size: 10pt !important; break-after: avoid; }
  [data-report-document] section > div:has(> h2) { break-after: avoid; }
  [data-report-document] p { font-size: 9pt; }
  [data-report-document] [role="alert"] { display: block !important; border: 1px solid #666 !important; padding: 2.5mm !important; margin: 0 0 4mm !important; break-inside: avoid; font-size: 9pt; }
  [data-report-document] [role="alert"] > svg { display: none !important; }
  [data-report-document] [role="alert"] [data-slot="alert-description"] { font-size: 9pt !important; }
  [data-report-document] [class*="text-[10px]"], [data-report-document] [class*="text-[11px]"] { font-size: 9pt !important; }
  [data-report-document] :has(> [data-report-summary-card]) { display: grid !important; grid-template-columns: repeat(auto-fit, minmax(38mm, 1fr)) !important; gap: 3mm !important; break-inside: avoid; margin-bottom: 4mm !important; }
  [data-report-document] [data-report-summary-card] { border-bottom: 1px solid #bbb; padding: 0 0 2mm; }
  [data-report-document] [data-report-summary-card] > div:first-child { font-size: 8pt !important; letter-spacing: 0; }
  [data-report-document] [data-report-summary-card] > div:last-child { font-size: 11pt !important; }
  [data-report-document] [data-slot="table-container"] { display: block; width: 100% !important; }
  [data-report-document] table { width: 100% !important; border-collapse: collapse; font-size: 9pt !important; table-layout: auto !important; }
  [data-report-document] th, [data-report-document] td {
    font-size: 9pt !important;
    line-height: 1.35 !important;
    padding: 1.5mm 1.2mm !important;
    border-bottom: 0.5pt solid #bbb !important;
    white-space: normal !important;
    overflow-wrap: anywhere;
    vertical-align: top;
    height: auto !important;
  }
  [data-report-document] th { text-align: left; text-transform: none !important; overflow-wrap: normal; word-break: normal; font-weight: 700; background: #eee !important; print-color-adjust: exact; }
  [data-report-document] .text-right { text-align: right !important; font-variant-numeric: tabular-nums; }
  [data-report-document] td.text-right { white-space: nowrap !important; overflow-wrap: normal; }
  [data-report-document] td .text-xs, [data-report-document] td [data-slot="badge"] { font-size: 9pt !important; }
  [data-report-document] thead { display: table-header-group; }
  [data-report-document] tfoot { display: table-row-group; }
  [data-report-document] tr { break-inside: avoid; }
  [data-report-document] .report-total, [data-report-document] .report-signatures { break-inside: avoid; }
  [data-report-document] .report-salary-detail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm; break-inside: avoid; }
  [data-report-document] .report-salary-detail > h3, [data-report-document] .report-salary-detail > p { grid-column: 1 / -1; }
  [data-report-document] .report-salary-detail > div { margin-top: 0 !important; }
  [data-report-document] [data-pnl-section] { break-inside: auto !important; page-break-inside: auto !important; border-radius: 0 !important; }
  [data-report-document] [data-pnl-section] * { min-height: 0 !important; }
  [data-report-document] [data-slot="card"] { gap: 2mm !important; padding-block: 2mm !important; }
  [data-report-document] [data-slot="card"]:not(:has(table)) { break-inside: avoid !important; }
  [data-report-document] [data-slot="card-header"], [data-report-document] [data-slot="card-content"] { padding: 2mm !important; }
  [data-report-document] [data-slot="card-header"] { break-after: avoid; }
  [data-report-document] [data-slot="card-content"] { break-before: avoid; }
  [data-report-document] .text-5xl { font-size: 20pt !important; }
  [data-report-document] .text-4xl { font-size: 18pt !important; }
  [data-report-document] .text-3xl { font-size: 16pt !important; }
  [data-report-document] svg { display: none !important; }
  [data-report-document] a { text-decoration: none !important; }
  [data-report-document] [data-slot="badge"] { border-color: #666 !important; border-radius: 0 !important; }
}
`;
export function ReportPrintStyles() {
  return <style>{REPORT_PRINT_CSS}</style>;
}
