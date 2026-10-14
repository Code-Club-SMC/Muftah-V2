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
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
  pending: false,
  permissions: ["manufacturing.manage"],
  search: {} as { edit?: string },
  recipes: [] as any[],
}));
vi.mock("@/hooks/recipes/create-recipe-hook", () => ({
  useCreateRecipe: () => ({ mutateAsync: mocks.create, isPending: mocks.pending }),
}));
vi.mock("@/hooks/recipes/use-update-recipe-hook", () => ({
  useUpdateRecipe: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/hooks/recipes/use-delete-recipe", () => ({
  useDeleteRecipe: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  getRouteApi: () => ({
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
}));
vi.mock(
  "@/server-functions/inventory/recipes/get-packaging-format-options-fn",
  () => ({
    getPackagingFormatOptionsFn: async () => ({
      products: [
        { id: "p1", name: "S-was" },
        { id: "p2", name: "Other product" },
      ],
      packagings: [
        { id: "bag", name: "Printed pouch", type: "primary", capacity: "999" },
        { id: "box", name: "Outer carton", type: "master", capacity: "80" },
        { id: "label", name: "Sticker", type: "sticker" },
      ],
    }),
  }),
);
vi.mock(
  "@/server-functions/manufacturing/formulas/get-active-formula-options-fn",
  () => ({
    getActiveFormulaOptionsFn: async () => [
      {
        id: "f1",
        productId: "p1",
        name: "S-was formula",
        batchSize: "100",
        batchUnit: "kg",
      },
    ],
  }),
);
vi.mock("@/server-functions/inventory/recipes/get-recipe-fn", () => ({
  getRecipesFn: async () => mocks.recipes,
}));
vi.mock("@/server-functions/inventory/get-products-fn", () => ({
  getProductsFn: vi.fn(),
}));
vi.mock("@/components/recipes/products-table", () => ({
  ProductsTable: () => <p>Product management</p>,
}));
import { CreateRecipeForm } from "@/components/recipes/create-recipe-from";
import { RecipesContainer } from "@/components/recipes/recipes-container";

const saved = {
  id: "r1",
  productId: "p1",
  formulaId: "f1",
  name: "S-was Rs. 100 pack",
  fillAmount: "0.250",
  fillUnit: "kg",
  containerPackagingId: "bag",
  containersPerCarton: 40,
  cartonPackagingId: "box",
  minimumStockLevel: 0,
  packaging: [],
  product: { id: "p1", name: "S-was" },
  containerPackaging: { name: "Printed pouch" },
};
function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading</p>}>{children}</Suspense>
    </QueryClientProvider>,
  );
  return (next: React.ReactNode) => view.rerender(<QueryClientProvider client={client}><Suspense fallback={<p>Loading</p>}>{next}</Suspense></QueryClientProvider>);
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function fill() {
  await screen.findByLabelText("Product");
  change("Product", "p1");
  change("Mixing formula", "f1");
  change("Pack name", "Rs. 100 pack");
  change("Content in one pack", "300");
  change("Pack material", "bag");
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.create.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.permissions = ["manufacturing.manage"];
  mocks.search = {};
  mocks.recipes = [saved];
});

describe("packaging format editor", () => {
  it("blocks repeated confirmation and editor navigation while saving", async () => {
    let finish!: (value: object) => void;
    mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const close = vi.fn();
    const rerender = mount(<CreateRecipeForm onOpenChange={close} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Review packaging format" }));
    fireEvent.click(screen.getByRole("button", { name: "Save packaging format" }));
    mocks.pending = true;
    rerender(<CreateRecipeForm onOpenChange={close} />);
    for (const name of ["Saving…", "Back to edit", "Back to formats"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    finish({});
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });
  it("reviews a loose-only format with exact remainder, and creates no stock on review", async () => {
    const close = vi.fn();
    mount(<CreateRecipeForm onOpenChange={close} />);
    await fill();
    expect(screen.getByText(/333 whole packs, leaving 0.1 kg/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Saving a format does not produce stock/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Save packaging format" }),
    );
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      fillAmount: "300",
      fillUnit: "g",
      batchSize: "100",
      batchUnit: "kg",
      targetUnitsPerBatch: 333,
      containersPerCarton: 0,
    });
    expect(
      mocks.create.mock.calls[0][0].data.cartonPackagingId,
    ).toBeUndefined();
  });
  it("preserves saved fill and carton capacity instead of overwriting them from materials", async () => {
    mount(
      <CreateRecipeForm onOpenChange={vi.fn()} initialRecipe={saved as any} />,
    );
    expect(
      (
        (await screen.findByLabelText(
          "Content in one pack",
        )) as HTMLInputElement
      ).value,
    ).toBe("0.250");
    expect(
      (screen.getByLabelText("Packs in one full carton") as HTMLInputElement)
        .value,
    ).toBe("40");
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save packaging format" }),
    );
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      id: "r1",
      fillAmount: "0.250",
      fillUnit: "kg",
      containersPerCarton: 40,
    });
  });
  it("clears formula selection when changing product and blocks incompatible units", async () => {
    mount(<CreateRecipeForm onOpenChange={vi.fn()} />);
    await fill();
    change("Unit", "ml");
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    expect(screen.getByText(/must match the mixing bulk unit/)).toBeTruthy();
    change("Product", "p2");
    expect(
      (screen.getByLabelText("Mixing formula") as HTMLInputElement).value,
    ).toBe("");
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    expect(
      screen.getByText("Choose an active formula for this product."),
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains values after server refusal and allows returning to edit", async () => {
    mocks.update.mockRejectedValueOnce(
      new Error("This format has finished stock"),
    );
    mount(
      <CreateRecipeForm onOpenChange={vi.fn()} initialRecipe={saved as any} />,
    );
    await screen.findByLabelText("Pack name");
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save packaging format" }),
    );
    expect(
      await screen.findByText("This format has finished stock"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(
      (screen.getByLabelText("Content in one pack") as HTMLInputElement).value,
    ).toBe("0.250");
  });
  it("rejects per-carton extras on loose-only formats", async () => {
    mount(<CreateRecipeForm onOpenChange={vi.fn()} />);
    await fill();
    fireEvent.click(screen.getByText("Optional: labels, caps and stock alert"));
    fireEvent.click(screen.getByRole("button", { name: "Add extra material" }));
    change("Extra material", "label");
    change("Used for", "per_carton");
    fireEvent.click(
      screen.getByRole("button", { name: "Review packaging format" }),
    );
    expect(
      screen.getByText("Per carton extras require carton packaging"),
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
describe("packaging format list", () => {
  it("shows decimal pack sizes and clears a no-match filter", async () => {
    mount(<RecipesContainer />);
    expect(await screen.findByText("0.25 kg")).toBeTruthy();
    expect(screen.queryByText("Total Cartons")).toBeNull();
    change("Find a pack", "no match");
    expect(screen.getByText("No matching formats")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("S-was Rs. 100 pack")).toBeTruthy();
  });
  it("hides management actions for read-only viewers, including an edit link", async () => {
    mocks.permissions = ["manufacturing.view"];
    mocks.search = { edit: "r1" };
    mount(<RecipesContainer />);
    await screen.findByText("S-was Rs. 100 pack");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "New packaging format" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Pack name")).toBeNull();
  });
  it("explains archival accurately before removing a used format", async () => {
    mount(<RecipesContainer />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(
      screen.getByText(/will be archived and those records will be kept/),
    ).toBeTruthy();
    expect(screen.queryByText(/Force Delete/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove format" }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        data: { id: "r1", force: false },
      }),
    );
  });
});
