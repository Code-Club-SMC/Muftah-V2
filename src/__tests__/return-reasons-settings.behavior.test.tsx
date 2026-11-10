import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnReasonsSettings } from "@/components/sales/returns/return-reasons-settings";
import { Route as ConfigurationsRoute } from "@/routes/_protected/sales/configurations/index";

const mocks = vi.hoisted(() => ({
  reasons: vi.fn(),
  saveReason: vi.fn(),
  getCustomersByType: vi.fn(),
  getRecipes: vi.fn(),
  getOrderBookers: vi.fn(),
  getActiveTadaRate: vi.fn(),
  listTadaRates: vi.fn(),
  permissions: ["*"] as string[],
  viewerLoading: false,
}));

vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
  createSalesReturnFn: vi.fn(),
  decideSalesReturnFn: vi.fn(),
  completeSalesReturnFn: vi.fn(),
  cancelSalesReturnFn: vi.fn(),
  voidSalesReturnFn: vi.fn(),
  listSalesReturnsFn: vi.fn(),
  getSalesReturnDetailFn: vi.fn(),
}));

vi.mock("@/server-functions/sales/return-reasons-fn", () => ({
  getReturnReasonsFn: mocks.reasons,
  saveReturnReasonFn: mocks.saveReason,
}));

vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({
    data: mocks.viewerLoading ? undefined : { permissions: mocks.permissions },
    isLoading: mocks.viewerLoading,
  }),
}));

vi.mock("@/hooks/sales/use-discount-rules", () => ({
  useCreateDiscountRule: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDiscountRule: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteDiscountRule: () => ({ mutate: vi.fn(), isPending: false }),
  useGetDiscountRules: () => ({ data: [], isLoading: false }),
  useGetDiscountRuleHistory: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/sales/use-order-booker-commission", () => ({
  useGetCommissionTiers: () => ({ data: [], isLoading: false }),
  useCreateCommissionTier: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCommissionTier: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/sales/use-sales-people", () => ({
  useGetOrderBookers: () => ({ data: [] }),
}));

vi.mock("@/hooks/sales/use-entity-recipe-rates", () => ({
  useGetEntityRecipeRatesForEntity: () => ({ data: [], isLoading: false }),
  useUpsertEntityRecipeRate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEntityRecipeRate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/server-functions/sales/sales-config-fn", () => ({
  getCustomersByTypeFn: mocks.getCustomersByType,
  getRecipesFn: mocks.getRecipes,
  getOrderBookersFn: mocks.getOrderBookers,
}));

vi.mock("@/server-functions/hr/rates/tada-rates-fn", () => ({
  getActiveTadaRateFn: mocks.getActiveTadaRate,
  listTadaRatesFn: mocks.listTadaRates,
  setTadaRateFn: vi.fn(),
  updateTadaRateFn: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));

let client: QueryClient;

function mount(ui: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.permissions = ["*"];
  mocks.viewerLoading = false;
  mocks.getCustomersByType.mockResolvedValue({ data: [] });
  mocks.getRecipes.mockResolvedValue([]);
  mocks.getOrderBookers.mockResolvedValue([]);
  mocks.getActiveTadaRate.mockResolvedValue(null);
  mocks.listTadaRates.mockResolvedValue([]);
  mocks.reasons.mockResolvedValue([
    { id: "r1", name: "Damaged in transit", requiresNote: false, isActive: true, sortOrder: 0 },
    { id: "r2", name: "Old reason", requiresNote: true, isActive: false, sortOrder: 1 },
  ]);
  mocks.saveReason.mockResolvedValue({
    id: "r3",
    name: "Missing seal",
    requiresNote: true,
    isActive: true,
    sortOrder: 2,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("ReturnReasonsSettings", () => {
  it("gates loading on sales.view and renders read-only mode when lacking sales.config.manage", async () => {
    mocks.permissions = ["sales.config.view"];
    const { rerender } = mount(<ReturnReasonsSettings />);
    expect(screen.getByRole("alert").textContent).toContain("Sales view permission is required");
    expect(mocks.reasons).not.toHaveBeenCalled();

    mocks.permissions = ["sales.view", "sales.config.view"];
    rerender(
      <QueryClientProvider client={client}>
        <ReturnReasonsSettings />
      </QueryClientProvider>,
    );

    await screen.findByText("Damaged in transit");
    expect(mocks.reasons).toHaveBeenCalledWith({ data: { includeInactive: true } });
    expect(screen.getByText(/Read-only access/)).toBeTruthy();
    expect(screen.queryByLabelText("New reason")).toBeNull();
    expect(screen.queryByRole("button", { name: "Damaged in transit" })).toBeNull();
    expect(screen.getByText("Old reason").className).toContain("line-through");
    for (const toggle of screen.getAllByRole("switch")) {
      expect((toggle as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("loads inactive reasons, adds a new reason with note toggle, and keeps inputs on server failure", async () => {
    mount(<ReturnReasonsSettings />);
    await screen.findByText("Damaged in transit");
    expect(screen.getByText("Old reason").className).toContain("line-through");

    const addInput = screen.getByLabelText("New reason") as HTMLInputElement;
    const noteSwitch = screen.getAllByRole("switch", { name: "Note required" })[0];
    const addButton = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    fireEvent.change(addInput, { target: { value: " A " } });
    expect(addButton.disabled).toBe(true);
    const addForm = addButton.closest("form");
    if (!addForm) throw new Error("Expected add form");
    fireEvent.submit(addForm);
    expect(mocks.saveReason).not.toHaveBeenCalled();

    fireEvent.change(addInput, { target: { value: "  Missing seal  " } });
    fireEvent.click(noteSwitch);
    expect(addButton.disabled).toBe(false);

    mocks.saveReason.mockRejectedValueOnce(new Error('A reason called "Missing seal" already exists.'));
    fireEvent.click(addButton);

    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(addInput.value).toBe("  Missing seal  ");

    fireEvent.click(addButton);
    await waitFor(() =>
      expect(mocks.saveReason).toHaveBeenLastCalledWith({
        data: { name: "Missing seal", requiresNote: true, isActive: true },
      }),
    );
    await waitFor(() => expect(addInput.value).toBe(""));
  });

  it("supports inline rename, Back cancellation, switch toggles, and error retention", async () => {
    mount(<ReturnReasonsSettings />);
    const rowText = await screen.findByRole("button", { name: "Damaged in transit" });
    const row = rowText.closest("li");
    if (!row) throw new Error("Expected list item row");

    fireEvent.click(rowText);
    const editInput = within(row).getByLabelText("Edit reason name") as HTMLInputElement;
    expect(editInput.value).toBe("Damaged in transit");

    fireEvent.click(within(row).getByRole("button", { name: "Back" }));
    expect(within(row).queryByLabelText("Edit reason name")).toBeNull();

    fireEvent.click(await within(row).findByRole("button", { name: "Damaged in transit" }));
    const renamedInput = within(row).getByLabelText("Edit reason name") as HTMLInputElement;
    fireEvent.change(renamedInput, { target: { value: "Damaged box" } });

    mocks.saveReason.mockRejectedValueOnce(new Error("Duplicate reason"));
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect((within(row).getByLabelText("Edit reason name") as HTMLInputElement).value).toBe("Damaged box");

    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.saveReason).toHaveBeenLastCalledWith({
        data: { id: "r1", name: "Damaged box", requiresNote: false, isActive: true },
      }),
    );
    await waitFor(() => expect(within(row).queryByLabelText("Edit reason name")).toBeNull());

    fireEvent.click(within(row).getByRole("switch", { name: "Note required" }));
    await waitFor(() =>
      expect(mocks.saveReason).toHaveBeenLastCalledWith({
        data: { id: "r1", name: "Damaged in transit", requiresNote: true, isActive: true },
      }),
    );

    fireEvent.click(within(row).getByRole("switch", { name: "In use" }));
    await waitFor(() =>
      expect(mocks.saveReason).toHaveBeenLastCalledWith({
        data: { id: "r1", name: "Damaged in transit", requiresNote: false, isActive: false },
      }),
    );
  });

  it("warns when all reasons are inactive and handles load retry", async () => {
    mocks.reasons
      .mockRejectedValueOnce(new Error("Reasons fetch failed"))
      .mockResolvedValueOnce([
        { id: "r2", name: "Old reason", requiresNote: false, isActive: false, sortOrder: 0 },
      ]);

    mount(<ReturnReasonsSettings />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Reasons fetch failed");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText("No active return reasons");
  });

  it("exposes the Return Reasons tab inside SalesConfigurationsPage", async () => {
    const ConfigPage = ConfigurationsRoute.options.component;
    if (!ConfigPage) throw new Error("Expected configurations component");
    mount(<ConfigPage />);

    const tab = await screen.findByRole("tab", { name: "Return Reasons" });
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
      fireEvent.click(tab);
    });
    expect(await screen.findByText("Damaged in transit")).toBeTruthy();
  });
});
