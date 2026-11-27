# Expense Templates, Reminders and List Redesign (Phase 7a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators record repeat expenses (rent, electricity, fuel) with one tap from a saved template, see which ones are due this week, and work from an Expenses list that has a monthly summary, proper filters and a detail drawer.

**Architecture:** A new `expense_templates` table holds the repeat. Expenses recorded from a template keep a link to it (`expenses.template_id`), and that link is how a monthly reminder knows it has been paid. All date reasoning (which month, due this week, month-to-date) runs on the client as pure functions over local `YYYY-MM-DD` keys. The server only filters by the ISO timestamps the client sends, so the server's time zone never matters. That is the same approach the current list uses. The list page moves its edit, void and history into a detail drawer, replaces the three KPI cards with a month summary strip, and replaces the category button row with filters.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, React + shadcn/ui, TanStack Query, date-fns, big.js, Vitest (jsdom behaviour tests + `vitest.integration.config.ts` against `titan_test`).

**Spec:** `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md`, Part B ("Repeats" and "List page"), delivery phase 7. Supplier returns (Fix 7), the other half of phase 7, has its own plan (7b) after a design pass.

## Global Constraints

- Generated migrations are immutable: never edit SQL, snapshots or `meta/_journal.json` under `src/db/migrations/`. Change the schema source and run `bun run db:generate`.
- Production has real data. Every new column is nullable or has a default. Old expenses have no template and must keep working everywhere.
- Templates are **never auto-posted**. A reminder only shows; a person records the expense.
- Voided expenses never count: not in totals, not in the summary strip, not as "paid" for a reminder. Every new sum over `expenses.amount` filters `isNull(expenses.voidedAt)`.
- Only users with `finance.manage` can record, edit, void, save templates, or act on reminders. `finance.view` users see the list, the summary strip, the filters and the drawer (read-only).
- Money text uses `formatRupees` from `@/lib/finance/expense-entry` ("Rs 85,000", "−Rs 2,000"). Money maths uses `big.js`.
- UI copy, in the spec's words: "Save as template", "Due this week", "Expense Categories", "Paid to", "Paid from". Chip label format: "Shop rent — Rs 85,000".
- Browser-facing server functions follow the existing finance files (`import { db } from "@/db"` at the top is fine there; match `expense-entry-defaults-fn.ts`).
- Branch: `feat/expenses-phase-7a` from `main` once phase 6 is merged, otherwise from `feat/commission-phase-6`.

## Decisions taken while checking the spec against the code (2026-11-26)

Already shipped in phase 2, so not in this plan: the "Expense Categories" name on the button and the settings page, and no tutorial on the Expenses page. The settings page still has a "Start Tutorial" button; Task 8 removes it.

1. **What a template stores:** name, category, amount (optional: blank means "changes every time", like electricity), paid to, paid from account (optional), note, and an optional monthly reminder day. It does **not** store slip numbers or category custom fields; those change every time. Required custom fields still open "More details" on their own.
   Example: "Shop rent", Rent, Rs 85,000, paid to "Landlord", from Cash in Hand, reminder on day 1.
2. **Templates are shared** by everyone with `finance.manage`. Rent belongs to the company, not to whoever typed it first.
3. **Where "Save as template" lives:** in the expense detail drawer, on any expense that isn't voided (hand-recorded or made by another screen). A small dialog asks for the name (default "Category · Paid to"), lets you change the amount, and pick a reminder day. Templates are edited or deleted from a **Templates** sheet opened from the Expenses page header. A deleted template is archived, not removed, because expenses point to it.
4. **Reminder day 1–31.** Short months use their last day. Day 31 in February means 28 Feb (29 in a leap year).
5. **"Paid" for a month** means a live expense recorded from that template, with its expense date in that calendar month.
6. **What shows under "Due this week":**
   - **Overdue**: this month's reminder date has passed and this month isn't paid or skipped.
   - **Due**: the next unpaid, unskipped reminder date falls within the next 7 days (today plus 6). That can be next month's date near the month end.
   - Example: today 28 Nov, rent reminder on day 2, November rent paid. December's date is 2 Dec, which is within 7 days, so "Shop rent · due 2 Dec" shows.
   - Earlier months are not chased. An October reminder that was never recorded doesn't show in November.
7. **"Skip this month"** hides the reminder for that one month (for example rent was paid in cash by the owner). It stores the month on the template; the next month reminds again.
8. **Recording from a reminder** opens the form filled from the template. The date is today, except when the reminder is for a later month (the near-month-end case in decision 6). Then the date is that reminder's date, so the expense counts for the right month. The user can change it.
9. **Summary strip is always about the current calendar month, company-wide**, and ignores the list filters. "Change vs last month" compares this month so far with the same days last month (1–28 Nov against 1–28 Oct). A full last month against a half month would always look like a drop. When last month had nothing, it shows "No spending last month" instead of a percentage.
10. **The filtered total moves to the footer:** "Page 1 of 3 · 142 expenses · Rs 4,50,000". It uses the existing KPI query with the new filters. The three KPI cards (Total Records, Total Cash, Avg Cash / Record) are removed.
11. **Filters:** category (searchable, multi-select), account (one or all), paid to (contains, case-insensitive, typed with a 300 ms pause), date range (default current month). A "Clear filters" link resets them.
12. **Rows** show Date, Category (with the note underneath in small grey text when there is one), Paid to, Amount, Account, plus Voided and Auto badges. Clicking a row (or Enter on it) opens the drawer. Edit, Void, Save as template and the history all move into the drawer.
13. **`driver.js` is removed** from `package.json` with the tutorial; nothing else uses it.

## File map

| Area | File | Responsibility |
|---|---|---|
| Pure rules | `src/lib/finance/expense-templates.ts` (create) | Reminder date, due-this-week status, template window, chip label, template-to-form patch, month-to-date ranges, month change |
| Pure rules tests | `src/lib/finance/expense-templates.test.ts` (create) | Unit tests for every rule |
| Types | `src/lib/types/finance-types.ts` (modify) | `ExpenseTemplate`, `SaveExpenseTemplateInput`, `ExpenseMonthSummary`; `templateId` on `CreateExpenseInput` |
| Schema | `src/db/schemas/finance-schema.ts` (modify) | `expense_templates` table, `expenses.template_id`, relations |
| Schema test | `src/db/schemas/expense-templates-schema.test.ts` (create) | Column and index shape |
| Template server | `src/server-functions/finance/expense-templates-fn.ts` (create) | List with recent use, save, archive, skip month |
| Record expense | `src/server-functions/finance-fn.ts` (modify) | `createExpenseFn` accepts `templateId`; list/KPI filters `categoryIds`, `walletId`, `payee` |
| Summary server | `src/server-functions/finance/expense-summary-fn.ts` (create) | Month-to-date totals and top 3 categories |
| Hooks | `src/hooks/finance/use-expense-templates.ts` (create); `src/hooks/finance/use-finance.ts` (modify) | Template queries/mutations; summary query; new list filter params |
| Form | `src/components/finance/expense-template-chips.tsx` (create); `src/components/finance/expense-form-sheet.tsx` (modify) | One-tap chips; `template` prop; send `templateId` |
| Templates UI | `src/components/finance/expense-template-dialog.tsx`, `src/components/finance/expense-templates-sheet.tsx`, `src/components/finance/expense-reminders.tsx` (create) | Save/edit dialog, manage sheet, Due this week panel |
| List UI | `src/components/finance/expense-month-summary.tsx`, `src/components/finance/expense-filters.tsx`, `src/components/finance/expense-detail-sheet.tsx` (create); `src/components/finance/expenses-container.tsx` (rewrite) | Strip, filters, drawer, new table |
| Settings | `src/components/finance/expense-categories-manager.tsx` (modify), `package.json` | Remove tutorial and `driver.js` |
| Integration tests | `src/__tests__/integration/expense-templates.test.ts`, `src/__tests__/integration/expense-list-filters.test.ts` (create) | Server behaviour on a real database |
| Source test | `src/__tests__/expense-void-exclusions.test.ts` (modify) | New files leave voided expenses out |
| UI tests | `src/__tests__/expense-templates.behavior.test.tsx` (create); `src/__tests__/expense-form-sheet.behavior.test.tsx`, `src/__tests__/expenses-page.behavior.test.tsx` (modify) | Screen behaviour |

---

### Task 1: Template and summary rules (pure functions)

**Files:**
- Create: `src/lib/finance/expense-templates.ts`
- Test: `src/lib/finance/expense-templates.test.ts`

**Interfaces:**
- Consumes: `formatAmountInput`, `formatRupees` from `@/lib/finance/expense-entry`.
- Produces:
  - `REMINDER_WINDOW_DAYS = 7`
  - `reminderDateFor(monthKey: string, reminderDay: number): string`: "YYYY-MM" plus day to "YYYY-MM-DD".
  - `type TemplateReminder = { status: "overdue" | "due"; dueDate: string; monthKey: string }`
  - `getTemplateReminder(input: { reminderDay: number | null; todayKey: string; expenseDates: string[]; skippedMonth: string | null }): TemplateReminder | null`
  - `getTemplateWindow(todayKey: string): { from: Date; to: Date }`: start of this month to end of next month (local).
  - `templateChipLabel(template: { name: string; amount: string | null }): string`
  - `templateFormDate(reminder: TemplateReminder | null, todayKey: string): string`: decision 8.
  - `templateToDraftPatch(template, walletIds: string[]): { categoryId; amount; payee; walletId; note }`
  - `getMonthToDateRanges(todayKey: string): { current: { from: Date; to: Date }; previous: { from: Date; to: Date } }`
  - `describeMonthChange(current: number, previous: number): { direction: "up" | "down" | "same"; amount: string; percent: number | null }`
  - `toDayKey(value: Date | string): string`: local "YYYY-MM-DD".

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/finance/expense-templates.test.ts
import { describe, expect, it } from "vitest";
import {
  describeMonthChange,
  getMonthToDateRanges,
  getTemplateReminder,
  getTemplateWindow,
  reminderDateFor,
  templateChipLabel,
  templateFormDate,
  templateToDraftPatch,
  toDayKey,
} from "./expense-templates";

describe("reminder date", () => {
  it.each([
    ["2026-11", 1, "2026-11-01"],
    ["2026-11", 31, "2026-11-30"],
    ["2026-02", 31, "2026-02-28"],
    ["2028-02", 30, "2028-02-29"],
    ["2026-12", 15, "2026-12-15"],
  ])("%s day %i is %s", (month, day, expected) => {
    expect(reminderDateFor(month, day)).toBe(expected);
  });
});

describe("due this week", () => {
  const base = { reminderDay: 1, expenseDates: [] as string[], skippedMonth: null };

  it("shows nothing without a reminder day", () => {
    expect(getTemplateReminder({ ...base, reminderDay: null, todayKey: "2026-11-05" })).toBeNull();
  });

  it("is overdue once this month's date has passed unpaid", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05" })).toEqual({
      status: "overdue",
      dueDate: "2026-11-01",
      monthKey: "2026-11",
    });
  });

  it("is due on the day itself", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 5, todayKey: "2026-11-05" })).toEqual({
      status: "due",
      dueDate: "2026-11-05",
      monthKey: "2026-11",
    });
  });

  it("is due when the date is within 7 days (today plus 6)", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 11, todayKey: "2026-11-05" })?.status).toBe("due");
    expect(getTemplateReminder({ ...base, reminderDay: 12, todayKey: "2026-11-05" })).toBeNull();
  });

  it("is quiet once this month is paid", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05", expenseDates: ["2026-11-02"] })).toBeNull();
  });

  it("is quiet when this month is skipped", () => {
    expect(getTemplateReminder({ ...base, todayKey: "2026-11-05", skippedMonth: "2026-11" })).toBeNull();
  });

  it("looks at next month near the month end once this month is paid", () => {
    expect(
      getTemplateReminder({ ...base, reminderDay: 2, todayKey: "2026-11-28", expenseDates: ["2026-11-02"] }),
    ).toEqual({ status: "due", dueDate: "2026-12-02", monthKey: "2026-12" });
  });

  it("does not jump to next month while this month is still unpaid", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 2, todayKey: "2026-11-28" })).toEqual({
      status: "overdue",
      dueDate: "2026-11-02",
      monthKey: "2026-11",
    });
  });

  it("is quiet when next month is already paid early", () => {
    expect(
      getTemplateReminder({
        ...base,
        reminderDay: 2,
        todayKey: "2026-11-28",
        expenseDates: ["2026-11-02", "2026-12-02"],
      }),
    ).toBeNull();
  });

  it("stays quiet while the date is more than 7 days away", () => {
    expect(getTemplateReminder({ ...base, reminderDay: 25, todayKey: "2026-11-05" })).toBeNull();
  });
});

describe("template window", () => {
  it("covers this month and next month", () => {
    const { from, to } = getTemplateWindow("2026-11-28");
    expect(toDayKey(from)).toBe("2026-11-01");
    expect(toDayKey(to)).toBe("2026-12-31");
  });
});

describe("chip label and form fill", () => {
  it("adds the amount when the template has one", () => {
    expect(templateChipLabel({ name: "Shop rent", amount: "85000.00" })).toBe("Shop rent — Rs 85,000");
    expect(templateChipLabel({ name: "Electricity", amount: null })).toBe("Electricity");
  });

  it("fills the form, keeping the account only if it still exists", () => {
    const template = { categoryId: "rent", amount: "85000.00", payee: "Landlord", walletId: "w1", note: "Shop rent" };
    expect(templateToDraftPatch(template, ["w1"])).toEqual({
      categoryId: "rent",
      amount: "85,000",
      payee: "Landlord",
      walletId: "w1",
      note: "Shop rent",
    });
    expect(templateToDraftPatch({ ...template, walletId: "gone", amount: null, payee: null, note: null }, ["w1"])).toEqual({
      categoryId: "rent",
      amount: "",
      payee: "",
      walletId: "",
      note: "",
    });
  });

  it("dates the expense today unless the reminder is for a later month", () => {
    expect(templateFormDate(null, "2026-11-28")).toBe("2026-11-28");
    expect(templateFormDate({ status: "overdue", dueDate: "2026-11-01", monthKey: "2026-11" }, "2026-11-28")).toBe("2026-11-28");
    expect(templateFormDate({ status: "due", dueDate: "2026-12-02", monthKey: "2026-12" }, "2026-11-28")).toBe("2026-12-02");
  });
});

describe("month summary", () => {
  it("compares this month so far with the same days last month", () => {
    const { current, previous } = getMonthToDateRanges("2026-11-28");
    expect([toDayKey(current.from), toDayKey(current.to)]).toEqual(["2026-11-01", "2026-11-28"]);
    expect([toDayKey(previous.from), toDayKey(previous.to)]).toEqual(["2026-10-01", "2026-10-28"]);
  });

  it("stops at the end of a shorter last month", () => {
    const { previous } = getMonthToDateRanges("2026-03-31");
    expect([toDayKey(previous.from), toDayKey(previous.to)]).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("describes the change", () => {
    expect(describeMonthChange(120000, 100000)).toEqual({ direction: "up", amount: "20000.00", percent: 20 });
    expect(describeMonthChange(75000, 100000)).toEqual({ direction: "down", amount: "25000.00", percent: 25 });
    expect(describeMonthChange(5000, 5000)).toEqual({ direction: "same", amount: "0.00", percent: 0 });
    expect(describeMonthChange(5000, 0)).toEqual({ direction: "up", amount: "5000.00", percent: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/finance/expense-templates.test.ts`
Expected: FAIL with "Failed to resolve import "./expense-templates"".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/finance/expense-templates.ts
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
```

Note: `new Date(year, month, 31)` overflows into the next month for short months; `min` with `endOfMonth` fixes that only when the overflow lands after month end. It always does, so the result is correct. The "stops at the end of a shorter last month" test covers it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/finance/expense-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/expense-templates.ts src/lib/finance/expense-templates.test.ts
git commit -m "feat(expenses): reminder and month summary rules for expense templates (phase 7a)"
```

---

### Task 2: Schema: templates table and the template link on expenses

**Files:**
- Modify: `src/db/schemas/finance-schema.ts` (new table just above `// --- EXPENSES ---` near line 138; new column in `expenses`; relations near line 342-400)
- Create: `src/db/schemas/expense-templates-schema.test.ts`
- Generated: one new migration from `bun run db:generate` (never hand-edited)

**Interfaces:**
- Produces: table export `expenseTemplates` (columns `id`, `name`, `categoryId`, `amount`, `payee`, `walletId`, `note`, `reminderDay`, `skippedMonth`, `archivedAt`, `createdById`, `createdAt`, `updatedAt`), `expenses.templateId`, relations `expenseTemplatesRelations` and `expenses.template`.

- [ ] **Step 1: Write the failing test**

```ts
// src/db/schemas/expense-templates-schema.test.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { expenses, expenseTemplates } from "./finance-schema";

describe("expense templates schema", () => {
  it("stores a repeat with optional amount, account, note and reminder", () => {
    const config = getTableConfig(expenseTemplates);
    const column = (name: string) => config.columns.find((c) => c.name === name);
    expect(config.name).toBe("expense_templates");
    expect(column("name")?.notNull).toBe(true);
    expect(column("category_id")?.notNull).toBe(true);
    for (const name of ["amount", "payee", "wallet_id", "note", "reminder_day", "skipped_month", "archived_at"]) {
      expect(column(name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name)).toContain("expense_templates_reminder_day_check");
  });

  it("links an expense to the template it came from, optional for existing rows", () => {
    const config = getTableConfig(expenses);
    expect(config.columns.find((c) => c.name === "template_id")?.notNull).toBe(false);
    expect(config.indexes.map((i) => i.config.name)).toContain("expenses_template_date_idx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/db/schemas/expense-templates-schema.test.ts`
Expected: FAIL with "expenseTemplates" not exported / undefined.

- [ ] **Step 3: Add the table, column and relations**

Above `// --- EXPENSES ---`:

```ts
// --- EXPENSE TEMPLATES (one-tap repeats on the Record expense form; never auto-posted) ---
export const expenseTemplates = pgTable(
  "expense_templates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    // Null = the amount changes every time (e.g. electricity).
    amount: decimal("amount", { precision: 12, scale: 2 }),
    payee: text("payee"),
    walletId: text("wallet_id").references(() => wallets.id),
    note: text("note"),
    // 1-31; null = no reminder. Months shorter than this day remind on their last day.
    reminderDay: integer("reminder_day"),
    // "YYYY-MM": the reminder is hidden for that one month.
    skippedMonth: text("skipped_month"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (table) => ({
    activeIdx: index("expense_templates_active_idx").on(table.archivedAt, table.name),
    reminderDayCheck: check(
      "expense_templates_reminder_day_check",
      sql`${table.reminderDay} is null or ${table.reminderDay} between 1 and 31`,
    ),
  }),
);
```

In `expenses`, after `payee`:

```ts
  // Set when recorded from a template; how a monthly reminder knows it is paid.
  templateId: text("template_id").references(() => expenseTemplates.id),
```

In the `expenses` index block, add:

```ts
    templateDateIdx: index("expenses_template_date_idx").on(table.templateId, table.expenseDate),
```

Relations: add to `expensesRelations`:

```ts
  template: one(expenseTemplates, {
    fields: [expenses.templateId],
    references: [expenseTemplates.id],
  }),
```

and a new block:

```ts
export const expenseTemplatesRelations = relations(expenseTemplates, ({ one, many }) => ({
  category: one(expenseCategories, {
    fields: [expenseTemplates.categoryId],
    references: [expenseCategories.id],
  }),
  wallet: one(wallets, { fields: [expenseTemplates.walletId], references: [wallets.id] }),
  createdBy: one(user, { fields: [expenseTemplates.createdById], references: [user.id] }),
  expenses: many(expenses),
}));
```

Make sure `src/db/index.ts` re-exports it the same way it re-exports the rest of `finance-schema` (check with `grep -n finance-schema src/db/index.ts`; if it spreads `* as financeSchema`, nothing to add).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/db/schemas/expense-templates-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate`
Expected: one new `src/db/migrations/00NN_*.sql` that only creates `expense_templates`, adds the nullable `expenses.template_id` with its foreign key, and adds the two indexes and the check. If it contains anything else (drops, renames), stop and report; do not edit the file.

- [ ] **Step 6: Apply locally and typecheck**

Run: `bun run db:migrate && bun run typecheck`
Expected: migration applies, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/schemas/finance-schema.ts src/db/schemas/expense-templates-schema.test.ts src/db/migrations
git commit -m "feat(db): add expense templates and link expenses to the template they came from"
```

---

### Task 3: Template server functions and recording from a template

**Files:**
- Modify: `src/lib/types/finance-types.ts` (add types; `templateId` on `CreateExpenseInput`)
- Create: `src/server-functions/finance/expense-templates-fn.ts`
- Modify: `src/server-functions/finance-fn.ts:408-476` (`createExpenseFn`)
- Test: `src/__tests__/integration/expense-templates.test.ts`

**Interfaces:**
- Consumes: `expenseTemplates`, `expenses.templateId` (Task 2); `expenseFixture`, `EXPENSE_DAY` from `src/__tests__/integration/expense-fixture.ts`.
- Produces:
  - Types:
    ```ts
    export type ExpenseTemplate = {
      id: string;
      name: string;
      categoryId: string;
      categoryName: string;
      amount: string | null;
      payee: string | null;
      walletId: string | null;
      note: string | null;
      reminderDay: number | null;
      skippedMonth: string | null;
      /** ISO timestamps of live expenses from this template inside the requested window. */
      expenseDates: string[];
    };
    export type SaveExpenseTemplateInput = {
      templateId?: string;
      name: string;
      categoryId: string;
      amount?: number | null;
      payee?: string | null;
      walletId?: string | null;
      note?: string | null;
      reminderDay?: number | null;
    };
    ```
    and `templateId?: string` on `CreateExpenseInput`.
  - `listExpenseTemplatesFn({ data: { windowFrom: string; windowTo: string } }): Promise<ExpenseTemplate[]>` (active only, by name)
  - `saveExpenseTemplateFn({ data: SaveExpenseTemplateInput }): Promise<{ id: string }>`
  - `archiveExpenseTemplateFn({ data: { templateId: string } }): Promise<{ id: string }>`
  - `skipExpenseTemplateMonthFn({ data: { templateId: string; monthKey: string } }): Promise<{ id: string }>`
  - `createExpenseFn` accepts `templateId?: string` and stores it.

- [ ] **Step 1: Add the types**

Add the two types above to `src/lib/types/finance-types.ts` after `ExpenseEntryDefaults`, and `templateId?: string;` to `CreateExpenseInput`.

- [ ] **Step 2: Write the failing integration test**

```ts
// src/__tests__/integration/expense-templates.test.ts
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenseTemplates } from "@/db/schemas/finance-schema";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import {
  archiveExpenseTemplateFn,
  listExpenseTemplatesFn,
  saveExpenseTemplateFn,
  skipExpenseTemplateMonthFn,
} from "@/server-functions/finance/expense-templates-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

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

// October 2026, which holds EXPENSE_DAY (12 Oct).
const WINDOW = { windowFrom: "2026-10-01T00:00:00.000Z", windowTo: "2026-11-30T23:59:59.999Z" };

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense templates", () => {
  const call = <T,>(fn: unknown, data: unknown, context: unknown) =>
    (fn as (input: unknown) => Promise<T>)({ data, context });

  it("saves a template and lists it with the expenses recorded from it, leaving voided ones out", async () => {
    const f = await expenseFixture();
    const { id: templateId } = await call<{ id: string }>(saveExpenseTemplateFn, {
      name: `Shop rent ${f.id}`,
      categoryId: f.rent.id,
      amount: 85000,
      payee: "Landlord",
      walletId: f.cash.id,
      reminderDay: 1,
    }, f.context);

    const kept = await call<{ id: string }>(createExpenseFn, {
      categoryId: f.rent.id, amount: 85000, walletId: f.bank.id, expenseDate: EXPENSE_DAY, templateId,
    }, f.context);
    const voided = await call<{ id: string }>(createExpenseFn, {
      categoryId: f.rent.id, amount: 85000, walletId: f.bank.id, expenseDate: EXPENSE_DAY, templateId,
    }, f.context);
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Entered twice" }, f.context);

    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === templateId);
    expect(mine).toMatchObject({
      name: `Shop rent ${f.id}`,
      categoryId: f.rent.id,
      categoryName: f.rent.name,
      amount: "85000.00",
      payee: "Landlord",
      walletId: f.cash.id,
      reminderDay: 1,
      skippedMonth: null,
    });
    expect(mine?.expenseDates).toHaveLength(1);
    expect((await f.expense(kept.id)).templateId).toBe(templateId);
  });

  it("only returns expenses inside the window", async () => {
    const f = await expenseFixture();
    const { id: templateId } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Fuel ${f.id}`, categoryId: f.fuel.id }, f.context);
    await call(createExpenseFn, { categoryId: f.fuel.id, amount: 500, walletId: f.cash.id, expenseDate: "2026-09-15T05:00:00.000Z", templateId }, f.context);
    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === templateId);
    expect(mine?.expenseDates).toEqual([]);
    expect(mine?.amount).toBeNull();
  });

  it("edits a template and keeps blank optional fields as empty", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id, amount: 1000, reminderDay: 5 }, f.context);
    await call(saveExpenseTemplateFn, { templateId: id, name: `Rent ${f.id} B`, categoryId: f.rent.id, amount: null, reminderDay: null, payee: "  " }, f.context);
    const [row] = await db.select().from(expenseTemplates).where(eq(expenseTemplates.id, id));
    expect(row).toMatchObject({ name: `Rent ${f.id} B`, amount: null, reminderDay: null, payee: null });
  });

  it("refuses a reminder day outside 1-31", async () => {
    const f = await expenseFixture();
    await expect(call(saveExpenseTemplateFn, { name: "x", categoryId: f.rent.id, reminderDay: 32 }, f.context)).rejects.toThrow();
  });

  it("skips one month", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id, reminderDay: 1 }, f.context);
    await call(skipExpenseTemplateMonthFn, { templateId: id, monthKey: "2026-10" }, f.context);
    const mine = (await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context)).find((t) => t.id === id);
    expect(mine?.skippedMonth).toBe("2026-10");
    await expect(call(skipExpenseTemplateMonthFn, { templateId: id, monthKey: "Oct" }, f.context)).rejects.toThrow();
  });

  it("archives a template: hidden from the list, refused when recording or editing, old expenses kept", async () => {
    const f = await expenseFixture();
    const { id } = await call<{ id: string }>(saveExpenseTemplateFn, { name: `Rent ${f.id}`, categoryId: f.rent.id }, f.context);
    const kept = await call<{ id: string }>(createExpenseFn, { categoryId: f.rent.id, amount: 100, walletId: f.cash.id, expenseDate: EXPENSE_DAY, templateId: id }, f.context);
    await call(archiveExpenseTemplateFn, { templateId: id }, f.context);

    const list = await call<ExpenseTemplate[]>(listExpenseTemplatesFn, WINDOW, f.context);
    expect(list.some((t) => t.id === id)).toBe(false);
    await expect(
      call(createExpenseFn, { categoryId: f.rent.id, amount: 100, walletId: f.cash.id, expenseDate: EXPENSE_DAY, templateId: id }, f.context),
    ).rejects.toThrow("This template was deleted");
    await expect(call(saveExpenseTemplateFn, { templateId: id, name: "x", categoryId: f.rent.id }, f.context)).rejects.toThrow("This template was deleted");
    expect((await f.expense(kept.id)).templateId).toBe(id);
  });

  it("refuses a switched-off category on a new template", async () => {
    const f = await expenseFixture();
    const { expenseCategories } = await import("@/db/schemas/finance-schema");
    await db.update(expenseCategories).set({ isActive: false }).where(eq(expenseCategories.id, f.fuel.id));
    await expect(call(saveExpenseTemplateFn, { name: "x", categoryId: f.fuel.id }, f.context)).rejects.toThrow("That category is switched off");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-templates.test.ts`
Expected: FAIL with "Failed to resolve import "@/server-functions/finance/expense-templates-fn"".
(Apply the Task 2 migration to the test database first: `DATABASE_URL=$TEST_DATABASE_URL bunx tsx src/db/migrate.ts`, or however `db:migrate` resolves its script in `package.json`.)

- [ ] **Step 4: Write the server functions**

```ts
// src/server-functions/finance/expense-templates-fn.ts
import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses, expenseTemplates, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireFinanceManageMiddleware } from "@/lib/middlewares";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { expenseAmountSchema, type Tx } from "./expense-writes.server";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const saveTemplateSchema = z.object({
  templateId: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Give the template a name").max(120),
  categoryId: z.string().min(1, "Pick what the money was for"),
  amount: expenseAmountSchema.nullish(),
  payee: optionalText(200),
  walletId: z.string().min(1).nullish(),
  note: optionalText(1000),
  reminderDay: z.number().int().min(1).max(31).nullish(),
});

/** Locks an active template; archived ones are refused with the message the form shows. */
export async function lockActiveTemplate(tx: Tx, templateId: string) {
  const [template] = await tx.select().from(expenseTemplates).where(eq(expenseTemplates.id, templateId)).for("update");
  if (!template) throw new Error("Template not found");
  if (template.archivedAt) throw new Error("This template was deleted");
  return template;
}

/** Active templates by name, each with the live expenses recorded from it inside the window. */
export const listExpenseTemplatesFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ windowFrom: z.string().datetime(), windowTo: z.string().datetime() }))
  .handler(async ({ data }): Promise<ExpenseTemplate[]> => {
    const rows = await db
      .select({
        id: expenseTemplates.id,
        name: expenseTemplates.name,
        categoryId: expenseTemplates.categoryId,
        categoryName: expenseCategories.name,
        amount: expenseTemplates.amount,
        payee: expenseTemplates.payee,
        walletId: expenseTemplates.walletId,
        note: expenseTemplates.note,
        reminderDay: expenseTemplates.reminderDay,
        skippedMonth: expenseTemplates.skippedMonth,
      })
      .from(expenseTemplates)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseTemplates.categoryId))
      .where(isNull(expenseTemplates.archivedAt))
      .orderBy(asc(expenseTemplates.name), asc(expenseTemplates.id));
    if (rows.length === 0) return [];

    const used = await db
      .select({ templateId: expenses.templateId, expenseDate: expenses.expenseDate })
      .from(expenses)
      .where(
        and(
          inArray(expenses.templateId, rows.map((row) => row.id)),
          isNull(expenses.voidedAt),
          gte(expenses.expenseDate, parseISO(data.windowFrom)),
          lte(expenses.expenseDate, parseISO(data.windowTo)),
        ),
      );

    return rows.map((row) => ({
      ...row,
      expenseDates: used
        .filter((expense) => expense.templateId === row.id)
        .map((expense) => expense.expenseDate.toISOString()),
    }));
  });

/** Creates a template, or edits one when `templateId` is given. */
export const saveExpenseTemplateFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(saveTemplateSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const current = data.templateId ? await lockActiveTemplate(tx, data.templateId) : null;

      // A new template, or a category change, must use a category people can still pick.
      if (!current || current.categoryId !== data.categoryId) {
        const [category] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, data.categoryId));
        if (!category) throw new Error("Category not found");
        if (!category.isActive || category.isArchived) throw new Error("That category is switched off");
      }
      if (data.walletId) {
        const [wallet] = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, data.walletId));
        if (!wallet) throw new Error("Account not found");
      }

      const values = {
        name: data.name,
        categoryId: data.categoryId,
        amount: data.amount == null ? null : new Big(data.amount).toFixed(2),
        payee: data.payee,
        walletId: data.walletId ?? null,
        note: data.note,
        reminderDay: data.reminderDay ?? null,
      };

      const [saved] = current
        ? await tx.update(expenseTemplates).set(values).where(eq(expenseTemplates.id, current.id)).returning({ id: expenseTemplates.id })
        : await tx
            .insert(expenseTemplates)
            .values({ ...values, createdById: context.session.user.id })
            .returning({ id: expenseTemplates.id });

      logActivityQuiet({
        module: "finance",
        action: current ? "updated" : "created",
        entityType: "expense_template",
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `${current ? "Edited" : "Saved"} expense template "${data.name}"`,
      });
      return saved;
    });
  });

export const archiveExpenseTemplateFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ templateId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const template = await lockActiveTemplate(tx, data.templateId);
      await tx.update(expenseTemplates).set({ archivedAt: new Date() }).where(eq(expenseTemplates.id, template.id));
      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "expense_template",
        actorId: context.session.user.id,
        actorName: context.session.user.name,
        description: `Deleted expense template "${template.name}"`,
      });
      return { id: template.id };
    });
  });

export const skipExpenseTemplateMonthFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(z.object({ templateId: z.string().min(1), monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const template = await lockActiveTemplate(tx, data.templateId);
      await tx.update(expenseTemplates).set({ skippedMonth: data.monthKey }).where(eq(expenseTemplates.id, template.id));
      return { id: template.id };
    });
  });
```

Check how `context.session.user` is typed in `expense-entry-defaults-fn.ts` (it uses `context.session.user.id`), and use the same shape for `name`. If `name` isn't on that type, use `context.authContext.session.user.name` like `createExpenseFn` does.

- [ ] **Step 5: Accept `templateId` in `createExpenseFn`**

In `src/server-functions/finance-fn.ts`, add to the input schema:

```ts
      templateId: z.string().min(1).optional(),
```

Import `lockActiveTemplate` from `./finance/expense-templates-fn`. In the handler, before `applyWalletChange`:

```ts
      // Recording from a deleted template is refused, so its reminder can't be marked paid by mistake.
      if (data.templateId) await lockActiveTemplate(tx, data.templateId);
```

and add `templateId: data.templateId ?? null,` to the `.values({...})` of the insert.

If importing a file that holds `createServerFn` exports into `finance-fn.ts` causes a circular import, move `lockActiveTemplate` to `src/server-functions/finance/expense-writes.server.ts` instead and import it from there in both files.

- [ ] **Step 6: Run test to verify it passes**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-templates.test.ts src/__tests__/integration/expense-entry.test.ts`
Expected: PASS (the existing expense-entry suite proves recording without a template still works).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/finance-types.ts src/server-functions/finance/expense-templates-fn.ts src/server-functions/finance-fn.ts src/__tests__/integration/expense-templates.test.ts
git commit -m "feat(expenses): save, edit, delete and skip expense templates; record an expense from one"
```

---

### Task 4: List filters and the month summary on the server

**Files:**
- Modify: `src/server-functions/finance-fn.ts:90-175` (`ExpenseFilterInput`, `buildExpenseFilterConditions`), `:478-492` and `:648-660` (input schemas)
- Create: `src/server-functions/finance/expense-summary-fn.ts`
- Modify: `src/lib/types/finance-types.ts` (add `ExpenseMonthSummary`)
- Modify: `src/__tests__/expense-void-exclusions.test.ts`
- Test: `src/__tests__/integration/expense-list-filters.test.ts`

**Interfaces:**
- Produces:
  - `getExpensesFn` and `getExpensesKpisFn` accept `categoryIds?: string[]`, `walletId?: string`, `payee?: string` (contains, case-insensitive). `categoryId` stays for old callers.
  - `type ExpenseMonthSummary = { currentTotal: number; previousTotal: number; topCategories: Array<{ categoryId: string; name: string; total: number }> }`
  - `getExpenseMonthSummaryFn({ data: { currentFrom: string; currentTo: string; previousFrom: string; previousTo: string } }): Promise<ExpenseMonthSummary>`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/integration/expense-list-filters.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ExpenseKpis, ExpenseListResponse, ExpenseMonthSummary } from "@/lib/types/finance-types";
import { createExpenseFn, getExpensesFn, getExpensesKpisFn } from "@/server-functions/finance-fn";
import { voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { getExpenseMonthSummaryFn } from "@/server-functions/finance/expense-summary-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

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

const call = <T,>(fn: unknown, data: unknown, context: unknown) => (fn as (input: unknown) => Promise<T>)({ data, context });

describe.skipIf(!process.env.TEST_DATABASE_URL)("expense list filters", () => {
  it("filters by several categories, one account and part of the payee name", async () => {
    const f = await expenseFixture();
    const add = (categoryId: string, walletId: string, payee: string, amount: number) =>
      call<{ id: string }>(createExpenseFn, { categoryId, walletId, payee, amount, expenseDate: EXPENSE_DAY }, f.context);
    await add(f.fuel.id, f.cash.id, `Shell Pump ${f.id}`, 100);
    await add(f.rent.id, f.bank.id, `Landlord ${f.id}`, 200);
    const voided = await add(f.rent.id, f.cash.id, `Landlord ${f.id}`, 300);
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Twice" }, f.context);

    const list = (data: object) => call<ExpenseListResponse>(getExpensesFn, data, f.context);
    const kpis = (data: object) => call<ExpenseKpis>(getExpensesKpisFn, data, f.context);
    const both = { categoryIds: [f.fuel.id, f.rent.id] };

    expect((await list(both)).total).toBe(3);
    expect((await list({ ...both, walletId: f.cash.id })).total).toBe(2);
    expect((await list({ ...both, payee: `landlord ${f.id}`.toUpperCase() })).total).toBe(2);
    expect((await list({ ...both, payee: "100%_" })).total).toBe(0);
    // Voided rows stay in the list (struck through) but not in the money total.
    expect(await kpis({ ...both, payee: `Landlord ${f.id}` })).toMatchObject({ totalRecords: 1, totalCash: 200 });
  });

  it("sums this month and last month and names the top 3 categories, voided left out", async () => {
    const f = await expenseFixture();
    // Summary is company-wide, so use a window no other suite writes to: 2031.
    const add = (categoryId: string, amount: number, day: string) =>
      call<{ id: string }>(createExpenseFn, { categoryId, walletId: f.bank.id, amount, expenseDate: day }, f.context);
    await add(f.fuel.id, 1000, "2031-03-05T05:00:00.000Z");
    await add(f.rent.id, 5000, "2031-03-06T05:00:00.000Z");
    const voided = await add(f.rent.id, 9000, "2031-03-07T05:00:00.000Z");
    await call(voidExpenseFn, { expenseId: voided.id, reason: "Twice" }, f.context);
    await add(f.fuel.id, 2000, "2031-02-04T05:00:00.000Z");

    const summary = await call<ExpenseMonthSummary>(getExpenseMonthSummaryFn, {
      currentFrom: "2031-03-01T00:00:00.000Z",
      currentTo: "2031-03-10T23:59:59.999Z",
      previousFrom: "2031-02-01T00:00:00.000Z",
      previousTo: "2031-02-10T23:59:59.999Z",
    }, f.context);

    expect(summary.currentTotal).toBe(6000);
    expect(summary.previousTotal).toBe(2000);
    expect(summary.topCategories).toEqual([
      { categoryId: f.rent.id, name: f.rent.name, total: 5000 },
      { categoryId: f.fuel.id, name: f.fuel.name, total: 1000 },
    ]);
  });
});
```

The 2031 rows are committed by the fixture's own pattern and stay in `titan_test`. If a rerun double-counts, give the dates a per-run year offset (`2031 + (Date.now() % 50)`) and build the ISO strings from it.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-list-filters.test.ts`
Expected: FAIL: the first test's totals are wrong (unknown keys are stripped by zod, so no filtering), the second can't resolve `expense-summary-fn`.

- [ ] **Step 3: Add the filters**

In `src/server-functions/finance-fn.ts`, extend the type:

```ts
type ExpenseFilterInput = {
  categoryId?: string;
  categoryIds?: string[];
  category?: string;
  walletId?: string;
  payee?: string;
  dateFrom?: string;
  dateTo?: string;
  fieldFilters?: Array<z.infer<typeof dynamicFieldFilterSchema>>;
};
```

In `buildExpenseFilterConditions`, replace the category block with:

```ts
  if (data.categoryIds && data.categoryIds.length > 0) {
    conditions.push(inArray(expenses.categoryId, data.categoryIds));
  } else if (data.categoryId) {
    conditions.push(eq(expenses.categoryId, data.categoryId));
  } else if (data.category) {
    conditions.push(eq(expenses.category, data.category));
  }

  if (data.walletId) {
    conditions.push(eq(expenses.walletId, data.walletId));
  }

  const payee = data.payee?.trim();
  if (payee) {
    // Typed % and _ are matched literally.
    const escaped = payee.replace(/[\\%_]/g, (char) => `\\${char}`);
    conditions.push(ilike(expenses.payee, `%${escaped}%`));
  }
```

Add `inArray` and `ilike` to the `drizzle-orm` import. Add to **both** the `getExpensesFn` and `getExpensesKpisFn` input schemas:

```ts
      categoryIds: z.array(z.string().min(1)).max(100).optional(),
      walletId: z.string().min(1).optional(),
      payee: z.string().trim().max(200).optional(),
```

- [ ] **Step 4: Add the summary type and function**

In `src/lib/types/finance-types.ts`:

```ts
export type ExpenseMonthSummary = {
  currentTotal: number;
  previousTotal: number;
  topCategories: Array<{ categoryId: string; name: string; total: number }>;
};
```

```ts
// src/server-functions/finance/expense-summary-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses } from "@/db/schemas/finance-schema";
import { requireFinanceViewMiddleware } from "@/lib/middlewares";
import type { ExpenseMonthSummary } from "@/lib/types/finance-types";

const iso = z.string().datetime();
const live = (from: string, to: string) =>
  and(isNull(expenses.voidedAt), gte(expenses.expenseDate, parseISO(from)), lte(expenses.expenseDate, parseISO(to)));

/** The Expenses page summary strip: this month so far vs the same days last month, and the top 3 categories. */
export const getExpenseMonthSummaryFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(z.object({ currentFrom: iso, currentTo: iso, previousFrom: iso, previousTo: iso }))
  .handler(async ({ data }): Promise<ExpenseMonthSummary> => {
    const total = sql<string>`coalesce(sum(${expenses.amount}), 0)`;
    const [[current], [previous], top] = await Promise.all([
      db.select({ total }).from(expenses).where(live(data.currentFrom, data.currentTo)),
      db.select({ total }).from(expenses).where(live(data.previousFrom, data.previousTo)),
      db
        .select({ categoryId: expenses.categoryId, name: expenseCategories.name, total })
        .from(expenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(live(data.currentFrom, data.currentTo))
        .groupBy(expenses.categoryId, expenseCategories.name)
        .orderBy(desc(total), expenseCategories.name)
        .limit(3),
    ]);

    return {
      currentTotal: Number(current?.total ?? 0),
      previousTotal: Number(previous?.total ?? 0),
      topCategories: top.map((row) => ({ categoryId: row.categoryId, name: row.name, total: Number(row.total) })),
    };
  });
```

- [ ] **Step 5: Extend the voided-expenses source test**

In `src/__tests__/expense-void-exclusions.test.ts`, add rows to the first `it.each`:

```ts
    ["src/server-functions/finance/expense-summary-fn.ts", 1],
    ["src/server-functions/finance/expense-templates-fn.ts", 1],
```

and add `"src/server-functions/finance/expense-summary-fn.ts"` to the path list in the second test. The summary file uses `sum(${expenses.amount})` once inside the shared `total`, so the "sums ≤ filters" check holds.

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-list-filters.test.ts src/__tests__/integration/expense-list.test.ts && bun run test -- src/__tests__/expense-void-exclusions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/finance-fn.ts src/server-functions/finance/expense-summary-fn.ts src/lib/types/finance-types.ts src/__tests__/expense-void-exclusions.test.ts src/__tests__/integration/expense-list-filters.test.ts
git commit -m "feat(expenses): filter the list by categories, account and paid to; month summary query"
```

---

### Task 5: Hooks

**Files:**
- Create: `src/hooks/finance/use-expense-templates.ts`
- Modify: `src/hooks/finance/use-finance.ts` (list/KPI params at lines 40-126; new summary query)
- Test: `src/__tests__/finance-cache-invalidation.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3 and Task 4 server functions; `getTemplateWindow`, `toDayKey` (Task 1).
- Produces:
  - `expenseTemplateKeys = { all: ["expenses", "templates"], list: (todayKey: string) => ["expenses", "templates", todayKey] }`. These sit under `"expenses"`, so `invalidateFinanceQueries` refreshes reminders after any expense is recorded or voided.
  - `useExpenseTemplates(enabled = true)`: `UseQueryResult<ExpenseTemplate[]>`, window from today.
  - `useSaveExpenseTemplate()`, `useArchiveExpenseTemplate()`, `useSkipExpenseTemplateMonth()`: mutations; success toasts "Template saved", "Template deleted", "Skipped for this month".
  - In `use-finance.ts`: `ExpenseListParams` and `ExpenseKpiParams` gain `categoryIds?: string[]; walletId?: string; payee?: string`; `useExpenseMonthSummary(todayKey: string)` with key `["expenses", "month-summary", todayKey]`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/finance-cache-invalidation.test.ts` (it is a source-inspection suite; match its style):

```ts
import { readFileSync } from "node:fs";

describe("expense template and summary queries refresh with finance data", () => {
  it("keep their keys under \"expenses\"", () => {
    const templates = readFileSync("src/hooks/finance/use-expense-templates.ts", "utf8");
    const finance = readFileSync("src/hooks/finance/use-finance.ts", "utf8");
    expect(templates).toContain('all: ["expenses", "templates"]');
    expect(finance).toContain('["expenses", "month-summary", todayKey]');
  });
});
```

(Skip the `readFileSync` import line if the file already has it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/__tests__/finance-cache-invalidation.test.ts`
Expected: FAIL with ENOENT for `use-expense-templates.ts`.

- [ ] **Step 3: Write the hooks**

```ts
// src/hooks/finance/use-expense-templates.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getExpenseDateRangeFilters } from "@/lib/finance-expenses";
import { getTemplateWindow, toDayKey } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import {
  archiveExpenseTemplateFn,
  listExpenseTemplatesFn,
  saveExpenseTemplateFn,
  skipExpenseTemplateMonthFn,
} from "@/server-functions/finance/expense-templates-fn";

export const expenseTemplateKeys = {
  all: ["expenses", "templates"] as const,
  list: (todayKey: string) => ["expenses", "templates", todayKey] as const,
};

export const useExpenseTemplates = (enabled = true) => {
  const todayKey = toDayKey(new Date());
  return useQuery({
    queryKey: expenseTemplateKeys.list(todayKey),
    queryFn: () => {
      const { dateFrom, dateTo } = getExpenseDateRangeFilters(getTemplateWindow(todayKey));
      return listExpenseTemplatesFn({ data: { windowFrom: dateFrom!, windowTo: dateTo! } }) as Promise<ExpenseTemplate[]>;
    },
    enabled,
    staleTime: 30_000,
  });
};

const useTemplateMutation = <TInput,>(fn: (input: { data: TInput }) => Promise<unknown>, success: string, failure: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseTemplateKeys.all });
      toast.success(success);
    },
    onError: (err: Error) => toast.error(failure, { description: err.message }),
  });
};

export const useSaveExpenseTemplate = () =>
  useTemplateMutation(saveExpenseTemplateFn, "Template saved", "Failed to save template");
export const useArchiveExpenseTemplate = () =>
  useTemplateMutation(archiveExpenseTemplateFn, "Template deleted", "Failed to delete template");
export const useSkipExpenseTemplateMonth = () =>
  useTemplateMutation(skipExpenseTemplateMonthFn, "Skipped for this month", "Failed to skip");
```

In `src/hooks/finance/use-finance.ts`:

1. Add `categoryIds?: string[]; walletId?: string; payee?: string;` to `ExpenseListParams` and `ExpenseKpiParams`.
2. Pass them through `normalizeExpenseListParams` / `normalizeExpenseKpiParams` (`categoryIds: params.categoryIds ?? []`, `walletId`, `payee: params.payee?.trim() || undefined`).
3. In both `build...Request` functions add:
   ```ts
     ...(params.categoryIds.length > 0 ? { categoryIds: params.categoryIds } : {}),
     ...(params.walletId ? { walletId: params.walletId } : {}),
     ...(params.payee ? { payee: params.payee } : {}),
   ```
4. Add the summary query:
   ```ts
   import { getMonthToDateRanges } from "@/lib/finance/expense-templates";
   import { getExpenseMonthSummaryFn } from "@/server-functions/finance/expense-summary-fn";
   import type { ExpenseMonthSummary } from "@/lib/types/finance-types";

   export const useExpenseMonthSummary = (todayKey: string) =>
     useQuery({
       queryKey: ["expenses", "month-summary", todayKey],
       queryFn: () => {
         const { current, previous } = getMonthToDateRanges(todayKey);
         const now = getExpenseDateRangeFilters(current);
         const before = getExpenseDateRangeFilters(previous);
         return getExpenseMonthSummaryFn({
           data: { currentFrom: now.dateFrom!, currentTo: now.dateTo!, previousFrom: before.dateFrom!, previousTo: before.dateTo! },
         }) as Promise<ExpenseMonthSummary>;
       },
       staleTime: EXPENSES_STALE_TIME,
     });
   ```
   (`getExpenseDateRangeFilters` is already importable from `@/lib/finance-expenses`.)

- [ ] **Step 4: Run test and typecheck**

Run: `bun run test -- src/__tests__/finance-cache-invalidation.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/finance/use-expense-templates.ts src/hooks/finance/use-finance.ts src/__tests__/finance-cache-invalidation.test.ts
git commit -m "feat(expenses): hooks for templates, list filters and the month summary"
```

---

### Task 6: Template chips on the Record expense form

**Files:**
- Create: `src/components/finance/expense-template-chips.tsx`
- Modify: `src/components/finance/expense-form-sheet.tsx`
- Modify: `src/__tests__/expense-form-sheet.behavior.test.tsx` (add the templates hook mock and new tests)

**Interfaces:**
- Consumes: `useExpenseTemplates` (Task 5); `templateChipLabel`, `templateToDraftPatch`, `templateFormDate`, `toDayKey`, `TemplateReminder` (Task 1).
- Produces:
  - `ExpenseTemplateChips({ templates, selectedId, onPick }: { templates: ExpenseTemplate[]; selectedId: string | null; onPick: (template: ExpenseTemplate) => void })`
  - `ExpenseFormSheet` gains optional props `template?: ExpenseTemplate | null` and `reminder?: TemplateReminder | null`. When `template` is set on open, the form starts filled from it. On save, the payload carries `templateId`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/expense-form-sheet.behavior.test.tsx`, add next to the existing `use-finance` mock:

```tsx
const templateList = vi.hoisted(() => ({
  data: [] as Array<import("@/lib/types/finance-types").ExpenseTemplate>,
}));
vi.mock("@/hooks/finance/use-expense-templates", () => ({
  useExpenseTemplates: () => ({ data: templateList.data }),
}));
```

and a new `describe` block:

```tsx
const rentTemplate = {
  id: "t-rent",
  name: "Shop rent",
  categoryId: "rent",
  categoryName: "Rent",
  amount: "85000.00",
  payee: "Landlord",
  walletId: "w1",
  note: "Monthly rent",
  reminderDay: 1,
  skippedMonth: null,
  expenseDates: [],
};

describe("template chips", () => {
  beforeEach(() => {
    templateList.data = [rentTemplate];
    mocks.create.mockReset();
  });
  afterEach(() => {
    templateList.data = [];
    cleanup();
  });

  it("fills the form from a chip and saves the template link", () => {
    render(<ExpenseFormSheet open onOpenChange={() => {}} wallets={wallets} />);
    fireEvent.click(screen.getByRole("button", { name: "Shop rent — Rs 85,000" }));
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("85,000");
    expect((screen.getByLabelText("Paid to") as HTMLInputElement).value).toBe("Landlord");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      templateId: "t-rent",
      categoryId: "rent",
      amount: 85000,
      payee: "Landlord",
      walletId: "w1",
      description: "Monthly rent",
    });
  });

  it("does not show chips when editing", () => {
    render(<ExpenseFormSheet open onOpenChange={() => {}} wallets={wallets} expense={savedExpense} />);
    expect(screen.queryByRole("button", { name: "Shop rent — Rs 85,000" })).toBeNull();
  });

  it("starts filled when opened from a reminder, with no template link left after Save & add another", () => {
    mocks.create.mockImplementation((_input, options) => options.onSuccess());
    render(<ExpenseFormSheet open onOpenChange={() => {}} wallets={wallets} template={rentTemplate} />);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("85,000");
    fireEvent.click(screen.getByRole("button", { name: "Save & add another" }));
    expect(mocks.create.mock.calls[0][0].data.templateId).toBe("t-rent");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Fuel" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create.mock.calls[1][0].data.templateId).toBeUndefined();
  });
});
```

The existing tests already show how the file picks the wallet (`w1` is the only wallet, and the test for "Save" picks it). If "Save" in the first new test is refused because no account is picked, the template's `walletId: "w1"` covers it. If the category tile button name differs (e.g. "Fuel" vs a tile with extra text), match the name the existing tests use.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/__tests__/expense-form-sheet.behavior.test.tsx`
Expected: the new tests FAIL (no chip button); the old ones still PASS.

- [ ] **Step 3: Write the chips**

```tsx
// src/components/finance/expense-template-chips.tsx
import { RepeatIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { templateChipLabel } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export function ExpenseTemplateChips({
  templates,
  selectedId,
  onPick,
}: {
  templates: ExpenseTemplate[];
  selectedId: string | null;
  onPick: (template: ExpenseTemplate) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <div className="space-y-2" role="group" aria-label="Templates">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <RepeatIcon className="size-3.5" />
        Repeat a saved expense
      </p>
      <div className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <Button
            key={template.id}
            type="button"
            size="sm"
            variant={template.id === selectedId ? "default" : "outline"}
            className={cn("h-8 rounded-none", template.id !== selectedId && "shadow-none")}
            onClick={() => onPick(template)}
          >
            {templateChipLabel(template)}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the chips into the form**

In `src/components/finance/expense-form-sheet.tsx`:

1. Imports:
   ```tsx
   import { parseISO } from "date-fns";
   import { useExpenseTemplates } from "@/hooks/finance/use-expense-templates";
   import {
     templateFormDate,
     templateToDraftPatch,
     toDayKey,
     type TemplateReminder,
   } from "@/lib/finance/expense-templates";
   import type { ExpenseTemplate } from "@/lib/types/finance-types";
   import { ExpenseTemplateChips } from "./expense-template-chips";
   ```
2. Props: add `template?: ExpenseTemplate | null; reminder?: TemplateReminder | null;` to `ExpenseFormSheetProps` and destructure with `template = null, reminder = null`.
3. State: `const [templateId, setTemplateId] = useState<string | null>(null);` and `const { data: templates = [] } = useExpenseTemplates(open && !isEdit);`
4. A helper inside the component:
   ```tsx
   const draftFromTemplate = (picked: ExpenseTemplate, expenseDate: Date | undefined): ExpenseDraft => ({
     ...emptyDraft(),
     ...templateToDraftPatch(picked, wallets.map((item) => item.id)),
     expenseDate,
   });
   ```
5. In the "Fresh form each time the sheet opens" effect, replace the `next` line with:
   ```tsx
   const next = expense
     ? draftFromExpense(expense)
     : template
       ? draftFromTemplate(template, parseISO(templateFormDate(reminder, toDayKey(new Date()))))
       : { ...emptyDraft(), walletId: preselected ?? "" };
   ```
   and add `setTemplateId(expense ? null : (template?.id ?? null));`. Add `template` and `reminder` to that effect's dependency list.
6. `const pickTemplate = (picked: ExpenseTemplate) => { setDraft(draftFromTemplate(picked, draft.expenseDate)); setTemplateId(picked.id); };`. Picking keeps the date the user already chose.
7. In `save`, add `templateId: templateId ?? undefined,` to `payload`. In the "another" branch of `createMutation.mutate`'s `onSuccess`, add `setTemplateId(null);`.
8. Render the chips as the first child inside the `space-y-6` div, before the Amount block:
   ```tsx
   {!isEdit ? (
     <ExpenseTemplateChips templates={templates} selectedId={templateId} onPick={pickTemplate} />
   ) : null}
   ```

The "Paid from" default effect only fills an empty account, so it does not overwrite the template's account. A template without an account still gets the user's last account.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- src/__tests__/expense-form-sheet.behavior.test.tsx src/__tests__/expense-form-parts.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/finance/expense-template-chips.tsx src/components/finance/expense-form-sheet.tsx src/__tests__/expense-form-sheet.behavior.test.tsx
git commit -m "feat(expenses): one-tap template chips on the Record expense form"
```

---

### Task 7: Save as template, the Templates sheet and "Due this week"

**Files:**
- Create: `src/components/finance/expense-template-dialog.tsx`
- Create: `src/components/finance/expense-templates-sheet.tsx`
- Create: `src/components/finance/expense-reminders.tsx`
- Test: `src/__tests__/expense-templates.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 5 hooks; `getTemplateReminder`, `toDayKey`, `templateChipLabel`, `TemplateReminder` (Task 1); `ExpenseAmountField` (existing, `src/components/finance/expense-amount-field.tsx`); `formatAmountInput`, `parseAmountInput` (existing).
- Produces:
  - `ExpenseTemplateDialog({ open, onOpenChange, source })`, where `source` is `{ kind: "expense"; expense: ExpenseListItem } | { kind: "template"; template: ExpenseTemplate } | null`. Fields: Name, Amount (optional), Reminder ("No reminder" or day 1–31). Saving calls `useSaveExpenseTemplate` with the category, payee, account and note taken from the source.
  - `ExpenseTemplatesSheet({ open, onOpenChange })`: lists templates with the chip label, reminder text ("Reminds on day 1" / "No reminder"), and Edit / Delete buttons (Delete asks for confirmation).
  - `ExpenseReminders({ onRecord }: { onRecord: (template: ExpenseTemplate, reminder: TemplateReminder) => void })`: renders nothing when no reminders. Otherwise a "Due this week" panel, overdue first then by due date, each row showing "Shop rent — Rs 85,000", then "Overdue since 1 Nov" or "Due 2 Dec", with **Record** and **Skip this month** buttons.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/expense-templates.behavior.test.tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseListItem, ExpenseTemplate } from "@/lib/types/finance-types";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  archive: vi.fn(),
  skip: vi.fn(),
  templates: [] as ExpenseTemplate[],
}));
vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section><h2>{title}</h2>{children}</section> : null,
}));
vi.mock("@/hooks/finance/use-expense-templates", () => ({
  useExpenseTemplates: () => ({ data: mocks.templates }),
  useSaveExpenseTemplate: () => ({ mutate: mocks.save, isPending: false }),
  useArchiveExpenseTemplate: () => ({ mutate: mocks.archive, isPending: false }),
  useSkipExpenseTemplateMonth: () => ({ mutate: mocks.skip, isPending: false }),
}));

import { ExpenseReminders } from "@/components/finance/expense-reminders";
import { ExpenseTemplateDialog } from "@/components/finance/expense-template-dialog";
import { ExpenseTemplatesSheet } from "@/components/finance/expense-templates-sheet";

const template = (patch: Partial<ExpenseTemplate>): ExpenseTemplate => ({
  id: "t1",
  name: "Shop rent",
  categoryId: "rent",
  categoryName: "Rent",
  amount: "85000.00",
  payee: "Landlord",
  walletId: "w1",
  note: null,
  reminderDay: 1,
  skippedMonth: null,
  expenseDates: [],
  ...patch,
});

const expense: ExpenseListItem = {
  id: "e1",
  expenseDate: "2026-11-02T05:00:00.000Z",
  description: "",
  amount: "12000.00",
  slipNumber: null,
  remarks: null,
  payee: "LESCO",
  origin: "manual",
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  edits: [],
  category: { id: "power", name: "Electricity", slug: "power", icon: null, isActive: true, isArchived: false },
  wallet: { id: "w1", name: "Cash Box", type: "cash" },
  performer: { id: "u1", name: "Sana" },
  dynamicFields: [],
};

describe("expense templates screens", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 28, 10)); // 28 Nov 2026, local
    mocks.templates = [];
    mocks.save.mockReset();
    mocks.archive.mockReset();
    mocks.skip.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("saves an expense as a template with its category, payee and account", () => {
    render(<ExpenseTemplateDialog open onOpenChange={() => {}} source={{ kind: "expense", expense }} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Electricity · LESCO");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(mocks.save.mock.calls[0][0].data).toEqual({
      name: "Electricity · LESCO",
      categoryId: "power",
      amount: null,
      payee: "LESCO",
      walletId: "w1",
      note: null,
      reminderDay: null,
    });
  });

  it("edits an existing template", () => {
    render(<ExpenseTemplateDialog open onOpenChange={() => {}} source={{ kind: "template", template: template({}) }} />);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("85,000");
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(mocks.save.mock.calls[0][0].data).toMatchObject({ templateId: "t1", amount: 85000, reminderDay: 1 });
  });

  it("lists templates and deletes one after confirming", () => {
    mocks.templates = [template({})];
    render(<ExpenseTemplatesSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Shop rent — Rs 85,000")).toBeTruthy();
    expect(screen.getByText("Reminds on day 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Shop rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(mocks.archive.mock.calls[0][0].data).toEqual({ templateId: "t1" });
  });

  it("shows nothing when no reminder is due", () => {
    mocks.templates = [template({ reminderDay: null })];
    const { container } = render(<ExpenseReminders onRecord={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("lists overdue first, then due, with Record and Skip this month", () => {
    const onRecord = vi.fn();
    mocks.templates = [
      template({ id: "t-next", name: "Generator fuel", amount: null, reminderDay: 2, expenseDates: ["2026-11-02T05:00:00.000Z"] }),
      template({ id: "t-late", name: "Shop rent", reminderDay: 1 }),
    ];
    render(<ExpenseReminders onRecord={onRecord} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Overdue since 1 Nov");
    expect(items[1].textContent).toContain("Due 2 Dec");

    fireEvent.click(within(items[0]).getByRole("button", { name: "Record" }));
    expect(onRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t-late" }),
      { status: "overdue", dueDate: "2026-11-01", monthKey: "2026-11" },
    );
    fireEvent.click(within(items[1]).getByRole("button", { name: "Skip this month" }));
    expect(mocks.skip.mock.calls[0][0].data).toEqual({ templateId: "t-next", monthKey: "2026-12" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/__tests__/expense-templates.behavior.test.tsx`
Expected: FAIL to resolve the three component imports.

- [ ] **Step 3: Write the dialog**

```tsx
// src/components/finance/expense-template-dialog.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveExpenseTemplate } from "@/hooks/finance/use-expense-templates";
import { formatAmountInput, getExpenseTitle, parseAmountInput } from "@/lib/finance/expense-entry";
import type { ExpenseListItem, ExpenseTemplate } from "@/lib/types/finance-types";
import { ExpenseAmountField } from "./expense-amount-field";

export type TemplateSource =
  | { kind: "expense"; expense: ExpenseListItem }
  | { kind: "template"; template: ExpenseTemplate }
  | null;

const NO_REMINDER = "none";
const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));

function startingValues(source: Exclude<TemplateSource, null>) {
  if (source.kind === "template") {
    const t = source.template;
    return {
      name: t.name,
      amount: t.amount ? formatAmountInput(String(Number(t.amount))) : "",
      reminder: t.reminderDay ? String(t.reminderDay) : NO_REMINDER,
    };
  }
  const e = source.expense;
  return {
    // "Category · Paid to" even when the expense has a note: the note stays on the template as its note.
    name: getExpenseTitle({ description: "", payee: e.payee, category: e.category }),
    amount: formatAmountInput(String(Number(e.amount))),
    reminder: NO_REMINDER,
  };
}

export function ExpenseTemplateDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TemplateSource;
}) {
  const save = useSaveExpenseTemplate();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [reminder, setReminder] = useState(NO_REMINDER);

  useEffect(() => {
    if (!open || !source) return;
    const start = startingValues(source);
    setName(start.name);
    setAmount(start.amount);
    setReminder(start.reminder);
  }, [open, source]);

  if (!source) return null;

  const submit = () => {
    const base =
      source.kind === "template"
        ? {
            templateId: source.template.id,
            categoryId: source.template.categoryId,
            payee: source.template.payee,
            walletId: source.template.walletId,
            note: source.template.note,
          }
        : {
            categoryId: source.expense.category?.id ?? "",
            payee: source.expense.payee,
            walletId: source.expense.wallet?.id ?? null,
            note: source.expense.description.trim() || null,
          };
    const typed = parseAmountInput(amount);
    save.mutate(
      {
        data: {
          ...base,
          name: name.trim(),
          amount: typed > 0 ? typed : null,
          reminderDay: reminder === NO_REMINDER ? null : Number(reminder),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none">
        <DialogHeader>
          <DialogTitle>{source.kind === "template" ? "Edit template" : "Save as template"}</DialogTitle>
          <DialogDescription>
            It shows as a one-tap button on Record expense. Nothing is ever recorded on its own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="rounded-none shadow-none" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-amount">
              Amount <span className="font-normal text-muted-foreground">(leave empty if it changes every time)</span>
            </Label>
            <ExpenseAmountField id="template-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-reminder">Monthly reminder</Label>
            <Select value={reminder} onValueChange={setReminder}>
              <SelectTrigger id="template-reminder" className="w-full rounded-none shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectItem value={NO_REMINDER}>No reminder</SelectItem>
                {DAYS.map((day) => (
                  <SelectItem key={day} value={day}>{`Day ${day} of every month`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-none shadow-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-none shadow-none" disabled={!name.trim() || save.isPending} onClick={submit}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Check `ExpenseAmountField`'s props (`src/components/finance/expense-amount-field.tsx`). It takes `id`, `value`, `onChange`, and optional `inputRef`; if its label text is rendered inside, the test's `getByLabelText("Amount")` may match two elements. In that case, switch the test to `getByLabelText(/^Amount/)` on the dialog's own label.

- [ ] **Step 4: Write the Templates sheet**

```tsx
// src/components/finance/expense-templates-sheet.tsx
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
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
import { Button } from "@/components/ui/button";
import { useArchiveExpenseTemplate, useExpenseTemplates } from "@/hooks/finance/use-expense-templates";
import { templateChipLabel } from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { ExpenseTemplateDialog } from "./expense-template-dialog";

export function ExpenseTemplatesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: templates = [] } = useExpenseTemplates(open);
  const archive = useArchiveExpenseTemplate();
  const [editing, setEditing] = useState<ExpenseTemplate | null>(null);
  const [deleting, setDeleting] = useState<ExpenseTemplate | null>(null);

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Templates"
        description="Saved repeats. Save a new one from any expense with Save as template."
      >
        {templates.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No templates yet. Open an expense and pick Save as template.
          </p>
        ) : (
          <ul className="divide-y border">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium wrap-break-word">{templateChipLabel(template)}</p>
                  <p className="text-sm text-muted-foreground">
                    {template.categoryName}
                    {template.payee ? ` · ${template.payee}` : ""} ·{" "}
                    {template.reminderDay ? `Reminds on day ${template.reminderDay}` : "No reminder"}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" className="rounded-none" aria-label={`Edit ${template.name}`} onClick={() => setEditing(template)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-none text-rose-500 hover:text-rose-600"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => setDeleting(template)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ResponsiveSheet>

      <ExpenseTemplateDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        source={editing ? { kind: "template", template: editing } : null}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Expenses already recorded from it stay as they are. Its reminder stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none"
              onClick={() => deleting && archive.mutate({ data: { templateId: deleting.id } }, { onSuccess: () => setDeleting(null) })}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

The test's sheet line reads "Reminds on day 1" through `getByText`. Because that text sits in one `<p>` with the category, use a `<span>` around the reminder part so `getByText("Reminds on day 1")` finds it exactly:
`<span>{template.reminderDay ? `Reminds on day ${template.reminderDay}` : "No reminder"}</span>`.

- [ ] **Step 5: Write the reminders panel**

```tsx
// src/components/finance/expense-reminders.tsx
import { format, parseISO } from "date-fns";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExpenseTemplates, useSkipExpenseTemplateMonth } from "@/hooks/finance/use-expense-templates";
import {
  getTemplateReminder,
  templateChipLabel,
  toDayKey,
  type TemplateReminder,
} from "@/lib/finance/expense-templates";
import type { ExpenseTemplate } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export function ExpenseReminders({ onRecord }: { onRecord: (template: ExpenseTemplate, reminder: TemplateReminder) => void }) {
  const { data: templates = [] } = useExpenseTemplates();
  const skip = useSkipExpenseTemplateMonth();
  const todayKey = toDayKey(new Date());

  const due = templates
    .flatMap((template) => {
      const reminder = getTemplateReminder({
        reminderDay: template.reminderDay,
        todayKey,
        expenseDates: template.expenseDates.map(toDayKey),
        skippedMonth: template.skippedMonth,
      });
      return reminder ? [{ template, reminder }] : [];
    })
    .sort((a, b) =>
      a.reminder.status !== b.reminder.status
        ? a.reminder.status === "overdue" ? -1 : 1
        : a.reminder.dueDate.localeCompare(b.reminder.dueDate),
    );

  if (due.length === 0) return null;

  return (
    <section className="border border-amber-500/30 bg-amber-500/5 p-4" aria-labelledby="due-this-week">
      <h2 id="due-this-week" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4 text-amber-600" />
        Due this week
      </h2>
      <ul className="divide-y divide-amber-500/20">
        {due.map(({ template, reminder }) => {
          const day = format(parseISO(reminder.dueDate), "d MMM");
          return (
            <li key={template.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium wrap-break-word">{templateChipLabel(template)}</p>
                <p className={cn("text-sm", reminder.status === "overdue" ? "text-rose-500" : "text-muted-foreground")}>
                  {reminder.status === "overdue" ? `Overdue since ${day}` : `Due ${day}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="rounded-none shadow-none" onClick={() => onRecord(template, reminder)}>
                  Record
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none shadow-none"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate({ data: { templateId: template.id, monthKey: reminder.monthKey } })}
                >
                  Skip this month
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- src/__tests__/expense-templates.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/finance/expense-template-dialog.tsx src/components/finance/expense-templates-sheet.tsx src/components/finance/expense-reminders.tsx src/__tests__/expense-templates.behavior.test.tsx
git commit -m "feat(expenses): save as template, manage templates and the Due this week panel"
```

---

### Task 8: Expenses list redesign

**Files:**
- Create: `src/components/finance/expense-month-summary.tsx`
- Create: `src/components/finance/expense-filters.tsx`
- Create: `src/components/finance/expense-detail-sheet.tsx`
- Rewrite: `src/components/finance/expenses-container.tsx`
- Modify: `src/components/finance/expense-categories-manager.tsx` (remove tutorial), `package.json` (remove `driver.js`)
- Modify: `src/__tests__/expenses-page.behavior.test.tsx`

**Interfaces:**
- Consumes: `useExpenseMonthSummary`, list/KPI filter params (Task 5); `describeMonthChange`, `toDayKey` (Task 1); `ExpenseReminders`, `ExpenseTemplateDialog`, `ExpenseTemplatesSheet` (Task 7); `ExpenseFormSheet` with `template`/`reminder` (Task 6); existing `ExpenseHistory`, `VoidExpenseDialog`, `getExpenseLockReason`, `getExpenseTitle`, `isNewExpenseShortcut`.
- Produces:
  - `ExpenseMonthSummary()`: the strip ("This month", total; change line; "Top categories" with up to 3 names and amounts).
  - `type ExpenseFilterState = { categoryIds: string[]; walletId: string; payee: string; range: DateRange }`, plus `ExpenseFilters({ value, onChange, categories, wallets })`. `walletId` is `""` for "All accounts".
  - `ExpenseDetailSheet({ expense, open, onOpenChange, canManage, onEdit, onVoid, onSaveTemplate })`.

- [ ] **Step 1: Rewrite the page test for the new layout**

Replace the body of `src/__tests__/expenses-page.behavior.test.tsx` from the `vi.mock("@/hooks/finance/use-finance", ...)` line down. Keep the `base` and `rows` fixtures and the router, viewer-access, form and void mocks. In `rows`, give the voided entry `payee: "K-Electric"` so "LESCO" names only the manual row. Change the form mock so it also shows the template:

```tsx
vi.mock("@/components/finance/expense-form-sheet", () => ({
  ExpenseFormSheet: ({ open, expense, template }: { open: boolean; expense?: ExpenseListItem | null; template?: { id: string } | null }) =>
    open ? <div>form for {expense?.id ?? template?.id ?? "new"}</div> : null,
}));
vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <section aria-label={title}>{children}</section> : null,
}));
const listCalls = vi.hoisted(() => ({ params: [] as unknown[] }));
vi.mock("@/hooks/finance/use-finance", () => ({
  useExpenseCategoryDefinitions: () => ({
    data: [
      { id: "power", name: "Electricity", slug: "power", icon: null, sortOrder: 0, isActive: true, isArchived: false, fields: [] },
      { id: "fuel", name: "Fuel", slug: "fuel", icon: null, sortOrder: 1, isActive: true, isArchived: false, fields: [] },
    ],
    isLoading: false,
    isError: false,
  }),
  useExpenses: (params: unknown) => {
    listCalls.params.push(params);
    return { data: { data: rows, total: 3, hasMore: false }, isFetching: false, isError: false };
  },
  useExpenseKpis: () => ({ data: { totalRecords: 2, totalCash: 10000, avgCashPerRecord: 5000 }, isFetching: false, isError: false }),
  useExpenseMonthSummary: () => ({
    data: { currentTotal: 120000, previousTotal: 100000, topCategories: [{ categoryId: "power", name: "Electricity", total: 90000 }] },
  }),
  useWallets: () => ({ data: [{ id: "w1", name: "Cash Box", type: "cash", balance: "2000.00" }] }),
}));
const templates = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/hooks/finance/use-expense-templates", () => ({
  useExpenseTemplates: () => ({ data: templates.data }),
  useSaveExpenseTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveExpenseTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useSkipExpenseTemplateMonth: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ExpensesContainer } from "@/components/finance/expenses-container";

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;
const drawer = () => screen.getByRole("region", { name: "Expense details" });

describe("Expenses page", () => {
  afterEach(cleanup);
  beforeEach(() => {
    access.permissions = ["finance.view", "finance.manage"];
    templates.data = [];
    listCalls.params = [];
  });

  it("has a Record expense button, a Templates button and no tutorial", () => {
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: /Record expense/ }));
    expect(screen.getByText("form for new")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Templates" })).toBeTruthy();
    expect(screen.queryByText(/Tutorial/)).toBeNull();
    expect(screen.queryByText(/Schema/)).toBeNull();
  });

  it("opens the form when N is pressed, but not while typing or with Ctrl/Cmd", () => {
    render(<><input aria-label="Search" /><ExpensesContainer /></>);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "n" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.queryByText("form for new")).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("form for new")).toBeTruthy();
  });

  it("shows this month's total, the change against last month and the top categories", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText("Rs 1,20,000")).toBeTruthy();
    expect(screen.getByText(/Rs 20,000 more than the same days last month \(20%\)/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "This month" })).getByText("Electricity")).toBeTruthy();
  });

  it("puts the filtered total in the footer", () => {
    render(<ExpensesContainer />);
    expect(screen.getByText(/3 expenses · Rs 10,000/)).toBeTruthy();
  });

  it("shows date, category, paid to, amount and account in each row", () => {
    render(<ExpensesContainer />);
    const row = rowOf("LESCO");
    for (const text of ["12 Oct 2026", "Electricity", "Rs 5,000", "Cash Box"]) {
      expect(within(row).getByText(text)).toBeTruthy();
    }
  });

  it("opens the drawer with details and history when a row is clicked", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("LESCO"));
    expect(within(drawer()).getByText(/Edited by Sana/)).toBeTruthy();
    expect(within(drawer()).getByText("S-1")).toBeTruthy();
  });

  it("edits, voids and saves as template from the drawer", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("form for manual")).toBeTruthy();
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Void" }));
    expect(screen.getByText("void manual")).toBeTruthy();
    fireEvent.click(rowOf("LESCO"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Save as template" }));
    expect(screen.getByRole("dialog", { name: "Save as template" })).toBeTruthy();
  });

  it("offers only Save as template on expenses made by other screens", () => {
    render(<ExpensesContainer />);
    fireEvent.click(rowOf("Supplier Purchase: Soda Ash"));
    expect(within(drawer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(drawer()).getByRole("button", { name: "Save as template" })).toBeTruthy();
  });

  it("strikes through voided expenses and shows who voided and why, with no actions", () => {
    render(<ExpensesContainer />);
    const row = rowOf("Duplicate");
    expect(within(row).getByText("Voided")).toBeTruthy();
    expect(within(row).getByText("Rs 5,000").className).toContain("line-through");
    fireEvent.click(row);
    expect(within(drawer()).getByText(/Voided by Sana/)).toBeTruthy();
    expect(within(drawer()).getByText("Reason: Entered twice")).toBeTruthy();
    expect(within(drawer()).queryByRole("button", { name: "Void" })).toBeNull();
    expect(within(drawer()).queryByRole("button", { name: "Save as template" })).toBeNull();
  });

  it("gives view-only users the list and drawer without any actions", () => {
    access.permissions = ["finance.view"];
    render(<ExpensesContainer />);
    expect(screen.queryByRole("button", { name: /Record expense/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Templates" })).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByText("form for new")).toBeNull();
    fireEvent.click(rowOf("LESCO"));
    expect(within(drawer()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(drawer()).queryByRole("button", { name: "Save as template" })).toBeNull();
  });

  it("sends the account and paid-to filters to the list query", async () => {
    vi.useFakeTimers();
    render(<ExpensesContainer />);
    fireEvent.change(screen.getByLabelText("Paid to"), { target: { value: "lesco" } });
    await vi.advanceTimersByTimeAsync(350);
    expect(listCalls.params.at(-1)).toMatchObject({ payee: "lesco", offset: 0 });
    vi.useRealTimers();
  });

  it("records from a reminder with the template filled in", () => {
    templates.data = [{
      id: "t-rent", name: "Shop rent", categoryId: "rent", categoryName: "Rent", amount: "85000.00",
      payee: "Landlord", walletId: "w1", note: null, reminderDay: 1, skippedMonth: null, expenseDates: [],
    }];
    render(<ExpensesContainer />);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByText("form for t-rent")).toBeTruthy();
  });
});
```

The reminder test relies on today being after the 1st; on the 1st itself the status is "due" instead of "overdue", and Record still shows. That keeps it stable on any day.

Note on the summary line: 120000 vs 100000 gives "Rs 20,000 more than the same days last month (20%)". The test above asserts this exact copy.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/__tests__/expenses-page.behavior.test.tsx`
Expected: most tests FAIL (no Templates button, no drawer, no strip).

- [ ] **Step 3: Write the summary strip**

```tsx
// src/components/finance/expense-month-summary.tsx
import { useExpenseMonthSummary } from "@/hooks/finance/use-finance";
import { formatRupees } from "@/lib/finance/expense-entry";
import { describeMonthChange, toDayKey } from "@/lib/finance/expense-templates";

export function ExpenseMonthSummary() {
  const { data, isError } = useExpenseMonthSummary(toDayKey(new Date()));
  if (isError) return null;

  const change = data ? describeMonthChange(data.currentTotal, data.previousTotal) : null;
  const changeText = !data || !change
    ? "…"
    : data.previousTotal === 0
      ? "No spending last month"
      : change.direction === "same"
        ? "Same as the same days last month"
        : `${formatRupees(change.amount)} ${change.direction === "up" ? "more" : "less"} than the same days last month (${change.percent}%)`;

  return (
    <section className="grid gap-px border bg-border md:grid-cols-[1fr_2fr]" aria-label="This month">
      <div className="bg-card p-5">
        <p className="text-sm text-muted-foreground">This month</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{data ? formatRupees(data.currentTotal) : "…"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{changeText}</p>
      </div>
      <div className="bg-card p-5">
        <p className="text-sm text-muted-foreground">Top categories</p>
        {data && data.topCategories.length > 0 ? (
          <ol className="mt-2 space-y-1">
            {data.topCategories.map((category) => (
              <li key={category.categoryId} className="flex justify-between gap-4 text-sm">
                <span className="font-medium">{category.name}</span>
                <span className="tabular-nums">{formatRupees(category.total)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{data ? "Nothing spent yet this month." : "…"}</p>
        )}
      </div>
    </section>
  );
}
```

Spending going up is bad news, so the change line stays neutral grey rather than green or red.

- [ ] **Step 4: Write the filters**

```tsx
// src/components/finance/expense-filters.tsx
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CheckIcon, ChevronDown } from "lucide-react";
import { DatePicker } from "@/components/custom/date-picker";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCurrentMonthRange } from "@/lib/finance-expenses";
import type { ExpenseCategoryDefinition, FinanceWalletSummary } from "@/lib/types/finance-types";
import { cn } from "@/lib/utils";

export type ExpenseFilterState = { categoryIds: string[]; walletId: string; payee: string; range: DateRange };

export const defaultExpenseFilters = (): ExpenseFilterState => ({
  categoryIds: [],
  walletId: "",
  payee: "",
  range: getCurrentMonthRange(),
});

const ALL_ACCOUNTS = "all";

export function ExpenseFilters({
  value,
  onChange,
  categories,
  wallets,
}: {
  value: ExpenseFilterState;
  onChange: (next: ExpenseFilterState) => void;
  categories: ExpenseCategoryDefinition[];
  wallets: FinanceWalletSummary[];
}) {
  // Paid to waits for a 300 ms pause in typing before it filters.
  const [payee, setPayee] = useState(value.payee);
  useEffect(() => setPayee(value.payee), [value.payee]);
  useEffect(() => {
    if (payee === value.payee) return;
    const timer = setTimeout(() => onChange({ ...value, payee }), 300);
    return () => clearTimeout(timer);
  }, [payee, value, onChange]);

  const toggleCategory = (id: string) =>
    onChange({
      ...value,
      categoryIds: value.categoryIds.includes(id)
        ? value.categoryIds.filter((current) => current !== id)
        : [...value.categoryIds, id],
    });

  const categoryText =
    value.categoryIds.length === 0
      ? "All categories"
      : value.categoryIds.length === 1
        ? (categories.find((c) => c.id === value.categoryIds[0])?.name ?? "1 category")
        : `${value.categoryIds.length} categories`;
  const isFiltered = value.categoryIds.length > 0 || value.walletId !== "" || value.payee !== "";

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 justify-between gap-2 rounded-none shadow-none lg:w-52" aria-label="Category">
            <span className="truncate">{categoryText}</span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 rounded-none p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories" />
            <CommandList>
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                {categories.map((category) => {
                  const picked = value.categoryIds.includes(category.id);
                  return (
                    <CommandItem key={category.id} value={category.name} onSelect={() => toggleCategory(category.id)} className="rounded-none">
                      <CheckIcon className={cn("mr-2 size-4", picked ? "opacity-100" : "opacity-0")} />
                      {category.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Select value={value.walletId || ALL_ACCOUNTS} onValueChange={(id) => onChange({ ...value, walletId: id === ALL_ACCOUNTS ? "" : id })}>
        <SelectTrigger className="h-9 rounded-none shadow-none lg:w-48" aria-label="Account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-none">
          <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        aria-label="Paid to"
        placeholder="Paid to"
        value={payee}
        onChange={(event) => setPayee(event.target.value)}
        maxLength={200}
        className="h-9 rounded-none shadow-none lg:w-48"
      />

      <DatePicker
        mode="range"
        range={value.range}
        onRangeChange={(range) => onChange({ ...value, range: range ?? getCurrentMonthRange() })}
        placeholder="Current month"
        className="h-9 min-w-65 rounded-none shadow-none"
      />

      {isFiltered ? (
        <Button variant="link" className="h-9 px-1" onClick={() => onChange({ ...defaultExpenseFilters(), range: value.range })}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
```

"Clear filters" keeps the date range. It only shows when a category, account or payee filter is on, and resetting the dates there would surprise people.

- [ ] **Step 5: Write the detail drawer**

Move `ExpenseDynamicFieldDetails` and `ExpenseDynamicFieldCard` out of `expenses-container.tsx` into this file unchanged.

```tsx
// src/components/finance/expense-detail-sheet.tsx
import { Fragment } from "react";
import { format } from "date-fns";
import { Ban, Pencil, Repeat } from "lucide-react";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getExpenseLockReason } from "@/lib/finance/expense-corrections";
import { formatRupees, getExpenseTitle } from "@/lib/finance/expense-entry";
import type { ExpenseFieldValueDisplay, ExpenseListItem } from "@/lib/types/finance-types";
import { ExpenseHistory } from "./expense-history";

export function ExpenseDetailSheet({
  expense,
  open,
  onOpenChange,
  canManage,
  onEdit,
  onVoid,
  onSaveTemplate,
}: {
  expense: ExpenseListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onEdit: (expense: ExpenseListItem) => void;
  onVoid: (expense: ExpenseListItem) => void;
  onSaveTemplate: (expense: ExpenseListItem) => void;
}) {
  if (!expense) return null;
  const isVoided = expense.voidedAt !== null;
  const lockReason = getExpenseLockReason(expense);

  const facts = (
    [
      ["Date", format(new Date(expense.expenseDate), "dd MMM yyyy")],
      ["What for", expense.category?.name ?? null],
      ["Paid to", expense.payee],
      ["Paid from", expense.wallet?.name ?? null],
      ["Note", expense.description],
      ["Slip / ref", expense.slipNumber],
      ["Remarks", expense.remarks],
      ["Recorded by", expense.performer?.name ?? null],
    ] satisfies Array<[string, string | null]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Expense details" description={getExpenseTitle(expense)}>
      <div className="space-y-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={isVoided ? "text-3xl font-bold tabular-nums line-through" : "text-3xl font-bold tabular-nums"}>
            {formatRupees(expense.amount)}
          </p>
          {isVoided ? <Badge variant="destructive" className="rounded-none">Voided</Badge> : null}
          {!isVoided && lockReason ? <Badge variant="outline" className="rounded-none" title={lockReason}>Auto</Badge> : null}
        </div>

        {canManage && !isVoided ? (
          <div className="flex flex-wrap gap-2">
            {!lockReason ? (
              <>
                <Button variant="outline" className="rounded-none shadow-none" onClick={() => onEdit(expense)}>
                  <Pencil className="mr-2 size-4" />Edit
                </Button>
                <Button variant="outline" className="rounded-none text-rose-500 shadow-none hover:text-rose-600" onClick={() => onVoid(expense)}>
                  <Ban className="mr-2 size-4" />Void
                </Button>
              </>
            ) : null}
            <Button variant="outline" className="rounded-none shadow-none" onClick={() => onSaveTemplate(expense)}>
              <Repeat className="mr-2 size-4" />Save as template
            </Button>
          </div>
        ) : null}
        {!isVoided && lockReason ? <p className="text-sm text-muted-foreground">{lockReason}</p> : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="wrap-break-word">{value}</dd>
            </Fragment>
          ))}
        </dl>

        <ExpenseDynamicFieldDetails expense={expense} />

        <div className="space-y-2">
          <p className="text-sm font-semibold">History</p>
          <ExpenseHistory expense={expense} />
        </div>
      </div>
    </ResponsiveSheet>
  );
}

// ExpenseDynamicFieldDetails and ExpenseDynamicFieldCard: moved here unchanged from expenses-container.tsx.
```

The page test finds the drawer by `getByRole("region", { name: "Expense details" })` through its ResponsiveSheet mock (`<section aria-label={title}>`). The real sheet renders a dialog, which is fine in the browser.

- [ ] **Step 6: Rewrite the container**

Rewrite `src/components/finance/expenses-container.tsx`. Keep: the `canManageFinance` check, the N shortcut effect, the categories loading/error/empty alerts, pagination, `ExpenseFormSheet` and `VoidExpenseDialog`. Remove: the category button row, the three KPI cards with `ExpenseKpiCard`/`sharpThemeStyles`, the expand column and `ExpenseRowDetails`, and the row Edit/Void buttons. The new pieces:

```tsx
// State
const [filters, setFilters] = useState<ExpenseFilterState>(defaultExpenseFilters);
const [offset, setOffset] = useState(0);
const [detail, setDetail] = useState<ExpenseListItem | null>(null);
const [formOpen, setFormOpen] = useState(false);
const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(null);
const [formTemplate, setFormTemplate] = useState<{ template: ExpenseTemplate; reminder: TemplateReminder } | null>(null);
const [voidTarget, setVoidTarget] = useState<ExpenseListItem | null>(null);
const [templateSource, setTemplateSource] = useState<TemplateSource>(null);
const [templatesOpen, setTemplatesOpen] = useState(false);

// Filters reset paging. useCallback so ExpenseFilters' debounce effect doesn't loop.
const changeFilters = useCallback((next: ExpenseFilterState) => {
  setFilters(next);
  setOffset(0);
}, []);

const { dateFrom, dateTo } = getExpenseDateRangeFilters(filters.range);
const shared = {
  categoryIds: filters.categoryIds,
  walletId: filters.walletId || undefined,
  payee: filters.payee.trim() || undefined,
  dateFrom,
  dateTo,
};
const expensesQuery = useExpenses({ limit: LIMIT, offset, ...shared });
const kpisQuery = useExpenseKpis(shared);

const openCreate = () => { setEditingExpense(null); setFormTemplate(null); setFormOpen(true); };
const openEdit = (expense: ExpenseListItem) => { setDetail(null); setEditingExpense(expense); setFormTemplate(null); setFormOpen(true); };
const openVoid = (expense: ExpenseListItem) => { setDetail(null); setVoidTarget(expense); };
const openSaveTemplate = (expense: ExpenseListItem) => { setDetail(null); setTemplateSource({ kind: "expense", expense }); };
const recordFromReminder = (template: ExpenseTemplate, reminder: TemplateReminder) => {
  setEditingExpense(null);
  setFormTemplate({ template, reminder });
  setFormOpen(true);
};
```

Change the N shortcut effect to call `openCreate()` (so a template left over from a reminder is cleared).

Layout, top to bottom:

```tsx
<div className="space-y-5">
  {canManageFinance ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button className="h-10 gap-2 rounded-none shadow-none" onClick={openCreate}>
        <Plus className="size-4" />
        Record expense
        <Kbd className="ml-1">N</Kbd>
      </Button>
      <div className="flex gap-2">
        <Button variant="outline" className="h-10 rounded-none shadow-none" onClick={() => setTemplatesOpen(true)}>
          <Repeat className="mr-2 size-4" />
          Templates
        </Button>
        <Button asChild variant="outline" className="h-10 rounded-none shadow-none">
          <Link to="/finance/expenses/settings">
            <Settings2 className="mr-2 size-4" />
            Expense Categories
          </Link>
        </Button>
      </div>
    </div>
  ) : null}

  {canManageFinance ? <ExpenseReminders onRecord={recordFromReminder} /> : null}
  <ExpenseMonthSummary />
  <ExpenseFilters value={filters} onChange={changeFilters} categories={categories} wallets={wallets} />

  {/* existing category loading / error / "No active expense categories" alerts, unchanged */}

  <div className="w-0 min-w-full overflow-x-auto border border-border rounded-none">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Paid to</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Account</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* loading / error / empty rows as today, with COLUMN_COUNT = 5 and
            empty text "No expenses match these filters." */}
        {expenses.map((expense) => {
          const isVoided = expense.voidedAt !== null;
          const note = expense.description.trim();
          return (
            <TableRow
              key={expense.id}
              tabIndex={0}
              className={cn("cursor-pointer", isVoided && "opacity-60")}
              onClick={() => setDetail(expense)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setDetail(expense);
              }}
            >
              <TableCell className="font-medium tabular-nums align-top">
                {format(new Date(expense.expenseDate), "dd MMM yyyy")}
              </TableCell>
              <TableCell className="min-w-44 whitespace-normal align-top">
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    {expense.category?.name ?? "—"}
                    {isVoided ? <Badge variant="destructive" className="rounded-none">Voided</Badge> : null}
                    {!isVoided && getExpenseLockReason(expense) ? <Badge variant="outline" className="rounded-none">Auto</Badge> : null}
                  </span>
                  {note ? <span className="text-xs text-muted-foreground wrap-break-word">{note}</span> : null}
                </div>
              </TableCell>
              <TableCell className="min-w-28 whitespace-normal wrap-break-word align-top">{expense.payee ?? "—"}</TableCell>
              <TableCell className={cn("text-right font-semibold tabular-nums align-top", isVoided && "line-through")}>
                {formatRupees(expense.amount)}
              </TableCell>
              <TableCell className="whitespace-normal align-top">{expense.wallet?.name ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </div>

  <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
    <p className="text-sm text-muted-foreground tabular-nums">
      Page {page} of {pageCount} · {total} expenses
      {kpisQuery.data ? ` · ${formatRupees(kpisQuery.data.totalCash)}` : ""}
    </p>
    {/* Prev / Next buttons as today (without setExpandedExpenseId) */}
  </div>

  <ExpenseDetailSheet
    expense={detail}
    open={detail !== null}
    onOpenChange={(open) => !open && setDetail(null)}
    canManage={canManageFinance}
    onEdit={openEdit}
    onVoid={openVoid}
    onSaveTemplate={openSaveTemplate}
  />
  <ExpenseFormSheet
    open={formOpen}
    onOpenChange={setFormOpen}
    wallets={wallets}
    expense={editingExpense}
    template={formTemplate?.template ?? null}
    reminder={formTemplate?.reminder ?? null}
  />
  <VoidExpenseDialog expense={voidTarget} open={voidTarget !== null} onOpenChange={(open) => !open && setVoidTarget(null)} />
  <ExpenseTemplateDialog open={templateSource !== null} onOpenChange={(open) => !open && setTemplateSource(null)} source={templateSource} />
  <ExpenseTemplatesSheet open={templatesOpen} onOpenChange={setTemplatesOpen} />
</div>
```

The footer's `kpisQuery.data.totalCash` is a number (sum of live expenses). Once the rows render through `formatRupees`, "Rs 5,000" shows in each row, matching the test.

The page test's "3 expenses · Rs 10,000" uses `total` (3, voided included, because the list shows voided rows) and `totalCash` (10,000, voided excluded). That is deliberate: the count is rows on screen, the money is real spend.

Update `src/routes/_protected/finance/expenses/index.tsx`'s loader: the list prefetch keeps working, since the new params are optional. Add a summary prefetch only if it's cheap; it isn't needed.

- [ ] **Step 7: Remove the tutorial from Expense Categories**

In `src/components/finance/expense-categories-manager.tsx`: delete `startTutorial`, the "Start Tutorial" button, the `driver` and `driver.js/dist/driver.css` imports (check the top of the file), and the `BookOpen` import if it's now unused. Leave the `data-tour` attributes alone; they're harmless. Keep the header text. Then:

Run: `bun remove driver.js`
Expected: `package.json` and `bun.lock` drop `driver.js`. `grep -rn "driver" src` returns nothing.

- [ ] **Step 8: Run tests, typecheck**

Run: `bun run test -- src/__tests__/expenses-page.behavior.test.tsx src/__tests__/expense-templates.behavior.test.tsx src/__tests__/expense-form-sheet.behavior.test.tsx src/__tests__/void-expense-dialog.behavior.test.tsx && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/finance src/__tests__/expenses-page.behavior.test.tsx package.json bun.lock src/routes/_protected/finance/expenses/index.tsx
git commit -m "feat(expenses): month summary, filters and a detail drawer on the Expenses list; drop the categories tutorial"
```

---

### Task 9: Full verification

**Files:** none new.

- [ ] **Step 1: Unit and behaviour tests**

Run: `bun run test -- src/lib src/__tests__ src/server-functions src/db --exclude "src/__tests__/integration/**" --exclude "src/__tests__/e2e/**"`
Expected: everything passes except tests that already failed on the starting branch. For any failure, run that file on the starting commit and report every failure that is new on this branch.

- [ ] **Step 2: Integration tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/expense-templates.test.ts src/__tests__/integration/expense-list-filters.test.ts src/__tests__/integration/expense-list.test.ts src/__tests__/integration/expense-entry.test.ts src/__tests__/integration/expense-corrections.test.ts src/__tests__/integration/expense-void-totals.test.ts`
Expected: PASS.

- [ ] **Step 3: Type check and build**

Run: `bun run typecheck && bun run build`
Expected: no type errors, build succeeds.

- [ ] **Step 4: Migration check on existing data**

On a copy of local data from before this branch, run `bun run db:migrate`. Check:
- `expense_templates` exists and is empty; every existing expense has `template_id` null.
- The Expenses page lists old expenses exactly as before (same totals for the current month in the footer as the old "Total Cash" card showed).

- [ ] **Step 5: Walk through in the browser**

With `bun run dev`, signed in as a finance manager:
1. Open an expense (Electricity · LESCO, Rs 12,000). The drawer shows its details and history. Pick **Save as template**, clear the amount, set reminder day 5, save. "Templates" lists "Electricity · LESCO" with "Reminds on day 5".
2. Record expense: the chip "Electricity · LESCO" appears at the top. Tap it: category, paid to and account fill in, amount stays empty. Enter Rs 11,500 and save.
3. Save another expense as "Shop rent" at Rs 85,000 with reminder day 1. If today is past the 1st, "Due this week" shows "Shop rent — Rs 85,000 · Overdue since 1 <month>". Press **Record**: the form opens filled in. Save it. The reminder disappears.
4. Void that rent expense. The reminder comes back.
5. Press **Skip this month** on it. It disappears; in Templates it is still there.
6. Delete the rent template from Templates (confirm). It's gone from chips and reminders; the old expense still shows in the list.
7. The summary strip shows this month's total, the change against the same days last month, and the top 3 categories. Voided expenses aren't counted.
8. Filters: pick two categories, then one account, then type part of a payee. The rows, the page count and the footer total follow. "Clear filters" resets everything except the dates.
9. Click a row made by another screen (a supplier purchase). The drawer shows "Auto" and only **Save as template**.
10. Sign in as a view-only finance user: no Record expense, no Templates, no reminders; the strip, filters, rows and the drawer (without buttons) work.
11. Expense Categories has no "Start Tutorial" button.
12. At phone width (390 px), the strip, filters and drawer fit without sideways scrolling, except the table, which scrolls inside its own box.

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

---

## Self-review notes

- **Spec coverage (Part B, phase 7 items):**
  - "Save as template" on any expense: Task 7 (dialog), Task 8 (drawer button on every non-voided expense, including system-made ones).
  - Templates as one-tap chips at the top of the quick-add form, labelled "Shop rent — Rs 85,000": Tasks 1 (label) and 6.
  - Optional monthly reminders, shown as "Due this week", never auto-posted: Tasks 1, 3 and 7. Nothing in the plan writes an expense without a person pressing Save.
  - List page top: this month's total, change vs last month, top 3 categories: Tasks 1, 4 and 8.
  - Filters: category (searchable, multi-select), account, paid to, date range: Tasks 4, 5 and 8.
  - Rows: date, category, paid to, amount, account; click opens a drawer with everything and the edit/void history: Task 8.
  - Rename "Expense Schema" to Expense Categories: already shipped in phase 2 (the page test checks there's no "Schema" text).
  - Remove the tutorial buttons: the Expenses page one was removed in phase 2. The Expense Categories one is removed in Task 8.
  - B4 data changes: "New: expense templates" is in Task 2.
- **Placeholders:** none. Every code step has the code; the two "check X and adapt" notes (user name on the session type, `ExpenseAmountField` label) name the exact file and the exact fallback.
- **Type consistency:** `ExpenseTemplate` (Task 3) is used by Tasks 5–8 with the same fields. `TemplateReminder` comes from Task 1 throughout. `ExpenseFilterState.walletId` is `""` for "all", and the container maps it to `undefined` before the query. `getExpensesFn` gets `categoryIds`/`walletId`/`payee` (Task 4), which match the hook params (Task 5).
