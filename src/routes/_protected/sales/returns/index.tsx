import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { RotateCcw, Search } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReturnActions } from "@/components/sales/returns/return-actions";
import { ReturnStatusBadge } from "@/components/sales/returns/return-status";
import { useReturnReasons, useSalesReturnList } from "@/hooks/sales/use-sales-returns";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import type { ReturnTab } from "@/lib/sales/returns/return-lifecycle";

export const Route = createFileRoute("/_protected/sales/returns/")({
  component: SalesReturnsPage,
});

const TABS: Array<{ value: ReturnTab; label: string }> = [
  { value: "to-approve", label: "To approve" },
  { value: "to-receive", label: "To receive" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

function emptyCopy(tab: ReturnTab, hasFilters: boolean): { title: string; description: string } {
  if (hasFilters) {
    return {
      title: "No matching returns",
      description: "Try clearing or adjusting your search or reason filter.",
    };
  }
  switch (tab) {
    case "to-approve":
      return {
        title: "No returns waiting for approval",
        description: "New customer return requests will appear here before stock moves.",
      };
    case "to-receive":
      return {
        title: "No returns waiting to be received",
        description: "Approved returns appear here until goods arrive and are inspected.",
      };
    case "done":
      return {
        title: "No completed or closed returns",
        description: "Received, rejected, cancelled, and voided returns will appear here.",
      };
    default:
      return {
        title: "No returns yet",
        description: "Open an invoice to record a customer return request.",
      };
  }
}

function SalesReturnsPage() {
  const { data: viewer, isLoading: viewerLoading } = useViewerAccess();
  const canView = !!viewer && hasPermission(viewer.permissions, "sales.view");

  const [tab, setTab] = useState<ReturnTab>("to-approve");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [reasonId, setReasonId] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const next = searchInput.trim();
    const timer = setTimeout(() => {
      if (next !== search) {
        setSearch(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const { data, isLoading, isError, error, refetch } = useSalesReturnList(
    {
      tab,
      search: search || undefined,
      reasonId: reasonId === "all" ? undefined : reasonId,
      page,
    },
    canView,
  );
  const { data: reasons = [] } = useReturnReasons(canView, { includeInactive: true });

  if (viewer && !canView) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Access restricted</AlertTitle>
        <AlertDescription>Sales view permission is required to view returns.</AlertDescription>
      </Alert>
    );
  }

  const hasFilters = Boolean(search || reasonId !== "all");
  const empty = emptyCopy(tab, hasFilters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Returns</h1>
        <p className="text-sm text-muted-foreground">
          Approve requests, check goods in, and look back at finished returns.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as ReturnTab);
            setPage(1);
          }}
        >
          <TabsList>
            {TABS.map((tabItem) => (
              <TabsTrigger key={tabItem.value} value={tabItem.value} className="gap-2">
                {tabItem.label}
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                  {data?.counts[tabItem.value] ?? 0}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search returns"
              className="pl-8 sm:w-72"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Return #, invoice # or customer"
            />
          </div>
          <Select
            value={reasonId}
            onValueChange={(value) => {
              setReasonId(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by reason" className="sm:w-56">
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {reasons.map((reason) => (
                <SelectItem key={reason.id} value={reason.id}>
                  {reason.isActive ? reason.name : `${reason.name} (inactive)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load returns</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Failed to load returns queue."}
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Return</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {viewerLoading || isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            ) : !data?.rows.length ? (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  <Empty className="border-0 py-10">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <RotateCcw />
                      </EmptyMedia>
                      <EmptyTitle>{empty.title}</EmptyTitle>
                      <EmptyDescription>{empty.description}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      to="/sales/returns/$returnId"
                      params={{ returnId: row.id }}
                      className="font-medium hover:underline"
                    >
                      #{row.returnNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {format(new Date(row.createdAt), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-sm">{row.customerName}</TableCell>
                  <TableCell className="text-sm">
                    <Link
                      to="/sales/invoices/$invoiceId"
                      params={{ invoiceId: row.invoiceId }}
                      className="hover:underline"
                    >
                      #{row.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{row.reason}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatRupees(row.totalAmount)}
                  </TableCell>
                  <TableCell>
                    <ReturnStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    <ReturnActions salesReturn={row} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            Page {data.page} of {data.pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= data.pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
