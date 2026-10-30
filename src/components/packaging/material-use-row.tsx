import Big from "big.js";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PACKING_REASONS, SHOPPER_OVER_WARNING, checkPiecesUse, shopperNumbers } from "@/lib/production/material-use";

export type MaterialUseDraft = { used: string; reason: string; note: string };
type RowInput = { name: string; measuredInKg: boolean; needed: string; gramsPerShopper: string | null; value: MaterialUseDraft | undefined };

const count = (value: number) => value.toLocaleString("en-US");

// What the lot picks must add up to. Shoppers have no default: the operator weighs them.
export function usedFor({ measuredInKg, needed, value }: { measuredInKg: boolean; needed: string; value: MaterialUseDraft | undefined }) {
  if (measuredInKg) return value?.used ?? "";
  return value?.used || new Big(needed).toString();
}

function shopperFor(input: RowInput) {
  return shopperNumbers({ kgUsed: input.value?.used ?? "", gramsPerShopper: input.gramsPerShopper ?? "0", actualPacks: Number(input.needed) });
}

export function materialUseErrors(input: RowInput) {
  if (input.measuredInKg) {
    if (!input.value?.used) return [`${input.name}: enter the KG used`];
    try { shopperFor(input); return []; }
    catch (caught) { return [`${input.name}: ${caught instanceof Error ? caught.message : "check the KG used"}`]; }
  }
  return checkPiecesUse({ name: input.name, needed: input.needed, used: usedFor(input), reason: input.value?.reason, note: input.value?.note });
}

export function MaterialUseRow({ name, unit, measuredInKg, needed, gramsPerShopper, value, onChange, disabled }: RowInput & { unit: string; onChange: (value: MaterialUseDraft) => void; disabled: boolean }) {
  const current = value ?? { used: measuredInKg ? "" : new Big(needed).toString(), reason: "", note: "" };
  const used = usedFor({ measuredInKg, needed, value });
  let shopper: ReturnType<typeof shopperNumbers> | null = null;
  if (measuredInKg && used) { try { shopper = shopperFor({ name, measuredInKg, needed, gramsPerShopper, value }); } catch { shopper = null; } }
  const errors = materialUseErrors({ name, measuredInKg, needed, gramsPerShopper, value });
  let extra = false;
  try { extra = !measuredInKg && new Big(used).gt(needed); } catch { extra = false; }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-40 font-medium">{measuredInKg ? `${name} (KG)` : name}</span>
        <span className="text-sm text-muted-foreground">{`Needed ${count(Number(needed))}${measuredInKg ? " packs" : ""}`}</span>
        <Input aria-label={`${name} used (${unit})`} inputMode="decimal" className="w-32" disabled={disabled}
          placeholder={measuredInKg ? "Weigh and enter" : undefined} value={current.used}
          onChange={(event) => onChange({ ...current, used: event.target.value })} />
        <span className="text-sm">{unit}</span>
      </div>
      {shopper && (
        <p className="text-sm text-muted-foreground">{`Expected ${count(shopper.expected)} · Actual ${count(shopper.actual)} · Loss ${count(shopper.loss)} (${shopper.lossPercent}%)`}</p>
      )}
      {shopper?.moreThanExpected && <p className="text-sm text-amber-600">{SHOPPER_OVER_WARNING}</p>}
      {extra && (
        <div className="flex flex-wrap gap-3">
          <NativeSelect aria-label={`Reason for extra ${name}`} value={current.reason} disabled={disabled} onChange={(event) => onChange({ ...current, reason: event.target.value })}>
            <NativeSelectOption value="">Pick a reason</NativeSelectOption>
            {PACKING_REASONS.map((reason) => <NativeSelectOption key={reason.code} value={reason.code}>{reason.label}</NativeSelectOption>)}
          </NativeSelect>
          <Input aria-label={`Note for extra ${name}`} placeholder={current.reason === "other" ? "Note (required)" : "Note (optional)"} maxLength={500} disabled={disabled}
            value={current.note} onChange={(event) => onChange({ ...current, note: event.target.value })} className="flex-1" />
        </div>
      )}
      {errors.length > 0 && current.used !== "" && errors.map((error) => <p key={error} className="text-sm text-destructive">{error}</p>)}
    </div>
  );
}
