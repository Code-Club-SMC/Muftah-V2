import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/hooks/stock/use-adjust-stock", () => ({ useAdjustStock: () => ({ mutate, isPending: false }) }));
vi.mock("@/hooks/stock/use-material-lots", () => ({
  useMaterialLots: () => ({
    data: { m1: [{ lotId: "lot-a", unitPrice: "2.00", quantity: "10.000", firstPurchasedAt: "2026-10-01T05:00:00Z" }] },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/stock/use-recover-failed-production-chemical", () => ({
  useRecoverFailedProductionChemical: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/server-functions/inventory/stock/get-failed-production-chemical-recovery-context-fn", () => ({
  getFailedProductionChemicalRecoveryContextFn: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { user: { id: "storekeeper" }, permissions: ["inventory.manage"] } }),
}));
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";

const options = () => [...screen.getByLabelText("Reason").querySelectorAll("option")].map((option) => option.textContent);

function mount() {
  render(<AdjustStockDialog factoryFloorId="floor-1" open onOpenChange={() => {}} materialType="packaging" materialId="m1" materialName="Pouch" currentStock={10} unit="pcs" />);
}

describe("stock adjustment reasons", () => {
  afterEach(() => {
    cleanup();
    mutate.mockClear();
  });

  it("offers only removal reasons when removing, and needs a note for Other", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByPlaceholderText("Enter pcs to remove"), { target: { value: "2" } });
    expect(options()).toEqual(["Pick a reason", "Damaged", "Spilled", "Expired", "Count short", "Other"]);
    const submit = screen.getByRole("button", { name: "Remove Stock" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "other" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "lid cracked" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(mutate).toHaveBeenCalledWith(
      { data: { materialType: "packaging", materialId: "m1", lotId: "lot-a", adjustment: -2, reason: "other", note: "lid cracked" } },
      expect.anything(),
    );
  });

  it("offers Count over and Other when adding, and clears a removal reason on switch", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "damaged" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Back" }));
    expect(options()).toEqual(["Pick a reason", "Count over", "Other"]);
    expect((screen.getByLabelText("Reason") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByPlaceholderText("Enter pcs to add"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "count_over" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Stock" }));
    expect(mutate.mock.calls[0][0]).toEqual({ data: { materialType: "packaging", materialId: "m1", lotId: "lot-a", adjustment: 3, reason: "count_over" } });
  });
});
