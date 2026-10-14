import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { MixingLabReport } from "@/server-functions/manufacturing/mixing/lab-reports-fn";
import { qcDate } from "./production-qc-report-form";

export function ProductionQCCertificate({
  report,
  onClose,
}: {
  report: MixingLabReport;
  onClose: () => void;
}) {
  const passedCount = report.analysisItems.filter(
    (check) => check.passed,
  ).length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Certificate of analysis</DialogTitle>
          <DialogDescription>
            {report.productName} · {qcDate(report.reportDate)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium">
            {passedCount}/{report.analysisItems.length} checks passed
          </p>
          <Badge
            variant={
              passedCount === report.analysisItems.length
                ? "secondary"
                : "destructive"
            }
          >
            {passedCount === report.analysisItems.length
              ? "All checks passed"
              : "Failed checks recorded"}
          </Badge>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Product", report.productName],
              ["Stock number", report.stockNumber],
              ["Lot number", report.lotNumber],
              ["Report date", qcDate(report.reportDate)],
              ["Certified by", report.certifiedBy],
              ["Certifier title", report.certifierTitle],
              ["Standard reference", report.standardReference],
              ["Recorded by", report.createdBy?.name],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="break-words font-medium">
                {value || "Not specified"}
              </dd>
            </div>
          ))}
        </dl>
        <Separator />
        <ol className="flex flex-col gap-3" aria-label="Analysis results">
          {report.analysisItems.map((check, index) => (
            <li
              key={index}
              className="flex flex-col gap-3 rounded-xl border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words font-medium">
                  {check.item}
                </h3>
                <Badge variant={check.passed ? "secondary" : "destructive"}>
                  {check.passed ? "Passed" : "Failed"}
                </Badge>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Requirement</dt>
                  <dd className="break-words">{check.requirement}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Result</dt>
                  <dd className="break-words">{check.result}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
        {report.notes && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Notes</h3>
            <p className="whitespace-pre-wrap break-words">{report.notes}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
