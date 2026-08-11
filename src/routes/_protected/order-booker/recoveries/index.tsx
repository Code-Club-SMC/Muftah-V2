import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Banknote, RefreshCw, AlertCircle, ArrowRight } from "lucide-react";
import { formatPKR } from "@/lib/currency-format";
import { useMyRecoveries, useMyRecoveryAccounts, useRecordMyRecovery, orderBookerKeys } from "@/hooks/sales/use-order-booker-self-service";
import { getMyRecoveriesFn } from "@/server-functions/sales/order-booker-self-service-fn";
import { CustomerPagination } from "@/components/sales/customer-pagination";
import { format } from "date-fns";
import { toast } from "sonner";
import { ensureOrderBookerPortalRouteAccess } from "@/lib/order-booker/guards";

export const Route = createFileRoute("/_protected/order-booker/recoveries/")({
  loader: async ({ context }) => {
    await ensureOrderBookerPortalRouteAccess();
    await context.queryClient.ensureQueryData({
      queryKey: orderBookerKeys.recoveries({ page: 1, limit: 25 }),
      queryFn: () => getMyRecoveriesFn({ data: { page: 1, limit: 25 } }),
      staleTime: 30_000,
    });
  },
  component: MyRecoveriesPage,
});

function MyRecoveriesPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [status, setStatus] = useState<"outstanding" | "paid" | "all">("outstanding");

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useMyRecoveries({
    page,
    limit,
    status,
  });
  const { data: recoveryAccounts = [] } = useMyRecoveryAccounts();

  const recoveries = data?.data || [];
  const summary = data?.summary || { totalOutstanding: 0, totalCollected: 0, count: 0 };
  const meta = data?.meta || { total: 0, page: 1, limit: 25, totalPages: 1 };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Recoveries</h1>
        <div className="flex flex-col items-center justify-center py-20 bg-destructive/5 rounded-xl border border-destructive/20">
          <AlertCircle className="size-8 text-destructive mb-3" />
          <p className="text-sm font-semibold text-destructive">Failed to load recoveries</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
            <RefreshCw className="size-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recoveries</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          className="size-9"
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Banknote className="size-3.5 text-amber-600" />
              Total Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatPKR(summary.totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Collected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-emerald-600">{formatPKR(summary.totalCollected)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.count}</p>
          </CardContent>
        </Card>
      </div>

      {/* Status filter */}
      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => { setStatus(v as any); setPage(1); }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="outstanding">Outstanding</SelectItem>
              <SelectItem value="paid">Paid / Settled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : recoveries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-muted/10 rounded-xl border border-dashed border-border/50">
          <Banknote className="size-10 text-muted-foreground/30 mb-3" />
          <h3 className="font-semibold text-sm">No {status === "outstanding" ? "outstanding" : status === "paid" ? "paid" : ""} invoices</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            {status === "outstanding"
              ? "All your booked orders are fully paid. Outstanding recoveries will appear here."
              : "No invoices match this filter."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Invoice #</TableHead>
                <TableHead className="text-[11px]">Date</TableHead>
                <TableHead className="text-[11px]">Shopkeeper</TableHead>
                <TableHead className="text-[11px]">Order #</TableHead>
                <TableHead className="text-[11px] text-right">Total</TableHead>
                <TableHead className="text-[11px] text-right">Collected</TableHead>
                <TableHead className="text-[11px] text-right">Outstanding</TableHead>
                <TableHead className="text-[11px] w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recoveries.map((inv: any) => (
                <RecoveryRow key={inv.id} invoice={inv} accounts={recoveryAccounts} />
              ))}
            </TableBody>
          </Table>

          <div className="border-t border-border/40 px-4">
            <CustomerPagination
              page={page}
              pageCount={meta.totalPages}
              total={meta.total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RecoveryRow({ invoice, accounts }: { invoice: any; accounts: Array<{ id: string; name: string; type: string }> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque">("cash");
  const [walletId, setWalletId] = useState("");
  const [reference, setReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [notes, setNotes] = useState("");
  const recordRecovery = useRecordMyRecovery();

  const outstanding = Number(invoice.outstandingAmount) || 0;
  const total = Number(invoice.totalPrice) || 0;
  const collected = Number(invoice.paidAmount) || 0;
  const eligibleAccounts = accounts.filter((account) =>
    method === "cash" ? account.type === "cash" : account.type === "bank",
  );

  const handleSubmit = () => {
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!walletId) {
      toast.error("Select a destination account");
      return;
    }
    if (method === "bank_transfer" && !reference.trim()) {
      toast.error("Enter the bank reference");
      return;
    }
    if (method === "cheque" && (!chequeNumber.trim() || !chequeBank.trim() || !chequeDate)) {
      toast.error("Enter cheque number, bank, and date");
      return;
    }
    recordRecovery.mutate(
      {
        data: {
          invoiceId: invoice.id,
          amount: numAmount,
          method,
          walletId,
          reference: reference || undefined,
          chequeNumber: chequeNumber || undefined,
          chequeBank: chequeBank || undefined,
          chequeDate: chequeDate ? new Date(`${chequeDate}T12:00:00`) : undefined,
          notes: notes || undefined,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setAmount("");
          setReference("");
          setWalletId("");
          setChequeNumber("");
          setChequeBank("");
          setChequeDate("");
          setNotes("");
        },
      },
    );
  };

  return (
    <TableRow>
      <TableCell className="text-sm font-mono font-medium">{invoice.invoiceNumber || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {invoice.date ? format(new Date(invoice.date), "dd MMM yyyy") : "—"}
      </TableCell>
      <TableCell className="text-sm">{invoice.customer?.name || "—"}</TableCell>
      <TableCell className="text-sm font-mono">
        {invoice.order?.billNumber ? `#${invoice.order.billNumber}` : "—"}
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">{formatPKR(total)}</TableCell>
      <TableCell className="text-sm text-right tabular-nums text-emerald-600">{formatPKR(collected)}</TableCell>
      <TableCell className="text-sm text-right tabular-nums font-semibold text-amber-600">{formatPKR(outstanding)}</TableCell>
      <TableCell>
        {outstanding > 0 && (
          <Dialog open={open} onOpenChange={setOpen}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1 text-emerald-600 hover:text-emerald-700"
              onClick={() => setOpen(true)}
            >
              <ArrowRight className="size-3" /> Recover
            </Button>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Record Recovery</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="border rounded-lg p-3 bg-muted/10 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="font-mono font-medium">{invoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shopkeeper</span>
                    <span className="font-medium">{invoice.customer?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outstanding</span>
                    <span className="font-mono font-bold text-amber-600">{formatPKR(outstanding)}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (PKR)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={outstanding}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Max ${formatPKR(outstanding)}`}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Method</Label>
                  <Select value={method} onValueChange={(v) => { setMethod(v as typeof method); setWalletId(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Destination Account</Label>
                  <Select value={walletId} onValueChange={setWalletId}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {eligibleAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {method === "bank_transfer" && (
                  <div className="space-y-1.5">
                    <Label>Bank Reference</Label>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID" />
                  </div>
                )}
                {method === "cheque" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Cheque Number</Label><Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Bank</Label><Input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} /></div>
                    <div className="col-span-2 space-y-1.5"><Label>Cheque Date</Label><Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes..." />
                </div>
                <Button className="w-full" onClick={handleSubmit} disabled={recordRecovery.isPending}>
                  {recordRecovery.isPending ? "Recording…" : "Record Recovery"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </TableCell>
    </TableRow>
  );
}
