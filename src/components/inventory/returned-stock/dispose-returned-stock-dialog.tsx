import { useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWallets } from "@/hooks/finance/use-finance";
import { useScrapReturnedStock, useSellReturnedStock, type ReturnedStockRow } from "@/hooks/inventory/use-returned-stock";
import { formatRupees } from "@/lib/finance/expense-entry";
import { poolShare, secondsSaleAmount } from "@/lib/inventory/returned-stock";

export function DisposeReturnedStockDialog({ row, onClose }: { row: ReturnedStockRow; onClose: () => void }) {
  const [method, setMethod] = useState<"scrap" | "seconds">("scrap");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const scrap = useScrapReturnedStock();
  const sell = useSellReturnedStock();
  const wallets = useWallets({ enabled: method === "seconds" });
  const pending = scrap.isPending || sell.isPending;

  const packs = Number(units);
  let removed: string | null = null;
  let checkError = "";
  try {
    if (units) removed = poolShare({ units: row.units, value: row.value }, packs);
  } catch (err) { checkError = (err as Error).message; }
  const unitPrice = Number(price);
  const sale = method === "seconds" && removed && unitPrice > 0 ? secondsSaleAmount(packs, unitPrice) : null;
  // A seconds sale has no loss to show until its price is known.
  const loss = removed === null ? null
    : method === "scrap" ? removed
    : sale ? new Big(removed).minus(sale).toFixed(2) : null;
  const walletName = (wallets.data ?? []).find((wallet: { id: string }) => wallet.id === walletId)?.name;
  const valid = !!removed && !checkError && (method === "scrap" || (unitPrice > 0 && !!walletId));

  async function submit() {
    if (!valid || pending) return;
    setError("");
    const key = { warehouseId: row.warehouseId, recipeId: row.recipeId, condition: row.condition };
    try {
      if (method === "scrap") await scrap.mutateAsync({ ...key, units: packs, note: note.trim() || undefined });
      else await sell.mutateAsync({ ...key, units: packs, unitPrice, walletId, note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Your entries are kept.");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Dispose {row.condition} {row.recipeName}</DialogTitle>
            <DialogDescription>{row.units} packs at {row.warehouseName}, worth {formatRupees(row.value)} in stock.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={pending}>
            <FieldGroup>
              <RadioGroup value={method} onValueChange={value => setMethod(value as "scrap" | "seconds")} className="flex gap-6">
                <div className="flex items-center gap-2"><RadioGroupItem id="dispose-scrap" value="scrap" /><Label htmlFor="dispose-scrap">Scrap</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem id="dispose-seconds" value="seconds" /><Label htmlFor="dispose-seconds">Sell as seconds</Label></div>
              </RadioGroup>
              <Field>
                <Label htmlFor="dispose-units">Packs</Label>
                <Input id="dispose-units" type="number" min={1} max={row.units} step={1} value={units} onChange={event => setUnits(event.target.value)} />
              </Field>
              {method === "seconds" && (
                <>
                  <Field>
                    <Label htmlFor="dispose-price">Price per pack</Label>
                    <Input id="dispose-price" type="number" min={0.01} step="0.01" value={price} onChange={event => setPrice(event.target.value)} />
                  </Field>
                  <Field>
                    <Label htmlFor="dispose-wallet">Money goes into</Label>
                    <Select value={walletId} onValueChange={setWalletId}>
                      <SelectTrigger id="dispose-wallet" aria-label="Money goes into"><SelectValue placeholder="Pick the account" /></SelectTrigger>
                      <SelectContent>
                        {(wallets.data ?? []).map((wallet: { id: string; name: string }) => (
                          <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {wallets.isError && <p role="alert" className="text-sm text-destructive">Accounts could not be loaded: {wallets.error.message}</p>}
                  </Field>
                </>
              )}
              <Field>
                <Label htmlFor="dispose-note">Note</Label>
                <Textarea id="dispose-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
              </Field>
            </FieldGroup>
          </fieldset>
          {checkError && <p role="alert" className="text-sm text-destructive">{checkError}</p>}
          {loss !== null && !checkError && (
            <p className="text-sm">
              {sale && walletName ? `${formatRupees(sale)} goes into ${walletName}. ` : ""}
              {new Big(loss).lt(0) ? `Profit booked: ${formatRupees(new Big(loss).abs().toFixed(2))}` : `Loss booked: ${formatRupees(loss)}`}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Close</Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? "Saving..." : `${method === "scrap" ? "Scrap" : "Sell"} ${packs || ""} ${packs === 1 ? "pack" : "packs"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
