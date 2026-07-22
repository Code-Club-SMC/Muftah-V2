/**
 * Distributor Ledger Page
 * Production-ready with pagination, search, sorting, export, audit logging
 */

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { type DateRange } from "react-day-picker";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Link,
  Search,
  ArrowUpDown,
  Clock,
  User,
  MapPin,
  Phone,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPKR } from "@/lib/currency-format";
import { generateDistributorLedgerFn } from "@/server-functions/sales/ledger-fn";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { LedgerPrintExport } from "@/components/sales/ledger-print-export";
import type {
  LedgerEntry,
  DistributorLedgerResponse,
} from "@/lib/ledger-types";

export const Route = createFileRoute(
  "/_protected/sales/people/distributors/$customerId/ledger",
)({
  component: DistributorLedgerPage,
});

function DistributorLedgerPage() {
  const { customerId } = Route.useParams();
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const sortBy: "date" = "date";
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [typeFilter, setTypeFilter] = useState<"all" | "invoice" | "payment" | "return">("all");
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const dateFrom = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const dateTo = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  // Debounce search
  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleSort = () => {
    if (sortBy === "date") {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    }
    setPage(1);
  };

  const loadEntriesForExport = useCallback(
    async (exportType: "print" | "csv" | "pdf") => {
      const exportData = await generateDistributorLedgerFn({
        data: {
          customerId,
          dateFrom,
          dateTo,
          page: 1,
          limit: 50,
          search: search || undefined,
          sortBy,
          sortOrder,
          typeFilter,
          includeFullEntries: true,
          exportType,
        },
      });

      return exportData.entries;
    },
    [customerId, dateFrom, dateTo, search, sortBy, sortOrder, typeFilter],
  );

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery<DistributorLedgerResponse>({
    queryKey: [
      "distributor-ledger",
      customerId,
      dateFrom,
      dateTo,
      page,
      search,
      sortBy,
      sortOrder,
      typeFilter,
    ],
    queryFn: () =>
      generateDistributorLedgerFn({
        data: {
          customerId,
          dateFrom,
          dateTo,
          page,
          limit: 50,
          search: search || undefined,
          sortBy,
          sortOrder,
          typeFilter,
        },
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
  });

  const toggleExpand = (id: string) => {
    setExpandedInvoiceId(expandedInvoiceId === id ? null : id);
  };

  const handleDateChange = (d: DateRange | undefined) => {
    setDateRange(d ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) });
    setPage(1);
  };

  if (isLoading) {
    return <LedgerSkeleton />;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="size-12 text-destructive" />
        <p className="text-sm font-medium text-destructive max-w-md text-center">
          {(error as any)?.message || "Failed to load ledger. Please try again."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.history.back()}>
            Go Back
          </Button>
          <Button variant="default" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("size-4 mr-2", isRefetching && "animate-spin")} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { customer, entries, summary, generatedAt, pageCount } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2"
          onClick={() => router.history.back()}
        >
          <ChevronLeft className="size-4" />
          Back
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight truncate">{customer.name}</h1>
            <Badge
              variant="outline"
              className="border-purple-200 text-purple-700 bg-purple-50 dark:bg-purple-950/20 text-xs"
            >
              Distributor
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="size-3" />
              Distributor Ledger
            </span>
            {customer.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" />
                {customer.city}
              </span>
            )}
            {customer.mobileNumber && (
              <span className="flex items-center gap-1">
                <Phone className="size-3" />
                {customer.mobileNumber}
              </span>
            )}
            {generatedAt && (
              <span className="flex items-center gap-1" title={`Generated by ${data.generatedBy}`}>
                <Clock className="size-3" />
                Updated {format(new Date(generatedAt), "dd MMM yyyy HH:mm")}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("size-4", isRefetching && "animate-spin")} />
            Refresh
          </Button>
          <LedgerPrintExport
            title="Distributor Ledger"
            subtitle={customer.name}
            periodLabel={`${dateFrom || "All"} to ${dateTo || "All"}`}
            entries={entries}
            summary={summary}
            customerInfo={{
              name: customer.name,
              city: customer.city,
              mobileNumber: customer.mobileNumber,
            }}
            watermark={data.generatedBy}
            loadEntriesForExport={loadEntriesForExport}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Filter Period</p>
          <DatePickerWithRange
            date={dateRange}
            onDateChange={handleDateChange}
            className="w-64"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Type</p>
          <Select
            value={typeFilter}
            onValueChange={(v: any) => {
              setTypeFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entries</SelectItem>
                <SelectItem value="invoice">Invoices Only</SelectItem>
                <SelectItem value="payment">Payments Only</SelectItem>
                <SelectItem value="return">Returns Only</SelectItem>
              </SelectContent>
            </Select>
        </div>

        <div className="space-y-1.5 flex-1 min-w-[200px] max-w-md">
          <p className="text-xs font-medium text-muted-foreground">Search</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search invoices, products, references..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-8"
            />
          </div>
        </div>

        <Button size="sm" onClick={handleSearch} className="mb-0.5">
          Search
        </Button>

        {search && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setPage(1);
            }}
            className="mb-0.5"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <SummaryCard
          label="Opening Balance"
          value={summary.openingBalance}
          color={summary.openingBalance > 0 ? "text-red-700" : "text-green-700"}
        />
        <SummaryCard label="Period Sales" value={summary.periodTotalSales} color="text-emerald-700" />
        <SummaryCard label="Period Payments" value={summary.periodPayments} color="text-blue-700" />
        <SummaryCard
          label="Closing Balance"
          value={summary.closingBalance}
          color={summary.closingBalance > 0 ? "text-red-700" : "text-green-700"}
        />
        <SummaryCard
          label="Period Profit"
          value={summary.periodTotalProfit}
          color={summary.periodTotalProfit >= 0 ? "text-emerald-700" : "text-red-700"}
        />
        <SummaryCard label="Entries" value={data.totalEntries} color="text-violet-700" isCount />
      </div>

      {/* Aging Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {/* Ledger Table */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] w-10"></TableHead>
                  <TableHead
                    className="text-[11px] cursor-pointer select-none"
                    onClick={handleSort}
                  >
                    <div className="flex items-center gap-1">
                      Date
                      {sortBy === "date" && (
                        <ArrowUpDown className="size-3" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="text-[11px]">Description</TableHead>
                  <TableHead className="text-[11px] text-right">Debit</TableHead>
                  <TableHead className="text-[11px] text-right">Credit</TableHead>
                  <TableHead className="text-[11px] text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-10 text-sm"
                    >
                      No ledger entries for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry: LedgerEntry) => (
                    <LedgerTableRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedInvoiceId === entry.id}
                      onToggleExpand={() => toggleExpand(entry.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-xs text-muted-foreground">
                Page {page} of {pageCount} · {data.totalEntries} entries
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
                    // Show pages around current page
                    let pageNum: number;
                    if (pageCount <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= pageCount - 2) {
                      pageNum = pageCount - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <Button
                        key={pageNum}
                        variant={page === pageNum ? "default" : "ghost"}
                        size="sm"
                        className="size-8 p-0 text-xs"
                        onClick={() => setPage(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              Quick Stats
            </h3>
            <div className="space-y-2">
              <StatRow label="Total Cash" value={summary.periodTotalCash} />
              <StatRow label="Total Credit" value={summary.periodTotalCredit} />
              <StatRow label="Returns" value={summary.periodReturns} />
              <StatRow label="Invoices" value={summary.invoiceCount} isCount />
              <StatRow label="Payments" value={summary.paymentCount} isCount />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  isCount,
}: {
  label: string;
  value: number;
  color: string;
  isCount?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl border bg-card">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">
        {label}
      </p>
      <p className={cn("text-xl font-bold tabular-nums", color)}>
        {isCount ? value.toLocaleString("en-PK") : formatPKR(value, false)}
      </p>
    </div>
  );
}

function StatRow({
  label,
  value,
  isCount,
}: {
  label: string;
  value: number;
  isCount?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">
        {isCount ? value.toLocaleString("en-PK") : formatPKR(value, false)}
      </span>
    </div>
  );
}

function LedgerTableRow({
  entry,
  isExpanded,
  onToggleExpand,
}: {
  entry: LedgerEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const isInvoice = entry.type === "invoice";
  const isReturn = entry.type === "return";
  const isInvoiceCashPayment = entry.type === "payment" && entry.method === "invoice_cash";

  return (
    <>
      <TableRow className={isInvoice ? "cursor-pointer hover:bg-muted/50" : ""}>
        <TableCell>
          {isInvoice && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          )}
        </TableCell>
        <TableCell className="text-sm tabular-nums whitespace-nowrap">
          {format(new Date(entry.date), "dd MMM yyyy")}
        </TableCell>
        <TableCell className="text-sm">
          {isInvoice ? (
            <div className="space-y-1">
              <div>
                Invoice <strong>#{entry.slipNumber || "—"}</strong>
                {entry.warehouseName && ` — ${entry.warehouseName}`}
              </div>
              <div className="text-xs text-muted-foreground">
                Total: {formatPKR(entry.totalPrice, false)}{" "}
                <span className="text-muted-foreground/70">
                  (Cash: {formatPKR(entry.cash, false)} + Credit: {formatPKR(entry.credit, false)})
                </span>
              </div>
              {entry.slipStatus && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    entry.slipStatus === "closed"
                      ? "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/20"
                      : entry.slipStatus === "partially_recovered"
                        ? "border-yellow-300 text-yellow-700 bg-yellow-50 dark:bg-yellow-950/20"
                        : "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/20",
                  )}
                >
                  Slip: {entry.slipStatus.replace("_", " ")}
                </Badge>
              )}
            </div>
          ) : isReturn ? (
            <div className="space-y-1">
              <div className="font-medium text-amber-700 dark:text-amber-400">
                Sales Return #{entry.returnNumber ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Reason: {entry.reason}
              </div>
              <div className="text-[10px] text-muted-foreground capitalize">
                Condition: {entry.condition}
              </div>
              {entry.invoiceSlipNumber && (
                <div className="flex items-center gap-1 text-xs text-blue-600">
                  <Link className="size-3" />
                  <span>Linked to Invoice #{entry.invoiceSlipNumber}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className={cn(isInvoiceCashPayment && "text-muted-foreground")}>
                Payment <span className="capitalize">({entry.method})</span>
                {entry.reference && ` — Ref: ${entry.reference}`}
                {isInvoiceCashPayment && (
                  <Badge variant="outline" className="ml-1.5 text-[9px] border-gray-300 text-gray-500">Settled</Badge>
                )}
              </div>
              {isInvoiceCashPayment && (
                <div className="text-[10px] text-muted-foreground">
                  Cash settled during invoice creation — already reflected in the invoice cash split
                </div>
              )}
              {entry.invoiceSlipNumber && (
                <div className="flex items-center gap-1 text-xs text-blue-600">
                  <Link className="size-3" />
                  <span>Linked to Invoice #{entry.invoiceSlipNumber}</span>
                </div>
              )}
            </div>
          )}
        </TableCell>
        <TableCell className="text-sm tabular-nums text-right">
          {isInvoice ? formatPKR(entry.credit, false) : "—"}
        </TableCell>
        <TableCell className={cn("text-sm tabular-nums text-right", isReturn ? "text-amber-600" : "text-green-600")}>
          {isReturn ? formatPKR(entry.amount, false) : !isInvoice && !isInvoiceCashPayment ? formatPKR(entry.amount, false) : isInvoiceCashPayment ? (
            <span className="text-muted-foreground/60 text-xs">{formatPKR(entry.amount, false)}</span>
          ) : "—"}
        </TableCell>
        <TableCell className="text-sm tabular-nums text-right font-semibold">
          {formatPKR(entry.runningBalance, false)}
        </TableCell>
      </TableRow>

      {/* Expanded invoice details */}
      {isInvoice && isExpanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-0">
            <div className="p-4 space-y-4">
              {/* Line Items */}
              {entry.items && entry.items.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Line Items
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Product</TableHead>
                        <TableHead className="text-[10px] text-right">Cartons</TableHead>
                        <TableHead className="text-[10px] text-right">Free</TableHead>
                        <TableHead className="text-[10px] text-right">Discount</TableHead>
                        <TableHead className="text-[10px] text-right">Qty</TableHead>
                        <TableHead className="text-[10px] text-right">Price/Carton</TableHead>
                        <TableHead className="text-[10px] text-right">HSN</TableHead>
                        <TableHead className="text-[10px] text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entry.items.map((item, itemIdx) => (
                        <TableRow key={itemIdx}>
                          <TableCell className="text-xs font-medium">{item.pack}</TableCell>
                          <TableCell className="text-xs tabular-nums text-right">
                            {item.numberOfCartons}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right text-green-600">
                            {item.freeCartons || 0}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right text-orange-600">
                            {item.discountCartons}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right">
                            {formatPKR(Number(item.perCartonPrice), false)}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right font-mono">
                            {item.hsnCode}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right font-semibold">
                            {formatPKR(Number(item.amount), false)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Invoice Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className="font-medium capitalize">{entry.status}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cash:</span>{" "}
                  <span className="font-medium">{formatPKR(entry.cash, false)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Credit:</span>{" "}
                  <span className="font-medium">{formatPKR(entry.credit, false)}</span>
                </div>
                {entry.creditReturnDate && (
                  <div>
                    <span className="text-muted-foreground">Credit Return:</span>{" "}
                    <span className="font-medium">
                      {format(new Date(entry.creditReturnDate), "dd MMM yyyy")}
                    </span>
                  </div>
                )}
                {entry.expenses > 0 && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Expenses:</span>{" "}
                      <span className="font-medium">{formatPKR(entry.expenses, false)}</span>
                    </div>
                    {entry.expensesDescription && (
                      <div className="col-span-3">
                        <span className="text-muted-foreground">Expense Note:</span>{" "}
                        <span className="font-medium">{entry.expensesDescription}</span>
                      </div>
                    )}
                  </>
                )}
                {entry.remarks && (
                  <div className="col-span-2 md:col-span-4">
                    <span className="text-muted-foreground">Remarks:</span>{" "}
                    <span className="font-medium">{entry.remarks}</span>
                  </div>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-8 w-24" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-80" />
      </div>
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-96 w-full rounded-xl col-span-2" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
