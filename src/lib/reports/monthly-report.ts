import Big from "big.js";

/** "YYYY-MM", a Pakistan calendar month. */
export type MonthKey = string;

const FIRST_MONTH = 7; // July
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Expense categories the system makes for itself. Their money is reported elsewhere. */
export const SYSTEM_EXPENSE_CATEGORY_SLUGS: readonly string[] = ["supplier-purchase"];

const TOTAL_KEYS = new Set(["totalSale", "totalConsumption", "difference", "withoutCredit"]);

export function fiscalYearMonths(startYear: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = ((FIRST_MONTH - 1 + index) % 12) + 1;
    const year = month >= FIRST_MONTH ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

/** Start year of the July–June year that holds `todayKey` ("YYYY-MM-DD"). */
export function fiscalYearStartFor(todayKey: string): number {
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  return month >= FIRST_MONTH ? year : year - 1;
}

export function fiscalYearRange(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` };
}

export function fiscalYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function monthShortLabel(month: MonthKey): string {
  return MONTH_SHORT[Number(month.slice(5, 7)) - 1];
}

export function monthLongLabel(month: MonthKey): string {
  return `${MONTH_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Rupees as lac with 2 decimals: 911900.84 → "9.12". Never prints "-0.00". */
export function formatLac(value: number): string {
  const lac = Math.round(value / 1_000) / 100;
  return (lac === 0 ? 0 : lac).toFixed(2);
}

export function addToMonth(bucket: Map<MonthKey, Big>, month: MonthKey, amount: Big | string | number): void {
  bucket.set(month, (bucket.get(month) ?? new Big(0)).plus(amount));
}

/**
 * The client's own categories: every active one, plus an inactive or archived one that has
 * spending in the year (so old money never disappears). System categories are left out.
 */
export function reportExpenseCategories<
  T extends { id: string; slug: string; isActive: boolean; isArchived: boolean },
>(categories: T[], spent: Set<string>): T[] {
  return categories.filter(
    (category) =>
      !SYSTEM_EXPENSE_CATEGORY_SLUGS.includes(category.slug) &&
      ((category.isActive && !category.isArchived) || spent.has(category.id)),
  );
}

export interface MonthlyReportLine {
  key: string;
  label: string;
  /** One value per month in year order; null for a month not started yet that has no value. */
  months: (number | null)[];
  total: number;
  /** Part of yearly total consumption, 0–100. Consumption lines only. */
  sharePercent?: number;
  drillable: boolean;
}

export interface MonthlyReport {
  startYear: number;
  label: string;
  months: MonthKey[];
  currentMonth: MonthKey | null;
  sale: MonthlyReportLine[];
  consumption: MonthlyReportLine[];
  result: MonthlyReportLine[];
  purchases: MonthlyReportLine[];
  weight: MonthlyReportLine;
  summary: {
    totalSale: number;
    totalConsumption: number;
    difference: number;
    withoutCredit: number;
    weightTon: number;
  };
}

export interface MonthlyReportInput {
  startYear: number;
  /** Today as a Pakistan calendar day, "YYYY-MM-DD". */
  todayKey: string;
  cash: Map<MonthKey, Big>;
  credit: Map<MonthKey, Big>;
  byProduct: Map<MonthKey, Big>;
  rawMaterial: Map<MonthKey, Big>;
  packing: Map<MonthKey, Big>;
  salaries: Map<MonthKey, Big>;
  expenseCategories: { id: string; name: string; months: Map<MonthKey, Big> }[];
  purchaseRawMaterial: Map<MonthKey, Big>;
  purchasePacking: Map<MonthKey, Big>;
  weightKg: Map<MonthKey, Big>;
}

function sumMaps(...maps: Map<MonthKey, Big>[]): Map<MonthKey, Big> {
  const out = new Map<MonthKey, Big>();
  for (const map of maps) for (const [month, value] of map) addToMonth(out, month, value);
  return out;
}

function minusMap(from: Map<MonthKey, Big>, take: Map<MonthKey, Big>): Map<MonthKey, Big> {
  const out = sumMaps(from);
  for (const [month, value] of take) addToMonth(out, month, value.times(-1));
  return out;
}

export function buildMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const months = fiscalYearMonths(input.startYear);
  const todayMonth = input.todayKey.slice(0, 7);

  const makeLine = (
    key: string,
    label: string,
    values: Map<MonthKey, Big>,
    options: { decimals?: number } = {},
  ): MonthlyReportLine => {
    const decimals = options.decimals ?? 2;
    let total = new Big(0);
    const cells = months.map((month) => {
      const value = values.get(month);
      if (month > todayMonth && (!value || value.eq(0))) return null;
      const amount = value ?? new Big(0);
      total = total.plus(amount);
      return Number(amount.round(decimals).toFixed(decimals));
    });
    return {
      key,
      label,
      months: cells,
      total: Number(total.round(decimals).toFixed(decimals)),
      drillable: !TOTAL_KEYS.has(key),
    };
  };

  const totalSale = sumMaps(input.cash, input.credit, input.byProduct);
  const consumptionMaps = [
    input.rawMaterial,
    input.packing,
    input.salaries,
    ...input.expenseCategories.map((category) => category.months),
  ];
  const totalConsumption = sumMaps(...consumptionMaps);
  const difference = minusMap(totalSale, totalConsumption);
  const withoutCredit = minusMap(difference, input.credit);

  const sale = [
    makeLine("cash", "Cash received", input.cash),
    makeLine("credit", "Credit (unpaid)", input.credit),
    makeLine("byProduct", "By-product", input.byProduct),
    makeLine("totalSale", "Total sale", totalSale),
  ];

  const consumptionTotalLine = makeLine("totalConsumption", "Total consumption", totalConsumption);
  const share = (lineTotal: number) =>
    consumptionTotalLine.total === 0
      ? 0
      : Number(new Big(lineTotal).div(consumptionTotalLine.total).times(100).round(0).toFixed(0));
  const consumption = [
    makeLine("rawMaterial", "Raw material", input.rawMaterial),
    makeLine("packing", "Packing", input.packing),
    makeLine("salaries", "Salaries", input.salaries),
    ...input.expenseCategories.map((category) =>
      makeLine(`expense:${category.id}`, category.name, category.months),
    ),
  ].map((line) => ({ ...line, sharePercent: share(line.total) }));
  consumption.push({ ...consumptionTotalLine, sharePercent: consumptionTotalLine.total === 0 ? 0 : 100 });

  const result = [
    makeLine("difference", "Difference", difference),
    makeLine("withoutCredit", "Without credit", withoutCredit),
  ];

  const purchases = [
    makeLine("purchaseRawMaterial", "Raw material bought", input.purchaseRawMaterial),
    makeLine("purchasePacking", "Packing bought", input.purchasePacking),
  ];

  const tons = new Map<MonthKey, Big>();
  for (const [month, kg] of input.weightKg) tons.set(month, kg.div(1000));
  const weight = makeLine("weightTon", "Weight sold", tons, { decimals: 3 });

  return {
    startYear: input.startYear,
    label: fiscalYearLabel(input.startYear),
    months,
    currentMonth: months.includes(todayMonth) ? todayMonth : null,
    sale,
    consumption,
    result,
    purchases,
    weight,
    summary: {
      totalSale: sale[3].total,
      totalConsumption: consumptionTotalLine.total,
      difference: result[0].total,
      withoutCredit: result[1].total,
      weightTon: weight.total,
    },
  };
}

/** Quotes a CSV cell and stops Excel from running text that starts like a formula. */
export function csvCell(value: string): string {
  const isNumber = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !isNumber && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as CSV in rupees (tons for weight), UTF-8 with BOM so Excel reads it right. */
export function monthlyReportCsv(report: MonthlyReport): string {
  const rows: string[][] = [
    [
      "Line",
      ...report.months.map((month) => `${monthShortLabel(month)} ${month.slice(0, 4)}`),
      "Total",
      "Share %",
    ],
  ];
  const addSection = (title: string, lines: MonthlyReportLine[], decimals: number) => {
    rows.push([title]);
    for (const line of lines) {
      rows.push([
        line.label,
        ...line.months.map((value) => (value === null ? "" : value.toFixed(decimals))),
        line.total.toFixed(decimals),
        line.sharePercent === undefined ? "" : String(line.sharePercent),
      ]);
    }
  };
  addSection("SALE", report.sale, 2);
  addSection("CONSUMPTION", report.consumption, 2);
  addSection("RESULT", report.result, 2);
  addSection("PURCHASES (reference only)", report.purchases, 2);
  addSection("WEIGHT SOLD (ton)", [report.weight], 3);
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
