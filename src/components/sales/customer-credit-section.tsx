import { format } from "date-fns";
import { ArrowDownLeft, Banknote, RotateCcw, Wallet } from "lucide-react";
import { useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { OverdrawConfirmDialog } from "@/components/finance/overdraw-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useWallets } from "@/hooks/finance/use-finance";
import {
  useCustomerCreditSummary,
  useIssueCustomerRefund,
  useReverseCustomerRefund,
} from "@/hooks/sales/use-customer-credit";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
import {
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  parseAmountInput,
} from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";

interface Props {
  customerId: string;
  customerName?: string;
}

export function CustomerCreditSection({ customerId, customerName }: Props) {
  const { data: viewer } = useViewerAccess();
  const permissions = viewer?.permissions ?? [];
  const canIssueRefund =
    hasPermission(permissions, "finance.refunds.issue") ||
    hasPermission(permissions, "finance.manage");
  const canReverseRefund =
    hasPermission(permissions, "finance.payments.reverse") ||
    hasPermission(permissions, "finance.manage");

  const { data: summary, isLoading } = useCustomerCreditSummary(customerId);
  const [refundOpen, setRefundOpen] = useState(false);
  const [walletId, setWalletId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [refundDate, setRefundDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [overdrawOpen, setOverdrawOpen] = useState(false);

  const [reversingRefundId, setReversingRefundId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState("");

  const walletsQuery = useWallets({ enabled: refundOpen });
  const issueMutation = useIssueCustomerRefund(customerId);
  const reverseMutation = useReverseCustomerRefund(customerId);

  const creditBalance = Number(summary?.creditBalance ?? 0);
  const activeWallets = (walletsQuery.data ?? []).filter((w: any) => !w.archived);
  const selectedWallet = activeWallets.find((w: any) => w.id === walletId);
  const parsedAmount = parseAmountInput(amountInput);

  const openRefundDialog = () => {
    setWalletId("");
    setAmountInput(creditBalance > 0 ? String(creditBalance) : "");
    setRefundDate(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setFormError("");
    setRefundOpen(true);
  };

  const submitRefund = async (allowOverdraw: boolean) => {
    setFormError("");
    if (!walletId) {
      setFormError("Pick a company account.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter a positive refund amount.");
      return;
    }
    if (parsedAmount > creditBalance) {
      setFormError(`Refund amount cannot exceed store credit (${formatRupees(creditBalance)}).`);
      return;
    }
    try {
      await issueMutation.mutateAsync({
        customerId,
        amount: parsedAmount,
        walletId,
        refundDate: new Date(`${refundDate}T12:00:00`),
        notes: notes.trim() || undefined,
        allowOverdraw,
      });
      setOverdrawOpen(false);
      setRefundOpen(false);
    } catch (err) {
      if (isOverdrawConfirmError(err)) {
        setOverdrawOpen(true);
        return;
      }
      setFormError(err instanceof Error ? err.message : "Failed to issue refund");
    }
  };

  const submitReverse = async () => {
    if (!reversingRefundId) return;
    setReverseError("");
    if (reverseReason.trim().length < 3) {
      setReverseError("Give a reason (at least 3 characters).");
      return;
    }
    try {
      await reverseMutation.mutateAsync({
        refundId: reversingRefundId,
        reason: reverseReason.trim(),
      });
      setReversingRefundId(null);
      setReverseReason("");
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : "Failed to reverse refund");
    }
  };

  if (isLoading) {
    return <Skeleton className="h-44 w-full rounded-xl" />;
  }

  const lots = summary?.lots ?? [];
  const refunds = summary?.refunds ?? [];
  const movements = summary?.movements ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-emerald-600" />
            Store Credit & Refunds
          </CardTitle>
          <CardDescription>
            FIFO credit balance available for future invoices or cash/bank payouts.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Available Store Credit
            </p>
            <p className="text-xl font-bold tabular-nums text-emerald-600">
              {formatRupees(creditBalance)}
            </p>
          </div>
          {canIssueRefund && creditBalance > 0 && (
            <Button type="button" size="sm" onClick={openRefundDialog} className="gap-1.5">
              <Banknote className="size-4" />
              Issue Refund
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!!lots.length && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Credit Lots ({lots.length})
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Date</TableHead>
                    <TableHead className="text-[11px]">Source / Credit Note</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px] text-right">Original</TableHead>
                    <TableHead className="text-[11px] text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lots.map((lot: any) => (
                    <TableRow key={lot.id}>
                      <TableCell className="text-xs tabular-nums">
                        {format(new Date(lot.createdAt), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono font-medium">
                          {lot.creditNoteNumber ?? lot.sourceType.replace("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={lot.status === "active" ? "default" : "outline"}
                          className="text-[10px] capitalize"
                        >
                          {lot.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatRupees(lot.originalAmount)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {formatRupees(lot.remainingAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!!refunds.length && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Cash / Bank Refunds ({refunds.length})
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Date</TableHead>
                    <TableHead className="text-[11px]">Account</TableHead>
                    <TableHead className="text-[11px]">Credit Note</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                    <TableHead className="text-[11px] text-right">Amount</TableHead>
                    <TableHead className="text-[11px] text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {refunds.map((refund: any) => (
                    <TableRow key={refund.id}>
                      <TableCell className="text-xs tabular-nums">
                        {format(new Date(refund.refundDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-xs">{refund.wallet?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{refund.creditNoteNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={refund.status === "active" ? "default" : "destructive"}
                          className="text-[10px] capitalize"
                        >
                          {refund.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {formatRupees(refund.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canReverseRefund && refund.status === "active" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setReversingRefundId(refund.id);
                              setReverseReason("");
                              setReverseError("");
                            }}
                          >
                            <RotateCcw className="mr-1 size-3" />
                            Reverse refund
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!!movements.length && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Audit Trail ({movements.length})
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Date</TableHead>
                    <TableHead className="text-[11px]">Event</TableHead>
                    <TableHead className="text-[11px]">Reference</TableHead>
                    <TableHead className="text-[11px] text-right">Amount</TableHead>
                    <TableHead className="text-[11px] text-right">Balance After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((mov: any) => (
                    <TableRow key={mov.id}>
                      <TableCell className="text-xs tabular-nums">
                        {format(new Date(mov.createdAt), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        <span className="inline-flex items-center gap-1">
                          <ArrowDownLeft className="size-3 text-muted-foreground" />
                          {(mov.movementType ?? mov.type ?? "").replaceAll("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {mov.creditNoteNumber || mov.notes || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {formatRupees(mov.amount)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {formatRupees(mov.balanceAfter)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!lots.length && !refunds.length && !movements.length && (
          <p className="text-xs text-muted-foreground">
            No store credit activity recorded for {customerName ?? "this customer"}.
          </p>
        )}
      </CardContent>

      <ResponsiveDialog
        title="Issue Customer Refund"
        description={`Return unused store credit (${formatRupees(creditBalance)} available) from a company account.`}
        open={refundOpen}
        onOpenChange={setRefundOpen}
        icon={Banknote}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitRefund(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="customer-refund-wallet">Refund account</Label>
            <Select value={walletId} onValueChange={setWalletId}>
              <SelectTrigger id="customer-refund-wallet" aria-label="Refund account">
                <SelectValue placeholder="Choose cash or bank account" />
              </SelectTrigger>
              <SelectContent>
                {activeWallets.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({formatRupees(w.balance)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer-refund-amount">Refund amount</Label>
              <Input
                id="customer-refund-amount"
                value={amountInput}
                onChange={(e) => setAmountInput(formatAmountInput(e.target.value))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-refund-date">Refund date</Label>
              <Input
                id="customer-refund-date"
                type="date"
                value={refundDate}
                onChange={(e) => setRefundDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-refund-notes">Notes (optional)</Label>
            <Input
              id="customer-refund-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Receipt / transfer note"
            />
          </div>
          {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={issueMutation.isPending}>
              Confirm refund
            </Button>
          </div>
        </form>
      </ResponsiveDialog>

      <OverdrawConfirmDialog
        open={overdrawOpen}
        onOpenChange={setOverdrawOpen}
        walletName={selectedWallet?.name ?? "Selected account"}
        balance={String(selectedWallet?.balance ?? "0")}
        balanceAfter={getBalanceAfter(
          selectedWallet?.balance ?? "0",
          Number.isFinite(parsedAmount) ? parsedAmount : 0,
        )}
        onConfirm={() => void submitRefund(true)}
        pending={issueMutation.isPending}
        descriptionLabel="refund"
      />

      <ResponsiveDialog
        title="Reverse Customer Refund"
        description="Restores the company account balance and credits the store credit lot back to active."
        open={Boolean(reversingRefundId)}
        onOpenChange={(o) => {
          if (!o && !reverseMutation.isPending) setReversingRefundId(null);
        }}
        icon={RotateCcw}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitReverse();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="reverse-refund-reason">Reversal reason</Label>
            <Textarea
              id="reverse-refund-reason"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              minLength={3}
              maxLength={500}
              placeholder="Why is this refund being reversed?"
            />
          </div>
          {reverseError && <p role="alert" className="text-xs text-destructive">{reverseError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReversingRefundId(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={reverseMutation.isPending}>
              Confirm reversal
            </Button>
          </div>
        </form>
      </ResponsiveDialog>
    </Card>
  );
}
