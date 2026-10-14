import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportPnlCsvFn } from "@/server-functions/reports/profit-loss/export-csv-fn";
import type { ReportSource } from "@/lib/report-source";

interface PnlExportBarProps {
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  recipeId?: string;
  source?: ReportSource;
  reportTitle?: string;
  disabled?: boolean;
}

export function PnlExportBar({
  dateFrom,
  dateTo,
  productId,
  recipeId,
  source,
  disabled = false,
}: PnlExportBarProps) {
  const [pdfHelp, setPdfHelp] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  const handleCsv = async () => {
    if (disabled || isExporting) return;
    setIsExporting("csv");
    try {
      const result = await exportPnlCsvFn({
        data: { dateFrom, dateTo, productId, recipeId, source },
      });
      const bom = "\ufeff";
      const blob = new Blob([bom + result.csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`CSV exported (${result.rowCount} rows)`);
    } catch {
      toast.error("Failed to export CSV");
    } finally {
      setIsExporting(null);
    }
  };

  const handlePrint = () => {
    if (!disabled && !isExporting) window.print();
  };

  const handlePdf = () => {
    if (!disabled) setPdfHelp(true);
  };

  return (
    <>
      {pdfHelp && (
        <div role="status" className="print:hidden border p-3">
          In the browser print dialog, select Save as PDF.
          <Button
            disabled={disabled || isExporting !== null}
            onClick={() => {
              if (!disabled && !isExporting) {
                setPdfHelp(false);
                window.print();
              }
            }}
          >
            Open print dialog
          </Button>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={disabled || isExporting !== null}
            variant="outline"
            className="gap-1.5 h-9 px-3 text-xs"
          >
            <Download className="size-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={handleCsv}
            disabled={disabled || isExporting !== null}
            className="cursor-pointer"
          >
            {isExporting === "csv" ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4 mr-2" />
            )}
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handlePdf}
            disabled={disabled || isExporting !== null}
            className="cursor-pointer"
          >
            <FileText className="size-4 mr-2" />
            Save as PDF
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handlePrint}
            disabled={disabled || isExporting !== null}
            className="cursor-pointer"
          >
            <Printer className="size-4 mr-2" />
            Print Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
