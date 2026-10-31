# Expenses Phase 2 — Quick Entry, Low-Balance Confirm, Edit and Void Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording an expense quick and forgiving: a short form in the order people think (amount → what for → paid to → paid from → date → note), a "Record expense" button and **N** shortcut on the Expenses page, a confirm step instead of a hard block when an account would go below zero, and edit-any-time plus void, with every change logged and the account corrected.

**Architecture:** Pure, client-safe helpers (amount typing, rupee formatting, wallet-change planning, change diffs, lock rules) live in `src/lib/finance/`. A server-only helper module holds the shared write steps (category and custom-field checks, one wallet movement with the overdraft check, change snapshots). `createExpenseFn` is rebuilt on those helpers; new `updateExpenseFn`, `voidExpenseFn` and `getExpenseEntryDefaultsFn` sit beside it. The schema gains a payee, an origin (`manual` vs `system`), void columns, a transaction description and an `expense_edits` log. The UI swaps the old record sheet for a new `ExpenseFormSheet` built from small parts, and the Expenses list gains edit/void actions, history and the shortcut.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, zod, `big.js`, React 19 + TanStack Query, shadcn/ui (Sheet, AlertDialog, Select, Collapsible, Popover, Command, Kbd), Vitest (jsdom unit/behavior tests, real-DB integration tests via `vitest.integration.config.ts`).

**Spec:** `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md` — Part B (delivery phase 2), plus the "Resolved 2026-10-29 (phase 2)" decisions.

## Global Constraints

- Quick-add order, exactly: 1. Amount (large, Lac/Crore grouping as you type, amount in words underneath) 2. What for (6 most-used categories as big tiles, search for the rest) 3. Paid to (free text, suggestions from names already used on past expenses; no separate payee list) 4. Paid from (defaults to the account used on this user's most recent expense, balance shown next to it) 5. Date (defaults to today) 6. Note (one optional field, replaces Description + Remarks) 7. More details (collapsed: slip/reference number and the category's custom fields; required custom fields auto-expand it).
- Buttons: **Save** and **Save & add another** (keeps account and date, clears the rest). Enter key saves.
- Description is no longer required. The list shows "Category · Paid to" when no note is given.
- Low balance: show "<Account> will go to −Rs 2,000. Usually means a deposit wasn't recorded." with an inline **Record deposit** link. Users with finance manage rights can save anyway after a confirm dialog that states the account, its current balance, and the negative balance it will have after saving. The account is then flagged as overdrawn on the accounts page. Nobody loses the expense they were typing.
- Receipt photos are explicitly out of scope.
- Expenses are editable at any time by their creator and by users with finance manage rights. Every edit is logged with old and new values, who and when. If the amount or account changes, the wallet is corrected with an adjusting transaction dated on the edit day whose description names the original expense date (e.g. "Correction to expense of 12 Oct 2026").
- **Void** (reason required) creates a reversing wallet transaction dated today; the original stays visible, struck through.
- Rename "Expense Schema" to **Expense Categories**. Remove the tutorial buttons from the Expenses page and the record form.
- "Record expense" is a primary button at the top of the Expenses page (the accounts page keeps its own). Keyboard shortcut **N** on the Expenses page.
- Out of scope for this phase (phase 7): expense templates and reminders, the list-page redesign (summary strip, multi-select filters, detail drawer).
- Schema changes only through `bun run db:generate`. Never hand-edit anything under `src/db/migrations/`.
- No legacy-data conversion steps: there is no production data.
- Only `finance.manage` can record expenses today, so everyone who can record can also edit, void and confirm an overdraft. The server still requires the explicit `allowOverdraw` flag.

## Definitions used in this plan

- **Manual expense**: made by the Record expense form (`origin = "manual"`). Only manual expenses can be edited or voided.
- **System expense**: made by another screen (supplier payments, stock purchases, TA/DA, salesman-salary offsets). `origin` defaults to `"system"`. These stay locked; they must be changed where they were created, because those screens keep their own linked records.
- **Wallet change**: one money movement on one account: `{ walletId, type: "debit" | "credit", amount }` with `amount` a 2-decimal string.
- **Planned wallet changes for an edit** (old → new):

| Old account / amount | New account / amount | Changes |
|---|---|---|
| Cash / 5,000 | Cash / 5,000 | none |
| Cash / 5,000 | Cash / 5,500 | debit Cash 500.00 |
| Cash / 5,000 | Cash / 4,000 | credit Cash 1000.00 |
| Cash / 5,000 | Bank / 5,000 | credit Cash 5000.00, debit Bank 5000.00 |

- **Snapshot**: a flat label → text map of an expense, used to log edits. Keys in this order: `Amount`, `Category`, `Paid to`, `Paid from`, `Date`, `Note`, `Slip / ref`, then each custom field's label. Amounts look like `Rs 5,000`, dates like `12 Oct 2026`.
- **Overdraft check**: after a debit, if the account balance is below zero and `allowOverdraw` is not `true`, the server throws an error whose message contains `OVERDRAW_CONFIRM_REQUIRED`, and the whole transaction rolls back.
- All wallet/transaction rows written here keep `source = "Expense"` so the P&L cash-flow section (which sums signed amounts by source) stays correct. The new `transactions.description` explains corrections and voids.

## How to run tests

- Unit and component tests: `bun run test -- <path>`
- Integration tests (real PostgreSQL) need a database whose name ends in `_test`. With docker compose running (`docker compose up -d`):
  ```bash
  export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/titan_test
  DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
  DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts <path>
  ```
  Use the user and password from `.env`'s `DATABASE_URL`, with the database name changed to `titan_test`. If `TEST_DATABASE_URL` is not set, the integration suites skip themselves.
- Type check: `bun run typecheck`

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/amount-in-words.ts` (create) | Rupees in words with Lakh/Crore, shared by invoices and the expense form |
| `src/components/sales/retailer-invoice.tsx` (modify) | Use the shared words helper |
| `src/lib/finance/expense-entry.ts` (create) | Form helpers: amount typing/parsing, rupee text, balance-after, payee suggestions, quick categories, list title, N shortcut |
| `src/lib/finance-expenses.ts` (modify) | `toExpenseFieldDrafts` for prefilling the edit form |
| `src/lib/finance/expense-corrections.ts` (create) | Overdraft marker, wallet-change planning and wording, snapshots and diffs, lock rules |
| `src/lib/types/finance-types.ts` (modify) | New types for edits, defaults, update/void input, list item fields |
| `src/db/schemas/finance-schema.ts` (modify) | Expense payee/origin/void columns, transaction description, `expense_edits` table, relations |
| `src/db/migrations/*` (generated) | Only via `bun run db:generate` |
| `src/server-functions/finance/expense-writes.server.ts` (create) | Shared server write steps for create/update/void |
| `src/server-functions/finance-fn.ts` (modify) | `createExpenseFn` on the shared steps; KPIs skip voided; list returns new fields |
| `src/server-functions/finance/expense-entry-defaults-fn.ts` (create) | Last account, category usage rank, payee names |
| `src/server-functions/finance/expense-corrections-fn.ts` (create) | `updateExpenseFn`, `voidExpenseFn` |
| `src/server-functions/reports/profit-loss/company-reporting-core.ts`, `src/server-functions/dashboard/get-dashboard-fn.ts`, `src/server-functions/reports/expenses-report-fn.ts` (modify) | Leave voided expenses out of totals |
| `src/hooks/finance/use-finance.ts` (modify) | Update/void/defaults hooks, overdraft-aware error toasts |
| `src/components/finance/expense-amount-field.tsx` (create) | Big amount input with words |
| `src/components/finance/expense-category-picker.tsx` (create) | Six tiles + search |
| `src/components/finance/expense-payee-field.tsx` (create) | Paid-to input with suggestions |
| `src/components/finance/expense-dynamic-field-input.tsx` (create) | Custom field input, moved out of the old sheet |
| `src/components/finance/overdraw-confirm-dialog.tsx` (create) | "Save anyway?" dialog |
| `src/components/finance/deposit-sheet.tsx` (create) | Deposit sheet, moved out of the accounts page so the form can open it |
| `src/components/finance/expense-form-sheet.tsx` (create) | The new record/edit form |
| `src/components/finance/expense-record-sheet.tsx` (delete) | Replaced by the new form |
| `src/components/finance/finance-container.tsx` (modify) | Use the new form and deposit sheet, overdrawn flag, transaction descriptions |
| `src/components/finance/void-expense-dialog.tsx` (create) | Void with reason |
| `src/components/finance/expense-history.tsx` (create) | Edit and void history |
| `src/components/finance/expenses-container.tsx` (rewrite) | Button, shortcut, new columns, actions, history, no tutorial |
| `src/routes/_protected/finance/expenses/index.tsx` (modify) | Prefetch accounts |
| `src/routes/_protected/finance/expenses/settings/index.tsx`, `src/components/finance/expense-categories-manager.tsx` (modify) | "Expense Categories" wording |

---

### Task 1: Rupees in words, shared

**Files:**
- Create: `src/lib/amount-in-words.ts`
- Test: `src/lib/amount-in-words.test.ts`
- Modify: `src/components/sales/retailer-invoice.tsx` (remove the local `numberToWords`, around lines 51–75, and its one call around line 120)

**Interfaces:**
- Produces: `amountInWords(amount: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/amount-in-words.test.ts
import { describe, expect, it } from "vitest";
import { amountInWords } from "./amount-in-words";

describe("amountInWords", () => {
  it.each([
    [0, "Zero Rupees Only"],
    [5, "Five Rupees Only"],
    [15, "Fifteen Rupees Only"],
    [85000, "Eighty Five Thousand Rupees Only"],
    [125000, "One Lakh Twenty Five Thousand Rupees Only"],
    [12500000, "One Crore Twenty Five Lakh Rupees Only"],
    [1050.5, "One Thousand Fifty Rupees and Fifty Paisa Only"],
    [0.75, "Seventy Five Paisa Only"],
    [1999.999, "Two Thousand Rupees Only"],
  ])("writes %s as %s", (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it("returns an empty string for negative or invalid amounts", () => {
    expect(amountInWords(-5)).toBe("");
    expect(amountInWords(Number.NaN)).toBe("");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun run test -- src/lib/amount-in-words.test.ts`
Expected: FAIL, cannot find module `./amount-in-words`.

- [ ] **Step 3: Write the helper**

```ts
// src/lib/amount-in-words.ts
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convert(num: number): string {
  if (num === 0) return "";
  if (num < 20) return ONES[num];
  if (num < 100) return TENS[Math.floor(num / 10)] + (num % 10 !== 0 ? " " + ONES[num % 10] : "");
  if (num < 1_000) return ONES[Math.floor(num / 100)] + " Hundred" + (num % 100 !== 0 ? " " + convert(num % 100) : "");
  if (num < 1_00_000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 !== 0 ? " " + convert(num % 1000) : "");
  if (num < 1_00_00_000) return convert(Math.floor(num / 1_00_000)) + " Lakh" + (num % 1_00_000 !== 0 ? " " + convert(num % 1_00_000) : "");
  return convert(Math.floor(num / 1_00_00_000)) + " Crore" + (num % 1_00_00_000 !== 0 ? " " + convert(num % 1_00_00_000) : "");
}

/** "One Lakh Twenty Five Thousand Rupees Only", using the Pakistani Lakh/Crore grouping. */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  // Work in whole paisa so 1999.999 rounds to 2000 instead of "1999 Rupees and 100 Paisa".
  const totalPaisa = Math.round(amount * 100);
  const rupees = Math.floor(totalPaisa / 100);
  const paisa = totalPaisa % 100;
  if (rupees === 0 && paisa === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  if (rupees > 0) parts.push(`${convert(rupees)} Rupees`);
  if (paisa > 0) parts.push(`${convert(paisa)} Paisa`);
  return `${parts.join(" and ")} Only`;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun run test -- src/lib/amount-in-words.test.ts`
Expected: PASS (11 checks).

- [ ] **Step 5: Use it in the retailer invoice**

In `src/components/sales/retailer-invoice.tsx`:
1. Delete the whole local `function numberToWords(n: number): string { ... }` block (it starts with `function numberToWords(n: number): string {` and ends with `return result + " Only";\n}`).
2. Add `import { amountInWords } from "@/lib/amount-in-words";` with the other `@/lib` imports at the top.
3. Replace `const amtWords = numberToWords(Math.round(grandTotal));` with `const amtWords = amountInWords(Math.round(grandTotal));`.

Run: `grep -n "numberToWords" src/components/sales/retailer-invoice.tsx`
Expected: no output.

- [ ] **Step 6: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors in the two files.

```bash
git add src/lib/amount-in-words.ts src/lib/amount-in-words.test.ts src/components/sales/retailer-invoice.tsx
git commit -m "refactor: share rupees-in-words between invoices and expenses"
```

---

### Task 2: Expense entry helpers

**Files:**
- Create: `src/lib/finance/expense-entry.ts`
- Test: `src/lib/finance/expense-entry.test.ts`
- Modify: `src/lib/finance-expenses.ts` (add `toExpenseFieldDrafts`)
- Modify: `src/lib/types/finance-types.ts` (add `valueOptionId` to `ExpenseFieldValueDisplay`)
- Test: `src/lib/finance-expenses.test.ts` (add cases)

**Interfaces:**
- Produces (from `src/lib/finance/expense-entry.ts`):
  - `QUICK_CATEGORY_COUNT = 6`
  - `formatAmountInput(raw: string): string`
  - `parseAmountInput(formatted: string): number`
  - `formatRupees(value: string | number): string` — `"Rs 2,000"`, `"−Rs 2,000"`, `"Rs 85,000.50"`
  - `getBalanceAfter(balance: string | null | undefined, debit: string | number, credit?: string | number): string` — 2-decimal string
  - `filterPayeeSuggestions(payees: string[], query: string, limit?: number): string[]`
  - `pickQuickCategories<T extends { id: string }>(categories: T[], usageRank: string[], count?: number): T[]`
  - `getExpenseTitle(expense: { description: string; payee: string | null; category: { name: string } | null }): string`
  - `isTypingTarget(target: EventTarget | null): boolean`
  - `isNewExpenseShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">): boolean`
- Produces (from `src/lib/finance-expenses.ts`): `toExpenseFieldDrafts(fields: ExpenseFieldValueDisplay[]): Record<string, ExpenseFieldDraftValue>`
- Produces (type change): `ExpenseFieldValueDisplay.valueOptionId: string | null`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/finance/expense-entry.test.ts
import { describe, expect, it } from "vitest";
import {
  QUICK_CATEGORY_COUNT,
  filterPayeeSuggestions,
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  getExpenseTitle,
  isNewExpenseShortcut,
  isTypingTarget,
  parseAmountInput,
  pickQuickCategories,
} from "./expense-entry";

describe("amount typing", () => {
  it.each([
    ["", ""],
    ["abc", ""],
    ["100", "100"],
    ["1000", "1,000"],
    ["1250000", "12,50,000"],
    ["12,50,000", "12,50,000"],
    ["123456789", "12,34,56,789"],
    ["0005", "5"],
    ["0", "0"],
    ["1234.567", "1,234.56"],
    ["1234.", "1,234."],
    [".5", "0.5"],
  ])("formats %j as %j", (raw, formatted) => {
    expect(formatAmountInput(raw)).toBe(formatted);
  });

  it("reads the typed amount back as a number", () => {
    expect(parseAmountInput("12,50,000")).toBe(1250000);
    expect(parseAmountInput("1,234.")).toBe(1234);
    expect(parseAmountInput("1,234.56")).toBe(1234.56);
    expect(parseAmountInput("")).toBe(0);
  });
});

describe("rupee text and balances", () => {
  it.each([
    [2000, "Rs 2,000"],
    ["-3000.00", "−Rs 3,000"],
    ["85000.5", "Rs 85,000.50"],
    [0, "Rs 0"],
    ["1250000", "Rs 12,50,000"],
  ])("writes %j as %j", (value, text) => {
    expect(formatRupees(value)).toBe(text);
  });

  it("works out the balance after a debit and an optional credit", () => {
    expect(getBalanceAfter("2000.00", 5000)).toBe("-3000.00");
    expect(getBalanceAfter(undefined, 100)).toBe("-100.00");
    expect(getBalanceAfter("100", "50.5", 10)).toBe("59.50");
  });
});

describe("payee suggestions", () => {
  const payees = ["LESCO", "Shell Pump Ravi Road", "Landlord", "PSO Pump"];

  it("shows the first names when nothing is typed", () => {
    expect(filterPayeeSuggestions(payees, "", 2)).toEqual(["LESCO", "Shell Pump Ravi Road"]);
  });

  it("matches any part of the name, ignoring case", () => {
    expect(filterPayeeSuggestions(payees, "pump")).toEqual(["Shell Pump Ravi Road", "PSO Pump"]);
  });

  it("hides the list once the exact name is typed", () => {
    expect(filterPayeeSuggestions(payees, "lesco")).toEqual([]);
  });
});

describe("quick categories", () => {
  const categories = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));

  it("puts the most used first, then fills up in the normal order", () => {
    expect(pickQuickCategories(categories, ["h", "g", "missing"]).map((c) => c.id)).toEqual([
      "h", "g", "a", "b", "c", "d",
    ]);
  });

  it("never shows more than six", () => {
    expect(pickQuickCategories(categories, [])).toHaveLength(QUICK_CATEGORY_COUNT);
  });
});

describe("list title", () => {
  it("uses the note when there is one", () => {
    expect(getExpenseTitle({ description: " October bill ", payee: "LESCO", category: { name: "Electricity" } })).toBe("October bill");
  });

  it("falls back to Category · Paid to", () => {
    expect(getExpenseTitle({ description: "", payee: "LESCO", category: { name: "Electricity" } })).toBe("Electricity · LESCO");
    expect(getExpenseTitle({ description: "", payee: null, category: { name: "Electricity" } })).toBe("Electricity");
    expect(getExpenseTitle({ description: "", payee: null, category: null })).toBe("Expense");
  });
});

describe("N shortcut", () => {
  const key = (overrides: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">> = {}) => ({
    key: "n", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body, ...overrides,
  });

  it("knows when someone is typing", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("opens the form on a plain N only", () => {
    expect(isNewExpenseShortcut(key())).toBe(true);
    expect(isNewExpenseShortcut(key({ key: "N" }))).toBe(true);
    expect(isNewExpenseShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ metaKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ altKey: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ repeat: true }))).toBe(false);
    expect(isNewExpenseShortcut(key({ key: "m" }))).toBe(false);
    expect(isNewExpenseShortcut(key({ target: document.createElement("input") }))).toBe(false);
  });
});
```

Append to `src/lib/finance-expenses.test.ts` (inside the file, after the existing `describe` block; add `toExpenseFieldDrafts` to the existing import from `@/lib/finance-expenses`, and `ExpenseFieldValueDisplay` to the type import):

```ts
describe("toExpenseFieldDrafts", () => {
  const base: ExpenseFieldValueDisplay = {
    id: "v", fieldId: "f", fieldKey: null, fieldLabel: "Label", fieldType: "text", displayValue: "",
    isFieldActive: true, isOptionActive: null, optionLabel: null,
    valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueOptionId: null,
  };

  it("turns saved values back into form values", () => {
    const drafts = toExpenseFieldDrafts([
      { ...base, fieldId: "meter", fieldType: "text", valueText: "M-12" },
      { ...base, fieldId: "units", fieldType: "number", valueNumber: "340.00" },
      { ...base, fieldId: "due", fieldType: "date", valueDate: "2026-10-20T00:00:00.000Z" },
      { ...base, fieldId: "area", fieldType: "select", valueOptionId: "opt-1" },
      { ...base, fieldId: "late", fieldType: "boolean", valueBoolean: false },
      { ...base, fieldId: "unknown", fieldType: null },
    ]);

    expect(drafts).toEqual({
      meter: { valueText: "M-12" },
      units: { valueNumber: "340.00" },
      due: { valueDate: new Date("2026-10-20T00:00:00.000Z") },
      area: { valueOptionId: "opt-1" },
      late: { valueBoolean: "false" },
    });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun run test -- src/lib/finance/expense-entry.test.ts src/lib/finance-expenses.test.ts`
Expected: FAIL — missing module `./expense-entry`, missing export `toExpenseFieldDrafts`.

- [ ] **Step 3: Add `valueOptionId` to the display type**

In `src/lib/types/finance-types.ts`, inside `export type ExpenseFieldValueDisplay = { ... }`, add after `valueBoolean: boolean | null;`:

```ts
  valueOptionId: string | null;
```

In `src/server-functions/finance-fn.ts`, inside `getExpensesFn`'s `dynamicFields` mapping, add after `valueBoolean: fieldValue.valueBoolean,`:

```ts
          valueOptionId: fieldValue.valueOptionId,
```

- [ ] **Step 4: Write `expense-entry.ts`**

```ts
// src/lib/finance/expense-entry.ts
import Big from "big.js";

export const QUICK_CATEGORY_COUNT = 6;

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
```

- [ ] **Step 5: Add `toExpenseFieldDrafts`**

In `src/lib/finance-expenses.ts`, add `ExpenseFieldValueDisplay` to the existing `import type { ... } from "@/lib/types/finance-types";`, then append:

```ts
/** Saved custom-field values -> the shapes the form inputs use (for the edit form). */
export const toExpenseFieldDrafts = (
  fields: ExpenseFieldValueDisplay[],
): Record<string, ExpenseFieldDraftValue> => {
  const drafts: Record<string, ExpenseFieldDraftValue> = {};

  for (const field of fields) {
    if (field.fieldType === "text" || field.fieldType === "textarea") {
      drafts[field.fieldId] = { valueText: field.valueText ?? "" };
    } else if (field.fieldType === "number") {
      drafts[field.fieldId] = { valueNumber: field.valueNumber ?? "" };
    } else if (field.fieldType === "date") {
      drafts[field.fieldId] = { valueDate: field.valueDate ? new Date(field.valueDate) : undefined };
    } else if (field.fieldType === "select") {
      drafts[field.fieldId] = { valueOptionId: field.valueOptionId ?? "" };
    } else if (field.fieldType === "boolean") {
      drafts[field.fieldId] = {
        valueBoolean: field.valueBoolean === null ? "" : field.valueBoolean ? "true" : "false",
      };
    }
  }

  return drafts;
};
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `bun run test -- src/lib/finance/expense-entry.test.ts src/lib/finance-expenses.test.ts`
Expected: PASS.

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/lib/finance/expense-entry.ts src/lib/finance/expense-entry.test.ts src/lib/finance-expenses.ts src/lib/finance-expenses.test.ts src/lib/types/finance-types.ts src/server-functions/finance-fn.ts
git commit -m "feat(finance): add expense entry helpers for amounts, payees and shortcuts"
```

---

### Task 3: Correction helpers

**Files:**
- Create: `src/lib/finance/expense-corrections.ts`
- Test: `src/lib/finance/expense-corrections.test.ts`
- Modify: `src/lib/types/finance-types.ts` (add `ExpenseEditChange`)

**Interfaces:**
- Consumes: `formatRupees` (Task 2).
- Produces (from `src/lib/finance/expense-corrections.ts`):
  - `OVERDRAW_CONFIRM_REQUIRED = "OVERDRAW_CONFIRM_REQUIRED"`
  - `overdrawError(walletName: string, balanceAfter: string): Error`
  - `isOverdrawConfirmError(error: unknown): boolean`
  - `type WalletChange = { walletId: string; type: "debit" | "credit"; amount: string }`
  - `planExpenseWalletChanges(before: { walletId: string; amount: string | number }, after: { walletId: string; amount: string | number }): WalletChange[]`
  - `describeExpenseCorrection(kind: "correction" | "void", expenseDate: Date | string): string`
  - `describeWalletChange(change: WalletChange, walletName: string): string`
  - `type ExpenseSnapshot = Record<string, string>`
  - `type ExpenseSnapshotSource = { amount: string; description: string; payee: string | null; slipNumber: string | null; expenseDate: Date | string; categoryName: string; walletName: string; fields: Array<{ label: string; displayValue: string }> }`
  - `toExpenseSnapshot(source: ExpenseSnapshotSource): ExpenseSnapshot`
  - `diffExpenseSnapshots(before: ExpenseSnapshot, after: ExpenseSnapshot): ExpenseEditChange[]`
  - `EXPENSE_AUTO_LOCK_MESSAGE`, `EXPENSE_VOIDED_MESSAGE` (strings)
  - `getExpenseLockReason(expense: { origin: string; voidedAt: Date | string | null }): string | null`
- Produces (type): `ExpenseEditChange = { field: string; from: string; to: string }` in `finance-types.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/finance/expense-corrections.test.ts
import { describe, expect, it } from "vitest";
import {
  EXPENSE_AUTO_LOCK_MESSAGE,
  EXPENSE_VOIDED_MESSAGE,
  OVERDRAW_CONFIRM_REQUIRED,
  describeExpenseCorrection,
  describeWalletChange,
  diffExpenseSnapshots,
  getExpenseLockReason,
  isOverdrawConfirmError,
  overdrawError,
  planExpenseWalletChanges,
  toExpenseSnapshot,
} from "./expense-corrections";

describe("overdraft marker", () => {
  it("builds an error the form can recognise", () => {
    const error = overdrawError("Cash in Hand", "-2000.00");
    expect(error.message).toBe(`${OVERDRAW_CONFIRM_REQUIRED}: "Cash in Hand" would go to −Rs 2,000`);
    expect(isOverdrawConfirmError(error)).toBe(true);
    expect(isOverdrawConfirmError(new Error("Wallet not found"))).toBe(false);
    expect(isOverdrawConfirmError("nope")).toBe(false);
  });
});

describe("planExpenseWalletChanges", () => {
  it.each([
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 5000 }, []],
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 5500 }, [{ walletId: "cash", type: "debit", amount: "500.00" }]],
    [{ walletId: "cash", amount: "5000.00" }, { walletId: "cash", amount: 4000 }, [{ walletId: "cash", type: "credit", amount: "1000.00" }]],
    [
      { walletId: "cash", amount: "5000.00" },
      { walletId: "bank", amount: 5000 },
      [
        { walletId: "cash", type: "credit", amount: "5000.00" },
        { walletId: "bank", type: "debit", amount: "5000.00" },
      ],
    ],
    [{ walletId: "cash", amount: "0.10" }, { walletId: "cash", amount: 0.3 }, [{ walletId: "cash", type: "debit", amount: "0.20" }]],
  ])("plans %j -> %j", (before, after, changes) => {
    expect(planExpenseWalletChanges(before, after)).toEqual(changes);
  });
});

describe("wording", () => {
  it("names the original expense date", () => {
    expect(describeExpenseCorrection("correction", new Date(2026, 9, 12, 10))).toBe("Correction to expense of 12 Oct 2026");
    expect(describeExpenseCorrection("void", new Date(2026, 9, 12, 10))).toBe("Void of expense of 12 Oct 2026");
  });

  it("explains what happens to an account", () => {
    expect(describeWalletChange({ walletId: "cash", type: "debit", amount: "500.00" }, "Cash in Hand")).toBe("Rs 500 more will be taken from Cash in Hand");
    expect(describeWalletChange({ walletId: "cash", type: "credit", amount: "1000.00" }, "Cash in Hand")).toBe("Rs 1,000 goes back to Cash in Hand");
  });
});

describe("snapshots", () => {
  const source = {
    amount: "5000.00",
    description: "",
    payee: null,
    slipNumber: null,
    expenseDate: new Date(2026, 9, 12, 10),
    categoryName: "Electricity",
    walletName: "Cash in Hand",
    fields: [{ label: "Meter no.", displayValue: "M-12" }],
  };

  it("lists the fields in a fixed order", () => {
    expect(toExpenseSnapshot(source)).toEqual({
      Amount: "Rs 5,000",
      Category: "Electricity",
      "Paid to": "",
      "Paid from": "Cash in Hand",
      Date: "12 Oct 2026",
      Note: "",
      "Slip / ref": "",
      "Meter no.": "M-12",
    });
  });

  it("reports only what changed, in order", () => {
    const before = toExpenseSnapshot(source);
    const after = toExpenseSnapshot({ ...source, amount: "5500.00", payee: "LESCO", fields: [] });
    expect(diffExpenseSnapshots(before, after)).toEqual([
      { field: "Amount", from: "Rs 5,000", to: "Rs 5,500" },
      { field: "Paid to", from: "", to: "LESCO" },
      { field: "Meter no.", from: "M-12", to: "" },
    ]);
    expect(diffExpenseSnapshots(before, before)).toEqual([]);
  });
});

describe("getExpenseLockReason", () => {
  it("allows manual expenses that are not voided", () => {
    expect(getExpenseLockReason({ origin: "manual", voidedAt: null })).toBeNull();
  });

  it("locks expenses made by other screens", () => {
    expect(getExpenseLockReason({ origin: "system", voidedAt: null })).toBe(EXPENSE_AUTO_LOCK_MESSAGE);
  });

  it("locks voided expenses", () => {
    expect(getExpenseLockReason({ origin: "manual", voidedAt: new Date() })).toBe(EXPENSE_VOIDED_MESSAGE);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun run test -- src/lib/finance/expense-corrections.test.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Add the change type**

Append to `src/lib/types/finance-types.ts`:

```ts
export type ExpenseEditChange = {
  field: string;
  from: string;
  to: string;
};
```

- [ ] **Step 4: Write `expense-corrections.ts`**

```ts
// src/lib/finance/expense-corrections.ts
import Big from "big.js";
import { format } from "date-fns";
import type { ExpenseEditChange } from "@/lib/types/finance-types";
import { formatRupees } from "./expense-entry";

/** Marker in the server error that asks the form to show the "Save anyway?" dialog. */
export const OVERDRAW_CONFIRM_REQUIRED = "OVERDRAW_CONFIRM_REQUIRED";

export function overdrawError(walletName: string, balanceAfter: string): Error {
  return new Error(`${OVERDRAW_CONFIRM_REQUIRED}: "${walletName}" would go to ${formatRupees(balanceAfter)}`);
}

export function isOverdrawConfirmError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(OVERDRAW_CONFIRM_REQUIRED);
}

export type WalletChange = {
  walletId: string;
  type: "debit" | "credit";
  amount: string;
};

/** The account movements needed to turn the old expense into the new one. */
export function planExpenseWalletChanges(
  before: { walletId: string; amount: string | number },
  after: { walletId: string; amount: string | number },
): WalletChange[] {
  const oldAmount = new Big(before.amount);
  const newAmount = new Big(after.amount);

  if (before.walletId !== after.walletId) {
    return [
      { walletId: before.walletId, type: "credit", amount: oldAmount.toFixed(2) },
      { walletId: after.walletId, type: "debit", amount: newAmount.toFixed(2) },
    ];
  }

  const difference = newAmount.minus(oldAmount);
  if (difference.eq(0)) return [];
  return [
    {
      walletId: after.walletId,
      type: difference.gt(0) ? "debit" : "credit",
      amount: difference.abs().toFixed(2),
    },
  ];
}

export function describeExpenseCorrection(kind: "correction" | "void", expenseDate: Date | string): string {
  const day = format(new Date(expenseDate), "d MMM yyyy");
  return kind === "void" ? `Void of expense of ${day}` : `Correction to expense of ${day}`;
}

export function describeWalletChange(change: WalletChange, walletName: string): string {
  return change.type === "debit"
    ? `${formatRupees(change.amount)} more will be taken from ${walletName}`
    : `${formatRupees(change.amount)} goes back to ${walletName}`;
}

export type ExpenseSnapshot = Record<string, string>;

export type ExpenseSnapshotSource = {
  amount: string;
  description: string;
  payee: string | null;
  slipNumber: string | null;
  expenseDate: Date | string;
  categoryName: string;
  walletName: string;
  fields: Array<{ label: string; displayValue: string }>;
};

export function toExpenseSnapshot(source: ExpenseSnapshotSource): ExpenseSnapshot {
  const snapshot: ExpenseSnapshot = {
    Amount: formatRupees(source.amount),
    Category: source.categoryName,
    "Paid to": source.payee ?? "",
    "Paid from": source.walletName,
    Date: format(new Date(source.expenseDate), "d MMM yyyy"),
    Note: source.description,
    "Slip / ref": source.slipNumber ?? "",
  };
  for (const field of source.fields) snapshot[field.label] = field.displayValue;
  return snapshot;
}

export function diffExpenseSnapshots(before: ExpenseSnapshot, after: ExpenseSnapshot): ExpenseEditChange[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => (before[field] ?? "") !== (after[field] ?? ""))
    .map((field) => ({ field, from: before[field] ?? "", to: after[field] ?? "" }));
}

export const EXPENSE_AUTO_LOCK_MESSAGE =
  "This expense was made automatically by another screen (for example a supplier payment or payroll). Change it there.";
export const EXPENSE_VOIDED_MESSAGE = "This expense has been voided and can no longer be changed.";

/** Why an expense cannot be edited or voided, or null when it can. */
export function getExpenseLockReason(expense: { origin: string; voidedAt: Date | string | null }): string | null {
  if (expense.voidedAt) return EXPENSE_VOIDED_MESSAGE;
  if (expense.origin !== "manual") return EXPENSE_AUTO_LOCK_MESSAGE;
  return null;
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `bun run test -- src/lib/finance/expense-corrections.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/finance/expense-corrections.ts src/lib/finance/expense-corrections.test.ts src/lib/types/finance-types.ts
git commit -m "feat(finance): add expense correction helpers for wallet moves and edit logs"
```

---

### Task 4: Schema — payee, origin, void columns, transaction description, edit log

**Files:**
- Modify: `src/db/schemas/finance-schema.ts`
- Generated: one new migration under `src/db/migrations/` (by `bun run db:generate` only)

**Interfaces:**
- Produces (columns): `expenses.payee` (text, null), `expenses.origin` (text, not null, default `"system"`), `expenses.voidedAt` (timestamptz, null), `expenses.voidedById` (text → user, null), `expenses.voidReason` (text, null), `expenses.voidTransactionId` (text → transactions, null), `transactions.description` (text, null).
- Produces (table): `expenseEdits` / `expense_edits` with `id`, `expenseId` (→ expenses, cascade), `editedById` (→ user), `changes` (jsonb `Array<{ field: string; from: string; to: string }>`), `createdAt`, `updatedAt`.
- Produces (relations): `expenses.voidedBy`, `expenses.edits`, `expenseEdits.expense`, `expenseEdits.editor`.

- [ ] **Step 1: Add `jsonb` to the pg-core import**

In `src/db/schemas/finance-schema.ts`, change the `drizzle-orm/pg-core` import to include `jsonb`:

```ts
import {
  type AnyPgColumn,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add the expense columns**

In the `expenses` table, after `remarks: text("remarks"),` add:

```ts
  payee: text("payee"),
  // "manual" = Record expense form (can be edited/voided); "system" = made by another screen.
  origin: text("origin").notNull().default("system"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedById: text("voided_by_id").references(() => user.id),
  voidReason: text("void_reason"),
  voidTransactionId: text("void_transaction_id").references(
    (): AnyPgColumn => transactions.id,
  ),
```

- [ ] **Step 3: Add the transaction description**

In the `transactions` table, after `referenceId: text("reference_id"), // ID of Invoice, Expense, or Payroll record` add:

```ts
    description: text("description"), // e.g. "Correction to expense of 12 Oct 2026"
```

- [ ] **Step 4: Add the edit log table**

Directly after the `expenseFieldValues` table definition (before `// --- TRANSACTIONS (Journal) ---`) add:

```ts
// --- EXPENSE EDITS (who changed what on a manual expense) ---
export const expenseEdits = pgTable(
  "expense_edits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    editedById: text("edited_by_id")
      .notNull()
      .references(() => user.id),
    changes: jsonb("changes")
      .$type<Array<{ field: string; from: string; to: string }>>()
      .notNull(),
    ...timestamps,
  },
  (table) => ({
    expenseIdx: index("expense_edits_expense_idx").on(table.expenseId, table.createdAt),
  }),
);
```

- [ ] **Step 5: Add the relations**

Replace `export const expensesRelations = ...` with:

```ts
export const expensesRelations = relations(expenses, ({ one, many }) => ({
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  wallet: one(wallets, {
    fields: [expenses.walletId],
    references: [wallets.id],
  }),
  performer: one(user, {
    fields: [expenses.performedById],
    references: [user.id],
  }),
  voidedBy: one(user, {
    fields: [expenses.voidedById],
    references: [user.id],
    relationName: "expenseVoidedBy",
  }),
  fieldValues: many(expenseFieldValues),
  edits: many(expenseEdits),
}));

export const expenseEditsRelations = relations(expenseEdits, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseEdits.expenseId],
    references: [expenses.id],
  }),
  editor: one(user, {
    fields: [expenseEdits.editedById],
    references: [user.id],
  }),
}));
```

- [ ] **Step 6: Generate and apply the migration**

```bash
bun run db:generate
bun run db:migrate
DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
```

Expected: one new SQL file that adds the six `expenses` columns, `transactions.description`, the `expense_edits` table, its index and three foreign keys. If `db:generate` asks whether a column is a rename, answer "create column" — nothing is renamed in this task. Do not edit the generated files.

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/db/schemas/finance-schema.ts src/db/migrations
git commit -m "feat(finance): store expense payee, origin, voids and an edit log"
```

---

### Task 5: Shared write steps, new create, entry defaults

**Files:**
- Create: `src/server-functions/finance/expense-writes.server.ts`
- Create: `src/server-functions/finance/expense-entry-defaults-fn.ts`
- Modify: `src/server-functions/finance-fn.ts` (move the custom-field schemas out, rebuild `createExpenseFn`)
- Modify: `src/lib/types/finance-types.ts` (`ExpenseEntryDefaults`, `CreateExpenseInput`)
- Create: `src/__tests__/integration/expense-fixture.ts`
- Test: `src/__tests__/integration/expense-entry.test.ts`

**Interfaces:**
- Consumes: `overdrawError`, `toExpenseSnapshot`, `WalletChange`, `ExpenseSnapshot` (Task 3); `QUICK_CATEGORY_COUNT` (Task 2); schema (Task 4).
- Produces (from `expense-writes.server.ts`):
  - `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`
  - `dynamicFieldTypeSchema`, `dynamicFieldValueSchema` (zod, moved unchanged from `finance-fn.ts`)
  - `resolveExpenseCategory(tx: Tx, input: { categoryId?: string; category?: string }, options?: { allowInactiveId?: string }): Promise<{ id: string; name: string }>`
  - `validateExpenseFieldValues(tx: Tx, categoryId: string, values: FinanceDynamicFieldValueInput[]): Promise<string[]>` — returns the category's active field ids
  - `insertExpenseFieldValues(tx: Tx, expenseId: string, values: FinanceDynamicFieldValueInput[]): Promise<void>`
  - `deleteExpenseFieldValues(tx: Tx, expenseId: string, fieldIds?: string[]): Promise<void>`
  - `applyWalletChange(tx: Tx, change: WalletChange, options: { allowOverdraw: boolean; performedById: string; referenceId: string; description?: string }): Promise<string>` — returns the new transaction id
  - `loadExpenseSnapshot(tx: Tx, expenseId: string): Promise<ExpenseSnapshot>`
- Produces: `createExpenseFn` input now `{ description?: string; category?: string; categoryId?: string; amount: number; walletId: string; payee?: string; expenseDate?: string; slipNumber?: string; remarks?: string; allowOverdraw?: boolean; fieldValues?: FinanceDynamicFieldValueInput[] }`
- Produces: `getExpenseEntryDefaultsFn(): Promise<ExpenseEntryDefaults>` where `ExpenseEntryDefaults = { lastWalletId: string | null; categoryUsageRank: string[]; payees: string[] }`
- Produces (test helper): `expenseFixture(balance?: string)` returning `{ actor, cash, bank, fuel, rent, context, balanceOf, expense, moves }`

- [ ] **Step 1: Write the shared test fixture**

```ts
// src/__tests__/integration/expense-fixture.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, expenses, transactions, user, wallets } from "@/db";
import { expenseCategories } from "@/db/schemas/finance-schema";

export const EXPENSE_DAY = "2026-10-12T05:00:00.000Z"; // shows as "12 Oct 2026"

// Each call commits its own rows with unique names, so suites never share accounts or categories.
export async function expenseFixture(balance = "10000.00") {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Accountant", email: `${id}@test.invalid` }).returning();
  const [cash] = await db.insert(wallets).values({ id: `cash-${id}`, name: `Cash ${id.slice(0, 8)}`, type: "cash", balance }).returning();
  const [bank] = await db.insert(wallets).values({ id: `bank-${id}`, name: `Bank ${id.slice(0, 8)}`, type: "bank", balance: "50000.00" }).returning();
  const [fuel] = await db.insert(expenseCategories).values({ name: `Fuel ${id}`, slug: `fuel-${id}` }).returning();
  const [rent] = await db.insert(expenseCategories).values({ name: `Rent ${id}`, slug: `rent-${id}` }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };

  const balanceOf = async (walletId: string) =>
    (await db.select().from(wallets).where(eq(wallets.id, walletId)))[0].balance;
  const expense = async (expenseId: string) =>
    (await db.select().from(expenses).where(eq(expenses.id, expenseId)))[0];
  const moves = async (expenseId: string) =>
    db.select().from(transactions).where(eq(transactions.referenceId, expenseId));

  return { actor, cash, bank, fuel, rent, context, balanceOf, expense, moves };
}
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/__tests__/integration/expense-entry.test.ts
import { describe, expect, it, vi } from "vitest";
import { OVERDRAW_CONFIRM_REQUIRED } from "@/lib/finance/expense-corrections";
import type { ExpenseEntryDefaults } from "@/lib/types/finance-types";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { getExpenseEntryDefaultsFn } from "@/server-functions/finance/expense-entry-defaults-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("recording expenses", () => {
  it("records a manual expense with a payee and no note, and takes the money from the account", async () => {
    const f = await expenseFixture();
    const created = (await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 2500, walletId: f.cash.id, payee: "  Shell Pump Ravi Road ", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never)) as { id: string };

    expect(await f.expense(created.id)).toMatchObject({
      amount: "2500.00", payee: "Shell Pump Ravi Road", description: "", origin: "manual", voidedAt: null,
    });
    expect(await f.balanceOf(f.cash.id)).toBe("7500.00");
    expect((await f.moves(created.id)).map((m) => [m.type, m.amount, m.source, m.description])).toEqual([
      ["debit", "2500.00", "Expense", null],
    ]);
  });

  it("asks for confirmation before taking an account below zero", async () => {
    const f = await expenseFixture("2000.00");
    const data = { categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, expenseDate: EXPENSE_DAY };

    await expect(createExpenseFn({ data, context: f.context } as never)).rejects.toThrow(OVERDRAW_CONFIRM_REQUIRED);
    expect(await f.balanceOf(f.cash.id)).toBe("2000.00");

    await createExpenseFn({ data: { ...data, allowOverdraw: true }, context: f.context } as never);
    expect(await f.balanceOf(f.cash.id)).toBe("-3000.00");
  });

  it("suggests this user's last account, their most used categories and past payees", async () => {
    const f = await expenseFixture();
    const record = (categoryId: string, walletId: string, payee: string) =>
      createExpenseFn({ data: { categoryId, amount: 100, walletId, payee, expenseDate: EXPENSE_DAY }, context: f.context } as never);
    await record(f.rent.id, f.cash.id, `Landlord ${f.actor.id}`);
    await record(f.fuel.id, f.cash.id, `Pump ${f.actor.id}`);
    await record(f.fuel.id, f.bank.id, `Pump ${f.actor.id}`);

    const defaults = (await getExpenseEntryDefaultsFn({ context: f.context } as never)) as ExpenseEntryDefaults;

    expect(defaults.lastWalletId).toBe(f.bank.id);
    expect(defaults.categoryUsageRank).toEqual([f.fuel.id, f.rent.id]);
    expect(defaults.payees).toEqual(expect.arrayContaining([`Landlord ${f.actor.id}`, `Pump ${f.actor.id}`]));
    expect(defaults.payees.filter((p) => p === `Pump ${f.actor.id}`)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-entry.test.ts`
Expected: FAIL — missing module `expense-entry-defaults-fn`.

- [ ] **Step 4: Add the types**

In `src/lib/types/finance-types.ts`, replace `export type CreateExpenseInput = { ... };` with:

```ts
export type CreateExpenseInput = {
  description?: string;
  category?: string;
  categoryId?: string;
  amount: number;
  walletId: string;
  payee?: string;
  expenseDate?: string;
  slipNumber?: string;
  remarks?: string;
  allowOverdraw?: boolean;
  fieldValues?: FinanceDynamicFieldValueInput[];
};

export type ExpenseEntryDefaults = {
  lastWalletId: string | null;
  categoryUsageRank: string[];
  payees: string[];
};
```

- [ ] **Step 5: Write the shared write steps**

```ts
// src/server-functions/finance/expense-writes.server.ts
import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { isValid, parseISO } from "date-fns";
import { z } from "zod";
import type { db } from "@/db";
import {
  categoryFieldOptions,
  categoryFields,
  expenseCategories,
  expenseFieldValues,
  expenses,
  transactions,
  wallets,
} from "@/db/schemas/finance-schema";
import { formatExpenseFieldDisplayValue } from "@/lib/finance-expenses";
import {
  overdrawError,
  toExpenseSnapshot,
  type ExpenseSnapshot,
  type WalletChange,
} from "@/lib/finance/expense-corrections";
import type { FinanceDynamicFieldValueInput } from "@/lib/types/finance-types";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const dynamicFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "boolean",
]);
```

Then **move** (cut from `src/server-functions/finance-fn.ts`, paste here unchanged except for adding `export`) the whole `const dynamicFieldValueSchema = z.object({ ... }).superRefine(...)` block so it reads `export const dynamicFieldValueSchema = z ...`. Delete `const dynamicFieldTypeSchema = z.enum([...])` from `finance-fn.ts` (it now lives here). Leave `dynamicFieldFilterSchema` in `finance-fn.ts`.

Continue the file:

```ts
export async function resolveExpenseCategory(
  tx: Tx,
  input: { categoryId?: string; category?: string },
  options: { allowInactiveId?: string } = {},
): Promise<{ id: string; name: string }> {
  const columns = { id: true, name: true, isActive: true } as const;
  const record = input.categoryId
    ? await tx.query.expenseCategories.findFirst({
        where: and(eq(expenseCategories.id, input.categoryId), eq(expenseCategories.isArchived, false)),
        columns,
      })
    : input.category
      ? await tx.query.expenseCategories.findFirst({
          where: and(eq(expenseCategories.name, input.category), eq(expenseCategories.isArchived, false)),
          columns,
        })
      : null;

  // An edit may keep a category that was switched off after the expense was recorded.
  if (!record || (!record.isActive && record.id !== options.allowInactiveId)) {
    throw new Error("Please select an active category");
  }

  return { id: record.id, name: record.name };
}

/** Checks submitted custom-field values against the category's active fields; returns those field ids. */
export async function validateExpenseFieldValues(
  tx: Tx,
  categoryId: string,
  values: FinanceDynamicFieldValueInput[],
): Promise<string[]> {
  const activeFields = await tx.query.categoryFields.findMany({
    where: and(eq(categoryFields.categoryId, categoryId), eq(categoryFields.isActive, true)),
    columns: {
      id: true,
      key: true,
      label: true,
      fieldType: true,
      isRequired: true,
      minLength: true,
      maxLength: true,
      minNumber: true,
      maxNumber: true,
      minDate: true,
      maxDate: true,
      regexPattern: true,
    },
  });

  const defsById = new Map(activeFields.map((f) => [f.id, f]));

  for (const value of values) {
    const def = defsById.get(value.fieldId);
    if (!def) {
      throw new Error("Submitted field is not active for this category");
    }

    if (def.fieldType !== value.fieldType) {
      throw new Error(`Field \"${def.label}\" type mismatch`);
    }

    if (value.fieldType === "text" || value.fieldType === "textarea") {
      const textValue = value.valueText ?? "";

      if (def.minLength !== null && textValue.length < def.minLength) {
        throw new Error(`Field \"${def.label}\" is shorter than allowed`);
      }

      if (def.maxLength !== null && textValue.length > def.maxLength) {
        throw new Error(`Field \"${def.label}\" is longer than allowed`);
      }

      if (def.regexPattern) {
        const regex = new RegExp(def.regexPattern);
        if (!regex.test(textValue)) {
          throw new Error(`Field \"${def.label}\" format is invalid`);
        }
      }
    }

    if (value.fieldType === "number") {
      const numberValue = value.valueNumber ?? 0;
      const minNumber = def.minNumber !== null ? parseFloat(def.minNumber) : undefined;
      const maxNumber = def.maxNumber !== null ? parseFloat(def.maxNumber) : undefined;

      if (minNumber !== undefined && numberValue < minNumber) {
        throw new Error(`Field \"${def.label}\" is below minimum value`);
      }

      if (maxNumber !== undefined && numberValue > maxNumber) {
        throw new Error(`Field \"${def.label}\" exceeds maximum value`);
      }
    }

    if (value.fieldType === "date") {
      const dateValue = value.valueDate ? parseISO(value.valueDate) : null;
      if (!dateValue || !isValid(dateValue)) {
        throw new Error(`Field \"${def.label}\" has an invalid date`);
      }

      if (def.minDate && dateValue < def.minDate) {
        throw new Error(`Field \"${def.label}\" is before minimum date`);
      }

      if (def.maxDate && dateValue > def.maxDate) {
        throw new Error(`Field \"${def.label}\" is after maximum date`);
      }
    }

    if (value.fieldType === "select") {
      const optionId = value.valueOptionId;
      if (!optionId) {
        throw new Error(`Field \"${def.label}\" requires an option`);
      }

      const option = await tx.query.categoryFieldOptions.findFirst({
        where: and(
          eq(categoryFieldOptions.id, optionId),
          eq(categoryFieldOptions.fieldId, def.id),
          eq(categoryFieldOptions.isActive, true),
        ),
        columns: { id: true },
      });

      if (!option) {
        throw new Error(`Field \"${def.label}\" has an invalid option`);
      }
    }
  }

  const providedFieldIds = new Set(values.map((f) => f.fieldId));
  const missingRequired = activeFields.filter((f) => f.isRequired && !providedFieldIds.has(f.id));

  if (missingRequired.length > 0) {
    throw new Error(`Missing required fields: ${missingRequired.map((f) => f.label).join(", ")}`);
  }

  return activeFields.map((f) => f.id);
}

export async function insertExpenseFieldValues(
  tx: Tx,
  expenseId: string,
  values: FinanceDynamicFieldValueInput[],
): Promise<void> {
  if (values.length === 0) return;

  await tx.insert(expenseFieldValues).values(
    values.map((value) => {
      const parsedDate = value.valueDate ? parseISO(value.valueDate) : null;
      return {
        id: createId(),
        expenseId,
        fieldId: value.fieldId,
        valueText:
          value.fieldType === "text" || value.fieldType === "textarea" ? (value.valueText ?? null) : null,
        valueNumber:
          value.fieldType === "number" && value.valueNumber !== undefined ? value.valueNumber.toString() : null,
        valueDate:
          value.fieldType === "date" && parsedDate && isValid(parsedDate) ? parsedDate : null,
        valueBoolean: value.fieldType === "boolean" ? (value.valueBoolean ?? null) : null,
        valueOptionId: value.fieldType === "select" ? (value.valueOptionId ?? null) : null,
      };
    }),
  );
}

/** Deletes all saved custom-field values, or only those for `fieldIds`. */
export async function deleteExpenseFieldValues(tx: Tx, expenseId: string, fieldIds?: string[]): Promise<void> {
  if (fieldIds && fieldIds.length === 0) return;
  await tx
    .delete(expenseFieldValues)
    .where(
      fieldIds
        ? and(eq(expenseFieldValues.expenseId, expenseId), inArray(expenseFieldValues.fieldId, fieldIds))
        : eq(expenseFieldValues.expenseId, expenseId),
    );
}

/**
 * Moves money on one account and writes the journal row. A debit that leaves the account below
 * zero throws the overdraft marker unless `allowOverdraw` is set; the caller's transaction rolls back.
 */
export async function applyWalletChange(
  tx: Tx,
  change: WalletChange,
  options: { allowOverdraw: boolean; performedById: string; referenceId: string; description?: string },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance:
        change.type === "debit"
          ? sql`${wallets.balance} - ${change.amount}`
          : sql`${wallets.balance} + ${change.amount}`,
    })
    .where(eq(wallets.id, change.walletId))
    .returning({ name: wallets.name, balance: wallets.balance });

  if (!wallet) throw new Error("Wallet not found");
  if (change.type === "debit" && !options.allowOverdraw && new Big(wallet.balance).lt(0)) {
    throw overdrawError(wallet.name, wallet.balance);
  }

  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: change.walletId,
    type: change.type,
    amount: change.amount,
    source: "Expense",
    referenceId: options.referenceId,
    description: options.description ?? null,
    performedById: options.performedById,
  });
  return id;
}

export async function loadExpenseSnapshot(tx: Tx, expenseId: string): Promise<ExpenseSnapshot> {
  const row = await tx.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: {
      category: { columns: { name: true } },
      wallet: { columns: { name: true } },
      fieldValues: {
        with: {
          field: { columns: { label: true, sortOrder: true } },
          option: { columns: { label: true } },
        },
      },
    },
  });
  if (!row) throw new Error("Expense not found");

  const fields = [...row.fieldValues]
    .sort(
      (left, right) =>
        (left.field?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.field?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.field?.label ?? "").localeCompare(right.field?.label ?? ""),
    )
    .map((value) => ({
      label: value.field?.label ?? "Unknown field",
      displayValue: formatExpenseFieldDisplayValue({
        optionLabel: value.option?.label,
        valueBoolean: value.valueBoolean,
        valueDate: value.valueDate,
        valueNumber: value.valueNumber,
        valueText: value.valueText,
      }),
    }));

  return toExpenseSnapshot({
    amount: row.amount,
    description: row.description,
    payee: row.payee,
    slipNumber: row.slipNumber,
    expenseDate: row.expenseDate,
    categoryName: row.category?.name ?? "",
    walletName: row.wallet?.name ?? "",
    fields,
  });
}
```

- [ ] **Step 6: Rebuild `createExpenseFn`**

In `src/server-functions/finance-fn.ts`:

1. Add imports:
```ts
import Big from "big.js";
import {
  applyWalletChange,
  dynamicFieldTypeSchema,
  dynamicFieldValueSchema,
  insertExpenseFieldValues,
  resolveExpenseCategory,
  validateExpenseFieldValues,
} from "@/server-functions/finance/expense-writes.server";
```
2. Replace the whole `export const createExpenseFn = createServerFn() ... ;` block (from the `/** Record an expense — validates wallet has enough balance */` comment through the closing `});` before `/** List all expenses with wallet info */`) with:

```ts
/**
 * Record an expense from the Record expense form. Taking an account below zero needs
 * `allowOverdraw: true`, which the form sends after the user confirms.
 */
export const createExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      description: z.string().trim().max(1000).optional().default(""),
      category: z.string().optional(),
      categoryId: z.string().optional(),
      amount: z.number().positive("Amount must be greater than 0"),
      walletId: z.string().min(1, "Please select a payment source"),
      payee: z.string().trim().max(200).optional(),
      expenseDate: z.string().optional(),
      slipNumber: z.string().trim().max(100).optional(),
      remarks: z.string().trim().max(1000).optional(),
      allowOverdraw: z.boolean().optional().default(false),
      fieldValues: z.array(dynamicFieldValueSchema).optional().default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const categoryRecord = await resolveExpenseCategory(tx, data);
      await validateExpenseFieldValues(tx, categoryRecord.id, data.fieldValues);

      const expenseDate = data.expenseDate ? parseISO(data.expenseDate) : new Date();
      if (!isValid(expenseDate)) {
        throw new Error("Invalid expense date");
      }

      const expenseId = createId();
      const amount = new Big(data.amount).toFixed(2);
      const userId = context.session.user.id;

      // Wallet first: a missing account fails cleanly before anything is written.
      await applyWalletChange(
        tx,
        { walletId: data.walletId, type: "debit", amount },
        { allowOverdraw: data.allowOverdraw, performedById: userId, referenceId: expenseId },
      );

      const [expense] = await tx
        .insert(expenses)
        .values({
          id: expenseId,
          description: data.description,
          payee: data.payee || null,
          origin: "manual",
          category: categoryRecord.name,
          categoryId: categoryRecord.id,
          expenseDate,
          amount,
          slipNumber: data.slipNumber || null,
          remarks: data.remarks || null,
          walletId: data.walletId,
          performedById: userId,
        })
        .returning();

      await insertExpenseFieldValues(tx, expenseId, data.fieldValues);

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Recorded expense of ${amount} for ${data.description || data.payee || categoryRecord.name}`,
      });

      return expense;
    });
  });
```

3. Remove names that are no longer used in `finance-fn.ts`. Run:
```bash
for name in categoryFieldOptions categoryFields expenseCategories expenseFieldValues; do echo "$name: $(grep -c "\b$name\b" src/server-functions/finance-fn.ts)"; done
```
Any name that shows `1` appears only in the import — delete it from the `@/db/schemas/finance-schema` import.

- [ ] **Step 7: Write the defaults function**

```ts
// src/server-functions/finance/expense-entry-defaults-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schemas/finance-schema";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import { QUICK_CATEGORY_COUNT } from "@/lib/finance/expense-entry";
import type { ExpenseEntryDefaults } from "@/lib/types/finance-types";

const PAYEE_SUGGESTION_LIMIT = 200;

/**
 * What the Record expense form pre-fills: this user's last account and most used categories,
 * plus payee names anyone has used before (newest first).
 */
export const getExpenseEntryDefaultsFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .handler(async ({ context }): Promise<ExpenseEntryDefaults> => {
    const mine = and(eq(expenses.performedById, context.session.user.id), eq(expenses.origin, "manual"));
    const uses = sql<number>`count(*)`;
    const lastUsed = sql<Date>`max(${expenses.createdAt})`;

    const [[last], categoryRows, payeeRows] = await Promise.all([
      db
        .select({ walletId: expenses.walletId })
        .from(expenses)
        .where(mine)
        .orderBy(desc(expenses.createdAt))
        .limit(1),
      db
        .select({ categoryId: expenses.categoryId, uses })
        .from(expenses)
        .where(and(mine, isNull(expenses.voidedAt)))
        .groupBy(expenses.categoryId)
        .orderBy(desc(uses), expenses.categoryId)
        .limit(QUICK_CATEGORY_COUNT * 2),
      db
        .select({ payee: expenses.payee, lastUsed })
        .from(expenses)
        .where(and(isNotNull(expenses.payee), isNull(expenses.voidedAt)))
        .groupBy(expenses.payee)
        .orderBy(desc(lastUsed))
        .limit(PAYEE_SUGGESTION_LIMIT),
    ]);

    return {
      lastWalletId: last?.walletId ?? null,
      categoryUsageRank: categoryRows.map((row) => row.categoryId),
      payees: payeeRows.flatMap((row) => (row.payee ? [row.payee] : [])),
    };
  });
```

- [ ] **Step 8: Run the integration test and see it pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-entry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Type check, run the existing finance unit tests, commit**

Run: `bun run typecheck && bun run test -- src/lib/finance-expenses.test.ts src/lib/finance`
Expected: no new type errors; tests pass.

```bash
git add src/server-functions/finance/expense-writes.server.ts src/server-functions/finance/expense-entry-defaults-fn.ts src/server-functions/finance-fn.ts src/lib/types/finance-types.ts src/__tests__/integration/expense-fixture.ts src/__tests__/integration/expense-entry.test.ts
git commit -m "feat(finance): record expenses with payee, optional note and confirmed overdrafts"
```

---

### Task 6: Edit and void

**Files:**
- Create: `src/server-functions/finance/expense-corrections-fn.ts`
- Modify: `src/lib/types/finance-types.ts` (`UpdateExpenseInput`, `VoidExpenseInput`)
- Test: `src/__tests__/integration/expense-corrections.test.ts`

**Interfaces:**
- Consumes: everything from `expense-writes.server.ts` (Task 5); `planExpenseWalletChanges`, `describeExpenseCorrection`, `diffExpenseSnapshots`, `getExpenseLockReason` (Task 3); `expenseEdits` (Task 4).
- Produces:
  - `updateExpenseFn({ data: UpdateExpenseInput }): Promise<{ changed: boolean }>`
  - `voidExpenseFn({ data: VoidExpenseInput }): Promise<typeof expenses.$inferSelect>`
  - `UpdateExpenseInput = { expenseId: string; categoryId: string; amount: number; walletId: string; payee?: string; description?: string; expenseDate: string; slipNumber?: string; allowOverdraw?: boolean; fieldValues?: FinanceDynamicFieldValueInput[] }`
  - `VoidExpenseInput = { expenseId: string; reason: string }`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/integration/expense-corrections.test.ts
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, expenses, transactions } from "@/db";
import { expenseEdits } from "@/db/schemas/finance-schema";
import {
  EXPENSE_AUTO_LOCK_MESSAGE,
  EXPENSE_VOIDED_MESSAGE,
  OVERDRAW_CONFIRM_REQUIRED,
} from "@/lib/finance/expense-corrections";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Fixture = Awaited<ReturnType<typeof expenseFixture>>;

const record = async (f: Fixture, amount: number) =>
  (await createExpenseFn({
    data: { categoryId: f.fuel.id, amount, walletId: f.cash.id, expenseDate: EXPENSE_DAY },
    context: f.context,
  } as never)) as { id: string };

const edit = (f: Fixture, expenseId: string, changes: Record<string, unknown>) =>
  updateExpenseFn({
    data: { expenseId, categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, expenseDate: EXPENSE_DAY, ...changes },
    context: f.context,
  } as never) as Promise<{ changed: boolean }>;

const voidIt = (f: Fixture, expenseId: string, reason = "Entered twice") =>
  voidExpenseFn({ data: { expenseId, reason }, context: f.context } as never);

const corrections = async (f: Fixture, expenseId: string) =>
  (await f.moves(expenseId))
    .filter((m) => m.description)
    .map((m) => [m.type, m.amount, m.walletId, m.description])
    .sort();

describe.skipIf(!process.env.TEST_DATABASE_URL)("editing and voiding expenses", () => {
  it("corrects the account today and logs the change when the amount goes up", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    expect(await edit(f, id, { amount: 5500, payee: "LESCO", description: "October bill" })).toEqual({ changed: true });

    expect(await f.balanceOf(f.cash.id)).toBe("4500.00");
    expect(await corrections(f, id)).toEqual([["debit", "500.00", f.cash.id, "Correction to expense of 12 Oct 2026"]]);
    const [log] = await db.select().from(expenseEdits).where(eq(expenseEdits.expenseId, id));
    expect(log.editedById).toBe(f.actor.id);
    expect(log.changes).toEqual([
      { field: "Amount", from: "Rs 5,000", to: "Rs 5,500" },
      { field: "Paid to", from: "", to: "LESCO" },
      { field: "Note", from: "", to: "October bill" },
    ]);
    expect(await f.expense(id)).toMatchObject({ amount: "5500.00", payee: "LESCO", description: "October bill" });
  });

  it("moves the money when the account changes", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await edit(f, id, { walletId: f.bank.id });

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
    expect(await f.balanceOf(f.bank.id)).toBe("45000.00");
    expect(await corrections(f, id)).toEqual([
      ["credit", "5000.00", f.cash.id, "Correction to expense of 12 Oct 2026"],
      ["debit", "5000.00", f.bank.id, "Correction to expense of 12 Oct 2026"],
    ]);
    const [log] = await db.select().from(expenseEdits).where(eq(expenseEdits.expenseId, id));
    expect(log.changes).toEqual([{ field: "Paid from", from: f.cash.name, to: f.bank.name }]);
  });

  it("saves nothing when nothing changed", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    expect(await edit(f, id, {})).toEqual({ changed: false });

    expect(await db.select().from(expenseEdits).where(eq(expenseEdits.expenseId, id))).toEqual([]);
    expect(await f.moves(id)).toHaveLength(1);
  });

  it("asks before an edit takes the account below zero", async () => {
    const f = await expenseFixture("2000.00");
    const { id } = await record(f, 1000);

    await expect(edit(f, id, { amount: 4000 })).rejects.toThrow(OVERDRAW_CONFIRM_REQUIRED);
    expect(await f.balanceOf(f.cash.id)).toBe("1000.00");

    await edit(f, id, { amount: 4000, allowOverdraw: true });
    expect(await f.balanceOf(f.cash.id)).toBe("-2000.00");
  });

  it("voids an expense, returns the money today and blocks further changes", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await voidIt(f, id);

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
    const row = await f.expense(id);
    expect(row).toMatchObject({ voidReason: "Entered twice", voidedById: f.actor.id });
    expect(row.voidedAt).toBeInstanceOf(Date);
    const [voidMove] = await db.select().from(transactions).where(eq(transactions.id, row.voidTransactionId!));
    expect([voidMove.type, voidMove.amount, voidMove.description]).toEqual(["credit", "5000.00", "Void of expense of 12 Oct 2026"]);

    await expect(voidIt(f, id)).rejects.toThrow(EXPENSE_VOIDED_MESSAGE);
    await expect(edit(f, id, { amount: 10 })).rejects.toThrow(EXPENSE_VOIDED_MESSAGE);
  });

  it("needs a reason to void", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);
    await expect(voidIt(f, id, "  ")).rejects.toThrow();
    expect((await f.expense(id)).voidedAt).toBeNull();
  });

  it("refuses to change expenses made by other screens", async () => {
    const f = await expenseFixture();
    const id = createId();
    await db.insert(expenses).values({
      id, description: "Supplier Purchase: Soda Ash", category: f.fuel.name, categoryId: f.fuel.id,
      amount: "300.00", walletId: f.cash.id, performedById: f.actor.id,
    });

    await expect(edit(f, id, { amount: 10 })).rejects.toThrow(EXPENSE_AUTO_LOCK_MESSAGE);
    await expect(voidIt(f, id)).rejects.toThrow(EXPENSE_AUTO_LOCK_MESSAGE);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-corrections.test.ts`
Expected: FAIL — missing module `expense-corrections-fn`.

- [ ] **Step 3: Add the input types**

Append to `src/lib/types/finance-types.ts`:

```ts
export type UpdateExpenseInput = {
  expenseId: string;
  categoryId: string;
  amount: number;
  walletId: string;
  payee?: string;
  description?: string;
  expenseDate: string;
  slipNumber?: string;
  allowOverdraw?: boolean;
  fieldValues?: FinanceDynamicFieldValueInput[];
};

export type VoidExpenseInput = {
  expenseId: string;
  reason: string;
};
```

- [ ] **Step 4: Write the server functions**

```ts
// src/server-functions/finance/expense-corrections-fn.ts
import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { eq } from "drizzle-orm";
import { isValid, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { expenseEdits, expenses } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import {
  describeExpenseCorrection,
  diffExpenseSnapshots,
  getExpenseLockReason,
  planExpenseWalletChanges,
} from "@/lib/finance/expense-corrections";
import {
  applyWalletChange,
  deleteExpenseFieldValues,
  dynamicFieldValueSchema,
  insertExpenseFieldValues,
  loadExpenseSnapshot,
  resolveExpenseCategory,
  validateExpenseFieldValues,
  type Tx,
} from "./expense-writes.server";

/** Locks the expense row and refuses system-made or voided expenses. */
async function lockCorrectableExpense(tx: Tx, expenseId: string) {
  const [current] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for("update");
  if (!current) throw new Error("Expense not found");
  const lockReason = getExpenseLockReason(current);
  if (lockReason) throw new Error(lockReason);
  return current;
}

/**
 * Edit a manual expense at any time. Money differences are corrected on the account today,
 * and the change is logged with old and new values.
 */
export const updateExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      expenseId: z.string().min(1),
      categoryId: z.string().min(1, "Please select a category"),
      amount: z.number().positive("Amount must be greater than 0"),
      walletId: z.string().min(1, "Please select a payment source"),
      payee: z.string().trim().max(200).optional(),
      description: z.string().trim().max(1000).optional().default(""),
      expenseDate: z.string().min(1),
      slipNumber: z.string().trim().max(100).optional(),
      allowOverdraw: z.boolean().optional().default(false),
      fieldValues: z.array(dynamicFieldValueSchema).optional().default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const current = await lockCorrectableExpense(tx, data.expenseId);
      const before = await loadExpenseSnapshot(tx, current.id);

      const category = await resolveExpenseCategory(tx, { categoryId: data.categoryId }, { allowInactiveId: current.categoryId });
      const activeFieldIds = await validateExpenseFieldValues(tx, category.id, data.fieldValues);

      const expenseDate = parseISO(data.expenseDate);
      if (!isValid(expenseDate)) throw new Error("Invalid expense date");

      const amount = new Big(data.amount).toFixed(2);
      const description = describeExpenseCorrection("correction", current.expenseDate);
      const changes = planExpenseWalletChanges(
        { walletId: current.walletId, amount: current.amount },
        { walletId: data.walletId, amount },
      );
      for (const change of changes) {
        await applyWalletChange(tx, change, {
          allowOverdraw: data.allowOverdraw,
          performedById: userId,
          referenceId: current.id,
          description,
        });
      }

      await tx
        .update(expenses)
        .set({
          categoryId: category.id,
          category: category.name,
          amount,
          walletId: data.walletId,
          payee: data.payee || null,
          description: data.description,
          expenseDate,
          slipNumber: data.slipNumber || null,
        })
        .where(eq(expenses.id, current.id));

      // Same category: replace only the fields the form shows, so values of fields that were
      // switched off later are kept. New category: the old category's values no longer apply.
      await deleteExpenseFieldValues(
        tx,
        current.id,
        category.id === current.categoryId ? activeFieldIds : undefined,
      );
      await insertExpenseFieldValues(tx, current.id, data.fieldValues);

      const edits = diffExpenseSnapshots(before, await loadExpenseSnapshot(tx, current.id));
      if (edits.length === 0) return { changed: false };

      await tx.insert(expenseEdits).values({ expenseId: current.id, editedById: userId, changes: edits });

      logActivityQuiet({
        module: "finance",
        action: "updated",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Edited expense: ${edits.map((e) => e.field).join(", ")}`,
      });

      return { changed: true };
    });
  });

/** Void a manual expense: the money goes back to its account today; the row stays, marked voided. */
export const voidExpenseFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      expenseId: z.string().min(1),
      reason: z.string().trim().min(3, "Please give a reason").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const current = await lockCorrectableExpense(tx, data.expenseId);

      const voidTransactionId = await applyWalletChange(
        tx,
        { walletId: current.walletId, type: "credit", amount: new Big(current.amount).toFixed(2) },
        {
          allowOverdraw: true,
          performedById: userId,
          referenceId: current.id,
          description: describeExpenseCorrection("void", current.expenseDate),
        },
      );

      const [voided] = await tx
        .update(expenses)
        .set({ voidedAt: new Date(), voidedById: userId, voidReason: data.reason, voidTransactionId })
        .where(eq(expenses.id, current.id))
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "expense",
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Voided expense of ${current.amount}: ${data.reason}`,
      });

      return voided;
    });
  });
```

- [ ] **Step 5: Run the integration test and see it pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-corrections.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/server-functions/finance/expense-corrections-fn.ts src/lib/types/finance-types.ts src/__tests__/integration/expense-corrections.test.ts
git commit -m "feat(finance): edit expenses any time and void them with a reason"
```

---

### Task 7: Keep voided expenses out of totals

**Files:**
- Modify: `src/server-functions/finance-fn.ts` (`getExpensesKpisFn`)
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts` (two `db.query.expenses.findMany` calls, around lines 565 and 1362)
- Modify: `src/server-functions/dashboard/get-dashboard-fn.ts` (two `.from(expenses)` sums, around lines 91 and 276)
- Modify: `src/server-functions/reports/expenses-report-fn.ts` (finance rows query)
- Test: `src/__tests__/expense-void-exclusions.test.ts`
- Test: `src/__tests__/integration/expense-void-totals.test.ts`

**Interfaces:**
- Consumes: `voidExpenseFn` (Task 6), `expenses.voidedAt` (Task 4).
- Produces: every money total over `expenses` filters `isNull(expenses.voidedAt)`. The expense list (`getExpensesFn`) still returns voided rows.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/expense-void-exclusions.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const occurrences = (path: string, needle: string) => readFileSync(path, "utf8").split(needle).length - 1;

describe("voided expenses stay out of money totals", () => {
  it.each([
    ["src/server-functions/reports/profit-loss/company-reporting-core.ts", 2],
    ["src/server-functions/dashboard/get-dashboard-fn.ts", 2],
    ["src/server-functions/reports/expenses-report-fn.ts", 1],
    ["src/server-functions/finance-fn.ts", 1],
  ])("%s filters voided expenses %i time(s)", (path, times) => {
    expect(occurrences(path, "isNull(expenses.voidedAt)")).toBe(times);
  });
});
```

```ts
// src/__tests__/integration/expense-void-totals.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ExpenseKpis } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesKpisFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense totals", () => {
  it("leave voided expenses out", async () => {
    const f = await expenseFixture();
    const record = async (amount: number) =>
      (await createExpenseFn({ data: { categoryId: f.fuel.id, amount, walletId: f.cash.id, expenseDate: EXPENSE_DAY }, context: f.context } as never)) as { id: string };
    await record(1000);
    const mistake = await record(2000);
    await voidExpenseFn({ data: { expenseId: mistake.id, reason: "Entered twice" }, context: f.context } as never);

    const kpis = (await getExpensesKpisFn({ data: { categoryId: f.fuel.id }, context: f.context } as never)) as ExpenseKpis;

    expect(kpis).toEqual({ totalRecords: 1, totalCash: 1000, avgCashPerRecord: 1000 });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun run test -- src/__tests__/expense-void-exclusions.test.ts`
Expected: FAIL (counts are 0).

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-void-totals.test.ts`
Expected: FAIL (`totalRecords: 2`).

- [ ] **Step 3: Filter the expense KPIs**

In `src/server-functions/finance-fn.ts`, add `isNull` to the `drizzle-orm` import, then in `getExpensesKpisFn` replace:

```ts
    const conditions = buildExpenseFilterConditions(data);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
```

with:

```ts
    // The list still shows voided expenses (struck through); totals leave them out.
    const whereClause = and(...buildExpenseFilterConditions(data), isNull(expenses.voidedAt));
```

- [ ] **Step 4: Filter the P&L expense reads**

In `src/server-functions/reports/profit-loss/company-reporting-core.ts`, add `isNull` to the `drizzle-orm` import if it is not there. In both `db.query.expenses.findMany({ where: and(...) })` calls, add `isNull(expenses.voidedAt)` as the last argument of `and(...)`:

```ts
        where: and(
          gte(expenses.expenseDate, fromDate),
          lte(expenses.expenseDate, toDate),
          isNull(expenses.voidedAt),
        ),
```

```ts
        where: and(
          gte(expenses.expenseDate, range.fromDate),
          lte(expenses.expenseDate, range.toDate),
          isNull(expenses.voidedAt),
        ),
```

- [ ] **Step 5: Filter the dashboard sums**

In `src/server-functions/dashboard/get-dashboard-fn.ts`, add `isNull` to the `drizzle-orm` import if missing, then change the two expense queries:

```ts
      .where(and(gte(expenses.createdAt, rangeStart), lte(expenses.createdAt, rangeEnd), isNull(expenses.voidedAt)))
```

```ts
        .where(and(gte(expenses.createdAt, chartWindowStart), lte(expenses.createdAt, rangeEnd), isNull(expenses.voidedAt)))
```

- [ ] **Step 6: Filter the expenses report**

In `src/server-functions/reports/expenses-report-fn.ts`, add `isNull` to the `drizzle-orm` import if missing. Change `const conditions = [];` (the one used for the finance rows, right after `reportDateBounds`) to:

```ts
    const conditions = [isNull(expenses.voidedAt)];
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `bun run test -- src/__tests__/expense-void-exclusions.test.ts`
Expected: PASS.

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-void-totals.test.ts`
Expected: PASS.

- [ ] **Step 8: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/server-functions/finance-fn.ts src/server-functions/reports/profit-loss/company-reporting-core.ts src/server-functions/dashboard/get-dashboard-fn.ts src/server-functions/reports/expenses-report-fn.ts src/__tests__/expense-void-exclusions.test.ts src/__tests__/integration/expense-void-totals.test.ts
git commit -m "fix(finance): leave voided expenses out of totals, P&L and dashboard"
```

---

### Task 8: List returns payee, origin, void and history; hooks

**Files:**
- Modify: `src/lib/types/finance-types.ts` (`ExpenseEditEntry`, new `ExpenseListItem` fields)
- Modify: `src/server-functions/finance-fn.ts` (`getExpensesFn`)
- Modify: `src/hooks/finance/use-finance.ts`
- Test: `src/__tests__/integration/expense-list.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (types):
  - `ExpenseEditEntry = { id: string; editedAt: Date | string; editor: { id: string; name: string | null } | null; changes: ExpenseEditChange[] }`
  - `ExpenseListItem` gains `payee: string | null; origin: "manual" | "system"; voidedAt: Date | string | null; voidReason: string | null; voidedBy: { id: string; name: string | null } | null; edits: ExpenseEditEntry[]` (edits newest first)
- Produces (hooks, from `src/hooks/finance/use-finance.ts`):
  - `financeExpenseKeys.entryDefaults` = `["expenses", "entry-defaults"]`
  - `getExpenseEntryDefaultsQueryOptions()`
  - `useExpenseEntryDefaults(enabled?: boolean)` → `useQuery<ExpenseEntryDefaults>`
  - `useUpdateExpense()` → mutation over `updateExpenseFn`
  - `useVoidExpense()` → mutation over `voidExpenseFn`
  - `useCreateExpense()` unchanged name; now silent on overdraft errors (the form shows the dialog)

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/integration/expense-list.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ExpenseListResponse } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesFn } from "@/server-functions/finance-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense list", () => {
  it("shows payee, origin, void details and edit history", async () => {
    const f = await expenseFixture();
    const { id } = (await createExpenseFn({
      data: { categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, payee: "LESCO", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never)) as { id: string };
    await updateExpenseFn({
      data: { expenseId: id, categoryId: f.fuel.id, amount: 5500, walletId: f.cash.id, payee: "LESCO", expenseDate: EXPENSE_DAY },
      context: f.context,
    } as never);
    await voidExpenseFn({ data: { expenseId: id, reason: "Paid by the landlord" }, context: f.context } as never);

    const list = (await getExpensesFn({ data: { categoryId: f.fuel.id }, context: f.context } as never)) as ExpenseListResponse;
    const [row] = list.data;

    expect(row).toMatchObject({
      id,
      payee: "LESCO",
      origin: "manual",
      voidReason: "Paid by the landlord",
      voidedBy: { id: f.actor.id, name: "Accountant" },
    });
    expect(row.voidedAt).not.toBeNull();
    expect(row.edits).toHaveLength(1);
    expect(row.edits[0]).toMatchObject({
      editor: { id: f.actor.id, name: "Accountant" },
      changes: [{ field: "Amount", from: "Rs 5,000", to: "Rs 5,500" }],
    });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-list.test.ts`
Expected: FAIL — `payee` and the other fields are missing from the row.

- [ ] **Step 3: Extend the types**

In `src/lib/types/finance-types.ts`, add before `export type ExpenseListItem`:

```ts
export type ExpenseEditEntry = {
  id: string;
  editedAt: Date | string;
  editor: { id: string; name: string | null } | null;
  changes: ExpenseEditChange[];
};
```

(`ExpenseEditChange` is declared later in the same file; type aliases may be used before their declaration.)

Inside `ExpenseListItem`, add after `remarks: string | null;`:

```ts
  payee: string | null;
  origin: "manual" | "system";
  voidedAt: Date | string | null;
  voidReason: string | null;
  voidedBy: { id: string; name: string | null } | null;
  edits: ExpenseEditEntry[];
```

- [ ] **Step 4: Load and map the new fields in `getExpensesFn`**

In `src/server-functions/finance-fn.ts`, in `getExpensesFn`'s `db.query.expenses.findMany({ with: { ... } })`, add after `performer: { columns: { id: true, name: true } },`:

```ts
        voidedBy: { columns: { id: true, name: true } },
        edits: {
          orderBy: (edit, { desc }) => [desc(edit.createdAt)],
          with: { editor: { columns: { id: true, name: true } } },
        },
```

In the `rows` mapping, add after `remarks: expense.remarks,`:

```ts
      payee: expense.payee,
      origin: expense.origin === "manual" ? "manual" : "system",
      voidedAt: expense.voidedAt,
      voidReason: expense.voidReason,
      voidedBy: expense.voidedBy ? { id: expense.voidedBy.id, name: expense.voidedBy.name } : null,
      edits: expense.edits.map((edit) => ({
        id: edit.id,
        editedAt: edit.createdAt,
        editor: edit.editor ? { id: edit.editor.id, name: edit.editor.name } : null,
        changes: edit.changes,
      })),
```

- [ ] **Step 5: Run the integration test and see it pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-list.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the hooks**

In `src/hooks/finance/use-finance.ts`:

1. Extend the imports:
```ts
import { getExpenseEntryDefaultsFn } from "@/server-functions/finance/expense-entry-defaults-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
```
and add `ExpenseEntryDefaults` to the `import type { ... } from "@/lib/types/finance-types";` list.

2. Replace `financeExpenseKeys` with:
```ts
export const financeExpenseKeys = {
  all: ["expenses"] as const,
  list: (params: ExpenseListParams) =>
    [...financeExpenseKeys.all, "list", params] as const,
  kpis: (params: ExpenseKpiParams) =>
    [...financeExpenseKeys.all, "kpis", params] as const,
  entryDefaults: ["expenses", "entry-defaults"] as const,
};
```

3. After `getExpenseKpiQueryOptions`, add:
```ts
export const getExpenseEntryDefaultsQueryOptions = () => ({
  queryKey: financeExpenseKeys.entryDefaults,
  queryFn: () => getExpenseEntryDefaultsFn() as Promise<ExpenseEntryDefaults>,
  staleTime: EXPENSES_STALE_TIME,
});
```

4. Replace the whole `useCreateExpense` with the following, and add the new hooks below it:
```ts
// Anything that moves money on an expense changes balances, lists, totals and the journal.
const invalidateExpenseMoney = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ["wallets"] });
  queryClient.invalidateQueries({ queryKey: financeExpenseKeys.all });
  queryClient.invalidateQueries({ queryKey: ["transactions"] });
  queryClient.invalidateQueries({ queryKey: ["transactions-recent"] });
};

export const useCreateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createExpenseFn,
    onSuccess: () => {
      invalidateExpenseMoney(queryClient);
      toast.success("Expense recorded");
    },
    onError: (err: Error) => {
      // The form turns an overdraft refusal into the "Save anyway?" dialog.
      if (isOverdrawConfirmError(err)) return;
      toast.error("Failed to record expense", { description: err.message });
    },
  });
};

export const useUpdateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateExpenseFn,
    onSuccess: (result: { changed: boolean }) => {
      invalidateExpenseMoney(queryClient);
      toast.success(result.changed ? "Expense updated" : "Nothing changed");
    },
    onError: (err: Error) => {
      if (isOverdrawConfirmError(err)) return;
      toast.error("Failed to update expense", { description: err.message });
    },
  });
};

export const useVoidExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: voidExpenseFn,
    onSuccess: () => {
      invalidateExpenseMoney(queryClient);
      toast.success("Expense voided");
    },
    onError: (err: Error) =>
      toast.error("Failed to void expense", { description: err.message }),
  });
};

export const useExpenseEntryDefaults = (enabled = true) =>
  useQuery({ ...getExpenseEntryDefaultsQueryOptions(), enabled });
```

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/lib/types/finance-types.ts src/server-functions/finance-fn.ts src/hooks/finance/use-finance.ts src/__tests__/integration/expense-list.test.ts
git commit -m "feat(finance): return payee, voids and edit history with expenses"
```

---

### Task 9: Form building blocks

**Files:**
- Create: `src/components/finance/expense-amount-field.tsx`
- Create: `src/components/finance/expense-category-picker.tsx`
- Create: `src/components/finance/expense-payee-field.tsx`
- Create: `src/components/finance/expense-dynamic-field-input.tsx`
- Create: `src/components/finance/overdraw-confirm-dialog.tsx`
- Create: `src/components/finance/deposit-sheet.tsx`
- Modify: `src/components/finance/finance-container.tsx` (delete the local `DepositSheet`, import the new one)
- Test: `src/__tests__/expense-form-parts.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 1 `amountInWords`; Task 2 `formatAmountInput`, `parseAmountInput`, `formatRupees`, `filterPayeeSuggestions`, `pickQuickCategories`; `useDepositToWallet` (existing).
- Produces:
  - `ExpenseAmountField(props: { id: string; value: string; onChange: (value: string) => void; inputRef?: Ref<HTMLInputElement> })`
  - `ExpenseCategoryPicker(props: { categories: ExpenseCategoryDefinition[]; usageRank: string[]; value: string; onChange: (categoryId: string) => void })`
  - `ExpensePayeeField(props: { id: string; value: string; onChange: (value: string) => void; payees: string[] })`
  - `ExpenseDynamicFieldInput(props: { field: ExpenseCategoryFieldDefinition; value?: ExpenseFieldDraftValue; onChange: (value: ExpenseFieldDraftValue) => void })`
  - `OverdrawConfirmDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; walletName: string; balance: string; balanceAfter: string; onConfirm: () => void; pending: boolean })`
  - `DepositSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; wallets: FinanceWalletSummary[]; preselectedWalletId: string | null })`

- [ ] **Step 1: Write the failing behavior tests**

```tsx
// src/__tests__/expense-form-parts.behavior.test.tsx
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseAmountField } from "@/components/finance/expense-amount-field";
import { ExpenseCategoryPicker } from "@/components/finance/expense-category-picker";
import { ExpensePayeeField } from "@/components/finance/expense-payee-field";
import { OverdrawConfirmDialog } from "@/components/finance/overdraw-confirm-dialog";
import type { ExpenseCategoryDefinition } from "@/lib/types/finance-types";

const category = (id: string, name: string): ExpenseCategoryDefinition => ({
  id, name, slug: id, icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [],
});

function AmountHarness() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <ExpenseAmountField id="amount" value={value} onChange={setValue} />
    </>
  );
}

function PayeeHarness({ payees }: { payees: string[] }) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="payee">Paid to</label>
      <ExpensePayeeField id="payee" value={value} onChange={setValue} payees={payees} />
    </>
  );
}

describe("expense form parts", () => {
  afterEach(cleanup);

  it("groups the amount Lac/Crore style and says it in words", () => {
    render(<AmountHarness />);
    const input = screen.getByLabelText("Amount");

    fireEvent.change(input, { target: { value: "1250000" } });

    expect(input).toHaveProperty("value", "12,50,000");
    expect(screen.getByText("Twelve Lakh Fifty Thousand Rupees Only")).toBeTruthy();
  });

  it("does not spell out small amounts", () => {
    render(<AmountHarness />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    expect(screen.queryByText(/Rupees Only/)).toBeNull();
  });

  it("shows six tiles, most used first, and picks one on click", () => {
    const onChange = vi.fn();
    const categories = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => category(id, `Category ${id.toUpperCase()}`));
    render(<ExpenseCategoryPicker categories={categories} usageRank={["h", "g"]} value="" onChange={onChange} />);

    const tiles = screen.getAllByRole("button", { pressed: false });
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Category H", "Category G", "Category A", "Category B", "Category C", "Category D",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Category G" }));
    expect(onChange).toHaveBeenCalledWith("g");
    expect(screen.getByRole("button", { name: /Search all categories/ })).toBeTruthy();
  });

  it("names a picked category that is not a tile", () => {
    const categories = ["a", "b", "c", "d", "e", "f", "g"].map((id) => category(id, `Category ${id.toUpperCase()}`));
    render(<ExpenseCategoryPicker categories={categories} usageRank={[]} value="g" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Other: Category G/ })).toBeTruthy();
  });

  it("suggests past payees and fills the one clicked", () => {
    render(<PayeeHarness payees={["LESCO", "Shell Pump Ravi Road", "PSO Pump"]} />);
    const input = screen.getByLabelText("Paid to");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pump" } });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Shell Pump Ravi Road", "PSO Pump"]);

    fireEvent.mouseDown(options[1]);
    expect(input).toHaveProperty("value", "PSO Pump");
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("states the account, its balance and the balance after in the overdraft dialog", () => {
    const onConfirm = vi.fn();
    render(
      <OverdrawConfirmDialog open onOpenChange={vi.fn()} walletName="Cash in Hand" balance="2000.00" balanceAfter="-3000.00" onConfirm={onConfirm} pending={false} />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Cash in Hand has Rs 2,000 now and will be −Rs 3,000 after this expense. Save anyway?");

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun run test -- src/__tests__/expense-form-parts.behavior.test.tsx`
Expected: FAIL, missing modules.

- [ ] **Step 3: Amount field**

```tsx
// src/components/finance/expense-amount-field.tsx
import type { Ref } from "react";
import { Input } from "@/components/ui/input";
import { amountInWords } from "@/lib/amount-in-words";
import { formatAmountInput, parseAmountInput } from "@/lib/finance/expense-entry";

const WORDS_FROM = 1000;

export function ExpenseAmountField({
  id,
  value,
  onChange,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const amount = parseAmountInput(value);

  return (
    <div className="space-y-1">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">
          Rs
        </span>
        <Input
          ref={inputRef}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0"
          value={value}
          onChange={(event) => onChange(formatAmountInput(event.target.value))}
          className="h-14 rounded-none pl-11 text-2xl font-semibold tabular-nums shadow-none"
        />
      </div>
      <p className="min-h-5 text-sm text-muted-foreground">
        {amount >= WORDS_FROM ? amountInWords(amount) : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Category picker**

```tsx
// src/components/finance/expense-category-picker.tsx
import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pickQuickCategories } from "@/lib/finance/expense-entry";
import type { ExpenseCategoryDefinition } from "@/lib/types/finance-types";

export function ExpenseCategoryPicker({
  categories,
  usageRank,
  value,
  onChange,
}: {
  categories: ExpenseCategoryDefinition[];
  usageRank: string[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const quick = pickQuickCategories(categories, usageRank);
  const selected = categories.find((category) => category.id === value);
  const selectedIsTile = quick.some((category) => category.id === value);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {quick.map((category) => (
          <Button
            key={category.id}
            type="button"
            variant={category.id === value ? "default" : "outline"}
            aria-pressed={category.id === value}
            className="h-14 justify-start whitespace-normal rounded-none text-left shadow-none"
            onClick={() => onChange(category.id)}
          >
            {category.name}
          </Button>
        ))}
      </div>

      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={selected && !selectedIsTile ? "default" : "ghost"}
            className="h-9 rounded-none px-2 text-sm"
          >
            <SearchIcon className="mr-2 size-4" />
            {selected && !selectedIsTile ? `Other: ${selected.name}` : "Search all categories"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Type a category..." />
            <CommandList>
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                {categories.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={category.name}
                    onSelect={() => {
                      onChange(category.id);
                      setSearchOpen(false);
                    }}
                  >
                    {category.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 5: Payee field**

```tsx
// src/components/finance/expense-payee-field.tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { filterPayeeSuggestions } from "@/lib/finance/expense-entry";

export function ExpensePayeeField({
  id,
  value,
  onChange,
  payees,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  payees: string[];
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestions = showSuggestions ? filterPayeeSuggestions(payees, value) : [];

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setShowSuggestions(false)}
        placeholder="e.g. LESCO, Shell Pump Ravi Road"
        autoComplete="off"
        maxLength={200}
        className="h-11 rounded-none shadow-none"
      />
      {suggestions.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Names used before"
          className="absolute z-50 mt-1 w-full border border-border bg-popover shadow-md"
        >
          {suggestions.map((payee) => (
            <li
              key={payee}
              role="option"
              aria-selected={false}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-muted"
              // mouseDown (not click) so it runs before the input's blur hides the list.
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(payee);
                setShowSuggestions(false);
              }}
            >
              {payee}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Custom field input (moved, readable labels)**

```tsx
// src/components/finance/expense-dynamic-field-input.tsx
import { DatePicker } from "@/components/custom/date-picker";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ExpenseFieldDraftValue } from "@/lib/finance-expenses";
import type { ExpenseCategoryFieldDefinition } from "@/lib/types/finance-types";

export function ExpenseDynamicFieldInput({
  field,
  value,
  onChange,
}: {
  field: ExpenseCategoryFieldDefinition;
  value?: ExpenseFieldDraftValue;
  onChange: (value: ExpenseFieldDraftValue) => void;
}) {
  const inputId = `expense-field-${field.id}`;
  const placeholder = field.placeholder || `Enter ${field.label.toLowerCase()}...`;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
        {field.label}
        {field.isRequired ? (
          <Badge variant="outline" className="rounded-none px-1 py-0 text-[10px] shadow-none">
            Required
          </Badge>
        ) : null}
      </Label>

      {field.fieldType === "textarea" ? (
        <Textarea
          id={inputId}
          placeholder={placeholder}
          value={value?.valueText || ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
          className="min-h-16 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "text" ? (
        <Input
          id={inputId}
          placeholder={placeholder}
          value={value?.valueText || ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
          className="h-11 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "number" ? (
        <Input
          id={inputId}
          type="number"
          placeholder={placeholder}
          value={value?.valueNumber || ""}
          onChange={(event) => onChange({ valueNumber: event.target.value })}
          className="h-11 rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "date" ? (
        <DatePicker
          date={value?.valueDate}
          onChange={(date) => onChange({ valueDate: date })}
          placeholder={`Pick ${field.label.toLowerCase()}`}
          className="h-11 w-full justify-start rounded-none shadow-none"
        />
      ) : null}

      {field.fieldType === "select" ? (
        <Select value={value?.valueOptionId || ""} onValueChange={(next) => onChange({ valueOptionId: next })}>
          <SelectTrigger id={inputId} className="h-11 w-full rounded-none shadow-none">
            <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            {field.options.map((option) => (
              <SelectItem key={option.id} value={option.id} className="rounded-none">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.fieldType === "boolean" ? (
        <Select
          value={value?.valueBoolean || ""}
          onValueChange={(next: "true" | "false") => onChange({ valueBoolean: next })}
        >
          <SelectTrigger id={inputId} className="h-11 w-full rounded-none shadow-none">
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent className="rounded-none">
            <SelectItem value="true" className="rounded-none">Yes</SelectItem>
            <SelectItem value="false" className="rounded-none">No</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Overdraft dialog**

```tsx
// src/components/finance/overdraw-confirm-dialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatRupees } from "@/lib/finance/expense-entry";

export function OverdrawConfirmDialog({
  open,
  onOpenChange,
  walletName,
  balance,
  balanceAfter,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletName: string;
  balance: string;
  balanceAfter: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This account will go below zero</AlertDialogTitle>
          <AlertDialogDescription>
            {`${walletName} has ${formatRupees(balance)} now and will be ${formatRupees(balanceAfter)} after this expense. Save anyway?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Save anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 8: Move the deposit sheet**

Create `src/components/finance/deposit-sheet.tsx` with the `DepositSheet` function cut from `src/components/finance/finance-container.tsx` (the block that starts `function DepositSheet({` and ends just before `function ExpenseSheet({`), exported and typed with `FinanceWalletSummary`:

```tsx
// src/components/finance/deposit-sheet.tsx
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  BanknoteIcon,
  Building2,
  CheckCircle2Icon,
  Loader2,
} from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDepositToWallet } from "@/hooks/finance/use-finance";
import type { FinanceWalletSummary } from "@/lib/types/finance-types";

export function DepositSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: FinanceWalletSummary[];
  preselectedWalletId: string | null;
}) {
  const [walletId, setWalletId] = useState(preselectedWalletId || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const mutation = useDepositToWallet();

  const effectiveWalletId = walletId || preselectedWalletId || "";
  const selectedWallet = wallets.find((w) => w.id === effectiveWalletId);

  const handleSubmit = () => {
    const parsedAmount = parseFloat(amount);
    if (!effectiveWalletId) return toast.error("Please select an account");
    if (!parsedAmount || parsedAmount <= 0)
      return toast.error("Please enter a valid amount");

    mutation.mutate(
      {
        data: {
          walletId: effectiveWalletId,
          amount: parsedAmount,
          description: description.trim() || "Manual Deposit",
          source: "Manual Deposit",
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setAmount("");
          setDescription("");
          setWalletId("");
        },
      },
    );
  };
```

…then the function's `return ( <ResponsiveSheet ...> ... </ResponsiveSheet> );` and closing `}` exactly as they are in `finance-container.tsx` today (from `return (` through `</ResponsiveSheet>\n  );\n}`). Do not change that JSX.

Then in `src/components/finance/finance-container.tsx`:
1. Delete the local `function DepositSheet({ ... }) { ... }`.
2. Add `import { DepositSheet } from "./deposit-sheet";` next to the other `./` imports.

The existing `<DepositSheet ... wallets={wallets} ... />` usage stays as it is.

- [ ] **Step 9: Run the tests and see them pass**

Run: `bun run test -- src/__tests__/expense-form-parts.behavior.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 10: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/components/finance/expense-amount-field.tsx src/components/finance/expense-category-picker.tsx src/components/finance/expense-payee-field.tsx src/components/finance/expense-dynamic-field-input.tsx src/components/finance/overdraw-confirm-dialog.tsx src/components/finance/deposit-sheet.tsx src/components/finance/finance-container.tsx src/__tests__/expense-form-parts.behavior.test.tsx
git commit -m "feat(finance): add amount, category, payee and overdraft parts for the expense form"
```

---

### Task 10: The new expense form, on the accounts page

**Files:**
- Create: `src/components/finance/expense-form-sheet.tsx`
- Delete: `src/components/finance/expense-record-sheet.tsx`
- Modify: `src/components/finance/finance-container.tsx` (use the new form; overdrawn flag; transaction descriptions; leave voided out of the KPI)
- Test: `src/__tests__/expense-form-sheet.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 8 hooks (`useCreateExpense`, `useUpdateExpense`, `useExpenseCategoryDefinitions`, `useExpenseEntryDefaults`); Task 9 parts; Task 2/3 helpers; `toExpenseFieldDrafts`.
- Produces: `ExpenseFormSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; wallets: FinanceWalletSummary[]; preselectedWalletId?: string | null; expense?: ExpenseListItem | null })` — create mode when `expense` is null/absent, edit mode otherwise.

- [ ] **Step 1: Write the failing behavior test**

```tsx
// src/__tests__/expense-form-sheet.behavior.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseCategoryDefinition, ExpenseListItem } from "@/lib/types/finance-types";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section><h2>{title}</h2>{children}</section> : null,
}));
vi.mock("@/components/finance/deposit-sheet", () => ({
  DepositSheet: ({ open }: { open: boolean }) => (open ? <div>deposit sheet open</div> : null),
}));
vi.mock("@/hooks/finance/use-finance", () => {
  const categories: ExpenseCategoryDefinition[] = [
    { id: "fuel", name: "Fuel", slug: "fuel", icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [] },
    { id: "rent", name: "Rent", slug: "rent", icon: null, sortOrder: 1, isActive: true, isArchived: false, fields: [] },
  ];
  return {
    useExpenseCategoryDefinitions: () => ({ data: categories, isLoading: false }),
    useExpenseEntryDefaults: () => ({ data: { lastWalletId: null, categoryUsageRank: [], payees: ["LESCO"] } }),
    useCreateExpense: () => ({ mutate: mocks.create, isPending: false }),
    useUpdateExpense: () => ({ mutate: mocks.update, isPending: false }),
  };
});

import { ExpenseFormSheet } from "@/components/finance/expense-form-sheet";

const wallets = [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }];

const savedExpense: ExpenseListItem = {
  id: "e1",
  expenseDate: "2026-10-12T05:00:00.000Z",
  description: "October bill",
  amount: "1500.00",
  slipNumber: null,
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [],
  category: { id: "fuel", name: "Fuel", slug: "fuel", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Accountant" },
  dynamicFields: [],
};

describe("ExpenseFormSheet", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
  });

  it("asks in the order people think", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    const text = document.body.textContent ?? "";
    const order = ["Amount", "What for", "Paid to", "Paid from", "Date", "Note", "More details"].map((label) => text.indexOf(label));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.queryByText(/Tutorial/)).toBeNull();
  });

  it("warns before an overdraft, then saves with the user's confirmation", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));

    expect(screen.getByRole("alert").textContent).toContain("Cash Box will go to −Rs 3,000. Usually means a deposit wasn't recorded.");
    fireEvent.click(screen.getByRole("button", { name: "Record deposit" }));
    expect(screen.getByText("deposit sheet open")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("will be −Rs 3,000 after this expense");

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(mocks.create).toHaveBeenCalledWith(
      { data: expect.objectContaining({ amount: 5000, categoryId: "fuel", walletId: "w1", description: "", allowOverdraw: true, fieldValues: [] }) },
      expect.any(Object),
    );
  });

  it("keeps the account and date after Save & add another", () => {
    mocks.create.mockImplementation((_input, options: { onSuccess: () => void }) => options.onSuccess());
    const onOpenChange = vi.fn();
    render(<ExpenseFormSheet open onOpenChange={onOpenChange} wallets={wallets} preselectedWalletId="w1" />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Rent" }));
    fireEvent.change(screen.getByLabelText("Paid to"), { target: { value: "Landlord" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));

    expect(mocks.create).toHaveBeenCalledWith(
      { data: expect.objectContaining({ amount: 500, categoryId: "rent", payee: "Landlord", walletId: "w1", allowOverdraw: false }) },
      expect.any(Object),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Paid to")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Rent" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Cash Box")).toBeTruthy();
  });

  it("saves when Enter is pressed in a text box", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} preselectedWalletId="w1" />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.keyDown(screen.getByLabelText("Amount"), { key: "Enter" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("edits a saved expense and explains the account correction", () => {
    render(<ExpenseFormSheet open onOpenChange={vi.fn()} wallets={wallets} expense={savedExpense} />);

    expect(screen.getByText("Edit expense")).toBeTruthy();
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "1,500");
    expect(screen.getByLabelText("Paid to")).toHaveProperty("value", "LESCO");
    expect(screen.queryByRole("button", { name: "Save & add another" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2000" } });
    expect(screen.getByText("Rs 500 more will be taken from Cash Box")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // 2,000 + 1,500 back − 2,000 = 1,500, still above zero

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mocks.update).toHaveBeenCalledWith(
      { data: expect.objectContaining({ expenseId: "e1", amount: 2000, categoryId: "fuel", walletId: "w1", payee: "LESCO", description: "October bill", allowOverdraw: false }) },
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun run test -- src/__tests__/expense-form-sheet.behavior.test.tsx`
Expected: FAIL, missing module `expense-form-sheet`.

- [ ] **Step 3: Write the form**

```tsx
// src/components/finance/expense-form-sheet.tsx
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  Building2,
  ChevronDown,
  ReceiptIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateExpense,
  useExpenseCategoryDefinitions,
  useExpenseEntryDefaults,
  useUpdateExpense,
} from "@/hooks/finance/use-finance";
import {
  buildExpenseFieldValueInputs,
  toExpenseFieldDrafts,
  type ExpenseFieldDraftValue,
} from "@/lib/finance-expenses";
import {
  describeWalletChange,
  isOverdrawConfirmError,
  planExpenseWalletChanges,
} from "@/lib/finance/expense-corrections";
import {
  formatAmountInput,
  formatRupees,
  getBalanceAfter,
  parseAmountInput,
} from "@/lib/finance/expense-entry";
import type {
  ExpenseCategoryDefinition,
  ExpenseListItem,
  FinanceWalletSummary,
} from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";
import { DepositSheet } from "./deposit-sheet";
import { ExpenseAmountField } from "./expense-amount-field";
import { ExpenseCategoryPicker } from "./expense-category-picker";
import { ExpenseDynamicFieldInput } from "./expense-dynamic-field-input";
import { ExpensePayeeField } from "./expense-payee-field";
import { OverdrawConfirmDialog } from "./overdraw-confirm-dialog";

type ExpenseFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: FinanceWalletSummary[];
  preselectedWalletId?: string | null;
  expense?: ExpenseListItem | null;
};

type SaveMode = "close" | "another";

type ExpenseDraft = {
  amount: string;
  categoryId: string;
  payee: string;
  walletId: string;
  expenseDate: Date | undefined;
  note: string;
  slipNumber: string;
  fieldValues: Record<string, ExpenseFieldDraftValue>;
};

const emptyDraft = (): ExpenseDraft => ({
  amount: "",
  categoryId: "",
  payee: "",
  walletId: "",
  expenseDate: new Date(),
  note: "",
  slipNumber: "",
  fieldValues: {},
});

const draftFromExpense = (expense: ExpenseListItem): ExpenseDraft => ({
  amount: formatAmountInput(String(Number(expense.amount))),
  categoryId: expense.category?.id ?? "",
  payee: expense.payee ?? "",
  walletId: expense.wallet?.id ?? "",
  expenseDate: new Date(expense.expenseDate),
  note: expense.description,
  slipNumber: expense.slipNumber ?? "",
  fieldValues: toExpenseFieldDrafts(expense.dynamicFields),
});

const labelClass = "text-sm font-medium";

export function ExpenseFormSheet({
  open,
  onOpenChange,
  wallets,
  preselectedWalletId = null,
  expense = null,
}: ExpenseFormSheetProps) {
  const isEdit = expense !== null;
  const { data: categories = [], isLoading: isLoadingCategories } = useExpenseCategoryDefinitions();
  const { data: defaults } = useExpenseEntryDefaults(open);
  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense();
  const amountRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<SaveMode | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setDraft(expense ? draftFromExpense(expense) : { ...emptyDraft(), walletId: preselectedWalletId ?? "" });
    setDetailsOpen(false);
    setPendingMode(null);
  }, [open, expense, preselectedWalletId]);

  // "Paid from" defaults to the account on this user's most recent expense, unless one is already picked.
  const lastWalletId = defaults?.lastWalletId ?? null;
  useEffect(() => {
    if (!open || isEdit || !lastWalletId || !wallets.some((wallet) => wallet.id === lastWalletId)) return;
    setDraft((current) => (current.walletId ? current : { ...current, walletId: lastWalletId }));
  }, [open, isEdit, lastWalletId, wallets]);

  // An edit may keep a category that was switched off later; show it so the tile is still selected.
  const pickerCategories: ExpenseCategoryDefinition[] =
    expense?.category && !categories.some((category) => category.id === expense.category?.id)
      ? [...categories, { ...expense.category, sortOrder: Number.MAX_SAFE_INTEGER, fields: [] }]
      : categories;
  const selectedFields = pickerCategories.find((category) => category.id === draft.categoryId)?.fields ?? [];
  const hasRequiredDetails = selectedFields.some((field) => field.isRequired);
  const showDetails = detailsOpen || hasRequiredDetails;

  const wallet = wallets.find((item) => item.id === draft.walletId);
  const amount = parseAmountInput(draft.amount);
  const walletChanges =
    expense?.wallet && draft.walletId && amount > 0
      ? planExpenseWalletChanges({ walletId: expense.wallet.id, amount: expense.amount }, { walletId: draft.walletId, amount })
      : [];
  // Create: the whole amount leaves the account. Edit: only the extra taken from the chosen account.
  const debitOnWallet: string | number = isEdit
    ? (walletChanges.find((change) => change.walletId === draft.walletId && change.type === "debit")?.amount ?? 0)
    : amount;
  const balanceAfter = wallet && amount > 0 ? getBalanceAfter(wallet.balance, debitOnWallet) : null;
  const overdrawn = balanceAfter !== null && Number(debitOnWallet) > 0 && Number(balanceAfter) < 0;

  const isPending = createMutation.isPending || updateMutation.isPending;
  const update = (patch: Partial<ExpenseDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = (mode: SaveMode, allowOverdraw = false) => {
    if (amount <= 0) return void toast.error("Enter the amount");
    if (!draft.categoryId) return void toast.error("Pick what the money was for");
    if (!draft.walletId) return void toast.error("Pick the account the money was paid from");
    if (!draft.expenseDate) return void toast.error("Pick the date");

    const built = buildExpenseFieldValueInputs(selectedFields, draft.fieldValues);
    if (built.error) {
      setDetailsOpen(true);
      return void toast.error(built.error);
    }
    if (overdrawn && !allowOverdraw) return void setPendingMode(mode);

    const payload = {
      categoryId: draft.categoryId,
      amount,
      walletId: draft.walletId,
      payee: draft.payee.trim() || undefined,
      description: draft.note.trim(),
      expenseDate: draft.expenseDate.toISOString(),
      slipNumber: draft.slipNumber.trim() || undefined,
      allowOverdraw,
      fieldValues: built.values ?? [],
    };
    // The balance can change between typing and saving; the server then asks for the same confirmation.
    const onError = (error: Error) => {
      if (isOverdrawConfirmError(error)) setPendingMode(mode);
    };

    if (expense) {
      updateMutation.mutate(
        { data: { ...payload, expenseId: expense.id } },
        { onSuccess: () => onOpenChange(false), onError },
      );
      return;
    }

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          if (mode === "close") return onOpenChange(false);
          setDraft((current) => ({ ...emptyDraft(), walletId: current.walletId, expenseDate: current.expenseDate }));
          setDetailsOpen(false);
          amountRef.current?.focus();
        },
        onError,
      },
    );
  };

  const confirmOverdraw = () => {
    const mode = pendingMode ?? "close";
    setPendingMode(null);
    save(mode, true);
  };

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? "Edit expense" : "Record expense"}
        description={
          isEdit
            ? "Your changes are saved with your name. Any money difference is corrected on the account today."
            : "What did you pay for, and how much?"
        }
        icon={ReceiptIcon}
        isDirty={!isEdit && (draft.amount !== "" || draft.payee !== "" || draft.note !== "")}
      >
        <div
          className="space-y-6 py-4"
          onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (event.key === "Enter" && target.tagName === "INPUT" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save("close");
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="expense-amount" className={labelClass}>Amount</Label>
            <ExpenseAmountField
              id="expense-amount"
              inputRef={amountRef}
              value={draft.amount}
              onChange={(value) => update({ amount: value })}
            />
          </div>

          <div className="space-y-2">
            <p className={labelClass}>What for</p>
            {isLoadingCategories ? (
              <p className="text-sm text-muted-foreground">Loading categories...</p>
            ) : pickerCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No expense categories yet. A finance manager can add them under Expense Categories.
              </p>
            ) : (
              <ExpenseCategoryPicker
                categories={pickerCategories}
                usageRank={defaults?.categoryUsageRank ?? []}
                value={draft.categoryId}
                onChange={(categoryId) => update({ categoryId, fieldValues: {} })}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-payee" className={labelClass}>Paid to</Label>
            <ExpensePayeeField
              id="expense-payee"
              value={draft.payee}
              onChange={(payee) => update({ payee })}
              payees={defaults?.payees ?? []}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-wallet" className={labelClass}>Paid from</Label>
            <Select value={draft.walletId} onValueChange={(walletId) => update({ walletId })}>
              <SelectTrigger id="expense-wallet" className="h-11 w-full rounded-none shadow-none">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {wallets.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="rounded-none">
                    <span className="flex w-full items-center gap-2">
                      {item.type === "bank" ? (
                        <Building2 className="size-3.5 text-blue-500" />
                      ) : (
                        <BanknoteIcon className="size-3.5 text-violet-500" />
                      )}
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-auto pl-4 tabular-nums text-muted-foreground">
                        {formatRupees(item.balance ?? "0")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {walletChanges.map((change) => (
              <p key={`${change.type}-${change.walletId}`} className="text-sm text-muted-foreground">
                {describeWalletChange(change, wallets.find((item) => item.id === change.walletId)?.name ?? "the account")}
              </p>
            ))}

            {overdrawn && wallet && balanceAfter ? (
              <div
                role="alert"
                className="flex flex-col gap-2 border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex items-start gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  {`${wallet.name} will go to ${formatRupees(balanceAfter)}. Usually means a deposit wasn't recorded.`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-none shadow-none"
                  onClick={() => setDepositOpen(true)}
                >
                  Record deposit
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className={labelClass}>Date</p>
              <DatePicker
                date={draft.expenseDate}
                onChange={(expenseDate) => update({ expenseDate })}
                placeholder="Pick a date"
                className="h-11 w-full justify-start rounded-none shadow-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-note" className={labelClass}>
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="expense-note"
                value={draft.note}
                onChange={(event) => update({ note: event.target.value })}
                placeholder="e.g. October electricity bill"
                maxLength={1000}
                className="h-11 rounded-none shadow-none"
              />
            </div>
          </div>

          <Collapsible open={showDetails} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="h-9 gap-2 rounded-none px-2" disabled={hasRequiredDetails}>
                <ChevronDown className={cn("size-4 transition-transform", showDetails && "rotate-180")} />
                More details
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label htmlFor="expense-slip" className={labelClass}>Slip / reference number</Label>
                <Input
                  id="expense-slip"
                  value={draft.slipNumber}
                  onChange={(event) => update({ slipNumber: event.target.value })}
                  maxLength={100}
                  className="h-11 rounded-none shadow-none"
                />
              </div>
              {selectedFields.map((field) => (
                <ExpenseDynamicFieldInput
                  key={field.id}
                  field={field}
                  value={draft.fieldValues[field.id]}
                  onChange={(next) =>
                    update({
                      fieldValues: {
                        ...draft.fieldValues,
                        [field.id]: { ...draft.fieldValues[field.id], ...next },
                      },
                    })
                  }
                />
              ))}
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="rounded-none shadow-none" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {!isEdit ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-none shadow-none"
                disabled={isPending}
                onClick={() => save("another")}
              >
                Save & add another
              </Button>
            ) : null}
            <Button type="button" className="rounded-none shadow-none" disabled={isPending} onClick={() => save("close")}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Save"}
            </Button>
          </div>
        </div>
      </ResponsiveSheet>

      <OverdrawConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(next) => {
          if (!next) setPendingMode(null);
        }}
        walletName={wallet?.name ?? "This account"}
        balance={wallet?.balance ?? "0"}
        balanceAfter={balanceAfter ?? "0"}
        onConfirm={confirmOverdraw}
        pending={isPending}
      />
      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        wallets={wallets}
        preselectedWalletId={draft.walletId || null}
      />
    </>
  );
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `bun run test -- src/__tests__/expense-form-sheet.behavior.test.tsx`
Expected: PASS (5 tests). If "keeps the account and date" fails on `getByText("Cash Box")` because Radix renders the selected value in more than one place, change that assertion to `expect(screen.getAllByText("Cash Box").length).toBeGreaterThan(0)`.

- [ ] **Step 5: Use the form on the accounts page**

In `src/components/finance/finance-container.tsx`:

1. Replace `import { ExpenseRecordSheet } from "./expense-record-sheet";` with `import { ExpenseFormSheet } from "./expense-form-sheet";`.
2. Delete the local `function ExpenseSheet({ ... }) { return <ExpenseRecordSheet ... />; }` at the bottom of the file.
3. Replace the `<ExpenseSheet` element (inside `FinanceContainer`'s return) with:
```tsx
      <ExpenseFormSheet
        open={isExpenseOpen}
        onOpenChange={(open) => {
          setIsExpenseOpen(open);
          if (!open) setSelectedWalletId(null);
        }}
        wallets={wallets}
        preselectedWalletId={selectedWalletId}
      />
```
4. Leave voided expenses out of the "Total Expenses" card. Replace:
```tsx
  const totalExpenses = expenses.data.reduce(
    (sum: number, e) => sum + parseFloat(e.amount || "0"),
    0,
  );
```
with:
```tsx
  const totalExpenses = expenses.data
    .filter((e) => !e.voidedAt)
    .reduce((sum: number, e) => sum + parseFloat(e.amount || "0"), 0);
```
5. Flag overdrawn accounts. In `WalletCard`, replace:
```tsx
  const balance = parseFloat(wallet.balance || "0");
  const isLowBalance = balance < 5000;
```
with:
```tsx
  const balance = parseFloat(wallet.balance || "0");
  const isOverdrawn = balance < 0;
  const isLowBalance = !isOverdrawn && balance < 5000;
```
Then:
- In the card's outer `className={cn(...)}`, change the first branch to put overdrawn first:
```tsx
        isOverdrawn
          ? "border-t-rose-500 border-x-rose-500/30 border-b-rose-500/30"
          : isLowBalance
            ? "border-t-amber-500 border-x-amber-500/20 border-b-amber-500/20"
            : isBank
              ? "border-t-blue-500 border-border"
              : "border-t-violet-500 border-border",
```
- In the balance `<p>`'s className, replace `isLowBalance ? "text-amber-500" : "text-foreground"` with `isOverdrawn ? "text-rose-500" : isLowBalance ? "text-amber-500" : "text-foreground"`.
- Replace the `{isLowBalance ? ( <p ...>Low balance warning</p> ) : ( <div className="h-5" /> )}` block with:
```tsx
        {isOverdrawn ? (
          <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-rose-500">
            <AlertTriangleIcon className="size-3" /> Overdrawn. Record the missing deposit.
          </p>
        ) : isLowBalance ? (
          <p className="text-[10px] text-amber-500 font-bold mt-1.5 flex items-center gap-1 uppercase tracking-wider">
            <AlertTriangleIcon className="size-3" /> Low balance warning
          </p>
        ) : (
          <div className="h-5" />
        )}
```
6. Show correction/void notes in the transaction list. In `TransactionRow`, after `<p className="text-sm font-bold leading-tight text-foreground">{txn.source}</p>` add:
```tsx
          {txn.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{txn.description}</p>
          ) : null}
```

- [ ] **Step 6: Delete the old sheet**

```bash
git rm src/components/finance/expense-record-sheet.tsx
grep -rn "expense-record-sheet\|ExpenseRecordSheet" src
```
Expected: no output from `grep`.

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck && bun run test -- src/__tests__/expense-form-sheet.behavior.test.tsx src/__tests__/expense-form-parts.behavior.test.tsx`
Expected: no new errors; tests pass.

```bash
git add src/components/finance/expense-form-sheet.tsx src/components/finance/finance-container.tsx src/__tests__/expense-form-sheet.behavior.test.tsx
git commit -m "feat(finance): replace the expense sheet with the quick-add form"
```

---

### Task 11: Expenses page — button, shortcut, edit, void, history, wording

**Files:**
- Create: `src/components/finance/void-expense-dialog.tsx`
- Create: `src/components/finance/expense-history.tsx`
- Rewrite: `src/components/finance/expenses-container.tsx`
- Modify: `src/routes/_protected/finance/expenses/index.tsx` (prefetch accounts)
- Modify: `src/routes/_protected/finance/expenses/settings/index.tsx` ("Expense Categories")
- Modify: `src/components/finance/expense-categories-manager.tsx` (tutorial wording)
- Test: `src/__tests__/expenses-page.behavior.test.tsx`

**Interfaces:**
- Consumes: `useExpenses`, `useExpenseKpis`, `useExpenseCategoryDefinitions`, `useWallets`, `useVoidExpense` (Task 8); `ExpenseFormSheet` (Task 10); `getExpenseLockReason` (Task 3); `getExpenseTitle`, `isNewExpenseShortcut`, `formatRupees` (Task 2).
- Produces:
  - `VoidExpenseDialog(props: { expense: ExpenseListItem | null; open: boolean; onOpenChange: (open: boolean) => void })`
  - `ExpenseHistory(props: { expense: ExpenseListItem })`

- [ ] **Step 1: Write the failing behavior test**

```tsx
// src/__tests__/expenses-page.behavior.test.tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpenseListItem } from "@/lib/types/finance-types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: ["finance.view", "finance.manage"] } }),
}));
vi.mock("@/components/finance/expense-form-sheet", () => ({
  ExpenseFormSheet: ({ open, expense }: { open: boolean; expense?: ExpenseListItem | null }) =>
    open ? <div>form for {expense?.id ?? "new"}</div> : null,
}));
vi.mock("@/components/finance/void-expense-dialog", () => ({
  VoidExpenseDialog: ({ open, expense }: { open: boolean; expense: ExpenseListItem | null }) =>
    open ? <div>void {expense?.id}</div> : null,
}));

const base: ExpenseListItem = {
  id: "manual",
  expenseDate: "2026-10-12T05:00:00.000Z",
  description: "",
  amount: "5000.00",
  slipNumber: "S-1",
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [
    {
      id: "edit-1",
      editedAt: "2026-10-13T06:00:00.000Z",
      editor: { id: "u1", name: "Sana" },
      changes: [{ field: "Amount", from: "Rs 4,500", to: "Rs 5,000" }],
    },
  ],
  category: { id: "power", name: "Electricity", slug: "power", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Sana" },
  dynamicFields: [],
};
const rows: ExpenseListItem[] = [
  base,
  { ...base, id: "system", origin: "system", description: "Supplier Purchase: Soda Ash", payee: null, edits: [] },
  { ...base, id: "voided", description: "Duplicate", voidedAt: "2026-10-14T06:00:00.000Z", voidReason: "Entered twice", voidedBy: { id: "u1", name: "Sana" }, edits: [] },
];

vi.mock("@/hooks/finance/use-finance", () => ({
  useExpenseCategoryDefinitions: () => ({ data: [], isLoading: false, isError: false }),
  useExpenses: () => ({ data: { data: rows, total: 3, hasMore: false }, isFetching: false, isError: false }),
  useExpenseKpis: () => ({ data: { totalRecords: 2, totalCash: 10000, avgCashPerRecord: 5000 }, isFetching: false, isError: false }),
  useWallets: () => ({ data: [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }] }),
}));

import { ExpensesContainer } from "@/components/finance/expenses-container";

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("Expenses page", () => {
  afterEach(cleanup);

  it("has a Record expense button and no tutorial", () => {
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    expect(screen.getByText("form for new")).toBeTruthy();
    expect(screen.queryByText(/Tutorial/)).toBeNull();
    // Once on the top button and once in the "no active categories" notice.
    expect(screen.getAllByText("Expense Categories").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Schema/)).toBeNull();
  });

  it("opens the form when N is pressed", () => {
    render(<ExpensesContainer />);
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("form for new")).toBeTruthy();
  });

  it("titles a row Category · Paid to when there is no note", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText("Electricity · LESCO")).toBeTruthy();
  });

  it("lets manual expenses be edited and voided", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Electricity · LESCO");
    fireEvent.click(within(row).getByRole("button", { name: "Edit expense" }));
    expect(screen.getByText("form for manual")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Void expense" }));
    expect(screen.getByText("void manual")).toBeTruthy();
  });

  it("locks expenses made by other screens", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Supplier Purchase: Soda Ash");
    expect(within(row).getByText("Auto")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Edit expense" })).toBeNull();
  });

  it("strikes through voided expenses and offers no actions", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Duplicate");
    expect(within(row).getByText("Voided")).toBeTruthy();
    expect(screen.getByText("Duplicate").className).toContain("line-through");
    expect(within(row).queryByRole("button", { name: "Void expense" })).toBeNull();
  });

  it("shows the edit history when a row is opened", () => {
    render(<ExpensesContainer />);
    fireEvent.click(within(rowOf("Electricity · LESCO")).getByRole("button", { name: "Show expense details" }));
    expect(screen.getByText(/Edited by Sana/)).toBeTruthy();
    expect(screen.getByText("Rs 4,500 → Rs 5,000", { exact: false })).toBeTruthy();
    expect(screen.getByText("S-1")).toBeTruthy();
  });

  it("shows who voided and why", () => {
    render(<ExpensesContainer />);
    fireEvent.click(within(rowOf("Duplicate")).getByRole("button", { name: "Show expense details" }));
    expect(screen.getByText(/Voided by Sana/)).toBeTruthy();
    expect(screen.getByText("Reason: Entered twice")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun run test -- src/__tests__/expenses-page.behavior.test.tsx`
Expected: FAIL (no Record expense button; tutorial present; missing modules).

- [ ] **Step 3: History component**

```tsx
// src/components/finance/expense-history.tsx
import { format } from "date-fns";
import type { ExpenseListItem } from "@/lib/types/finance-types";

const when = (value: Date | string) => format(new Date(value), "d MMM yyyy, h:mm a");

export function ExpenseHistory({ expense }: { expense: ExpenseListItem }) {
  if (!expense.voidedAt && expense.edits.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes since it was recorded.</p>;
  }

  return (
    <ol className="space-y-3">
      {expense.voidedAt ? (
        <li className="border-l-2 border-rose-500 pl-3">
          <p className="text-sm font-semibold">
            Voided by {expense.voidedBy?.name ?? "Unknown"} · {when(expense.voidedAt)}
          </p>
          <p className="text-sm text-muted-foreground">Reason: {expense.voidReason}</p>
        </li>
      ) : null}
      {expense.edits.map((edit) => (
        <li key={edit.id} className="border-l-2 border-border pl-3">
          <p className="text-sm font-semibold">
            Edited by {edit.editor?.name ?? "Unknown"} · {when(edit.editedAt)}
          </p>
          <ul className="mt-1 space-y-0.5">
            {edit.changes.map((change) => (
              <li key={change.field} className="text-sm">
                <span className="text-muted-foreground">{change.field}:</span>{" "}
                {`${change.from || "—"} → ${change.to || "—"}`}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Void dialog**

```tsx
// src/components/finance/void-expense-dialog.tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useVoidExpense } from "@/hooks/finance/use-finance";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { ExpenseListItem } from "@/lib/types/finance-types";

export function VoidExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: ExpenseListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const mutation = useVoidExpense();

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!expense) return null;

  const confirm = () => {
    if (reason.trim().length < 3) return void toast.error("Please give a reason");
    mutation.mutate(
      { data: { expenseId: expense.id, reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this expense?</AlertDialogTitle>
          <AlertDialogDescription>
            {`${formatRupees(expense.amount)} goes back to ${expense.wallet?.name ?? "its account"} today. The expense stays in the list, struck through.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Entered twice by mistake"
            maxLength={500}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={mutation.isPending}>
            {mutation.isPending ? "Voiding..." : "Void expense"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Rewrite the Expenses list**

Replace the whole content of `src/components/finance/expenses-container.tsx` with:

```tsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { motion } from "framer-motion";
import {
  Ban,
  Banknote,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pencil,
  Plus,
  Receipt,
  Settings2,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { DatePicker } from "@/components/custom/date-picker";
import { GenericEmpty } from "@/components/custom/empty";
import { GenericLoader } from "@/components/custom/generic-loader";
import { FinanceEmptyIllustration } from "@/components/illustrations/FinanceEmptyIllustration";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  useExpenseCategoryDefinitions,
  useExpenseKpis,
  useExpenses,
  useWallets,
} from "@/hooks/finance/use-finance";
import {
  ALL_EXPENSE_CATEGORIES,
  getCurrentMonthRange,
  getExpenseDateRangeFilters,
  resolveExpenseCategoryFilter,
} from "@/lib/finance-expenses";
import { getExpenseLockReason } from "@/lib/finance/expense-corrections";
import { getExpenseTitle, isNewExpenseShortcut } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import type {
  ExpenseFieldValueDisplay,
  ExpenseListItem,
} from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExpenseFormSheet } from "./expense-form-sheet";
import { ExpenseHistory } from "./expense-history";
import { VoidExpenseDialog } from "./void-expense-dialog";

const LIMIT = 60;
const COLUMN_COUNT = 9;

export const ExpensesContainer = () => {
  const [offset, setOffset] = useState(0);
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_EXPENSE_CATEGORIES);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => getCurrentMonthRange());
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<ExpenseListItem | null>(null);

  const { data: viewerAccess } = useViewerAccess();
  const canManageFinance = viewerAccess
    ? hasPermission(viewerAccess.permissions, "finance.manage")
    : false;

  const { data: wallets = [] } = useWallets();
  const {
    data: categories = [],
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
    error: categoriesError,
  } = useExpenseCategoryDefinitions();

  const effectiveCategoryId = useMemo(() => {
    if (activeCategoryId === ALL_EXPENSE_CATEGORIES) {
      return ALL_EXPENSE_CATEGORIES;
    }

    return categories.some((category) => category.id === activeCategoryId)
      ? activeCategoryId
      : ALL_EXPENSE_CATEGORIES;
  }, [activeCategoryId, categories]);

  const selectedCategory = categories.find(
    (category) => category.id === effectiveCategoryId,
  );

  const { dateFrom, dateTo } = getExpenseDateRangeFilters(range);
  const categoryIdFilter = resolveExpenseCategoryFilter(effectiveCategoryId);

  const expensesQuery = useExpenses({
    limit: LIMIT,
    offset,
    categoryId: categoryIdFilter,
    dateFrom,
    dateTo,
  });

  const kpisQuery = useExpenseKpis({
    categoryId: categoryIdFilter,
    dateFrom,
    dateTo,
  });

  const expenses = expensesQuery.data?.data ?? [];
  const total = expensesQuery.data?.total ?? 0;
  const hasMore = expensesQuery.data?.hasMore ?? false;
  const page = Math.floor(offset / LIMIT) + 1;
  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  const openCreate = () => {
    setEditingExpense(null);
    setFormOpen(true);
  };

  const openEdit = (expense: ExpenseListItem) => {
    setEditingExpense(expense);
    setFormOpen(true);
  };

  // "N" opens Record expense, unless the user is typing or another dialog is open.
  useEffect(() => {
    if (!canManageFinance) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewExpenseShortcut(event)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      setEditingExpense(null);
      setFormOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canManageFinance]);

  const onRangeChange = (nextRange: DateRange | undefined) => {
    setRange(nextRange ?? getCurrentMonthRange());
    setOffset(0);
  };

  const handleCategoryChange = (nextCategoryId: string) => {
    setActiveCategoryId(nextCategoryId);
    setExpandedExpenseId(null);
    setOffset(0);
  };

  const toggleExpenseDetails = (expenseId: string) => {
    setExpandedExpenseId((current) => (current === expenseId ? null : expenseId));
  };

  return (
    <div className="space-y-5">
      {canManageFinance ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button className="h-10 gap-2 rounded-none shadow-none" onClick={openCreate}>
            <Plus className="size-4" />
            Record expense
            <Kbd className="ml-1">N</Kbd>
          </Button>
          <Button asChild variant="outline" className="h-10 rounded-none shadow-none">
            <Link to="/finance/expenses/settings">
              <Settings2 className="mr-2 size-4" />
              Expense Categories
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={
              effectiveCategoryId === ALL_EXPENSE_CATEGORIES ? "default" : "outline"
            }
            className={cn(
              "h-9 rounded-none",
              effectiveCategoryId !== ALL_EXPENSE_CATEGORIES && "shadow-none",
            )}
            onClick={() => handleCategoryChange(ALL_EXPENSE_CATEGORIES)}
          >
            All Categories
          </Button>

          {categories.map((category) => (
            <Button
              key={category.id}
              variant={category.id === effectiveCategoryId ? "default" : "outline"}
              className={cn(
                "h-9 rounded-none",
                category.id !== effectiveCategoryId && "shadow-none",
              )}
              onClick={() => handleCategoryChange(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </div>

        <DatePicker
          mode="range"
          range={range}
          onRangeChange={onRangeChange}
          placeholder="Current month"
          className="h-9 min-w-65 rounded-none shadow-none"
        />
      </div>

      {isCategoriesLoading ? (
        <div className="border border-border rounded-none">
          <GenericLoader
            title="Loading category filters"
            description="Preparing expense categories for reporting."
          />
        </div>
      ) : null}

      {isCategoriesError ? (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>Category filters unavailable</AlertTitle>
          <AlertDescription>
            {categoriesError instanceof Error
              ? categoriesError.message
              : "Expense categories could not be loaded. Expense reporting is still available for all categories."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isCategoriesLoading && !isCategoriesError && categories.length === 0 ? (
        <Alert className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>No active expense categories</AlertTitle>
          <AlertDescription>
            Saved expenses still show below, but there are no active categories to filter by or
            to record new expenses with.
            {canManageFinance ? (
              <>
                {" "}
                Add or switch them on in{" "}
                <Link
                  to="/finance/expenses/settings"
                  className="font-medium underline underline-offset-4"
                >
                  Expense Categories
                </Link>
                .
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ExpenseKpiCard
          title="Total Records"
          icon={Receipt}
          theme="rose"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : (kpisQuery.data?.totalRecords ?? 0).toLocaleString()
          }
        />
        <ExpenseKpiCard
          title="Total Cash"
          icon={Banknote}
          theme="emerald"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : `₨ ${(kpisQuery.data?.totalCash ?? 0).toLocaleString()}`
          }
        />
        <ExpenseKpiCard
          title="Avg Cash / Record"
          icon={TrendingUp}
          theme="blue"
          value={
            kpisQuery.isError
              ? "—"
              : kpisQuery.isFetching
                ? "..."
                : `₨ ${(kpisQuery.data?.avgCashPerRecord ?? 0).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}`
          }
        />
      </div>

      {kpisQuery.isError ? (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="size-4" />
          <AlertTitle>KPI data unavailable</AlertTitle>
          <AlertDescription>
            {kpisQuery.error instanceof Error
              ? kpisQuery.error.message
              : "Expense summary metrics could not be loaded."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="border border-border rounded-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Date</TableHead>
              <TableHead>Expense</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {expensesQuery.isFetching && !expensesQuery.data ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="h-28 text-center">
                  <GenericLoader
                    title="Loading expenses"
                    description="Fetching expense records for the selected filters."
                  />
                </TableCell>
              </TableRow>
            ) : expensesQuery.isError ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="p-0">
                  <Alert variant="destructive" className="rounded-none border-0">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>Expense list unavailable</AlertTitle>
                    <AlertDescription>
                      {expensesQuery.error instanceof Error
                        ? expensesQuery.error.message
                        : "Expense records could not be loaded."}
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="h-28 p-0">
                  <GenericEmpty
                    icon={FinanceEmptyIllustration}
                    title="No Expenses Found"
                    description="No expenses match the selected category and date range."
                  />
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((expense) => {
                const isExpanded = expandedExpenseId === expense.id;
                const isVoided = expense.voidedAt !== null;
                const lockReason = getExpenseLockReason(expense);

                return (
                  <Fragment key={expense.id}>
                    <TableRow className={cn(isVoided && "opacity-60")}>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-none"
                          onClick={() => toggleExpenseDetails(expense.id)}
                          aria-label={isExpanded ? "Hide expense details" : "Show expense details"}
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums align-top">
                        {format(new Date(expense.expenseDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="font-medium align-top">
                        <div className="flex flex-col gap-1">
                          <span className={cn(isVoided && "line-through")}>{getExpenseTitle(expense)}</span>
                          {isVoided ? (
                            <Badge variant="destructive" className="rounded-none w-fit">
                              Voided
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-2">
                          <span>{expense.category?.name ?? "—"}</span>
                          {expense.category?.isArchived ? (
                            <Badge variant="destructive" className="rounded-none w-fit">
                              Archived Category
                            </Badge>
                          ) : expense.category && !expense.category.isActive ? (
                            <Badge variant="outline" className="rounded-none w-fit">
                              Inactive Category
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">{expense.payee ?? "—"}</TableCell>
                      <TableCell className="align-top">{expense.wallet?.name ?? "—"}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums align-top", isVoided && "line-through")}>
                        ₨ {Number(expense.amount || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="align-top">{expense.performer?.name ?? "—"}</TableCell>
                      <TableCell className="align-top text-right">
                        {isVoided ? null : lockReason ? (
                          <Badge variant="outline" className="rounded-none" title={lockReason}>
                            Auto
                          </Badge>
                        ) : canManageFinance ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-none"
                              aria-label="Edit expense"
                              onClick={() => openEdit(expense)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-none text-rose-500 hover:text-rose-600"
                              aria-label="Void expense"
                              onClick={() => setVoidTarget(expense)}
                            >
                              <Ban className="size-4" />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>

                    {isExpanded ? (
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={COLUMN_COUNT}>
                          <ExpenseRowDetails expense={expense} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground font-semibold uppercase tabular-nums">
          Page {page} of {pageCount} · {total} total
          {selectedCategory ? ` · ${selectedCategory.name}` : ""}
        </p>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={offset <= 0}
            onClick={() => {
              setExpandedExpenseId(null);
              setOffset((prev) => Math.max(0, prev - LIMIT));
            }}
          >
            <ChevronLeft className="size-4 mr-1" />
            Prev
          </Button>
          <Button
            variant="outline"
            className="rounded-none shadow-none flex-1 sm:flex-none"
            disabled={!hasMore}
            onClick={() => {
              setExpandedExpenseId(null);
              setOffset((prev) => prev + LIMIT);
            }}
          >
            Next
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </div>

      <ExpenseFormSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingExpense(null);
        }}
        wallets={wallets}
        expense={editingExpense}
      />
      <VoidExpenseDialog
        expense={voidTarget}
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
    </div>
  );
};

function ExpenseKpiCard({
  title,
  value,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  theme: KPITheme;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
        "border-t-2",
        styles.border,
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 flex items-start justify-between mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <h3 className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </h3>
        <div className="h-4" />
      </div>
    </motion.div>
  );
}

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-t-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
  },
  rose: {
    border: "border-t-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
  },
  violet: {
    border: "border-t-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
  },
  amber: {
    border: "border-t-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
  },
};

function ExpenseRowDetails({ expense }: { expense: ExpenseListItem }) {
  const facts = (
    [
      ["Note", expense.description],
      ["Slip / ref", expense.slipNumber],
      ["Remarks", expense.remarks],
    ] as const
  ).filter((entry): entry is readonly [string, string] => Boolean(entry[1]?.trim()));

  return (
    <div className="grid gap-6 py-2 lg:grid-cols-2">
      <div className="space-y-4">
        {facts.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
        <ExpenseDynamicFieldDetails expense={expense} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">History</p>
        <ExpenseHistory expense={expense} />
      </div>
    </div>
  );
}

function ExpenseDynamicFieldDetails({
  expense,
}: {
  expense: ExpenseListItem;
}) {
  if (expense.dynamicFields.length === 0) {
    return (
      <div className="py-2">
        <p className="text-sm text-muted-foreground">No extra details saved for this expense.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Extra details</p>
          <p className="text-xs text-muted-foreground">
            Saved values stay visible even if the category's fields change later.
          </p>
        </div>
        <Badge variant="outline" className="rounded-none">
          {expense.dynamicFields.length} saved values
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {expense.dynamicFields.map((field) => (
          <ExpenseDynamicFieldCard key={field.id} field={field} />
        ))}
      </div>
    </div>
  );
}

function ExpenseDynamicFieldCard({
  field,
}: {
  field: ExpenseFieldValueDisplay;
}) {
  return (
    <div className="border border-border rounded-none p-3 space-y-2 bg-background">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">{field.fieldLabel}</p>
        {field.isFieldActive === false ? (
          <Badge variant="outline" className="rounded-none">
            Inactive Field
          </Badge>
        ) : null}
        {field.isOptionActive === false ? (
          <Badge variant="outline" className="rounded-none">
            Inactive Option
          </Badge>
        ) : null}
      </div>

      <p className="text-sm font-semibold wrap-break-word">{field.displayValue}</p>
    </div>
  );
}
```

- [ ] **Step 6: Prefetch accounts on the Expenses route**

In `src/routes/_protected/finance/expenses/index.tsx`, add `import { getWalletsListFn } from "@/server-functions/finance-fn";` and, inside `loader`, after the KPI prefetch:

```ts
    void context.queryClient.prefetchQuery({
      queryKey: ["wallets"],
      queryFn: () => getWalletsListFn(),
    });
```

- [ ] **Step 7: "Expense Categories" wording**

In `src/routes/_protected/finance/expenses/settings/index.tsx`:
- Replace the heading text `Expense Schema` with `Expense Categories`.
- Replace the paragraph `Manage categories, fields, and select options used by expense entry and reporting.` with `Add the categories people pick when recording an expense, and any extra details each one asks for.`

In `src/components/finance/expense-categories-manager.tsx`:
- Replace `title: "Expense Schema Setup",` with `title: "Expense Categories Setup",`.
- Replace `Configure your expense schema in 3 simple steps.` with `Set up your expense categories in 3 simple steps.`

Then:
```bash
grep -rn -i "schema" src/components/finance/expenses-container.tsx src/components/finance/expense-form-sheet.tsx src/routes/_protected/finance/expenses | grep -v "z\.\|import"
grep -rn "driver" src/components/finance/expenses-container.tsx src/components/finance/expense-form-sheet.tsx
```
Expected: no output from either.

- [ ] **Step 8: Run the tests and see them pass**

Run: `bun run test -- src/__tests__/expenses-page.behavior.test.tsx src/__tests__/expense-form-sheet.behavior.test.tsx src/__tests__/expense-form-parts.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 9: Type check and commit**

Run: `bun run typecheck`
Expected: no new errors.

```bash
git add src/components/finance/void-expense-dialog.tsx src/components/finance/expense-history.tsx src/components/finance/expenses-container.tsx src/routes/_protected/finance/expenses/index.tsx src/routes/_protected/finance/expenses/settings/index.tsx src/components/finance/expense-categories-manager.tsx src/__tests__/expenses-page.behavior.test.tsx
git commit -m "feat(finance): record, edit and void expenses from the Expenses page"
```

---

### Task 12: Full check, hands-on test and graph update

**Files:**
- No new files, unless a step below finds a gap.

- [ ] **Step 1: Run everything**

```bash
bun run test
DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts
bun run typecheck
bun run build
```

Expected: every new test passes. Some suites already failed before this plan started: `hr-validators`, `edit-attendance-form`, `scan-terminal`, `order-booker-trip-attendance-phase4`, `production-run-accounting` and `offline-sales-schema` among the unit tests, and `device-attendance`, `two-phase-invoice-mutations`, `two-phase-production` and `two-phase-raw-stock` among the integration tests. They may still fail. Any other failure is new and must be fixed.

- [ ] **Step 2: Check it by hand**

Start `bun run dev` and sign in as a user with `finance.manage`. Have one cash account with Rs 2,000 and two expense categories.

1. Finance → Expenses shows **Record expense** with an **N** badge at the top, an **Expense Categories** button, and no tutorial buttons.
2. Press **N** (not inside a text box). The form opens with the cursor in Amount.
3. Type `1250000`. The box shows `12,50,000` and "Twelve Lakh Fifty Thousand Rupees Only" under it.
4. Category tiles show (up to six). "Search all categories" finds the rest.
5. Paid to suggests names used before. Paid from shows each account with its balance.
6. Type `5000`, pick a category and the Rs 2,000 cash account. A warning says it will go to −Rs 3,000, with **Record deposit**. Click it; the deposit sheet opens over the form. Close it.
7. Click **Save**. The dialog says the account has Rs 2,000 now and will be −Rs 3,000. **Save anyway** saves it. The accounts page shows the account in red with "Overdrawn. Record the missing deposit."
8. Record another with **Save & add another**: the form stays open with the same account and date, everything else cleared. Press **Enter** in Amount to save the next one.
9. On a saved expense with no note, the list title reads "Category · Paid to".
10. Click the pencil, change the amount, and save. The account balance changes by the difference. On the accounts page the journal row says "Correction to expense of <original date>". Open the row's details on the Expenses page; History shows who changed what.
11. Click the void button, give a reason, and confirm. The row is struck through with **Voided**, the money is back on the account, and Total Cash on top no longer counts it. History shows who voided it and why.
12. A supplier-purchase expense shows **Auto** and no edit/void buttons.
13. Sign in as a user with `finance.view` but not `finance.manage`. The Expenses list shows, without Record expense, edit or void buttons, and **N** does nothing.

- [ ] **Step 3: Update the graph and commit**

```bash
graphify update .
git status --short
```

If Steps 1–2 led to fixes, commit them with `fix(finance): <what was fixed>`. Only commit files this plan created or changed. Leave anything else in `git status` alone. If nothing changed, there is nothing to commit.

---

## Self-review notes (for the executor)

- Spec B2 "Record expense everywhere": Task 11 (button + N on the Expenses page), Task 10 (accounts page keeps its button, now opening the new form).
- B2 quick-add order and parts: Task 10 form, built from Task 9 parts; amount words from Task 1; Lac/Crore typing and suggestions from Task 2.
- B2 "Paid to" suggestions with no payee list: `expenses.payee` (Task 4), suggestions from `getExpenseEntryDefaultsFn` (Task 5).
- B2 "Paid from" default from this user's most recent expense: Task 5 (`lastWalletId`), Task 10 (applied only when nothing is picked).
- B2 Save & add another, Enter saves: Task 10.
- B2 description optional, "Category · Paid to": Task 5 (server), Task 2 (`getExpenseTitle`), Task 11 (list).
- B2 low balance warning, Record deposit, confirm dialog, overdrawn flag: Tasks 3, 5, 9, 10.
- B2 edit any time, logged, dated correction naming the original date: Tasks 3, 4, 6, 8, 11.
- B2 void with reason, struck through: Tasks 6, 7, 8, 11.
- B2 rename to Expense Categories, remove tutorials: Task 11 (tutorial in the categories manager stays; only its wording changes).
- B4 data: payee, void columns, edit log, description optional: Task 4 (columns), Task 5 (`description` defaults to `""`; the column stays NOT NULL, so P&L code that calls `description.startsWith(...)` keeps working).
- Out of scope here (phase 7): templates, reminders, list redesign.
