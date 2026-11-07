import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeletePurchaseDialog } from "@/components/suppliers/delete-purchase-dialog";

const deleteFn = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ success: true })));
vi.mock("@/server-functions/suppliers/delete-purchase-record-fn", () => ({ deletePurchaseRecordFn: deleteFn }));
vi.mock("@/server-functions/suppliers/get-purchase-edit-state-fn", () => ({ getPurchaseEditStateFn: vi.fn() }));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));

const purchase = { id: "p1", materialType: "chemical", cost: "7000", quantity: "100" };

function open(state: { stockLocked: boolean; refund: { paid: string; walletId: string | null } }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["purchase-edit-state", "p1"], state);
  client.setQueryData(["wallets"], [
    { id: "cash", name: "Cash", type: "cash", balance: "13000.00" },
    { id: "bank", name: "Bank", type: "bank", balance: "50000.00" },
  ]);
  const view = render(
    <QueryClientProvider client={client}>
      <DeletePurchaseDialog open onOpenChange={vi.fn()} purchase={purchase} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Duplicate supplier entry" } });
  return { client, ...view };
}

describe("Void purchase refund", () => {
  afterEach(() => {
    cleanup();
    deleteFn.mockClear();
  });

  it("starts with everything paid, to the wallet that paid it", async () => {
    open({ stockLocked: false, refund: { paid: "7000.00", walletId: "cash" } });
    await waitFor(() => expect(screen.getByLabelText("Refund amount (PKR)")).toBeTruthy());
    expect((screen.getByLabelText("Refund amount (PKR)") as HTMLInputElement).value).toBe("7000.00");
    fireEvent.click(screen.getByRole("button", { name: "Void purchase" }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalled());
    expect(deleteFn.mock.calls[0][0]).toEqual({ data: { id: "p1", reason: "Duplicate supplier entry", refundWalletId: "cash", refundAmount: "7000.00" } });
  });

  it("sends a smaller amount and says the rest stays as an expense", async () => {
    open({ stockLocked: false, refund: { paid: "7000.00", walletId: "cash" } });
    await waitFor(() => expect(screen.getByLabelText("Refund amount (PKR)")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Refund amount (PKR)"), { target: { value: "6500" } });
    expect(screen.getByText(/500 will stay in expenses as not refunded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Void purchase" }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalled());
    expect(deleteFn.mock.calls[0][0]).toEqual({ data: { id: "p1", reason: "Duplicate supplier entry", refundWalletId: "cash", refundAmount: "6500" } });
  });

  it("blocks voiding when the amount is more than was paid", async () => {
    open({ stockLocked: false, refund: { paid: "7000.00", walletId: "cash" } });
    await waitFor(() => expect(screen.getByLabelText("Refund amount (PKR)")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Refund amount (PKR)"), { target: { value: "7500" } });
    expect((screen.getByRole("button", { name: "Void purchase" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no refund section for an unpaid purchase", async () => {
    open({ stockLocked: false, refund: { paid: "0.00", walletId: null } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Void purchase" })).toBeTruthy());
    expect(screen.queryByLabelText("Refund amount (PKR)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Void purchase" }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalled());
    expect(deleteFn.mock.calls[0][0]).toEqual({ data: { id: "p1", reason: "Duplicate supplier entry" } });
  });

  it("requires a nonblank reason", () => {
    open({ stockLocked: false, refund: { paid: "0.00", walletId: null } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "   " } });
    const button = screen.getByRole("button", { name: "Void purchase" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("keeps used stock blocked even with a valid reason", () => {
    open({ stockLocked: true, refund: { paid: "0.00", walletId: null } });
    expect((screen.getByRole("button", { name: "Void purchase" }) as HTMLButtonElement).disabled).toBe(true);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("resets reason and refund inputs when switching purchases or reopening", () => {
    const state = { stockLocked: false, refund: { paid: "7000.00", walletId: "cash" } };
    const { client, rerender } = open(state);
    fireEvent.change(screen.getByLabelText("Refund amount (PKR)"), { target: { value: "6500" } });
    client.setQueryData(["purchase-edit-state", "p2"], { stockLocked: false, refund: { paid: "100.00", walletId: "cash" } });
    const renderDialog = (open: boolean, id: string) => <QueryClientProvider client={client}>
      <DeletePurchaseDialog open={open} onOpenChange={vi.fn()} purchase={{ ...purchase, id }} />
    </QueryClientProvider>;
    rerender(renderDialog(true, "p2"));
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("Refund amount (PKR)") as HTMLInputElement).value).toBe("100.00");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Another reason" } });
    rerender(renderDialog(false, "p2"));
    rerender(renderDialog(true, "p2"));
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Void purchase" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
