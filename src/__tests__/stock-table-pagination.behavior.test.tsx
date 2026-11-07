import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/custom/data-table";
import { StockTable } from "@/components/inventory/stock-table";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/inventory/use-material-actions", () => ({ useDeleteMaterial: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/components/inventory/add-raw-material-sheet", () => ({ AddRawMaterialDialog: () => null }));
vi.mock("@/components/inventory/add-packaging-material-dialog", () => ({ AddPackagingMaterialDialog: () => null }));
vi.mock("@/components/inventory/edit-material-dialog", () => ({ EditMaterialDialog: () => null }));
vi.mock("@/components/inventory/lab-reports/lab-reports-list", () => ({ LabReportsList: () => null }));

afterEach(cleanup);
const rows = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}` }));
const columns = [{ accessorKey: "name", header: "Material name" }];
function pageFour() {
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("stock pagination", () => {
  it("preserves replacement arrays and clamps a shrinking local result", async () => {
    const props = { columns, pageSize: 5, searchKey: "name", autoResetPageIndex: false };
    const { rerender } = render(<DataTable {...props} data={rows} />);
    pageFour();
    expect(screen.getByText("Item 16")).toBeTruthy();
    rerender(<DataTable {...props} data={rows.map(row => ({ ...row }))} />);
    await waitFor(() => expect(screen.getByText("Item 16")).toBeTruthy());
    rerender(<DataTable {...props} data={rows.slice(0, 6)} />);
    await waitFor(() => expect(screen.getByText("Item 6")).toBeTruthy());
    rerender(<DataTable {...props} data={[]} />);
    await waitFor(() => expect(screen.getByText("No matching records.")).toBeTruthy());
    expect(screen.getByText(/Page/).textContent).toContain("Page 1 of 1");
  });

  it("keeps the real stock table on page four after refresh and sorting, but resets for search", async () => {
    const date = new Date("2026-11-05");
    const data = rows.map((row, i) => ({ id: String(i), quantity: String(i + 1), createdAt: date, updatedAt: date,
      warehouse: { name: "Floor", isActive: true }, chemical: { id: String(i), name: row.name, unit: "kg",
        minimumStockLevel: null, costPerUnit: "1", createdAt: date, updatedAt: date } }));
    const props = { type: "chemical" as const, warehouses: [], preselectedWarehouse: undefined, hideAddButton: true, hideActions: true };
    const { rerender } = render(<StockTable {...props} data={data} />);
    pageFour();
    expect(screen.getByText("Item 16")).toBeTruthy();
    await act(async () => { rerender(<StockTable {...props} data={data.map(row => ({ ...row, quantity: "99" }))} />); });
    await waitFor(() => expect(screen.getByText("Item 16")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Material Name/i }));
    await waitFor(() => expect(screen.getByText(/Page/).textContent).toContain("Page 4 of 5"));
    fireEvent.change(screen.getByPlaceholderText("Filter chemicals..."), { target: { value: "Item 25" } });
    expect(screen.getByText("Item 25")).toBeTruthy();
    expect(screen.getByText(/Page/).textContent).toContain("Page 1 of 1");
    fireEvent.change(screen.getByPlaceholderText("Filter chemicals..."), { target: { value: "absent" } });
    expect(screen.getByText("No matching records.")).toBeTruthy();
  });

  it("does not clamp controlled server pagination to the current page's row count", () => {
    const onPaginationChange = vi.fn();
    const { rerender } = render(<DataTable columns={columns} data={rows.slice(0, 5)} manualPagination
      pagination={{ pageIndex: 3, pageSize: 5 }} pageCount={5} autoResetPageIndex={false} onPaginationChange={onPaginationChange} />);
    rerender(<DataTable columns={columns} data={[]} manualPagination pagination={{ pageIndex: 3, pageSize: 5 }}
      pageCount={5} autoResetPageIndex={false} onPaginationChange={onPaginationChange} />);
    expect(onPaginationChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Page/).textContent).toContain("Page 4 of 5");
  });

  it("resets only explicit missing-report filtering, preserves name search and distinguishes no-purchase reports", () => {
    const date = new Date("2026-11-05");
    const data = rows.map((row, i) => ({ id: String(i), quantity: i === 0 ? "0" : "5", createdAt: date, updatedAt: date,
      warehouse: { name: "Floor", isActive: true }, chemical: { id: String(i), name: row.name, unit: "kg", minimumStockLevel: "5", costPerUnit: "1", createdAt: date, updatedAt: date,
        reportCoverage: i === 0 ? { purchaseCount: 2, missingPurchaseCount: 1, reportCount: 1 } : i === 24 ? { purchaseCount: 0, missingPurchaseCount: 0, reportCount: 0 } : { purchaseCount: 1, missingPurchaseCount: 0, reportCount: 1 } } }));
    render(<StockTable type="chemical" data={data} warehouses={[]} preselectedWarehouse={undefined} hideAddButton hideActions />);
    expect(screen.getByText("Report missing (1)")).toBeTruthy();
    expect(screen.getByText("Out of Stock")).toBeTruthy();
    expect(screen.getAllByText("Low Stock")).toHaveLength(4);
    pageFour();
    fireEvent.click(screen.getByRole("button", { name: "Missing reports (2)" }));
    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(screen.getByText("No lab reports")).toBeTruthy();
    expect(screen.getByText(/Page/).textContent).toContain("Page 1 of 1");
    fireEvent.change(screen.getByPlaceholderText("Filter chemicals..."), { target: { value: "Item 25" } });
    fireEvent.click(screen.getByRole("button", { name: "Missing reports (2)" }));
    expect(screen.getByText("Item 25")).toBeTruthy();
    expect(screen.queryByText("Item 1")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Filter chemicals..."), { target: { value: "absent" } });
    fireEvent.click(screen.getByRole("button", { name: "Missing reports (2)" }));
    expect(screen.getByText("No matching records.")).toBeTruthy();
  });

  it("keeps custom empty/loading content and supplies a loading fallback", () => {
    const { rerender } = render(<DataTable columns={columns} data={[]} isLoading />);
    expect(screen.getByText("Loading records...")).toBeTruthy();
    rerender(<DataTable columns={columns} data={[]} isLoading loadingStateComponent={<span>Custom loading</span>} />);
    expect(screen.getByText("Custom loading")).toBeTruthy();
    rerender(<DataTable columns={columns} data={[]} emptyState={<span>Custom empty</span>} />);
    expect(screen.getByText("Custom empty")).toBeTruthy();
  });
});
