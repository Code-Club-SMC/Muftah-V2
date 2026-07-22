import { useState } from "react";
import { format } from "date-fns";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import {
    FlaskConical,
    Plus,
    Eye,
    Trash2,
    Pencil,
    FileText,
    CheckCircle2,
    XCircle,
} from "lucide-react";
import {
    useLabReports,
    useDeleteLabReport,
} from "@/hooks/inventory/use-lab-reports";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../../ui/alert-dialog";
import { CreateLabReportForm } from "./create-lab-report-form";
import { CertificateView } from "./certificate-view";
import { Card, CardContent } from "../../ui/card";

type LabReportsListProps = {
    chemicalId: string;
    chemicalName: string;
};

export const LabReportsList = ({
    chemicalId,
    chemicalName,
}: LabReportsListProps) => {
    const { data: reports, isLoading } = useLabReports(chemicalId);
    const deleteReport = useDeleteLabReport();
    const [createOpen, setCreateOpen] = useState(false);
    const [editReport, setEditReport] = useState<any | null>(null);
    const [viewReport, setViewReport] = useState<any | null>(null);
    const [deleteReportId, setDeleteReportId] = useState<string | null>(null);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Loading lab reports...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FlaskConical className="size-4 text-primary" />
                    <h4 className="text-sm font-bold">Lab Reports (COA)</h4>
                    {reports && reports.length > 0 && (
                        <Badge variant="secondary" className="text-[10px] font-bold">
                            {reports.length}
                        </Badge>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-bold"
                    onClick={() => {
                        setEditReport(null);
                        setCreateOpen(true);
                    }}
                >
                    <Plus className="size-3 mr-1" />
                    New Report
                </Button>
            </div>

            {/* Reports List */}
            {!reports || reports.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                        <FileText className="size-10 text-muted-foreground/30 mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">
                            No lab reports yet
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Create a Certificate of Analysis for {chemicalName}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-4 h-8 text-xs"
                            onClick={() => {
                                setEditReport(null);
                                setCreateOpen(true);
                            }}
                        >
                            <Plus className="size-3 mr-1" />
                            Create First Report
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {reports.map((report) => {
                        const allPassed = (
                            report.analysisItems as Array<{
                                item: string;
                                requirement: string;
                                result: string;
                                passed: boolean;
                            }>
                        ).every((i) => i.passed);
                        const itemCount = (report.analysisItems as Array<any>).length;
                        const passCount = (
                            report.analysisItems as Array<{ passed: boolean }>
                        ).filter((i) => i.passed).length;

                        return (
                            <div
                                key={report.id}
                                className="group flex items-center justify-between p-3 rounded-lg border bg-background hover:bg-muted/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div
                                        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${allPassed
                                            ? "bg-emerald-100 text-emerald-600"
                                            : "bg-red-100 text-red-600"
                                            }`}
                                    >
                                        {allPassed ? (
                                            <CheckCircle2 className="size-4" />
                                        ) : (
                                            <XCircle className="size-4" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold truncate">
                                                {report.productName}
                                            </span>
                                            {report.lotNumber && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[9px] font-mono shrink-0"
                                                >
                                                    LOT: {report.lotNumber}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                                            <span>
                                                {format(new Date(report.reportDate), "MMM d, yyyy")}
                                            </span>
                                            <span>•</span>
                                            <span>
                                                {passCount}/{itemCount} passed
                                            </span>
                                            <span>•</span>
                                            <span>By {report.certifiedBy}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-primary hover:bg-primary/10"
                                        onClick={() => setViewReport(report)}
                                        title="View Certificate"
                                    >
                                        <Eye className="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-slate-500 hover:bg-slate-100 hover:"
                                        onClick={() => {
                                            setEditReport(report);
                                            setCreateOpen(true);
                                        }}
                                        title="Edit Report"
                                    >
                                        <Pencil className="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setDeleteReportId(report.id)}
                                        title="Delete Report"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create/Edit Form */}
            <CreateLabReportForm
                open={createOpen}
                onOpenChange={(open) => {
                    setCreateOpen(open);
                    if (!open) setEditReport(null);
                }}
                chemicalId={chemicalId}
                chemicalName={chemicalName}
                editData={editReport ? {
                    id: editReport.id,
                    productName: editReport.productName,
                    stockNumber: editReport.stockNumber,
                    lotNumber: editReport.lotNumber,
                    analysisItems: editReport.analysisItems as Array<{
                        item: string;
                        requirement: string;
                        result: string;
                        passed: boolean;
                    }>,
                    certifiedBy: editReport.certifiedBy,
                    certifierTitle: editReport.certifierTitle,
                    reportDate: editReport.reportDate,
                    standardReference: editReport.standardReference,
                    notes: editReport.notes,
                } : null}
            />

            {/* Certificate View */}
            {viewReport && (
                <CertificateView
                    open={!!viewReport}
                    onOpenChange={(open) => !open && setViewReport(null)}
                    report={viewReport}
                />
            )}

            {/* Delete Confirmation */}
            <AlertDialog
                open={!!deleteReportId}
                onOpenChange={(open) => !open && setDeleteReportId(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Trash2 className="size-5 text-destructive" />
                            Delete Lab Report?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this Certificate of Analysis. This
                            action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteReport.isPending}
                            onClick={() => {
                                if (!deleteReportId) return;
                                deleteReport.mutate(
                                    { data: { reportId: deleteReportId } },
                                    { onSuccess: () => setDeleteReportId(null) },
                                );
                            }}
                        >
                            {deleteReport.isPending ? "Deleting..." : "Delete Report"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
