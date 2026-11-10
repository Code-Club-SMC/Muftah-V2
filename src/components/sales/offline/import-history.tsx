import { HugeiconsIcon } from "@hugeicons/react";
import { Database01Icon, Refresh03Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
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
import { batchSource, batchStatusLabel, dateTime } from "./format";

function statusVariant(status: string) {
  if (status === "completed") return "default" as const;
  if (status === "rejected") return "destructive" as const;
  if (status === "completed_with_issues") return "secondary" as const;
  return "outline" as const;
}

export function ImportHistory({
  onReview,
  canReview,
}: {
  onReview: (batchId: string) => void;
  canReview: boolean;
}) {
  const history = useOfflineSalesHistory();
  const batches = history.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
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
        ) : batches.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No imports yet</EmptyTitle>
              <EmptyDescription>
                Invoices sent from the offline desk will show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const needAttention =
                  batch.invalidInvoices + batch.needsReviewInvoices;
                const reviewable =
                  canReview &&
                  batch.status !== "rejected" &&
                  batch.workbookId != null;
                return (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <div className="flex max-w-72 flex-col gap-0.5">
                        <span className="font-medium">
                          {dateTime(batch.uploadedAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {batchSource(batch.originalFilename)}
                        </span>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={batch.outageReason}
                        >
                          Outage {dateTime(batch.outageStartedAt)} to{" "}
                          {dateTime(batch.outageEndedAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(batch.status)}>
                        {batchStatusLabel(batch.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {batch.postedInvoices} of {batch.totalInvoices}
                      {needAttention > 0 && (
                        <span className="block text-xs text-destructive">
                          {needAttention} need attention
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {reviewable && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onReview(batch.id)}
                        >
                          Open
                        </Button>
                      )}
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
