import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StartMixingDialogBody } from "@/components/mixing/start-mixing-dialog";

vi.mock("@/server-functions/manufacturing/mixing/get-mixing-start-requirements-fn", () => ({ getMixingStartRequirementsFn: vi.fn() }));
vi.mock("@/hooks/stock/use-material-lots", () => ({ useMaterialLots: vi.fn() }));

const lots = { soda: [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
] };

describe("StartMixingDialogBody", () => {
  it("pre-fills oldest first and enables Start only when every chemical's lots add up", () => {
    const onStart = vi.fn();
    render(<StartMixingDialogBody materials={[{ chemicalId: "soda", name: "Soda Ash", unit: "kg", quantity: "200.000" }]} lots={lots} pending={false} onStart={onStart} />);
    const start = screen.getByRole<HTMLButtonElement>("button", { name: "Start Mixing Batch" });
    const older = () => screen.getByLabelText("Lot 1 Oct, 120 kg here") as HTMLInputElement;
    const newer = () => screen.getByLabelText("Lot 20 Oct, 80 kg here") as HTMLInputElement;
    // Pre-filled oldest first, with no prices shown.
    expect([older().value, newer().value]).toEqual(["120.000", "80.000"]);
    expect(screen.queryByText(/Rs \d+\/kg/)).toBeNull();
    expect(start.disabled).toBe(false);
    fireEvent.change(older(), { target: { value: "100" } });
    expect(start.disabled).toBe(true);
    fireEvent.change(older(), { target: { value: "120" } });
    fireEvent.change(newer(), { target: { value: "80" } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith([{ materialId: "soda", picks: expect.arrayContaining([{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }]) }]);
  });
});
