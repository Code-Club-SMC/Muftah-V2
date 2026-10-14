import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stock: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock(
  "@/server-functions/manufacturing/formulas/get-active-formula-options-fn",
  () => ({
    getActiveFormulaOptionsFn: vi.fn(async () => [
      { id: "formula", name: "Dishwash", batchSize: "500", batchUnit: "kg" },
    ]),
  }),
);
vi.mock("@/server-functions/manufacturing/get-assignment-options-fn", () => ({
  getManufacturingAssignmentOptionsFn: vi.fn(async () => ({
    factoryFloors: [{ id: "floor", name: "Main floor" }],
    operators: [{ id: "operator", name: "Operator" }],
  })),
}));
vi.mock(
  "@/server-functions/manufacturing/mixing/get-mixing-stock-availability-fn",
  () => ({ getMixingStockAvailabilityFn: mocks.stock }),
);
vi.mock("@/server-functions/manufacturing/mixing/create-mixing-run-fn", () => ({
  createMixingRunFn: mocks.create,
}));
vi.mock("@/server-functions/manufacturing/mixing/start-mixing-run-fn", () => ({
  startMixingRunFn: vi.fn(),
}));
vi.mock(
  "@/server-functions/manufacturing/mixing/log-mixing-progress-fn",
  () => ({ logMixingProgressFn: vi.fn() }),
);
vi.mock(
  "@/server-functions/manufacturing/mixing/complete-mixing-run-fn",
  () => ({ completeMixingRunFn: vi.fn() }),
);
vi.mock("@/server-functions/manufacturing/mixing/cancel-mixing-run-fn", () => ({
  cancelMixingRunFn: vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/mixing/fail-mixing-run-fn", () => ({
  failMixingRunFn: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
import { CreateMixingRunDialog } from "@/components/mixing/create-mixing-run-dialog";

const shortage = {
  chemicalId: "acid",
  name: "Citric acid",
  unit: "kg",
  required: "25.000",
  available: "10.000",
  missing: "15.000",
};
async function selectBatch() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateMixingRunDialog />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Mixing Batch" }));
  await screen.findByRole("option", { name: "Dishwash (500 kg)" });
  fireEvent.change(screen.getByLabelText("Select Mixing Formula"), {
    target: { value: "formula" },
  });
  fireEvent.change(screen.getByLabelText("Factory floor"), {
    target: { value: "floor" },
  });
  fireEvent.change(screen.getByLabelText("Operator"), {
    target: { value: "operator" },
  });
}
describe("mixing creation stock feedback", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stock.mockResolvedValue({ shortages: [] });
    mocks.create.mockResolvedValue({ success: true, mixingRun: { id: "run" } });
  });
  it("checks the selected floor and shows quantities before creation, then allows refresh", async () => {
    mocks.stock.mockResolvedValueOnce({ shortages: [shortage] });
    await selectBatch();
    await screen.findByText("Citric acid");
    expect(screen.getByText("15.000 kg")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.stock).toHaveBeenCalledWith({
      data: { formulaId: "formula", warehouseId: "floor" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh stock" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });
  it("keeps the dialog and selections when authoritative creation rejects stale availability", async () => {
    mocks.create.mockResolvedValue({ success: false, shortages: [shortage] });
    await selectBatch();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("15.000 kg");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByLabelText("Factory floor") as HTMLSelectElement).value,
    ).toBe("floor");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
});
