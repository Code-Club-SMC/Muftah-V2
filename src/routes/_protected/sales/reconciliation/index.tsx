import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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
  Smartphone,
  CheckSquare,
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

  const pendingAmount = Number((slip as any)?.pendingAmount ?? 0);
  const outstandingAmount = Number(slip?.outstandingAmount ?? 0);
  const unallocatedAmount =
    (slip as any)?.unallocatedAmount !== undefined
      ? Number((slip as any).unallocatedAmount)
      : Math.max(0, outstandingAmount - pendingAmount);

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
      method: "cash" | "bank_transfer" | "cheque";
      walletId?: string;
      reference?: string;
      chequeBank?: string;
      chequeNumber?: string;
      chequeDate?: Date;
      notes?: string;
      instantVerify?: boolean;
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
      form.reset();
      qc.invalidateQueries({ queryKey: ["slip-lookup"] });
      qc.invalidateQueries({ queryKey: ["slip-history"] });
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
      method: "cash" as "cash" | "bank_transfer" | "digital_wallet" | "cheque",
      walletId: wallets.find((w) => w.type === "cash")?.id ?? wallets[0]?.id ?? "",
      reference: "",
      senderBankName: "",
      senderAccountNumber: "",
      digitalProvider: "EasyPaisa",
      senderMobileNumber: "",
      chequeBank: "",
      chequeNumber: "",
      chequeDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      instantVerify: false,
    },
    onSubmit: async ({ value }) => {
      if (!slip) return;
      if (value.amount <= 0) {
        toast.error("Amount must be greater than zero");
        return;
      }
      if (unallocatedAmount > 0 && value.amount > unallocatedAmount) {
        toast.error(`Amount cannot exceed remaining collectible: ${PKR(unallocatedAmount)}`);
        return;
      }
      if (!value.walletId || value.walletId === "__none__") {
        toast.error(
          value.method === "cash"
            ? "Please select a cash deposit account"
            : "Please select a bank account",
        );
        return;
      }
      if (value.method === "bank_transfer") {
        if (!value.senderBankName?.trim()) {
          toast.error("Distributor bank name is required");
          return;
        }
        if (!value.senderAccountNumber?.trim()) {
          toast.error("Distributor account number / IBAN is required");
          return;
        }
        if (!value.reference?.trim()) {
          toast.error("Transaction reference / ID is required");
          return;
        }
      }
      if (value.method === "digital_wallet") {
        if (!value.digitalProvider?.trim()) {
          toast.error("Digital platform / provider is required");
          return;
        }
        if (!value.senderMobileNumber?.trim()) {
          toast.error("Sender mobile / account number is required");
          return;
        }
        if (!value.reference?.trim()) {
          toast.error("Transaction ID (TID) is required");
          return;
        }
      }
      if (value.method === "cheque") {
        if (!value.chequeBank?.trim()) {
          toast.error("Cheque bank name is required");
          return;
        }
        if (!value.chequeNumber?.trim()) {
          toast.error("Cheque number is required");
          return;
        }
        if (!value.chequeDate) {
          toast.error("Cheque date is required");
          return;
        }
      }

      const backendMethod: "cash" | "bank_transfer" | "cheque" =
        value.method === "digital_wallet"
          ? "bank_transfer"
          : value.method;

      let formattedNotes = value.notes?.trim() || undefined;
      if (value.method === "digital_wallet") {
        const prefix = `[${value.digitalProvider.trim()}] From: ${value.senderMobileNumber.trim()}`;
        formattedNotes = formattedNotes ? `${prefix} · ${formattedNotes}` : prefix;
      } else if (value.method === "bank_transfer") {
        const prefix = `From: ${value.senderBankName.trim()} (A/C: ${value.senderAccountNumber.trim()})`;
        formattedNotes = formattedNotes ? `${prefix} · ${formattedNotes}` : prefix;
      }

      await reconcileSlip({
        slipId: slip.id,
        amount: value.amount,
        method: backendMethod,
        walletId: value.walletId,
        reference: value.reference?.trim(),
        chequeBank: value.method === "cheque" ? value.chequeBank.trim() : undefined,
        chequeNumber: value.method === "cheque" ? value.chequeNumber.trim() : undefined,
        chequeDate: value.method === "cheque" && value.chequeDate ? new Date(value.chequeDate) : undefined,
        notes: formattedNotes,
        instantVerify: value.method !== "cash" ? Boolean(value.instantVerify) : undefined,
      });
    },
  });

  useEffect(() => {
    const currentMethod = form.getFieldValue("method");
    const currentWalletId = form.getFieldValue("walletId");
    const requiredType = currentMethod === "cash" ? "cash" : "bank";
    const eligible = wallets.filter(
      (w) => w.type === requiredType,
    );
    if (eligible.length > 0 && !eligible.some((w) => w.id === currentWalletId)) {
      form.setFieldValue("walletId", eligible[0].id);
    }
  }, [wallets, form]);

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
                    {pendingAmount > 0 && (
                      <div className="col-span-2 rounded border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-800 dark:bg-amber-950/20">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                            <Clock className="size-3.5 text-amber-600" />
                            Pending Verification
                          </span>
                          <span className="font-bold text-amber-700 dark:text-amber-300">
                            {PKR(pendingAmount)}
                          </span>
                        </div>
                        <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                          Recovery payment recorded. Awaiting finance confirmation.
                        </p>
                      </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "rounded-lg p-3 border",
                      outstandingAmount > 0
                        ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                        : "bg-green-50 dark:bg-green-950/20 border-green-200",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">
                          Outstanding Due
                        </p>
                        <p
                          className={cn(
                            "text-2xl font-bold tabular-nums",
                            outstandingAmount > 0
                              ? "text-red-700 dark:text-red-400"
                              : "text-green-700 dark:text-green-400",
                          )}
                        >
                          {PKR(outstandingAmount)}
                        </p>
                      </div>
                      {pendingAmount > 0 && (
                        <div className="text-right">
                          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            {PKR(pendingAmount)} unverified
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Collectible: {PKR(unallocatedAmount)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Reconcile form */}
              {slip.status === "closed" ? (
                <Card>
                  <CardContent className="pt-10 flex flex-col items-center gap-3 text-center">
                    <CheckCircle2 className="size-10 text-green-500" />
                    <p className="font-semibold">Slip Fully Closed</p>
                    <p className="text-sm text-muted-foreground">
                      All {PKR(Number(slip.paidAmount))} paid.
                    </p>
                  </CardContent>
                </Card>
              ) : unallocatedAmount === 0 && pendingAmount > 0 ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="size-4 text-amber-600" />
                      Payment Pending Verification
                    </CardTitle>
                    <CardDescription>
                      Full balance is covered by pending payment(s).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-2">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        Recovery Awaiting Finance Approval
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                        A payment of <strong>{PKR(pendingAmount)}</strong> has been recorded and is currently in the verification queue. The slip balance will be settled once verified by Finance.
                      </p>
                      <div className="pt-2">
                        <Button size="sm" variant="outline" className="h-8 text-xs border-amber-300 gap-1.5" asChild>
                          <Link to="/finance/payment-verification">
                            Open Payment Verification
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Record Payment</CardTitle>
                    <CardDescription>
                      Max collectible: {PKR(unallocatedAmount)}
                      {pendingAmount > 0 && ` (${PKR(pendingAmount)} pending verification)`}
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
                              max={unallocatedAmount}
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
                              onValueChange={(v: string) => {
                                const nextMethod = v as "cash" | "bank_transfer" | "digital_wallet" | "cheque";
                                field.handleChange(nextMethod);
                                form.setFieldValue("instantVerify", false);
                                const requiredType = nextMethod === "cash" ? "cash" : "bank";
                                const eligible = wallets.filter((w) => w.type === requiredType);
                                if (eligible.length > 0 && !eligible.some((w) => w.id === form.getFieldValue("walletId"))) {
                                  form.setFieldValue("walletId", eligible[0].id);
                                }
                              }}
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
                                <SelectItem value="digital_wallet">
                                  <span className="flex items-center gap-2">
                                    <Smartphone className="size-3.5 text-violet-500" />
                                    Digital Account (EasyPaisa / JazzCash / Raast)
                                  </span>
                                </SelectItem>
                                <SelectItem value="cheque">
                                  <span className="flex items-center gap-2">
                                    <CheckSquare className="size-3.5 text-amber-500" />
                                    Cheque
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="walletId">
                        {(field) => {
                          const currentMethod = form.getFieldValue("method");
                          const requiredType = currentMethod === "cash" ? "cash" : "bank";
                          const filteredWallets = wallets.filter(
                            (w) => w.type === requiredType,
                          );

                          const accountLabel =
                            currentMethod === "cash"
                              ? "Cash"
                              : currentMethod === "digital_wallet"
                                ? "Bank / Digital"
                                : "Bank";

                          return (
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium">
                                Deposit Account ({accountLabel})
                              </label>
                              <Select
                                value={field.state.value}
                                onValueChange={field.handleChange}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={`Select ${accountLabel.toLowerCase()} account`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {filteredWallets.length === 0 ? (
                                    <SelectItem value="__none__" disabled>
                                      No {accountLabel.toLowerCase()} accounts found
                                    </SelectItem>
                                  ) : (
                                    filteredWallets.map((w: Wallet) => (
                                      <SelectItem key={w.id} value={w.id}>
                                        <div className="flex flex-col text-left py-0.5">
                                          <span className="font-medium">{w.name}</span>
                                          {w.type === "bank" && (w.bankName || w.accountNumber) && (
                                            <span className="text-[10px] text-muted-foreground">
                                              {[w.bankName, w.accountNumber].filter(Boolean).join(" · ")}
                                            </span>
                                          )}
                                        </div>
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        }}
                      </form.Field>

                      {form.getFieldValue("method") === "bank_transfer" && (
                        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/10 p-3">
                          <p className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                            Bank Transfer Details
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <form.Field name="senderBankName">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Distributor Bank Name <span className="text-destructive">*</span>
                                  </label>
                                  <Input
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    placeholder="e.g. Meezan Bank, HBL, MCB"
                                    required
                                  />
                                </div>
                              )}
                            </form.Field>
                            <form.Field name="senderAccountNumber">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Distributor A/C # / IBAN <span className="text-destructive">*</span>
                                  </label>
                                  <Input
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    placeholder="e.g. PK36MEZN... or Account #"
                                    required
                                  />
                                </div>
                              )}
                            </form.Field>
                          </div>
                          <form.Field name="reference">
                            {(field) => (
                              <div className="space-y-1">
                                <label className="text-xs font-medium">
                                  Transaction Reference / ID <span className="text-destructive">*</span>
                                </label>
                                <Input
                                  value={field.state.value}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  placeholder="e.g. FT26081234"
                                  required
                                />
                              </div>
                            )}
                          </form.Field>
                        </div>
                      )}

                      {form.getFieldValue("method") === "digital_wallet" && (
                        <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/10 p-3">
                          <p className="text-xs font-semibold text-violet-900 dark:text-violet-300">
                            Digital Account Details
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <form.Field name="digitalProvider">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Platform / Provider <span className="text-destructive">*</span>
                                  </label>
                                  <Select
                                    value={field.state.value || "EasyPaisa"}
                                    onValueChange={field.handleChange}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select platform" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="EasyPaisa">EasyPaisa</SelectItem>
                                      <SelectItem value="JazzCash">JazzCash</SelectItem>
                                      <SelectItem value="Raast">Raast (Instant)</SelectItem>
                                      <SelectItem value="SadaPay">SadaPay</SelectItem>
                                      <SelectItem value="NayaPay">NayaPay</SelectItem>
                                      <SelectItem value="Other">Other Digital</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </form.Field>
                            <form.Field name="senderMobileNumber">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Sender Mobile / A/C # <span className="text-destructive">*</span>
                                  </label>
                                  <Input
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    placeholder="e.g. 0300-1234567"
                                    required
                                  />
                                </div>
                              )}
                            </form.Field>
                          </div>
                          <form.Field name="reference">
                            {(field) => (
                              <div className="space-y-1">
                                <label className="text-xs font-medium">
                                  Transaction ID (TID) <span className="text-destructive">*</span>
                                </label>
                                <Input
                                  value={field.state.value}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  placeholder="e.g. 2948291823"
                                  required
                                />
                              </div>
                            )}
                          </form.Field>
                        </div>
                      )}

                      {form.getFieldValue("method") === "cheque" && (
                        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/10 p-3">
                          <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">
                            Cheque Information
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <form.Field name="chequeBank">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Cheque Bank <span className="text-destructive">*</span>
                                  </label>
                                  <Input
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    placeholder="e.g. HBL, Meezan Bank"
                                    required
                                  />
                                </div>
                              )}
                            </form.Field>
                            <form.Field name="chequeNumber">
                              {(field) => (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">
                                    Cheque Number <span className="text-destructive">*</span>
                                  </label>
                                  <Input
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    placeholder="e.g. 10293847"
                                    required
                                  />
                                </div>
                              )}
                            </form.Field>
                          </div>
                          <form.Field name="chequeDate">
                            {(field) => (
                              <div className="space-y-1">
                                <label className="text-xs font-medium">
                                  Cheque Date <span className="text-destructive">*</span>
                                </label>
                                <Input
                                  type="date"
                                  value={field.state.value}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  required
                                />
                              </div>
                            )}
                          </form.Field>
                          <form.Field name="reference">
                            {(field) => (
                              <div className="space-y-1">
                                <label className="text-xs font-medium flex items-center justify-between">
                                  <span>Deposit Slip / Clearing Ref</span>
                                  <span className="text-muted-foreground font-normal">(optional)</span>
                                </label>
                                <Input
                                  value={field.state.value}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  placeholder="Deposit slip # or clearing ref"
                                />
                              </div>
                            )}
                          </form.Field>
                        </div>
                      )}

                      {form.getFieldValue("method") === "cash" && (
                        <form.Field name="reference">
                          {(field) => (
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium flex items-center justify-between">
                                <span>Receipt / Memo Reference</span>
                                <span className="text-muted-foreground font-normal">(optional)</span>
                              </label>
                              <Input
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder="Cash receipt number or memo"
                              />
                            </div>
                          )}
                        </form.Field>
                      )}

                      {form.getFieldValue("method") !== "cash" && (
                        <form.Field name="instantVerify">
                          {(field) => (
                            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 dark:border-emerald-500/30 dark:bg-emerald-950/10">
                              <input
                                type="checkbox"
                                id="slip-instant-verify"
                                checked={Boolean(field.state.value)}
                                onChange={(e) => field.handleChange(e.target.checked)}
                                className="mt-0.5 size-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              />
                              <label
                                htmlFor="slip-instant-verify"
                                className="flex flex-col cursor-pointer text-xs"
                              >
                                <span className="font-semibold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                                  Instant Verification (Confirmed in Bank / Account)
                                </span>
                                <span className="text-muted-foreground mt-0.5">
                                  Funds already verified received in company account. Skips the finance verification queue and settles the slip immediately.
                                </span>
                              </label>
                            </div>
                          )}
                        </form.Field>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button
                          type="submit"
                          className="flex-1"
                          disabled={reconciling || unallocatedAmount <= 0}
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
                          disabled={unallocatedAmount <= 0}
                          onClick={() => {
                            form.setFieldValue(
                              "amount",
                              unallocatedAmount,
                            );
                          }}
                        >
                          Full
                        </Button>
                      </div>
                    </form>
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
                          {history.payments.map((p: ReconcileHistoryPayment) => {
                            const isPending = p.status === "pending";
                            const isConfirmed = p.status === "confirmed";
                            const isCancelled = p.status === "cancelled" || p.status === "returned";

                            return (
                              <div
                                key={p.id}
                                className={cn(
                                  "flex items-center justify-between rounded-lg border p-3 transition-colors",
                                  isPending && "border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10",
                                  isCancelled && "border-muted bg-muted/20 opacity-75",
                                )}
                              >
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium capitalize">
                                      {p.method === "cheque"
                                        ? `Cheque #${p.chequeNumber || "—"}${p.chequeBank ? ` · ${p.chequeBank}` : ""}`
                                        : p.method.replace("_", " ")}
                                    </p>
                                    {isPending && (
                                      <Badge
                                        variant="outline"
                                        className="border-amber-300 bg-amber-50 text-[10px] px-1.5 py-0 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                      >
                                        Pending Verification
                                      </Badge>
                                    )}
                                    {isConfirmed && (
                                      <Badge
                                        variant="outline"
                                        className="border-emerald-300 bg-emerald-50 text-[10px] px-1.5 py-0 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                      >
                                        Confirmed
                                      </Badge>
                                    )}
                                    {isCancelled && (
                                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                        {p.status === "returned" ? "Cheque Returned" : "Cancelled"}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(p.paymentDate), "dd MMM yyyy HH:mm")} ·{" "}
                                    {p.recordedBy?.name ?? "—"}
                                  </p>
                                  {p.wallet?.name && (
                                    <p className="text-xs text-muted-foreground">
                                      Destination: <span className="font-medium text-foreground">{p.wallet.name}</span>
                                    </p>
                                  )}
                                  {p.method === "cheque" && p.chequeDate && (
                                    <p className="text-xs text-muted-foreground">
                                      Cheque Date: {format(new Date(p.chequeDate), "dd MMM yyyy")}
                                    </p>
                                  )}
                                  {p.reference && (
                                    <p className="text-xs text-muted-foreground font-mono">Ref: {p.reference}</p>
                                  )}
                                  {p.notes && (
                                    <p className="text-xs text-muted-foreground">Note: {p.notes}</p>
                                  )}
                                  {(p as any).resolutionReason && (
                                    <p className="text-xs text-destructive">
                                      Reason: {(p as any).resolutionReason}
                                    </p>
                                  )}
                                </div>
                                <div className="text-right">
                                  <p
                                    className={cn(
                                      "text-sm font-semibold tabular-nums",
                                      isPending && "text-amber-600 dark:text-amber-400",
                                      isConfirmed && "text-emerald-600 dark:text-emerald-500",
                                      isCancelled && "text-muted-foreground line-through",
                                    )}
                                  >
                                    {PKR(Number(p.amount))}
                                  </p>
                                  {isPending && (
                                    <p className="text-[10px] text-amber-600/90 dark:text-amber-400/90 font-medium">
                                      Unverified
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
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
