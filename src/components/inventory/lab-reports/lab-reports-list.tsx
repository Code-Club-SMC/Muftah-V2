import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useChemicalReportPurchases,
  useLabReports,
  useDeleteLabReport,
} from "@/hooks/inventory/use-lab-reports";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
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
import { CreateLabReportForm } from "./create-lab-report-form";
import { CertificateView } from "./certificate-view";

type Report = NonNullable<ReturnType<typeof useLabReports>["data"]>[number];
type Props = { chemicalId: string; chemicalName: string; purchaseId?: string };

export function LabReportsList(props: Props) {
  return (
    <PurchaseReports
      key={`${props.chemicalId}:${props.purchaseId ?? "all"}`}
      {...props}
    />
  );
}

function PurchaseReports({ chemicalId, chemicalName, purchaseId }: Props) {
  const { data: viewer } = useViewerAccess();
  const canView = hasPermission(viewer?.permissions ?? [], "inventory.view");
  const canManage =
    canView && hasPermission(viewer?.permissions ?? [], "inventory.manage");
  const reports = useLabReports(canView ? chemicalId : "", purchaseId);
  const purchases = useChemicalReportPurchases(canView ? chemicalId : "");
  const deletion = useDeleteLabReport();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Report | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const editing = reports.data?.find((report) => report.id === editingId);
  const deletionTarget = reports.data?.find((report) => report.id === deleting);

  if (!canView)
    return (
      <p className="text-sm text-muted-foreground">
        Inventory view permission is required to open certificates.
      </p>
    );
  const rows =
    purchases.data?.filter((p) => !purchaseId || p.purchaseId === purchaseId) ??
    [];
  const groups = new Map<string, Report[]>();
  for (const report of reports.data ?? []) {
    const key = report.purchaseId ?? "legacy";
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-sm font-bold">
        Lab reports, certificates of analysis
      </h4>
      {(reports.isLoading || purchases.isPending) && (
        <p role="status">Loading lab reports...</p>
      )}
      {(reports.isError || purchases.isError) && (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to load lab reports or purchase coverage.
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void reports.refetch();
                void purchases.refetch();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {rows.map((p) => (
        <section
          key={p.purchaseId}
          className="flex flex-col gap-2 rounded-lg border p-3"
          aria-label={`Purchase ${p.purchaseId}`}
        >
          <div className="flex items-center justify-between gap-3">
            <Badge
              variant={
                p.voidedAt
                  ? "secondary"
                  : p.reportCount === 0
                    ? "destructive"
                    : "outline"
              }
            >
              {p.voidedAt
                ? "Voided, reports read-only"
                : p.reportCount === 0
                  ? "Report missing"
                  : `${p.reportCount} certificate${p.reportCount === 1 ? "" : "s"}`}
            </Badge>
            {canManage && !p.voidedAt && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreatingFor(p.purchaseId)}
              >
                {p.reportCount === 0 ? "Create report" : "Add certificate"}
              </Button>
            )}
          </div>
          <p className="text-sm">
            {p.supplierName} · {format(new Date(p.purchaseDate), "MMM d, yyyy")}{" "}
            · {p.quantity} {p.unit}
          </p>
          <p className="text-xs text-muted-foreground break-all">
            Purchase reference: {p.purchaseId}
          </p>
        </section>
      ))}
      {reports.isSuccess && !reports.data?.length && (
        <p className="text-sm text-muted-foreground">
          {rows.some((p) => !p.voidedAt && p.reportCount === 0)
            ? "No certificates saved for these purchases. Reports remain pending until saved."
            : "No lab reports"}
        </p>
      )}
      {[...groups].map(([key, saved]) => (
        <section key={key} className="flex flex-col gap-2">
          <h5 className="text-sm font-medium">
            {key === "legacy"
              ? "Legacy / purchase unassigned"
              : `Certificates for purchase ${key}`}
          </h5>
          {saved.map((report) => (
            <div
              key={report.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">{report.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(report.reportDate), "MMM d, yyyy")} · By{" "}
                  {report.certifiedBy}
                </p>
                {report.purchase && (
                  <p className="text-xs text-muted-foreground">
                    {report.purchase.supplier.supplierName} ·{" "}
                    {report.purchase.quantity} {report.chemical.unit}
                  </p>
                )}
                <Badge variant="outline">
                  {report.analysisItems.filter((i) => i.passed).length}/
                  {report.analysisItems.length} passed
                </Badge>
                {report.purchase?.voidedAt && (
                  <Badge variant="secondary">Voided, read-only</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewing(report)}
                >
                  View certificate
                </Button>
                {canManage && !report.purchase?.voidedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(report.id)}
                  >
                    Edit report
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(report.id)}
                  >
                    Delete report
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}
      {canManage &&
        creatingFor &&
        rows.some((p) => p.purchaseId === creatingFor && !p.voidedAt) && (
          <CreateLabReportForm
            key={creatingFor}
            open
            onOpenChange={(open) => {
              if (!open) setCreatingFor(null);
            }}
            chemicalId={chemicalId}
            chemicalName={chemicalName}
            purchaseId={creatingFor}
          />
        )}
      {canManage && editing && !editing.purchase?.voidedAt && (
        <CreateLabReportForm
          key={editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
          chemicalId={chemicalId}
          chemicalName={chemicalName}
          purchaseId={editing.purchaseId ?? undefined}
          editData={editing}
        />
      )}
      {viewing && (
        <CertificateView
          open
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
          report={viewing}
        />
      )}
      <AlertDialog
        open={canManage && !!deletionTarget}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lab report?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes only the certificate. Its purchase stays saved and
              may become report missing again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletion.isPending}
              onClick={() => {
                if (deleting && canManage && deletionTarget)
                  deletion.mutate(
                    { data: { reportId: deleting } },
                    { onSuccess: () => setDeleting(null) },
                  );
              }}
            >
              Delete report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
