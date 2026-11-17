import Big from "big.js";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthSelector } from "@/components/ui/month-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useWallets } from "@/hooks/finance/use-finance";
import {
  useCreateOtherIncome,
  useOtherIncome,
  useOtherIncomeItemNames,
  useVoidOtherIncome,
} from "@/hooks/finance/use-other-income";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import { datePickerKey, formatReportDate, reportDateKey } from "@/lib/report-dates";
import { cn } from "@/lib/utils";

type IncomeRow = NonNullable<ReturnType<typeof useOtherIncome>["data"]>["rows"][number];

const MIN_REASON_LENGTH = 3;

export function OtherIncomePage() {
  const [month, setMonth] = useState(() => reportDateKey(new Date()).slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<IncomeRow | null>(null);
  const { data, isLoading, error } = useOtherIncome(month);
  const { data: access } = useViewerAccess();
  const canManage = hasPermission(access?.permissions ?? [], "finance.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelector value={month} onChange={setMonth} />
        <p className="text-sm text-muted-foreground">
          Total this month:{" "}
          <span className="font-semibold text-foreground">{data ? formatRupees(data.total) : "—"}</span>
        </p>
        {canManage && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            + Add income
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load income. {error instanceof Error ? error.message : ""}
        </p>
      ) : isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No other income recorded this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>By</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const voided = row.voidedAt !== null;
                return (
                  <TableRow key={row.id} className={cn(voided && "text-muted-foreground")}>
                    <TableCell>{formatReportDate(row.incomeDate)}</TableCell>
                    <TableCell>
                      <span className={cn(voided && "line-through")}>{row.itemName}</span>
                      {voided && <p className="text-xs">Voided: {row.voidReason}</p>}
                      {!voided && row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(row.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupees(row.unitPrice)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", voided && "line-through")}>
                      {formatRupees(row.amount)}
                    </TableCell>
                    <TableCell>{row.walletName ?? "—"}</TableCell>
                    <TableCell>{row.recordedBy ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {!voided && (
                          <Button variant="ghost" size="sm" onClick={() => setVoiding(row)}>
                            Void
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddOtherIncomeSheet open={adding} onOpenChange={setAdding} />
      <VoidOtherIncomeDialog row={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function AddOtherIncomeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const listId = useId();
  const [date, setDate] = useState(() => datePickerKey(new Date()));
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");
  const { data: wallets = [] } = useWallets();
  const { data: itemNames = [] } = useOtherIncomeItemNames();
  const mutation = useCreateOtherIncome();

  const amount = (() => {
    try {
      const value = new Big(quantity || 0).times(unitPrice || 0).round(2);
      return value.gt(0) ? value.toFixed(2) : null;
    } catch {
      return null;
    }
  })();
  const isDirty = itemName !== "" || unitPrice !== "" || note !== "";

  const reset = () => {
    setDate(datePickerKey(new Date()));
    setItemName("");
    setQuantity("1");
    setUnitPrice("");
    setWalletId("");
    setNote("");
  };

  const save = () => {
    if (mutation.isPending) return;
    if (!itemName.trim()) return void toast.error("Please enter the item");
    if (!amount) return void toast.error("Quantity and price must be above zero");
    if (!walletId) return void toast.error("Please pick the account");
    mutation.mutate(
      {
        data: {
          incomeDate: date,
          itemName,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          walletId,
          note: note.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add income"
      description="Money received that is not a sale, like empty drums sold."
      isDirty={isDirty && !mutation.isPending}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="income-date">Date</Label>
          <Input id="income-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="income-item">Item</Label>
          <Input
            id="income-item"
            list={listId}
            value={itemName}
            maxLength={120}
            placeholder="e.g. SLES drum"
            onChange={(e) => setItemName(e.target.value)}
          />
          <datalist id={listId}>
            {itemNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="income-qty">Quantity</Label>
            <Input
              id="income-qty"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-price">Price each</Label>
            <Input
              id="income-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>
        </div>
        <p className="text-sm">
          Amount: <span className="font-semibold">{amount ? formatRupees(amount) : "—"}</span>
        </p>
        <div className="space-y-2">
          <Label>Received in</Label>
          <Select value={walletId} onValueChange={setWalletId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick account" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((wallet) => (
                <SelectItem key={wallet.id} value={wallet.id}>
                  {wallet.name} · {formatRupees(wallet.balance)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="income-note">Note</Label>
          <Textarea
            id="income-note"
            value={note}
            maxLength={500}
            placeholder="e.g. Sold to scrap dealer"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function VoidOtherIncomeDialog({ row, onClose }: { row: IncomeRow | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useVoidOtherIncome();

  const confirm = () => {
    if (!row || mutation.isPending) return;
    if (reason.trim().length < MIN_REASON_LENGTH) return void toast.error("Please give a reason");
    mutation.mutate(
      { data: { id: row.id, reason: reason.trim() } },
      {
        onSuccess: () => {
          setReason("");
          onClose();
        },
      },
    );
  };

  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        if (!next) {
          setReason("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this income?</AlertDialogTitle>
          <AlertDialogDescription>
            {row
              ? `${formatRupees(row.amount)} is taken back out of ${row.walletName ?? "its account"}. The entry stays in the list, struck through. This cannot be undone.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="income-void-reason">Reason</Label>
          <Textarea
            id="income-void-reason"
            value={reason}
            maxLength={500}
            placeholder="e.g. Entered twice by mistake"
            onChange={(e) => setReason(e.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={mutation.isPending}>
            {mutation.isPending ? "Voiding…" : "Void"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
