import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(), list: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server-functions/inventory/update-product-fn", () => ({ updateProductFn: mocks.update }));
vi.mock("@/server-functions/inventory/delete-product-fn", () => ({ deleteProductFn: vi.fn() }));
vi.mock("@/server-functions/inventory/add-product-fn", () => ({ addProductFn: vi.fn() }));

import { ProductsTable } from "@/components/recipes/products-table";

afterEach(cleanup);

const rows = Array.from({ length: 9 }, (_, i) => ({
  id: `p${i}`, name: `Product ${i}`, description: null, createdAt: "", updatedAt: "", recipes: [],
}));

function Page() {
  const { data } = useQuery({ queryKey: ["products"], queryFn: mocks.list, initialData: rows, staleTime: Infinity });
  return <ProductsTable products={data as any} />;
}

const editRow = (name: string) =>
  fireEvent.click(screen.getByText(name).closest("tr")!.querySelectorAll("button")[1]);

it("shows the saved description in place, on the same page, and opens the next row with its own values", async () => {
  mocks.list.mockReturnValue(new Promise(() => {})); // refetch still running
  mocks.update.mockImplementation(async ({ data }: any) => ({ ...data, updatedAt: "now" }));
  render(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
  fireEvent.click(screen.getByText("Next"));
  await screen.findByText("Product 7");

  editRow("Product 7");
  fireEvent.change(screen.getByPlaceholderText("Optional description..."), { target: { value: "Fresh text" } });
  fireEvent.click(screen.getByText("Update Product"));

  await screen.findByText("Fresh text");
  await waitFor(() => expect(screen.queryByText("Edit Product")).toBeNull());
  const bodyRows = [...document.querySelectorAll("tbody tr")].map((row) => row.textContent);
  expect(bodyRows[0]).toContain("Product 7Fresh text");
  expect(bodyRows[1]).toContain("Product 8");

  editRow("Product 8");
  expect((screen.getByPlaceholderText("e.g. Dish Wash Liquid") as HTMLInputElement).value).toBe("Product 8");
  expect((screen.getByPlaceholderText("Optional description...") as HTMLTextAreaElement).value).toBe("");
});

it("lists products in a fixed order", () => {
  expect(readFileSync("src/server-functions/inventory/get-products-fn.ts", "utf8")).toContain(
    "orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.id)]",
  );
});
