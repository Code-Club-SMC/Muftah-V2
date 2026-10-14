import {
  currentReportMonth,
  formatReportDate,
  formatReportMonth,
  reportDateBounds,
  reportDateKey,
  reportMonth,
  shiftReportDate,
} from "@/lib/report-dates";

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
  const defaults = currentReportMonth();
  return reportDateBounds({
    dateFrom: input?.dateFrom ?? defaults.from,
    dateTo: input?.dateTo ?? defaults.to,
  }) as ReportDateRange;
}

function isFullMonth(range: ReportDateRange): boolean {
  const month = reportMonth(range.fromDate);
  return (
    reportDateKey(range.fromDate) === month.from &&
    reportDateKey(range.toDate) === month.to
  );
}

export function createPreviousRange(range: ReportDateRange): ReportDateRange {
  if (isFullMonth(range)) {
    const month = reportMonth(range.fromDate, -1);
    return createReportDateRange({ dateFrom: month.from, dateTo: month.to });
  }
  const days =
    (new Date(`${reportDateKey(range.toDate)}T00:00:00Z`).getTime() -
      new Date(`${reportDateKey(range.fromDate)}T00:00:00Z`).getTime()) /
      86_400_000 +
    1;
  return createReportDateRange({
    dateFrom: shiftReportDate(range.fromDate, -days),
    dateTo: shiftReportDate(range.fromDate, -1),
  });
}

export function createComparisonLabel(
  currentRange: ReportDateRange,
  previousRange: ReportDateRange,
): string {
  return isFullMonth(currentRange) && isFullMonth(previousRange)
    ? `vs ${formatReportMonth(previousRange.fromDate)}`
    : "vs previous period";
}

export function createPeriodLabel(range: ReportDateRange): string {
  return `${formatReportDate(range.fromDate)} - ${formatReportDate(range.toDate)}`;
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
    grossMarginPercent:
      totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
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

export function calculateDelta(
  currentValue: number,
  previousValue: number,
): number {
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
