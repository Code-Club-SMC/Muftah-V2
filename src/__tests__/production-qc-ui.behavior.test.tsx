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
  permissions: ["manufacturing.qc.manage"] as string[],
  reports: [] as any[],
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  batches: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));
vi.mock("@/server-functions/manufacturing/mixing/lab-reports-fn", () => ({
  getProductionQCBatchesFn: mocks.batches,
  getMixingLabReportsFn: mocks.read,
  createMixingLabReportFn: mocks.create,
  updateMixingLabReportFn: mocks.update,
  deleteMixingLabReportFn: mocks.delete,
}));
import { ProductionQCContainer } from "@/components/production-qc/production-qc-container";
import { MixingLabReports } from "@/components/mixing/mixing-lab-reports";

const report = {
  id: "report-1",
  mixingRunId: "batch-1",
  productName: "Dishwash",
  stockNumber: "S100",
  lotNumber: "L100",
  certifiedBy: "QA Operator",
  certifierTitle: "QC Officer",
  reportDate: new Date("2026-10-08T00:00:00Z"),
  standardReference: "Product spec 4",
  notes: "Retested",
  createdBy: { id: "user-1", name: "QC recorder" },
  analysisItems: [
    {
      item: "Appearance",
      requirement: "Uniform",
      result: "Clear",
      passed: true,
    },
    { item: "pH", requirement: "6 to 7", result: "7.1", passed: false },
  ],
};
function mount(component: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>,
  );
}

describe("production QC reports UI", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocks.permissions = ["manufacturing.qc.manage"];
    mocks.reports = [];
    mocks.read
      .mockReset()
      .mockImplementation(async ({ data }) =>
        mocks.reports.filter((row) => row.mixingRunId === data.mixingRunId),
      );
    mocks.batches.mockReset().mockResolvedValue({
      batches: [
        {
          id: "batch-1",
          batchId: "A0001",
          productName: "Dishwash",
          formulaName: "Dishwash base",
          status: "completed",
          actualBulkProduced: "99",
          targetBulkQuantity: "100",
          bulkUnit: "kg",
        },
        {
          id: "batch-2",
          batchId: "A0002",
          productName: "Cleaner",
          formulaName: "Cleaner base",
          status: "in_progress",
          actualBulkProduced: "20",
          targetBulkQuantity: "100",
          bulkUnit: "liters",
        },
      ],
      hasMore: false,
      page: 1,
    });
    mocks.create.mockReset().mockImplementation(async ({ data }) => {
      const created = {
        ...report,
        ...data,
        id: "new-report",
        productName: "Dishwash",
        reportDate: new Date(data.reportDate),
      };
      mocks.reports.push(created);
      return created;
    });
    mocks.update.mockReset().mockImplementation(async ({ data }) => {
      const index = mocks.reports.findIndex((row) => row.id === data.reportId);
      mocks.reports[index] = {
        ...mocks.reports[index],
        ...data,
        reportDate: new Date(data.reportDate),
      };
      return mocks.reports[index];
    });
    mocks.delete.mockReset().mockImplementation(async ({ data }) => {
      mocks.reports = mocks.reports.filter((row) => row.id !== data.reportId);
      return { success: true };
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("selects a batch, submits customizable multiple checks and all certification fields", async () => {
    mount(<ProductionQCContainer />);
    fireEvent.click(await screen.findByRole("button", { name: /A0001/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create quality report" }),
    );
    expect(screen.getAllByLabelText("Check name *")).toHaveLength(6);
    expect(screen.getByLabelText("Lot number").getAttribute("value")).toBe(
      "A0001",
    );
    for (let number = 6; number >= 3; number--)
      fireEvent.click(
        screen.getByRole("button", { name: `Remove check ${number}` }),
      );
    fireEvent.change(screen.getAllByLabelText("Check name *")[0], {
      target: { value: "Texture" },
    });
    fireEvent.change(screen.getAllByLabelText("Requirement *")[0], {
      target: { value: "Smooth" },
    });
    fireEvent.change(screen.getAllByLabelText("Result *")[0], {
      target: { value: "Smooth" },
    });
    fireEvent.change(screen.getAllByLabelText("Result *")[1], {
      target: { value: "Matches sample" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Passed check 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add analysis check" }));
    fireEvent.change(screen.getAllByLabelText("Check name *")[2], {
      target: { value: "Density" },
    });
    fireEvent.change(screen.getAllByLabelText("Requirement *")[2], {
      target: { value: "1.1 g/ml" },
    });
    fireEvent.change(screen.getAllByLabelText("Result *")[2], {
      target: { value: "1.2 g/ml" },
    });
    for (const [label, value] of [
      ["Certified by *", "QA Operator"],
      ["Certifier title", "QC Officer"],
      ["Report date *", "2026-10-08"],
      ["Stock number", "S100"],
      ["Lot number", "L100"],
      ["Standard reference", "Product spec 4"],
      ["Notes", "Density requires review"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save quality report" }),
    );
    await waitFor(() =>
      expect(mocks.create.mock.calls[0]?.[0]).toEqual({
        data: {
          mixingRunId: "batch-1",
          certifiedBy: "QA Operator",
          certifierTitle: "QC Officer",
          reportDate: "2026-10-08",
          stockNumber: "S100",
          lotNumber: "L100",
          standardReference: "Product spec 4",
          notes: "Density requires review",
          analysisItems: [
            {
              item: "Texture",
              requirement: "Smooth",
              result: "Smooth",
              passed: true,
            },
            {
              item: "Colour",
              requirement: "Matches product specification",
              result: "Matches sample",
              passed: false,
            },
            {
              item: "Density",
              requirement: "1.1 g/ml",
              result: "1.2 g/ml",
              passed: false,
            },
          ],
        },
      }),
    );
    await screen.findByText("1/3 checks passed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows every certificate field, edits the selected report and deletes only after confirmation", async () => {
    mocks.reports = [report];
    mount(<MixingLabReports mixingRunId="batch-1" batchId="A0001" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "View certificate" }),
    );
    const certificate = screen.getByRole("dialog");
    for (const value of [
      "S100",
      "L100",
      "QC Officer",
      "Product spec 4",
      "QC recorder",
      "Uniform",
      "Clear",
      "6 to 7",
      "7.1",
    ]) {
      expect(within(certificate).getByText(value)).toBeTruthy();
    }
    expect(
      within(certificate).getByText("Failed checks recorded"),
    ).toBeTruthy();
    fireEvent.click(within(certificate).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit report" }));
    expect(screen.getAllByLabelText("Check name *")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Rechecked" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save quality report" }),
    );
    await waitFor(() =>
      expect(mocks.update.mock.calls[0]?.[0]).toEqual({
        data: expect.objectContaining({
          mixingRunId: "batch-1",
          reportId: "report-1",
          notes: "Rechecked",
          analysisItems: report.analysisItems,
        }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    expect(mocks.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(mocks.delete.mock.calls[0]?.[0]).toEqual({
        data: { reportId: "report-1", mixingRunId: "batch-1" },
      }),
    );
    await screen.findByText("No quality reports");
  });

  it.each(["manufacturing.qc.read", "operator.run.read"])(
    "gives %s a readable certificate with no mutation actions",
    async (permission) => {
      mocks.permissions = [permission];
      mocks.reports = [report];
      mount(<MixingLabReports mixingRunId="batch-1" />);
      await screen.findByRole("button", { name: "View certificate" });
      for (const name of [
        "Create quality report",
        "Edit report",
        "Delete report",
      ])
        expect(screen.queryByRole("button", { name })).toBeNull();
    },
  );

  it("keeps a failed deletion open with its error and allows retry", async () => {
    mocks.reports = [report];
    mocks.delete.mockRejectedValueOnce(new Error("Could not delete report"));
    mount(<MixingLabReports mixingRunId="batch-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete report" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Could not delete report");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("No quality reports");
  });
});
