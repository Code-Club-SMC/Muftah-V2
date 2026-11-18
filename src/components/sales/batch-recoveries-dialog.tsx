import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Banknote, Building2, Receipt, CheckCircle2, User, AlertCircle } from "lucide-react";
import { getOpenSlipsForRecoveryFn, batchReconcileSlipsFn } from "@/server-functions/sales/reconciliation-fn";
import { useWallets } from "@/hooks/finance/use-finance";
import { useGetOrderBookers } from "@/hooks/sales/use-sales-people";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

type OpenSlip = Awaited<ReturnType<typeof getOpenSlipsForRecoveryFn>>["slips"][number];

interface RecoveryEntry {
  slipId: string;
  slipNumber: string;
  customerId: string;
  customerName: string;
  customerCreditBalance: number;
  outstandingAmount: number;
  recoveryAmount: number;
}

export function BatchRecoveriesDialog() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, RecoveryEntry>>(new Map());
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "customer_credit">("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [orderBookerId, setOrderBookerId] = useState<string>("");
  const { data: walletsData } = useWallets();
  const wallets = walletsData ?? [];
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const qc = useQueryClient();

  const { data: orderBookers } = useGetOrderBookers("active");

  const effectiveOrderBookerId = orderBookerId === "all" ? "" : orderBookerId;

  const { data: slipsData, isLoading } = useQuery({
    queryKey: ["open-slips-for-recovery", effectiveOrderBookerId],
    queryFn: () => getOpenSlipsForRecoveryFn({ data: { page: 1, limit: 200, orderBookerId: effectiveOrderBookerId || undefined } }),
    enabled: open,
  });

  const slips = slipsData?.slips ?? [];
  const eligibleWallets = useMemo(
    () => {
      if (method === "customer_credit") return [];
      return wallets.filter((wallet) =>
        method === "cash" ? wallet.type === "cash" : wallet.type === "bank",
      );
    },
    [method, wallets],
  );

  useEffect(() => {
    if (method === "customer_credit") {
      setWalletId("");
      return;
    }
    if (!eligibleWallets.some((wallet) => wallet.id === walletId)) {
      setWalletId(eligibleWallets[0]?.id ?? "");
    }
  }, [eligibleWallets, walletId, method]);

  // Clear selected slips when order booker filter changes
  useEffect(() => {
    setSelected(new Map());
  }, [effectiveOrderBookerId]);

  const totalRecovery = useMemo(() => {
    let sum = 0;
    selected.forEach((entry) => {
      sum += entry.recoveryAmount;
    });
    return sum;
  }, [selected]);

  const customerCreditAllocations = useMemo(() => {
    const map = new Map<string, { customerName: string; requested: number; available: number }>();
    selected.forEach((entry) => {
      const existing = map.get(entry.customerId) ?? {
        customerName: entry.customerName,
        requested: 0,
        available: entry.customerCreditBalance,
      };
      existing.requested += entry.recoveryAmount;
      map.set(entry.customerId, existing);
    });
    return map;
  }, [selected]);

  const overAllocatedCustomers = useMemo(() => {
    if (method !== "customer_credit") return [];
    const list: Array<{ customerName: string; requested: number; available: number }> = [];
    customerCreditAllocations.forEach((info) => {
      if (info.requested > info.available) {
        list.push(info);
      }
    });
    return list;
  }, [customerCreditAllocations, method]);

  const { mutateAsync: batchReconcile, isPending } = useMutation({
    mutationFn: batchReconcileSlipsFn,
    onSuccess: (result) => {
      toast.success(
        `Recorded ${PKR(totalRecovery)} across ${result.results.length} invoice(s)`,
      );

      qc.invalidateQueries({ queryKey: ["open-slips-for-recovery"] });
      qc.invalidateQueries({ queryKey: ["overdue-slips"] });
      qc.invalidateQueries({ queryKey: ["daily-closing"] });
      qc.invalidateQueries({ queryKey: ["customer-credit"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["distributor-profile"] });
      qc.invalidateQueries({ queryKey: ["shopkeeper-profile"] });
      qc.invalidateQueries({ queryKey: ["distributor-ledger"] });
      qc.invalidateQueries({ queryKey: ["shopkeeper-ledger"] });
      setSelected(new Map());
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message ?? "Batch recovery failed"),
  });

  const toggleSlip = (slip: OpenSlip) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(slip.id)) {
        next.delete(slip.id);
      } else {
        next.set(slip.id, {
          slipId: slip.id,
          slipNumber: slip.slipNumber,
          customerId: slip.customerId,
          customerName: slip.customerName,
          customerCreditBalance: Number((slip as any).customerCreditBalance ?? 0),
          outstandingAmount: slip.outstandingAmount,
          recoveryAmount: slip.outstandingAmount,
        });
      }
      return next;
    });
  };

  const updateRecoveryAmount = (slipId: string, amount: number) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const entry = next.get(slipId);
      if (entry) {
        next.set(slipId, {
          ...entry,
          recoveryAmount: Math.min(amount, entry.outstandingAmount),
        });
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === slips.length) {
      setSelected(new Map());
    } else {
      const next = new Map<string, RecoveryEntry>();
      slips.forEach((s) => {
        next.set(s.id, {
          slipId: s.id,
          slipNumber: s.slipNumber,
          customerId: s.customerId,
          customerName: s.customerName,
          customerCreditBalance: Number((s as any).customerCreditBalance ?? 0),
          outstandingAmount: s.outstandingAmount,
          recoveryAmount: s.outstandingAmount,
        });
      });
      setSelected(next);
    }
  };

  const handleSubmit = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one slip");
      return;
    }
    if (method === "customer_credit" && overAllocatedCustomers.length > 0) {
      toast.error(
        `Cannot record recovery: Store credit exceeds available credit for ${overAllocatedCustomers.map((c) => c.customerName).join(", ")}.`,
      );
      return;
    }
    if (method !== "customer_credit" && !walletId) {
      toast.error("Select a destination account");
      return;
    }
    if (method === "bank_transfer" && !reference.trim()) {
      toast.error("Enter the bank reference");
      return;
    }

    const items = Array.from(selected.values()).map((entry) => ({
      slipId: entry.slipId,
      amount: entry.recoveryAmount,
    }));

    await batchReconcile({
      data: {
        items,
        method,
        walletId: method === "customer_credit" ? undefined : walletId || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Banknote className="size-4" />
          Recoveries
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            Batch Recoveries
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Order Booker Filter */}
          <div className="p-3 rounded-lg border bg-muted/30">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <User className="size-3" />
                Filter by Order Booker
              </label>
              <Select value={orderBookerId} onValueChange={setOrderBookerId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All order bookers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All order bookers</SelectItem>
                  {(orderBookers ?? []).map((ob: any) => (
                    <SelectItem key={ob.id} value={ob.id}>
                      {ob.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Payment settings */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/30">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Method</label>
              <Select value={method} onValueChange={(v) => setMethod(v as "cash" | "bank_transfer" | "customer_credit")}>
                <SelectTrigger className="h-9">
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
                  <SelectItem value="customer_credit">
                    <span className="flex items-center gap-2">
                      <Receipt className="size-3.5 text-purple-500" />
                      Store Credit
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method !== "customer_credit" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Deposit Account</label>
                <Select value={walletId} onValueChange={setWalletId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleWallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {method === "bank_transfer" ? "Bank Reference" : "Reference (optional)"}
              </label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "customer_credit" ? "Memo (optional)" : "Cheque / Tx ID"}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes..."
                className="h-9"
              />
            </div>
          </div>

          {overAllocatedCustomers.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Store Credit Over-allocated</p>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {overAllocatedCustomers.map((c) => (
                    <li key={c.customerName}>
                      {c.customerName}: Allocated {PKR(c.requested)} exceeds available credit {PKR(c.available)}.
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Slips table */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === slips.length && slips.length > 0}
                      onCheckedChange={selectAll}
                    />
                  </TableHead>
                  <TableHead className="text-[11px]">Slip</TableHead>
                  <TableHead className="text-[11px]">Customer</TableHead>
                  <TableHead className="text-[11px]">Order Booker</TableHead>
                  <TableHead className="text-[11px]">Date</TableHead>
                  <TableHead className="text-[11px]">Due Date</TableHead>
                  <TableHead className="text-[11px] text-right">Outstanding</TableHead>
                  <TableHead className="text-[11px] text-right w-32">Recover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(8)].map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : slips.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
                      No open slips to recover.
                    </TableCell>
                  </TableRow>
                ) : (
                  slips.map((slip) => {
                    const isSelected = selected.has(slip.id);
                    const entry = selected.get(slip.id);
                    const slipCredit = Number((slip as any).customerCreditBalance ?? 0);
                    return (
                      <TableRow key={slip.id} className={isSelected ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSlip(slip)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{slip.slipNumber}</TableCell>
                        <TableCell className="text-sm">
                          <span>{slip.customerName}</span>
                          {slipCredit > 0 && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              Credit: {PKR(slipCredit)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {slip.orderBookerName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {slip.invoiceDate ? format(new Date(slip.invoiceDate), "dd MMM yy") : "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-red-600">
                          {slip.paymentDueDate
                            ? format(new Date(slip.paymentDueDate), "dd MMM yy")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-right font-semibold text-red-600">
                          {PKR(slip.outstandingAmount)}
                        </TableCell>
                        <TableCell>
                          {isSelected ? (
                            <Input
                              type="number"
                              min={1}
                              max={slip.outstandingAmount}
                              value={entry?.recoveryAmount ?? slip.outstandingAmount}
                              onChange={(e) => updateRecoveryAmount(slip.id, Number(e.target.value))}
                              className="h-8 text-right text-sm"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm">
            <span className="text-muted-foreground">Selected: </span>
            <span className="font-semibold">{selected.size} slip(s)</span>
            {selected.size > 0 && (
              <>
                <span className="text-muted-foreground"> · Total: </span>
                <span className="font-bold text-emerald-600">{PKR(totalRecovery)}</span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selected.size === 0 || isPending || (method === "customer_credit" && overAllocatedCustomers.length > 0)}
              className="gap-2"
            >
              {isPending ? (
                <>Processing...</>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  Record {PKR(totalRecovery)}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
