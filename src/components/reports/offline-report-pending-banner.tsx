import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getOfflineReportStatusFn } from "@/server-functions/reports/offline-report-status-fn";

export function OfflineReportPendingBanner() {
  const status = useQuery({
    queryKey: ["reports", "offline-import-status"],
    queryFn: () => getOfflineReportStatusFn(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  if (status.isError)
    return (
      <Alert role="alert" className="mb-4">
        <AlertTitle>Offline invoice status unavailable</AlertTitle>
        <AlertDescription>
          The status check failed. Report completeness could not be verified.
        </AlertDescription>
      </Alert>
    );
  if (status.isPending)
    return (
      <p role="status" className="mb-4 text-sm">
        Offline invoice posting status has not yet been verified.
      </p>
    );
  if (!status.data?.hasUnpostedOfflineInvoices) return null;

  return (
    <Alert className="border-amber-500/50 bg-amber-500/10 mb-4">
      <AlertTriangle className="size-4 text-amber-500" />
      <AlertTitle>Reports may be incomplete</AlertTitle>
      <AlertDescription>
        Offline invoices are waiting to be posted. Current reports may be
        incomplete.
      </AlertDescription>
    </Alert>
  );
}
