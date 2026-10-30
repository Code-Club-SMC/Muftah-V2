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
  context: vi.fn(),
  record: vi.fn(),
  request: vi.fn(),
  lots: vi.fn(),
}));
vi.mock("@/hooks/stock/use-material-lots", () => ({
  useMaterialLots: (_warehouseId: string, _type: string, ids: string[]) => ({
    data: ids.length ? mocks.lots() : undefined,
    error: null,
  }),
}));
vi.mock(
  "@/server-functions/manufacturing/packaging/get-batch-packing-context-fn",
  () => ({
    getBatchPackingContextFn: mocks.context,
    getBatchPackingRequestFn: mocks.request,
  }),
);
vi.mock(
  "@/server-functions/manufacturing/packaging/record-batch-packing-fn",
  () => ({ recordBatchPackingFn: mocks.record }),
);
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({
    data: { user: { id: "operator-1" } },
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { BatchPackingForm } from "@/components/packaging/batch-packing-form";

const format = (
  id: string,
  name: string,
  fillAmount: string,
  capacity: number,
) => ({
  id,
  name,
  fillAmount,
  fillUnit: "g",
  containersPerCarton: capacity,
  usesCartons: capacity > 0,
});
function context() {
  return {
    batch: {
      id: "batch-1",
      batchId: "A0123",
      formulaName: "S-was powder",
      bulkUnit: "kg",
      producedBulk: "500.000",
      availableBulk: "500.000",
      canRecord: true,
    },
    formats: [
      format("100", "Rs.100", "250", 40),
      format("200", "Rs.200", "500", 20),
      format("150", "Rs.150", "400", 25),
      format("300", "Rs.300", "1000", 0),
    ],
    receipts: [],
    legacyOpenJobs: 0,
    warehouseId: "floor-1",
    formatMaterials: ["100", "200", "150", "300"].map((formatId) => ({
      formatId,
      containerPackagingId: "pouch",
      cartonPackagingId: formatId === "300" ? null : "carton",
    })),
    extras: [],
    materials: [
      { id: "pouch", name: "Pouch", measuredInKg: false, weightPerPack: null },
      { id: "carton", name: "Carton", measuredInKg: false, weightPerPack: null },
    ],
  };
}
const lot = (lotId: string, unitPrice: string, quantity: string, day: string) => ({
  lotId,
  unitPrice,
  quantity,
  firstPurchasedAt: `2026-10-${day}T05:00:00Z`,
});
const oneLotEach = () => ({
  pouch: [lot("pouch-a", "2.00", "100000.000", "01")],
  carton: [lot("carton-a", "5.00", "1000.000", "01")],
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <BatchPackingForm mixingRunId="batch-1" />
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
async function add(id: string) {
  fireEvent.change(await screen.findByLabelText("Pack format"), {
    target: { value: id },
  });
}
function count(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const storageKey = "titan:batch-packing:v1:operator-1:batch-1";

describe("batch packing operator form", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.context.mockResolvedValue(context());
    mocks.record.mockResolvedValue({
      success: true,
      receiptId: "receipt-1",
      mixingRunId: "batch-1",
    });
    mocks.request.mockResolvedValue({ status: "not_found" });
    mocks.lots.mockReturnValue(oneLotEach());
  });
  afterEach(cleanup);

  it("records the complete 500kg split in one confirmation and clears the draft", async () => {
    mount();
    await add("100");
    count("Rs.100: Full cartons", "20");
    await add("200");
    count("Rs.200: Full cartons", "10");
    await add("150");
    count("Rs.150: Full cartons", "10");
    await add("300");
    count("Rs.300: Loose packs", "100");
    expect(
      screen.getByText("All available bulk is accounted for."),
    ).toBeTruthy();
    expect(mocks.record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review packing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm & add to finished goods" }),
    );
    await screen.findByText("Packing saved");
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record.mock.calls[0][0].data.lines).toEqual([
      { recipeId: "100", fullCartons: 20, partialPacks: 0, loosePacks: 0 },
      { recipeId: "200", fullCartons: 10, partialPacks: 0, loosePacks: 0 },
      { recipeId: "150", fullCartons: 10, partialPacks: 0, loosePacks: 0 },
      { recipeId: "300", fullCartons: 0, partialPacks: 0, loosePacks: 100 },
    ]);
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  });

  it("asks for carton lots and blocks review until they add up", async () => {
    mocks.lots.mockReturnValue({
      ...oneLotEach(),
      carton: [lot("carton-a", "5.00", "1.000", "01"), lot("carton-b", "6.00", "5.000", "20")],
    });
    mount();
    await add("100");
    count("Rs.100: Full cartons", "2");
    expect(screen.getByText("Carton: 2 pcs needed")).toBeTruthy();
    const review = screen.getByRole("button", { name: "Review packing" }) as HTMLButtonElement;
    const older = () => screen.getByLabelText("Lot 1 Oct, 1 pcs here") as HTMLInputElement;
    const newer = () => screen.getByLabelText("Lot 20 Oct, 5 pcs here") as HTMLInputElement;
    // Pre-filled oldest first, with no prices shown.
    expect([older().value, newer().value]).toEqual(["1.000", "1.000"]);
    expect(screen.queryByText(/Rs \d+\/pcs/)).toBeNull();
    count("Lot 20 Oct, 5 pcs here", "");
    expect(review.disabled).toBe(true);
    count("Lot 1 Oct, 1 pcs here", "");
    count("Lot 20 Oct, 5 pcs here", "2");
    expect(screen.getByText("Carton: use the oldest stock first. Take 1 pcs from Lot 1 Oct before a newer lot.")).toBeTruthy();
    expect(review.disabled).toBe(true);
    count("Lot 1 Oct, 1 pcs here", "1");
    count("Lot 20 Oct, 5 pcs here", "1");
    expect(review.disabled).toBe(false);
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("button", { name: "Confirm & add to finished goods" }));
    await screen.findByText("Packing saved");
    expect(mocks.record.mock.calls[0][0].data.lotPicks).toEqual(
      expect.arrayContaining([
        { materialId: "pouch", picks: [{ lotId: "pouch-a", quantity: "80.000" }], used: "80" },
        { materialId: "carton", picks: expect.arrayContaining([{ lotId: "carton-a", quantity: "1" }, { lotId: "carton-b", quantity: "1" }]), used: "2" },
      ]),
    );
  });

  it("calculates whole packs from kg and shows the powder remainder", async () => {
    mocks.context.mockResolvedValue({
      ...context(),
      formats: [format("test", "300g pack", "300", 20)],
    });
    mount();
    await add("test");
    fireEvent.click(screen.getByRole("radio", { name: "Calculate from kg" }));
    count("Amount to calculate (kg)", "100");
    fireEvent.click(
      screen.getByRole("button", { name: "Calculate pack counts" }),
    );
    expect(
      await screen.findByText(/333 whole packs\. 0.1 kg remains/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("300g pack: Full cartons") as HTMLInputElement)
        .value,
    ).toBe("16");
    expect(
      (screen.getByLabelText("300g pack: Loose packs") as HTMLInputElement)
        .value,
    ).toBe("13");
  });

  it("keeps loose packs loose even above carton capacity and blocks overdraw", async () => {
    mount();
    await add("100");
    count("Rs.100: Loose packs", "2001");
    expect(
      screen.getByText(/exceed the available bulk by 0.25 kg/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Review packing",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    count("Rs.100: Loose packs", "800");
    const row = screen.getByRole("region", { name: "Packing format Rs.100" });
    expect(
      within(row).getByText("800 packs · 0 physical cartons"),
    ).toBeTruthy();
  });

  it("restores counts after refresh without posting stock", async () => {
    const first = mount();
    await add("100");
    count("Rs.100: Full cartons", "20");
    await waitFor(() =>
      expect(localStorage.getItem(storageKey)).toContain('"fullCartons":"20"'),
    );
    first.unmount();
    mount();
    expect(
      (
        (await screen.findByLabelText(
          "Rs.100: Full cartons",
        )) as HTMLInputElement
      ).value,
    ).toBe("20");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("preserves the exact payload across a failed response and retry", async () => {
    mocks.record.mockRejectedValueOnce(new Error("Connection interrupted"));
    mount();
    await add("300");
    count("Rs.300: Loose packs", "100");
    fireEvent.click(screen.getByRole("button", { name: "Review packing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm & add to finished goods" }),
    );
    await screen.findByText("Connection interrupted");
    expect(
      (screen.getByLabelText("Rs.300: Loose packs") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry confirmation" }));
    await screen.findByText("Packing saved");
    expect(mocks.record.mock.calls[1][0].data).toEqual(
      mocks.record.mock.calls[0][0].data,
    );
  });

  it("checks the saved request before allowing corrections after a rejection", async () => {
    mocks.record.mockRejectedValueOnce(new Error("Not enough pouches"));
    mount();
    await add("300");
    count("Rs.300: Loose packs", "100");
    fireEvent.click(screen.getByRole("button", { name: "Review packing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm & add to finished goods" }),
    );
    await screen.findByText("Not enough pouches");
    fireEvent.click(
      screen.getByRole("button", { name: "Check result before editing" }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Rs.300: Loose packs") as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    expect(mocks.request).toHaveBeenCalledWith({
      data: {
        mixingRunId: "batch-1",
        requestId: mocks.record.mock.calls[0][0].data.requestId,
      },
    });
    expect(
      (screen.getByLabelText("Rs.300: Loose packs") as HTMLInputElement).value,
    ).toBe("100");
  });

  it("refreshes inventory caches when a lost response is recovered by checking its receipt", async () => {
    mocks.record.mockRejectedValueOnce(new Error("Connection interrupted"));
    mocks.request.mockResolvedValue({ status: "posted", receiptId: "receipt-1" });
    const { client } = mount();
    client.setQueryData(["factory-floor"], { old: true });
    client.setQueryData(["inventory"], { old: true });
    client.setQueryData(["cartons"], { old: true });
    await add("300"); count("Rs.300: Loose packs", "100");
    fireEvent.click(screen.getByRole("button", { name: "Review packing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & add to finished goods" }));
    await screen.findByText("Connection interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Check result before editing" }));
    await screen.findByText("Packing saved");
    for (const key of ["factory-floor", "inventory", "cartons"]) {
      expect(client.getQueryState([key])?.isInvalidated).toBe(true);
    }
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it("provides no posting action to a read-only viewer", async () => {
    mocks.context.mockResolvedValue({
      ...context(),
      batch: { ...context().batch, canRecord: false },
    });
    mount();
    await screen.findByText("Viewing packing records");
    expect(screen.queryByRole("button", { name: "Review packing" })).toBeNull();
    expect(screen.queryByLabelText("Pack format")).toBeNull();
  });
});
