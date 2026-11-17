import Big from "big.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addToMonth,
  buildMonthlyReport,
  csvCell,
  fiscalYearLabel,
  fiscalYearMonths,
  fiscalYearRange,
  fiscalYearStartFor,
  formatLac,
  type MonthKey,
  type MonthlyReportInput,
  monthlyReportCsv,
  reportExpenseCategories,
} from "@/lib/reports/monthly-report";

const bucket = (entries: Record<MonthKey, number>) => {
  const map = new Map<MonthKey, Big>();
  for (const [month, value] of Object.entries(entries)) addToMonth(map, month, value);
  return map;
};

// October 2026 numbers from the client's workbook.
const octoberInput = (): MonthlyReportInput => ({
  startYear: 2026,
  todayKey: "2026-11-17",
  cash: bucket({ "2026-10": 548040 }),
  credit: bucket({ "2026-10": 362360.84 }),
  byProduct: bucket({ "2026-10": 1500 }),
  rawMaterial: bucket({ "2026-10": 628040 }),
  packing: bucket({}),
  salaries: bucket({ "2026-10": 521040 }),
  expenseCategories: [
    { id: "c-utility", name: "Utility", months: bucket({ "2026-10": 33880 }) },
    { id: "c-transport", name: "Transport", months: bucket({ "2026-10": 58890 }) },
    { id: "c-maint", name: "Maintenance", months: bucket({ "2026-10": 6330 }) },
  ],
  purchaseRawMaterial: bucket({ "2026-10": 0 }),
  purchasePacking: bucket({}),
  weightKg: bucket({ "2026-10": 2727.919 }),
});

describe("financial year helpers", () => {
  it("runs July to June", () => {
    const months = fiscalYearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-07");
    expect(months[5]).toBe("2026-12");
    expect(months[6]).toBe("2027-01");
    expect(months[11]).toBe("2027-06");
  });

  it("finds the year a day belongs to", () => {
    expect(fiscalYearStartFor("2026-11-17")).toBe(2026);
    expect(fiscalYearStartFor("2027-03-01")).toBe(2026);
    expect(fiscalYearStartFor("2026-06-30")).toBe(2025);
    expect(fiscalYearStartFor("2026-07-01")).toBe(2026);
  });

  it("labels and bounds the year", () => {
    expect(fiscalYearLabel(2026)).toBe("2026-27");
    expect(fiscalYearLabel(2099)).toBe("2099-00");
    expect(fiscalYearRange(2026)).toEqual({ from: "2026-07-01", to: "2027-06-30" });
  });

  it("shows amounts in lac", () => {
    expect(formatLac(911900.84)).toBe("9.12");
    expect(formatLac(-336279.16)).toBe("-3.36");
    expect(formatLac(-1)).toBe("0.00");
  });
});

describe("buildMonthlyReport", () => {
  it("matches the client's October totals", () => {
    const report = buildMonthlyReport(octoberInput());
    const oct = report.months.indexOf("2026-10");
    const find = (key: string) =>
      [...report.sale, ...report.consumption, ...report.result].find((line) => line.key === key)!;

    expect(find("totalSale").months[oct]).toBe(911900.84);
    expect(find("totalConsumption").months[oct]).toBe(1248180);
    expect(find("difference").months[oct]).toBe(-336279.16);
    expect(find("withoutCredit").months[oct]).toBe(-698640);
    expect(report.weight.months[oct]).toBe(2.728);
  });

  it("adds one consumption row per given expense category, in order, with no fixed names", () => {
    const report = buildMonthlyReport(octoberInput());
    expect(report.consumption.map((line) => line.label)).toEqual([
      "Raw material",
      "Packing",
      "Salaries",
      "Utility",
      "Transport",
      "Maintenance",
      "Total consumption",
    ]);
    expect(report.consumption[3].key).toBe("expense:c-utility");
  });

  it("blanks future months without values and marks the current month", () => {
    const report = buildMonthlyReport(octoberInput());
    const dec = report.months.indexOf("2026-12");
    expect(report.currentMonth).toBe("2026-11");
    expect(report.sale[0].months[dec]).toBeNull();
    expect(report.sale[0].months[0]).toBe(0);
  });

  it("keeps a future-dated value visible", () => {
    const input = octoberInput();
    addToMonth(input.cash, "2027-02", 500);
    const report = buildMonthlyReport(input);
    expect(report.sale[0].months[report.months.indexOf("2027-02")]).toBe(500);
    expect(report.sale[0].total).toBe(548540);
  });

  it("gives each consumption row its share of the year", () => {
    const report = buildMonthlyReport(octoberInput());
    const raw = report.consumption.find((line) => line.key === "rawMaterial")!;
    const total = report.consumption.find((line) => line.key === "totalConsumption")!;
    expect(raw.sharePercent).toBe(Math.round((628040 / 1248180) * 100));
    expect(total.sharePercent).toBe(100);
  });

  it("does not let totals be clicked", () => {
    const report = buildMonthlyReport(octoberInput());
    const totals = [...report.sale, ...report.consumption, ...report.result].filter((line) =>
      ["totalSale", "totalConsumption", "difference", "withoutCredit"].includes(line.key),
    );
    expect(totals.every((line) => !line.drillable)).toBe(true);
  });

  it("sums the summary cards from the yearly totals", () => {
    const { summary } = buildMonthlyReport(octoberInput());
    expect(summary).toEqual({
      totalSale: 911900.84,
      totalConsumption: 1248180,
      difference: -336279.16,
      withoutCredit: -698640,
      weightTon: 2.728,
    });
  });

  it("reports zero share when nothing was spent", () => {
    const report = buildMonthlyReport({
      ...octoberInput(),
      rawMaterial: new Map(),
      salaries: new Map(),
      expenseCategories: [],
    });
    expect(report.consumption.every((line) => line.sharePercent === 0)).toBe(true);
  });
});

describe("reportExpenseCategories", () => {
  const categories = [
    { id: "a", slug: "utility", isActive: true, isArchived: false },
    { id: "b", slug: "supplier-purchase", isActive: true, isArchived: false },
    { id: "c", slug: "old-rent", isActive: false, isArchived: true },
    { id: "d", slug: "paused", isActive: false, isArchived: false },
  ];

  it("keeps the client's active categories and drops the system supplier category", () => {
    expect(reportExpenseCategories(categories, new Set()).map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps an inactive or archived category only when it has spending", () => {
    expect(reportExpenseCategories(categories, new Set(["b", "c"])).map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas and spreadsheet formulas but not negative numbers", () => {
    expect(csvCell('Drum, "big"')).toBe('"Drum, ""big"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-336279.16")).toBe("-336279.16");
  });

  it("starts with a BOM and has one header plus every line", () => {
    const csv = monthlyReportCsv(buildMonthlyReport(octoberInput()));
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Line,Jul 2026,Aug 2026,Sep 2026,Oct 2026,Nov 2026,Dec 2026,Jan 2027,Feb 2027,Mar 2027,Apr 2027,May 2027,Jun 2027,Total,Share %");
    expect(lines).toContain("SALE");
    expect(lines.find((line) => line.startsWith("Total sale,"))).toContain(",911900.84,");
    expect(lines.find((line) => line.startsWith("Raw material,"))?.split(",").at(-1)).toBe(
      String(Math.round((628040 / 1248180) * 100)),
    );
  });
});

const queries = () => readFileSync("src/server-functions/reports/monthly-report-queries.server.ts", "utf8");

describe("monthly report data rules", () => {
  it("is guarded by reports.view", () => {
    const source = readFileSync("src/server-functions/reports/monthly-report-fn.ts", "utf8");
    expect(source.match(/requireReportsViewMiddleware\]/g)?.length).toBe(2);
  });

  it("leaves voided records out", () => {
    const source = queries();
    expect(source).toContain('eq(invoices.status, "saved")');
    expect(source).toContain("isNull(expenses.voidedAt)");
    expect(source).toContain("isNull(purchaseRecords.voidedAt)");
    expect(source).toContain("isNull(otherIncome.voidedAt)");
  });

  it("takes expense rows from the client's categories, never fixed names", () => {
    const source = queries();
    expect(source).toContain("reportExpenseCategories(");
    for (const name of ["Utility", "Transport", "Maintenance", "Documents", "Rent", "Fuel"]) {
      expect(source).not.toContain(`"${name}"`);
    }
  });

  it("counts salaries only from approved or paid payrolls", () => {
    expect(queries()).toContain('inArray(payrolls.status, ["approved", "paid"])');
  });

  it("buckets by Pakistan calendar month", () => {
    expect(queries()).toContain("reportDateKey(value).slice(0, 7)");
  });
});

describe("monthly report page wiring", () => {
  it("is listed on the Reports hub", () => {
    expect(readFileSync("src/routes/_protected/reports/index.tsx", "utf8")).toContain('href: "/reports/monthly"');
  });

  it("prints on one A4 landscape page", () => {
    expect(readFileSync("src/routes/_protected/reports/monthly/index.tsx", "utf8")).toContain("size: A4 landscape");
  });

  it("keeps row names fixed while months scroll", () => {
    expect(readFileSync("src/components/reports/monthly/monthly-report-table.tsx", "utf8")).toContain("sticky left-0");
  });
});
