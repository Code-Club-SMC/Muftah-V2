import Big from "big.js";
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  getDaysInMonth,
  min,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { formatAmountInput, formatRupees } from "./expense-entry";

/** "Due this week" = today plus the next 6 days. */
export const REMINDER_WINDOW_DAYS = 7;

export type TemplateReminder = { status: "overdue" | "due"; dueDate: string; monthKey: string };

/** Local calendar day, "YYYY-MM-DD". */
export const toDayKey = (value: Date | string): string => format(new Date(value), "yyyy-MM-dd");

/** The reminder day in the month `monthKey` ("YYYY-MM"); months shorter than the day use their last day. */
export function reminderDateFor(monthKey: string, reminderDay: number): string {
  const first = parseISO(`${monthKey}-01`);
  const day = Math.min(reminderDay, getDaysInMonth(first));
  return format(new Date(first.getFullYear(), first.getMonth(), day), "yyyy-MM-dd");
}

/**
 * The reminder to show under "Due this week", or null.
 * `expenseDates` are the local days of live (not voided) expenses recorded from this template.
 * Checks this month first; only when this month is paid or skipped does it look at next month.
 */
export function getTemplateReminder(input: {
  reminderDay: number | null;
  todayKey: string;
  expenseDates: string[];
  skippedMonth: string | null;
}): TemplateReminder | null {
  if (!input.reminderDay) return null;
  const today = input.todayKey;
  const windowEnd = toDayKey(addDays(parseISO(today), REMINDER_WINDOW_DAYS - 1));
  const thisMonth = today.slice(0, 7);
  const nextMonth = format(addMonths(parseISO(`${thisMonth}-01`), 1), "yyyy-MM");
  const paidMonths = new Set(input.expenseDates.map((day) => day.slice(0, 7)));

  for (const monthKey of [thisMonth, nextMonth]) {
    if (paidMonths.has(monthKey) || input.skippedMonth === monthKey) continue;
    const dueDate = reminderDateFor(monthKey, input.reminderDay);
    if (dueDate < today) return monthKey === thisMonth ? { status: "overdue", dueDate, monthKey } : null;
    if (dueDate <= windowEnd) return { status: "due", dueDate, monthKey };
    return null;
  }
  return null;
}

/** Expenses the server must return per template so the reminder can tell paid months: this month and next. */
export function getTemplateWindow(todayKey: string): { from: Date; to: Date } {
  const today = parseISO(todayKey);
  return { from: startOfMonth(today), to: endOfMonth(addMonths(today, 1)) };
}

/** "Shop rent — Rs 85,000", or just the name when the amount changes every time. */
export function templateChipLabel(template: { name: string; amount: string | null }): string {
  return template.amount ? `${template.name} — ${formatRupees(template.amount)}` : template.name;
}

/** Today, unless the reminder is for a later month: then its own date, so the expense counts for that month. */
export function templateFormDate(reminder: TemplateReminder | null, todayKey: string): string {
  return reminder && reminder.monthKey > todayKey.slice(0, 7) ? reminder.dueDate : todayKey;
}

/** What a template puts into the Record expense form. An account deleted since is left blank. */
export function templateToDraftPatch(
  template: { categoryId: string; amount: string | null; payee: string | null; walletId: string | null; note: string | null },
  walletIds: string[],
) {
  return {
    categoryId: template.categoryId,
    amount: template.amount ? formatAmountInput(String(Number(template.amount))) : "",
    payee: template.payee ?? "",
    walletId: template.walletId && walletIds.includes(template.walletId) ? template.walletId : "",
    note: template.note ?? "",
  };
}

/** This month so far, and the same days of last month (cut at last month's end). */
export function getMonthToDateRanges(todayKey: string) {
  const today = parseISO(todayKey);
  const previousStart = startOfMonth(subMonths(today, 1));
  const sameDayLastMonth = new Date(previousStart.getFullYear(), previousStart.getMonth(), today.getDate());
  return {
    current: { from: startOfMonth(today), to: endOfDay(today) },
    previous: { from: previousStart, to: endOfDay(min([sameDayLastMonth, endOfMonth(previousStart)])) },
  };
}

export function describeMonthChange(current: number, previous: number) {
  const diff = new Big(current).minus(previous);
  const direction: "up" | "down" | "same" = diff.gt(0) ? "up" : diff.lt(0) ? "down" : "same";
  const percent = new Big(previous).eq(0) ? null : Number(diff.abs().div(previous).times(100).round(0));
  return { direction, amount: diff.abs().toFixed(2), percent };
}
