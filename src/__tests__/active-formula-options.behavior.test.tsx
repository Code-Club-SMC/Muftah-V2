import { Suspense } from "react";
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
  list: vi.fn(),
  options: vi.fn(),
  createMixing: vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/formulas/get-formulas-fn", () => ({
  getFormulasFn: mocks.list,
}));
vi.mock(
  "@/server-functions/manufacturing/formulas/get-active-formula-options-fn",
  () => ({ getActiveFormulaOptionsFn: mocks.options }),
);
vi.mock("@/server-functions/manufacturing/get-assignment-options-fn", () => ({
  getManufacturingAssignmentOptionsFn: vi.fn(async () => ({
    operators: [{ id: "operator-1", name: "Operator" }],
    factoryFloors: [{ id: "floor-1", name: "Floor" }],
  })),
}));
vi.mock(
  "@/server-functions/manufacturing/mixing/get-mixing-stock-availability-fn",
  () => ({
    getMixingStockAvailabilityFn: vi.fn(async () => ({ shortages: [] })),
  }),
);
vi.mock("@/server-functions/inventory/get-products-fn", () => ({
  getProductsFn: vi.fn(async () => [{ id: "product-1", name: "Product" }]),
}));
vi.mock("@/server-functions/inventory/recipes/get-packaging-format-options-fn", () => ({
  getPackagingFormatOptionsFn: vi.fn(async () => ({ products: [{ id: "product-1", name: "Product" }], packagings: [] })),
}));
vi.mock("@/server-functions/inventory/get-materials-fn", () => ({
  getMaterialsFn: vi.fn(async () => ({ chemicals: [], packagings: [] })),
}));
vi.mock("@/server-functions/inventory/get-warehouses-fn", () => ({
  getWarehousesFn: vi.fn(async () => []),
}));
vi.mock("@/hooks/manufacturing/mixing/use-mixing-mutations", () => ({
  useCreateMixingRun: () => ({
    mutate: mocks.createMixing,
    reset: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@/hooks/recipes/create-recipe-hook", () => ({
  useCreateRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/recipes/use-update-recipe-hook", () => ({
  useUpdateRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
// Keep the recipe form's state and change callbacks real. Native select controls
// stand in for Radix's portal mechanics, which are outside this data contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="">{placeholder}</option>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

import { CreateMixingRunDialog } from "@/components/mixing/create-mixing-run-dialog";
import { CreateRecipeForm } from "@/components/recipes/create-recipe-from";

const formulas = Array.from({ length: 101 }, (_, index) => ({
  id: `formula-${index + 1}`,
  name: `Formula ${index + 1}`,
  productId: "product-1",
  batchSize: index === 100 ? "123" : "10",
  batchUnit: "kg",
  estimatedIngredientsCost: index === 100 ? "9876.54" : "0",
}));

function mount(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading</p>}>{component}</Suspense>
    </QueryClientProvider>,
  );
  return client;
}

describe("active formula dropdown options", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.list.mockReset().mockImplementation(async ({ data }) => ({
      formulas: formulas.slice(0, data.pageSize ?? 10),
      totalCount: formulas.length,
    }));
    mocks.options.mockReset().mockResolvedValue(formulas);
    mocks.createMixing.mockReset();
  });

  it("selects the 101st active formula when creating mixing work", async () => {
    const client = mount(<CreateMixingRunDialog />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create Mixing Batch" }),
    );
    const formulaOption = await screen.findByRole("option", {
      name: "Formula 101 (123 kg)",
    });
    fireEvent.change(formulaOption.closest("select")!, {
      target: { value: "formula-101" },
    });
    const floorOption = await screen.findByRole("option", { name: "Floor" });
    fireEvent.change(floorOption.closest("select")!, {
      target: { value: "floor-1" },
    });
    const operatorOption = await screen.findByRole("option", {
      name: "Operator",
    });
    fireEvent.change(operatorOption.closest("select")!, {
      target: { value: "operator-1" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(mocks.createMixing).toHaveBeenCalledWith(
      {
        data: {
          formulaId: "formula-101",
          warehouseId: "floor-1",
          operatorId: "operator-1",
        },
      },
      expect.anything(),
    );
    expect(client.getQueryData(["formulas", "active-options"])).toHaveLength(
      101,
    );
  });

  it("selects the 101st formula and uses its batch size for the pack reference", async () => {
    mount(<CreateRecipeForm onOpenChange={vi.fn()} />);
    const productSelect = (
      await screen.findByRole("option", { name: "Select product…" })
    ).closest("select")!;
    fireEvent.change(productSelect, { target: { value: "product-1" } });
    const formulaOption = await screen.findByRole("option", {
      name: "Formula 101",
    });
    fireEvent.change(formulaOption.closest("select")!, {
      target: { value: "formula-101" },
    });
    fireEvent.change(screen.getByLabelText("Content in one pack"), { target: { value: "250" } });
    expect((screen.getByLabelText("Unit") as HTMLInputElement).value).toBe("g");
    expect(screen.getByText(/123 kg makes 492 whole packs/)).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
