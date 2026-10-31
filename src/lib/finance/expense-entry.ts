import Big from "big.js";

export const QUICK_CATEGORY_COUNT = 6;

/** expenses.amount is decimal(12, 2). */
export const MAX_EXPENSE_AMOUNT = 9_999_999_999.99;

// 1250000 -> "12,50,000": last three digits, then groups of two.
function groupLacCrore(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${digits.slice(-3)}`;
}

/** Re-formats what the user typed into the amount box, keeping at most two decimals. */
export function formatAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const [wholeRaw, ...rest] = cleaned.split(".");
  const whole = groupLacCrore(wholeRaw.replace(/^0+(?=\d)/, ""));
  if (rest.length === 0) return whole;
  return `${whole || "0"}.${rest.join("").slice(0, 2)}`;
}

export function parseAmountInput(formatted: string): number {
  const value = Number(formatted.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** "Rs 2,000", "−Rs 2,000", "Rs 85,000.50". */
export function formatRupees(value: string | number): string {
  const amount = new Big(value);
  const [whole, paisa] = amount.abs().toFixed(2).split(".");
  const body = paisa === "00" ? groupLacCrore(whole) : `${groupLacCrore(whole)}.${paisa}`;
  return `${amount.lt(0) ? "−" : ""}Rs ${body}`;
}

export function getBalanceAfter(
  balance: string | null | undefined,
  debit: string | number,
  credit: string | number = 0,
): string {
  return new Big(balance || 0).minus(debit).plus(credit).toFixed(2);
}

export function filterPayeeSuggestions(payees: string[], query: string, limit = 6): string[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return payees.slice(0, limit);
  if (payees.some((payee) => payee.toLowerCase() === typed)) return [];
  return payees.filter((payee) => payee.toLowerCase().includes(typed)).slice(0, limit);
}

/** Most used first (by `usageRank`), then the rest in their normal order, up to `count`. */
export function pickQuickCategories<T extends { id: string }>(
  categories: T[],
  usageRank: string[],
  count = QUICK_CATEGORY_COUNT,
): T[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const picked = new Set<T>();
  for (const id of usageRank) {
    const category = byId.get(id);
    if (category) picked.add(category);
    if (picked.size === count) break;
  }
  for (const category of categories) {
    if (picked.size === count) break;
    picked.add(category);
  }
  return [...picked];
}

export function getExpenseTitle(expense: {
  description: string;
  payee: string | null;
  category: { name: string } | null;
}): string {
  const note = expense.description.trim();
  if (note) return note;
  return [expense.category?.name, expense.payee].filter(Boolean).join(" · ") || "Expense";
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

export function isNewExpenseShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">,
): boolean {
  return (
    event.key.toLowerCase() === "n" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat &&
    !isTypingTarget(event.target)
  );
}
