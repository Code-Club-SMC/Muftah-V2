import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReturnActions } from "@/components/sales/returns/return-actions";
import { ReturnProgress, ReturnStatusBadge } from "@/components/sales/returns/return-status";
import { useSalesReturnDetail, type SalesReturnDetail } from "@/hooks/sales/use-sales-returns";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import { getReturnUnitsPerCarton } from "@/lib/sales/returns/refund-pricing";
import { formatUnits, receivedUnits, requestedUnits } from "@/lib/sales/returns/return-lifecycle";

export const Route = createFileRoute("/_protected/sales/returns/$returnId")({
  component: SalesReturnDetailPage,
});

type TimelineStep = { label: string; at: Date | string; by: string | null; note?: string | null };

export function buildReturnTimeline(r: SalesReturnDetail): TimelineStep[] {
  const steps: Array<TimelineStep | null> = [
    { label: "Requested", at: r.createdAt ?? r.returnDate, by: r.createdBy?.name ?? null },
    r.approvedAt
      ? {
          label: r.status === "rejected" ? "Rejected" : "Approved",
          at: r.approvedAt,
          by: r.approvedBy?.name ?? null,
          note: r.rejectReason,
        }
      : null,
    r.cancelledAt
      ? {
          label: "Cancelled",
          at: r.cancelledAt,
          by: r.cancelledBy?.name ?? null,
          note: r.cancelReason,
        }
      : null,
    r.completedAt
      ? {
          label: "Received and completed",
          at: r.completedAt,
          by: r.receivedBy?.name ?? null,
          note: r.notes,
        }
      : null,
    r.voidedAt
      ? {
          label: "Voided",
          at: r.voidedAt,
          by: r.voidedBy?.name ?? null,
          note: r.voidReason,
        }
      : null,
  ];
  return steps.filter((step): step is TimelineStep => step !== null);
}

function SalesReturnDetailPage() {
  const { returnId } = useParams({ from: "/_protected/sales/returns/$returnId" });
  const { data: viewer, isLoading: viewerLoading } = useViewerAccess();
  const canView = !!viewer && hasPermission(viewer.permissions, "sales.view");
  const { data, isLoading, isError, error, refetch } = useSalesReturnDetail(canView ? returnId : null);

  if (viewer && !canView) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Access restricted</AlertTitle>
        <AlertDescription>Sales view permission is required to view return details.</AlertDescription>
      </Alert>
    );
  }

  if (viewerLoading || isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/sales/returns">
            <ArrowLeft className="mr-1 size-4" /> Returns
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Could not load return</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Return not found."}
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  const inspected = data.status === "completed" || data.status === "voided";
  const amountLabel =
    data.status === "voided"
      ? "Reversed receipt"
      : inspected
        ? "Credited"
        : "If everything arrives";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to="/sales/returns">
              <ArrowLeft className="mr-1 size-4" /> Returns
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Return #{data.returnNumber}</h1>
            <ReturnStatusBadge status={data.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {data.customer?.name} · Invoice{" "}
            <Link
              to="/sales/invoices/$invoiceId"
              params={{ invoiceId: data.invoiceId }}
              className="hover:underline"
            >
              #{data.invoice?.invoiceNumber}
            </Link>
          </p>
        </div>
        <ReturnActions salesReturn={data} />
      </div>

      <ReturnProgress status={data.status} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const upc = getReturnUnitsPerCarton(item.invoiceItem);
                  const requested = requestedUnits(item, upc);
                  const short = inspected ? Math.max(0, requested - receivedUnits(item)) : null;
                  const cell = (value: number) => (inspected ? value : "—");
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm font-medium">{item.invoiceItem.pack}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatUnits(requested, upc)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{cell(item.goodUnits)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{cell(item.damagedUnits)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{cell(item.expiredUnits)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-amber-600 dark:text-amber-400">
                        {short ? short : inspected ? 0 : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatRupees(item.refundPerUnit)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatRupees(item.totalRefund)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">{amountLabel}</span>
              <span className="text-lg font-semibold tabular-nums">{formatRupees(data.totalAmount)}</span>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Reason: </span>
                {data.reason}
              </p>
              {data.notes && (
                <p>
                  <span className="text-muted-foreground">Note: </span>
                  {data.notes}
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Customer balance now: </span>
                <span className="tabular-nums">{formatRupees(data.customer?.outstandingAmount ?? "0")}</span>
              </p>
              {data.priceOverride && (
                <p className="flex gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-4 shrink-0" />
                  Refund price set above the invoice price. Reason: {data.priceOverrideReason}
                </p>
              )}
              {!!data.stockTraces.length && (
                <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Stock movement
                  </p>
                  {data.stockTraces.map((trace) => (
                    <p key={trace.id} className="text-xs text-muted-foreground">
                      {trace.kind === "void" ? "Void: removed" : "Receipt: added"}{" "}
                      {Math.abs(trace.totalUnitsMoved)} packs{" "}
                      {trace.kind === "void" ? "from" : "to"} {trace.destination} stock for{" "}
                      {trace.recipe?.name ?? "Recipe"} in{" "}
                      {trace.warehouse?.name ?? "the original warehouse"}.
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {buildReturnTimeline(data).map((step) => (
                  <li key={step.label} className="border-l-2 pl-3">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(step.at), "dd MMM yyyy, h:mm a")}
                      {step.by ? ` · ${step.by}` : ""}
                    </p>
                    {step.note && <p className="text-xs">{step.note}</p>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
