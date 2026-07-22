import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { GenericLoader } from "@/components/custom/generic-loader";
import { invoicesKeys, useGetInvoices, useDeleteInvoice } from "@/hooks/sales/use-invoices";
import { getInvoicesFn } from "@/server-functions/sales/invoices-fn";
import { getOrderForInvoiceFn } from "@/server-functions/sales/orders-fn";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { type DateRange } from "react-day-picker";
import { ReceiptText, Trash2, Loader2, Search, X, SlidersHorizontal, Store, Truck } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { InvoiceKpiCards } from "@/components/sales/invoice-kpi-cards";
import { InvoicePagination } from "@/components/sales/invoice-pagination";
import { InvoiceDetailSheet } from "@/components/sales/invoice-detail-sheet";
import { InvoicePrintDialog } from "@/components/sales/invoice-print-dialog";
import { CreateInvoiceSheet } from "@/components/sales/create-invoice-sheet";
import { InvoiceActionsMenu } from "@/components/sales/invoice-actions-menu";
import { InvoiceTypeBadge } from "@/components/sales/invoice-type-badge";
import { GenericEmpty } from "@/components/custom/empty";
import { InvoicesEmptyIllustration } from "@/components/illustrations/InvoicesEmptyIllustration";
import { SalesEmptyIllustration } from "@/components/illustrations/SalesEmptyIllustration";
import { useQueryClient } from "@tanstack/react-query";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

const roundMoney = (value: number) => Number(value.toFixed(2));

const getSafeContainersPerCarton = (value: unknown) =>
  Math.max(1, Number(value) || 1);

const normalizeBookedOrderUnitType = (unitType: string) =>
  unitType
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const toBookedOrderLabel = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

function getBookedOrderUnitMeta(it: {
  unitType?: string | null;
  hasCartonPackaging?: boolean;
}) {
  const rawUnitType = it.unitType?.trim() ?? "";
  const normalizedUnitType = normalizeBookedOrderUnitType(rawUnitType);

  if (
    normalizedUnitType === "half carton" ||
    normalizedUnitType === "halfcarton"
  ) {
    return { lineKind: "half_carton" as const, label: "Half Carton" };
  }

  if (
    normalizedUnitType === "carton" ||
    normalizedUnitType === "ctn" ||
    normalizedUnitType === "full carton" ||
    normalizedUnitType === "fullcarton"
  ) {
    return { lineKind: "carton" as const, label: "Carton" };
  }

  if (normalizedUnitType === "shopper") {
    return { lineKind: "units" as const, label: "Shopper" };
  }

  if (normalizedUnitType === "pack") {
    return { lineKind: "units" as const, label: "Pack" };
  }

  if (
    normalizedUnitType === "unit" ||
    normalizedUnitType === "units" ||
    normalizedUnitType === "piece" ||
    normalizedUnitType === "pieces" ||
    normalizedUnitType === "pcs"
  ) {
    return { lineKind: "units" as const, label: "Units" };
  }

  if (it.hasCartonPackaging) {
    return { lineKind: "carton" as const, label: "Carton" };
  }

  return {
    lineKind: "units" as const,
    label: rawUnitType ? toBookedOrderLabel(rawUnitType) : "Units",
  };
}

function mapBookedOrderItemToInvoiceLine(it: any) {
  const hasCartonPackaging = Boolean(it.hasCartonPackaging);
  const containersPerCarton = getSafeContainersPerCarton(
    it.containersPerCarton,
  );
  const quantity = Number(it.quantity) || 0;
  const orderRate = roundMoney(Number(it.rate) || 0);
  const { lineKind } = getBookedOrderUnitMeta(it);

  switch (lineKind) {
    case "carton":
      return {
        pack: it.recipeName || it.productName,
        recipeId: it.recipeId,
        unitType: "carton" as const,
        numberOfCartons: quantity,
        numberOfUnits: 0,
        packsPerCarton: containersPerCarton,
        actualPackSize: containersPerCarton,
        hsnCode: "",
        perCartonPrice: orderRate,
        retailPrice: 0,
        isPriceOverride: false,
      };
    case "half_carton":
      return {
        pack: it.recipeName || it.productName,
        recipeId: it.recipeId,
        unitType: "units" as const,
        numberOfCartons: 0,
        numberOfUnits: quantity * (containersPerCarton / 2),
        packsPerCarton: containersPerCarton,
        actualPackSize: containersPerCarton,
        hsnCode: "",
        perCartonPrice: roundMoney(orderRate * 2),
        retailPrice: 0,
        isPriceOverride: false,
      };
    default:
      return {
        pack: it.recipeName || it.productName,
        recipeId: it.recipeId,
        unitType: "units" as const,
        numberOfCartons: 0,
        numberOfUnits: quantity,
        packsPerCarton: containersPerCarton,
        actualPackSize: containersPerCarton,
        hsnCode: "",
        perCartonPrice: hasCartonPackaging
          ? roundMoney(orderRate * containersPerCarton)
          : orderRate,
        retailPrice: 0,
        isPriceOverride: false,
      };
  }
}

export const Route = createFileRoute("/_protected/sales/new-invoice/")({
  validateSearch: (search: Record<string, unknown>) => ({
    orderId: (typeof search.orderId === "string" ? search.orderId : undefined) as string | undefined,
  }),
  loader: async ({ context }) => {
    const now = new Date();
    const defaultParams = {
      page: 1,
      limit: 10,
      dateFrom: format(subDays(now, 7), "yyyy-MM-dd"),
      dateTo: format(now, "yyyy-MM-dd"),
    };
    void context.queryClient.prefetchQuery({
      queryKey: invoicesKeys.list(defaultParams),
      queryFn: () => getInvoicesFn({ data: defaultParams }),
    });
  },
  component: InvoicesPage,
});

function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Sales Invoices</h2>
        <p className="text-muted-foreground mt-1">
          Manage sales, generate smart invoices, track revenue, and monitor outstanding balances.
        </p>
      </div>

      <Separator />

      <Suspense fallback={<GenericLoader title="Loading Invoices" description="Fetching sales data..." />}>
        <InvoicesContent />
      </Suspense>
    </div>
  );
}

function InvoicesContent() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { orderId } = Route.useSearch();
  const autoOpenedOrderIdRef = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Date range — defaults to last 7 days
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  // Invoice number search — raw input vs committed (only committed triggers fetch)
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");

  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [sheetCustomerType, setSheetCustomerType] = useState<"distributor" | "retailer" | "wholesaler">("retailer");
  const [sheetLocked, setSheetLocked] = useState(false);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch order data when converting an order to an invoice
  const { data: orderConversionData } = useQuery({
    queryKey: ["order-for-invoice", orderId],
    queryFn: () => getOrderForInvoiceFn({ data: { orderId: orderId! } }),
    enabled: !!orderId,
    staleTime: 0,
  });

  // Auto-open each order conversion only once per route search param.
  useEffect(() => {
    if (!orderId) {
      autoOpenedOrderIdRef.current = null;
      return;
    }

    if (orderConversionData && autoOpenedOrderIdRef.current !== orderId) {
      autoOpenedOrderIdRef.current = orderId;
      setSheetCustomerType("retailer");
      setSheetLocked(false);
      setCreateSheetOpen(true);
    }
  }, [orderId, orderConversionData]);

  // Build initialData for the invoice form from the order
  const invoiceInitialData = useMemo(() => {
    if (!orderConversionData) return undefined;
    const od = orderConversionData as any;
    const customerFound = od.customer.found;
    const bookedOrderTotal = roundMoney(
      (od.items ?? []).reduce(
        (sum: number, item: any) => sum + (Number(item.amount) || 0),
        0,
      ),
    );
    return {
      orderId: od.order.id,
      orderBookerId: od.order.orderBookerId,
      customerId: customerFound ? od.customer.id : "",
      // When customer not found, pass shopkeeper details for inline creation
      customerName: customerFound ? "" : (od.customer.name ?? ""),
      customerMobile: customerFound ? "" : (od.customer.mobileNumber ?? ""),
      customerAddress: customerFound ? "" : (od.customer.address ?? ""),
      // "shopkeeper" not in form enum — map to "retailer"
      customerType: customerFound ? od.customer.customerType : "retailer",
      warehouseId: "",
      orderPreview: {
        billNumber: od.order.billNumber,
        orderBookerName: od.order.orderBookerName,
        shopkeeperName: od.order.shopkeeperName,
        shopkeeperMobile: od.order.shopkeeperMobile,
        shopkeeperAddress: od.order.shopkeeperAddress,
        status: od.order.status,
        totalAmount: bookedOrderTotal,
        items: od.items.map((it: any) => ({
          productName: it.recipeName || it.productName,
          unitLabel: getBookedOrderUnitMeta(it).label,
          quantity: Number(it.quantity) || 0,
          rate: roundMoney(Number(it.rate) || 0),
          amount: roundMoney(Number(it.amount) || 0),
        })),
      },
      items: od.items.map((it: any) => mapBookedOrderItemToInvoiceLine(it)),
    };
  }, [orderConversionData]);

  const deleteInvoice = useDeleteInvoice();

  const dateFrom = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const dateTo = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  const hasFilters = !!committedSearch;

  const { data } = useGetInvoices({
    page,
    limit,
    dateFrom,
    dateTo,
    search: committedSearch || undefined,
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const invoices = data?.data || [];
  const pageCount = data?.pageCount || 1;
  const total = data?.total || 0;

  const handleSearch = useCallback(() => {
    setCommittedSearch(searchInput.trim());
    setPage(1);
  }, [searchInput]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    setCommittedSearch("");
    setPage(1);
  }, []);

  const handleView = useCallback((id: string) => {
    setDetailInvoiceId(id);
    setDetailSheetOpen(true);
  }, []);

  const handlePrint = useCallback((id: string) => {
    setPrintInvoiceId(id);
    setPrintOpen(true);
  }, []);

  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await deleteInvoice.mutateAsync(deleteConfirmId);
      queryClient.invalidateQueries({ queryKey: invoicesKeys.list({ page, limit }) });
      queryClient.invalidateQueries({ queryKey: invoicesKeys.stats() });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, deleteInvoice, queryClient, page, limit]);

  const handleDetailPrint = useCallback((invId: string) => {
    setPrintInvoiceId(invId);
    setPrintOpen(true);
    setDetailSheetOpen(false);
  }, []);

  return (
    <div className="space-y-5">
      {/* KPI Cards — scoped to current date range */}
      <InvoiceKpiCards
        filters={{ dateFrom, dateTo }}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 bg-muted/20 p-4 rounded-xl border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground self-end mb-2">
          <SlidersHorizontal className="size-3.5" />
          Filters
        </div>

        {/* Date range */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Date Range</Label>
          <DatePickerWithRange
            date={dateRange}
            onDateChange={(d) => {
              setDateRange(d ?? { from: subDays(new Date(), 7), to: new Date() });
              setPage(1);
            }}
            className="w-64"
          />
        </div>

        {/* Invoice number search */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Invoice No.</Label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="e.g. INV-42"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-36 h-9 text-sm font-mono"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSearch}
              className="h-9 gap-1.5 px-3"
            >
              <Search className="size-3.5" />
              Search
            </Button>
          </div>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearSearch}
            className="gap-1.5 text-muted-foreground hover:text-foreground h-9 self-end"
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Header + Create button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ReceiptText className="size-4" />
          <span>
            {total} invoice{total !== 1 ? "s" : ""}
            {hasFilters && " (filtered)"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { setSheetCustomerType("retailer"); setSheetLocked(false); setCreateSheetOpen(true); }} size="sm" className="gap-2">
            <Store className="size-4" />
            New General Invoice
          </Button>
          <Button onClick={() => { setSheetCustomerType("distributor"); setSheetLocked(true); setCreateSheetOpen(true); }} size="sm" variant="secondary" className="gap-2">
            <Truck className="size-4" />
            New Distributor Invoice
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {total === 0 && !hasFilters ? (
        <GenericEmpty
          icon={InvoicesEmptyIllustration}
          title="No Invoices Found"
          description="No invoices found for the selected period."
          ctaText="Create Invoice"
          onAddChange={() => { setSheetCustomerType("retailer"); setSheetLocked(false); setCreateSheetOpen(true); }}
        />
      ) : total === 0 && hasFilters ? (
        <GenericEmpty
          className="py-12"
          icon={SalesEmptyIllustration}
          title="No Results Found"
          description="No invoices matched your search. Try a different invoice number."
          ctaText="Clear Search"
          onAddChange={handleClearSearch}
        />
      ) : (
        <>
          {/* Table */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Invoice No.</TableHead>
                  <TableHead className="text-[11px]">Date</TableHead>
                  <TableHead className="text-[11px]">Customer</TableHead>
                  <TableHead className="text-[11px]">Type</TableHead>
                  <TableHead className="text-[11px]">Warehouse</TableHead>
                  <TableHead className="text-[11px] text-right">Total</TableHead>
                  <TableHead className="text-[11px] text-right">Cash</TableHead>
                  <TableHead className="text-[11px] text-right">Credit</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px] w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv: any) => (
                  <InvoiceRow
                    key={inv.id}
                    invoice={inv}
                    onView={handleView}
                    onPrint={handlePrint}
                    onDelete={handleDeleteRequest}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <InvoicePagination
            page={page}
            pageCount={pageCount}
            total={total}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(l) => { setLimit(l); setPage(1); }}
          />
        </>
      )}

      {/* Create Invoice Sheet */}
      <CreateInvoiceSheet
        open={createSheetOpen}
        onOpenChange={(open) => {
          setCreateSheetOpen(open);
          if (!open && orderId) {
            navigate({
              to: "/sales/new-invoice",
              search: { orderId: undefined },
              replace: true,
            });
          }
        }}
        defaultCustomerType={sheetCustomerType}
        lockedCustomerType={sheetLocked}
        initialData={invoiceInitialData}
      />

      {/* Detail Sheet */}
      <InvoiceDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        invoiceId={detailInvoiceId}
        onPrint={() => {
          if (detailInvoiceId) handleDetailPrint(detailInvoiceId);
        }}
      />

      {/* Print Dialog */}
      <InvoicePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        invoiceId={printInvoiceId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" />
              Delete Invoice?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the invoice and reverse all associated transactions,
              including customer ledger entries, wallet credits, and stock deductions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="size-4 mr-1" />
                  Delete Invoice
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Memoized row component ──
const InvoiceRow = ({
  invoice,
  onView,
  onPrint,
  onDelete,
}: {
  invoice: any;
  onView: (id: string) => void;
  onPrint: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const credit = Number(invoice.credit);
  const cash = Number(invoice.cash);

  let statusLabel: string;
  let statusVariant: "default" | "destructive" | "outline";

  if (credit === 0 && cash > 0) {
    statusLabel = "Paid";
    statusVariant = "default";
  } else if (cash === 0 && credit > 0) {
    statusLabel = "Credit";
    statusVariant = "destructive";
  } else if (cash > 0 && credit > 0) {
    statusLabel = "Partial";
    statusVariant = "outline";
  } else {
    statusLabel = "Unknown";
    statusVariant = "outline";
  }

  return (
    <TableRow className="group">
      <TableCell className="text-sm font-mono font-medium text-primary">
        <Link
          to="/sales/invoices/$invoiceId"
          params={{ invoiceId: invoice.id }}
          className="hover:underline underline-offset-2"
        >
          {invoice.slipNumber || "—"}
        </Link>
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {format(new Date(invoice.date), "dd MMM yyyy")}
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-sm">
            {invoice.customer?.name || "Cash / Walk-in"}
          </span>
          {invoice.customer?.mobileNumber && (
            <span className="text-[10px] text-muted-foreground">{invoice.customer.mobileNumber}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <InvoiceTypeBadge customerType={invoice.customer?.customerType || "retailer"} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {invoice.warehouse?.name || "—"}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-right font-semibold">
        {PKR(Number(invoice.totalPrice))}
      </TableCell>
      <TableCell className={cn(
        "text-sm tabular-nums text-right",
        cash > 0 ? "text-green-600" : "text-muted-foreground"
      )}>
        {PKR(cash)}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-right">
        {credit > 0 ? (
          <Badge variant="destructive" className="tabular-nums text-[10px] font-semibold">
            {PKR(credit)}
          </Badge>
        ) : (
          <span className="text-green-600 text-xs">Settled</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant} className="capitalize text-[10px]">
          {statusLabel}
        </Badge>
      </TableCell>
      <TableCell>
        <InvoiceActionsMenu
          onView={() => onView(invoice.id)}
          onPrint={() => onPrint(invoice.id)}
          onDelete={() => onDelete(invoice.id)}
        />
      </TableCell>
    </TableRow>
  );
};
