import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database01Icon } from "@hugeicons/core-free-icons";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useResolveStockReconciliationIssue,
  useStockReconciliationIssues,
} from "@/hooks/sales/use-offline-sales";
import type { listStockReconciliationIssuesFn } from "@/server-functions/sales/offline-stock-reconciliation-fn";
import { dateTime } from "./format";

type StockIssue = Awaited<
  ReturnType<typeof listStockReconciliationIssuesFn>
>["issues"][number];
type Filter = "open" | "resolved" | "all";
type ResolutionType = "counted_adjustment" | "missing_record";

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
  const rows = issues.data?.issues ?? [];

  const close = () => {
    setSelected(null);
    setResolutionType("counted_adjustment");
    setReference("");
    setReason("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock issues</CardTitle>
        <CardDescription>
          Goods left the factory when web stock was short. Fix the real stock
          record first, then enter its ID here. Marking resolved never changes
          stock.
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(value) => value && setFilter(value as Filter)}
          >
            <ToggleGroupItem value="open">Open</ToggleGroupItem>
            <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {issues.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>
                {filter === "all"
                  ? "No stock issues"
                  : `No ${filter} stock issues`}
              </EmptyTitle>
              <EmptyDescription>
                Shortages show up here after offline invoices are posted.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Short by</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <span className="block font-mono">
                      {issue.invoiceNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dateTime(issue.invoiceDate)}
                    </span>
                  </TableCell>
                  <TableCell>{issue.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="block font-semibold">
                      {issue.deficitUnits} units
                    </span>
                    <span className="text-xs text-muted-foreground">
                      sent {issue.requestedUnits}, had {issue.availableUnits}
                    </span>
                  </TableCell>
                  <TableCell>{age(issue.createdAt)}</TableCell>
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
                      <div className="flex flex-col items-end gap-0.5">
                        <Badge>Resolved</Badge>
                        <span className="text-xs text-muted-foreground">
                          {issue.resolutionReference}
                        </span>
                      </div>
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
            <AlertDialogTitle>Resolve stock issue</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.invoiceNumber} · {selected?.productName} ·{" "}
              {selected?.deficitUnits} units short
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>How was it fixed?</FieldLabel>
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
            <Field>
              <FieldLabel htmlFor="stock-resolution-reference">
                Record ID
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
            </Field>
            <Field data-invalid={reason.length > 0 && reason.trim().length < 5}>
              <FieldLabel htmlFor="stock-resolution-reason">Note</FieldLabel>
              <Textarea
                id="stock-resolution-reason"
                value={reason}
                aria-invalid={reason.length > 0 && reason.trim().length < 5}
                placeholder="What did you check?"
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
