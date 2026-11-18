import Big from "big.js";
import { useState } from "react";
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
import { useByProducts, useCreateByProductSale, useVoidByProductSale } from "@/hooks/finance/use-by-products";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import { datePickerKey, formatReportDate, reportDateKey } from "@/lib/report-dates";
import { cn } from "@/lib/utils";

type SaleRow = NonNullable<ReturnType<typeof useByProducts>["data"]>["rows"][number];
type ByProduct = NonNullable<ReturnType<typeof useByProducts>["data"]>["byProducts"][number];

const MIN_REASON_LENGTH = 3;

export function ByProductsPage() {
  const [month, setMonth] = useState(() => reportDateKey(new Date()).slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<SaleRow | null>(null);
  const { data, isLoading, error } = useByProducts(month);
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
            + Record sale
          </Button>
        )}
      </div>

      {data && (
        data.byProducts.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            No by-products yet. Tick "By-product" on a purchase to start tracking its containers.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>By-product</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">In hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byProducts.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.earned}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.sold}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", row.inHand < 0 && "text-destructive")}>
                      {row.inHand}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load by-products. {error instanceof Error ? error.message : ""}
        </p>
      ) : isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No by-product sales this month.
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

      <RecordSaleSheet open={adding} onOpenChange={setAdding} byProducts={data?.byProducts ?? []} />
      <VoidSaleDialog row={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function RecordSaleSheet({
  open,
  onOpenChange,
  byProducts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  byProducts: ByProduct[];
}) {
  const [date, setDate] = useState(() => datePickerKey(new Date()));
  const [key, setKey] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");
  const { data: wallets = [] } = useWallets();
  const mutation = useCreateByProductSale();
  const selected = byProducts.find((row) => row.key === key);

  const amount = (() => {
    try {
      const value = new Big(quantity || 0).times(unitPrice || 0).round(2);
      return value.gt(0) ? value.toFixed(2) : null;
    } catch {
      return null;
    }
  })();
  const isDirty = key !== "" || unitPrice !== "" || note !== "";

  const reset = () => {
    setDate(datePickerKey(new Date()));
    setKey("");
    setQuantity("1");
    setUnitPrice("");
    setWalletId("");
    setNote("");
  };

  const save = () => {
    if (mutation.isPending) return;
    if (!selected) return void toast.error("Please pick the by-product");
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return void toast.error("Quantity must be a whole number");
    if (qty > selected.inHand) return void toast.error(`Only ${selected.inHand} in hand`);
    if (!amount) return void toast.error("Price must be above zero");
    if (!walletId) return void toast.error("Please pick the account");
    mutation.mutate(
      {
        data: {
          incomeDate: date,
          materialType: selected.materialType,
          materialId: selected.materialId,
          containerName: selected.containerName,
          containerSize: selected.containerSize,
          quantity: qty,
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
      title="Record by-product sale"
      description="Empty containers sold. You can sell only what is in hand."
      isDirty={isDirty && !mutation.isPending}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sale-date">Date</Label>
          <Input id="sale-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>By-product</Label>
          <Select value={key} onValueChange={setKey}>
            <SelectTrigger>
              <SelectValue placeholder="Pick by-product" />
            </SelectTrigger>
            <SelectContent>
              {byProducts.filter((row) => row.inHand > 0).map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label} · {row.inHand} in hand
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="sale-qty">Quantity</Label>
            <Input
              id="sale-qty"
              type="number"
              inputMode="numeric"
              min="1"
              max={selected?.inHand ?? undefined}
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sale-price">Price each</Label>
            <Input
              id="sale-price"
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
          <Label htmlFor="sale-note">Note</Label>
          <Textarea
            id="sale-note"
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

function VoidSaleDialog({ row, onClose }: { row: SaleRow | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useVoidByProductSale();

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
          <AlertDialogTitle>Void this sale?</AlertDialogTitle>
          <AlertDialogDescription>
            {row
              ? `${formatRupees(row.amount)} is taken back out of ${row.walletName ?? "its account"}. The entry stays in the list, struck through. This cannot be undone.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="sale-void-reason">Reason</Label>
          <Textarea
            id="sale-void-reason"
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
