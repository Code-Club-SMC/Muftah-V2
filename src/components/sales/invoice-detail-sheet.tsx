import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useGetInvoiceDetail, useDeleteInvoice } from "@/hooks/sales/use-invoices";
import { invoicesKeys } from "@/hooks/sales/use-invoices";
import {
  FileText,
  Calendar,
  MapPin,
  User,
  Package,
  DollarSign,
  Trash2,
  AlertCircle,
  Loader2,
  Edit,
  X,
  Clock,
  Banknote,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
  MessageSquare,
  Receipt,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreateInvoiceForm } from "./create-invoice-form";
import { InvoiceTypeBadge } from "./invoice-type-badge";
import { useState } from "react";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const formatMeasureValue = (value: number) =>
  value.toLocaleString("en-PK", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });

const getDispatchedUnits = (item: any) => {
  const savedDispatchedUnits = Number(item.dispatchedUnits) || 0;
  if (savedDispatchedUnits > 0) return savedDispatchedUnits;

  const packsPerCarton = Number(item.actualPackSize || item.packsPerCarton) || 1;
  const totalCartons =
    (Number(item.numberOfCartons) || 0) +
    (Number(item.discountCartons) || 0) +
    (Number(item.freeCartons) || 0);

  return totalCartons * packsPerCarton + (Number(item.quantity) || 0);
};

const getChargedUnits = (item: any) => {
  const savedChargedUnits = Number(item.chargedUnits) || 0;
  if (savedChargedUnits > 0) return savedChargedUnits;

  const packsPerCarton = Number(item.actualPackSize || item.packsPerCarton) || 1;
  const billedCartons = Number(item.numberOfCartons) || 0;
  return billedCartons > 0 ? billedCartons * packsPerCarton : Number(item.quantity) || 0;
};

const getLineSaleMeasure = (item: any) => {
  const dispatchedUnits = getDispatchedUnits(item);
  const fillAmount = Number(item.fillAmountSnapshot) || 0;
  const fillUnit = item.fillUnitSnapshot ? String(item.fillUnitSnapshot) : null;

  if (!(fillAmount > 0) || !fillUnit || dispatchedUnits <= 0) {
    return null;
  }

  if (fillUnit === "ml") {
    return `${formatMeasureValue(roundMoney((dispatchedUnits * fillAmount) / 1000))} L`;
  }

  if (fillUnit === "L") {
    return `${formatMeasureValue(roundMoney(dispatchedUnits * fillAmount))} L`;
  }

  if (fillUnit === "g") {
    return `${formatMeasureValue(roundMoney((dispatchedUnits * fillAmount) / 1000))} kg`;
  }

  if (fillUnit === "kg") {
    return `${formatMeasureValue(roundMoney(dispatchedUnits * fillAmount))} kg`;
  }

  return null;
};

const buildInvoiceSaleSummary = (items: any[]) => {
  const totals = new Map<string, number>();
  const totalDispatchedUnits = items.reduce(
    (sum, item) => sum + getDispatchedUnits(item),
    0,
  );

  for (const item of items) {
    const dispatchedUnits = getDispatchedUnits(item);
    const fillAmount = Number(item.fillAmountSnapshot) || 0;
    const fillUnit = item.fillUnitSnapshot ? String(item.fillUnitSnapshot) : null;

    if (!(fillAmount > 0) || !fillUnit || dispatchedUnits <= 0) continue;

    if (fillUnit === "ml") {
      totals.set("L", (totals.get("L") || 0) + (dispatchedUnits * fillAmount) / 1000);
      continue;
    }

    if (fillUnit === "L") {
      totals.set("L", (totals.get("L") || 0) + dispatchedUnits * fillAmount);
      continue;
    }

    if (fillUnit === "g") {
      totals.set("kg", (totals.get("kg") || 0) + (dispatchedUnits * fillAmount) / 1000);
      continue;
    }

    if (fillUnit === "kg") {
      totals.set("kg", (totals.get("kg") || 0) + dispatchedUnits * fillAmount);
    }
  }

  const measureParts = Array.from(totals.entries()).map(
    ([unit, amount]) => `${formatMeasureValue(roundMoney(amount))} ${unit}`,
  );

  if (measureParts.length === 0) {
    return `${totalDispatchedUnits.toLocaleString("en-PK")} units dispatched`;
  }

  return `${totalDispatchedUnits.toLocaleString("en-PK")} units dispatched · ${measureParts.join(" + ")}`;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  onPrint: () => void;
}

export const InvoiceDetailSheet = ({ open, onOpenChange, invoiceId, onPrint }: Props) => {
  return (
    <ResponsiveSheet
      title="Invoice Detail"
      description="Full invoice information and line items"
      open={open}
      onOpenChange={onOpenChange}
      className="lg:min-w-[70vw]"
      icon={FileText}
    >
      {invoiceId ? (
        <InvoiceDetailContent
          invoiceId={invoiceId}
          onPrint={onPrint}
          onOpenChange={onOpenChange}
        />
      ) : (
        <div className="space-y-4 py-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </ResponsiveSheet>
  );
};

const InvoiceDetailContent = ({
  invoiceId,
  onPrint,
  onOpenChange,
}: {
  invoiceId: string;
  onPrint: () => void;
  onOpenChange: (open: boolean) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const { data, isLoading, isError, error } = useGetInvoiceDetail(invoiceId);
  const invoice = data?.invoice;
  const timeline = data?.timeline;

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertCircle className="size-12 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {error?.message || "Failed to load invoice details"}
        </p>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    );
  }

  if (!invoice) return null;

  if (isEditing) {
    return (
      <div className="py-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold">Edit Invoice</h1>
            <p className="text-xs text-muted-foreground">Modify items, prices, notes, or Payment Due Date</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} className="gap-1" aria-label="Cancel editing invoice">
            <X className="size-3.5" aria-hidden="true" />
            Cancel Edit
          </Button>
        </div>
        <CreateInvoiceForm
          initialData={{ ...invoice, payments: data?.payments ?? [] }}
          onSuccess={() => {
            setIsEditing(false);
            // onSuccess handled by hook invalidation
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  const paidAmount = Number(invoice.paidAmount);
  const outstandingAmount = Number(invoice.outstandingAmount);
  const pendingAmount = (data?.payments ?? [])
    .filter((payment: any) => payment.status === "pending")
    .reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
  const total = Number(invoice.totalPrice);
  const expenses = Number(invoice.expenses) || 0;
  const invoiceDiscount = Number(invoice.invoiceDiscount) || 0;
  const isRetailerInvoice = invoice.customer?.customerType === "retailer";

  const getLineGrossAmount = (item: any) => {
    const billedCartons = Number(item.numberOfCartons) || 0;
    const looseUnits = Number(item.quantity) || 0;
    const packsPerCarton = Number(item.actualPackSize || item.packsPerCarton) || 1;
    const perCartonPrice = Number(item.perCartonPrice) || 0;

    if (billedCartons > 0) {
      return roundMoney(billedCartons * perCartonPrice);
    }

    return roundMoney(looseUnits * (perCartonPrice / Math.max(1, packsPerCarton)));
  };

  const grossItemsTotal = roundMoney(
    (invoice.items ?? []).reduce((sum: number, item: any) => sum + getLineGrossAmount(item), 0),
  );
  const netItemsTotal = roundMoney(
    (invoice.items ?? []).reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0),
  );

  const totalProfitBeforeDiscount = roundMoney((invoice.items ?? []).reduce((sum: number, item: any) => {
    const chargedUnits = getChargedUnits(item);
    const unitMargin = Number(item.margin);
    const fallbackProfit = (Number(item.amount) || 0) - (Number(item.costOfGoodsSold) || 0);
    const lineProfit = Number(item.costOfGoodsSold) > 0
      ? fallbackProfit
      : (Number.isFinite(unitMargin) ? chargedUnits * unitMargin : fallbackProfit);

    return sum + lineProfit;
  }, 0));
  const totalProfit = roundMoney(totalProfitBeforeDiscount - invoiceDiscount);
  const roundedDisplayProfit = Math.round(totalProfit);
  const invoiceSaleSummary = buildInvoiceSaleSummary(invoice.items ?? []);

  const statusLabel = invoice.paymentStatus === "paid"
    ? "Paid"
    : invoice.paymentStatus === "partially_paid"
      ? "Partially Paid"
      : "Unpaid";
  const statusVariant = invoice.paymentStatus === "paid" ? "default" : "outline";

  return (
    <div className="space-y-5 py-4">
      {/* Header info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Date</p>
            <p className="text-sm font-medium">
              {invoice.date && !isNaN(new Date(invoice.date).getTime())
                ? format(new Date(invoice.date), "dd MMM yyyy")
                : "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <User className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Customer</p>
            <p className="text-sm font-medium">{invoice.customer?.name || "N/A"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Warehouse</p>
            <p className="text-sm font-medium">{invoice.warehouse?.name || "N/A"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Total</p>
            <p className="text-sm font-bold">{PKR(total)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Invoice Expense</p>
            <p className="text-sm font-medium">{expenses > 0 ? PKR(expenses) : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Package className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Sale Quantity</p>
            <p className="text-sm font-medium">{invoiceSaleSummary}</p>
          </div>
        </div>
        {isRetailerInvoice && (
          <div className="flex items-center gap-2">
            <DollarSign className="size-4 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Discount</p>
              <p className="text-sm font-medium">{invoiceDiscount > 0 ? PKR(invoiceDiscount) : ""}</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <DollarSign className={cn("size-4", totalProfit >= 0 ? "text-emerald-600" : "text-destructive")} aria-hidden="true" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Total Profit</p>
            <p className={cn("text-sm font-bold", totalProfit >= 0 ? "text-emerald-600" : "text-destructive")}>
              {PKR(roundedDisplayProfit)}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice Type */}
      <div className="flex items-center gap-2">
        <InvoiceTypeBadge customerType={invoice.customer?.customerType || "retailer"} />
        <Badge variant={statusVariant as any} className="capitalize text-xs">
          {statusLabel}
        </Badge>
      </div>

      {/* Payment breakdown */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        {[
          ["Total Amount", total],
          ["Paid Amount", paidAmount],
          ["Pending Verification", pendingAmount],
          ["Outstanding Amount", outstandingAmount],
        ].map(([label, value]) => (
          <div key={label} className="bg-card p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
            <p className="text-lg font-bold tabular-nums">{PKR(Number(value))}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Payments ({data?.payments?.length ?? 0})</h2>
        </div>
        {!data?.payments?.length ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No payment recorded. The full invoice remains outstanding.
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-lg border">
            {data.payments.map((payment: any) => (
              <div key={payment.id} className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto] md:items-start">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{paymentMethodLabel(payment.method)}</p>
                    <Badge variant={paymentStatusVariant(payment.status)}>
                      {paymentStatusLabel(payment.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Destination: {payment.wallet?.name ?? "No account"}
                  </p>
                  {payment.reference && (
                    <p className="text-xs text-muted-foreground">Reference: {payment.reference}</p>
                  )}
                  {payment.method === "cheque" && (
                    <p className="text-xs text-muted-foreground">
                      {payment.chequeBank} · Cheque {payment.chequeNumber}
                    </p>
                  )}
                  {payment.status === "returned" && (
                    <p className="text-xs text-destructive">Bank did not clear this cheque.</p>
                  )}
                  {payment.resolutionReason && (
                    <p className="text-xs text-muted-foreground">Reason: {payment.resolutionReason}</p>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Recorded: {formatPaymentDate(payment.paymentDate)}</p>
                  {payment.effectiveDate && <p>Effective: {formatPaymentDate(payment.effectiveDate)}</p>}
                  {payment.confirmedAt && (
                    <p>
                      Confirmed: {formatPaymentDate(payment.confirmedAt)} by {payment.confirmedBy?.name ?? "—"}
                    </p>
                  )}
                  {payment.resolvedAt && (
                    <p>
                      Resolved: {formatPaymentDate(payment.resolvedAt)} by {payment.resolvedBy?.name ?? "—"}
                    </p>
                  )}
                </div>
                <p className="text-base font-bold tabular-nums md:text-right">
                  {PKR(Number(payment.amount))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {invoice.remarks && (
        <div className="p-3 bg-muted/20 rounded-lg">
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Remarks</p>
          <p className="text-sm">{invoice.remarks}</p>
        </div>
      )}
      {isRetailerInvoice && invoice.invoiceDiscountDescription && (
        <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
          <p className="text-[10px] text-rose-700 uppercase mb-1">Discount Note</p>
          <p className="text-sm text-rose-900">{invoice.invoiceDiscountDescription}</p>
        </div>
      )}

      {/* Line items table */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Package className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Line Items ({invoice.items?.length || 0})</h2>
          <Badge variant="outline" className="text-[10px]">
            {invoiceSaleSummary}
          </Badge>
        </div>
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">#</TableHead>
                <TableHead className="text-[11px]">Product</TableHead>
                <TableHead className="text-[11px] text-right">Cartons</TableHead>
                <TableHead className="text-[11px] text-right">Disc. Ctns</TableHead>
                <TableHead className="text-[11px] text-right">Units</TableHead>
                <TableHead className="text-[11px] text-right">Packs/Ctn</TableHead>
                <TableHead className="text-[11px] text-right">Dispatched Units</TableHead>
                <TableHead className="text-[11px] text-right">Price/Ctn</TableHead>
                <TableHead className="text-[11px] text-right">Gross Amount</TableHead>
                <TableHead className="text-[11px] text-right">Net Amount</TableHead>
                <TableHead className="text-[11px] text-right">Profit</TableHead>
                <TableHead className="text-[11px] text-right">Weight (kg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items?.map((item: any, i: number) => {
                const ppc = Number(item.actualPackSize || item.packsPerCarton) || 0;
                const billedCtns = Number(item.numberOfCartons) || 0;
                const discCtns = (Number(item.discountCartons) || 0) + (Number(item.freeCartons) || 0);
                const looseUnits = Number(item.quantity) || 0;
                const dispatchedUnits = getDispatchedUnits(item);
                const chargedUnits = getChargedUnits(item);
                const lineSaleMeasure = getLineSaleMeasure(item);
                const unitMargin = Number(item.margin);
                const lineProfit = roundMoney(Number(item.costOfGoodsSold) > 0
                  ? (Number(item.amount) || 0) - (Number(item.costOfGoodsSold) || 0)
                  : (Number.isFinite(unitMargin)
                    ? chargedUnits * unitMargin
                    : (Number(item.amount) || 0) - (Number(item.costOfGoodsSold) || 0)));
                const grossAmount = getLineGrossAmount(item);
                return (
                <TableRow key={item.id || i}>
                  <TableCell className="text-sm tabular-nums">{i + 1}</TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{item.pack}</div>
                    {lineSaleMeasure && (
                      <div className="text-[10px] text-muted-foreground">{lineSaleMeasure}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{billedCtns || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">
                    {discCtns > 0 ? (
                      <span className="text-amber-600 font-semibold">+{discCtns}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{looseUnits || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">
                    {ppc > 0 ? ppc : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right font-semibold">
                    {dispatchedUnits}
                    {ppc > 0 && discCtns > 0 && (
                      <span className="text-[10px] text-amber-600 ml-1">
                        ({discCtns * ppc} scheme)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{PKR(Number(item.perCartonPrice))}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right font-semibold">{PKR(grossAmount)}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right font-semibold">{PKR(Number(item.amount))}</TableCell>
                  <TableCell className={cn("text-sm tabular-nums text-right", lineProfit >= 0 ? "text-emerald-600" : "text-destructive")}>
                    {PKR(lineProfit)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{Number(item.totalWeight).toFixed(2)}</TableCell>
                </TableRow>
                );
              })}
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell colSpan={7} className="text-right text-sm">Totals</TableCell>
                <TableCell className="text-sm text-right">—</TableCell>
                <TableCell className="text-sm text-right font-bold">{PKR(grossItemsTotal)}</TableCell>
                <TableCell className="text-sm text-right font-bold">{PKR(netItemsTotal)}</TableCell>
                <TableCell className={cn("text-sm text-right font-bold", totalProfit >= 0 ? "text-emerald-600" : "text-destructive")}>
                  {PKR(roundedDisplayProfit)}
                </TableCell>
                <TableCell className="text-sm text-right">
                  {invoice.items?.reduce((acc: number, item: any) => acc + Number(item.totalWeight), 0).toFixed(2)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Timeline</h2>
        </div>
        {!timeline || timeline.length === 0 ? (
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
                        {event.eventDate && !isNaN(new Date(event.eventDate).getTime())
                          ? <>
                              {format(new Date(event.eventDate), "dd MMM yyyy HH:mm")}
                              {" · "}
                              {formatDistanceToNow(new Date(event.eventDate), { addSuffix: true })}
                            </>
                          : "—"}
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
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <DeleteInvoiceButton
          invoiceId={invoiceId}
          onSuccess={() => onOpenChange(false)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="gap-1"
        >
          <Edit className="size-3.5" />
          Edit
        </Button>
        <Button size="sm" onClick={onPrint} className="gap-1">
          <FileText className="size-3.5" />
          Print
        </Button>
      </div>
    </div>
  );
};

// ── Isolated delete button with its own mutation state ──
const DeleteInvoiceButton = ({ invoiceId, onSuccess }: { invoiceId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();
  const { mutate, isPending } = useDeleteInvoice();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        mutate(invoiceId, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: invoicesKeys.list({}) });
            queryClient.invalidateQueries({ queryKey: invoicesKeys.stats() });
            onSuccess();
          },
          onError: (err: any) => {
            toast.error(err.message || "Failed to delete invoice");
          },
        });
      }}
      disabled={isPending}
      className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Trash2 className="size-3.5" />
      )}
      {isPending ? "Deleting..." : "Delete"}
    </Button>
  );
};

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
