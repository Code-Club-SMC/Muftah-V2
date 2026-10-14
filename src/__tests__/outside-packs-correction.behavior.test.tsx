import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/server-functions/inventory/stock/update-stock-fn", () => ({ updateOutsidePackStockFn: mocks.update }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { AdjustOutsidePacksDialog } from "@/components/inventory/adjust-outside-packs-dialog";

function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  render(<QueryClientProvider client={client}><AdjustOutsidePacksDialog stockId="stock-1" name="Rs.300 pack" currentCount={100} onClose={onClose} /></QueryClientProvider>);
  return { client, onClose };
}
describe("outside pack corrections", () => {
  beforeEach(() => { mocks.update.mockReset().mockResolvedValue({ success: true, stockId: "stock-1", quantityOutsidePacks: 95 }); });
  afterEach(cleanup);
  it("requires a changed whole count and a reason, then sends the expected previous count", async () => {
    const { onClose, client } = mount();
    client.setQueryData(["factory-floor"], { old: true });
    const save = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Actual loose packs counted"), { target: { value: "95" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Recount found five damaged packs" } });
    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stockId: "stock-1", adjustmentType: "set", quantity: 95, expectedCurrent: 100, reason: "Recount found five damaged packs" } }), expect.anything());
    expect(client.getQueryState(["factory-floor"])?.isInvalidated).toBe(true);
  });
  it("retains the entered count and reason when stock changed concurrently", async () => {
    mocks.update.mockRejectedValue(new Error("Stock changed. Reload the current count."));
    const { onClose } = mount();
    fireEvent.change(screen.getByLabelText("Actual loose packs counted"), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Physical recount" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await screen.findByText("Stock changed. Reload the current count.");
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Actual loose packs counted") as HTMLInputElement).value).toBe("95");
    expect((screen.getByLabelText("Reason for correction") as HTMLTextAreaElement).value).toBe("Physical recount");
  });
  it("rejects fractional counts", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Actual loose packs counted"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Recount" } });
    expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
