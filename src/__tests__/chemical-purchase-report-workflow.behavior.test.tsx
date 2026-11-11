import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseReportPrompt } from "@/components/inventory/lab-reports/purchase-report-prompt";
import { AddRawMaterialDialog } from "@/components/inventory/add-raw-material-sheet";
import { AddStockDialog } from "@/components/inventory/add-stock-dialog";
import { LabReportsList } from "@/components/inventory/lab-reports/lab-reports-list";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  buy: vi.fn(),
  restock: vi.fn(),
  similar: vi.fn(),
  reportError: false,
  permissions: ["inventory.view", "inventory.manage"],
  reports: [] as any[],
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));
vi.mock("@/hooks/inventory/use-add-raw-material", () => ({
  useAddChemical: () => ({ mutateAsync: mocks.buy }),
}));
vi.mock("@/hooks/stock/use-add-stock", () => ({
  useAddStock: () => ({
    mutateAsync: async (input: unknown, callbacks: any) => {
      const result = await mocks.restock(input);
      callbacks?.onSuccess(result);
      return result;
    },
  }),
}));
vi.mock("@/server-functions/inventory/find-similar-materials-fn", () => ({
  findSimilarMaterialsFn: mocks.similar,
}));
vi.mock("@/server-functions/suppliers/update-purchase-record-fn", () => ({
  updatePurchaseRecordFn: vi.fn(),
}));
vi.mock("@/server-functions/suppliers/get-suppliers-fn", () => ({
  getSuppliersFn: async () => [],
}));
vi.mock("@/server-functions/inventory/get-materials-fn", () => ({
  getMaterialsFn: async () => ({
    chemicals: [{ id: "c", name: "Soda", unit: "kg" }],
    packagings: [],
  }),
}));
vi.mock("@/hooks/stock/use-material-lots", () => ({
  useMaterialLots: () => ({ data: {} }),
}));
vi.mock("@/components/suppliers/payment-method-select", () => ({
  PaymentMethodSelect: () => null,
}));
vi.mock("@/hooks/inventory/use-lab-reports", () => ({
  useCreateLabReport: () => ({
    mutate: mocks.create,
    isPending: false,
    isError: mocks.reportError,
  }),
  useUpdateLabReport: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLabReport: () => ({ mutate: vi.fn(), isPending: false }),
  useLabReports: () => ({
    data: mocks.reports,
    isLoading: false,
    isError: false,
  }),
  useChemicalReportPurchases: () => ({
    data: ["p1", "p2"].map((purchaseId) => ({
      purchaseId,
      chemicalId: "c",
      chemicalName: "Soda",
      supplierName: "Supplier",
      purchaseDate: "2026-11-06",
      quantity: "100",
      unit: "kg",
      reportCount: 0,
      voidedAt: null,
    })),
    isPending: false,
    isError: false,
  }),
}));

const purchase = { purchaseId: "p2", chemicalId: "c", chemicalName: "Soda" };
const floor = {
  id: "floor",
  name: "Floor",
  type: "factory_floor",
  isActive: true,
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = ["inventory.view", "inventory.manage"];
  mocks.reports = [];
  mocks.reportError = false;
  mocks.similar.mockResolvedValue([]);
  mocks.buy.mockResolvedValue({ id: "c", purchase });
  mocks.restock.mockResolvedValue({ id: "stock", purchase });
});
function show(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["suppliers"],
    [{ id: "supplier", supplierName: "Supplier" }],
  );
  qc.setQueryData(["materials"], {
    chemicals: [{ id: "c", name: "Soda", unit: "kg" }],
    packagings: [
      { id: "pkg", name: "Bottle", type: "primary", measuredInKg: false },
    ],
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
function fillCertificate() {
  fireEvent.change(screen.getByPlaceholderText("Full name"), {
    target: { value: "Lab technician" },
  });
  for (const input of screen.getAllByPlaceholderText("e.g., 5-7"))
    fireEvent.change(input, { target: { value: "Lab supplied" } });
  for (const input of screen.getAllByPlaceholderText("e.g., 6.5"))
    fireEvent.change(input, { target: { value: "8.1" } });
  for (const button of screen.getAllByRole("button", { name: "Set result" }))
    fireEvent.click(button);
}
describe("purchase certificate workflow", () => {
  it("Later closes without inventing a certificate", () => {
    const onClose = vi.fn();
    show(<PurchaseReportPrompt purchase={purchase} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("opens a purchase-scoped form, keeps a failed report separate from the purchase, and resets for another delivery", () => {
    const onClose = vi.fn();
    const view = show(
      <PurchaseReportPrompt purchase={purchase} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    fillCertificate();
    fireEvent.click(screen.getByRole("button", { name: "Create Certificate" }));
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      purchaseId: "p2",
      chemicalId: "c",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.buy).not.toHaveBeenCalled();
    mocks.reportError = true;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PurchaseReportPrompt purchase={purchase} onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Your purchase is still saved",
    );
    mocks.reportError = false;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PurchaseReportPrompt
          purchase={{ ...purchase, purchaseId: "p1" }}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(
      screen
        .getAllByPlaceholderText("e.g., 6.5")
        .every((input) => !(input as HTMLInputElement).value),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("the actual new-chemical dialog propagates the saved purchase after its sheet closes", async () => {
    function Owner() {
      const [open, setOpen] = useState(true);
      return (
        <AddRawMaterialDialog
          open={open}
          onOpenChange={setOpen}
          warehouses={[floor] as never}
          preselectedWarehouse="floor"
          preselectedSupplierId="supplier"
        />
      );
    }
    show(<Owner />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Caustic Soda"), {
      target: { value: "Soda" },
    });
    const numbers = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(numbers[0], { target: { value: "100" } });
    fireEvent.change(numbers[1], { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Chemical" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Later" })).toBeTruthy(),
    );
    expect(mocks.buy).toHaveBeenCalledOnce();
  });
  it("the actual restock dialog propagates chemical ownership, but not packaging", async () => {
    function Owner() {
      const [open, setOpen] = useState(true);
      return (
        <AddStockDialog
          open={open}
          onOpenChange={setOpen}
          warehouses={[floor] as never}
          preselectedWarehouse="floor"
          preselectedSupplierId="supplier"
          itemToRestock={
            {
              id: "old",
              materialType: "chemical",
              quantity: "100",
              cost: "7000",
              chemical: { id: "c", name: "Soda", unit: "kg" },
            } as never
          }
        />
      );
    }
    show(<Owner />);
    fireEvent.click(screen.getByRole("button", { name: "Restock" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Later" })).toBeTruthy(),
    );
    expect(mocks.restock).toHaveBeenCalledOnce();
  });
  it("a zero-quantity material creation closes without a purchase prompt", async () => {
    mocks.buy.mockResolvedValue({ id: "c", purchase: null });
    const closed = vi.fn();
    show(
      <AddRawMaterialDialog
        open
        onOpenChange={closed}
        warehouses={[floor] as never}
        preselectedWarehouse="floor"
        preselectedSupplierId="supplier"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. Caustic Soda"), {
      target: { value: "Soda" },
    });
    const numbers = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(numbers[0], { target: { value: "0" } });
    fireEvent.change(numbers[1], { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Chemical" }));
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  });
  it("the similar-name switch gives the completed restock sole ownership of the prompt", async () => {
    mocks.similar.mockResolvedValue([
      { id: "c", name: "Soda", exact: true, stock: "10", unit: "kg" },
    ]);
    function Owner() {
      const [open, setOpen] = useState(true);
      return (
        <AddRawMaterialDialog
          open={open}
          onOpenChange={setOpen}
          warehouses={[floor] as never}
          preselectedWarehouse="floor"
          preselectedSupplierId="supplier"
        />
      );
    }
    show(<Owner />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Caustic Soda"), {
      target: { value: "Soda" },
    });
    const numbers = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(numbers[0], { target: { value: "100" } });
    fireEvent.change(numbers[1], { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Chemical" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Add stock to Soda instead" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restock" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Later" })).toHaveLength(1),
    );
    expect(mocks.buy).not.toHaveBeenCalled();
    expect(mocks.restock).toHaveBeenCalledOnce();
  });
  it("packaging restocks never open a chemical certificate prompt", async () => {
    mocks.restock.mockResolvedValue({ id: "stock", purchase: null });
    const closed = vi.fn();
    show(
      <AddStockDialog
        open
        onOpenChange={closed}
        warehouses={[floor] as never}
        preselectedWarehouse="floor"
        preselectedSupplierId="supplier"
        itemToRestock={
          {
            id: "old",
            materialType: "packaging",
            quantity: "100",
            cost: "7000",
            packagingMaterial: { id: "pkg", name: "Bottle" },
          } as never
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restock" }));
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  });
  it("read-only users see pending purchases but no create controls", () => {
    mocks.permissions = ["inventory.view"];
    show(<LabReportsList chemicalId="c" chemicalName="Soda" />);
    expect(screen.getAllByText(/Report missing/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Create|New Report/i }),
    ).toBeNull();
    expect(screen.getAllByText(/Supplier/).length).toBeGreaterThan(0);
  });
  it("clears an unsaved certificate when a purchase-scoped view changes", () => {
    const view = show(
      <LabReportsList chemicalId="c" chemicalName="Soda" purchaseId="p1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    fireEvent.change(screen.getAllByPlaceholderText("e.g., 6.5")[0], {
      target: { value: "8.1" },
    });
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LabReportsList chemicalId="c" chemicalName="Soda" purchaseId="p2" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("New Certificate of Analysis")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create report" }));
    expect(screen.getAllByText("Purchase reference: p2")).toHaveLength(2);
    expect(screen.queryByDisplayValue("8.1")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("closes mutation controls if their purchase becomes voided during a refresh", () => {
    const saved = {
      id: "saved",
      purchaseId: "p1",
      productName: "Soda",
      reportDate: "2026-11-06",
      certifiedBy: "Laboratory",
      analysisItems: [
        {
          item: "pH",
          requirement: "Lab standard",
          result: "8.1",
          passed: false,
        },
      ],
      chemical: { id: "c", name: "Soda", unit: "kg" },
      purchase: {
        supplier: { supplierName: "Supplier" },
        quantity: "100",
        voidedAt: null,
      },
    };
    mocks.reports = [saved];
    const view = show(<LabReportsList chemicalId="c" chemicalName="Soda" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit report" }));
    expect(screen.getByText("Edit Certificate of Analysis")).toBeTruthy();
    mocks.reports = [
      { ...saved, purchase: { ...saved.purchase, voidedAt: "2026-11-06" } },
    ];
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LabReportsList chemicalId="c" chemicalName="Soda" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Edit Certificate of Analysis")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit report" })).toBeNull();
    expect(screen.getByText("Voided, read-only")).toBeTruthy();
  });
  it("labels independently saved certificates and legacy reports, and keeps voided certificates read-only", () => {
    const report = {
      productName: "Soda",
      reportDate: "2026-11-06",
      certifiedBy: "Laboratory",
      analysisItems: [
        {
          item: "pH",
          requirement: "Lab standard",
          result: "8.1",
          passed: false,
        },
      ],
      chemical: { id: "c", name: "Soda", unit: "kg" },
    };
    mocks.reports = [
      {
        ...report,
        id: "one",
        purchaseId: "p1",
        purchase: {
          quantity: "100",
          supplier: { supplierName: "Supplier" },
          voidedAt: "2026-11-06",
        },
      },
      {
        ...report,
        id: "two",
        purchaseId: "p2",
        purchase: {
          quantity: "100",
          supplier: { supplierName: "Supplier" },
          voidedAt: null,
        },
        analysisItems: [
          { ...report.analysisItems[0], result: "9.2", passed: true },
        ],
      },
      { ...report, id: "legacy", purchaseId: null, purchase: null },
    ];
    show(<LabReportsList chemicalId="c" chemicalName="Soda" />);
    expect(screen.getByText("Legacy / purchase unassigned")).toBeTruthy();
    const voided =
      screen.getByText("Voided, read-only").parentElement!.parentElement!;
    expect(
      within(voided).getByRole("button", { name: "View certificate" }),
    ).toBeTruthy();
    expect(
      within(voided).queryByRole("button", { name: "Edit report" }),
    ).toBeNull();
    expect(
      within(voided).getByRole("button", { name: "Delete report" }),
    ).toBeTruthy();
    fireEvent.click(within(voided).getByRole("button", { name: "Delete report" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Certificates for purchase p2")).toBeTruthy();
    expect(screen.getByText("1/1 passed")).toBeTruthy();
  });
});
