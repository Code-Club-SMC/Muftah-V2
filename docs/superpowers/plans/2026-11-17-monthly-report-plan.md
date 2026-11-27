# Monthly Report and Other Income Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Finance "Other Income" entry for by-product sales and a one-page July–June "Monthly Report" under Reports that rebuilds the client's Excel summary from system data.

**Architecture:** A new `other_income` table with server functions that move money on a wallet and write a ledger transaction in one DB transaction. The monthly report is split into a pure, tested math module (`src/lib/reports/monthly-report.ts`) that turns per-month amounts into report lines, and a server-only query module that loads one financial year from existing tables and buckets rows by Pakistan calendar month. The UI is a new report route with a sticky-column table, a drill-down side sheet and CSV export.

**Tech Stack:** TanStack Start (`createServerFn`), Drizzle ORM + PostgreSQL, Zod 4, big.js, TanStack Query, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-monthly-report-spec.md`

## Global Constraints

- Expense rows in the report come only from the `expense_categories` table. No category name may be hard-coded in report code. The only exclusion is the system slug `supplier-purchase`.
- Financial year runs July to June. Month bucketing uses Pakistan time via `reportDateKey` from `src/lib/report-dates.ts`.
- Credit is "as of today" (outstanding amount now), not frozen at sale time.
- Sales are counted in the month of the invoice date.
- Never hand-edit files under `src/db/migrations/`. Generate with `bun run db:generate`.
- Money math uses `big.js`; never add rupee amounts with plain floats on the server.
- Other Income is voided, never deleted.
- Ledger source string for Other Income is exactly `Other Income`.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/db/schemas/finance-schema.ts` | Modify | Add `otherIncome` table |
| `src/db/migrations/*` | Generated | Migration for `other_income` |
| `src/lib/finance/other-income.ts` | Create | Pure helpers: amount, item name, ledger source |
| `src/__tests__/other-income.test.ts` | Create | Tests for helpers + server function wiring |
| `src/server-functions/finance/other-income-fn.ts` | Create | List, item names, create, void |
| `src/hooks/finance/use-other-income.ts` | Create | Query and mutation hooks |
| `src/components/finance/other-income-page.tsx` | Create | List, add sheet, void dialog |
| `src/routes/_protected/finance/other-income/index.tsx` | Create | Route |
| `src/lib/constants.ts` | Modify | Sidebar item under Finance |
| `src/lib/reports/monthly-report.ts` | Create | Pure report math, labels, CSV |
| `src/__tests__/monthly-report.test.ts` | Create | Tests for math + query wiring + UI wiring |
| `src/server-functions/reports/monthly-report-queries.server.ts` | Create | Year loader and drill-down loader |
| `src/server-functions/reports/monthly-report-fn.ts` | Create | Server functions with `reports.view` |
| `src/components/reports/monthly/monthly-report-table.tsx` | Create | Report table |
| `src/components/reports/monthly/monthly-report-detail-sheet.tsx` | Create | Drill-down side sheet |
| `src/routes/_protected/reports/monthly/index.tsx` | Create | Report page |
| `src/routes/_protected/reports/index.tsx` | Modify | Hub card |

---

### Task 1: Other Income table and pure helpers

**Files:**
- Modify: `src/db/schemas/finance-schema.ts`
- Create: `src/lib/finance/other-income.ts`
- Test: `src/__tests__/other-income.test.ts`
- Generated: new migration under `src/db/migrations/`

**Interfaces:**
- Produces: `otherIncome` Drizzle table; `otherIncomeAmount(quantity: string | number, unitPrice: string | number): string`; `normalizeItemName(value: string): string`; `OTHER_INCOME_TX_SOURCE = "Other Income"`; `MAX_OTHER_INCOME_AMOUNT`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/other-income.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_INCOME_AMOUNT,
  normalizeItemName,
  OTHER_INCOME_TX_SOURCE,
  otherIncomeAmount,
} from "@/lib/finance/other-income";

describe("other income helpers", () => {
  it("multiplies quantity by price and rounds to paisa", () => {
    expect(otherIncomeAmount(1, 1500)).toBe("1500.00");
    expect(otherIncomeAmount("2.5", "33.33")).toBe("83.33");
    expect(otherIncomeAmount("0.333", "10")).toBe("3.33");
  });

  it("refuses amounts that round to zero or exceed the column", () => {
    expect(() => otherIncomeAmount("0.001", "1")).toThrow("at least Rs 0.01");
    expect(() => otherIncomeAmount(2, MAX_OTHER_INCOME_AMOUNT)).toThrow("too large");
  });

  it("trims and collapses spaces in item names", () => {
    expect(normalizeItemName("  SLES   drum ")).toBe("SLES drum");
  });

  it("uses a fixed ledger source", () => {
    expect(OTHER_INCOME_TX_SOURCE).toBe("Other Income");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/other-income.test.ts`
Expected: FAIL, cannot resolve `@/lib/finance/other-income`.

- [ ] **Step 3: Write the helpers**

Create `src/lib/finance/other-income.ts`:

```ts
import Big from "big.js";

/** Same ceiling as the amount column (numeric 12,2). */
export const MAX_OTHER_INCOME_AMOUNT = 9_999_999_999.99;

/** Ledger `transactions.source` for every Other Income money move. */
export const OTHER_INCOME_TX_SOURCE = "Other Income";

/** Quantity × price each, rounded to paisa. Throws when not above zero or too large for the column. */
export function otherIncomeAmount(quantity: string | number, unitPrice: string | number): string {
  const amount = new Big(quantity).times(unitPrice).round(2);
  if (!amount.gt(0)) throw new Error("Amount must be at least Rs 0.01");
  if (amount.gt(MAX_OTHER_INCOME_AMOUNT)) throw new Error("Amount is too large");
  return amount.toFixed(2);
}

/** "  SLES   drum " → "SLES drum", so the same item is not saved under two spellings. */
export function normalizeItemName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/other-income.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the table**

In `src/db/schemas/finance-schema.ts`, add `check` to the `drizzle-orm/pg-core` import list:

```ts
import {
  type AnyPgColumn,
  boolean,
  check,
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

Then insert this block directly after the `transactions` table definition (before `// --- RELATIONS ---`):

```ts
// --- OTHER INCOME (money in that is not a sale, e.g. empty drums sold) ---
export const otherIncome = pgTable(
  "other_income",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    incomeDate: timestamp("income_date").notNull(),
    itemName: text("item_name").notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    performedById: text("performed_by_id")
      .notNull()
      .references(() => user.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id").references(() => user.id),
    voidReason: text("void_reason"),
    voidTransactionId: text("void_transaction_id").references(() => transactions.id),
    ...timestamps,
  },
  (table) => ({
    dateIdx: index("other_income_date_idx").on(table.incomeDate),
    positive: check(
      "other_income_positive",
      sql`${table.amount} > 0 and ${table.quantity} > 0 and ${table.unitPrice} > 0`,
    ),
  }),
);
```

- [ ] **Step 6: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file under `src/db/migrations/` containing `CREATE TABLE "other_income"`, plus updated snapshot and journal. Do not edit them.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/schemas/finance-schema.ts src/db/migrations src/lib/finance/other-income.ts src/__tests__/other-income.test.ts
git commit -m "feat(finance): add other income table and amount helpers"
```

---

### Task 2: Other Income server functions

**Files:**
- Create: `src/server-functions/finance/other-income-fn.ts`
- Test: `src/__tests__/other-income.test.ts` (append)

**Interfaces:**
- Consumes: `otherIncome`, `transactions`, `wallets` tables; helpers from Task 1; `parseExpenseDate`, `Tx` from `src/server-functions/finance/expense-writes.server.ts`; `formatRupees` from `src/lib/finance/expense-entry.ts`; `reportMonth`, `reportDateBounds` from `src/lib/report-dates.ts`.
- Produces:
  - `getOtherIncomeFn({ data: { month: "YYYY-MM" } }) → { rows: OtherIncomeRow[]; total: string }` where `OtherIncomeRow = { id: string; incomeDate: Date; itemName: string; quantity: string; unitPrice: string; amount: string; note: string | null; walletName: string | null; recordedBy: string | null; voidedAt: Date | null; voidReason: string | null }`
  - `getOtherIncomeItemNamesFn() → string[]`
  - `createOtherIncomeFn({ data: { incomeDate: string; itemName: string; quantity: number; unitPrice: number; walletId: string; note?: string } })`
  - `voidOtherIncomeFn({ data: { id: string; reason: string } })`

- [ ] **Step 1: Write the failing wiring test**

Append to `src/__tests__/other-income.test.ts`:

```ts
import { readFileSync } from "node:fs";

const fnSource = () => readFileSync("src/server-functions/finance/other-income-fn.ts", "utf8");

describe("other income server functions", () => {
  it("guards writes with finance.manage and reads with finance.view", () => {
    const source = fnSource();
    expect(source.match(/requireFinanceManageMiddleware\]/g)?.length).toBe(2);
    expect(source.match(/requireFinanceViewMiddleware\]/g)?.length).toBe(2);
  });

  it("moves money and writes the ledger in one transaction", () => {
    const source = fnSource();
    expect(source.match(/db\.transaction\(/g)?.length).toBe(2);
    expect(source).toContain("source: OTHER_INCOME_TX_SOURCE");
  });

  it("never deletes an entry and refuses a double void", () => {
    const source = fnSource();
    expect(source).not.toContain("delete(otherIncome)");
    expect(source).toContain("already voided");
  });

  it("refuses a void that would take the account below zero", () => {
    expect(fnSource()).toContain("gte(wallets.balance, input.amount)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/other-income.test.ts`
Expected: FAIL with ENOENT for `other-income-fn.ts`.

- [ ] **Step 3: Write the server functions**

Create `src/server-functions/finance/other-income-fn.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { otherIncome, transactions, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { formatRupees } from "@/lib/finance/expense-entry";
import {
  MAX_OTHER_INCOME_AMOUNT,
  normalizeItemName,
  OTHER_INCOME_TX_SOURCE,
  otherIncomeAmount,
} from "@/lib/finance/other-income";
import { requireFinanceManageMiddleware, requireFinanceViewMiddleware } from "@/lib/middlewares";
import { reportDateBounds, reportMonth } from "@/lib/report-dates";
import { parseExpenseDate, type Tx } from "./expense-writes.server";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");

/**
 * Adds or removes money on one account and writes its ledger row. A debit is refused when the
 * account holds less than the amount; the balance check and update are one row-locking statement.
 */
async function moveWalletMoney(
  tx: Tx,
  input: {
    walletId: string;
    type: "credit" | "debit";
    amount: string;
    referenceId: string;
    performedById: string;
    description: string;
  },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance:
        input.type === "credit"
          ? sql`${wallets.balance} + ${input.amount}`
          : sql`${wallets.balance} - ${input.amount}`,
    })
    .where(
      input.type === "debit"
        ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
        : eq(wallets.id, input.walletId),
    )
    .returning({ id: wallets.id });

  if (!wallet) {
    const existing = await tx.query.wallets.findFirst({
      where: eq(wallets.id, input.walletId),
      columns: { name: true, balance: true },
    });
    if (!existing) throw new Error("Account not found");
    throw new Error(
      `${existing.name} has only ${formatRupees(existing.balance)}. Voiding would take it below zero.`,
    );
  }

  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: OTHER_INCOME_TX_SOURCE,
    referenceId: input.referenceId,
    description: input.description,
    performedById: input.performedById,
  });
  return id;
}

export const getOtherIncomeFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(z.object({ month: monthSchema }))
  .handler(async ({ data }) => {
    const { from, to } = reportMonth(`${data.month}-01`);
    const { fromDate, toDate } = reportDateBounds({ dateFrom: from, dateTo: to });
    const rows = await db
      .select({
        id: otherIncome.id,
        incomeDate: otherIncome.incomeDate,
        itemName: otherIncome.itemName,
        quantity: otherIncome.quantity,
        unitPrice: otherIncome.unitPrice,
        amount: otherIncome.amount,
        note: otherIncome.note,
        walletName: wallets.name,
        recordedBy: user.name,
        voidedAt: otherIncome.voidedAt,
        voidReason: otherIncome.voidReason,
      })
      .from(otherIncome)
      .leftJoin(wallets, eq(otherIncome.walletId, wallets.id))
      .leftJoin(user, eq(otherIncome.performedById, user.id))
      .where(and(gte(otherIncome.incomeDate, fromDate!), lte(otherIncome.incomeDate, toDate!)))
      .orderBy(desc(otherIncome.incomeDate), desc(otherIncome.createdAt));

    const total = rows
      .filter((row) => row.voidedAt === null)
      .reduce((sum, row) => sum.plus(row.amount), new Big(0));
    return { rows, total: total.toFixed(2) };
  });

export const getOtherIncomeItemNamesFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .handler(async () => {
    const rows = await db
      .selectDistinct({ itemName: otherIncome.itemName })
      .from(otherIncome)
      .where(isNull(otherIncome.voidedAt))
      .orderBy(asc(otherIncome.itemName));
    return rows.map((row) => row.itemName);
  });

export const createOtherIncomeFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      incomeDate: z.string().min(1, "Please pick a date"),
      itemName: z
        .string()
        .transform(normalizeItemName)
        .pipe(z.string().min(1, "Please enter the item").max(120, "Item name is too long")),
      quantity: z.number().finite().positive("Quantity must be above zero").max(999_999_999),
      unitPrice: z.number().finite().positive("Price must be above zero").max(MAX_OTHER_INCOME_AMOUNT),
      walletId: z.string().min(1, "Please pick the account"),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const incomeDate = parseExpenseDate(data.incomeDate);
    const quantity = new Big(data.quantity).round(3);
    if (!quantity.gt(0)) throw new Error("Quantity must be above zero");
    const unitPrice = new Big(data.unitPrice).round(2);
    if (!unitPrice.gt(0)) throw new Error("Price must be above zero");
    const amount = otherIncomeAmount(quantity.toFixed(3), unitPrice.toFixed(2));
    const userId = context.session.user.id;
    const id = createId();

    return await db.transaction(async (tx) => {
      const transactionId = await moveWalletMoney(tx, {
        walletId: data.walletId,
        type: "credit",
        amount,
        referenceId: id,
        performedById: userId,
        description: `Other income: ${data.itemName}`,
      });

      const [row] = await tx
        .insert(otherIncome)
        .values({
          id,
          incomeDate,
          itemName: data.itemName,
          quantity: quantity.toFixed(3),
          unitPrice: unitPrice.toFixed(2),
          amount,
          note: data.note || null,
          walletId: data.walletId,
          transactionId,
          performedById: userId,
        })
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "other_income",
        entityId: id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Recorded other income of ${amount} for ${data.itemName}`,
      });

      return row;
    });
  });

export const voidOtherIncomeFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      reason: z.string().trim().min(3, "Please give a reason").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(otherIncome)
        .where(eq(otherIncome.id, data.id))
        .for("update");
      if (!current) throw new Error("Income entry not found");
      if (current.voidedAt) throw new Error("This entry is already voided");

      const voidTransactionId = await moveWalletMoney(tx, {
        walletId: current.walletId,
        type: "debit",
        amount: current.amount,
        referenceId: current.id,
        performedById: userId,
        description: `Void of other income: ${current.itemName}`,
      });

      const [voided] = await tx
        .update(otherIncome)
        .set({ voidedAt: new Date(), voidedById: userId, voidReason: data.reason, voidTransactionId })
        .where(eq(otherIncome.id, current.id))
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "other_income",
        entityId: current.id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Voided other income of ${current.amount}: ${data.reason}`,
      });

      return voided;
    });
  });
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bunx vitest run src/__tests__/other-income.test.ts && bun run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/finance/other-income-fn.ts src/__tests__/other-income.test.ts
git commit -m "feat(finance): record and void other income against accounts"
```

---

### Task 3: Other Income page, hooks and sidebar item

**Files:**
- Create: `src/hooks/finance/use-other-income.ts`
- Create: `src/components/finance/other-income-page.tsx`
- Create: `src/routes/_protected/finance/other-income/index.tsx`
- Modify: `src/lib/constants.ts` (Finance `items` array)
- Test: `src/__tests__/other-income.test.ts` (append)

**Interfaces:**
- Consumes: server functions from Task 2; `useWallets` from `src/hooks/finance/use-finance.ts` (returns wallets with `id`, `name`, `balance`); `useViewerAccess` + `hasPermission`; `invalidateFinanceQueries` from `src/lib/finance/invalidate-finance.ts`; `ResponsiveSheet`; `MonthSelector` (value `"YYYY-MM"`).
- Produces: `otherIncomeKeys`, `useOtherIncome(month)`, `useOtherIncomeItemNames()`, `useCreateOtherIncome()`, `useVoidOtherIncome()`; `OtherIncomePage` component; route `/finance/other-income`.

- [ ] **Step 1: Write the failing wiring test**

Append to `src/__tests__/other-income.test.ts`:

```ts
describe("other income page wiring", () => {
  it("adds Other Income to the Finance sidebar", () => {
    expect(readFileSync("src/lib/constants.ts", "utf8")).toContain('url: "/finance/other-income"');
  });

  it("lists accounts with balances in Received in", () => {
    const page = readFileSync("src/components/finance/other-income-page.tsx", "utf8");
    expect(page).toContain("useWallets()");
    expect(page).toContain("formatRupees(wallet.balance)");
  });

  it("refreshes reports and balances after a money change", () => {
    expect(readFileSync("src/hooks/finance/use-other-income.ts", "utf8")).toContain("invalidateFinanceQueries(queryClient)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/other-income.test.ts`
Expected: FAIL (sidebar entry missing, files missing).

- [ ] **Step 3: Write the hooks**

Create `src/hooks/finance/use-other-income.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import {
  createOtherIncomeFn,
  getOtherIncomeFn,
  getOtherIncomeItemNamesFn,
  voidOtherIncomeFn,
} from "@/server-functions/finance/other-income-fn";

export const otherIncomeKeys = {
  all: ["other-income"] as const,
  month: (month: string) => ["other-income", "month", month] as const,
  items: ["other-income", "items"] as const,
};

export const useOtherIncome = (month: string) =>
  useQuery({
    queryKey: otherIncomeKeys.month(month),
    queryFn: () => getOtherIncomeFn({ data: { month } }),
  });

export const useOtherIncomeItemNames = () =>
  useQuery({
    queryKey: otherIncomeKeys.items,
    queryFn: () => getOtherIncomeItemNamesFn(),
  });

/** Income moves account balances and feeds the monthly report, so refresh both. */
function useRefreshAfterIncomeChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: otherIncomeKeys.all }),
      invalidateFinanceQueries(queryClient),
    ]);
}

export const useCreateOtherIncome = () => {
  const refresh = useRefreshAfterIncomeChange();
  return useMutation({
    mutationFn: createOtherIncomeFn,
    onSuccess: () => {
      void refresh();
      toast.success("Income recorded");
    },
    onError: (err: Error) => toast.error("Failed to record income", { description: err.message }),
  });
};

export const useVoidOtherIncome = () => {
  const refresh = useRefreshAfterIncomeChange();
  return useMutation({
    mutationFn: voidOtherIncomeFn,
    onSuccess: () => {
      void refresh();
      toast.success("Income voided");
    },
    onError: (err: Error) => toast.error("Failed to void income", { description: err.message }),
  });
};
```

- [ ] **Step 4: Write the page component**

Create `src/components/finance/other-income-page.tsx`:

```tsx
import Big from "big.js";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthSelector } from "@/components/ui/month-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useWallets } from "@/hooks/finance/use-finance";
import {
  useCreateOtherIncome,
  useOtherIncome,
  useOtherIncomeItemNames,
  useVoidOtherIncome,
} from "@/hooks/finance/use-other-income";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { hasPermission } from "@/lib/rbac";
import { datePickerKey, formatReportDate, reportDateKey } from "@/lib/report-dates";
import { cn } from "@/lib/utils";

type IncomeRow = NonNullable<ReturnType<typeof useOtherIncome>["data"]>["rows"][number];

const MIN_REASON_LENGTH = 3;

export function OtherIncomePage() {
  const [month, setMonth] = useState(() => reportDateKey(new Date()).slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<IncomeRow | null>(null);
  const { data, isLoading, error } = useOtherIncome(month);
  const { data: access } = useViewerAccess();
  const canManage = hasPermission(access?.permissions ?? [], "finance.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelector value={month} onChange={setMonth} />
        <p className="text-sm text-muted-foreground">
          Total this month:{" "}
          <span className="font-semibold text-foreground">{data ? formatRupees(data.total) : "—"}</span>
        </p>
        {canManage && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            + Add income
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load income. {error instanceof Error ? error.message : ""}
        </p>
      ) : isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No other income recorded this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>By</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const voided = row.voidedAt !== null;
                return (
                  <TableRow key={row.id} className={cn(voided && "text-muted-foreground")}>
                    <TableCell>{formatReportDate(row.incomeDate)}</TableCell>
                    <TableCell>
                      <span className={cn(voided && "line-through")}>{row.itemName}</span>
                      {voided && <p className="text-xs">Voided: {row.voidReason}</p>}
                      {!voided && row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(row.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupees(row.unitPrice)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", voided && "line-through")}>
                      {formatRupees(row.amount)}
                    </TableCell>
                    <TableCell>{row.walletName ?? "—"}</TableCell>
                    <TableCell>{row.recordedBy ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {!voided && (
                          <Button variant="ghost" size="sm" onClick={() => setVoiding(row)}>
                            Void
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddOtherIncomeSheet open={adding} onOpenChange={setAdding} />
      <VoidOtherIncomeDialog row={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function AddOtherIncomeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const listId = useId();
  const [date, setDate] = useState(() => datePickerKey(new Date()));
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");
  const { data: wallets = [] } = useWallets();
  const { data: itemNames = [] } = useOtherIncomeItemNames();
  const mutation = useCreateOtherIncome();

  const amount = (() => {
    try {
      const value = new Big(quantity || 0).times(unitPrice || 0).round(2);
      return value.gt(0) ? value.toFixed(2) : null;
    } catch {
      return null;
    }
  })();
  const isDirty = itemName !== "" || unitPrice !== "" || note !== "";

  const reset = () => {
    setDate(datePickerKey(new Date()));
    setItemName("");
    setQuantity("1");
    setUnitPrice("");
    setWalletId("");
    setNote("");
  };

  const save = () => {
    if (mutation.isPending) return;
    if (!itemName.trim()) return void toast.error("Please enter the item");
    if (!amount) return void toast.error("Quantity and price must be above zero");
    if (!walletId) return void toast.error("Please pick the account");
    mutation.mutate(
      {
        data: {
          incomeDate: date,
          itemName,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          walletId,
          note: note.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add income"
      description="Money received that is not a sale, like empty drums sold."
      isDirty={isDirty && !mutation.isPending}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="income-date">Date</Label>
          <Input id="income-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="income-item">Item</Label>
          <Input
            id="income-item"
            list={listId}
            value={itemName}
            maxLength={120}
            placeholder="e.g. SLES drum"
            onChange={(e) => setItemName(e.target.value)}
          />
          <datalist id={listId}>
            {itemNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="income-qty">Quantity</Label>
            <Input
              id="income-qty"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-price">Price each</Label>
            <Input
              id="income-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>
        </div>
        <p className="text-sm">
          Amount: <span className="font-semibold">{amount ? formatRupees(amount) : "—"}</span>
        </p>
        <div className="space-y-2">
          <Label>Received in</Label>
          <Select value={walletId} onValueChange={setWalletId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick account" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((wallet) => (
                <SelectItem key={wallet.id} value={wallet.id}>
                  {wallet.name} · {formatRupees(wallet.balance)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="income-note">Note</Label>
          <Textarea
            id="income-note"
            value={note}
            maxLength={500}
            placeholder="e.g. Sold to scrap dealer"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function VoidOtherIncomeDialog({ row, onClose }: { row: IncomeRow | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useVoidOtherIncome();

  const confirm = () => {
    if (!row || mutation.isPending) return;
    if (reason.trim().length < MIN_REASON_LENGTH) return void toast.error("Please give a reason");
    mutation.mutate(
      { data: { id: row.id, reason: reason.trim() } },
      {
        onSuccess: () => {
          setReason("");
          onClose();
        },
      },
    );
  };

  return (
    <AlertDialog
      open={row !== null}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        if (!next) {
          setReason("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this income?</AlertDialogTitle>
          <AlertDialogDescription>
            {row
              ? `${formatRupees(row.amount)} is taken back out of ${row.walletName ?? "its account"}. The entry stays in the list, struck through. This cannot be undone.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="income-void-reason">Reason</Label>
          <Textarea
            id="income-void-reason"
            value={reason}
            maxLength={500}
            placeholder="e.g. Entered twice by mistake"
            onChange={(e) => setReason(e.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={mutation.isPending}>
            {mutation.isPending ? "Voiding…" : "Void"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Write the route**

Create `src/routes/_protected/finance/other-income/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { OtherIncomePage } from "@/components/finance/other-income-page";

export const Route = createFileRoute("/_protected/finance/other-income/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col p-4 sm:p-8">
        <header className="border-b pb-8">
          <h1 className="text-3xl font-bold uppercase tracking-tighter">Other Income</h1>
          <p className="mt-2 text-muted-foreground">
            Money received that is not a sale, like empty drums or cartons sold.
          </p>
        </header>
        <div className="flex-1 py-8">
          <OtherIncomePage />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Add the sidebar item**

In `src/lib/constants.ts`, in the Finance `items` array, insert after the `Expenses` entry:

```ts
      {
        title: "Other Income",
        url: "/finance/other-income",
        icon: ExpensesIcon,
      },
```

`/finance/other-income` is already covered by the `finance.view` route rule in `src/lib/rbac.ts`; no RBAC change is needed.

- [ ] **Step 7: Run tests, typecheck, and try it**

Run: `bunx vitest run src/__tests__/other-income.test.ts && bun run typecheck`
Expected: PASS, no type errors.

Manual check: `bun run dev`, open `/finance/other-income`, add "SLES drum", qty 1, price 1500, Cash in hand. Expected: row appears, total Rs 1,500, Cash in hand balance up by Rs 1,500, Ledger shows an `Other Income` credit. Void it with a reason. Expected: struck-through row, balance back down.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/finance/use-other-income.ts src/components/finance/other-income-page.tsx src/routes/_protected/finance/other-income src/lib/constants.ts src/routeTree.gen.ts src/__tests__/other-income.test.ts
git commit -m "feat(finance): add Other Income page"
```

---

### Task 4: Monthly report math, labels and CSV

**Files:**
- Create: `src/lib/reports/monthly-report.ts`
- Test: `src/__tests__/monthly-report.test.ts`

**Interfaces:**
- Produces:
  - `type MonthKey = string` (`"YYYY-MM"`)
  - `fiscalYearMonths(startYear: number): MonthKey[]`
  - `fiscalYearStartFor(todayKey: string): number`
  - `fiscalYearRange(startYear: number): { from: string; to: string }`
  - `fiscalYearLabel(startYear: number): string`
  - `monthShortLabel(month: MonthKey): string`, `monthLongLabel(month: MonthKey): string`
  - `formatLac(value: number): string`
  - `addToMonth(bucket: Map<MonthKey, Big>, month: MonthKey, amount: Big | string | number): void`
  - `SYSTEM_EXPENSE_CATEGORY_SLUGS`, `reportExpenseCategories<T>(categories: T[], spent: Set<string>): T[]`
  - `interface MonthlyReportLine { key: string; label: string; months: (number | null)[]; total: number; sharePercent?: number; drillable: boolean }`
  - `interface MonthlyReport { startYear; label; months; currentMonth; sale; consumption; result; purchases; weight; summary }`
  - `interface MonthlyReportInput`, `buildMonthlyReport(input: MonthlyReportInput): MonthlyReport`
  - `monthlyReportCsv(report: MonthlyReport): string`, `csvCell(value: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/monthly-report.test.ts`:

```ts
import Big from "big.js";
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
    expect(raw.sharePercent).toBeCloseTo((628040 / 1248180) * 100, 1);
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
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts`
Expected: FAIL, cannot resolve `@/lib/reports/monthly-report`.

- [ ] **Step 3: Write the module**

Create `src/lib/reports/monthly-report.ts`:

```ts
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
      : Number(new Big(lineTotal).div(consumptionTotalLine.total).times(100).round(1).toFixed(1));
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
        line.sharePercent === undefined ? "" : line.sharePercent.toFixed(1),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/monthly-report.ts src/__tests__/monthly-report.test.ts
git commit -m "feat(reports): add monthly report math and CSV export"
```

---

### Task 5: Monthly report data loading

**Files:**
- Create: `src/server-functions/reports/monthly-report-queries.server.ts`
- Create: `src/server-functions/reports/monthly-report-fn.ts`
- Test: `src/__tests__/monthly-report.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 4; `otherIncome` from Task 1; existing tables `invoices`, `invoiceItems`, `customers`, `mixingRuns`, `mixingMaterialsUsed`, `formulas`, `packagingAllocations`, `recipes`, `failedProductionChemicalRecoveries`, `chemicals`, `packagingMaterials`, `payrolls`, `payslips`, `employees`, `expenses`, `expenseCategories`, `purchaseRecords`, `suppliers`.
- Produces:
  - `loadMonthlyReport(startYear: number, todayKey: string): Promise<MonthlyReport>`
  - `interface MonthlyReportDetailRow { date: string; reference: string; description: string; amount: number }`
  - `interface MonthlyReportDetail { title: string; unit: "rupees" | "kg"; rows: MonthlyReportDetailRow[]; total: number }`
  - `loadMonthlyReportDetail(line: string, month: MonthKey): Promise<MonthlyReportDetail>`
  - `getMonthlyReportFn({ data: { startYear: number } }) → MonthlyReport`
  - `getMonthlyReportDetailFn({ data: { line: string; month: string } }) → MonthlyReportDetail`

- [ ] **Step 1: Write the failing wiring tests**

Append to `src/__tests__/monthly-report.test.ts`:

```ts
import { readFileSync } from "node:fs";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts`
Expected: FAIL with ENOENT for the new server files.

- [ ] **Step 3: Write the query module**

Create `src/server-functions/reports/monthly-report-queries.server.ts`:

```ts
import Big from "big.js";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schemas/core-suppliers";
import { expenseCategories, expenses, otherIncome } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips } from "@/db/schemas/hr-schema";
import {
  chemicals,
  failedProductionChemicalRecoveries,
  packagingMaterials,
  recipes,
} from "@/db/schemas/inventory-schema";
import {
  formulas,
  mixingMaterialsUsed,
  mixingRuns,
  packagingAllocations,
} from "@/db/schemas/production-schema";
import { customers, invoiceItems, invoices } from "@/db/schemas/sales-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { reportDateBounds, reportDateKey, reportMonth } from "@/lib/report-dates";
import {
  addToMonth,
  buildMonthlyReport,
  fiscalYearRange,
  type MonthKey,
  type MonthlyReport,
  reportExpenseCategories,
} from "@/lib/reports/monthly-report";

export interface MonthlyReportDetailRow {
  /** Pakistan calendar day, "YYYY-MM-DD". */
  date: string;
  reference: string;
  description: string;
  amount: number;
}

export interface MonthlyReportDetail {
  title: string;
  unit: "rupees" | "kg";
  rows: MonthlyReportDetailRow[];
  total: number;
}

function instantBounds(from: string, to: string): { fromDate: Date; toDate: Date } {
  const { fromDate, toDate } = reportDateBounds({ dateFrom: from, dateTo: to });
  if (!fromDate || !toDate) throw new Error("Report dates are missing");
  return { fromDate, toDate };
}

const monthOf = (value: Date): MonthKey => reportDateKey(value).slice(0, 7);

function addDated(bucket: Map<MonthKey, Big>, value: Date | null, amount: string | null): void {
  if (value === null || amount === null) return;
  addToMonth(bucket, monthOf(value), amount);
}

export async function loadMonthlyReport(startYear: number, todayKey: string): Promise<MonthlyReport> {
  const range = fiscalYearRange(startYear);
  const { fromDate, toDate } = instantBounds(range.from, range.to);
  const savedInvoiceInYear = and(
    eq(invoices.status, "saved"),
    gte(invoices.date, fromDate),
    lte(invoices.date, toDate),
  );

  const [
    invoiceRows,
    weightRows,
    incomeRows,
    mixingRows,
    failedRows,
    packingRows,
    payrollRows,
    expenseRows,
    categoryRows,
    purchaseRows,
  ] = await Promise.all([
    db
      .select({ date: invoices.date, paid: invoices.paidAmount, outstanding: invoices.outstandingAmount })
      .from(invoices)
      .where(savedInvoiceInYear),
    db
      .select({ date: invoices.date, kg: sql<string>`coalesce(sum(${invoiceItems.totalWeight}), 0)` })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(savedInvoiceInYear)
      .groupBy(invoices.id, invoices.date),
    db
      .select({ date: otherIncome.incomeDate, amount: otherIncome.amount })
      .from(otherIncome)
      .where(
        and(
          isNull(otherIncome.voidedAt),
          gte(otherIncome.incomeDate, fromDate),
          lte(otherIncome.incomeDate, toDate),
        ),
      ),
    db
      .select({
        date: mixingRuns.actualCompletionDate,
        cost: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
      })
      .from(mixingMaterialsUsed)
      .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .where(
        and(
          eq(mixingRuns.status, "completed"),
          gte(mixingRuns.actualCompletionDate, fromDate),
          lte(mixingRuns.actualCompletionDate, toDate),
        ),
      )
      .groupBy(mixingRuns.id, mixingRuns.actualCompletionDate),
    db
      .select({
        date: failedProductionChemicalRecoveries.createdAt,
        cost: failedProductionChemicalRecoveries.lossAmount,
      })
      .from(failedProductionChemicalRecoveries)
      .where(
        and(
          gte(failedProductionChemicalRecoveries.createdAt, fromDate),
          lte(failedProductionChemicalRecoveries.createdAt, toDate),
        ),
      ),
    db
      .select({ date: packagingAllocations.completedAt, cost: packagingAllocations.totalPackagingCost })
      .from(packagingAllocations)
      .where(
        and(
          eq(packagingAllocations.status, "completed"),
          gte(packagingAllocations.completedAt, fromDate),
          lte(packagingAllocations.completedAt, toDate),
        ),
      ),
    db
      .select({ month: payrolls.month, gross: sql<string>`coalesce(sum(${payslips.grossSalary}), 0)` })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .where(
        and(
          inArray(payrolls.status, ["approved", "paid"]),
          gte(payrolls.month, range.from),
          lte(payrolls.month, range.to),
        ),
      )
      .groupBy(payrolls.id, payrolls.month),
    db
      .select({ categoryId: expenses.categoryId, date: expenses.expenseDate, amount: expenses.amount })
      .from(expenses)
      .where(
        and(isNull(expenses.voidedAt), gte(expenses.expenseDate, fromDate), lte(expenses.expenseDate, toDate)),
      ),
    db
      .select({
        id: expenseCategories.id,
        name: expenseCategories.name,
        slug: expenseCategories.slug,
        isActive: expenseCategories.isActive,
        isArchived: expenseCategories.isArchived,
      })
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name)),
    db
      .select({ type: purchaseRecords.materialType, date: purchaseRecords.purchaseDate, cost: purchaseRecords.cost })
      .from(purchaseRecords)
      .where(
        and(
          isNull(purchaseRecords.voidedAt),
          gte(purchaseRecords.purchaseDate, fromDate),
          lte(purchaseRecords.purchaseDate, toDate),
        ),
      ),
  ]);

  const cash = new Map<MonthKey, Big>();
  const credit = new Map<MonthKey, Big>();
  for (const row of invoiceRows) {
    addDated(cash, row.date, row.paid);
    addDated(credit, row.date, row.outstanding);
  }

  const weightKg = new Map<MonthKey, Big>();
  for (const row of weightRows) addDated(weightKg, row.date, row.kg);

  const byProduct = new Map<MonthKey, Big>();
  for (const row of incomeRows) addDated(byProduct, row.date, row.amount);

  const rawMaterial = new Map<MonthKey, Big>();
  for (const row of mixingRows) addDated(rawMaterial, row.date, row.cost);
  for (const row of failedRows) addDated(rawMaterial, row.date, row.cost);

  const packing = new Map<MonthKey, Big>();
  for (const row of packingRows) addDated(packing, row.date, row.cost);

  const salaries = new Map<MonthKey, Big>();
  for (const row of payrollRows) addToMonth(salaries, row.month.slice(0, 7), row.gross);

  const spentByCategory = new Map<string, Map<MonthKey, Big>>();
  for (const row of expenseRows) {
    let months = spentByCategory.get(row.categoryId);
    if (!months) {
      months = new Map();
      spentByCategory.set(row.categoryId, months);
    }
    addDated(months, row.date, row.amount);
  }
  const categories = reportExpenseCategories(categoryRows, new Set(spentByCategory.keys())).map(
    (category) => ({
      id: category.id,
      name: category.name,
      months: spentByCategory.get(category.id) ?? new Map<MonthKey, Big>(),
    }),
  );

  const purchaseRawMaterial = new Map<MonthKey, Big>();
  const purchasePacking = new Map<MonthKey, Big>();
  for (const row of purchaseRows) {
    if (row.type === "chemical") addDated(purchaseRawMaterial, row.date, row.cost);
    else if (row.type === "packaging") addDated(purchasePacking, row.date, row.cost);
  }

  return buildMonthlyReport({
    startYear,
    todayKey,
    cash,
    credit,
    byProduct,
    rawMaterial,
    packing,
    salaries,
    expenseCategories: categories,
    purchaseRawMaterial,
    purchasePacking,
    weightKg,
  });
}

function detail(
  title: string,
  unit: MonthlyReportDetail["unit"],
  rows: MonthlyReportDetailRow[],
): MonthlyReportDetail {
  const kept = rows.filter((row) => row.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const total = kept.reduce((sum, row) => sum.plus(row.amount), new Big(0));
  return { title, unit, rows: kept, total: Number(total.round(unit === "kg" ? 3 : 2).toString()) };
}

const money = (value: Big | string) => Number(new Big(value).round(2).toFixed(2));

/** The records behind one number of the monthly report. */
export async function loadMonthlyReportDetail(line: string, month: MonthKey): Promise<MonthlyReportDetail> {
  const { from, to } = reportMonth(`${month}-01`);
  const { fromDate, toDate } = instantBounds(from, to);
  const savedInvoiceInMonth = and(
    eq(invoices.status, "saved"),
    gte(invoices.date, fromDate),
    lte(invoices.date, toDate),
  );

  if (line === "cash" || line === "credit" || line === "weightTon") {
    if (line === "weightTon") {
      const rows = await db
        .select({
          date: invoices.date,
          number: invoices.invoiceNumber,
          customer: customers.name,
          kg: sql<string>`coalesce(sum(${invoiceItems.totalWeight}), 0)`,
        })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
        .where(savedInvoiceInMonth)
        .groupBy(invoices.id, invoices.date, invoices.invoiceNumber, customers.name);
      return detail(
        "Weight sold",
        "kg",
        rows.map((row) => ({
          date: reportDateKey(row.date),
          reference: row.number,
          description: row.customer,
          amount: Number(new Big(row.kg).round(3).toFixed(3)),
        })),
      );
    }

    const rows = await db
      .select({
        date: invoices.date,
        number: invoices.invoiceNumber,
        customer: customers.name,
        paid: invoices.paidAmount,
        outstanding: invoices.outstandingAmount,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(savedInvoiceInMonth);
    return detail(
      line === "cash" ? "Cash received" : "Credit (unpaid)",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.number,
        description: row.customer,
        amount: money(line === "cash" ? row.paid : row.outstanding),
      })),
    );
  }

  if (line === "byProduct") {
    const rows = await db
      .select({
        date: otherIncome.incomeDate,
        item: otherIncome.itemName,
        quantity: otherIncome.quantity,
        unitPrice: otherIncome.unitPrice,
        amount: otherIncome.amount,
      })
      .from(otherIncome)
      .where(
        and(
          isNull(otherIncome.voidedAt),
          gte(otherIncome.incomeDate, fromDate),
          lte(otherIncome.incomeDate, toDate),
        ),
      );
    return detail(
      "By-product",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: `${Number(row.quantity)} × ${Number(row.unitPrice)}`,
        description: row.item,
        amount: money(row.amount),
      })),
    );
  }

  if (line === "rawMaterial") {
    const [runs, losses] = await Promise.all([
      db
        .select({
          date: mixingRuns.actualCompletionDate,
          batch: mixingRuns.batchId,
          formula: formulas.name,
          cost: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)`,
        })
        .from(mixingMaterialsUsed)
        .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
        .innerJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
        .where(
          and(
            eq(mixingRuns.status, "completed"),
            gte(mixingRuns.actualCompletionDate, fromDate),
            lte(mixingRuns.actualCompletionDate, toDate),
          ),
        )
        .groupBy(mixingRuns.id, mixingRuns.actualCompletionDate, mixingRuns.batchId, formulas.name),
      db
        .select({
          date: failedProductionChemicalRecoveries.createdAt,
          batch: mixingRuns.batchId,
          chemical: chemicals.name,
          cost: failedProductionChemicalRecoveries.lossAmount,
        })
        .from(failedProductionChemicalRecoveries)
        .leftJoin(mixingRuns, eq(failedProductionChemicalRecoveries.mixingRunId, mixingRuns.id))
        .innerJoin(chemicals, eq(failedProductionChemicalRecoveries.chemicalId, chemicals.id))
        .where(
          and(
            gte(failedProductionChemicalRecoveries.createdAt, fromDate),
            lte(failedProductionChemicalRecoveries.createdAt, toDate),
          ),
        ),
    ]);
    return detail("Raw material", "rupees", [
      ...runs.flatMap((row) =>
        row.date
          ? [{ date: reportDateKey(row.date), reference: row.batch, description: row.formula, amount: money(row.cost) }]
          : [],
      ),
      ...losses.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.batch ?? "Failed batch",
        description: `Lost in failed batch: ${row.chemical}`,
        amount: money(row.cost),
      })),
    ]);
  }

  if (line === "packing") {
    const rows = await db
      .select({
        date: packagingAllocations.completedAt,
        batch: mixingRuns.batchId,
        recipe: recipes.name,
        cost: packagingAllocations.totalPackagingCost,
      })
      .from(packagingAllocations)
      .innerJoin(mixingRuns, eq(packagingAllocations.mixingRunId, mixingRuns.id))
      .leftJoin(recipes, eq(packagingAllocations.recipeId, recipes.id))
      .where(
        and(
          eq(packagingAllocations.status, "completed"),
          gte(packagingAllocations.completedAt, fromDate),
          lte(packagingAllocations.completedAt, toDate),
        ),
      );
    return detail(
      "Packing",
      "rupees",
      rows.flatMap((row) =>
        row.date && row.cost !== null
          ? [{ date: reportDateKey(row.date), reference: row.batch, description: row.recipe ?? "Packing", amount: money(row.cost) }]
          : [],
      ),
    );
  }

  if (line === "salaries") {
    const rows = await db
      .select({
        month: payrolls.month,
        firstName: employees.firstName,
        lastName: employees.lastName,
        gross: payslips.grossSalary,
      })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(
        and(inArray(payrolls.status, ["approved", "paid"]), gte(payrolls.month, from), lte(payrolls.month, to)),
      );
    return detail(
      "Salaries",
      "rupees",
      rows.map((row) => ({
        date: row.month,
        reference: "Payslip",
        description: `${row.firstName} ${row.lastName}`,
        amount: money(row.gross),
      })),
    );
  }

  if (line.startsWith("expense:")) {
    const categoryId = line.slice("expense:".length);
    const [category] = await db
      .select({ name: expenseCategories.name })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, categoryId));
    if (!category) throw new Error("Expense category not found");
    const rows = await db
      .select({
        date: expenses.expenseDate,
        description: expenses.description,
        payee: expenses.payee,
        slip: expenses.slipNumber,
        amount: expenses.amount,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.categoryId, categoryId),
          isNull(expenses.voidedAt),
          gte(expenses.expenseDate, fromDate),
          lte(expenses.expenseDate, toDate),
        ),
      );
    return detail(
      category.name,
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.slip ?? "",
        description: row.description || row.payee || category.name,
        amount: money(row.amount),
      })),
    );
  }

  if (line === "purchaseRawMaterial" || line === "purchasePacking") {
    const rows = await db
      .select({
        date: purchaseRecords.purchaseDate,
        invoiceNumber: purchaseRecords.invoiceNumber,
        chemical: chemicals.name,
        packaging: packagingMaterials.name,
        supplier: suppliers.supplierName,
        cost: purchaseRecords.cost,
      })
      .from(purchaseRecords)
      .leftJoin(chemicals, eq(purchaseRecords.chemicalId, chemicals.id))
      .leftJoin(packagingMaterials, eq(purchaseRecords.packagingMaterialId, packagingMaterials.id))
      .innerJoin(suppliers, eq(purchaseRecords.supplierId, suppliers.id))
      .where(
        and(
          eq(purchaseRecords.materialType, line === "purchaseRawMaterial" ? "chemical" : "packaging"),
          isNull(purchaseRecords.voidedAt),
          gte(purchaseRecords.purchaseDate, fromDate),
          lte(purchaseRecords.purchaseDate, toDate),
        ),
      );
    return detail(
      line === "purchaseRawMaterial" ? "Raw material bought" : "Packing bought",
      "rupees",
      rows.map((row) => ({
        date: reportDateKey(row.date),
        reference: row.invoiceNumber ?? "",
        description: `${row.chemical ?? row.packaging ?? "Material"} from ${row.supplier}`,
        amount: money(row.cost),
      })),
    );
  }

  throw new Error("This line has no records to show");
}
```

- [ ] **Step 4: Write the server functions**

Create `src/server-functions/reports/monthly-report-fn.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { reportDateKey } from "@/lib/report-dates";
import { loadMonthlyReport, loadMonthlyReportDetail } from "./monthly-report-queries.server";

export const getMonthlyReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator(z.object({ startYear: z.number().int().min(2000).max(2100) }))
  .handler(({ data }) => loadMonthlyReport(data.startYear, reportDateKey(new Date())));

export const getMonthlyReportDetailFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator(
    z.object({
      line: z.string().min(1).max(80),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month"),
    }),
  )
  .handler(({ data }) => loadMonthlyReportDetail(data.line, data.month));
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts && bun run typecheck`
Expected: PASS, no type errors. If typecheck reports a column name mismatch (for example `payslips.employeeId` or `employees.firstName`), open that table in `src/db/schemas/` and use the real column name. Do not change the schema.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/reports/monthly-report-queries.server.ts src/server-functions/reports/monthly-report-fn.ts src/__tests__/monthly-report.test.ts
git commit -m "feat(reports): load monthly report and drill-down records"
```

---

### Task 6: Monthly report page

**Files:**
- Create: `src/components/reports/monthly/monthly-report-table.tsx`
- Create: `src/components/reports/monthly/monthly-report-detail-sheet.tsx`
- Create: `src/routes/_protected/reports/monthly/index.tsx`
- Modify: `src/routes/_protected/reports/index.tsx` (`reportTypes` array)
- Test: `src/__tests__/monthly-report.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 helpers and types; Task 5 server functions; `ReportDocumentHeader`, `ReportPrintStyles`; `SummaryCard`, `SectionTitle`; `ResponsiveSheet`; `formatRupees`; `formatReportDate`.
- Produces: `MonthlyReportTable({ report, onCellClick })`; `MonthlyReportDetailSheet({ target, onClose })`; `type MonthlyReportCellTarget = { line: MonthlyReportLine; month: MonthKey }`; route `/reports/monthly`.

- [ ] **Step 1: Write the failing wiring tests**

Append to `src/__tests__/monthly-report.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts`
Expected: FAIL (hub card and files missing).

- [ ] **Step 3: Write the table**

Create `src/components/reports/monthly/monthly-report-table.tsx`:

```tsx
import { Fragment } from "react";
import {
  formatLac,
  monthShortLabel,
  type MonthlyReport,
  type MonthlyReportLine,
} from "@/lib/reports/monthly-report";
import { cn } from "@/lib/utils";

const TOTAL_KEYS = new Set(["totalSale", "totalConsumption", "difference", "withoutCredit"]);

interface Section {
  title: string;
  note?: string;
  lines: MonthlyReportLine[];
  showShare?: boolean;
  tons?: boolean;
}

export function MonthlyReportTable({
  report,
  onCellClick,
}: {
  report: MonthlyReport;
  onCellClick: (line: MonthlyReportLine, monthIndex: number) => void;
}) {
  const sections: Section[] = [
    { title: "Sale", lines: report.sale },
    { title: "Consumption", lines: report.consumption, showShare: true },
    { title: "Result", lines: report.result },
    { title: "Purchases", note: "shown for reference, not counted above", lines: report.purchases },
    { title: "Weight sold", note: "ton", lines: [report.weight], tons: true },
  ];
  const columnCount = report.months.length + 3;

  return (
    <div className="overflow-x-auto rounded-lg border print:overflow-visible print:rounded-none print:border-0">
      <table className="w-full min-w-[960px] border-collapse text-xs tabular-nums print:min-w-0 print:text-[7.5pt]">
        <thead>
          <tr className="border-b bg-muted">
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium print:static">
              Rs in lac
            </th>
            {report.months.map((month) => (
              <th key={month} className="px-2 py-2 text-right font-medium">
                {monthShortLabel(month)}
                {month === report.currentMonth ? "*" : ""}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-semibold">Total</th>
            <th className="px-2 py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.title}>
              <tr className="border-b bg-muted/40">
                <td
                  colSpan={columnCount}
                  className="sticky left-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground print:static"
                >
                  {section.title}
                  {section.note && <span className="ml-2 font-normal normal-case">({section.note})</span>}
                </td>
              </tr>
              {section.lines.map((line) => {
                const isTotal = TOTAL_KEYS.has(line.key);
                const show = (value: number) => (section.tons ? value.toFixed(2) : formatLac(value));
                return (
                  <tr key={line.key} className={cn("border-b last:border-0", isTotal && "font-semibold")}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-[inherit] print:static"
                    >
                      {line.label}
                    </th>
                    {line.months.map((value, index) => (
                      <td
                        key={report.months[index]}
                        className={cn(
                          "px-2 py-1.5 text-right",
                          value !== null && value < 0 && "text-rose-500 print:text-black print:underline",
                        )}
                      >
                        {value === null ? (
                          <span className="text-muted-foreground">–</span>
                        ) : line.drillable && value !== 0 ? (
                          <button
                            type="button"
                            className="hover:underline focus-visible:underline"
                            onClick={() => onCellClick(line, index)}
                          >
                            {show(value)}
                          </button>
                        ) : (
                          show(value)
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold">{show(line.total)}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {section.showShare && line.sharePercent !== undefined
                        ? `${Math.round(line.sharePercent)}%`
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Write the drill-down sheet**

Create `src/components/reports/monthly/monthly-report-detail-sheet.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { formatRupees } from "@/lib/finance/expense-entry";
import { formatReportDate } from "@/lib/report-dates";
import { type MonthKey, type MonthlyReportLine, monthLongLabel } from "@/lib/reports/monthly-report";
import { getMonthlyReportDetailFn } from "@/server-functions/reports/monthly-report-fn";

export interface MonthlyReportCellTarget {
  line: MonthlyReportLine;
  month: MonthKey;
}

export function MonthlyReportDetailSheet({
  target,
  onClose,
}: {
  target: MonthlyReportCellTarget | null;
  onClose: () => void;
}) {
  const { data, isFetching, error } = useQuery({
    queryKey: ["reports", "monthly", "detail", target?.line.key, target?.month],
    queryFn: () =>
      getMonthlyReportDetailFn({ data: { line: target!.line.key, month: target!.month } }),
    enabled: target !== null,
  });
  const show = (amount: number) =>
    data?.unit === "kg" ? `${amount.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : formatRupees(amount);

  return (
    <ResponsiveSheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={target ? `${target.line.label} · ${monthLongLabel(target.month)}` : "Details"}
      description="The records behind this number."
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load records. {error instanceof Error ? error.message : ""}
        </p>
      ) : isFetching || !data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No records.</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y rounded-lg border">
            {data.rows.map((row, index) => (
              <li key={`${row.date}-${row.reference}-${index}`} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatReportDate(row.date)}
                    {row.reference ? ` · ${row.reference}` : ""}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{show(row.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between text-sm font-semibold">
            <span>Total ({data.rows.length})</span>
            <span className="tabular-nums">{show(data.total)}</span>
          </p>
        </div>
      )}
    </ResponsiveSheet>
  );
}
```

- [ ] **Step 5: Write the page**

Create `src/routes/_protected/reports/monthly/index.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type MonthlyReportCellTarget,
  MonthlyReportDetailSheet,
} from "@/components/reports/monthly/monthly-report-detail-sheet";
import { MonthlyReportTable } from "@/components/reports/monthly/monthly-report-table";
import { ReportDocumentHeader, ReportPrintStyles } from "@/components/reports/report-document";
import { SummaryCard } from "@/components/reports/report-primitives";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportDateKey } from "@/lib/report-dates";
import {
  fiscalYearLabel,
  fiscalYearRange,
  fiscalYearStartFor,
  formatLac,
  monthlyReportCsv,
} from "@/lib/reports/monthly-report";
import { getMonthlyReportFn } from "@/server-functions/reports/monthly-report-fn";

const YEARS_SHOWN = 5;
const PRINT_CSS = "@media print { @page { size: A4 landscape; margin: 8mm; } }";

export const Route = createFileRoute("/_protected/reports/monthly/")({
  component: MonthlyReportPage,
});

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function MonthlyReportPage() {
  const [thisYear] = useState(() => fiscalYearStartFor(reportDateKey(new Date())));
  const [startYear, setStartYear] = useState(thisYear);
  const [cell, setCell] = useState<MonthlyReportCellTarget | null>(null);
  const { data: report, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["reports", "monthly", startYear],
    queryFn: () => getMonthlyReportFn({ data: { startYear } }),
  });
  const years = Array.from({ length: YEARS_SHOWN }, (_, index) => thisYear - index);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="print:hidden">
        <Link to="/reports" className="text-sm">
          Back to Reports
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Monthly Report</h1>
        <p className="text-sm text-muted-foreground">
          Sale, consumption and result for each month of the July–June year.
        </p>
        <div className="flex flex-wrap items-center gap-3 py-4">
          <Select value={String(startYear)} onValueChange={(value) => setStartYear(Number(value))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {fiscalYearLabel(year)} (Jul–Jun)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={!report || isFetching} onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="outline"
            disabled={!report || isFetching}
            onClick={() =>
              report && downloadCsv(`monthly-report-${report.label}.csv`, monthlyReportCsv(report))
            }
          >
            Excel
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="space-y-2 border p-5">
          <p>Report could not be loaded. {error instanceof Error ? error.message : ""}</p>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : !report ? (
        <p role="status">Generating report…</p>
      ) : (
        <div data-report-document className="report-content space-y-6 pb-8">
          <ReportDocumentHeader
            title="Monthly Report"
            scope={report.label}
            period={{ dateFrom: fiscalYearRange(report.startYear).from, dateTo: fiscalYearRange(report.startYear).to }}
            generatedAt={dataUpdatedAt}
            periodLabel="Financial year"
            basis="Sales by invoice date; credit is what is still unpaid today. Raw material and packing by batch completion date. Salaries by payroll month. Expenses by expense date, one row per expense category. Purchases are shown for reference and are not added to consumption."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 print:grid-cols-5">
            <SummaryCard label="Total sale (lac)" value={formatLac(report.summary.totalSale)} accentColor="emerald" />
            <SummaryCard label="Consumption (lac)" value={formatLac(report.summary.totalConsumption)} accentColor="amber" />
            <SummaryCard
              label="Difference (lac)"
              value={formatLac(report.summary.difference)}
              accentColor={report.summary.difference < 0 ? "rose" : "emerald"}
              highlight
            />
            <SummaryCard
              label="Without credit (lac)"
              value={formatLac(report.summary.withoutCredit)}
              accentColor={report.summary.withoutCredit < 0 ? "rose" : "emerald"}
              highlight
            />
            <SummaryCard label="Weight sold (ton)" value={report.summary.weightTon.toFixed(2)} accentColor="blue" />
          </div>
          <MonthlyReportTable
            report={report}
            onCellClick={(line, index) => setCell({ line, month: report.months[index] })}
          />
          <p className="text-xs text-muted-foreground">
            * current month, still running. – month not started yet. Click any number to see its records.
          </p>
        </div>
      )}

      <MonthlyReportDetailSheet target={cell} onClose={() => setCell(null)} />
      <ReportPrintStyles />
      <style>{PRINT_CSS}</style>
    </main>
  );
}
```

- [ ] **Step 6: Add the hub card**

In `src/routes/_protected/reports/index.tsx`, add `CalendarRange` to the `lucide-react` import, then insert this entry as the first item of `reportTypes`:

```ts
  {
    title: "Monthly Report",
    description: "One-page July–June summary: sale, consumption and result per month.",
    href: "/reports/monthly",
    icon: CalendarRange,
  },
```

- [ ] **Step 7: Run tests, typecheck and check the page**

Run: `bunx vitest run src/__tests__/monthly-report.test.ts && bun run typecheck`
Expected: PASS, no type errors.

Manual check with `bun run dev`:
1. Open `/reports`, then click "Monthly Report". Expected: the current year (2026-27) loads, Nov has `*`, Dec–Jun show `–`.
2. Create an expense category "Test Cat" in Finance → Expense Categories. Reload the report. Expected: a "Test Cat" row appears under Consumption.
3. Click a non-zero number. Expected: the side panel lists records whose total equals the cell.
4. Print preview. Expected: one landscape page.
5. Click Excel. Expected: `monthly-report-2026-27.csv` opens in Excel with correct columns.
6. Narrow the window to phone width. Expected: the row names stay put while the months scroll.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports/monthly src/routes/_protected/reports/monthly src/routes/_protected/reports/index.tsx src/routeTree.gen.ts src/__tests__/monthly-report.test.ts
git commit -m "feat(reports): add monthly report page"
```

---

### Task 7: Final verification

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `bun run test`
Expected: all tests pass. If an existing test counts occurrences in files this plan changed (for example `src/__tests__/finance-cache-invalidation.test.ts`), read it and fix the real cause. Do not weaken the assertion.

- [ ] **Step 2: Typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: both succeed.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: completes without errors.

- [ ] **Step 4: Commit any regenerated files**

```bash
git status
git add src/routeTree.gen.ts graphify-out
git commit -m "chore: refresh route tree and knowledge graph"
```

Skip the commit if `git status` shows nothing to add.
