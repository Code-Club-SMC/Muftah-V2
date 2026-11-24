import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => vi.fn());
vi.mock("@/server-functions/suppliers/get-purchase-edit-state-fn", () => ({ getPurchaseEditStateFn: state }));

import { UsedPurchaseNote } from "@/components/inventory/used-purchase-note";

afterEach(cleanup);
const show = (value: object) => {
  state.mockReset().mockResolvedValue(value);
  render(<QueryClientProvider client={new QueryClient()}><UsedPurchaseNote purchaseId="p" /></QueryClientProvider>);
};

it("says how much a new price will reach", async () => {
  show({ stockLocked: true, unused: { quantity: 228, unit: "kg" } });
  expect((await screen.findByRole("note")).textContent).toContain("the 228 kg not used yet will take it");
});
it("says only the bill changes once everything is used", async () => {
  show({ stockLocked: true, unused: { quantity: 0, unit: "pcs" } });
  expect((await screen.findByRole("note")).textContent).toContain("A new price changes the bill");
});
it("stays quiet while nothing is used", async () => {
  show({ stockLocked: false });
  await waitFor(() => expect(state).toHaveBeenCalled());
  expect(screen.queryByRole("note")).toBeNull();
});
