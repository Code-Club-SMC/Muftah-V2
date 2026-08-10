import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { GenericLoader } from "@/components/custom/generic-loader";
import { getInvoiceDetailFn } from "@/server-functions/sales/invoice-detail-fn";
import { CreateReturnDialog } from "@/components/sales/create-return-dialog";
import { useProcessSalesReturn } from "@/hooks/sales/use-sales-returns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineHeader,
  TimelineIcon,
  TimelineContent,
  TimelineTitle,
  TimelineDescription,
} from "@/components/ui/timeline";
import {
  ArrowLeft,
  Printer,
  Receipt,
  Package,
  User,
  MapPin,
  Phone,
  Calendar,
  Banknote,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  ShieldAlert,
  MessageSquare,
  Truck,
} from "lucide-react";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

type InvoiceDetailData = Awaited<ReturnType<typeof getInvoiceDetailFn>>;

export const Route = createFileRoute("/_protected/sales/invoices/$invoiceId/")({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery({
      queryKey: ["invoice-detail", params.invoiceId],
      queryFn: () => getInvoiceDetailFn({ data: { invoiceId: params.invoiceId } }),
    });
  },
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = useParams({ from: "/_protected/sales/invoices/$invoiceId/" });

  return (
    <div className="space-y-6">
      <Suspense fallback={<GenericLoader title="Loading Invoice" description="Fetching invoice details..." />}>
        <InvoiceDetailContent invoiceId={invoiceId} />
      </Suspense>
    </div>
  );
}

function InvoiceDetailContent({ invoiceId }: { invoiceId: string }) {
  const { data } = useQuery<InvoiceDetailData>({
    queryKey: ["invoice-detail", invoiceId],
    queryFn: () => getInvoiceDetailFn({ data: { invoiceId } }),
  });

  if (!data) return null;
  const { invoice, payments, slip, returns, timeline } = data;

  const paidAmount = Number(invoice.paidAmount);
  const outstandingAmount = Number(invoice.outstandingAmount);
  const pendingAmount = payments
    .filter((payment: any) => payment.status === "pending")
    .reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
  const invoiceDiscount = Number(invoice.invoiceDiscount ?? 0);
  const isRetailerInvoice = invoice.customer?.customerType === "retailer";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
              <Link to="/sales/new-invoice" search={{ orderId: undefined }}>
                <ArrowLeft className="size-4 mr-1" />
                Back
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight font-mono">{invoice.invoiceNumber}</h1>
            <InvoiceStatusBadge status={invoice.paymentStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            Created {format(new Date(invoice.createdAt), "dd MMM yyyy HH:mm")} by{" "}
            {invoice.performer?.name ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/sales/reconciliation" search={{ slip: invoice.invoiceNumber ?? undefined }}>
              <Banknote className="size-4 mr-1.5" />
              Reconcile
            </Link>
          </Button>
          <Button variant="outline" size="sm">
            <Printer className="size-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Amount" value={PKR(Number(invoice.totalPrice))} icon={Receipt} theme="emerald" />
        <KpiCard label="Paid Amount" value={PKR(paidAmount)} icon={Banknote} theme="blue" />
        <KpiCard label="Pending Verification" value={PKR(pendingAmount)} icon={Clock} theme="violet" />
        <KpiCard label="Outstanding Amount" value={PKR(outstandingAmount)} icon={AlertTriangle} theme={outstandingAmount === 0 ? "emerald" : "rose"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="size-4" />
                Invoice Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Item</TableHead>
                      <TableHead className="text-[11px] text-right">Cartons</TableHead>
                      <TableHead className="text-[11px] text-right">Loose Units</TableHead>
                      <TableHead className="text-[11px] text-right">Price/Carton</TableHead>
                      <TableHead className="text-[11px] text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                {invoice.items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">
                          <div className="font-medium">{item.pack}</div>
                          {item.recipe?.name && (
                            <div className="text-xs text-muted-foreground">{item.recipe.name}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{item.numberOfCartons}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{PKR(Number(item.perCartonPrice))}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums font-medium">{PKR(Number(item.amount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Payments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Banknote className="size-4" />
                Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!payments.length ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <div className="space-y-3">
                  {payments.map((p: any) => (
                    <div key={p.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{paymentMethodLabel(p.method)}</p>
                          <Badge variant={paymentStatusVariant(p.status)}>
                            {paymentStatusLabel(p.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Destination: {p.wallet?.name ?? "No account"}
                        </p>
                        {p.reference && <p className="text-xs text-muted-foreground">Reference: {p.reference}</p>}
                        {p.method === "cheque" && (
                          <p className="text-xs text-muted-foreground">
                            {p.chequeBank} · Cheque {p.chequeNumber}
                          </p>
                        )}
                        {p.status === "returned" && (
                          <p className="text-xs text-destructive">Bank did not clear this cheque.</p>
                        )}
                        {p.resolutionReason && (
                          <p className="text-xs text-muted-foreground">Reason: {p.resolutionReason}</p>
                        )}
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Recorded: {formatPaymentDate(p.paymentDate)} by {p.recordedBy?.name ?? "—"}</p>
                        {p.effectiveDate && <p>Effective: {formatPaymentDate(p.effectiveDate)}</p>}
                        {p.confirmedAt && (
                          <p>Confirmed: {formatPaymentDate(p.confirmedAt)} by {p.confirmedBy?.name ?? "—"}</p>
                        )}
                        {p.resolvedAt && (
                          <p>Resolved: {formatPaymentDate(p.resolvedAt)} by {p.resolvedBy?.name ?? "—"}</p>
                        )}
                      </div>
                      <p className="text-sm font-semibold tabular-nums md:text-right">{PKR(Number(p.amount))}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="size-4" />
                Settlement Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Net Sale Amount</span>
                <span className="font-medium">{PKR(Number(invoice.amount))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Invoice Expense</span>
                <span className="font-medium text-amber-600">{Number(invoice.expenses) > 0 ? PKR(Number(invoice.expenses)) : "—"}</span>
              </div>
              {isRetailerInvoice && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium text-rose-600">{invoiceDiscount > 0 ? `- ${PKR(invoiceDiscount)}` : "—"}</span>
                </div>
              )}
              {isRetailerInvoice && invoice.invoiceDiscountDescription && (
                <div className="rounded-md bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-900">
                  {invoice.invoiceDiscountDescription}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Returns */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <RotateCcw className="size-4" />
                Returns / Credit Notes
              </CardTitle>
              <CreateReturnDialog invoiceId={invoice.id} items={invoice.items} returns={returns} />
            </CardHeader>
            <CardContent>
              {!returns.length ? (
                <p className="text-sm text-muted-foreground">No returns recorded.</p>
              ) : (
                <div className="space-y-3">
                  {returns.map((ret: any) => (
                    <div key={ret.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Return #{ret.returnNumber}</p>
                        <ReturnStatusBadge status={ret.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(ret.returnDate), "dd MMM yyyy")} · {ret.condition} · {ret.reason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ret.condition === "good"
                          ? "Approved good returns go back to sellable stock."
                          : `Approved ${ret.condition} returns go to segregated ${ret.condition} inventory.`}
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{PKR(Number(ret.totalAmount))}</p>
                      {!!ret.stockTraces.length && (
                        <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Stock Trace
                          </p>
                          {ret.stockTraces.map((trace: any) => (
                            <p key={trace.id} className="text-xs text-muted-foreground">
                              {trace.recipe?.name ?? "Recipe"}: moved {trace.cartonsMoved} cartons and{" "}
                              {trace.quantityMoved} loose units to {trace.destination} stock in{" "}
                              {trace.warehouse?.name ?? "the original warehouse"}.
                            </p>
                          ))}
                        </div>
                      )}
                      {ret.status === "pending" && (
                        <div className="flex items-center gap-2 pt-1">
                          <ProcessReturnButton invoiceId={invoice.id} returnId={ret.id} action="approve" />
                          <ProcessReturnButton invoiceId={invoice.id} returnId={ret.id} action="reject" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="size-4" />
                Invoice Timeline
              </CardTitle>
              <CardDescription>Chronological history of every event on this invoice.</CardDescription>
            </CardHeader>
            <CardContent>
              {!timeline.length ? (
                <p className="text-sm text-muted-foreground">No timeline events yet.</p>
              ) : (
                <Timeline>
                  {timeline.map((event: any, idx: number) => (
                    <TimelineItem key={event.id}>
                      {idx < timeline.length - 1 && <TimelineConnector />}
                      <TimelineHeader>
                        <TimelineIcon className={cn("border-none", eventColor(event.eventType))}>
                          {eventIcon(event.eventType)}
                        </TimelineIcon>
                        <TimelineContent>
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <TimelineTitle>{event.title}</TimelineTitle>
                            <time className="text-xs text-muted-foreground">
                              {format(new Date(event.eventDate), "dd MMM yyyy HH:mm")}
                              {" · "}
                              {formatDistanceToNow(new Date(event.eventDate), { addSuffix: true })}
                            </time>
                          </div>
                          {event.description && (
                            <TimelineDescription>{event.description}</TimelineDescription>
                          )}
                          {(event.actor?.name || event.actorName) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              By {event.actor?.name ?? event.actorName}
                            </p>
                          )}
                        </TimelineContent>
                      </TimelineHeader>
                    </TimelineItem>
                  ))}
                </Timeline>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="size-4" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium">{invoice.customer?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{invoice.customer?.customerType}</p>
              </div>
              {invoice.customer?.mobileNumber && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="size-3.5 text-muted-foreground" />
                  {invoice.customer.mobileNumber}
                </div>
              )}
              {invoice.customer?.city && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="size-3.5 text-muted-foreground" />
                  {invoice.customer.city}
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Pay-Later Limit</span>
                <span className="font-medium">{PKR(Number(invoice.customer?.creditLimit ?? 0))}</span>
              </div>
              {invoice.customer?.creditHold && (
                <Badge variant="destructive" className="text-[10px]">Pay-Later Hold</Badge>
              )}
            </CardContent>
          </Card>

          {/* Slip Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="size-4" />
                Slip / Recovery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <SlipStatusBadge status={slip?.status ?? "open"} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Recovery</span>
                <RecoveryStatusBadge status={slip?.recoveryStatus ?? null} />
              </div>
              {slip?.recoveryAssignedTo && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Assigned To</span>
                  <span className="font-medium">{slip.recoveryAssignedTo.name}</span>
                </div>
              )}
              {slip?.escalationLevel ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Escalation</span>
                  <Badge variant="outline" className="text-[10px]">L{slip.escalationLevel}</Badge>
                </div>
              ) : null}
              {invoice.paymentDueDate && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Payment Due Date</span>
                  <span className="font-medium">{format(new Date(invoice.paymentDueDate), "dd MMM yyyy")}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Salesman & Warehouse */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="size-4" />
                Logistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Salesman</span>
                <span className="font-medium">{invoice.salesman?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Warehouse</span>
                <span className="font-medium">{invoice.warehouse?.name ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Invoice Date</span>
                <span className="font-medium">{format(new Date(invoice.date), "dd MMM yyyy")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Small Components ───────────────────────────────────────────────────────

function paymentMethodLabel(method: string) {
  if (method === "bank_transfer") return "Bank Transfer";
  if (method === "cheque") return "Cheque";
  if (method === "expense_offset") return "Expense Offset";
  return "Cash";
}

function paymentStatusLabel(status: string) {
  if (status === "pending") return "Pending Verification";
  if (status === "returned") return "Cheque Returned";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function paymentStatusVariant(status: string) {
  if (status === "confirmed") return "default" as const;
  if (status === "pending") return "secondary" as const;
  if (status === "returned" || status === "reversed") return "destructive" as const;
  return "outline" as const;
}

function formatPaymentDate(value: string | Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd MMM yyyy, h:mm a");
}

function KpiCard({
  label,
  value,
  icon: Icon,
  theme,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  theme: "emerald" | "blue" | "rose" | "violet" | "amber";
}) {
  const styles = {
    emerald: "border-t-emerald-500 text-emerald-600 bg-emerald-500/10",
    blue: "border-t-blue-500 text-blue-600 bg-blue-500/10",
    rose: "border-t-rose-500 text-rose-600 bg-rose-500/10",
    violet: "border-t-violet-500 text-violet-600 bg-violet-500/10",
    amber: "border-t-amber-500 text-amber-600 bg-amber-500/10",
  };
  return (
    <Card className={cn("border-t-2", styles[theme].split(" ")[0])}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
          </div>
          <div className={cn("p-1.5 rounded-md", styles[theme].split(" ")[2])}>
            <Icon className={cn("size-4", styles[theme].split(" ")[1])} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    saved: { variant: "outline", label: "Saved" },
    paid: { variant: "default", label: "Paid" },
    partially_paid: { variant: "secondary", label: "Partial" },
    unpaid: { variant: "outline", label: "Unpaid" },
    voided: { variant: "destructive", label: "Voided" },
  };
  const cfg = map[status] ?? { variant: "outline", label: status };
  return (
    <Badge variant={cfg.variant} className="capitalize text-[10px]">
      {cfg.label}
    </Badge>
  );
}

function SlipStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    open: { variant: "outline", label: "Open" },
    partially_recovered: { variant: "secondary", label: "Partial" },
    closed: { variant: "default", label: "Closed" },
  };
  const cfg = map[status] ?? { variant: "outline", label: status.replace("_", " ") };
  return (
    <Badge variant={cfg.variant} className="capitalize text-[10px]">
      {cfg.label}
    </Badge>
  );
}

function RecoveryStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const styles: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
    pending: { variant: "outline", color: "text-yellow-600 border-yellow-300 bg-yellow-50" },
    in_progress: { variant: "secondary", color: "text-blue-600 border-blue-300 bg-blue-50" },
    partially_paid: { variant: "secondary", color: "text-orange-600 border-orange-300 bg-orange-50" },
    overdue: { variant: "destructive", color: "" },
    defaulted: { variant: "destructive", color: "dark:bg-red-950/30" },
  };
  const style = styles[status] ?? { variant: "outline", color: "" };
  return (
    <Badge variant={style.variant} className={cn("text-[10px] capitalize", style.color)}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function ProcessReturnButton({
  invoiceId,
  returnId,
  action,
}: {
  invoiceId: string;
  returnId: string;
  action: "approve" | "reject";
}) {
  const process = useProcessSalesReturn();
  return (
    <Button
      variant={action === "approve" ? "default" : "outline"}
      size="sm"
      className="h-7 text-xs"
      disabled={process.isPending}
      onClick={() =>
        process.mutate({
          invoiceId,
          returnId,
          action,
          notes: action === "reject" ? "Rejected from invoice detail" : undefined,
        })
      }
    >
      {process.isPending ? "..." : action === "approve" ? "Approve" : "Reject"}
    </Button>
  );
}

function ReturnStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    approved: "default",
    rejected: "destructive",
    completed: "secondary",
  };
  return (
    <Badge variant={map[status] ?? "outline"} className="text-[10px] capitalize">
      {status}
    </Badge>
  );
}

function eventColor(eventType: string) {
  switch (eventType) {
    case "created":
      return "bg-blue-500 text-white";
    case "payment":
      return "bg-emerald-500 text-white";
    case "closed":
      return "bg-emerald-600 text-white";
    case "status_change":
      return "bg-amber-500 text-white";
    case "overdue":
      return "bg-red-500 text-white";
    case "escalation":
      return "bg-orange-500 text-white";
    case "recovery_attempt":
      return "bg-violet-500 text-white";
    case "return":
      return "bg-pink-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function eventIcon(eventType: string) {
  const props = { className: "size-3.5" };
  switch (eventType) {
    case "created":
      return <Receipt {...props} />;
    case "payment":
      return <Banknote {...props} />;
    case "closed":
      return <CheckCircle2 {...props} />;
    case "status_change":
      return <Clock {...props} />;
    case "overdue":
      return <AlertTriangle {...props} />;
    case "escalation":
      return <ShieldAlert {...props} />;
    case "recovery_attempt":
      return <MessageSquare {...props} />;
    case "return":
      return <RotateCcw {...props} />;
    default:
      return <Clock {...props} />;
  }
}
