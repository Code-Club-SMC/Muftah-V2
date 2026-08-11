import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { type DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { CustomerPagination } from "@/components/sales/customer-pagination";
import { InvoiceDetailSheet } from "@/components/sales/invoice-detail-sheet";
import { customersKeys, useGetCustomerLedger } from "@/hooks/sales/use-customers";
import { getCustomerLedgerFn } from "@/server-functions/sales/customers-fn";
import { useGetPayments } from "@/hooks/sales/use-payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  AlertCircle,
  Phone,
  MapPin,
  Building2,
  DollarSign,
  CreditCard,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PrintExportToolbar } from "@/components/sales/ledger-print-export";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export const Route = createFileRoute("/_protected/sales/customers/$customerId/")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search.page ?? 1),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, params }) => {
    const now = new Date();
    const dateFrom = format(startOfMonth(now), "yyyy-MM-dd");
    const dateTo = format(endOfMonth(now), "yyyy-MM-dd");
    void context.queryClient.prefetchQuery({
      queryKey: customersKeys.ledger(params.customerId, { page: 1, limit: 10, dateFrom, dateTo }),
      queryFn: () =>
        getCustomerLedgerFn({ data: { customerId: params.customerId, page: 1, limit: 10, dateFrom, dateTo } }),
    });
  },
  component: CustomerLedgerPage,
});

function CustomerLedgerPage() {
  const { customerId } = Route.useParams();
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [page, setPage] = useState(1);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);

  const dateFrom = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const dateTo = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  const handleDateChange = (d: DateRange | undefined) => {
    setDateRange(d ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) });
    setPage(1);
  };

  const { data, isLoading, isError, error } = useGetCustomerLedger(customerId, {
    page,
    limit: 10,
    dateFrom,
    dateTo,
  });

  const { data: paymentsData, isLoading: paymentsLoading } = useGetPayments({
    customerId,
    page: 1, // Keep pagination simple for payments
    limit: 50,
    dateFrom,
    dateTo,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="size-12 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {(error as any)?.message || "Failed to load customer ledger"}
        </p>
        <Button variant="outline" onClick={() => router.history.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const {
    customer,
    invoices,
    total,
    pageCount,
    periodRevenue,
    periodPaidAmount,
    periodOutstandingAmount,
    periodProfit,
    lifetimeProfit,
    overdueInvoices,
    nextDueDate,
  } = data;

  const outstandingAmount = Number(customer.outstandingAmount);

  return (
    <div className="space-y-6">
      {/* ── Header row ── */}
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
              className={cn(
                "capitalize text-xs",
                customer.customerType === "distributor"
                  ? "border-purple-200 text-purple-700 bg-purple-50 dark:bg-purple-950/20"
                  : "border-blue-200 text-blue-700 bg-blue-50 dark:bg-blue-950/20",
              )}
            >
              {customer.customerType}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-1.5 text-sm text-muted-foreground">
            {customer.mobileNumber && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {customer.mobileNumber}
              </span>
            )}
            {customer.city && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {customer.city}
              </span>
            )}
            {customer.bankAccount && (
              <span className="flex items-center gap-1.5">
                <Building2 className="size-3.5" />
                {customer.bankAccount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrintExportToolbar
            title="Customer Ledger"
            subtitle={customer.name}
            periodLabel={`${dateFrom || "All"} to ${dateTo || "All"}`}
            entries={(() => {
              const raw = [
                ...invoices.map((inv: any) => ({
                  type: "invoice" as const,
                  date: inv.date,
                  description: `Invoice #${inv.invoiceNumber}`,
                  warehouse: inv.warehouse?.name || "—",
                  total: Number(inv.totalPrice),
                  paidAmount: Number(inv.paidAmount),
                  returnedAmount: Number(inv.returnedAmount),
                  outstandingAmount: Number(inv.outstandingAmount),
                })),
                ...(paymentsData?.data || []).filter((p: any) => p.status === "confirmed").map((p: any) => ({
                  type: "payment" as const,
                  date: p.effectiveDate,
                  description: `Payment (${p.method})`,
                  warehouse: "—",
                  total: 0,
                  paymentAmount: Number(p.amount),
                })),
              ].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
              let balance = 0;
              return raw.map((entry: any) => {
                if (entry.type === "invoice") {
                  balance += entry.total;
                } else {
                  balance = Math.max(0, balance - (entry.paymentAmount || 0));
                }
                return { ...entry, balance };
              });
            })()}
            summary={{
              periodRevenue,
              periodPaidAmount,
              periodOutstandingAmount,
              outstandingAmount,
              invoiceCount: total,
              paymentCount: paymentsData?.total || 0,
            }}
            columns={[
              { key: "date", label: "Date", format: (v: any) => format(new Date(v), "dd MMM yyyy") },
              { key: "type", label: "Type", format: (v: any) => v === "invoice" ? "Invoice" : "Payment" },
              { key: "description", label: "Description" },
              { key: "warehouse", label: "Warehouse" },
              { key: "total", label: "Total", format: (v: any) => PKR(Number(v || 0)) },
              { key: "paidAmount", label: "Paid Amount", format: (v: any) => PKR(Number(v || 0)) },
              { key: "returnedAmount", label: "Returned Amount", format: (v: any) => PKR(Number(v || 0)) },
              { key: "outstandingAmount", label: "Outstanding Amount", format: (v: any) => PKR(Number(v || 0)) },
              { key: "balance", label: "Balance", format: (v: any) => PKR(Number(v || 0)) },
            ]}
          />
        </div>
      </div>

      {/* ── Balance + profit + next due date row ── */}
      <div className="flex flex-wrap gap-4">
        <div
          className={cn(
            "flex-1 min-w-[200px] p-4 rounded-xl border",
            outstandingAmount > 0
              ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
              : "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Outstanding Balance
            </p>
            {outstandingAmount > 0 ? (
              <Badge variant="destructive" className="text-[10px]">Unpaid</Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-green-600 border-green-300 text-[10px]"
              >
                Clear
              </Badge>
            )}
          </div>
          <p
            className={cn(
              "text-2xl font-bold tabular-nums",
              outstandingAmount > 0 ? "text-red-700" : "text-green-700",
            )}
          >
            {PKR(outstandingAmount)}
          </p>
        </div>

        <div className="flex-1 min-w-[200px] p-4 rounded-xl border bg-card">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            Total Profit (Lifetime)
          </p>
          <p className={cn(
            "text-2xl font-bold tabular-nums",
            lifetimeProfit >= 0 ? "text-emerald-700" : "text-red-700",
          )}>
            {PKR(lifetimeProfit)}
          </p>
        </div>

        <div className="flex-1 min-w-[200px] p-4 rounded-xl border bg-card">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            Next Due Date
          </p>
          <p className="text-lg font-semibold">
            {nextDueDate
              ? format(new Date(nextDueDate), "dd MMM yyyy")
              : "None"}
          </p>
        </div>
      </div>

      {/* ── Overdue alert ── */}
      {overdueInvoices > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {overdueInvoices} invoice{overdueInvoices !== 1 ? "s are" : " is"} overdue
          </AlertDescription>
        </Alert>
      )}

      {/* ── Date range picker ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Filter Period</p>
          <DatePickerWithRange
            date={dateRange}
            onDateChange={handleDateChange}
            className="w-64"
          />
        </div>
      </div>

      {/* ── KPI cards row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="size-3.5 text-emerald-600" />
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Period Revenue
            </p>
          </div>
          <p className="text-xl font-bold tabular-nums text-emerald-700">
            {PKR(periodRevenue)}
          </p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <CreditCard className="size-3.5 text-blue-600" />
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Paid Amount
            </p>
          </div>
          <p className="text-xl font-bold tabular-nums text-blue-700">
            {PKR(periodPaidAmount)}
          </p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <CreditCard className="size-3.5 text-rose-600" />
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Outstanding Amount
            </p>
          </div>
          <p className="text-xl font-bold tabular-nums text-rose-700">
            {PKR(periodOutstandingAmount)}
          </p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className={cn("size-3.5", periodProfit >= 0 ? "text-emerald-600" : "text-rose-600")} />
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Period Profit
            </p>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", periodProfit >= 0 ? "text-emerald-700" : "text-rose-700")}>
            {PKR(periodProfit)}
          </p>
        </div>
      </div>

      {/* ── Tabs for Invoices & Payments ── */}
      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments History</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                Invoice History ({total})
              </h3>
            </div>
            <div className="rounded-xl border border-border/60 overflow-hidden">
              <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Date</TableHead>
                <TableHead className="text-[11px]">Invoice #</TableHead>
                <TableHead className="text-[11px] text-right">Total</TableHead>
                <TableHead className="text-[11px] text-right">Paid Amount</TableHead>
                <TableHead className="text-[11px] text-right">Returned Amount</TableHead>
                <TableHead className="text-[11px] text-right">Outstanding Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-10 text-sm"
                  >
                    No invoices found for the selected period.
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv: any) => {
                  const paidAmount = Number(inv.paidAmount);
                  const returnedAmount = Number(inv.returnedAmount);
                  const invoiceOutstanding = Number(inv.outstandingAmount);
                  const totalVal = Number(inv.totalPrice);

                  return (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => {
                        setSelectedInvoiceId(inv.id);
                        setInvoiceSheetOpen(true);
                      }}
                    >
                      <TableCell className="text-sm tabular-nums">
                        {format(new Date(inv.date), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right font-semibold">
                        {PKR(totalVal)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-sm tabular-nums text-right",
                          paidAmount > 0 ? "text-green-600" : "text-muted-foreground",
                        )}
                      >
                        {PKR(paidAmount)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right">
                        {returnedAmount > 0 ? PKR(returnedAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right">
                        {invoiceOutstanding > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {PKR(invoiceOutstanding)}
                          </Badge>
                        ) : (
                          <span className="text-green-600 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Pagination ── */}
      <CustomerPagination
        page={page}
        pageCount={pageCount}
        total={total}
        limit={10}
        onPageChange={setPage}
      />
      </TabsContent>

      <TabsContent value="payments">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Payments History ({paymentsData?.total || 0})
            </h3>
          </div>
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Date</TableHead>
                  <TableHead className="text-[11px]">Method</TableHead>
                  <TableHead className="text-[11px]">Reference</TableHead>
                  <TableHead className="text-[11px]">Notes</TableHead>
                  <TableHead className="text-[11px] text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10">
                      <Skeleton className="h-4 w-32 mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : !paymentsData?.data?.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-10 text-sm"
                    >
                      No payments found for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  paymentsData.data.map((payment: any) => (
                    <TableRow key={payment.id}>
                      <TableCell className="text-sm tabular-nums">
                        {format(new Date(payment.paymentDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {payment.method.replace("_", " ")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {payment.reference || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {payment.notes || "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right font-semibold text-green-600">
                        {PKR(Number(payment.amount))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </TabsContent>
      </Tabs>

      {/* ── Invoice detail sheet ── */}
      <InvoiceDetailSheet
        open={invoiceSheetOpen}
        onOpenChange={setInvoiceSheetOpen}
        invoiceId={selectedInvoiceId}
        onPrint={() => {}}
      />
    </div>
  );
}
