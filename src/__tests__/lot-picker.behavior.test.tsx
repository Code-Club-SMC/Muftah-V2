import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LotPicker } from "@/components/inventory/lot-picker";
import type { LotPick } from "@/lib/inventory/material-lots";

const lots = [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
];

function Harness({ required, initial = [] as LotPick[], only }: { required: string; initial?: LotPick[]; only?: typeof lots }) {
  const [value, setValue] = useState<LotPick[]>(initial);
  return <LotPicker name="Soda Ash" unit="kg" required={required} lots={only ?? lots} value={value} onChange={setValue} />;
}

describe("LotPicker", () => {
  afterEach(cleanup);

  it("lists each lot with its stock and shows a running total", () => {
    render(<Harness required="200" />);
    fireEvent.change(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Rs 125/kg (first 20 Oct), 80 kg here"), { target: { value: "80" } });
    expect(screen.getByText("Total 200 of 200 kg ✓")).toBeTruthy();
  });

  it("explains a total that is short or a lot that is overdrawn", () => {
    render(<Harness required="200" />);
    fireEvent.change(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here"), { target: { value: "130" } });
    expect(screen.getByText("Soda Ash: lot Rs 115.00 has only 120 kg here")).toBeTruthy();
  });

  it("pre-fills only when one lot holds stock and covers the need", () => {
    render(<Harness required="50" only={[lots[0]]} />);
    expect((screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here") as HTMLInputElement).value).toBe("50.000");
  });

  it("moves an untouched pre-fill to the new need, but keeps the operator's own entry", () => {
    const view = render(<Harness required="50" only={[lots[0]]} />);
    const input = () => screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here") as HTMLInputElement;
    view.rerender(<Harness required="60" only={[lots[0]]} />);
    expect(input().value).toBe("60.000");
    fireEvent.change(input(), { target: { value: "55" } });
    view.rerender(<Harness required="70" only={[lots[0]]} />);
    expect(input().value).toBe("55");
  });

  it("does not pre-fill when there is a choice", () => {
    render(<Harness required="50" />);
    expect((screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here") as HTMLInputElement).value).toBe("");
  });
});
