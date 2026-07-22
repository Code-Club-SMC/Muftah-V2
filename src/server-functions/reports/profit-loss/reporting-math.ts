import {
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from "date-fns";

export interface ReportDateRange {
  fromDate: Date;
  toDate: Date;
}

export interface PnlMetrics {
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  netProfit: number;
  failedBatchLosses: number;
  netImpact: number;
  grossMarginPercent: number;
  netMarginPercent: number;
  netImpactMarginPercent: number;
  soldUnits: number;
  invoiceCount: number;
  averageSellingPricePerUnit: number;
  cogsPerUnit: number;
  grossProfitPerUnit: number;
  netProfitPerUnit: number;
  netImpactPerUnit: number;
}

export interface RealizationStateInput {
  adjustedInvoiceTotal: number;
  paymentToDate: number;
  adjustedLineRevenue: number;
  adjustedLineCogs: number;
  adjustedCartons: number;
  adjustedUnits: number;
  invoiceExpenses: number;
}

export interface RealizationState {
  realizedRatio: number;
  realizedRevenue: number;
  realizedCogs: number;
  realizedCartons: number;
  realizedUnits: number;
  realizedInvoiceExpenses: number;
}

const ACTIVITY_EPSILON = 0.005;

interface SummaryRow {
  totalRevenue: number | string | null;
  totalCogs: number | string | null;
  soldUnits: number | string | null;
  invoiceCount: number | string | null;
  failedBatchLosses?: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

export function createReportDateRange(input?: {
  dateFrom?: string;
  dateTo?: string;
}): ReportDateRange {
  const today = new Date();
  const defaultFrom = startOfMonth(today);
  const defaultTo = endOfMonth(today);

  const fromDate = input?.dateFrom ? parseISO(input.dateFrom) : defaultFrom;
  const toDate = input?.dateTo ? parseISO(input.dateTo) : defaultTo;

  return {
    fromDate: startOfDay(Number.isNaN(fromDate.getTime()) ? defaultFrom : fromDate),
    toDate: endOfDay(Number.isNaN(toDate.getTime()) ? defaultTo : toDate),
  };
}

export function createPreviousRange(range: ReportDateRange): ReportDateRange {
  const isFullMonthRange =
    isSameMonth(range.fromDate, range.toDate) &&
    isSameDay(range.fromDate, startOfMonth(range.fromDate)) &&
    isSameDay(range.toDate, endOfMonth(range.toDate));

  if (isFullMonthRange) {
    const previousMonthDate = subDays(startOfMonth(range.fromDate), 1);

    return {
      fromDate: startOfMonth(previousMonthDate),
      toDate: endOfDay(endOfMonth(previousMonthDate)),
    };
  }

  const daysInRange = Math.max(
    differenceInCalendarDays(range.toDate, range.fromDate) + 1,
    1,
  );
  const previousToDate = endOfDay(subDays(range.fromDate, 1));
  const previousFromDate = startOfDay(subDays(previousToDate, daysInRange - 1));

  return {
    fromDate: previousFromDate,
    toDate: previousToDate,
  };
}

export function createComparisonLabel(
  currentRange: ReportDateRange,
  previousRange: ReportDateRange,
): string {
  const currentStartsMonth = isSameDay(
    currentRange.fromDate,
    startOfMonth(currentRange.fromDate),
  );
  const currentEndsMonth = isSameDay(
    currentRange.toDate,
    endOfMonth(currentRange.toDate),
  );

  if (
    currentStartsMonth &&
    currentEndsMonth &&
    isSameMonth(currentRange.fromDate, currentRange.toDate) &&
    isSameMonth(previousRange.fromDate, previousRange.toDate)
  ) {
    return `vs ${format(previousRange.fromDate, "MMM yyyy")}`;
  }

  return "vs previous period";
}

export function createPeriodLabel(range: ReportDateRange): string {
  return `${format(range.fromDate, "dd MMM yyyy")} - ${format(
    range.toDate,
    "dd MMM yyyy",
  )}`;
}

export function buildVariantLabel(
  fillAmount: string | null,
  fillUnit: string | null,
): string | null {
  if (!fillAmount) {
    return null;
  }

  return fillUnit ? `${fillAmount} ${fillUnit}` : fillAmount;
}

export function calculateMetrics(row: Partial<SummaryRow>): PnlMetrics {
  const totalRevenue = toNumber(row.totalRevenue);
  const totalCogs = toNumber(row.totalCogs);
  const soldUnits = toNumber(row.soldUnits);
  const invoiceCount = toNumber(row.invoiceCount);
  const failedBatchLosses = toNumber(row.failedBatchLosses);
  const grossProfit = totalRevenue - totalCogs;
  const netProfit = grossProfit;
  const netImpact = netProfit - failedBatchLosses;

  return {
    totalRevenue,
    totalCogs,
    grossProfit,
    netProfit,
    failedBatchLosses,
    netImpact,
    grossMarginPercent: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
    netMarginPercent: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
    netImpactMarginPercent:
      totalRevenue > 0 ? (netImpact / totalRevenue) * 100 : 0,
    soldUnits,
    invoiceCount,
    averageSellingPricePerUnit: soldUnits > 0 ? totalRevenue / soldUnits : 0,
    cogsPerUnit: soldUnits > 0 ? totalCogs / soldUnits : 0,
    grossProfitPerUnit: soldUnits > 0 ? grossProfit / soldUnits : 0,
    netProfitPerUnit: soldUnits > 0 ? netProfit / soldUnits : 0,
    netImpactPerUnit: soldUnits > 0 ? netImpact / soldUnits : 0,
  };
}

export function calculateDelta(currentValue: number, previousValue: number): number {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100;
  }

  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

export function calculatePointDelta(
  currentValue: number,
  previousValue: number,
): number {
  return currentValue - previousValue;
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

export function hasMeaningfulValue(
  value: number,
  epsilon = ACTIVITY_EPSILON,
): boolean {
  return Math.abs(value) >= epsilon;
}

export function calculateCumulativeRealization(
  input: RealizationStateInput,
): RealizationState {
  const realizedRatio =
    input.adjustedInvoiceTotal > 0
      ? clampRatio(input.paymentToDate / input.adjustedInvoiceTotal)
      : 0;

  return {
    realizedRatio,
    realizedRevenue: input.adjustedLineRevenue * realizedRatio,
    realizedCogs: input.adjustedLineCogs * realizedRatio,
    realizedCartons: input.adjustedCartons * realizedRatio,
    realizedUnits: input.adjustedUnits * realizedRatio,
    realizedInvoiceExpenses: input.invoiceExpenses * realizedRatio,
  };
}

export function calculatePeriodRealization(
  startState: RealizationState,
  endState: RealizationState,
): RealizationState {
  return {
    realizedRatio: endState.realizedRatio,
    realizedRevenue: endState.realizedRevenue - startState.realizedRevenue,
    realizedCogs: endState.realizedCogs - startState.realizedCogs,
    realizedCartons: endState.realizedCartons - startState.realizedCartons,
    realizedUnits: endState.realizedUnits - startState.realizedUnits,
    realizedInvoiceExpenses:
      endState.realizedInvoiceExpenses - startState.realizedInvoiceExpenses,
  };
}
