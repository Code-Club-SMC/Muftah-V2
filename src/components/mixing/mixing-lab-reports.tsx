import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteMixingLabReportFn,
  getMixingLabReportsFn,
  type MixingLabReport,
} from "@/server-functions/manufacturing/mixing/lab-reports-fn";
import {
  ProductionQCReportForm,
  qcDate,
} from "@/components/production-qc/production-qc-report-form";
import { ProductionQCCertificate } from "@/components/production-qc/production-qc-certificate";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

export function MixingLabReports({
  mixingRunId,
  batchId,
  productName,
}: {
  mixingRunId: string;
  batchId?: string;
  productName?: string;
}) {
  const queryClient = useQueryClient();
  const { data: viewerAccess } = useViewerAccess();
  const canManage =
    !!viewerAccess &&
    (hasPermission(viewerAccess.permissions, "manufacturing.qc.manage") ||
      hasPermission(viewerAccess.permissions, "manufacturing.manage"));
  const [editing, setEditing] = useState<MixingLabReport | "new" | null>(null);
  const [viewing, setViewing] = useState<MixingLabReport | null>(null);
  const [deleting, setDeleting] = useState<MixingLabReport | null>(null);
  const {
    data: reports,
    error: readError,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["mixing-lab-reports", mixingRunId],
    queryFn: () => getMixingLabReportsFn({ data: { mixingRunId } }),
    staleTime: 30_000,
  });
  const deleteReport = useMutation({
    mutationFn: deleteMixingLabReportFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["mixing-lab-reports", mixingRunId],
      });
      toast.success("Quality report deleted");
      setDeleting(null);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Quality control reports</CardTitle>
            <CardDescription>
              {batchId
                ? `Reports for batch ${batchId}`
                : "Certificates and analysis results for this mixing batch."}
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setEditing("new")}>
              Create quality report
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending && (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        )}
        {readError && (
          <Alert variant="destructive">
            <AlertDescription>
              {readError.message}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                Retry reports
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {reports?.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No quality reports</EmptyTitle>
              <EmptyDescription>
                No report has been recorded for this mixing batch.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {reports?.map((report) => {
          const passedCount = report.analysisItems.filter(
            (check) => check.passed,
          ).length;
          return (
            <article
              key={report.id}
              className="flex flex-col gap-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="break-words font-medium">
                    {report.productName}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {qcDate(report.reportDate)} · Certified by{" "}
                    {report.certifiedBy}
                  </p>
                  {report.lotNumber && (
                    <p className="text-sm text-muted-foreground">
                      Lot {report.lotNumber}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    passedCount === report.analysisItems.length
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {passedCount}/{report.analysisItems.length} checks passed
                </Badge>
              </div>
              {report.notes && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {report.notes}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewing(report)}
                >
                  View certificate
                </Button>
                {canManage && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(report)}
                    >
                      Edit report
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        deleteReport.reset();
                        setDeleting(report);
                      }}
                    >
                      Delete report
                    </Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {editing && canManage && (
          <ProductionQCReportForm
            key={editing === "new" ? "new" : editing.id}
            mixingRunId={mixingRunId}
            batchId={batchId}
            productName={productName}
            report={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        )}
        {viewing && (
          <ProductionQCCertificate
            report={viewing}
            onClose={() => setViewing(null)}
          />
        )}
        <AlertDialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open && !deleteReport.isPending) setDeleting(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete quality report?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete the report for {deleting?.productName}, dated{" "}
                {deleting ? qcDate(deleting.reportDate) : ""}. This permanently
                removes its certificate and analysis results.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteReport.error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {deleteReport.error.message}
                </AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteReport.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteReport.isPending || !canManage}
                onClick={(event) => {
                  event.preventDefault();
                  if (deleting)
                    deleteReport.mutate({
                      data: { reportId: deleting.id, mixingRunId },
                    });
                }}
              >
                {deleteReport.isPending
                  ? "Deleting report..."
                  : "Confirm delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
