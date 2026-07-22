/**
 * Safe formatting helpers for dashboard values.
 * Handles null, undefined, NaN, and negative values safely.
 */

import { format, isSameMonth, isSameYear, parseISO } from "date-fns";

export function toSafeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return n;
}

/**
 * Format a previous-period date range as a compact human-readable label.
 * - Same day: "15 May 2026"
 * - Same month: "1–31 May 2026"
 * - Same year, different months: "28 Apr – 2 May 2026"
 * - Different year: "28 Dec 2025 – 2 Jan 2026"
 */
export function formatPreviousPeriodLabel(
  startStr: string,
  endStr: string,
): string {
  const start = parseISO(startStr);
  const end = parseISO(endStr);

  if (format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")) {
    return format(start, "d MMM yyyy");
  }

  if (isSameMonth(start, end) && isSameYear(start, end)) {
    return `${format(start, "d")}–${format(end, "d MMM yyyy")}`;
  }

  if (isSameYear(start, end)) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }

  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

/**
 * Formats a number in compact form.
 * 0 -> "0"
 * 91200 -> "91.2K"
 * 21600000 -> "21.6M"
 */
export function formatCompactNumber(value: number): string {
  const v = toSafeNumber(value);
  const absV = Math.abs(v);

  if (absV >= 1_000_000) {
    const m = v / 1_000_000;
    return `${m.toFixed(1)}M`;
  }
  if (absV >= 1_000) {
    const k = v / 1_000;
    return `${k.toFixed(1)}K`;
  }
  return v.toLocaleString("en-US");
}

/**
 * Formats a currency value with PKR prefix.
 * 0 -> "PKR 0"
 * 91200 -> "PKR 91.2K"
 * 21600000 -> "PKR 21.6M"
 */
export function formatCurrency(value: number): string {
  return `PKR ${formatCompactNumber(value)}`;
}

/**
 * Formats a currency value with full number (with commas).
 * 91200 -> "PKR 91,200"
 * 21600000 -> "PKR 21,600,000"
 */
export function formatCurrencyFull(value: number): string {
  const v = toSafeNumber(value);
  return `PKR ${v.toLocaleString("en-US")}`;
}

/**
 * Calculate revenue coverage as a percentage (0-100).
 */
export function getRevenueCoverage(revenue: number, expenses: number): number {
  const r = toSafeNumber(revenue);
  const e = toSafeNumber(expenses);
  if (e <= 0) return 0;
  return Math.min((r / e) * 100, 100);
}

/**
 * Calculate net (revenue - expenses).
 */
export function getNet(revenue: number, expenses: number): number {
  return toSafeNumber(revenue) - toSafeNumber(expenses);
}

/**
 * Get Y-axis tick values for a chart, evenly spaced.
 */
export function getYAxisTicks(maxValue: number, count = 5): number[] {
  const max = Math.max(toSafeNumber(maxValue), 1);
  const step = max / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((step * i) / step) * step,
  );
}
