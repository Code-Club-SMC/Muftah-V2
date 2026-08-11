import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertSquareIcon, Database01Icon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useResolveStockReconciliationIssue,
  useStockReconciliationIssues,
} from "@/hooks/sales/use-offline-sales";
import type { listStockReconciliationIssuesFn } from "@/server-functions/sales/offline-stock-reconciliation-fn";

type StockIssue = Awaited<
  ReturnType<typeof listStockReconciliationIssuesFn>
>["issues"][number];
type Filter = "open" | "resolved" | "all";
type ResolutionType = "counted_adjustment" | "missing_record";

function dateTime(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function age(value: Date | string) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000),
  );
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}

export function StockReconciliationPanel() {
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<StockIssue | null>(null);
  const [resolutionType, setResolutionType] =
    useState<ResolutionType>("counted_adjustment");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const issues = useStockReconciliationIssues(filter);
  const resolve = useResolveStockReconciliationIssue();

  const close = () => {
    setSelected(null);
    setResolutionType("counted_adjustment");
    setReference("");
    setReason("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock issues from offline dispatch</CardTitle>
        <CardDescription>
          An offline invoice can be posted when physical goods already left the
          factory, even if web stock is lower. These rows keep that difference
          visible until stock staff link the real correction record.
        </CardDescription>
        <CardAction>
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="open">Open issues</SelectItem>
                <SelectItem value="resolved">Resolved issues</SelectItem>
                <SelectItem value="all">All issues</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert>
          <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
          <AlertTitle>Resolution does not edit the invoice</AlertTitle>
          <AlertDescription>
            First complete the real stock count, production entry, or transfer
            entry. Then enter that record’s reference here. This screen never
            invents stock.
          </AlertDescription>
        </Alert>

        {issues.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (issues.data?.issues ?? []).length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>
                No {filter === "all" ? "" : filter} stock issues
              </EmptyTitle>
              <EmptyDescription>
                Offline dispatch differences will appear here after invoice
                posting.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Outage sale date</TableHead>
                <TableHead className="text-right">Dispatched</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Deficit</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(issues.data?.issues ?? []).map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="font-mono">
                    {issue.invoiceNumber}
                  </TableCell>
                  <TableCell>{issue.productName}</TableCell>
                  <TableCell>{dateTime(issue.invoiceDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {issue.requestedUnits}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {issue.availableUnits}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {issue.deficitUnits}
                  </TableCell>
                  <TableCell>{age(issue.createdAt)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        issue.status === "open" ? "destructive" : "default"
                      }
                    >
                      {issue.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {issue.status === "open" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(issue)}
                      >
                        Resolve
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {issue.resolutionReference}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve stock issue?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.invoiceNumber} · {selected?.productName} ·{" "}
              {selected?.deficitUnits} units missing from web stock
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>How was it corrected?</FieldLabel>
              <Select
                value={resolutionType}
                onValueChange={(value) =>
                  setResolutionType(value as ResolutionType)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="counted_adjustment">
                      Counted Adjustment
                    </SelectItem>
                    <SelectItem value="missing_record">
                      Missing Production/Transfer Record
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field
              data-invalid={reference.length > 0 && reference.trim().length < 1}
            >
              <FieldLabel htmlFor="stock-resolution-reference">
                Related record/reference
              </FieldLabel>
              <Input
                id="stock-resolution-reference"
                value={reference}
                placeholder={
                  resolutionType === "counted_adjustment"
                    ? "Stock adjustment ID or slip number"
                    : "Production run or transfer ID"
                }
                onChange={(event) => setReference(event.target.value)}
              />
              <FieldDescription>
                Complete the real stock record first, then copy its ID here.
              </FieldDescription>
            </Field>
            <Field data-invalid={reason.length > 0 && reason.trim().length < 5}>
              <FieldLabel htmlFor="stock-resolution-reason">
                What was checked?
              </FieldLabel>
              <Textarea
                id="stock-resolution-reason"
                value={reason}
                aria-invalid={reason.length > 0 && reason.trim().length < 5}
                placeholder="Explain why this record fixes the deficit"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !selected ||
                !reference.trim() ||
                reason.trim().length < 5 ||
                resolve.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                if (!selected) return;
                resolve.mutate(
                  {
                    issueId: selected.id,
                    resolutionType,
                    resolutionReference: reference.trim(),
                    resolutionReason: reason.trim(),
                  },
                  { onSuccess: close },
                );
              }}
            >
              {resolve.isPending && <Spinner data-icon="inline-start" />}
              Mark resolved
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
