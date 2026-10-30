import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MixingActualUse, chemicalUseValid, type ChemicalUseDraft } from "@/components/operator/mixing-actual-use";

const at = new Date("2026-10-01");
const rows = [
  { chemicalId: "soda", name: "Soda Ash", unit: "kg", formula: "50.000", takenLots: [{ lotId: "s115", quantity: "50.000", unitPrice: "115.00", firstPurchasedAt: at }] },
  { chemicalId: "silicate", name: "Silicate", unit: "kg", formula: "20.000", takenLots: [{ lotId: "si90", quantity: "20.000", unitPrice: "90.00", firstPurchasedAt: at }] },
];
const floorLots = { soda: [{ lotId: "s115", quantity: "70.000", unitPrice: "115.00", firstPurchasedAt: at }, { lotId: "s125", quantity: "100.000", unitPrice: "125.00", firstPurchasedAt: at }] };

function Harness({ onState }: { onState?: (value: Record<string, ChemicalUseDraft>) => void }) {
  const [value, setValue] = useState<Record<string, ChemicalUseDraft>>({});
  return <MixingActualUse rows={rows} floorLots={floorLots} value={value} onChange={(next) => { setValue(next); onState?.(next); }} />;
}

describe("chemicals used at completion", () => {
  it("pre-fills Used with the formula amount and asks nothing for unchanged rows", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Soda Ash used (kg)") as HTMLInputElement).value).toBe("50");
    expect(screen.queryByText(/extra from/)).toBeNull();
    expect(chemicalUseValid(rows[0], undefined, [])).toBe(true);
  });

  it("asks for lots and a reason when more than formula was used", () => {
    let state: Record<string, ChemicalUseDraft> = {};
    render(<Harness onState={(next) => (state = next)} />);
    fireEvent.change(screen.getByLabelText("Soda Ash used (kg)"), { target: { value: "55" } });
    expect(screen.getByText("Soda Ash: +5 kg extra from")).toBeTruthy();
    expect(screen.getByLabelText("Reason for extra Soda Ash")).toBeTruthy();
    expect(chemicalUseValid(rows[0], state.soda, floorLots.soda)).toBe(false);
    expect(screen.queryByText(/Rs/)).toBeNull(); // operators never see prices
    fireEvent.change(screen.getByLabelText("Lot 1 Oct, 70 kg here"), { target: { value: "5" } }); // oldest lot, already pre-filled
    fireEvent.change(screen.getByLabelText("Reason for extra Soda Ash"), { target: { value: "spill" } });
    expect(chemicalUseValid(rows[0], state.soda, floorLots.soda)).toBe(true);
  });

  it("asks which taken lot the leftover goes back to, with no reason", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Silicate used (kg)"), { target: { value: "18" } });
    expect(screen.getByText("Silicate: 2 kg back to")).toBeTruthy();
    expect(screen.queryByLabelText("Reason for extra Silicate")).toBeNull();
    expect(screen.getByLabelText("Lot 1 Oct, 20 kg taken by this batch")).toBeTruthy();
    expect(screen.queryByText(/Rs/)).toBeNull();
  });

  it("needs a note for Other", () => {
    const draft = { used: "55", picks: [{ lotId: "s115", quantity: "5" }], reason: "other", note: "" };
    expect(chemicalUseValid(rows[0], draft, floorLots.soda)).toBe(false);
    expect(chemicalUseValid(rows[0], { ...draft, note: "pump" }, floorLots.soda)).toBe(true);
  });
});
