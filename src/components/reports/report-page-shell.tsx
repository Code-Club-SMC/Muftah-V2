import { useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Printer,
  FileText,
  Loader2,
  ArrowLeft,
  CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import type { DateRange } from "react-day-picker";
import { startOfMonth, endOfMonth } from "date-fns";

type AccentColor = "emerald" | "rose" | "blue" | "amber" | "violet";

const accentMap: Record<
  AccentColor,
  {
    text: string;
    bg: string;
    buttonBg: string;
    buttonBgHover: string;
  }
> = {
  emerald: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    buttonBg: "bg-emerald-600",
    buttonBgHover: "hover:bg-emerald-500",
  },
  rose: {
    text: "text-rose-500",
    bg: "bg-rose-500/10",
    buttonBg: "bg-rose-600",
    buttonBgHover: "hover:bg-rose-500",
  },
  blue: {
    text: "text-blue-500",
    bg: "bg-blue-500/10",
    buttonBg: "bg-blue-600",
    buttonBgHover: "hover:bg-blue-500",
  },
  amber: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    buttonBg: "bg-amber-600",
    buttonBgHover: "hover:bg-amber-500",
  },
  violet: {
    text: "text-violet-500",
    bg: "bg-violet-500/10",
    buttonBg: "bg-violet-600",
    buttonBgHover: "hover:bg-violet-500",
  },
};

interface ReportPageShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onGenerate: (range: DateRange | undefined) => void;
  isLoading: boolean;
  isEmpty: boolean;
  accentColor?: AccentColor;
  emptyMessage?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
}

export function ReportPageShell({
  title,
  subtitle,
  children,
  onGenerate,
  isLoading,
  isEmpty,
  accentColor = "emerald",
  emptyMessage = "Select a date range and click Generate to view the report.",
  actions,
  filters,
}: ReportPageShellProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [hasGenerated, setHasGenerated] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const a = accentMap[accentColor];

  const handleGenerate = () => {
    setHasGenerated(true);
    onGenerate(dateRange);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full">
        {/* Controls - hidden in print */}
        <div className="print:hidden">
          {/* Breadcrumb + Header */}
          <div className="border-b pb-6">
            <Link
              to="/reports"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="size-3.5" />
              Back to Reports
            </Link>

            <div className="flex items-end justify-between gap-6">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                  {subtitle}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {hasGenerated && !isEmpty && (
                  <Button
                    variant="outline"
                    onClick={handlePrint}
                    className="gap-2 h-9 px-3 text-xs"
                  >
                    <Printer className="size-3.5" />
                    Print
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 py-4">
            <div className="flex items-center gap-2 border rounded-md px-3 py-2">
              <CalendarRange className={`size-4 ${a.text}`} />
              <DatePickerWithRange
                date={dateRange}
                onDateChange={(d) => {
                  setDateRange(
                    d ?? {
                      from: startOfMonth(new Date()),
                      to: endOfMonth(new Date()),
                    },
                  );
                  setHasGenerated(false);
                }}
                className="w-64"
              />
            </div>
            {filters}
            <Button
              onClick={handleGenerate}
              disabled={isLoading || !dateRange?.from}
              className={`gap-2 h-9 px-4 text-xs font-medium ${a.buttonBg} ${a.buttonBgHover} text-white`}
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              Generate Report
            </Button>
            {actions && hasGenerated && !isEmpty && (
              <div className="sm:ml-auto print:hidden">{actions}</div>
            )}
          </div>
        </div>

        {/* Report Content */}
        <div ref={reportRef} className="report-content pb-8">
          {/* Print-only header */}
          <div className="hidden print:block mb-4 pb-3 border-b-2 border-black">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-lg font-bold uppercase tracking-tight">
                  {title}
                </h1>
              </div>
              <div className="text-right text-[10pt]">
                <div className="font-bold">Titan ERP</div>
              </div>
            </div>
            {dateRange?.from && dateRange?.to && (
              <div className="text-[10pt] mt-1">
                <span className="font-semibold">Period:</span>{" "}
                {dateRange.from.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
                {" — "}
                {dateRange.to.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </div>
            )}
          </div>

          {!hasGenerated ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg print:hidden">
              <FileText className={`size-8 ${a.text} mb-3 opacity-60`} />
              <h3 className="font-medium text-sm">Ready to Generate</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {emptyMessage}
              </p>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 print:hidden">
              <Loader2 className={`size-5 ${a.text} animate-spin mb-3`} />
              <p className="text-sm text-muted-foreground">
                Generating report…
              </p>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg print:hidden">
              <FileText className="size-8 text-muted-foreground mb-3 opacity-40" />
              <h3 className="font-medium text-sm">No Records Found</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                No data was found for the selected date range.
              </p>
            </div>
          ) : (
            <>
              {children}

              {/* Print-only signature section */}
              <div className="hidden print:block mt-12 pt-8 border-t border-gray-300">
                <div className="grid grid-cols-2 gap-8 text-sm">
                  <div>
                    <div className="border-b border-gray-400 mb-1 h-12"></div>
                    <div className="text-gray-600 text-xs">Prepared By</div>
                    <div className="text-xs mt-1">Date: _______________</div>
                  </div>
                  <div>
                    <div className="border-b border-gray-400 mb-1 h-12"></div>
                    <div className="text-gray-600 text-xs">Approved By</div>
                    <div className="text-xs mt-1">Date: _______________</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 1.2cm 1.2cm;
            @bottom-right {
              content: "Page " counter(page) " of " counter(pages);
              font-size: 7pt;
              color: #666;
            }
            @bottom-left {
              content: "Titan ERP";
              font-size: 7pt;
              color: #666;
            }
          }
          
          *, *::before, *::after {
            box-shadow: none !important;
            text-shadow: none !important;
          }
          
          html, body {
            background: white !important;
            color: black !important;
            font-size: 9pt;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }
          
          /* Hide non-printable elements */
          .print\\:hidden,
          button,
          .no-print,
          nav,
          aside,
          [data-radix-collection-item] {
            display: none !important;
          }
          
          /* Show print-only elements */
          .print\\:block {
            display: block !important;
          }
          
          /* Report content */
          .report-content {
            padding: 0 !important;
            max-width: 100% !important;
          }
          
          /* Remove card styling in print */
          [role="region"] {
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            background: transparent !important;
          }
          
          /* Tables - force fit to page width */
          .overflow-x-auto {
            overflow: visible !important;
          }
          
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 7pt !important;
            table-layout: fixed !important;
            page-break-inside: auto;
          }
          
          thead {
            display: table-header-group !important;
          }
          
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto;
          }
          
          th {
            background: #eee !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color: #000 !important;
            border: 1px solid #999 !important;
            padding: 2px 4px !important;
            text-align: left !important;
            font-weight: 700 !important;
            font-size: 6.5pt !important;
            white-space: nowrap !important;
          }
          
          td {
            border: 1px solid #ccc !important;
            padding: 2px 4px !important;
            text-align: left !important;
            color: #000 !important;
            font-size: 7pt !important;
            line-height: 1.25 !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
          }
          
          /* B&W safe patterns */
          tbody tr:nth-child(even) {
            background: #f7f7f7 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* Summary cards - compact, no card chrome */
          .grid {
            page-break-inside: avoid;
            display: grid !important;
            gap: 6px !important;
          }
          
          /* Section titles */
          h2 {
            page-break-after: avoid;
            font-size: 10pt !important;
            margin-top: 10px !important;
            margin-bottom: 6px !important;
          }
          
          /* Links - no underline, no color */
          a {
            text-decoration: none !important;
            color: black !important;
          }
          
          /* Badges - B&W safe */
          [data-badge],
          .badge {
            border: 1px solid #333 !important;
            background: white !important;
            color: black !important;
            font-size: 6pt !important;
            padding: 1px 4px !important;
          }
          
          /* Charts - hide canvas, show print table */
          canvas {
            display: none !important;
          }
          
          svg {
            max-width: 100% !important;
            page-break-inside: avoid;
          }
          
          /* Signature section */
          .print\\:signature {
            margin-top: 30px;
            page-break-inside: avoid;
          }
        }
        
        @media screen {
          .print\\:block {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}
