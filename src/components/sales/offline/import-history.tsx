import { HugeiconsIcon } from "@hugeicons/react";
import { Database01Icon, Refresh03Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOfflineSalesHistory } from "@/hooks/sales/use-offline-sales";

function dateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function statusVariant(status: string) {
  if (status === "completed") return "default" as const;
  if (status === "rejected") return "destructive" as const;
  if (status === "completed_with_issues") return "secondary" as const;
  return "outline" as const;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: "Uploaded",
    preview_ready: "Ready for review",
    posting: "Posting",
    completed: "Completed",
    completed_with_issues: "Completed with issues",
    rejected: "Rejected",
  };
  return labels[status] ?? status;
}

export function ImportHistory({
  onReview,
  canReview,
}: {
  onReview: (batchId: string) => void;
  canReview: boolean;
}) {
  const history = useOfflineSalesHistory();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
        <CardDescription>
          Audit of uploaded filenames, file fingerprints, outage windows, and
          posting results. Workbook bytes are not retained.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={history.isFetching}
            onClick={() => history.refetch()}
          >
            <HugeiconsIcon
              icon={Refresh03Icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {history.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No offline imports yet</EmptyTitle>
              <EmptyDescription>
                Uploaded workbooks will appear here with their final result.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uploaded</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Outage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history.data ?? []).map((batch) => {
                const reviewable =
                  batch.status !== "rejected" && batch.workbookId != null;
                return (
                  <TableRow key={batch.id}>
                    <TableCell>{dateTime(batch.uploadedAt)}</TableCell>
                    <TableCell>
                      <div className="flex max-w-52 flex-col gap-1">
                        <span className="truncate font-medium">
                          {batch.originalFilename}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {batch.outageReason}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        <span>{dateTime(batch.outageStartedAt)}</span>
                        <span className="text-muted-foreground">
                          to {dateTime(batch.outageEndedAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(batch.status)}>
                        {statusLabel(batch.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {batch.postedInvoices}/{batch.totalInvoices} posted
                      {(batch.invalidInvoices > 0 ||
                        batch.needsReviewInvoices > 0) && (
                        <span className="block text-xs text-muted-foreground">
                          {batch.invalidInvoices + batch.needsReviewInvoices}{" "}
                          need attention
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {batch.fileSha256.slice(0, 12)}…
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canReview || !reviewable}
                        onClick={() => onReview(batch.id)}
                      >
                        View details
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
