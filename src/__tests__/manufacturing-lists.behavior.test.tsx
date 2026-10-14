import { Suspense } from "react";
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

const mocks = vi.hoisted(() => ({
  formulas: vi.fn(),
  mixing: vi.fn(),
  jobs: vi.fn(),
}));
vi.mock("@/server-functions/manufacturing/formulas/get-formulas-fn", () => ({
  getFormulasFn: mocks.formulas,
}));
vi.mock("@/server-functions/manufacturing/mixing/get-mixing-runs-fn", () => ({
  getMixingRunsFn: mocks.mixing,
}));
vi.mock(
  "@/server-functions/manufacturing/packaging/get-paginated-packaging-allocations-fn",
  () => ({
    getPaginatedPackagingAllocationsFn: mocks.jobs,
  }),
);
vi.mock("@/hooks/manufacturing/packaging/use-packaging-mutations", () => ({
  useCancelPackagingAllocation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/formulas/create-formula-dialog", () => ({
  CreateFormulaDialog: () => <button>Create Mixing Formula</button>,
}));
vi.mock("@/components/mixing/create-mixing-run-dialog", () => ({
  CreateMixingRunDialog: () => <button>Create Mixing Batch</button>,
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: ["*"] } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

import { FormulasContainer } from "@/components/formulas/formulas-container";
import { MixingRunsContainer } from "@/components/mixing/mixing-runs-container";
import { MixingOperatorInterface } from "@/components/operator/mixing-operator-interface";
import { PackagingAllocationsContainer } from "@/components/packaging/packaging-allocations-container";

const formulas = Array.from({ length: 11 }, (_, index) => ({
  id: `formula-${index + 1}`,
  name: `Formula ${index + 1}`,
  product: { name: "Product" },
  batchSize: "10",
  batchUnit: "kg",
  estimatedIngredientsCost: "10",
  isActive: true,
  createdAt: new Date(),
}));
const runs = Array.from({ length: 11 }, (_, index) => ({
  id: `run-${index + 1}`,
  batchId: `A${String(index + 1).padStart(4, "0")}`,
  formulaName: `Formula ${index + 1}`,
  targetBulkQuantity: "10",
  actualBulkProduced: "0",
  bulkUnit: "kg",
  status: "in_progress",
  createdAt: new Date(),
}));
const jobs = Array.from({ length: 11 }, (_, index) => ({
  id: `job-${index + 1}`,
  mixingRun: { batchId: `A${String(index + 1).padStart(4, "0")}` },
  recipe: { name: `Format ${index + 1}` },
  status: "in_progress",
  allocatedBulkQuantity: "10",
  allocatedBulkUnit: "kg",
  targetContainers: 10,
  completedContainers: 5,
  createdAt: new Date(),
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

describe("manufacturing lists", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.formulas.mockReset().mockImplementation(async ({ data }) => {
      const matching = formulas.filter(
        (formula) =>
          formula.name
            .toLowerCase()
            .includes((data.search ?? "").toLowerCase()) &&
          (!data.statusFilter ||
            formula.isActive === (data.statusFilter === "active")),
      );
      const page = data.pageIndex ?? 0;
      const size = data.pageSize ?? 10;
      return {
        formulas: matching.slice(page * size, (page + 1) * size),
        totalCount: matching.length,
        kpis: {
          total: matching.length,
          active: matching.length,
          inactive: 0,
          products: matching.length ? 1 : 0,
        },
      };
    });
    mocks.mixing.mockReset().mockImplementation(async ({ data }) => {
      const matching = runs.filter(
        (run) =>
          (!data.status || data.status === run.status) &&
          run.batchId.includes(data.search ?? ""),
      );
      const page = data.page ?? 1;
      const limit = data.limit ?? 10;
      return {
        runs: matching.slice((page - 1) * limit, page * limit),
        pagination: {
          page,
          limit,
          total: matching.length,
          totalPages: Math.ceil(matching.length / limit),
        },
        kpis: {
          total: matching.length,
          active: matching.length,
          completed: 0,
          completionPercentage: 0,
          averageYieldPercentage: null,
        },
      };
    });
    mocks.jobs.mockReset().mockImplementation(async ({ data }) => {
      const matching = jobs.filter(
        (job) =>
          (!data.status || job.status === data.status) &&
          [job.id, job.mixingRun.batchId, job.recipe.name].some((value) =>
            value.includes(data.search ?? ""),
          ),
      );
      return {
        allocations: matching.slice(
          data.pageIndex * data.pageSize,
          (data.pageIndex + 1) * data.pageSize,
        ),
        totalCount: matching.length,
        kpis: {
          scheduled: 0,
          active: matching.length,
          completedContainers: matching.length * 5,
          targetContainers: matching.length * 10,
          packingPercentage: matching.length ? 50 : 0,
        },
      };
    });
  });

  it("requests the second formula page and searches all formulas", async () => {
    mount(<FormulasContainer />);
    await screen.findByText("Formula 1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Formula 11");
    expect(mocks.formulas).toHaveBeenCalledWith({
      data: expect.objectContaining({ pageIndex: 1 }),
    });
    fireEvent.change(screen.getByPlaceholderText("Filter..."), {
      target: { value: "Formula 11" },
    });
    await waitFor(() =>
      expect(mocks.formulas).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ search: "Formula 11", pageIndex: 0 }),
      }),
    );
    await screen.findByText("Formula 11");
    fireEvent.change(screen.getByPlaceholderText("Filter..."), {
      target: { value: "no match" },
    });
    await screen.findByText("No mixing formulas match your search");
    expect(screen.getByPlaceholderText("Filter...")).toBeTruthy();
  });

  it("requests the second mixing page and searches all batch IDs", async () => {
    mount(<MixingRunsContainer />);
    await screen.findByText("A0001");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("A0011");
    expect(mocks.mixing).toHaveBeenCalledWith({
      data: expect.objectContaining({ page: 2 }),
    });
    fireEvent.change(screen.getByPlaceholderText("Filter..."), {
      target: { value: "A0011" },
    });
    await waitFor(() =>
      expect(mocks.mixing).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ search: "A0011", page: 1 }),
      }),
    );
    await screen.findByText("A0011");
  });

  it("initializes formula and mixing searches from the route search value", async () => {
    mount(<FormulasContainer initialSearch="Formula 11" />);
    await screen.findByText("Formula 11");
    expect(
      (screen.getByPlaceholderText("Filter...") as HTMLInputElement).value,
    ).toBe("Formula 11");
    expect(mocks.formulas).toHaveBeenCalledWith({
      data: expect.objectContaining({ search: "Formula 11", pageIndex: 0 }),
    });
    cleanup();
    mount(<MixingRunsContainer initialSearch="A0011" />);
    await screen.findByText("A0011");
    expect(
      (screen.getByPlaceholderText("Filter...") as HTMLInputElement).value,
    ).toBe("A0011");
    expect(mocks.mixing).toHaveBeenCalledWith({
      data: expect.objectContaining({ search: "A0011", page: 1 }),
    });
  });

  it("exposes the eleventh active assigned mixing run", async () => {
    mount(<MixingOperatorInterface />);
    await screen.findByText("#A0001");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("#A0011");
    expect(mocks.mixing).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        page: 2,
        statuses: ["in_progress", "scheduled", "completed"],
      }),
    });
    fireEvent.change(screen.getByLabelText("Search assigned mixing batches"), {
      target: { value: "A0011" },
    });
    await waitFor(() =>
      expect(mocks.mixing).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ page: 1, search: "A0011" }),
      }),
    );
    await screen.findByText("#A0011");
  });

  it.each([
    [
      "mixing",
      <MixingRunsContainer />,
      mocks.mixing,
      "completed",
      "No mixing batches match your search",
    ],
    [
      "formulas",
      <FormulasContainer />,
      mocks.formulas,
      "inactive",
      "No mixing formulas match your search",
    ],
    [
      "jobs",
      <PackagingAllocationsContainer />,
      mocks.jobs,
      "completed",
      "No packing jobs match your filters",
    ],
  ])(
    "applies date and status filters, resets %s pagination and preserves filters for zero matches",
    async (kind, component, read, status, empty) => {
      mount(component);
      await screen.findByLabelText("Created from");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(read).toHaveBeenLastCalledWith({
          data: expect.objectContaining(
            kind === "mixing" ? { page: 2 } : { pageIndex: 1 },
          ),
        }),
      );
      fireEvent.change(screen.getByLabelText("Created from"), {
        target: { value: "2026-10-08" },
      });
      fireEvent.change(screen.getByLabelText("Created to"), {
        target: { value: "2026-10-08" },
      });
      fireEvent.change(screen.getByLabelText("Status"), {
        target: { value: status },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
      await screen.findByText(empty);
      expect(read).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          from: "2026-10-08",
          to: "2026-10-08",
          ...(kind === "mixing" ? { page: 1 } : { pageIndex: 0 }),
          ...(kind === "formulas" ? { statusFilter: status } : { status }),
        }),
      });
      expect(screen.getByLabelText("Created from")).toBeTruthy();
      expect(screen.getByLabelText("Status")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      await waitFor(() => expect(screen.queryByText(empty)).toBeNull());
      expect(
        (screen.getByLabelText("Created from") as HTMLInputElement).value,
      ).toBe("");
    },
  );

  it("rejects a reversed date range in the UI without fetching it", async () => {
    mount(<MixingRunsContainer />);
    await screen.findByLabelText("Created from");
    fireEvent.change(screen.getByLabelText("Created from"), {
      target: { value: "2026-10-09" },
    });
    fireEvent.change(screen.getByLabelText("Created to"), {
      target: { value: "2026-10-08" },
    });
    const calls = mocks.mixing.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "End date must be on or after start date",
    );
    expect(mocks.mixing.mock.calls).toHaveLength(calls);
  });

  it("requests the second job page and searches formats on the server", async () => {
    mount(<PackagingAllocationsContainer />);
    await screen.findByText("Format 1");
    const card = screen
      .getByText("Packed containers")
      .closest('[data-slot="card"]')!;
    expect(within(card as HTMLElement).getByText("55")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Format 11");
    expect(mocks.jobs).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ pageIndex: 1 }),
    });
    fireEvent.change(
      screen.getByPlaceholderText("Search job, batch, or format..."),
      { target: { value: "Format 11" } },
    );
    await waitFor(() =>
      expect(mocks.jobs).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ pageIndex: 0, search: "Format 11" }),
      }),
    );
    await screen.findByText("Format 11");
    expect(screen.queryByText("Format 1")).toBeNull();
  });

  it("renders filtered total KPIs beyond the current ten-row page", async () => {
    mount(<FormulasContainer />);
    await screen.findByText("Formula 1");
    const card = screen
      .getByText("Mixing formulas")
      .closest('[data-slot="card"]')!;
    expect(within(card as HTMLElement).getByText("11")).toBeTruthy();
    expect(screen.queryByText("Formula 11")).toBeNull();
  });
});
