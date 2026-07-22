import { useRef } from "react";
import { format } from "date-fns";
import { Button } from "../../ui/button";
import { Printer, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

type AnalysisItem = {
  item: string;
  requirement: string;
  result: string;
  passed: boolean;
};

type LabReport = {
  id: string;
  productName: string;
  stockNumber: string | null;
  lotNumber: string | null;
  analysisItems: AnalysisItem[];
  certifiedBy: string;
  certifierTitle: string | null;
  reportDate: string | Date;
  standardReference: string | null;
  notes: string | null;
  chemical: {
    id: string;
    name: string;
    unit: string;
  };
  createdBy: {
    id: string;
    name: string;
  };
};

type CertificateViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: LabReport;
  companyName?: string;
  companyTagline?: string;
};

const PRINT_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'DM Sans', sans-serif;
  color: #111827;
  background: white;
}

@media print {
  body { padding: 0; }
  @page { margin: 12mm; size: A4; }
}

.cert-wrap {
  max-width: 780px;
  margin: 0 auto;
  padding: 48px 52px;
  background: white;
  position: relative;
}

/* Watermark */
.cert-wrap::before {
  content: 'CERTIFIED';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 110px;
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  color: rgba(15, 52, 96, 0.028);
  letter-spacing: 8px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 0;
}

/* Top accent line */
.accent-bar {
  height: 5px;
  background: linear-gradient(90deg, #0f3460 0%, #1a5276 40%, #c0932f 100%);
  border-radius: 2px;
  margin-bottom: 36px;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.company-name {
  font-family: 'Playfair Display', serif;
  font-size: 26px;
  font-weight: 700;
  color: #0f3460;
  letter-spacing: 0.3px;
  line-height: 1.1;
}

.company-tagline {
  font-size: 9.5px;
  color: #6b7280;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 2.5px;
  margin-top: 5px;
}

.report-meta {
  text-align: right;
}

.report-id-label {
  font-size: 9px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 500;
  margin-bottom: 3px;
}

.report-id-value {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: #374151;
  font-weight: 500;
  letter-spacing: 0.5px;
}

/* Divider */
.divider {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin-bottom: 28px;
}

.divider-gold {
  border: none;
  border-top: 1px solid #c0932f;
  width: 48px;
  margin: 0 auto 4px;
}

/* Title Block */
.title-block {
  text-align: center;
  margin-bottom: 28px;
}

.title-eyebrow {
  font-size: 9px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #c0932f;
  font-weight: 600;
  margin-bottom: 8px;
}

.title-main {
  font-family: 'Playfair Display', serif;
  font-size: 28px;
  font-weight: 700;
  color: #0f3460;
  letter-spacing: 1px;
  line-height: 1;
  margin-bottom: 12px;
}

.title-standard {
  font-size: 10.5px;
  color: #6b7280;
  font-style: italic;
  font-weight: 400;
  line-height: 1.5;
}

/* Status Banner */
.status-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 20px;
  border-radius: 4px;
  margin-bottom: 28px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.status-banner.pass {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.status-banner.fail {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

/* Intro text */
.intro-text {
  font-size: 11px;
  color: #4b5563;
  line-height: 1.75;
  text-align: center;
  margin-bottom: 28px;
  padding: 0 20px;
  font-style: italic;
}

/* Product Info Table */
.info-grid {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 28px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  overflow: hidden;
}

.info-grid tr:not(:last-child) td {
  border-bottom: 1px solid #e5e7eb;
}

.info-grid td {
  padding: 9px 16px;
  font-size: 12px;
  vertical-align: middle;
}

.info-grid td:nth-child(odd) {
  font-size: 10px;
  color: #6b7280;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  width: 130px;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
}

.info-grid td:nth-child(even) {
  font-weight: 600;
  color: #111827;
}

.info-grid tr:nth-child(odd) td:nth-child(2) {
  border-right: 1px solid #e5e7eb;
}

/* Two-column layout for info grid */
.info-row-pair td:nth-child(2) {
  border-right: 1px solid #e5e7eb;
}

/* Analysis Table */
.analysis-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
  border: 1px solid #d1d5db;
  overflow: hidden;
  border-radius: 6px;
}

.analysis-table thead tr {
  background: #0f3460;
}

.analysis-table th {
  color: white;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.8px;
  padding: 11px 16px;
  text-align: left;
}

.analysis-table th.center {
  text-align: center;
}

.analysis-table tbody tr:nth-child(even) {
  background: #f9fafb;
}

.analysis-table tbody tr:not(:last-child) td {
  border-bottom: 1px solid #e5e7eb;
}

.analysis-table td {
  padding: 10px 16px;
  font-size: 12px;
  color: #111827;
}

.analysis-table td.num {
  color: #9ca3af;
  font-size: 11px;
  width: 36px;
  font-family: 'DM Mono', monospace;
}

.analysis-table td.item-name {
  font-weight: 600;
}

.analysis-table td.center {
  text-align: center;
}

.analysis-table td.result {
  text-align: center;
  font-family: 'DM Mono', monospace;
  font-weight: 600;
  font-size: 12px;
}

.result.pass { color: #15803d; }
.result.fail { color: #b91c1c; }

/* Pass/Fail badge */
.badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.badge.pass {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}

.badge.fail {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

/* Notes */
.notes {
  font-size: 10.5px;
  color: #4b5563;
  background: #fffbeb;
  padding: 12px 16px;
  border: 1px solid #fde68a;
  border-left: 3px solid #c0932f;
  border-radius: 4px;
  margin-bottom: 24px;
  line-height: 1.6;
}

.notes strong { color: #92400e; }

/* Disclaimer */
.disclaimer {
  font-size: 9.5px;
  color: #9ca3af;
  text-align: center;
  margin-bottom: 32px;
  font-style: italic;
  line-height: 1.6;
}

/* Signature */
.sig-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 40px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

.sig-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.sig-line {
  width: 200px;
  border-top: 1.5px solid #374151;
  margin-top: 52px;
  margin-bottom: 6px;
}

.sig-name {
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.sig-title {
  font-size: 10px;
  color: #6b7280;
  margin-top: 1px;
}

/* Footer */
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 36px;
  padding-top: 14px;
  border-top: 1px solid #e5e7eb;
}

.footer-left, .footer-right {
  font-family: 'DM Mono', monospace;
  font-size: 8.5px;
  color: #9ca3af;
  letter-spacing: 0.8px;
}

.footer-center {
  font-size: 9px;
  color: #c0932f;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 2px;
}

/* Bottom accent */
.bottom-bar {
  height: 4px;
  background: linear-gradient(90deg, #0f3460 0%, #1a5276 40%, #c0932f 100%);
  border-radius: 2px;
  margin-top: 24px;
}
`;

export const CertificateView = ({
  open,
  onOpenChange,
  report,
  companyName = "Muftah Chemical PVT LTD (S-WASH)",
  companyTagline = "Manufacturers of Cleaners & Disinfectants",
}: CertificateViewProps) => {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>COA — ${report.productName} — ${report.lotNumber || "N/A"}</title>
          <style>${PRINT_STYLES}</style>
        </head>
        <body>
          ${content.innerHTML}
          <script>window.onload = function() { window.print(); }<\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const allPassed = report.analysisItems.every((i) => i.passed);
  const passCount = report.analysisItems.filter((i) => i.passed).length;
  const reportDateFormatted = format(new Date(report.reportDate), "MMMM d, yyyy");
  const reportIdShort = report.id.substring(0, 12).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] !max-w-[1080px] max-h-[90vh] overflow-auto p-0 bg-white">
        {/* Dialog Toolbar */}
        <DialogHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-200 px-5 py-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-1.5 h-5 rounded-full"
              style={{ background: "linear-gradient(180deg, #0f3460 0%, #c0932f 100%)" }}
            />
            <div>
              <DialogTitle className="text-sm font-semibold text-gray-900 leading-none">
                Certificate of Analysis
              </DialogTitle>
              <p className="text-xs text-gray-400 mt-0.5 font-normal">
                {report.productName} &nbsp;·&nbsp; Lot {report.lotNumber || "N/A"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${allPassed ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {allPassed
                ? <ShieldCheck className="size-3" />
                : <AlertTriangle className="size-3" />
              }
              {allPassed ? "All Passed" : `${passCount}/${report.analysisItems.length} Passed`}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold border-gray-200 hover:bg-gray-50"
              onClick={handlePrint}
            >
              <Printer className="size-3 mr-1.5" />
              Print / Save PDF
            </Button>
          </div>
        </DialogHeader>

        {/* Certificate Content — rendered here and captured for print */}
        <div ref={printRef}>
          <div className="cert-wrap" style={{
            maxWidth: "780px",
            margin: "0 auto",
            padding: "48px 52px",
            background: "white",
            position: "relative",
            fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          }}>

            {/* Top gradient accent bar */}
            <div style={{
              height: "5px",
              background: "linear-gradient(90deg, #0f3460 0%, #1a5276 40%, #c0932f 100%)",
              borderRadius: "2px",
              marginBottom: "36px",
            }} />

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
              <div>
                <div style={{
                  fontFamily: "'Playfair Display', Georgia, serif",
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "#0f3460",
                  letterSpacing: "0.3px",
                  lineHeight: 1.1,
                }}>
                  {companyName}
                </div>
                <div style={{
                  fontSize: "9.5px",
                  color: "#6b7280",
                  fontWeight: 500,
                  textTransform: "uppercase" as const,
                  letterSpacing: "2.5px",
                  marginTop: "6px",
                }}>
                  {companyTagline}
                </div>
              </div>
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: "9px", color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "2px", fontWeight: 500, marginBottom: "3px" }}>
                  Report Reference
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#374151", fontWeight: 600, letterSpacing: "0.5px" }}>
                  {reportIdShort}
                </div>
                <div style={{ fontSize: "9.5px", color: "#9ca3af", marginTop: "3px" }}>
                  Issued {reportDateFormatted}
                </div>
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", marginBottom: "28px" }} />

            {/* Title Block */}
            <div style={{ textAlign: "center" as const, marginBottom: "28px" }}>
              <div style={{
                fontSize: "9px",
                letterSpacing: "4px",
                textTransform: "uppercase" as const,
                color: "#c0932f",
                fontWeight: 600,
                marginBottom: "8px",
              }}>
                Official Quality Documentation
              </div>
              <div style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: "27px",
                fontWeight: 700,
                color: "#0f3460",
                letterSpacing: "0.5px",
                lineHeight: 1,
                marginBottom: "12px",
              }}>
                Certificate of Analysis
              </div>
              <div style={{ width: "48px", borderTop: "1.5px solid #c0932f", margin: "0 auto 10px" }} />
              {report.standardReference && (
                <div style={{ fontSize: "10.5px", color: "#6b7280", fontStyle: "italic", lineHeight: 1.5 }}>
                  Manufactured under a quality system registered to {report.standardReference} Standards
                </div>
              )}
            </div>

            {/* Status Banner */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "10px 20px",
              borderRadius: "5px",
              marginBottom: "28px",
              fontSize: "10.5px",
              fontWeight: 600,
              textTransform: "uppercase" as const,
              letterSpacing: "2px",
              background: allPassed ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${allPassed ? "#bbf7d0" : "#fecaca"}`,
              color: allPassed ? "#166534" : "#991b1b",
            }}>
              <span style={{ fontSize: "14px" }}>{allPassed ? "✓" : "⚠"}</span>
              {allPassed
                ? `All ${report.analysisItems.length} Parameters Meet Specification`
                : `${passCount} of ${report.analysisItems.length} Parameters Meet Specification`
              }
            </div>

            {/* Intro Text */}
            <p style={{
              fontSize: "11px",
              color: "#4b5563",
              lineHeight: 1.75,
              textAlign: "center" as const,
              marginBottom: "28px",
              padding: "0 20px",
              fontStyle: "italic",
            }}>
              This document certifies that the listed product was produced in accordance with,
              and meets the requirements of current production and Quality Standards,
              following all GMP procedures.
            </p>

            {/* Product Info — 2-col table layout */}
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "28px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              overflow: "hidden",
              fontSize: "12px",
            }}>
              <tbody>
                {[
                  ["Product Name", report.productName, "Chemical / Active", report.chemical.name],
                  ["Stock Number", report.stockNumber || "—", "Lot Number", report.lotNumber || "—"],
                  ["Report Date", reportDateFormatted, "Prepared By", report.createdBy.name],
                ].map(([l1, v1, l2, v2], idx) => (
                  <tr key={idx} style={{ borderBottom: idx < 2 ? "1px solid #e5e7eb" : "none" }}>
                    <td style={{
                      padding: "9px 14px",
                      fontSize: "9.5px",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "1px",
                      color: "#6b7280",
                      background: "#f9fafb",
                      borderRight: "1px solid #e5e7eb",
                      width: "130px",
                    }}>{l1}</td>
                    <td style={{
                      padding: "9px 14px",
                      fontWeight: 600,
                      color: "#111827",
                      borderRight: "1px solid #e5e7eb",
                    }}>{v1}</td>
                    <td style={{
                      padding: "9px 14px",
                      fontSize: "9.5px",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "1px",
                      color: "#6b7280",
                      background: "#f9fafb",
                      borderRight: "1px solid #e5e7eb",
                      width: "130px",
                    }}>{l2}</td>
                    <td style={{ padding: "9px 14px", fontWeight: 600, color: "#111827" }}>{v2}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Analysis Table */}
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              marginBottom: "24px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              overflow: "hidden",
            }}>
              <thead>
                <tr style={{ background: "#0f3460" }}>
                  <th style={{ color: "white", fontSize: "9px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "1.8px", padding: "11px 14px", textAlign: "left" as const, width: "36px" }}>#</th>
                  <th style={{ color: "white", fontSize: "9px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "1.8px", padding: "11px 14px", textAlign: "left" as const }}>Analysis Item</th>
                  <th style={{ color: "white", fontSize: "9px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "1.8px", padding: "11px 14px", textAlign: "center" as const }}>Specification / Requirement</th>
                  <th style={{ color: "white", fontSize: "9px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "1.8px", padding: "11px 14px", textAlign: "center" as const }}>Observed Result</th>
                  <th style={{ color: "white", fontSize: "9px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "1.8px", padding: "11px 14px", textAlign: "center" as const }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.analysisItems.map((item, idx) => (
                  <tr key={idx} style={{
                    background: idx % 2 === 1 ? "#f9fafb" : "white",
                    borderBottom: idx < report.analysisItems.length - 1 ? "1px solid #e5e7eb" : "none",
                  }}>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "11px", color: "#9ca3af" }}>
                      {String(idx + 1).padStart(2, "0")}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#111827" }}>
                      {item.item}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "#374151", textAlign: "center" as const }}>
                      {item.requirement}
                    </td>
                    <td style={{
                      padding: "10px 14px",
                      fontSize: "12px",
                      textAlign: "center" as const,
                      fontFamily: "monospace",
                      fontWeight: 600,
                      color: item.passed ? "#15803d" : "#b91c1c",
                    }}>
                      {item.result}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" as const }}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 9px",
                        borderRadius: "3px",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: "1.2px",
                        textTransform: "uppercase" as const,
                        background: item.passed ? "#dcfce7" : "#fee2e2",
                        color: item.passed ? "#166534" : "#991b1b",
                        border: `1px solid ${item.passed ? "#86efac" : "#fca5a5"}`,
                      }}>
                        {item.passed ? "Pass" : "Fail"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Notes */}
            {report.notes && (
              <div style={{
                fontSize: "10.5px",
                color: "#4b5563",
                background: "#fffbeb",
                padding: "12px 16px",
                border: "1px solid #fde68a",
                borderLeft: "3px solid #c0932f",
                borderRadius: "4px",
                marginBottom: "24px",
                lineHeight: 1.65,
              }}>
                <strong style={{ color: "#92400e", fontWeight: 700 }}>Notes: </strong>
                {report.notes}
              </div>
            )}

            {/* Disclaimer */}
            <p style={{
              fontSize: "9.5px",
              color: "#9ca3af",
              textAlign: "center" as const,
              marginBottom: "32px",
              fontStyle: "italic",
              lineHeight: 1.6,
            }}>
              The above certification does not alter our standard published terms and conditions of sale.
              This certificate is valid only for the specified lot number and product.
            </p>

            {/* Signature Section */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              marginTop: "40px",
              paddingTop: "24px",
              borderTop: "1px solid #e5e7eb",
            }}>
              <div>
                <div style={{ width: "200px", borderTop: "1.5px solid #374151", marginTop: "52px", marginBottom: "6px" }} />
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>{report.certifiedBy}</div>
                {report.certifierTitle && (
                  <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "1px" }}>{report.certifierTitle}</div>
                )}
                <div style={{ fontSize: "9.5px", color: "#9ca3af", marginTop: "2px" }}>Authorized Signatory</div>
              </div>

              <div style={{ textAlign: "center" as const }}>
                <div style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  border: "2px solid #0f3460",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column" as const,
                  margin: "0 auto 8px",
                  opacity: 0.2,
                }}>
                  <div style={{ fontSize: "7px", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "1px", color: "#0f3460", textAlign: "center" as const, lineHeight: 1.4 }}>
                    QA<br />Approved
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right" as const }}>
                <div style={{ width: "200px", borderTop: "1.5px solid #374151", marginTop: "52px", marginBottom: "6px", marginLeft: "auto" }} />
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>Date of Issue</div>
                <div style={{ fontSize: "12px", color: "#374151", marginTop: "1px", fontWeight: 500 }}>{reportDateFormatted}</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "36px",
              paddingTop: "14px",
              borderTop: "1px solid #e5e7eb",
            }}>
              <span style={{ fontFamily: "monospace", fontSize: "8.5px", color: "#9ca3af", letterSpacing: "0.5px" }}>
                REF: {report.id.substring(0, 16).toUpperCase()}
              </span>
              <span style={{ fontSize: "9px", color: "#c0932f", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "2px" }}>
                {companyName} · Quality Assurance
              </span>
              <span style={{ fontFamily: "monospace", fontSize: "8.5px", color: "#9ca3af", letterSpacing: "0.5px" }}>
                {format(new Date(), "dd MMM yyyy")}
              </span>
            </div>

            {/* Bottom accent bar */}
            <div style={{
              height: "4px",
              background: "linear-gradient(90deg, #0f3460 0%, #1a5276 40%, #c0932f 100%)",
              borderRadius: "2px",
              marginTop: "24px",
            }} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};