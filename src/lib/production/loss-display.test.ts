// src/lib/production/loss-display.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LOSS_LIMITS, toBatchRow, toChemicalRow, toPackingRow, toStoreRow, type LossRow } from "./loss-report";
import {
  filterLossRows, formatLossMoney, formatLossQuantity, formatLossRange, lossColumns, lossFilterOptions, lossFiltersText, lossStripTotals, lossSummary, pageLossRows,
} from "./loss-display";

const limits = DEFAULT_LOSS_LIMITS;
const run = (id: string, product = "Surf Powder") => ({ runId: id, batchId: `A${id}`, date: new Date("2026-10-12T06:00:00Z"), productId: `p-${product}`, product });
const batch = (id: string, target: string, actual: string, unit = "kg", reasonCode: string | null = "spill") =>
  toBatchRow({ ...run(id), target, actual, unit, chemicalCost: "150575", reasonCode, note: null, formulaId: "f1", formula: "F" }, limits);

describe("formatting", () => {
  it("shows whole rupees with Lac grouping and short unit names", () => {
    expect(formatLossMoney("108000.40")).toBe("1,08,000");
    expect(formatLossMoney("1505.75")).toBe("1,506");
    expect(formatLossQuantity("100.000", "kg")).toBe("100 KG");
    expect(formatLossQuantity("2.5", "liters")).toBe("2.50 L");
  });
});

describe("columns and totals", () => {
  it("prints the batch row cells in the spec's column order", () => {
    const columns = lossColumns("batch");
    expect(columns.map((c) => c.label)).toEqual(["Date", "Batch", "Product", "Target", "Actual", "Loss", "Loss %", "Loss Rs", "Reason"]);
    expect(columns.map((c) => c.cell(batch("1", "500", "400")))).toEqual(["12 Oct 2026", "A1", "Surf Powder", "500 KG", "400 KG", "100 KG", "20.0%", "30,115", "Spill"]);
  });
  it("totals one unit with a loss %, and lists mixed units without one", () => {
    const columns = lossColumns("batch");
    const total = (rows: LossRow[]) => columns.map((c) => c.total?.(rows) ?? "");
    expect(total([batch("1", "500", "400"), batch("2", "500", "490")])).toEqual(["Total", "", "", "1,000 KG", "890 KG", "110 KG", "11.0%", "33,127", ""]);
    expect(total([batch("1", "500", "400"), batch("2", "200", "190", "liters")])[5]).toBe("100 KG · 10 L");
    expect(total([batch("1", "500", "400"), batch("2", "200", "190", "liters")])[6]).toBe("");
  });
  it("shows check weight on a shopper row and leaves it out of totals", () => {
    const shopper = (id: string, expected: number, actual: number, extraCost: string) => toPackingRow({ ...run(id), useId: id, materialId: "s", material: "Shopper", measuredInKg: true, needed: "0", used: "1.2", extraQuantity: "0", extraCost, reasonCode: null, note: null, expectedShoppers: expected, actualShoppers: actual, lossShoppers: expected - actual }, limits);
    const rows = [shopper("1", 1200, 1080, "62.40"), shopper("2", 1000, 1010, "0.00")];
    const columns = lossColumns("packing");
    expect(columns.find((c) => c.key === "loss")!.cell(rows[1])).toBe("-10 · check weight");
    expect(columns.find((c) => c.key === "cost")!.total!(rows)).toBe("62");
    expect(lossFilterOptions("packing", rows).find((o) => o.key === "reason")!.options).toEqual([{ value: "measured", label: "Measured" }]);
    expect(filterLossRows("packing", rows, { reason: "measured" }, false)).toHaveLength(2);
    expect(lossSummary("packing", rows)).toEqual([
      { label: "Loss cost", value: "Rs 62" }, { label: "Shopper loss %", value: "10.0%" }, { label: "Most-lost material", value: "Shopper" },
    ]);
  });
});

describe("summaries", () => {
  it("summarises batch loss per unit", () => {
    expect(lossSummary("batch", [batch("1", "500", "400"), batch("2", "500", "490")])).toEqual([
      { label: "Target", value: "1,000 KG" }, { label: "Actual", value: "890 KG" }, { label: "Loss", value: "110 KG (11.0%)" }, { label: "Loss cost", value: "Rs 33,127" },
    ]);
  });
  it("names the chemical with the highest loss cost", () => {
    const chem = (id: string, chemical: string, extraCost: string) => toChemicalRow({ ...run(id), useId: id, chemicalId: chemical, chemical, unit: "kg", formula: "50", used: "55", extraCost, reasonCode: "spill", note: null }, limits);
    expect(lossSummary("chemical", [chem("1", "Soda Ash", "575"), chem("2", "LABSA", "300"), chem("3", "LABSA", "400")])[2]).toEqual({ label: "Most-lost chemical", value: "LABSA" });
  });
  it("splits store loss by reason", () => {
    const store = (id: string, reasonCode: string, value: string) => toStoreRow({ id, date: new Date("2026-10-18T05:00:00Z"), storeId: "w", store: "Floor", materialType: "chemical", chemicalId: "c", chemicalName: "Soda Ash", chemicalUnit: "kg", packagingId: null, packagingName: null, measuredInKg: null, lotPrice: "115", delta: "-2", value, reasonCode, note: null, by: "Ali" }, limits);
    expect(lossSummary("store", [store("1", "damaged", "-260"), store("2", "count_short", "-230")])).toEqual([
      { label: "Loss cost", value: "Rs 490" }, { label: "By reason", value: "Damaged Rs 260 · Spilled Rs 0 · Expired Rs 0 · Count short Rs 230 · Other Rs 0" },
    ]);
  });
});

describe("filters, strip and paging", () => {
  const rows = [batch("1", "500", "400"), batch("2", "500", "490", "kg", "leak")];
  it("offers only values present in the rows and filters by them", () => {
    const options = lossFilterOptions("batch", rows);
    expect(options.map((o) => o.label)).toEqual(["Product", "Formula", "Reason"]);
    expect(options[2].options).toEqual([{ value: "leak", label: "Leak" }, { value: "spill", label: "Spill" }]);
    expect(filterLossRows("batch", rows, { reason: "leak" }, false).map((r) => r.id)).toEqual(["2"]);
    expect(filterLossRows("batch", rows, {}, true).map((r) => r.id)).toEqual(["1"]); // only 20.0% is above 10%
    expect(lossFiltersText("batch", { reason: "leak" }, options)).toBe("Product All · Formula All · Reason Leak");
  });
  it("totals the strip across tabs", () => {
    // 30,115.00 + 3,011.50
    expect(lossStripTotals({ batch: rows, chemical: [], powder: [], packing: [], store: [] })).toEqual({ batch: "33126.50", chemical: "0.00", powder: "0.00", packing: "0.00", store: "0.00", total: "33126.50" });
  });
  it("pages 25 rows at a time and clamps the page", () => {
    const many = Array.from({ length: 30 }, (_, i) => batch(String(i), "500", "400"));
    expect(pageLossRows(many, 2)).toMatchObject({ page: 2, pageCount: 2 });
    expect(pageLossRows(many, 2).rows).toHaveLength(5);
    expect(pageLossRows(many, 9).page).toBe(2);
    expect(pageLossRows([], 1)).toEqual({ rows: [], page: 1, pageCount: 1 });
  });
});

describe("date range text", () => {
  it("shows the year once unless the range crosses a year", () => {
    expect(formatLossRange("2026-10-01", "2026-10-29")).toBe("1 Oct – 29 Oct 2026");
    expect(formatLossRange("2025-12-28", "2026-01-03")).toBe("28 Dec 2025 – 3 Jan 2026");
  });
});
