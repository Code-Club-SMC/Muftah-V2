import Big from "big.js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LotPicker, lotPicksValid } from "@/components/inventory/lot-picker";
import type { LotBalance, LotPick } from "@/lib/inventory/material-lots";
import { MIXING_REASONS, checkReason, groupFormulaUse, mixingUseChange } from "@/lib/production/material-use";

export type ChemicalUseDraft = { used: string; picks: LotPick[]; reason: string; note: string };
export type ChemicalUseRow = { chemicalId: string; name: string; unit: string; formula: string; takenLots: LotBalance[] };

type MaterialUsed = { chemicalId: string; lotId: string | null; quantityUsed: string; costPerUnit: string; useType: string; chemical?: { name: string; unit: string } | null; lot?: { firstPurchasedAt: Date | string } | null };

export function chemicalUseRows(materialsUsed: MaterialUsed[] = []): ChemicalUseRow[] {
  const formula = materialsUsed.filter((row) => row.useType === "formula" && row.lotId);
  const grouped = groupFormulaUse(formula.map((row) => ({ chemicalId: row.chemicalId, lotId: row.lotId!, quantity: row.quantityUsed, unitPrice: row.costPerUnit, firstPurchasedAt: row.lot?.firstPurchasedAt ?? new Date() })));
  return [...grouped].map(([chemicalId, plan]) => {
    const chemical = formula.find((row) => row.chemicalId === chemicalId)?.chemical;
    return { chemicalId, name: chemical?.name ?? "Chemical", unit: chemical?.unit ?? "kg", ...plan };
  });
}

// null when Used is not a valid amount.
export function chemicalUseChange(row: ChemicalUseRow, draft?: ChemicalUseDraft) {
  try { return mixingUseChange(row.formula, draft?.used ?? row.formula); } catch { return null; }
}

export function chemicalUseValid(row: ChemicalUseRow, draft: ChemicalUseDraft | undefined, floorLots: LotBalance[]) {
  const change = chemicalUseChange(row, draft);
  if (!change) return false;
  if (change.kind === "same") return true;
  if (change.kind === "leftover") return lotPicksValid(change.quantity, draft!.picks, row.takenLots, row.name, row.unit);
  return !checkReason(MIXING_REASONS, draft!.reason, draft!.note, `extra ${row.name}`) && lotPicksValid(change.quantity, draft!.picks, floorLots, row.name, row.unit, true);
}

export function MixingActualUse({ rows, floorLots, value, onChange }: { rows: ChemicalUseRow[]; floorLots: Record<string, LotBalance[]>; value: Record<string, ChemicalUseDraft>; onChange: (next: Record<string, ChemicalUseDraft>) => void }) {
  const set = (row: ChemicalUseRow, change: Partial<ChemicalUseDraft>) => {
    const current = value[row.chemicalId] ?? { used: new Big(row.formula).toString(), picks: [], reason: "", note: "" };
    // A new Used amount means new lots: the old picks were for a different quantity.
    const picks = change.used !== undefined && change.used !== current.used ? [] : current.picks;
    onChange({ ...value, [row.chemicalId]: { ...current, picks, ...change } });
  };
  return (
    <section className="flex flex-col gap-4" aria-label="Chemicals used">
      <h3 className="text-base font-semibold">Chemicals used</h3>
      {rows.map((row) => {
        const draft = value[row.chemicalId];
        const change = chemicalUseChange(row, draft);
        const id = `use-${row.chemicalId}`;
        return (
          <div key={row.chemicalId} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-32 font-medium">{row.name}</span>
              <span className="text-sm text-muted-foreground">{`Formula: ${new Big(row.formula).toString()} ${row.unit}`}</span>
              <Label htmlFor={id} className="sr-only">{`${row.name} used (${row.unit})`}</Label>
              <Input id={id} inputMode="decimal" className="w-32"
                value={draft?.used ?? new Big(row.formula).toString()} onChange={(event) => set(row, { used: event.target.value })} />
              <span className="text-sm">{row.unit}</span>
            </div>
            {!change && <p className="text-sm text-destructive">Enter the amount used, zero or more, with up to 3 decimals.</p>}
            {change?.kind === "extra" && (
              <>
                <LotPicker oldestFirst name={row.name} unit={row.unit} required={change.quantity} lots={floorLots[row.chemicalId] ?? []}
                  legend={`${row.name}: +${new Big(change.quantity).toString()} ${row.unit} extra from`} value={draft!.picks} onChange={(picks) => set(row, { picks })} />
                <div className="flex flex-wrap gap-3">
                  <NativeSelect aria-label={`Reason for extra ${row.name}`} value={draft!.reason} onChange={(event) => set(row, { reason: event.target.value })}>
                    <NativeSelectOption value="">Pick a reason</NativeSelectOption>
                    {MIXING_REASONS.map((reason) => <NativeSelectOption key={reason.code} value={reason.code}>{reason.label}</NativeSelectOption>)}
                  </NativeSelect>
                  <Input aria-label={`Note for extra ${row.name}`} placeholder={draft!.reason === "other" ? "Note (required)" : "Note (optional)"} maxLength={500}
                    value={draft!.note} onChange={(event) => set(row, { note: event.target.value })} className="flex-1" />
                </div>
              </>
            )}
            {change?.kind === "leftover" && (
              <LotPicker hidePrices name={row.name} unit={row.unit} required={change.quantity} lots={row.takenLots} whereLabel="taken by this batch"
                legend={`${row.name}: ${new Big(change.quantity).toString()} ${row.unit} back to`} value={draft!.picks} onChange={(picks) => set(row, { picks })} />
            )}
          </div>
        );
      })}
    </section>
  );
}
