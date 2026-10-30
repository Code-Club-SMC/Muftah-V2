import Big from "big.js";
import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { checkLotPicks, checkOldestFirst, defaultLotPicks, lotDateLabel, lotLabel, oldestFirstPicks, type LotBalance, type LotPick } from "@/lib/inventory/material-lots";

// Oldest-first is checked only once the picks are otherwise valid, so one problem shows at a time.
function pickErrors(input: { name: string; unit: string; required: string; picks: LotPick[]; balances: LotBalance[] }, oldestFirst: boolean) {
  const errors = checkLotPicks(input);
  return errors.length || !oldestFirst ? errors : checkOldestFirst(input);
}

export function lotPicksValid(required: string, picks: LotPick[], lots: LotBalance[], name: string, unit: string, oldestFirst = false) {
  return pickErrors({ name, unit, required, picks: picks.filter((pick) => pick.quantity !== ""), balances: lots }, oldestFirst).length === 0;
}

const samePicks = (a: LotPick[], b: LotPick[]) => a.length === b.length && a.every((pick) => b.some((other) => other.lotId === pick.lotId && other.quantity === pick.quantity));

// oldestFirst: mixing and packing. Pre-fills from the oldest lot, blocks a newer lot and hides prices.
export function LotPicker({ name, unit, required, lots, value, onChange, oldestFirst = false, hidePrices = false }: { name: string; unit: string; required: string; lots: LotBalance[]; value: LotPick[]; onChange: (picks: LotPick[]) => void; oldestFirst?: boolean; hidePrices?: boolean }) {
  const id = useId();
  const prefill = oldestFirst ? oldestFirstPicks : defaultLotPicks;
  const previousRequired = useRef(required);
  useEffect(() => {
    const before = previousRequired.current;
    previousRequired.current = required;
    const preset = prefill(required, lots);
    if (value.length === 0) {
      if (preset.length) onChange(preset);
      return;
    }
    // A pre-fill the operator left alone follows the new requirement.
    const stale = prefill(before, lots);
    const untouched = stale.length > 0 && samePicks(stale, value);
    if (before !== required && untouched) onChange(preset);
    // Pre-fill once per requirement or lot list change, never over the operator's input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, lots]);

  const filled = value.filter((pick) => pick.quantity !== "");
  const errors = pickErrors({ name, unit, required, picks: filled, balances: lots }, oldestFirst);
  let total = new Big(0);
  for (const pick of filled) { try { total = total.plus(pick.quantity); } catch { /* shown as an error */ } }

  function setQuantity(lotId: string, quantity: string) {
    const others = value.filter((pick) => pick.lotId !== lotId);
    onChange(quantity === "" ? others : [...others, { lotId, quantity }]);
  }

  if (!lots.length) return <p className="text-sm text-destructive">{`${name}: no stock in this store`}</p>;
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{`${name}: ${Number(required)} ${unit} needed`}</legend>
      {lots.map((lot) => {
        const label = `${oldestFirst || hidePrices ? lotDateLabel(lot, lots) : lotLabel(lot, unit)}, ${Number(lot.quantity)} ${unit} here`;
        return (
          <div key={lot.lotId} className="flex items-center justify-between gap-3">
            <label htmlFor={`${id}-${lot.lotId}`} className="min-w-0 text-sm">{label}</label>
            <Input id={`${id}-${lot.lotId}`} aria-label={label} type="number" inputMode="decimal" step="0.001" min="0" className="w-32"
              value={value.find((pick) => pick.lotId === lot.lotId)?.quantity ?? ""} onChange={(event) => setQuantity(lot.lotId, event.target.value)} />
          </div>
        );
      })}
      {errors.length === 0
        ? <p className="text-sm text-muted-foreground">{`Total ${total.toString()} of ${Number(required)} ${unit} ✓`}</p>
        : errors.map((error) => <p key={error} className="text-sm text-destructive">{error}</p>)}
    </fieldset>
  );
}
