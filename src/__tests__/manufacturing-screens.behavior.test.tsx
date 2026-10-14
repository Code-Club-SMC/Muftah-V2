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
  permissions: [] as string[],
  userId: "operator-1",
  run: {} as any,
  allocations: [] as any[],
  formula: {} as any,
  packagingRead: vi.fn(),
  mixingLog: vi.fn(),
  mixingComplete: vi.fn(),
  mixingFail: vi.fn(),
  mixingCancel: vi.fn(),
  packagingStart: vi.fn(),
  packagingLog: vi.fn(),
  packagingComplete: vi.fn(),
  packagingCancel: vi.fn(),
  allocationCreate: vi.fn(),
  formulaCreate: vi.fn(),
  formulaUpdate: vi.fn(),
  formulaDelete: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({
    data: { permissions: mocks.permissions, user: { id: mocks.userId } },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/mixing/get-mixing-run-fn", () => ({
  getMixingRunFn: vi.fn(async () => mocks.run),
}));
vi.mock(
  "@/server-functions/manufacturing/packaging/get-packaging-allocations-fn",
  () => ({ getPackagingAllocationsFn: mocks.packagingRead }),
);
vi.mock(
  "@/server-functions/manufacturing/formulas/get-formula-by-id-fn",
  () => ({ getFormulaByIdFn: vi.fn(async () => mocks.formula) }),
);
vi.mock("@/server-functions/manufacturing/get-assignment-options-fn", () => ({
  getManufacturingAssignmentOptionsFn: vi.fn(async () => ({
    operators: [{ id: "operator-1", name: "Operator" }],
  })),
}));
vi.mock("@/server-functions/inventory/get-products-fn", () => ({
  getProductsFn: vi.fn(async () => [{ id: "product-1", name: "Product" }]),
}));
vi.mock("@/server-functions/inventory/get-materials-fn", () => ({
  getMaterialsFn: vi.fn(async () => ({
    chemicals: [{ id: "chemical-1", name: "Chemical", unit: "kg" }],
  })),
}));
vi.mock("@/components/mixing/mixing-lab-reports", () => ({
  MixingLabReports: () => <p>Lab reports</p>,
}));
vi.mock("@/hooks/manufacturing/mixing/use-mixing-mutations", () => ({
  useStartMixingRun: () => ({ mutate: vi.fn(), isPending: false }),
  useLogMixingProgress: () => ({ mutate: mocks.mixingLog, isPending: false }),
  useCompleteMixingRun: () => ({
    mutate: mocks.mixingComplete,
    isPending: false,
  }),
  useFailMixingRun: () => ({ mutate: mocks.mixingFail, isPending: false }),
  useCancelMixingRun: () => ({ mutate: mocks.mixingCancel, isPending: false }),
}));
vi.mock("@/hooks/manufacturing/packaging/use-packaging-mutations", () => ({
  useStartPackagingAllocation: () => ({
    mutate: mocks.packagingStart,
    isPending: false,
  }),
  useLogPackagingProgress: () => ({
    mutate: mocks.packagingLog,
    isPending: false,
  }),
  useCompletePackagingAllocation: () => ({
    mutate: mocks.packagingComplete,
    isPending: false,
  }),
  useCancelPackagingAllocation: () => ({
    mutate: mocks.packagingCancel,
    isPending: false,
  }),
  useCreatePackagingAllocation: () => ({
    mutate: mocks.allocationCreate,
    isPending: false,
  }),
}));
vi.mock("@/hooks/manufacturing/formulas/use-formula-mutations", () => ({
  useCreateFormula: () => ({ mutate: mocks.formulaCreate, isPending: false }),
  useUpdateFormula: () => ({ mutate: mocks.formulaUpdate, isPending: false }),
  useDeleteFormula: () => ({ mutate: mocks.formulaDelete, isPending: false }),
}));

import { MixingConsole } from "@/components/operator/mixing-console";
import { PackagingConsole } from "@/components/operator/packaging-console";
import { MixingRunDetailsContainer } from "@/components/mixing/mixing-run-details-container";
import { PackagingAllocationsTable } from "@/components/packaging/packaging-allocations-table";
import { CreateAllocationDialog } from "@/components/packaging/create-allocation-dialog";
import { CreateFormulaDialog } from "@/components/formulas/create-formula-dialog";
import { FormulaDetailsContainer } from "@/components/formulas/formula-details-container";

const recipe = {
  id: "recipe-1",
  name: "Small pack",
  isActive: true,
  fillAmount: "10",
  fillUnit: "g",
  containersPerCarton: 6,
  cartonPackagingId: "carton-1",
};
const allocation = {
  id: "allocation-1",
  mixingRunId: "run-1",
  operatorId: "operator-1",
  status: "in_progress",
  targetContainers: 10,
  completedContainers: 2,
  recipe,
  createdAt: new Date(),
};

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

describe("manufacturing screen contracts", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.permissions = ["operator.run.read"];
    mocks.userId = "operator-1";
    mocks.formula = {
      id: "formula-1",
      productId: "product-1",
      name: "Formula",
      batchSize: "100",
      batchUnit: "kg",
      productionInstructions: "Mix slowly",
      notes: "Wear gloves",
      isActive: true,
      estimatedIngredientsCost: "10",
      ingredients: [
        {
          chemicalId: "chemical-1",
          quantityPerBatch: "1",
          chemical: { name: "Chemical", unit: "kg" },
        },
      ],
      product: { name: "Product" },
    };
    mocks.run = {
      id: "run-1",
      operatorId: "operator-1",
      batchId: "A0001",
      status: "in_progress",
      targetBulkQuantity: "10",
      actualBulkProduced: "2",
      bulkUnit: "kg",
      formula: { name: "Formula", recipes: [recipe] },
      progressLogs: [],
      materialsUsed: [],
      packagingAllocations: [],
    };
    mocks.allocations = [allocation];
    mocks.packagingRead
      .mockReset()
      .mockImplementation(async () => ({ allocations: mocks.allocations }));
    for (const key of [
      "mixingLog",
      "mixingComplete",
      "mixingFail",
      "mixingCancel",
      "packagingStart",
      "packagingLog",
      "packagingComplete",
      "packagingCancel",
      "allocationCreate",
      "formulaCreate",
      "formulaUpdate",
      "formulaDelete",
    ] as const)
      mocks[key].mockReset();
  });

  it.each(["mixing", "packaging"])(
    "hides mutation actions from a %s reader",
    async (kind) => {
      mount(
        kind === "mixing" ? (
          <MixingConsole runId="run-1" />
        ) : (
          <PackagingConsole allocationId="allocation-1" />
        ),
      );
      await screen.findByText(
        kind === "mixing" ? "Mixing Batch" : "Packing Job",
      );
      expect(
        screen.queryByRole("button", {
          name: /Record Bulk Output|Record Packed Units|Completed|Complete Packing/,
        }),
      ).toBeNull();
    },
  );
  it.each(["mixing", "packaging"])(
    "shows only log actions for the assigned %s logger",
    async (kind) => {
      mocks.permissions = ["operator.run.read", "operator.run.log"];
      mount(
        kind === "mixing" ? (
          <MixingConsole runId="run-1" />
        ) : (
          <PackagingConsole allocationId="allocation-1" />
        ),
      );
      await screen.findByRole("button", {
        name: kind === "mixing" ? "Record Bulk Output" : "Record Packed Units",
      });
      expect(
        screen.queryByRole("button", { name: /Completed|Complete Packing/ }),
      ).toBeNull();
    },
  );
  it.each(["mixing", "packaging"])(
    "shows only completion actions for the assigned %s completer",
    async (kind) => {
      mocks.permissions = ["operator.run.read", "operator.run.complete"];
      mount(
        kind === "mixing" ? (
          <MixingConsole runId="run-1" />
        ) : (
          <PackagingConsole allocationId="allocation-1" />
        ),
      );
      await screen.findByRole("button", {
        name: /Completed|Complete Packing/,
      });
      expect(
        screen.queryByRole("button", { name: /Record Bulk Output|Record Packed Units/ }),
      ).toBeNull();
    },
  );
  it.each(["mixing", "packaging"])(
    "hides assigned %s actions when a reader with work permissions opens another operator's work",
    async (kind) => {
      mocks.userId = "another-operator";
      mocks.permissions = [
        "manufacturing.run.read",
        "operator.run.log",
        "operator.run.complete",
      ];
      mount(
        kind === "mixing" ? (
          <MixingConsole runId="run-1" />
        ) : (
          <PackagingConsole allocationId="allocation-1" />
        ),
      );
      await screen.findByText(
        kind === "mixing" ? "Mixing Batch" : "Packing Job",
      );
      expect(
        screen.queryByRole("button", {
          name: /Record Bulk Output|Record Packed Units|Completed|Complete Packing/,
        }),
      ).toBeNull();
    },
  );
  it("allows a manager to start packaging while denying the same action to a reader", async () => {
    mocks.allocations = [{ ...allocation, status: "allocated" }];
    mount(<PackagingConsole allocationId="allocation-1" />);
    await screen.findByText("Packing Job");
    expect(
      screen.queryByRole("button", { name: "Start Packing Job" }),
    ).toBeNull();
    cleanup();
    mocks.permissions = ["manufacturing.run.manage"];
    mocks.userId = "manager";
    mount(<PackagingConsole allocationId="allocation-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Start Packing Job" }),
    );
    expect(mocks.packagingStart).toHaveBeenCalledWith({
      data: { allocationId: "allocation-1" },
    });
  });
  it("allows a run manager to log and complete another operator's work", async () => {
    mocks.permissions = ["manufacturing.run.manage"];
    mocks.userId = "manager";
    mount(<MixingConsole runId="run-1" />);
    await screen.findByRole("button", { name: "Record Bulk Output" });
    expect(
      screen.getByRole("button", { name: "Mark Batch as Completed" }),
    ).toBeTruthy();
    cleanup();
    mount(<PackagingConsole allocationId="allocation-1" />);
    await screen.findByRole("button", { name: "Record Packed Units" });
    expect(
      screen.getByRole("button", { name: "Complete Packing Job" }),
    ).toBeTruthy();
  });
  it("exposes failure only for an assigned zero-output batch with failure permission", async () => {
    mocks.permissions = ["operator.run.read", "operator.run.fail"];
    mocks.run.actualBulkProduced = "0";
    mount(<MixingConsole runId="run-1" />);
    const fail = await screen.findByRole("button", {
      name: "Mark zero-output batch failed",
    });
    expect((fail as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Record Bulk Output" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Mark Batch as Completed" }),
    ).toBeNull();
    fireEvent.change(
      screen.getByPlaceholderText("Reason for completing below target"),
      { target: { value: "No usable yield" } },
    );
    fireEvent.click(fail);
    expect(mocks.mixingFail).toHaveBeenCalledWith({
      data: { id: "run-1", reason: "No usable yield" },
    });
  });
  it("shows a missing allocation instead of staying in loading", async () => {
    mocks.allocations = [];
    mount(<PackagingConsole allocationId="missing" />);
    await screen.findByText("Packing job not found");
    expect(screen.queryByText("Loading packing job...")).toBeNull();
  });

  it("keeps zero-output packaging completion disabled even with a shortfall reason", async () => {
    mocks.permissions = ["operator.run.read", "operator.run.complete"];
    mocks.allocations = [{ ...allocation, completedContainers: 0 }];
    mount(<PackagingConsole allocationId="allocation-1" />);
    const complete = await screen.findByRole("button", {
      name: "Complete Packing Job",
    });
    fireEvent.change(
      screen.getByPlaceholderText("Reason for completing below target"),
      { target: { value: "No output yet" } },
    );
    expect((complete as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows a denied allocation error instead of staying in loading", async () => {
    mocks.packagingRead.mockRejectedValue(new Error("Access denied"));
    mount(<PackagingConsole allocationId="denied" />);
    await screen.findByRole("alert");
    expect(screen.getByText("Access denied")).toBeTruthy();
    expect(screen.queryByText("Loading packing job...")).toBeNull();
  });
  it("uses decimal remaining bulk and previews whole containers, full cartons, and loose units", async () => {
    mocks.run = {
      ...mocks.run,
      status: "completed",
      actualBulkProduced: "0.300",
      packagingAllocations: [
        { status: "allocated", allocatedBulkQuantity: "0.100" },
        { status: "cancelled", allocatedBulkQuantity: "0.200" },
      ],
    };
    mount(<CreateAllocationDialog runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Packing Job" }));
    const amount = await screen.findByRole("spinbutton");
    await waitFor(() => expect((amount as HTMLInputElement).max).toBe("0.2"));
    fireEvent.change(screen.getByLabelText("Packaging Format"), {
      target: { value: "recipe-1" },
    });
    fireEvent.change(amount, { target: { value: "0.200" } });
    expect((amount as HTMLInputElement).checkValidity()).toBe(true);
    expect(
      screen.getByText("20 containers · 3 full cartons · 2 loose units"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Packaging operator"), {
      target: { value: "operator-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Packing Job" }));
    expect(mocks.allocationCreate).toHaveBeenCalledWith(
      {
        data: {
          mixingRunId: "run-1",
          recipeId: "recipe-1",
          allocatedBulkQuantity: 0.2,
          operatorId: "operator-1",
        },
      },
      expect.anything(),
    );
    fireEvent.change(amount, { target: { value: "0.005" } });
    expect(
      screen.getByText("Quantity to pack is less than one container fill"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create Packing Job" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("rejects an incompatible fill unit in the allocation preview", async () => {
    mocks.run.status = "completed";
    mocks.run.formula.recipes = [{ ...recipe, fillUnit: "ml" }];
    mount(<CreateAllocationDialog runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Packing Job" }));
    await screen.findByText("Small pack (10 ml)");
    fireEvent.change(screen.getByLabelText("Packaging Format"), {
      target: { value: "recipe-1" },
    });
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1" },
    });
    expect(
      screen.getByText(
        "Packaging format fill amount and unit must match the mixing bulk unit",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create Packing Job" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("submits editable formula instructions and notes without the unused minimum yield", async () => {
    mount(<CreateFormulaDialog initialFormula={mocks.formula} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Mixing Formula" }));
    fireEvent.change(await screen.findByLabelText("Production instructions"), {
      target: { value: "Stir twice" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Check temperature" },
    });
    expect(screen.queryByLabelText("Minimum batch yield (%)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Mixing Formula" }));
    expect(mocks.formulaUpdate).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          productionInstructions: "Stir twice",
          notes: "Check temperature",
        }),
      },
      expect.anything(),
    );
    expect(mocks.formulaUpdate.mock.calls.at(-1)?.[0].data).not.toHaveProperty("minBatchYield");
  });
  it("exposes formula deactivation only to definition managers", async () => {
    mocks.permissions = ["manufacturing.manage"];
    mount(<FormulaDetailsContainer formulaId="formula-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Deactivate Mixing Formula" }),
    );
    expect(screen.queryByText("Minimum batch yield")).toBeNull();
    expect(mocks.formulaDelete).toHaveBeenCalledWith({
      data: { id: "formula-1" },
    });
  });
  it("exposes cancellation for scheduled mixing and untouched packaging", async () => {
    mocks.permissions = ["manufacturing.manage", "manufacturing.run.manage"];
    mocks.run.status = "scheduled";
    mount(<MixingRunDetailsContainer runId="run-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel Mixing Batch" }),
    );
    expect(mocks.mixingCancel).toHaveBeenCalledWith({ data: { id: "run-1" } });
    cleanup();
    mount(
      <PackagingAllocationsTable
        data={[
          { ...allocation, status: "allocated", completedContainers: 0 } as any,
        ]}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel Packing Job" }),
    );
    expect(mocks.packagingCancel).toHaveBeenCalledWith({
      data: { allocationId: "allocation-1" },
    });
  });
  it("hides cancellation for readers and started work", async () => {
    mount(
      <PackagingAllocationsTable
        data={[{ ...allocation, status: "allocated" } as any]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel Packing Job" }),
    ).toBeNull();
    cleanup();
    mocks.permissions = ["manufacturing.run.manage"];
    mount(<PackagingAllocationsTable data={[allocation as any]} />);
    expect(
      screen.queryByRole("button", { name: "Cancel Packing Job" }),
    ).toBeNull();
    cleanup();
    mount(<MixingRunDetailsContainer runId="run-1" />);
    await screen.findByText("Batch: A0001");
    expect(
      screen.queryByRole("button", { name: "Cancel Mixing Batch" }),
    ).toBeNull();
  });
});
