import { useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetReturnedStockValue, type ReturnedStockRow } from "@/hooks/inventory/use-returned-stock";
import { formatRupees } from "@/lib/finance/expense-entry";
import { writeDownAmount } from "@/lib/inventory/returned-stock";

export function SetReturnedStockValueDialog({ row, onClose }: { row: ReturnedStockRow; onClose: () => void }) {
  const [valuePerPack, setValuePerPack] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const setValue = useSetReturnedStockValue();
  const currentPerPack = row.units > 0 ? new Big(row.value).div(row.units).toFixed(2) : "0.00";

  let preview: { newValue: string; writeDown: string } | null = null;
  let checkError = "";
  try {
    if (valuePerPack !== "") preview = writeDownAmount({ units: row.units, value: row.value }, Number(valuePerPack));
  } catch (err) { checkError = (err as Error).message; }
  const valid = !!preview && note.trim().length >= 3;

  async function submit() {
    if (!valid || setValue.isPending) return;
    setError("");
    try {
      await setValue.mutateAsync({
        warehouseId: row.warehouseId, recipeId: row.recipeId, condition: row.condition,
        valuePerPack: Number(valuePerPack), note: note.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Your entries are kept.");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !setValue.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Set value: {row.condition} {row.recipeName}</DialogTitle>
            <DialogDescription>
              {row.units} packs at {row.warehouseName}, now {formatRupees(currentPerPack)} a pack ({formatRupees(row.value)} in total). Value can only be lowered.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={setValue.isPending}>
            <FieldGroup>
              <Field>
                <Label htmlFor="value-per-pack">Value per pack</Label>
                <Input id="value-per-pack" type="number" min={0} step="0.01" value={valuePerPack} onChange={event => setValuePerPack(event.target.value)} />
              </Field>
              <Field>
                <Label htmlFor="value-note">Why</Label>
                <Textarea id="value-note" minLength={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
              </Field>
            </FieldGroup>
          </fieldset>
          {checkError && <p role="alert" className="text-sm text-destructive">{checkError}</p>}
          {preview && <p className="text-sm">Loss booked: {formatRupees(preview.writeDown)}. New stock value: {formatRupees(preview.newValue)}.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={setValue.isPending} onClick={onClose}>Close</Button>
            <Button type="submit" disabled={!valid || setValue.isPending}>{setValue.isPending ? "Saving..." : "Lower value"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
