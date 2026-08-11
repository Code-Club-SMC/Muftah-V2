import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  lookupSlipFn,
  reconcileSlipFn,
  getOverdueSlipsFn,
  getDailyClosingSummaryFn,
  getSlipReconciliationHistoryFn,
} from "@/server-functions/sales/reconciliation-fn";
import { useGetRecoverySummary } from "@/hooks/sales/use-credit-recovery";
import { useWallets } from "@/hooks/finance/use-finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  Building2,
  ClipboardList,
  RefreshCw,
  AlertCircle,
  Clock,
  RotateCcw,
  Receipt,
  ShieldAlert,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

type ReconcileHistory = Awaited<ReturnType<typeof getSlipReconciliationHistoryFn>>;
type ReconcileHistoryPayment = ReconcileHistory["payments"][number];
type ReconcileHistoryTimelineEvent = ReconcileHistory["timeline"][number];
type OverdueSlips = Awaited<ReturnType<typeof getOverdueSlipsFn>>;
type OverdueSlip = OverdueSlips["slips"][number];
type DailyClosing = Awaited<ReturnType<typeof getDailyClosingSummaryFn>>;
type DailyPayment = DailyClosing["payments"][number];
type Wallet = NonNullable<Awaited<ReturnType<typeof useWallets>>["data"]>[number];

export const Route = createFileRoute(
  "/_protected/sales/reconciliation/",
)({
  component: ReconciliationPage,
});

function ReconciliationPage() {
  const qc = useQueryClient();
  const [slipSearch, setSlipSearch] = useState("");
  const [submittedSlip, setSubmittedSlip] = useState("");
  const { data: walletsData } = useWallets();
  const wallets = walletsData ?? [];
  const { data: recoverySummary } = useGetRecoverySummary();

  // ── Slip lookup ──────────────────────────────────────────────────────────
  const {
    data: slip,
    isFetching: slipLoading,
    isError: slipError,
    error: slipErrorObj,
  } = useQuery({
    queryKey: ["slip-lookup", submittedSlip],
    queryFn: () => lookupSlipFn({ data: { slipNumber: submittedSlip } }),
    enabled: !!submittedSlip,
    retry: false,
  });

  // ── Overdue slips ────────────────────────────────────────────────────────
  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ["overdue-slips"],
    queryFn: () => getOverdueSlipsFn({ data: { daysOverdue: 0, page: 1, limit: 50 } }),
  });

  // ── Daily closing ────────────────────────────────────────────────────────
  const { data: dailySummary, isLoading: dailyLoading } = useQuery({
    queryKey: ["daily-closing"],
    queryFn: () => getDailyClosingSummaryFn({ data: {} }),
  });

  // ── Slip reconciliation history (payments + timeline) ────────────────────
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["slip-history", slip?.id],
    queryFn: () => getSlipReconciliationHistoryFn({ data: { slipId: slip!.id } }),
    enabled: !!slip?.id,
  });

  // ── Reconcile mutation ───────────────────────────────────────────────────
  const { mutateAsync: reconcileSlip, isPending: reconciling } = useMutation({
    mutationFn: (payload: {
      slipId: string;
      amount: number;
      method: "cash" | "bank_transfer" | "expense_offset";
      walletId?: string;
      reference?: string;
      notes?: string;
    }) =>
      reconcileSlipFn({ data: payload }),
    onSuccess: (result) => {
      if (result.slipClosed) {
        toast.success("Slip fully reconciled and closed!");
      } else {
        toast.success(
          `Payment recorded. Remaining: ${PKR(result.remainingDue)}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["slip-lookup"] });
      qc.invalidateQueries({ queryKey: ["overdue-slips"] });
      qc.invalidateQueries({ queryKey: ["daily-closing"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setSubmittedSlip(slip?.slipNumber ?? "");
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to reconcile"),
  });

  // ── Reconcile form ───────────────────────────────────────────────────────
  const form = useForm({
    defaultValues: {
      amount: 0,
      method: "cash" as "cash" | "bank_transfer",
      walletId: wallets[0]?.id ?? "",
      reference: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      if (!slip) return;
      await reconcileSlip({
        slipId: slip.id,
        amount: value.amount,
        method: value.method,
        walletId: value.walletId,
        reference: value.reference,
        notes: value.notes,
      });
    },
  });

  const handleSlipSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (slipSearch.trim()) setSubmittedSlip(slipSearch.trim().toUpperCase());
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Slip Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record payments against invoices with an Outstanding Amount. Search by slip number,
          confirm amount, and close.
        </p>
      </div>

      {/* Recovery Alert Banner */}
      {recoverySummary?.dueToday ? (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
          <AlertCircle className="size-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {recoverySummary.dueToday} slip{recoverySummary.dueToday > 1 ? "s" : ""} due today
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300" asChild>
            <Link to="/sales/recovery">Go to Outstanding Recovery</Link>
          </Button>
        </div>
      ) : null}

      <Tabs defaultValue="reconcile" className="w-full">
        <TabsList>
          <TabsTrigger value="reconcile" className="gap-2">
            <Search className="size-3.5" /> Reconcile Slip
          </TabsTrigger>
          <TabsTrigger value="overdue" className="gap-2">
            <AlertTriangle className="size-3.5" /> Overdue
            {overdueData?.total ? (
              <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                {overdueData.total}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-2">
            <ClipboardList className="size-3.5" /> Daily Closing
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════ RECONCILE TAB */}
        <TabsContent value="reconcile" className="mt-6 space-y-6">
          {/* Slip search */}
          <form onSubmit={handleSlipSearch} className="flex gap-2 max-w-md">
            <Input
              placeholder="Enter slip number e.g. INV-42"
              value={slipSearch}
              onChange={(e) => setSlipSearch(e.target.value.toUpperCase())}
              className="font-mono"
            />
            <Button type="submit" disabled={!slipSearch.trim() || slipLoading}>
              {slipLoading ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
            </Button>
          </form>

          {/* Slip error */}
          {slipError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              {(slipErrorObj as any)?.message ?? "Slip not found"}
            </div>
          )}

          {/* Slip preview */}
          {slip && (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Slip details card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold font-mono">
                      {slip.slipNumber}
                    </CardTitle>
                    <Badge
                      variant={
                        slip.status === "closed"
                          ? "outline"
                          : slip.status === "partially_recovered"
                            ? "secondary"
                            : "destructive"
                      }
                      className="capitalize text-[10px]"
                    >
                      {slip.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <CardDescription>
                    {slip.customer?.name} — {slip.customer?.city ?? "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Issued</p>
                      <p className="font-medium">
                        {format(new Date(slip.issuedAt), "dd MMM yyyy")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Salesman</p>
                      <p className="font-medium">
                        {slip.salesman?.name ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Total Invoice
                      </p>
                      <p className="font-semibold">
                        {PKR(Number(slip.invoice?.totalPrice))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Already Recovered
                      </p>
                      <p className="font-semibold text-green-600">
                        {PKR(Number(slip.paidAmount))}
                      </p>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-lg p-3 border",
                      Number(slip.outstandingAmount) > 0
                        ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                        : "bg-green-50 dark:bg-green-950/20 border-green-200",
                    )}
                  >
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Outstanding Due
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        Number(slip.outstandingAmount) > 0
                          ? "text-red-700"
                          : "text-green-700",
                      )}
                    >
                      {PKR(Number(slip.outstandingAmount))}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Reconcile form */}
              {slip.status !== "closed" ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Record Payment</CardTitle>
                    <CardDescription>
                      Max: {PKR(Number(slip.outstandingAmount))}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        form.handleSubmit();
                      }}
                      className="space-y-4"
                    >
                      <form.Field name="amount">
                        {(field) => (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Amount (PKR)
                            </label>
                            <Input
                              type="number"
                              min="1"
                              max={Number(slip.outstandingAmount)}
                              step="1"
                              value={field.state.value || ""}
                              onChange={(e) =>
                                field.handleChange(Number(e.target.value))
                              }
                            />
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="method">
                        {(field) => (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">Method</label>
                            <Select
                              value={field.state.value}
                              onValueChange={(v: string) =>
                                field.handleChange(v as "cash" | "bank_transfer")
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">
                                  <span className="flex items-center gap-2">
                                    <Banknote className="size-3.5 text-emerald-500" />
                                    Cash
                                  </span>
                                </SelectItem>
                                <SelectItem value="bank_transfer">
                                  <span className="flex items-center gap-2">
                                    <Building2 className="size-3.5 text-blue-500" />
                                    Bank Transfer
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="walletId">
                        {(field) => (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Deposit Account
                            </label>
                            <Select
                              value={field.state.value}
                              onValueChange={field.handleChange}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select account" />
                              </SelectTrigger>
                              <SelectContent>
                                {wallets.map((w: Wallet) => (
                                  <SelectItem key={w.id} value={w.id}>
                                    {w.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="reference">
                        {(field) => (
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">
                              Reference (optional)
                            </label>
                            <Input
                              value={field.state.value}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                              placeholder="Cheque / Tx ID"
                            />
                          </div>
                        )}
                      </form.Field>

                      <div className="flex gap-2 pt-2">
                        <Button
                          type="submit"
                          className="flex-1"
                          disabled={reconciling}
                        >
                          {reconciling ? (
                            <RefreshCw className="mr-2 size-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 size-4" />
                          )}
                          Confirm Payment
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            form.setFieldValue(
                              "amount",
                              Number(slip.outstandingAmount),
                            );
                          }}
                        >
                          Full
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-10 flex flex-col items-center gap-3 text-center">
                    <CheckCircle2 className="size-10 text-green-500" />
                    <p className="font-semibold">Slip Fully Closed</p>
                    <p className="text-sm text-muted-foreground">
                      All {PKR(Number(slip.paidAmount))} paid.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Reconciliation History */}
          {slip && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="size-4" />
                  Reconciliation History
                </CardTitle>
                <CardDescription>
                  Payments and events recorded against {slip.slipNumber}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !history?.timeline.length && !history?.payments.length ? (
                  <p className="text-sm text-muted-foreground">No history yet.</p>
                ) : (
                  <div className="grid lg:grid-cols-2 gap-6">
                    {/* Payments */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Payments</h4>
                      {!history?.payments.length ? (
                        <p className="text-sm text-muted-foreground">No payments recorded.</p>
                      ) : (
                        <div className="space-y-2">
                          {history.payments.map((p: ReconcileHistoryPayment) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between rounded-lg border p-3"
                            >
                              <div className="space-y-0.5">
                                <p className="text-sm font-medium capitalize">
                                  {p.method.replace("_", " ")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(p.paymentDate), "dd MMM yyyy HH:mm")} ·{" "}
                                  {p.recordedBy?.name ?? "—"}
                                </p>
                                {p.reference && (
                                  <p className="text-xs text-muted-foreground">Ref: {p.reference}</p>
                                )}
                              </div>
                              <p className="text-sm font-semibold tabular-nums text-emerald-600">
                                {PKR(Number(p.amount))}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Timeline */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Event Timeline</h4>
                      {!history?.timeline.length ? (
                        <p className="text-sm text-muted-foreground">No events recorded.</p>
                      ) : (
                        <Timeline>
                          {history.timeline.map((event: ReconcileHistoryTimelineEvent, idx: number) => (
                            <TimelineItem key={event.id}>
                              {idx < history.timeline.length - 1 && <TimelineConnector />}
                              <TimelineHeader>
                                <TimelineIcon className={cn("border-none", eventColor(event.eventType))}>
                                  {eventIcon(event.eventType)}
                                </TimelineIcon>
                                <TimelineContent>
                                  <TimelineTitle>{event.title}</TimelineTitle>
                                  {event.description && (
                                    <TimelineDescription>{event.description}</TimelineDescription>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {format(new Date(event.eventDate), "dd MMM yyyy HH:mm")}
                                    {event.actor?.name ? ` · ${event.actor.name}` : null}
                                  </p>
                                </TimelineContent>
                              </TimelineHeader>
                            </TimelineItem>
                          ))}
                        </Timeline>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════ OVERDUE TAB */}
        <TabsContent value="overdue" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Invoices past their Payment Due Date with an Outstanding Amount.
            </p>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Slip</TableHead>
                  <TableHead className="text-[11px]">Customer</TableHead>
                  <TableHead className="text-[11px]">Salesman</TableHead>
                  <TableHead className="text-[11px]">Issued</TableHead>
                  <TableHead className="text-[11px]">Due Date</TableHead>
                  <TableHead className="text-[11px] text-right">Due</TableHead>
                  <TableHead className="text-[11px] text-right">
                    Recovered
                  </TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px]">Recovery</TableHead>
                  <TableHead className="text-[11px]">Assigned</TableHead>
                  <TableHead className="text-[11px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(11)].map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !overdueData?.slips?.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      No overdue slips. All caught up!
                    </TableCell>
                  </TableRow>
                ) : (
                  overdueData.slips.map((s: OverdueSlip) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        {s.slipNumber}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.customer?.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.salesman?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {format(new Date(s.issuedAt), "dd MMM yy")}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-red-600 font-medium">
                        {s.invoice?.paymentDueDate
                          ? format(new Date(s.invoice.paymentDueDate), "dd MMM yy")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-red-600 font-semibold">
                        {PKR(Number(s.outstandingAmount))}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-green-600">
                        {PKR(Number(s.paidAmount))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.status === "partially_recovered"
                              ? "secondary"
                              : "destructive"
                          }
                          className="text-[10px] capitalize"
                        >
                          {s.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.recoveryStatus ? (
                          <Badge
                            variant={
                              s.recoveryStatus === "overdue" || s.recoveryStatus === "defaulted"
                                ? "destructive"
                                : s.recoveryStatus === "in_progress"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-[10px] capitalize"
                          >
                            {s.recoveryStatus.replace("_", " ")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.recoveryAssignedTo?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setSlipSearch(s.slipNumber);
                            setSubmittedSlip(s.slipNumber);
                          }}
                        >
                          Reconcile
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════ DAILY CLOSING TAB */}
        <TabsContent value="daily" className="mt-6 space-y-6">
          {dailyLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : dailySummary ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Total Collected
                  </p>
                  <p className="text-xl font-bold tabular-nums text-emerald-600">
                    {PKR(dailySummary.totalCollected)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Cash
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {PKR(dailySummary.totalCash)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Bank Transfer
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {PKR(dailySummary.totalBankTransfer)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Slips Closed Today
                  </p>
                  <p className="text-xl font-bold tabular-nums text-violet-600">
                    {dailySummary.slipsClosedToday}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">Time</TableHead>
                      <TableHead className="text-[11px]">Customer</TableHead>
                      <TableHead className="text-[11px]">Method</TableHead>
                      <TableHead className="text-[11px]">Reference</TableHead>
                      <TableHead className="text-[11px] text-right">
                        Amount
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!dailySummary.payments.length ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center py-10 text-sm text-muted-foreground"
                        >
                          No payments recorded today.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dailySummary.payments.map((p: DailyPayment) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs tabular-nums">
                            {format(new Date(p.paymentDate), "HH:mm")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {p.customer?.name ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm capitalize">
                            {p.method.replace("_", " ")}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.reference ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right font-semibold text-green-600">
                            {PKR(Number(p.amount))}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
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
      return <TrendingUp {...props} />;
  }
}
