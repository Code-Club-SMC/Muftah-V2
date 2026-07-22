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

interface PnlExportBarProps {
	dateFrom?: string;
	dateTo?: string;
	productId?: string;
	recipeId?: string;
	reportTitle?: string;
}

export function PnlExportBar({
	dateFrom,
	dateTo,
	productId,
	recipeId,
}: PnlExportBarProps) {
	const [isExporting, setIsExporting] = useState<string | null>(null);

	const handleCsv = async () => {
		setIsExporting("csv");
		try {
			const result = await exportPnlCsvFn({
				data: { dateFrom, dateTo, productId, recipeId },
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
		window.print();
	};

	const handlePdf = () => {
		window.print();
		toast.info("Use 'Save as PDF' in the print dialog");
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="gap-1.5 h-9 px-3 text-xs">
					<Download className="size-3.5" />
					Export
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuItem
					onClick={handleCsv}
					disabled={isExporting === "csv"}
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
					disabled={isExporting !== null}
					className="cursor-pointer"
				>
					<FileText className="size-4 mr-2" />
					Save as PDF
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={handlePrint}
					disabled={isExporting !== null}
					className="cursor-pointer"
				>
					<Printer className="size-4 mr-2" />
					Print Report
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
