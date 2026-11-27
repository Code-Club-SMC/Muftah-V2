# Supplier Returns and Debit Notes (Phase 7b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send bad or extra chemicals and packaging back to the supplier they were bought from, in three steps (Requested, Dispatched, Completed). Completing a return issues a numbered debit note that lowers what we owe on that purchase. Any amount above what we still owe comes back as cash, stays with the supplier as credit for later purchases, or is split between the two.

**Architecture:** One return belongs to one purchase, because a purchase holds exactly one material in one store and one price lot. Stock leaves that purchase's lot at **Dispatched**. The debit note is issued at **Completed**. A new `returned_amount` column on `purchase_records` sits next to `paid_amount`, so every place that works out what we owe becomes `cost − paid − returned` through one pure helper. Supplier credit is an append-only movement table: the balance is the sum of the rows. All write rules live in `src/lib/suppliers/supplier-returns.server.ts` as functions that take a transaction. The server functions only wrap them, so integration tests run the real rules inside `withRollback`.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, React + shadcn/ui, TanStack Query, TanStack Form, big.js, Vitest (jsdom behaviour tests + `vitest.integration.config.ts` against `titan_test`).

**Spec:** `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md`, Part A "Fix 7 — Supplier returns (debit notes)", delivery phase 7. The spec leaves the screens to "be designed after Fixes 1–6 ship". The decisions below are that design pass, agreed with the product owner on 2026-11-27.

## Global Constraints

- Generated migrations are immutable: never edit SQL, snapshots or `meta/_journal.json` under `src/db/migrations/`. Change the schema source and run `bun run db:generate`.
- Production has real data. Every new column is nullable or has a default. Old purchases have `returned_amount = 0` and behave exactly as before.
- Money maths uses `big.js` only. Money text uses `formatRupees` from `@/lib/finance/expense-entry` ("Rs 5,000").
- Quantities keep 3 decimals (`toFixed(3)`), money keeps 2 (`toFixed(2)`, half-up).
- Permissions: `suppliers.manage` can request, dispatch, complete, cancel and void returns and use supplier credit. `suppliers.view` can see returns, debit notes and supplier credit. No new permissions.
- Every purchase writer locks the purchase row (`.for("update")`) before it checks state. Material stock writers call `lockMaterialStock` before `moveLotStock`. Keep this order: purchase row first, then material stock.
- All reads that tests must see run inside the same transaction (the `tx` passed in). Never call top-level `db` inside `supplier-returns.server.ts`.
- Design principles from the spec apply: one primary button per state, smart defaults, show the money consequence before the click, every step can be undone (cancel before completion, void after).
- UI copy: "Return to supplier", "Request return", "Mark as dispatched", "Complete and issue debit note", "Cancel return", "Void debit note", "Supplier credit", "Use supplier credit", tabs "To dispatch", "Dispatched", "Done".
- Order booker self-service pages are not touched.
- Branch: `feat/supplier-returns-phase-7b` from `main` once phase 7a is merged, otherwise from `feat/expenses-phase-7a`.

## Decisions taken in the design pass (2026-11-27)

1. **Only chemicals and packaging can go back, against one purchase.** Suppliers sell us only these. Returned customer stock is finished goods we made ourselves, so phase 5's planned "Return to supplier" option on returned stock is **dropped**. There is no such option in the code today, so nothing needs removing.
2. **Three steps, as the spec says.** Requested (someone decides it goes back), Dispatched (goods leave the store), Completed (supplier accepts, debit note issued).
3. **Stock leaves at Dispatched**, not at Completed. Goods on a truck can't be used in production.
   Example: 100 kg Soda Ash bought from Ali Traders, 10 kg is bad. At "Mark as dispatched" the store drops from 100 kg to 90 kg. If the return is cancelled after that, the 10 kg goes back in.
4. **What can be returned** is whatever of that purchase is still in its own store: the smaller of the purchase's "stock left" (the number the purchase table already shows) and its lot's stock in the purchase's store, less quantities already requested but not yet dispatched.
   Example: bought 100 kg, used 70 kg in mixing. 30 kg left, so up to 30 kg can be returned. If a 10 kg request is already waiting, the most a new request can be is 20 kg.
5. **Purchases recorded before price lots existed** (no lot) and voided purchases can't be returned. The sheet says why and points to Adjust stock.
6. **Value of a return = quantity × the purchase's unit cost**, rounded to paisa. It is fixed when the return is requested. There is no "supplier accepted less" amount in this phase.
   Example: 10 kg at Rs 500/kg is Rs 5,000.
7. **Debit note on completion.** Numbers run DN-0001, DN-0002, … Returns get their own numbers from the request step: SR-0001, SR-0002, … Both counters reuse the existing `credit_note_counters` table with new ids `supplier_return` and `debit_note`.
8. **How the debit note is used, in order:**
   - First it lowers what we still owe on that purchase (`returned_amount` goes up by the applied part).
   - Anything above that is the **leftover**. On the Complete screen the person types how much cash the supplier is handing back (Rs 0 up to the leftover) and picks the account it goes into. The rest becomes **supplier credit**.
   - Example A, purchase unpaid: owe Rs 50,000, return Rs 5,000, now owe Rs 45,000. No leftover.
   - Example B, purchase fully paid: leftover Rs 5,000. Supplier gives Rs 2,000 cash into Cash in Hand; Rs 3,000 becomes supplier credit.
9. **Supplier credit is used when paying a later purchase** of the same supplier. The Record payment dialog shows "Supplier credit Rs 3,000 · Use supplier credit". Using it marks that much of the purchase as paid without touching any account and without recording an expense. It is saved as a supplier payment with method `supplier_credit` and no wallet.
10. **Cash back** goes into the chosen account as a wallet credit with source "Supplier Refund", the same source purchase deletion already uses. It is not other income and it does not change any expense.
11. **Cancel** works on Requested (nothing moved) and Dispatched (stock goes back into the same lot and store). It needs a reason.
12. **Void** works on Completed and needs a reason. Everything reverses, dated on the void day: stock back into the lot, `returned_amount` back down, the cash back taken out of the account again (the account may go below zero; the dialog says so), and the credit taken back. Void is **refused** when the supplier's credit balance is now smaller than the credit this return created, because some of it has already been spent.
    Example: return created Rs 3,000 credit, Rs 2,500 was used on a later payment, balance is Rs 500. Void is refused: "Rs 2,500 of this return's credit was already used on later payments, so it can't be voided."
13. **A purchase with a return that is Requested, Dispatched or Completed can't be edited or deleted.** Message: "This purchase has supplier return SR-0003. Cancel or void the return first." Cancelled and voided returns are removed together with the purchase if the purchase is deleted later.
14. **Deleting a purchase that was partly paid with supplier credit gives that credit back** to the supplier (a `use_reversed` credit row). Today the delete flow would silently drop it.
15. **Monthly report:** "Raw material bought" and "Packing bought" are reduced by completed debit notes in the month they were completed. The drill-down shows each one as a negative row: "Returned 10 kg Soda Ash to Ali Traders", reference "DN-0001". Voided debit notes are left out.
16. **Where it lives:** a "Return to supplier" action on each purchase row (menu), and a new **Returns** tab on the supplier page next to Recent Purchases and Recent Payments. The tab opens on work-queue chips: To dispatch, Dispatched, Done. The supplier page header shows "Supplier credit Rs 3,000" under the Outstanding Balance card when credit is above zero.
17. **Debit note print:** a print dialog like the sales credit note one, from the Done list.

Out of scope: taking cash later against existing supplier credit, returning finished goods, returning legacy purchases without a lot, the supplier accepting less than the full value, returning from a store other than the purchase's own store.

## File map

| Area | File | Responsibility |
|---|---|---|
| Pure rules | `src/lib/suppliers/supplier-returns.ts` (create) | Statuses, labels, queues, numbers, `purchaseOwed`, return value, max returnable, debit-note split, leftover plan |
| Pure rules tests | `src/lib/suppliers/supplier-returns.test.ts` (create) | Unit tests |
| Lot rules | `src/lib/inventory/material-lots.ts` (modify) | `PURCHASE_SOURCES` counts supplier-return movements |
| Lot writer | `src/lib/inventory/material-lots.server.ts` (modify) | `LotSourceType` gains `supplier_return`, `supplier_return_undo` |
| Stock left | `src/lib/suppliers/purchase-rows.server.ts` (modify) | `putInLot` nets supplier-return movements |
| Schema | `src/db/schemas/supplier-schema.ts` (modify) | `purchase_records.returned_amount`, `supplier_returns`, `supplier_credit_movements`, relations |
| Schema test | `src/db/schemas/supplier-returns-schema.test.ts` (create) | Column and check shape |
| Write rules | `src/lib/suppliers/supplier-returns.server.ts` (create) | Request, dispatch, complete, cancel, void, credit balance, use credit, guards, list/detail reads |
| Integration tests | `src/__tests__/integration/supplier-returns.test.ts` (create) | Real SQL through the rules |
| Server functions | `src/server-functions/suppliers/supplier-returns-fn.ts` (create) | `createServerFn` wrappers with middleware and activity log |
| Purchase guards | `src/server-functions/suppliers/update-purchase-record-fn.ts`, `delete-purchase-record-fn.ts` (modify) | Refuse with active return; give back credit on delete |
| Owed everywhere | `get-supplier-details-fn.ts`, `get-suppliers-fn.ts`, `get-supplier-paginated-outstanding-fn.ts`, `add-payment-fn.ts`, `src/server-functions/reports/purchases-report-fn.ts` (modify) | `cost − paid − returned`; supplier credit on details |
| Owed in UI | `src/routes/_protected/suppliers/$supplierId.tsx`, `$supplierId_.details.tsx`, `src/components/suppliers/purchase-history-table.tsx`, `purchase-details-dialog.tsx`, `payment-records-table.tsx`, `src/routes/_protected/reports/purchases/index.tsx` (modify) | Remaining uses `purchaseOwed`; credit payments labelled |
| Hooks | `src/hooks/suppliers/use-supplier-returns.ts` (create) | Queries, mutations, invalidation |
| Request sheet | `src/components/suppliers/request-supplier-return-sheet.tsx` (create) | Quantity, reason, value preview |
| Returns tab | `src/components/suppliers/supplier-returns-panel.tsx` (create) | Queue chips, rows, primary action per state |
| Dialogs | `src/components/suppliers/complete-supplier-return-dialog.tsx`, `supplier-return-reason-dialog.tsx`, `debit-note-print-dialog.tsx` (create) | Complete with cash back split; cancel/void reason; print |
| Payment dialog | `src/components/suppliers/record-payment-dialog.tsx` (modify) | "Use supplier credit" |
| Monthly report | `src/server-functions/reports/monthly-report-queries.server.ts` (modify) | Net debit notes off purchase lines; negative drill-down rows |
| Behaviour tests | `src/__tests__/supplier-return-sheet.behavior.test.tsx`, `supplier-returns-panel.behavior.test.tsx`, `supplier-credit-payment.behavior.test.tsx` (create) | UI behaviour |

---

### Task 1: Pure rules

**Files:**
- Create: `src/lib/suppliers/supplier-returns.ts`
- Test: `src/lib/suppliers/supplier-returns.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `SUPPLIER_RETURN_STATUSES`, `type SupplierReturnStatus`, `ACTIVE_SUPPLIER_RETURN_STATUSES`, `SUPPLIER_RETURN_STATUS_LABELS`
  - `type SupplierReturnQueue = "to_dispatch" | "dispatched" | "done"`, `QUEUE_STATUSES: Record<SupplierReturnQueue, SupplierReturnStatus[]>`
  - `formatSupplierReturnNumber(n: number): string`, `formatDebitNoteNumber(n: number): string`
  - `purchaseOwed(p: { cost: string; paidAmount: string | null; returnedAmount?: string | null }): Big`
  - `supplierReturnValue(quantity: string, unitCost: string): string`
  - `maxReturnable(input: { stockLeft: string; storeStock: string; pendingRequested: string }): string`
  - `splitDebitNote(input: { value: string; owed: Big | string }): { applied: string; leftover: string }`
  - `planLeftover(input: { leftover: string; cashBack?: string | null }): { refund: string; credit: string }`
  - `SUPPLIER_CREDIT_METHOD = "supplier_credit"`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/suppliers/supplier-returns.test.ts
import Big from "big.js";
import { describe, expect, it } from "vitest";
import {
  QUEUE_STATUSES,
  formatDebitNoteNumber,
  formatSupplierReturnNumber,
  maxReturnable,
  planLeftover,
  purchaseOwed,
  splitDebitNote,
  supplierReturnValue,
} from "./supplier-returns";

describe("supplier return numbers", () => {
  it("pads to four digits", () => {
    expect(formatSupplierReturnNumber(3)).toBe("SR-0003");
    expect(formatDebitNoteNumber(12)).toBe("DN-0012");
    expect(formatDebitNoteNumber(12345)).toBe("DN-12345");
  });
  it("refuses zero or fractions", () => {
    expect(() => formatDebitNoteNumber(0)).toThrow();
    expect(() => formatSupplierReturnNumber(1.5)).toThrow();
  });
});

describe("purchaseOwed", () => {
  it("is cost less paid less returned", () => {
    expect(purchaseOwed({ cost: "50000", paidAmount: "20000", returnedAmount: "5000" }).toFixed(2)).toBe("25000.00");
  });
  it("treats missing returned as zero and never goes below zero", () => {
    expect(purchaseOwed({ cost: "100", paidAmount: "40" }).toFixed(2)).toBe("60.00");
    expect(purchaseOwed({ cost: "100", paidAmount: "100", returnedAmount: "5" }).toFixed(2)).toBe("0.00");
  });
});

describe("supplierReturnValue", () => {
  it("is quantity times unit cost, rounded half-up to paisa", () => {
    expect(supplierReturnValue("10", "500")).toBe("5000.00");
    expect(supplierReturnValue("0.333", "10.05")).toBe("3.35");
  });
});

describe("maxReturnable", () => {
  it("is the smaller of stock left and store stock, less waiting requests", () => {
    expect(maxReturnable({ stockLeft: "30", storeStock: "45", pendingRequested: "10" })).toBe("20.000");
    expect(maxReturnable({ stockLeft: "30", storeStock: "12.5", pendingRequested: "0" })).toBe("12.500");
  });
  it("never goes below zero", () => {
    expect(maxReturnable({ stockLeft: "5", storeStock: "5", pendingRequested: "8" })).toBe("0.000");
  });
});

describe("splitDebitNote", () => {
  it("clears what is owed first", () => {
    expect(splitDebitNote({ value: "5000", owed: "45000" })).toEqual({ applied: "5000.00", leftover: "0.00" });
  });
  it("leaves the rest over when the purchase is paid", () => {
    expect(splitDebitNote({ value: "5000", owed: "1500" })).toEqual({ applied: "1500.00", leftover: "3500.00" });
    expect(splitDebitNote({ value: "5000", owed: new Big(0) })).toEqual({ applied: "0.00", leftover: "5000.00" });
  });
});

describe("planLeftover", () => {
  it("defaults to all credit", () => {
    expect(planLeftover({ leftover: "5000" })).toEqual({ refund: "0.00", credit: "5000.00" });
  });
  it("splits cash back and credit", () => {
    expect(planLeftover({ leftover: "5000", cashBack: "2000" })).toEqual({ refund: "2000.00", credit: "3000.00" });
  });
  it("refuses more cash than the leftover, or bad numbers", () => {
    expect(() => planLeftover({ leftover: "5000", cashBack: "5000.01" })).toThrow("Cash back can't be more than Rs 5,000");
    expect(() => planLeftover({ leftover: "5000", cashBack: "12.345" })).toThrow("at most 2 decimals");
    expect(() => planLeftover({ leftover: "0", cashBack: "1" })).toThrow();
  });
});

describe("queues", () => {
  it("maps statuses to the three chips", () => {
    expect(QUEUE_STATUSES.to_dispatch).toEqual(["requested"]);
    expect(QUEUE_STATUSES.dispatched).toEqual(["dispatched"]);
    expect(QUEUE_STATUSES.done).toEqual(["completed", "cancelled", "voided"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/lib/suppliers/supplier-returns.test.ts`
Expected: FAIL, cannot resolve `./supplier-returns`.

- [ ] **Step 3: Implement**

```ts
// src/lib/suppliers/supplier-returns.ts
import Big from "big.js";
import { formatRupees } from "@/lib/finance/expense-entry";

export const SUPPLIER_RETURN_STATUSES = ["requested", "dispatched", "completed", "cancelled", "voided"] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

/** Returns that still hold the purchase: it can't be edited or deleted while one exists. */
export const ACTIVE_SUPPLIER_RETURN_STATUSES = ["requested", "dispatched", "completed"] as const satisfies readonly SupplierReturnStatus[];

export const SUPPLIER_RETURN_STATUS_LABELS: Record<SupplierReturnStatus, string> = {
  requested: "Requested",
  dispatched: "Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  voided: "Voided",
};

export type SupplierReturnQueue = "to_dispatch" | "dispatched" | "done";
export const QUEUE_STATUSES: Record<SupplierReturnQueue, SupplierReturnStatus[]> = {
  to_dispatch: ["requested"],
  dispatched: ["dispatched"],
  done: ["completed", "cancelled", "voided"],
};

/** Supplier payment method for a payment made from supplier credit. It has no wallet. */
export const SUPPLIER_CREDIT_METHOD = "supplier_credit";

function padded(prefix: string, sequence: number) {
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error(`${prefix} sequence must be a positive integer`);
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}
export const formatSupplierReturnNumber = (n: number) => padded("SR", n);
export const formatDebitNoteNumber = (n: number) => padded("DN", n);

/** What we still owe on a purchase. Never below zero. */
export function purchaseOwed(p: { cost: string; paidAmount: string | null; returnedAmount?: string | null }): Big {
  const owed = new Big(p.cost || "0").minus(p.paidAmount || "0").minus(p.returnedAmount || "0");
  return owed.lt(0) ? new Big(0) : owed;
}

export function supplierReturnValue(quantity: string, unitCost: string): string {
  return new Big(quantity).times(unitCost).round(2, Big.roundHalfUp).toFixed(2);
}

export function maxReturnable(input: { stockLeft: string; storeStock: string; pendingRequested: string }): string {
  const left = new Big(input.stockLeft);
  const store = new Big(input.storeStock);
  const max = (left.lt(store) ? left : store).minus(input.pendingRequested);
  return (max.lt(0) ? new Big(0) : max).toFixed(3);
}

export function splitDebitNote(input: { value: string; owed: Big | string }): { applied: string; leftover: string } {
  const value = new Big(input.value);
  const owed = new Big(input.owed);
  const applied = value.lt(owed) ? value : owed;
  return { applied: applied.toFixed(2), leftover: value.minus(applied).toFixed(2) };
}

const MONEY = /^\d+(\.\d{1,2})?$/;

export function planLeftover(input: { leftover: string; cashBack?: string | null }): { refund: string; credit: string } {
  const leftover = new Big(input.leftover);
  const raw = input.cashBack?.trim() || "0";
  if (!MONEY.test(raw)) throw new Error("Cash back must be a number with at most 2 decimals");
  const refund = new Big(raw);
  if (refund.gt(leftover)) throw new Error(`Cash back can't be more than ${formatRupees(leftover.toFixed(2))}`);
  return { refund: refund.toFixed(2), credit: leftover.minus(refund).toFixed(2) };
}
```

`formatRupees` must render whole rupees as "Rs 5,000"; check with `bun run test` (the test's expected message relies on it). If it renders "Rs 5,000.00", change the expected text in the test to match `formatRupees("5000.00")`. The code stays as written.

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test src/lib/suppliers/supplier-returns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/suppliers/supplier-returns.ts src/lib/suppliers/supplier-returns.test.ts
git commit -m "feat(suppliers): rules for supplier returns and debit notes"
```

---

### Task 2: Schema, migration and lot movement types

**Files:**
- Modify: `src/db/schemas/supplier-schema.ts`
- Modify: `src/lib/inventory/material-lots.server.ts:9` (`LotSourceType`)
- Modify: `src/lib/inventory/material-lots.ts` (`PURCHASE_SOURCES`, around line 112)
- Modify: `src/lib/suppliers/purchase-rows.server.ts` (`putInLot`, around line 100)
- Create: `src/db/schemas/supplier-returns-schema.test.ts`
- Modify: `src/lib/inventory/material-lots.test.ts` (add one case)
- Generated: `src/db/migrations/*` via `bun run db:generate`

**Interfaces:**
- Produces: tables `supplierReturns`, `supplierCreditMovements`; column `purchaseRecords.returnedAmount`; relations `supplierReturnsRelations`, `supplierCreditMovementsRelations`; `LotSourceType` values `"supplier_return" | "supplier_return_undo"`. Supplier-return lot movements always use `sourceId = purchase.id`.

- [ ] **Step 1: Write the failing schema test**

```ts
// src/db/schemas/supplier-returns-schema.test.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { purchaseRecords, supplierCreditMovements, supplierReturns } from "./supplier-schema";

const col = (config: ReturnType<typeof getTableConfig>, name: string) => config.columns.find((c) => c.name === name);

describe("supplier returns schema", () => {
  it("adds returned_amount to purchases with a default, so old rows owe the same", () => {
    const config = getTableConfig(purchaseRecords);
    expect(col(config, "returned_amount")?.notNull).toBe(true);
    expect(col(config, "returned_amount")?.default).toBe("0");
    expect(config.checks.map((c) => c.name)).toContain("purchase_returned_amount_ck");
  });

  it("keeps one return per purchase with lifecycle, debit note and money split", () => {
    const config = getTableConfig(supplierReturns);
    expect(config.name).toBe("supplier_returns");
    for (const name of ["return_number", "supplier_id", "purchase_id", "warehouse_id", "lot_id", "quantity", "unit_cost", "total_amount", "reason", "status", "requested_by_id"]) {
      expect(col(config, name)?.notNull, name).toBe(true);
    }
    for (const name of ["debit_note_number", "dispatched_at", "completed_at", "refund_wallet_id", "refund_transaction_id", "cancelled_at", "voided_at"]) {
      expect(col(config, name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name)).toEqual(expect.arrayContaining([
      "supplier_returns_status_ck",
      "supplier_returns_quantity_ck",
      "supplier_returns_debit_note_ck",
      "supplier_returns_refund_wallet_ck",
    ]));
    expect(config.indexes.map((i) => i.config.name)).toEqual(expect.arrayContaining([
      "supplier_returns_number_unique_idx",
      "supplier_returns_debit_note_unique_idx",
      "supplier_returns_supplier_status_idx",
      "supplier_returns_purchase_idx",
    ]));
  });

  it("logs supplier credit as signed movements", () => {
    const config = getTableConfig(supplierCreditMovements);
    expect(config.name).toBe("supplier_credit_movements");
    expect(col(config, "amount")?.notNull).toBe(true);
    expect(config.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["supplier_credit_kind_ck", "supplier_credit_sign_ck"]));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/db/schemas/supplier-returns-schema.test.ts`
Expected: FAIL, `supplierReturns` is not exported.

- [ ] **Step 3: Add the schema**

In `src/db/schemas/supplier-schema.ts`:

1. Extend imports:

```ts
import { boolean, check, decimal, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { warehouses, chemicals, materialLots, packagingMaterials, chemicalLabReports } from "./inventory-schema";
import { wallets, transactions } from "./finance-schema";
```

2. In `purchaseRecords` columns, directly after `paidAmount`:

```ts
    // Debit notes from completed supplier returns that lowered what we owe on THIS purchase.
    returnedAmount: decimal("returned_amount", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
```

and in its table callback add:

```ts
    returnedAmountNotNegative: check("purchase_returned_amount_ck", sql`${t.returnedAmount} >= 0`),
```

3. After `purchaseRecords`, add:

```ts
// --- SUPPLIER RETURNS (one per purchase line; debit note on completion) ---
export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    returnNumber: text("return_number").notNull(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    // Cancelled and voided returns go with the purchase if it is deleted; active ones block the delete.
    purchaseId: text("purchase_id").notNull().references(() => purchaseRecords.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    lotId: text("lot_id").notNull().references(() => materialLots.id),
    materialType: text("material_type").notNull(), // "chemical" | "packaging"
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(() => packagingMaterials.id),
    quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
    unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
    totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("requested"),
    requestedById: text("requested_by_id").notNull().references(() => user.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedById: text("dispatched_by_id").references(() => user.id),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedById: text("completed_by_id").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    debitNoteNumber: text("debit_note_number"),
    appliedToPurchaseAmount: decimal("applied_to_purchase_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    refundWalletId: text("refund_wallet_id").references(() => wallets.id),
    refundTransactionId: text("refund_transaction_id").references(() => transactions.id),
    supplierCreditAmount: decimal("supplier_credit_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    cancelledById: text("cancelled_by_id").references(() => user.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    voidedById: text("voided_by_id").references(() => user.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => ({
    numberUnique: uniqueIndex("supplier_returns_number_unique_idx").on(t.returnNumber),
    debitNoteUnique: uniqueIndex("supplier_returns_debit_note_unique_idx").on(t.debitNoteNumber).where(sql`${t.debitNoteNumber} IS NOT NULL`),
    supplierStatusIdx: index("supplier_returns_supplier_status_idx").on(t.supplierId, t.status, t.requestedAt),
    purchaseIdx: index("supplier_returns_purchase_idx").on(t.purchaseId),
    statusCheck: check("supplier_returns_status_ck", sql`${t.status} IN ('requested', 'dispatched', 'completed', 'cancelled', 'voided')`),
    quantityCheck: check("supplier_returns_quantity_ck", sql`${t.quantity} > 0 AND ${t.unitCost} >= 0 AND ${t.totalAmount} >= 0`),
    debitNoteCheck: check("supplier_returns_debit_note_ck", sql`${t.status} NOT IN ('completed', 'voided') OR (
      ${t.debitNoteNumber} IS NOT NULL AND ${t.completedAt} IS NOT NULL
      AND ${t.appliedToPurchaseAmount} + ${t.refundAmount} + ${t.supplierCreditAmount} = ${t.totalAmount})`),
    refundWalletCheck: check("supplier_returns_refund_wallet_ck", sql`(${t.refundAmount} = 0 AND ${t.refundWalletId} IS NULL) OR (${t.refundAmount} > 0 AND ${t.refundWalletId} IS NOT NULL)`),
  }),
);

// --- SUPPLIER CREDIT (append-only; balance = sum of amount) ---
// issued: debit note leftover kept with the supplier (+)
// used: paid part of a purchase from credit (−)
// use_reversed: that purchase was deleted, credit given back (+)
// issue_reversed: the debit note was voided (−)
export const supplierCreditMovements = pgTable(
  "supplier_credit_movements",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    kind: text("kind").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    supplierReturnId: text("supplier_return_id").references(() => supplierReturns.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id").references(() => purchaseRecords.id, { onDelete: "set null" }),
    supplierPaymentId: text("supplier_payment_id").references(() => supplierPayments.id, { onDelete: "set null" }),
    note: text("note"),
    performedById: text("performed_by_id").notNull().references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    supplierIdx: index("supplier_credit_supplier_idx").on(t.supplierId, t.createdAt),
    kindCheck: check("supplier_credit_kind_ck", sql`${t.kind} IN ('issued', 'used', 'use_reversed', 'issue_reversed')`),
    signCheck: check("supplier_credit_sign_ck", sql`(${t.kind} IN ('issued', 'use_reversed') AND ${t.amount} > 0) OR (${t.kind} IN ('used', 'issue_reversed') AND ${t.amount} < 0)`),
  }),
);
```

4. Relations. Add `returns: many(supplierReturns)` and `creditMovements: many(supplierCreditMovements)` to `suppliersRelations`; add `returns: many(supplierReturns)` to `purchaseRecordsRelations`; then append:

```ts
export const supplierReturnsRelations = relations(supplierReturns, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierReturns.supplierId], references: [suppliers.id] }),
  purchase: one(purchaseRecords, { fields: [supplierReturns.purchaseId], references: [purchaseRecords.id] }),
  warehouse: one(warehouses, { fields: [supplierReturns.warehouseId], references: [warehouses.id] }),
  chemical: one(chemicals, { fields: [supplierReturns.chemicalId], references: [chemicals.id] }),
  packagingMaterial: one(packagingMaterials, { fields: [supplierReturns.packagingMaterialId], references: [packagingMaterials.id] }),
  refundWallet: one(wallets, { fields: [supplierReturns.refundWalletId], references: [wallets.id], relationName: "supplierReturnRefundWallet" }),
  requestedBy: one(user, { fields: [supplierReturns.requestedById], references: [user.id], relationName: "supplierReturnRequestedBy" }),
}));

export const supplierCreditMovementsRelations = relations(supplierCreditMovements, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierCreditMovements.supplierId], references: [suppliers.id] }),
  supplierReturn: one(supplierReturns, { fields: [supplierCreditMovements.supplierReturnId], references: [supplierReturns.id] }),
}));
```

- [ ] **Step 4: Make supplier-return lot movements count as the purchase's own stock**

`src/lib/inventory/material-lots.server.ts` line 9:

```ts
export type LotSourceType = "opening" | "purchase" | "purchase_edit" | "purchase_delete" | "transfer_out" | "transfer_in" | "mixing" | "mixing_return" | "packing" | "recovery" | "adjustment" | "warehouse_close" | "supplier_return" | "supplier_return_undo";
```

Update the comment above `materialLotMovements.sourceType` in `inventory-schema.ts` to list the two new values (comment only; the column is plain text).

`src/lib/inventory/material-lots.ts`:

```ts
// A supplier return takes stock out of what its purchase brought in (and an undo puts it back),
// so it changes "purchased" as well as the balance and never makes a purchase look used.
const PURCHASE_SOURCES = new Set(["purchase", "purchase_edit", "purchase_delete", "supplier_return", "supplier_return_undo"]);
```

`src/lib/suppliers/purchase-rows.server.ts`, in `putInLot`:

```ts
    and moved.source_type in ('purchase', 'purchase_edit', 'supplier_return', 'supplier_return_undo')
```

Add to `src/lib/inventory/material-lots.test.ts`, inside the existing `purchaseUntouched` describe (or a new one if none):

```ts
it("stays untouched when only a supplier return took stock out and put it back", () => {
  expect(purchaseUntouched({ balanceNow: "100", movements: [
    { delta: "100", sourceType: "purchase" },
    { delta: "-10", sourceType: "supplier_return" },
    { delta: "10", sourceType: "supplier_return_undo" },
  ] })).toBe(true);
  expect(purchaseUntouched({ balanceNow: "80", movements: [
    { delta: "100", sourceType: "purchase" },
    { delta: "-10", sourceType: "supplier_return" },
    { delta: "-10", sourceType: "mixing" },
  ] })).toBe(false);
});
```

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate`
Expected: one new migration that adds `returned_amount` with default 0, creates both tables, checks and indexes. Read the SQL; do not edit it. If it contains anything unrelated, stop and report.

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test src/db/schemas/supplier-returns-schema.test.ts src/lib/inventory/material-lots.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/schemas/supplier-schema.ts src/db/schemas/inventory-schema.ts src/db/schemas/supplier-returns-schema.test.ts src/lib/inventory/material-lots.ts src/lib/inventory/material-lots.server.ts src/lib/inventory/material-lots.test.ts src/lib/suppliers/purchase-rows.server.ts src/db/migrations
git commit -m "feat(suppliers): tables for supplier returns, debit notes and supplier credit"
```

---

### Task 3: Request, returnable quantity and cancel before dispatch

**Files:**
- Create: `src/lib/suppliers/supplier-returns.server.ts`
- Create: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Consumes: Task 1 rules; Task 2 tables; `purchaseStockLeft(reader, records)` from `@/lib/suppliers/purchase-rows.server`; `creditNoteCounters` from `@/db/schemas/sales-erp-schema`; `Tx` from `@/lib/inventory/material-lots.server`.
- Produces:
  - `allocateCounterNumber(tx: Tx, counterId: "supplier_return" | "debit_note"): Promise<number>`
  - `returnableForPurchase(tx: Tx, purchaseId: string): Promise<Returnable>` where `Returnable = { purchaseId: string; supplierId: string; supplierName: string; materialName: string; unit: string; warehouseName: string; unitCost: string; stockLeft: string; pendingRequested: string; max: string; blockedReason: string | null }`
  - `requestSupplierReturn(tx: Tx, input: { purchaseId: string; quantity: string; reason: string; notes?: string | null }, actorId: string): Promise<{ id: string; returnNumber: string; totalAmount: string }>`
  - `cancelSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string): Promise<{ returnNumber: string; stockRestored: boolean }>` (this task handles Requested; Task 4 adds Dispatched)
  - `lockReturn(tx: Tx, returnId: string)` (internal helper, exported for tests)

- [ ] **Step 1: Write the failing integration tests**

```ts
// src/__tests__/integration/supplier-returns.test.ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { chemicals, materialStock, purchaseRecords, suppliers, user, warehouses } from "@/db";
import { supplierReturns } from "@/db/schemas/supplier-schema";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { cancelSupplierReturn, requestSupplierReturn, returnableForPurchase } from "@/lib/suppliers/supplier-returns.server";
import { withRollback } from "./with-rollback";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown };
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

export async function supplierReturnFixture(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: `${id}-Ali Traders` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "500" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const buy = async (quantity: string, cost: string) => {
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
    const rows = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    return rows.sort((a, b) => +b.createdAt - +a.createdAt)[0];
  };
  const stock = async () => {
    const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, floor.id), eq(materialStock.chemicalId, soda.id)));
    return row?.quantity ?? "0";
  };
  return { actor, floor, supplier, soda, context, buy, stock };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: request", () => {
  it("offers what is left of the purchase in its store and values the request at the purchase price", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const returnable = await returnableForPurchase(tx, purchase.id);
    expect(returnable).toMatchObject({ max: "100.000", unitCost: "500.00", blockedReason: null });

    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Lumpy, wet bags" }, actor.id);
    expect(created.returnNumber).toMatch(/^SR-\d{4,}$/);
    expect(created.totalAmount).toBe("5000.00");
    expect((await returnableForPurchase(tx, purchase.id)).max).toBe("90.000");
  }));

  it("refuses more than is returnable, zero, and voided or legacy purchases", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    await expect(requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "100.001", reason: "x" }, actor.id))
      .rejects.toThrow("Only 100 kg of this purchase can be returned");
    await expect(requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "0", reason: "x" }, actor.id)).rejects.toThrow();
    await tx.update(purchaseRecords).set({ lotId: null }).where(eq(purchaseRecords.id, purchase.id));
    expect((await returnableForPurchase(tx, purchase.id)).blockedReason).toContain("before price lots");
  }));

  it("cancels a request without moving stock", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    const result = await cancelSupplierReturn(tx, { returnId: created.id, reason: "Supplier took it back as replacement" }, actor.id);
    expect(result.stockRestored).toBe(false);
    expect(await stock()).toBe("100.000");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("cancelled");
    expect((await returnableForPurchase(tx, purchase.id)).max).toBe("100.000");
  }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/titan_test bunx vitest run -c vitest.integration.config.ts src/__tests__/integration/supplier-returns.test.ts`
(Use the same `TEST_DATABASE_URL` the other integration suites use; check `.env` or `docs` if the credentials differ.)
Expected: FAIL, cannot resolve `@/lib/suppliers/supplier-returns.server`.

- [ ] **Step 3: Implement**

```ts
// src/lib/suppliers/supplier-returns.server.ts
import Big from "big.js";
import { and, eq, sql } from "drizzle-orm";
import { chemicals, materialLotStock, packagingMaterials, purchaseRecords, suppliers, warehouses } from "@/db";
import { creditNoteCounters } from "@/db/schemas/sales-erp-schema";
import { supplierReturns } from "@/db/schemas/supplier-schema";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { packagingUnit } from "@/lib/inventory/material-units";
import { purchaseStockLeft } from "@/lib/suppliers/purchase-rows.server";
import {
  formatDebitNoteNumber,
  formatSupplierReturnNumber,
  maxReturnable,
  supplierReturnValue,
} from "./supplier-returns";

export type Returnable = {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  materialName: string;
  unit: string;
  warehouseName: string;
  unitCost: string;
  stockLeft: string;
  pendingRequested: string;
  max: string;
  blockedReason: string | null;
};

/** Shares the credit-note counter table; each series has its own row id. */
export async function allocateCounterNumber(tx: Tx, counterId: "supplier_return" | "debit_note"): Promise<number> {
  await tx.insert(creditNoteCounters).values({ id: counterId, lastNumber: 0 }).onConflictDoNothing();
  const [counter] = await tx.select().from(creditNoteCounters).where(eq(creditNoteCounters.id, counterId)).for("update");
  const next = Number(counter?.lastNumber ?? 0) + 1;
  await tx.update(creditNoteCounters).set({ lastNumber: next, updatedAt: new Date() }).where(eq(creditNoteCounters.id, counterId));
  return next;
}

export const nextSupplierReturnNumber = async (tx: Tx) => formatSupplierReturnNumber(await allocateCounterNumber(tx, "supplier_return"));
export const nextDebitNoteNumber = async (tx: Tx) => formatDebitNoteNumber(await allocateCounterNumber(tx, "debit_note"));

const trimQty = (value: string) => new Big(value).toString(); // "100.000" -> "100" for messages

async function loadPurchase(tx: Tx, purchaseId: string, lock: boolean) {
  const base = tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchaseId));
  const [purchase] = lock ? await base.for("update") : await base;
  if (!purchase) throw new Error("Purchase record not found");
  return purchase;
}

async function describePurchase(tx: Tx, purchase: typeof purchaseRecords.$inferSelect) {
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, purchase.supplierId));
  const [store] = await tx.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, purchase.warehouseId));
  let materialName = "Material";
  let unit = "units";
  if (purchase.chemicalId) {
    const [row] = await tx.select({ name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, purchase.chemicalId));
    materialName = row?.name ?? materialName;
    unit = row?.unit ?? "kg";
  } else if (purchase.packagingMaterialId) {
    const [row] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, purchase.packagingMaterialId));
    if (row) {
      materialName = row.name;
      unit = packagingUnit(row);
    }
  }
  return { supplierName: supplier?.name ?? "Supplier", warehouseName: store?.name ?? "Store", materialName, unit };
}

/** Quantity of this purchase already asked for but not yet taken out of stock. */
async function pendingRequested(tx: Tx, purchaseId: string, exceptReturnId?: string) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierReturns.quantity}), 0)` })
    .from(supplierReturns)
    .where(and(
      eq(supplierReturns.purchaseId, purchaseId),
      eq(supplierReturns.status, "requested"),
      exceptReturnId ? sql`${supplierReturns.id} <> ${exceptReturnId}` : undefined,
    ));
  return new Big(row?.total ?? 0).toFixed(3);
}

async function storeLotStock(tx: Tx, lotId: string, warehouseId: string) {
  const [row] = await tx.select({ quantity: materialLotStock.quantity }).from(materialLotStock)
    .where(and(eq(materialLotStock.lotId, lotId), eq(materialLotStock.warehouseId, warehouseId)));
  return row?.quantity ?? "0";
}

async function returnableFor(tx: Tx, purchase: typeof purchaseRecords.$inferSelect, exceptReturnId?: string): Promise<Returnable> {
  const info = await describePurchase(tx, purchase);
  const base = { purchaseId: purchase.id, supplierId: purchase.supplierId, ...info, unitCost: new Big(purchase.unitCost).toFixed(2) };
  const blocked = (blockedReason: string): Returnable => ({ ...base, stockLeft: "0.000", pendingRequested: "0.000", max: "0.000", blockedReason });
  if (purchase.voidedAt) return blocked("A voided purchase can't be returned.");
  if (!purchase.lotId) return blocked("This purchase was recorded before price lots, so it can't be returned here. Use Adjust stock instead.");

  const left = (await purchaseStockLeft(tx, [purchase])).get(purchase.id) ?? 0;
  const stockLeft = new Big(left ?? 0).toFixed(3);
  const pending = await pendingRequested(tx, purchase.id, exceptReturnId);
  const max = maxReturnable({ stockLeft, storeStock: await storeLotStock(tx, purchase.lotId, purchase.warehouseId), pendingRequested: pending });
  return { ...base, stockLeft, pendingRequested: pending, max, blockedReason: new Big(max).gt(0) ? null : `Nothing of this purchase is left in ${info.warehouseName} to return.` };
}

export async function returnableForPurchase(tx: Tx, purchaseId: string): Promise<Returnable> {
  return returnableFor(tx, await loadPurchase(tx, purchaseId, false));
}

const QTY = /^\d+(\.\d{1,3})?$/;

export async function requestSupplierReturn(
  tx: Tx,
  input: { purchaseId: string; quantity: string; reason: string; notes?: string | null },
  actorId: string,
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Say why the goods are going back");
  if (!QTY.test(input.quantity) || new Big(input.quantity).lte(0)) throw new Error("Enter a quantity above 0 with at most 3 decimals");

  const purchase = await loadPurchase(tx, input.purchaseId, true);
  const returnable = await returnableFor(tx, purchase);
  if (returnable.blockedReason) throw new Error(returnable.blockedReason);
  const quantity = new Big(input.quantity);
  if (quantity.gt(returnable.max)) {
    throw new Error(`Only ${trimQty(returnable.max)} ${returnable.unit} of this purchase can be returned`);
  }

  const returnNumber = await nextSupplierReturnNumber(tx);
  const totalAmount = supplierReturnValue(quantity.toFixed(3), purchase.unitCost);
  const [created] = await tx.insert(supplierReturns).values({
    returnNumber,
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    warehouseId: purchase.warehouseId,
    lotId: purchase.lotId!,
    materialType: purchase.materialType,
    chemicalId: purchase.chemicalId,
    packagingMaterialId: purchase.packagingMaterialId,
    quantity: quantity.toFixed(3),
    unitCost: new Big(purchase.unitCost).toFixed(2),
    totalAmount,
    reason,
    notes: input.notes?.trim() || null,
    requestedById: actorId,
  }).returning({ id: supplierReturns.id });
  return { id: created.id, returnNumber, totalAmount };
}

/** Locks the purchase first, then the return (the purchase-writer lock order). */
export async function lockReturn(tx: Tx, returnId: string) {
  const [peek] = await tx.select({ purchaseId: supplierReturns.purchaseId }).from(supplierReturns).where(eq(supplierReturns.id, returnId));
  if (!peek) throw new Error("Supplier return not found");
  const purchase = await loadPurchase(tx, peek.purchaseId, true);
  const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, returnId)).for("update");
  return { row, purchase };
}

export async function cancelSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required");
  const { row } = await lockReturn(tx, input.returnId);
  if (row.status !== "requested" && row.status !== "dispatched") {
    throw new Error(row.status === "completed" ? "This return is completed. Void the debit note instead." : `This return is already ${row.status}.`);
  }
  const stockRestored = row.status === "dispatched";
  // Task 4 puts dispatched stock back here.
  await tx.update(supplierReturns)
    .set({ status: "cancelled", cancelledById: actorId, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));
  return { returnNumber: row.returnNumber, stockRestored };
}
```

- [ ] **Step 4: Run to verify it passes**

Run the Step 2 command again.
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): request and cancel a supplier return"
```

---

### Task 4: Dispatch takes stock out; cancel after dispatch puts it back

**Files:**
- Modify: `src/lib/suppliers/supplier-returns.server.ts`
- Modify: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Consumes: `lockMaterialStock`, `moveLotStock` from `@/lib/inventory/material-lots.server`; `inventoryAuditLog` from `@/db`.
- Produces: `dispatchSupplierReturn(tx: Tx, input: { returnId: string }, actorId: string): Promise<{ returnNumber: string; quantity: string }>`; internal `moveReturnStock(tx, row, direction: "out" | "back", actorId, why: string)` used by Tasks 4 and 6.

- [ ] **Step 1: Add failing tests** (append to the integration file, add `dispatchSupplierReturn` to the import)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: dispatch", () => {
  it("takes the stock out of the purchase's lot when dispatched", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    expect(await stock()).toBe("90.000");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("dispatched");
    expect(row.dispatchedById).toBe(actor.id);
    // The purchase table's "stock left" for this purchase drops too.
    expect((await returnableForPurchase(tx, purchase.id)).stockLeft).toBe("90.000");
  }));

  it("puts the stock back when a dispatched return is cancelled", () => withRollback(async (tx) => {
    const { actor, buy, stock } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    const result = await cancelSupplierReturn(tx, { returnId: created.id, reason: "Truck turned back" }, actor.id);
    expect(result.stockRestored).toBe(true);
    expect(await stock()).toBe("100.000");
  }));

  it("refuses to dispatch twice or when the stock was used meanwhile", () => withRollback(async (tx) => {
    const { actor, buy, floor, soda } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    // Simulate production using 95 kg of the lot after the request.
    const { moveLotStock } = await import("@/lib/inventory/material-lots.server");
    await moveLotStock(tx, { ref: { materialType: "chemical", materialId: soda.id }, lotId: purchase.lotId!, warehouseId: floor.id, delta: "-95", sourceType: "mixing" });
    await expect(dispatchSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("Only 5 kg of this purchase is left to send back");
    await tx.update(supplierReturns).set({ quantity: "5.000", totalAmount: "2500.00" }).where(eq(supplierReturns.id, created.id));
    await dispatchSupplierReturn(tx, { returnId: created.id }, actor.id);
    await expect(dispatchSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("already dispatched");
  }));
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run the integration command from Task 3.
Expected: FAIL, `dispatchSupplierReturn` is not exported.

- [ ] **Step 3: Implement**

Add imports at the top of `supplier-returns.server.ts`:

```ts
import { inventoryAuditLog } from "@/db";
import { lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import type { MaterialRef } from "@/lib/inventory/material-lots";
```

Add:

```ts
function refOf(row: typeof supplierReturns.$inferSelect): MaterialRef {
  return row.materialType === "chemical"
    ? { materialType: "chemical", materialId: row.chemicalId! }
    : { materialType: "packaging", materialId: row.packagingMaterialId! };
}

/** Out at dispatch; back on cancel-after-dispatch or void. Lot movements carry the purchase id. */
async function moveReturnStock(
  tx: Tx,
  row: typeof supplierReturns.$inferSelect,
  direction: "out" | "back",
  actorId: string,
  why: string,
) {
  const ref = refOf(row);
  await lockMaterialStock(tx, [row.warehouseId], [ref]);
  const quantity = new Big(row.quantity).toFixed(3);
  await moveLotStock(tx, {
    ref,
    lotId: row.lotId,
    warehouseId: row.warehouseId,
    delta: direction === "out" ? `-${quantity}` : quantity,
    sourceType: direction === "out" ? "supplier_return" : "supplier_return_undo",
    sourceId: row.purchaseId,
  });
  await tx.insert(inventoryAuditLog).values({
    warehouseId: row.warehouseId,
    materialType: row.materialType,
    materialId: ref.materialId,
    type: direction === "out" ? "debit" : "credit",
    amount: quantity,
    reason: why,
    performedById: actorId,
    referenceId: row.id,
    lotId: row.lotId,
  });
}

export async function dispatchSupplierReturn(tx: Tx, input: { returnId: string }, actorId: string) {
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status !== "requested") throw new Error(`This return is already ${row.status}.`);
  const returnable = await returnableFor(tx, purchase, row.id);
  if (returnable.blockedReason && new Big(returnable.max).eq(0)) {
    throw new Error(`Only 0 ${returnable.unit} of this purchase is left to send back`);
  }
  if (new Big(row.quantity).gt(returnable.max)) {
    throw new Error(`Only ${trimQty(returnable.max)} ${returnable.unit} of this purchase is left to send back. Cancel this return and request a smaller one.`);
  }
  await moveReturnStock(tx, row, "out", actorId, `Return ${row.returnNumber} dispatched to ${returnable.supplierName}`);
  await tx.update(supplierReturns)
    .set({ status: "dispatched", dispatchedById: actorId, dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));
  return { returnNumber: row.returnNumber, quantity: new Big(row.quantity).toFixed(3) };
}
```

Note the test expects the message to start with "Only 5 kg of this purchase is left to send back"; `toThrow` matches a substring, so the longer message passes.

In `cancelSupplierReturn`, replace the `// Task 4 ...` comment with:

```ts
  if (stockRestored) await moveReturnStock(tx, row, "back", actorId, `Return ${row.returnNumber} cancelled: ${reason}`);
```

- [ ] **Step 4: Run to verify it passes**

Run the integration command. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): dispatching a supplier return takes the stock out"
```

---

### Task 5: Complete and issue the debit note

**Files:**
- Modify: `src/lib/suppliers/supplier-returns.server.ts`
- Modify: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Consumes: `purchaseOwed`, `splitDebitNote`, `planLeftover` (Task 1); `wallets`, `transactions` from `@/db`; `supplierCreditMovements` (Task 2).
- Produces:
  - `supplierCreditBalance(tx: Tx, supplierId: string): Promise<string>` (2 decimals)
  - `previewDebitNote(tx: Tx, returnId: string): Promise<{ value: string; owedBefore: string; applied: string; leftover: string; supplierName: string }>`
  - `completeSupplierReturn(tx: Tx, input: { returnId: string; cashBack?: string | null; refundWalletId?: string | null }, actorId: string): Promise<{ debitNoteNumber: string; applied: string; refund: string; credit: string }>`

- [ ] **Step 1: Add failing tests** (import `completeSupplierReturn`, `supplierCreditBalance`, `previewDebitNote`; import `wallets` from `@/db`)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: debit note", () => {
  async function dispatched(tx: Tx, paid: string) {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    if (paid !== "0") await tx.update(purchaseRecords).set({ paidAmount: paid }).where(eq(purchaseRecords.id, purchase.id));
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    return { ...f, purchase, created };
  }

  it("lowers what we owe on an unpaid purchase", () => withRollback(async (tx) => {
    const { actor, purchase, created } = await dispatched(tx, "0");
    expect(await previewDebitNote(tx, created.id)).toMatchObject({ value: "5000.00", owedBefore: "50000.00", applied: "5000.00", leftover: "0.00" });
    const done = await completeSupplierReturn(tx, { returnId: created.id }, actor.id);
    expect(done.debitNoteNumber).toMatch(/^DN-\d{4,}$/);
    expect(done).toMatchObject({ applied: "5000.00", refund: "0.00", credit: "0.00" });
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id));
    expect(p.returnedAmount).toBe("5000.00");
  }));

  it("on a paid purchase, splits the leftover into cash back and supplier credit", () => withRollback(async (tx) => {
    const { actor, supplier, created } = await dispatched(tx, "50000");
    const [cash] = await tx.insert(wallets).values({ id: `w-${created.id}`, name: "Cash in Hand", type: "cash", balance: "1000" }).returning();
    const done = await completeSupplierReturn(tx, { returnId: created.id, cashBack: "2000", refundWalletId: cash.id }, actor.id);
    expect(done).toMatchObject({ applied: "0.00", refund: "2000.00", credit: "3000.00" });
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, cash.id));
    expect(w.balance).toBe("3000.00");
    expect(await supplierCreditBalance(tx, supplier.id)).toBe("3000.00");
  }));

  it("needs an account for cash back and refuses more than the leftover", () => withRollback(async (tx) => {
    const { actor, created } = await dispatched(tx, "48000");
    await expect(completeSupplierReturn(tx, { returnId: created.id, cashBack: "100" }, actor.id)).rejects.toThrow("Pick the account");
    await expect(completeSupplierReturn(tx, { returnId: created.id, cashBack: "3000.01", refundWalletId: "x" }, actor.id)).rejects.toThrow("Cash back can't be more than");
  }));

  it("only completes dispatched returns", () => withRollback(async (tx) => {
    const { actor, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, actor.id);
    await expect(completeSupplierReturn(tx, { returnId: created.id }, actor.id)).rejects.toThrow("Mark it as dispatched first");
  }));
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement**

Add imports: `import { transactions, wallets } from "@/db";`, `import { createId } from "@paralleldrive/cuid2";`, `import { supplierCreditMovements } from "@/db/schemas/supplier-schema";`, and `purchaseOwed, planLeftover, splitDebitNote` from `./supplier-returns`.

```ts
export async function supplierCreditBalance(tx: Tx, supplierId: string): Promise<string> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${supplierCreditMovements.amount}), 0)` })
    .from(supplierCreditMovements)
    .where(eq(supplierCreditMovements.supplierId, supplierId));
  return new Big(row?.total ?? 0).toFixed(2);
}

export async function previewDebitNote(tx: Tx, returnId: string) {
  const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, returnId));
  if (!row) throw new Error("Supplier return not found");
  const purchase = await loadPurchase(tx, row.purchaseId, false);
  const owed = purchaseOwed(purchase);
  const split = splitDebitNote({ value: row.totalAmount, owed });
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, row.supplierId));
  return { value: new Big(row.totalAmount).toFixed(2), owedBefore: owed.toFixed(2), ...split, supplierName: supplier?.name ?? "Supplier" };
}

export async function completeSupplierReturn(
  tx: Tx,
  input: { returnId: string; cashBack?: string | null; refundWalletId?: string | null },
  actorId: string,
) {
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status === "requested") throw new Error("Mark it as dispatched first.");
  if (row.status !== "dispatched") throw new Error(`This return is already ${row.status}.`);

  const split = splitDebitNote({ value: row.totalAmount, owed: purchaseOwed(purchase) });
  const leftover = planLeftover({ leftover: split.leftover, cashBack: input.cashBack });
  const refund = new Big(leftover.refund);
  let refundWalletId: string | null = null;
  let refundTransactionId: string | null = null;
  const debitNoteNumber = await nextDebitNoteNumber(tx);
  const [supplier] = await tx.select({ name: suppliers.supplierName }).from(suppliers).where(eq(suppliers.id, row.supplierId));
  const supplierName = supplier?.name ?? "supplier";

  if (refund.gt(0)) {
    if (!input.refundWalletId) throw new Error("Pick the account the cash back goes into");
    const [wallet] = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, input.refundWalletId)).for("update");
    if (!wallet) throw new Error("Pick the account the cash back goes into");
    refundWalletId = wallet.id;
    refundTransactionId = createId();
    await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${leftover.refund}` }).where(eq(wallets.id, wallet.id));
    await tx.insert(transactions).values({
      id: refundTransactionId,
      walletId: wallet.id,
      type: "credit",
      amount: leftover.refund,
      source: "Supplier Refund",
      referenceId: row.id,
      description: `Cash back for debit note ${debitNoteNumber} from ${supplierName}`,
      performedById: actorId,
    });
  }

  if (new Big(split.applied).gt(0)) {
    await tx.update(purchaseRecords)
      .set({ returnedAmount: sql`${purchaseRecords.returnedAmount} + ${split.applied}`, updatedAt: new Date() })
      .where(eq(purchaseRecords.id, purchase.id));
  }

  // Status first: the movement's return must already satisfy the debit-note check if it is read back.
  await tx.update(supplierReturns).set({
    status: "completed",
    completedById: actorId,
    completedAt: new Date(),
    debitNoteNumber,
    appliedToPurchaseAmount: split.applied,
    refundAmount: leftover.refund,
    refundWalletId,
    refundTransactionId,
    supplierCreditAmount: leftover.credit,
    updatedAt: new Date(),
  }).where(eq(supplierReturns.id, row.id));

  if (new Big(leftover.credit).gt(0)) {
    await tx.insert(supplierCreditMovements).values({
      supplierId: row.supplierId,
      kind: "issued",
      amount: leftover.credit,
      supplierReturnId: row.id,
      purchaseId: purchase.id,
      note: `Debit note ${debitNoteNumber}`,
      performedById: actorId,
    });
  }

  return { debitNoteNumber, applied: split.applied, refund: leftover.refund, credit: leftover.credit };
}
```

Order note for the "needs an account" test: `planLeftover` runs before the wallet check, so "Cash back can't be more than" fires first for 3000.01 even with a bogus wallet id, and "Pick the account" fires for 100 without a wallet. A debit-note number is allocated before the wallet check; a thrown error rolls the whole transaction back, so no number is lost.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): complete a supplier return with a debit note, cash back and credit"
```

---

### Task 6: Void a debit note

**Files:**
- Modify: `src/lib/suppliers/supplier-returns.server.ts`
- Modify: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Produces: `voidSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string): Promise<{ debitNoteNumber: string; refundTakenBack: string; walletName: string | null }>`

- [ ] **Step 1: Add failing tests** (import `voidSupplierReturn`, `supplierCreditMovements`)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: void", () => {
  it("reverses stock, owed amount, cash back and credit", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "48000" }).where(eq(purchaseRecords.id, purchase.id));
    const [cash] = await tx.insert(wallets).values({ id: `w-${purchase.id}`, name: "Cash in Hand", type: "cash", balance: "0" }).returning();
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "10", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id, cashBack: "1000", refundWalletId: cash.id }, f.actor.id);
    // applied 2000, cash 1000, credit 2000

    const result = await voidSupplierReturn(tx, { returnId: created.id, reason: "Supplier rejected the goods" }, f.actor.id);
    expect(result.refundTakenBack).toBe("1000.00");
    expect(await f.stock()).toBe("100.000");
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, purchase.id));
    expect(p.returnedAmount).toBe("0.00");
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, cash.id));
    expect(w.balance).toBe("0.00");
    expect(await supplierCreditBalance(tx, f.supplier.id)).toBe("0.00");
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, created.id));
    expect(row.status).toBe("voided");
  }));

  it("refuses when the credit was already spent", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "50000" }).where(eq(purchaseRecords.id, purchase.id));
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id }, f.actor.id); // credit 3000
    await tx.insert(supplierCreditMovements).values({ supplierId: f.supplier.id, kind: "used", amount: "-2500.00", performedById: f.actor.id });
    await expect(voidSupplierReturn(tx, { returnId: created.id, reason: "x" }, f.actor.id))
      .rejects.toThrow("Rs 2,500 of this return's credit was already used on later payments, so it can't be voided.");
  }));

  it("refuses to void anything not completed", () => withRollback(async (tx) => {
    const f = await supplierReturnFixture(tx);
    const purchase = await f.buy("100", "50000");
    const created = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await expect(voidSupplierReturn(tx, { returnId: created.id, reason: "x" }, f.actor.id)).rejects.toThrow("Only a completed return");
  }));
});
```

If `formatRupees("2500.00")` renders "Rs 2,500.00", adjust the expected text to match (same note as Task 1).

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `voidSupplierReturn` not exported.

- [ ] **Step 3: Implement**

Add `import { formatRupees } from "@/lib/finance/expense-entry";` and:

```ts
export async function voidSupplierReturn(tx: Tx, input: { returnId: string; reason: string }, actorId: string) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required");
  const { row, purchase } = await lockReturn(tx, input.returnId);
  if (row.status !== "completed") throw new Error("Only a completed return has a debit note to void.");

  const credit = new Big(row.supplierCreditAmount);
  if (credit.gt(0)) {
    const balance = new Big(await supplierCreditBalance(tx, row.supplierId));
    if (balance.lt(credit)) {
      throw new Error(`${formatRupees(credit.minus(balance).toFixed(2))} of this return's credit was already used on later payments, so it can't be voided.`);
    }
    await tx.insert(supplierCreditMovements).values({
      supplierId: row.supplierId,
      kind: "issue_reversed",
      amount: credit.times(-1).toFixed(2),
      supplierReturnId: row.id,
      purchaseId: purchase.id,
      note: `Debit note ${row.debitNoteNumber} voided`,
      performedById: actorId,
    });
  }

  let walletName: string | null = null;
  const refund = new Big(row.refundAmount);
  if (refund.gt(0) && row.refundWalletId) {
    const [wallet] = await tx.select({ id: wallets.id, name: wallets.name }).from(wallets).where(eq(wallets.id, row.refundWalletId)).for("update");
    walletName = wallet?.name ?? null;
    await tx.update(wallets).set({ balance: sql`${wallets.balance} - ${refund.toFixed(2)}` }).where(eq(wallets.id, row.refundWalletId));
    await tx.insert(transactions).values({
      id: createId(),
      walletId: row.refundWalletId,
      type: "debit",
      amount: refund.toFixed(2),
      source: "Supplier Refund",
      referenceId: row.id,
      description: `Reversal: debit note ${row.debitNoteNumber} voided`,
      reversalOfTransactionId: row.refundTransactionId,
      performedById: actorId,
    });
  }

  if (new Big(row.appliedToPurchaseAmount).gt(0)) {
    await tx.update(purchaseRecords)
      .set({ returnedAmount: sql`${purchaseRecords.returnedAmount} - ${row.appliedToPurchaseAmount}`, updatedAt: new Date() })
      .where(eq(purchaseRecords.id, purchase.id));
  }

  await moveReturnStock(tx, row, "back", actorId, `Debit note ${row.debitNoteNumber} voided: ${reason}`);
  await tx.update(supplierReturns)
    .set({ status: "voided", voidedById: actorId, voidedAt: new Date(), voidReason: reason, updatedAt: new Date() })
    .where(eq(supplierReturns.id, row.id));

  return { debitNoteNumber: row.debitNoteNumber!, refundTakenBack: refund.toFixed(2), walletName };
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): void a debit note and reverse everything it did"
```

---

### Task 7: Use supplier credit, and guard purchase edit and delete

**Files:**
- Modify: `src/lib/suppliers/supplier-returns.server.ts`
- Modify: `src/server-functions/suppliers/update-purchase-record-fn.ts` (right after the `voidedAt` check, around line 106)
- Modify: `src/server-functions/suppliers/delete-purchase-record-fn.ts` (inside the transaction, after the purchase is loaded and before any stock or money change; and before the payments are deleted)
- Modify: `src/server-functions/suppliers/add-payment-fn.ts` (remaining-balance check)
- Modify: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Produces:
  - `applySupplierCredit(tx: Tx, input: { purchaseId: string; amount: string }, actorId: string): Promise<{ paymentId: string; balanceAfter: string }>`
  - `assertPurchaseHasNoActiveReturn(tx: Tx, purchaseId: string): Promise<void>`
  - `restoreCreditUsedOnPurchase(tx: Tx, purchaseId: string, actorId: string): Promise<string>` (amount given back, 2 decimals)

- [ ] **Step 1: Add failing tests** (import the three new functions, `supplierPayments` from `@/db`)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier credit and purchase guards", () => {
  async function withCredit(tx: Tx) {
    const f = await supplierReturnFixture(tx);
    const first = await f.buy("100", "50000");
    await tx.update(purchaseRecords).set({ paidAmount: "50000" }).where(eq(purchaseRecords.id, first.id));
    const created = await requestSupplierReturn(tx, { purchaseId: first.id, quantity: "6", reason: "Wet" }, f.actor.id);
    await dispatchSupplierReturn(tx, { returnId: created.id }, f.actor.id);
    await completeSupplierReturn(tx, { returnId: created.id }, f.actor.id); // credit 3000
    const second = await f.buy("40", "21000"); // new price lot, owes 21000
    return { ...f, first, second, created };
  }

  it("pays part of a later purchase from supplier credit without touching any account", () => withRollback(async (tx) => {
    const { actor, supplier, second } = await withCredit(tx);
    const result = await applySupplierCredit(tx, { purchaseId: second.id, amount: "2000" }, actor.id);
    expect(result.balanceAfter).toBe("1000.00");
    const [p] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, second.id));
    expect(p.paidAmount).toBe("2000.00");
    const [payment] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, result.paymentId));
    expect(payment).toMatchObject({ method: "supplier_credit", walletId: null, supplierId: supplier.id });
  }));

  it("refuses more than the credit or more than is owed", () => withRollback(async (tx) => {
    const { actor, second } = await withCredit(tx);
    await expect(applySupplierCredit(tx, { purchaseId: second.id, amount: "3000.01" }, actor.id)).rejects.toThrow("Supplier credit is only");
    await tx.update(purchaseRecords).set({ paidAmount: "20000" }).where(eq(purchaseRecords.id, second.id));
    await expect(applySupplierCredit(tx, { purchaseId: second.id, amount: "1500" }, actor.id)).rejects.toThrow("Only Rs 1,000 is still owed");
  }));

  it("blocks edit and delete while a return is active, and gives credit back on delete", () => withRollback(async (tx) => {
    const { actor, supplier, first, second } = await withCredit(tx);
    await expect(assertPurchaseHasNoActiveReturn(tx, first.id)).rejects.toThrow(/This purchase has supplier return SR-\d+\. Cancel or void the return first\./);
    await expect(assertPurchaseHasNoActiveReturn(tx, second.id)).resolves.toBeUndefined();
    await applySupplierCredit(tx, { purchaseId: second.id, amount: "2000" }, actor.id);
    expect(await restoreCreditUsedOnPurchase(tx, second.id, actor.id)).toBe("2000.00");
    expect(await supplierCreditBalance(tx, supplier.id)).toBe("3000.00");
  }));
});
```

Adjust "Rs 1,000" in the expected text if `formatRupees` prints decimals (see Task 1).

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement the server rules**

Add `supplierPayments` to the `@/db` import, `inArray` to the `drizzle-orm` import, and `ACTIVE_SUPPLIER_RETURN_STATUSES`, `SUPPLIER_CREDIT_METHOD` to the `./supplier-returns` import.

```ts
const MONEY = /^\d+(\.\d{1,2})?$/;

export async function applySupplierCredit(tx: Tx, input: { purchaseId: string; amount: string }, actorId: string) {
  if (!MONEY.test(input.amount) || new Big(input.amount).lte(0)) throw new Error("Enter an amount above 0 with at most 2 decimals");
  const amount = new Big(input.amount);
  const purchase = await loadPurchase(tx, input.purchaseId, true);
  if (purchase.voidedAt) throw new Error("Purchase is already voided");
  // Serialise credit use per supplier: lock the supplier row.
  await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, purchase.supplierId)).for("update");
  const balance = new Big(await supplierCreditBalance(tx, purchase.supplierId));
  if (amount.gt(balance)) throw new Error(`Supplier credit is only ${formatRupees(balance.toFixed(2))}`);
  const owed = purchaseOwed(purchase);
  if (amount.gt(owed)) throw new Error(`Only ${formatRupees(owed.toFixed(2))} is still owed on this purchase`);

  await tx.update(purchaseRecords)
    .set({ paidAmount: sql`${purchaseRecords.paidAmount} + ${amount.toFixed(2)}`, updatedAt: new Date() })
    .where(eq(purchaseRecords.id, purchase.id));
  const [payment] = await tx.insert(supplierPayments).values({
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    amount: amount.toFixed(2),
    method: SUPPLIER_CREDIT_METHOD,
    walletId: null,
    reference: "Supplier credit",
  }).returning({ id: supplierPayments.id });
  await tx.insert(supplierCreditMovements).values({
    supplierId: purchase.supplierId,
    kind: "used",
    amount: amount.times(-1).toFixed(2),
    purchaseId: purchase.id,
    supplierPaymentId: payment.id,
    performedById: actorId,
  });
  return { paymentId: payment.id, balanceAfter: balance.minus(amount).toFixed(2) };
}

export async function assertPurchaseHasNoActiveReturn(tx: Tx, purchaseId: string) {
  const [active] = await tx.select({ returnNumber: supplierReturns.returnNumber }).from(supplierReturns)
    .where(and(eq(supplierReturns.purchaseId, purchaseId), inArray(supplierReturns.status, [...ACTIVE_SUPPLIER_RETURN_STATUSES])))
    .limit(1);
  if (active) throw new Error(`This purchase has supplier return ${active.returnNumber}. Cancel or void the return first.`);
}

/** Before a purchase is deleted: credit spent on it goes back to the supplier. */
export async function restoreCreditUsedOnPurchase(tx: Tx, purchaseId: string, actorId: string) {
  const payments = await tx.select({ amount: supplierPayments.amount, supplierId: supplierPayments.supplierId }).from(supplierPayments)
    .where(and(eq(supplierPayments.purchaseId, purchaseId), eq(supplierPayments.method, SUPPLIER_CREDIT_METHOD)));
  const total = payments.reduce((sum, p) => sum.plus(p.amount), new Big(0));
  if (total.gt(0)) {
    await tx.insert(supplierCreditMovements).values({
      supplierId: payments[0].supplierId,
      kind: "use_reversed",
      amount: total.toFixed(2),
      purchaseId,
      note: "Purchase deleted; supplier credit given back",
      performedById: actorId,
    });
  }
  return total.toFixed(2);
}
```

- [ ] **Step 4: Wire the guards into the purchase server functions**

`update-purchase-record-fn.ts`, directly after `if (existingRecord.voidedAt) throw new Error("Purchase is already voided");`:

```ts
      await assertPurchaseHasNoActiveReturn(tx, existingRecord.id);
```

Also find the place in that file that compares the new total cost or paid amount against `alreadyPaid` (around line 235) and make it compare against `alreadyPaid + returnedAmount`, so a purchase with a voided-then-cleared history still checks correctly:

```ts
        const alreadyPaid = parseFloat(existingRecord.paidAmount || "0") + parseFloat(existingRecord.returnedAmount || "0");
```

`delete-purchase-record-fn.ts`, right after `if (!purchase) { throw new Error("Purchase record not found"); }`:

```ts
      await assertPurchaseHasNoActiveReturn(tx, purchase.id);
```

and immediately before `await tx.delete(supplierPayments).where(eq(supplierPayments.purchaseId, purchase.id));`:

```ts
      await restoreCreditUsedOnPurchase(tx, purchase.id, userId);
```

Import both from `@/lib/suppliers/supplier-returns.server`. `planPurchaseRefund` already ignores the credit payment (no wallet), so it is never refunded to an account and never counted as a loss.

`add-payment-fn.ts`: the remaining check becomes

```ts
        const remaining = purchaseOwed(purchase);
        const incomingAmount = new Big(data.amount);
        if (incomingAmount.gt(remaining)) {
          throw new Error(`Payment of PKR ${incomingAmount.toFixed(2)} exceeds the outstanding balance of PKR ${remaining.toFixed(2)}`);
        }
```

with `import { purchaseOwed } from "@/lib/suppliers/supplier-returns";` and the unused `totalCost`/`alreadyPaid` locals removed.

- [ ] **Step 5: Run tests and typecheck**

Run the integration command, then `bun run test src/__tests__/delete-purchase-refund.behavior.test.tsx && bun run typecheck`.
Also run the existing purchase integration suites: `bunx vitest run -c vitest.integration.config.ts src/__tests__/integration/purchase-delete-refund.test.ts src/__tests__/integration/material-lot-purchase-edits.test.ts`.
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/server-functions/suppliers/update-purchase-record-fn.ts src/server-functions/suppliers/delete-purchase-record-fn.ts src/server-functions/suppliers/add-payment-fn.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): pay with supplier credit and protect purchases that have returns"
```

---

### Task 8: Server functions and reads

**Files:**
- Modify: `src/lib/suppliers/supplier-returns.server.ts` (reads)
- Create: `src/server-functions/suppliers/supplier-returns-fn.ts`
- Modify: `src/server-functions/suppliers/get-supplier-details-fn.ts`
- Modify: `src/__tests__/integration/supplier-returns.test.ts`

**Interfaces:**
- Produces (reads in the server module):
  - `type SupplierReturnRow = { id; returnNumber; status: SupplierReturnStatus; requestedAt: Date; dispatchedAt: Date | null; completedAt: Date | null; materialName: string; unit: string; warehouseName: string; quantity: string; unitCost: string; totalAmount: string; reason: string; notes: string | null; debitNoteNumber: string | null; appliedToPurchaseAmount: string; refundAmount: string; refundWalletName: string | null; supplierCreditAmount: string; purchaseInvoiceNumber: string | null; purchaseDate: Date; cancelReason: string | null; voidReason: string | null; requestedByName: string | null }`
  - `listSupplierReturns(tx: Tx, input: { supplierId: string; queue: SupplierReturnQueue }): Promise<{ rows: SupplierReturnRow[]; counts: Record<SupplierReturnQueue, number> }>`
  - `getSupplierReturn(tx: Tx, returnId: string): Promise<SupplierReturnRow & { supplierName: string; supplierPhone: string | null; supplierAddress: string | null }>`
- Produces (server functions, all `createServerFn`):
  - view: `getPurchaseReturnableFn({ purchaseId })`, `listSupplierReturnsFn({ supplierId, queue })`, `getSupplierReturnFn({ id })`, `previewDebitNoteFn({ id })`
  - manage (POST): `requestSupplierReturnFn({ purchaseId, quantity, reason, notes? })`, `dispatchSupplierReturnFn({ id })`, `completeSupplierReturnFn({ id, cashBack?, refundWalletId? })`, `cancelSupplierReturnFn({ id, reason })`, `voidSupplierReturnFn({ id, reason })`, `applySupplierCreditFn({ purchaseId, amount })`
  - `getSupplierDetailsFn` adds `totalReturned: number` and `supplierCredit: string`; `balance` becomes purchases − paid − returned.

- [ ] **Step 1: Add a failing read test**

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("supplier returns: list", () => {
  it("lists by work queue with counts", () => withRollback(async (tx) => {
    const { actor, supplier, buy } = await supplierReturnFixture(tx);
    const purchase = await buy("100", "50000");
    const a = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "5", reason: "Wet" }, actor.id);
    const b = await requestSupplierReturn(tx, { purchaseId: purchase.id, quantity: "5", reason: "Torn" }, actor.id);
    await dispatchSupplierReturn(tx, { returnId: b.id }, actor.id);
    const { rows, counts } = await listSupplierReturns(tx, { supplierId: supplier.id, queue: "to_dispatch" });
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    expect(rows[0]).toMatchObject({ quantity: "5.000", totalAmount: "2500.00", unit: "kg", status: "requested" });
    expect(counts).toEqual({ to_dispatch: 1, dispatched: 1, done: 0 });
  }));
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `listSupplierReturns` not exported.

- [ ] **Step 3: Implement the reads**

```ts
// in supplier-returns.server.ts
import { desc } from "drizzle-orm";
import { user } from "@/db";
import { QUEUE_STATUSES, type SupplierReturnQueue, type SupplierReturnStatus } from "./supplier-returns";

const rowSelect = {
  id: supplierReturns.id,
  returnNumber: supplierReturns.returnNumber,
  status: supplierReturns.status,
  requestedAt: supplierReturns.requestedAt,
  dispatchedAt: supplierReturns.dispatchedAt,
  completedAt: supplierReturns.completedAt,
  chemicalName: chemicals.name,
  chemicalUnit: chemicals.unit,
  packagingName: packagingMaterials.name,
  packagingMeasuredInKg: packagingMaterials.measuredInKg,
  warehouseName: warehouses.name,
  quantity: supplierReturns.quantity,
  unitCost: supplierReturns.unitCost,
  totalAmount: supplierReturns.totalAmount,
  reason: supplierReturns.reason,
  notes: supplierReturns.notes,
  debitNoteNumber: supplierReturns.debitNoteNumber,
  appliedToPurchaseAmount: supplierReturns.appliedToPurchaseAmount,
  refundAmount: supplierReturns.refundAmount,
  refundWalletName: wallets.name,
  supplierCreditAmount: supplierReturns.supplierCreditAmount,
  purchaseInvoiceNumber: purchaseRecords.invoiceNumber,
  purchaseDate: purchaseRecords.purchaseDate,
  cancelReason: supplierReturns.cancelReason,
  voidReason: supplierReturns.voidReason,
  requestedByName: user.name,
};

function baseQuery(tx: Tx) {
  return tx.select(rowSelect).from(supplierReturns)
    .innerJoin(purchaseRecords, eq(purchaseRecords.id, supplierReturns.purchaseId))
    .innerJoin(warehouses, eq(warehouses.id, supplierReturns.warehouseId))
    .leftJoin(chemicals, eq(chemicals.id, supplierReturns.chemicalId))
    .leftJoin(packagingMaterials, eq(packagingMaterials.id, supplierReturns.packagingMaterialId))
    .leftJoin(wallets, eq(wallets.id, supplierReturns.refundWalletId))
    .leftJoin(user, eq(user.id, supplierReturns.requestedById));
}

type Raw = Awaited<ReturnType<ReturnType<typeof baseQuery>["execute"]>>[number];

function toRow(r: Raw): SupplierReturnRow {
  const { chemicalName, chemicalUnit, packagingName, packagingMeasuredInKg, ...rest } = r;
  return {
    ...rest,
    status: r.status as SupplierReturnStatus,
    materialName: chemicalName ?? packagingName ?? "Material",
    unit: chemicalName ? (chemicalUnit ?? "kg") : packagingMeasuredInKg ? "kg" : "units",
    quantity: new Big(r.quantity).toFixed(3),
    unitCost: new Big(r.unitCost).toFixed(2),
    totalAmount: new Big(r.totalAmount).toFixed(2),
    appliedToPurchaseAmount: new Big(r.appliedToPurchaseAmount).toFixed(2),
    refundAmount: new Big(r.refundAmount).toFixed(2),
    supplierCreditAmount: new Big(r.supplierCreditAmount).toFixed(2),
  };
}

export type SupplierReturnRow = {
  id: string; returnNumber: string; status: SupplierReturnStatus;
  requestedAt: Date; dispatchedAt: Date | null; completedAt: Date | null;
  materialName: string; unit: string; warehouseName: string;
  quantity: string; unitCost: string; totalAmount: string;
  reason: string; notes: string | null; debitNoteNumber: string | null;
  appliedToPurchaseAmount: string; refundAmount: string; refundWalletName: string | null; supplierCreditAmount: string;
  purchaseInvoiceNumber: string | null; purchaseDate: Date;
  cancelReason: string | null; voidReason: string | null; requestedByName: string | null;
};

export async function listSupplierReturns(tx: Tx, input: { supplierId: string; queue: SupplierReturnQueue }) {
  const rows = await baseQuery(tx)
    .where(and(eq(supplierReturns.supplierId, input.supplierId), inArray(supplierReturns.status, QUEUE_STATUSES[input.queue])))
    .orderBy(desc(supplierReturns.requestedAt), desc(supplierReturns.id))
    .limit(200);
  const countRows = await tx.select({ status: supplierReturns.status, n: sql<number>`count(*)::int` })
    .from(supplierReturns).where(eq(supplierReturns.supplierId, input.supplierId)).groupBy(supplierReturns.status);
  const counts: Record<SupplierReturnQueue, number> = { to_dispatch: 0, dispatched: 0, done: 0 };
  for (const c of countRows) {
    const queue = (Object.keys(QUEUE_STATUSES) as SupplierReturnQueue[]).find((q) => QUEUE_STATUSES[q].includes(c.status as SupplierReturnStatus));
    if (queue) counts[queue] += Number(c.n);
  }
  return { rows: rows.map(toRow), counts };
}

export async function getSupplierReturn(tx: Tx, returnId: string) {
  const [row] = await baseQuery(tx).where(eq(supplierReturns.id, returnId));
  if (!row) throw new Error("Supplier return not found");
  const [supplier] = await tx.select({ name: suppliers.supplierName, phone: suppliers.phone, address: suppliers.address })
    .from(suppliers).innerJoin(supplierReturns, eq(supplierReturns.supplierId, suppliers.id)).where(eq(supplierReturns.id, returnId));
  return { ...toRow(row), supplierName: supplier?.name ?? "Supplier", supplierPhone: supplier?.phone ?? null, supplierAddress: supplier?.address ?? null };
}
```

If the `Raw` type helper fails to infer with this Drizzle version, replace it with `type Raw = Awaited<ReturnType<typeof baseQuery>>[number];`.

- [ ] **Step 4: Write the server functions**

```ts
// src/server-functions/suppliers/supplier-returns-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { requireSuppliersManageMiddleware, requireSuppliersViewMiddleware } from "@/lib/middlewares";
import {
  applySupplierCredit,
  cancelSupplierReturn,
  completeSupplierReturn,
  dispatchSupplierReturn,
  getSupplierReturn,
  listSupplierReturns,
  previewDebitNote,
  requestSupplierReturn,
  returnableForPurchase,
  voidSupplierReturn,
} from "@/lib/suppliers/supplier-returns.server";

type Ctx = { context: { session: { user: { id: string; name: string } } } };
const id = z.string().min(1);
const reason = z.string().trim().min(1, "A reason is required").max(1000);
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with at most 2 decimals");

function log({ context }: Ctx, action: "created" | "updated" | "deleted", entityId: string, label: string, description: string, metadata: Record<string, unknown>) {
  logActivityQuiet({
    module: "suppliers",
    action,
    entityType: "supplier_return",
    entityId,
    entityLabel: label,
    actorId: context.session.user.id,
    actorName: context.session.user.name,
    description,
    severity: action === "deleted" ? "warning" : "info",
    metadata,
  });
}

export const getPurchaseReturnableFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ purchaseId: id }))
  .handler(({ data }) => db.transaction((tx) => returnableForPurchase(tx, data.purchaseId)));

export const listSupplierReturnsFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ supplierId: id, queue: z.enum(["to_dispatch", "dispatched", "done"]) }))
  .handler(({ data }) => db.transaction((tx) => listSupplierReturns(tx, data)));

export const getSupplierReturnFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data }) => db.transaction((tx) => getSupplierReturn(tx, data.id)));

export const previewDebitNoteFn = createServerFn()
  .middleware([requireSuppliersViewMiddleware])
  .inputValidator(z.object({ id }))
  .handler(({ data }) => db.transaction((tx) => previewDebitNote(tx, data.id)));

export const requestSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ purchaseId: id, quantity: z.string().trim(), reason, notes: z.string().trim().max(1000).optional() }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => requestSupplierReturn(tx, data, context.session.user.id));
    log({ context }, "created", result.id, result.returnNumber, `Requested supplier return ${result.returnNumber} of ${data.quantity} (PKR ${result.totalAmount}). Reason: ${data.reason}`, { purchaseId: data.purchaseId, ...result });
    return result;
  });

export const dispatchSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => dispatchSupplierReturn(tx, { returnId: data.id }, context.session.user.id));
    log({ context }, "updated", data.id, result.returnNumber, `Dispatched supplier return ${result.returnNumber} (${result.quantity} taken out of stock)`, result);
    return result;
  });

export const completeSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, cashBack: money.optional(), refundWalletId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => completeSupplierReturn(tx, { returnId: data.id, cashBack: data.cashBack, refundWalletId: data.refundWalletId }, context.session.user.id));
    log({ context }, "updated", data.id, result.debitNoteNumber, `Issued debit note ${result.debitNoteNumber}: PKR ${result.applied} off the purchase, PKR ${result.refund} cash back, PKR ${result.credit} supplier credit`, result);
    return result;
  });

export const cancelSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, reason }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => cancelSupplierReturn(tx, { returnId: data.id, reason: data.reason }, context.session.user.id));
    log({ context }, "deleted", data.id, result.returnNumber, `Cancelled supplier return ${result.returnNumber}${result.stockRestored ? " and put the stock back" : ""}. Reason: ${data.reason}`, result);
    return result;
  });

export const voidSupplierReturnFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id, reason }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => voidSupplierReturn(tx, { returnId: data.id, reason: data.reason }, context.session.user.id));
    log({ context }, "deleted", data.id, result.debitNoteNumber, `Voided debit note ${result.debitNoteNumber}. Reason: ${data.reason}`, result);
    return result;
  });

export const applySupplierCreditFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ purchaseId: id, amount: money }))
  .handler(async ({ data, context }) => {
    const result = await db.transaction((tx) => applySupplierCredit(tx, data, context.session.user.id));
    log({ context }, "created", result.paymentId, data.amount, `Paid PKR ${data.amount} from supplier credit`, { purchaseId: data.purchaseId, ...result });
    return result;
  });
```

- [ ] **Step 5: Supplier details return returns and credit**

In `get-supplier-details-fn.ts`, replace the two sums and the balance with one query plus the credit balance:

```ts
    const [totals] = await db
      .select({
        totalPurchases: sql<string>`COALESCE(SUM(${purchaseRecords.cost}), 0)`,
        totalPaid: sql<string>`COALESCE(SUM(${purchaseRecords.paidAmount}), 0)`,
        totalReturned: sql<string>`COALESCE(SUM(${purchaseRecords.returnedAmount}), 0)`,
      })
      .from(purchaseRecords)
      .where(and(eq(purchaseRecords.supplierId, data.id), isNull(purchaseRecords.voidedAt)));

    const supplierCredit = await db.transaction((tx) => supplierCreditBalance(tx, data.id));
    const totalPurchasesNum = parseFloat(totals.totalPurchases);
    const totalPaidNum = parseFloat(totals.totalPaid);
    const totalReturnedNum = parseFloat(totals.totalReturned);

    return {
      ...supplier,
      balance: totalPurchasesNum - totalPaidNum - totalReturnedNum,
      totalPurchases: totalPurchasesNum,
      totalPayments: totalPaidNum,
      totalReturned: totalReturnedNum,
      supplierCredit,
    };
```

Import `supplierCreditBalance` from `@/lib/suppliers/supplier-returns.server`.

- [ ] **Step 6: Run tests and typecheck**

Run the integration command and `bun run typecheck`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/suppliers/supplier-returns.server.ts src/server-functions/suppliers/supplier-returns-fn.ts src/server-functions/suppliers/get-supplier-details-fn.ts src/__tests__/integration/supplier-returns.test.ts
git commit -m "feat(suppliers): server functions for supplier returns and supplier credit"
```

---

### Task 9: "What we owe" counts debit notes everywhere

**Files:**
- Modify: `src/server-functions/suppliers/get-suppliers-fn.ts`
- Modify: `src/server-functions/suppliers/get-supplier-paginated-outstanding-fn.ts`
- Modify: `src/server-functions/reports/purchases-report-fn.ts`
- Modify: `src/routes/_protected/reports/purchases/index.tsx` (lines ~135–170)
- Modify: `src/routes/_protected/suppliers/$supplierId.tsx` (`handleRecordPayment` ~line 270; the dialog blocks ~614–661)
- Modify: `src/routes/_protected/suppliers/$supplierId_.details.tsx` (~236, ~394–441)
- Modify: `src/components/suppliers/purchase-history-table.tsx` (`PurchaseRecord` type, grouping ~142, `PaymentBadge` ~180, row ~556–628)
- Modify: `src/components/suppliers/purchase-details-dialog.tsx` (~110)
- Modify: `src/components/suppliers/payment-records-table.tsx` (method/wallet cell)
- Test: `src/__tests__/supplier-owed-display.behavior.test.tsx` (create)

**Interfaces:**
- Consumes: `purchaseOwed`, `SUPPLIER_CREDIT_METHOD` (Task 1).
- Produces: `PurchaseRecord.returnedAmount?: string`; `PaymentBadge` props `{ cost: number; paidAmount: number; returnedAmount: number }`; purchases report rows carry `returnedAmount: number` and summary `totalReturned`.

- [ ] **Step 1: Write the failing behaviour test**

```tsx
// src/__tests__/supplier-owed-display.behavior.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentBadge } from "@/components/suppliers/purchase-history-table";

describe("purchase payment badge", () => {
  afterEach(cleanup);
  it("shows Paid when payments plus debit notes cover the cost", () => {
    render(<PaymentBadge cost={50000} paidAmount={45000} returnedAmount={5000} />);
    expect(screen.getByText("Paid")).toBeTruthy();
  });
  it("shows Partial when a debit note covers only part", () => {
    render(<PaymentBadge cost={50000} paidAmount={0} returnedAmount={5000} />);
    expect(screen.getByText("Partial")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/__tests__/supplier-owed-display.behavior.test.tsx`
Expected: FAIL, `PaymentBadge` is not exported (or the first case renders "Partial").

- [ ] **Step 3: Implement**

`purchase-history-table.tsx`:
- Add `returnedAmount?: string;` to `PurchaseRecord` after `paidAmount`.
- Export and change the badge:

```tsx
export function PaymentBadge({ cost, paidAmount, returnedAmount = 0 }: { cost: number; paidAmount: number; returnedAmount?: number }) {
  const settled = paidAmount + returnedAmount;
  const remaining = cost - settled;
  if (remaining <= 0.1) { /* existing "Paid" badge */ }
  if (settled > 0) { /* existing "Partial" badge */ }
  /* existing unpaid badge */
}
```

(Keep the existing JSX inside each branch; only the conditions change.)
- In the grouping loop, `group.totalPaid += paid + (parseFloat(r.returnedAmount || "0") || 0);` so the group badge counts debit notes as settled.
- Per row (~556), pass `returnedAmount={parseFloat(record.returnedAmount || "0")}` to `PaymentBadge`. Where the row shows a remaining amount or decides to show "Record payment", use `purchaseOwed(record).toNumber()`.

`$supplierId.tsx` and `$supplierId_.details.tsx`, everywhere `total - paid` is used for a purchase:

```ts
    const remaining = purchaseOwed(item).toNumber();
```

(`item`/`selectedItem` already carry `cost`, `paidAmount`, and now `returnedAmount`, because `purchasesPageByMaterial` selects whole rows.)

`purchase-details-dialog.tsx`: add `returnedAmount?: string` to the prop type; compute `const returned = parseFloat(purchase.returnedAmount || "0");` and `const remaining = purchaseOwed(purchase).toNumber();`. When `returned > 0`, render a row "Returned (debit notes)" with `formatRupees(returned)` under the paid row.

`payment-records-table.tsx`: in the method/wallet cell, when `record.method === SUPPLIER_CREDIT_METHOD`, render "Supplier credit" instead of looking up a wallet.

`get-suppliers-fn.ts`:

```ts
      const totalReturned = active.reduce((acc, p) => acc + parseFloat(p.returnedAmount || "0"), 0);
      const balance = totalPurchases - totalPayments - totalReturned;
```

and return `totalReturned` too.

`get-supplier-paginated-outstanding-fn.ts`: the outstanding condition becomes

```ts
      sql`${purchaseRecords.cost} > ${purchaseRecords.paidAmount} + ${purchaseRecords.returnedAmount}`,
```

`purchases-report-fn.ts`: select `returnedAmount: purchaseRecords.returnedAmount`; `const totalReturned = rows.reduce((s, r) => s + Number(r.returnedAmount), 0); const totalOutstanding = totalCost - totalPaid - totalReturned;`; map `returnedAmount: Number(r.returnedAmount)`; summary `{ totalCost, totalPaid, totalReturned, totalOutstanding, count }`.

`reports/purchases/index.tsx`: `const settled = p.paidAmount + p.returnedAmount; const isFullyPaid = settled >= p.cost; const isPartial = settled > 0 && settled < p.cost;`. Add a "Returned" column after "Paid" showing `formatReportMoney(p.returnedAmount)` and, in the summary cards, a "Returned" card when `summary.totalReturned > 0`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test src/__tests__/supplier-owed-display.behavior.test.tsx src/__tests__/supplier-purchases-paged-by-material.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/suppliers src/server-functions/reports/purchases-report-fn.ts src/routes/_protected/reports/purchases/index.tsx src/routes/_protected/suppliers src/components/suppliers src/__tests__/supplier-owed-display.behavior.test.tsx
git commit -m "feat(suppliers): what we owe a supplier counts debit notes"
```

---

### Task 10: Hooks and the "Return to supplier" sheet

**Files:**
- Create: `src/hooks/suppliers/use-supplier-returns.ts`
- Create: `src/components/suppliers/request-supplier-return-sheet.tsx`
- Modify: `src/components/suppliers/purchase-history-table.tsx` (row menu, near the other `DropdownMenuItem`s ~686–736)
- Modify: `src/routes/_protected/suppliers/$supplierId.tsx`, `$supplierId_.details.tsx` (state + render the sheet)
- Test: `src/__tests__/supplier-return-sheet.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 8 server functions.
- Produces:
  - `usePurchaseReturnable(purchaseId: string | null)` (query key `["purchase-returnable", purchaseId]`)
  - `useSupplierReturns(supplierId: string, queue: SupplierReturnQueue)` (key `["supplier-returns", supplierId, queue]`)
  - `useSupplierReturn(id: string | null)` (key `["supplier-return", id]`)
  - `useDebitNotePreview(id: string | null)` (key `["debit-note-preview", id]`)
  - `useSupplierReturnMutations()` → `{ request, dispatch, complete, cancel, voidNote, useCredit }` (each a `useMutation`)
  - `invalidateSupplierReturnQueries(queryClient)`
  - `<RequestSupplierReturnSheet open onOpenChange purchaseId />`
  - `PurchaseHistoryTable` gains optional prop `onReturnToSupplier?: (item: PurchaseRecord) => void`

- [ ] **Step 1: Write the failing behaviour test**

```tsx
// src/__tests__/supplier-return-sheet.behavior.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestSupplierReturnSheet } from "@/components/suppliers/request-supplier-return-sheet";

const requestFn = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ id: "r1", returnNumber: "SR-0001", totalAmount: "5000.00" })));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: requestFn,
  getPurchaseReturnableFn: vi.fn(),
  listSupplierReturnsFn: vi.fn(),
  getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(),
  dispatchSupplierReturnFn: vi.fn(),
  completeSupplierReturnFn: vi.fn(),
  cancelSupplierReturnFn: vi.fn(),
  voidSupplierReturnFn: vi.fn(),
  applySupplierCreditFn: vi.fn(),
}));

const returnable = {
  purchaseId: "p1", supplierId: "s1", supplierName: "Ali Traders", materialName: "Soda Ash", unit: "kg",
  warehouseName: "Main Store", unitCost: "500.00", stockLeft: "30.000", pendingRequested: "0.000", max: "30.000", blockedReason: null,
};

function open(data: typeof returnable | (Omit<typeof returnable, "blockedReason"> & { blockedReason: string })) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["purchase-returnable", "p1"], data);
  return render(<QueryClientProvider client={client}><RequestSupplierReturnSheet open onOpenChange={vi.fn()} purchaseId="p1" /></QueryClientProvider>);
}

describe("Return to supplier sheet", () => {
  afterEach(() => { cleanup(); requestFn.mockClear(); });

  it("shows what can go back and the debit note value as you type", () => {
    open(returnable);
    expect(screen.getByText("Up to 30 kg left of this purchase in Main Store")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "10" } });
    expect(screen.getByText("Debit note value: Rs 5,000")).toBeTruthy();
  });

  it("blocks more than the maximum", () => {
    open(returnable);
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "31" } });
    expect(screen.getByText("Only 30 kg can go back")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request return" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends quantity and reason", async () => {
    open(returnable);
    fireEvent.change(screen.getByLabelText("Quantity (kg)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Why is it going back?"), { target: { value: "Wet bags" } });
    fireEvent.click(screen.getByRole("button", { name: "Request return" }));
    await waitFor(() => expect(requestFn).toHaveBeenCalledWith({ data: { purchaseId: "p1", quantity: "10", reason: "Wet bags", notes: "" } }));
  });

  it("explains why a purchase can't be returned", () => {
    open({ ...returnable, max: "0.000", blockedReason: "A voided purchase can't be returned." });
    expect(screen.getByText("A voided purchase can't be returned.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request return" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/__tests__/supplier-return-sheet.behavior.test.tsx`
Expected: FAIL, component missing.

- [ ] **Step 3: Implement the hooks**

```ts
// src/hooks/suppliers/use-supplier-returns.ts
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import type { SupplierReturnQueue } from "@/lib/suppliers/supplier-returns";
import {
  applySupplierCreditFn,
  cancelSupplierReturnFn,
  completeSupplierReturnFn,
  dispatchSupplierReturnFn,
  getPurchaseReturnableFn,
  getSupplierReturnFn,
  listSupplierReturnsFn,
  previewDebitNoteFn,
  requestSupplierReturnFn,
  voidSupplierReturnFn,
} from "@/server-functions/suppliers/supplier-returns-fn";

export function usePurchaseReturnable(purchaseId: string | null) {
  return useQuery({
    queryKey: ["purchase-returnable", purchaseId],
    queryFn: () => getPurchaseReturnableFn({ data: { purchaseId: purchaseId! } }),
    enabled: !!purchaseId,
  });
}

export function useSupplierReturns(supplierId: string, queue: SupplierReturnQueue) {
  return useQuery({
    queryKey: ["supplier-returns", supplierId, queue],
    queryFn: () => listSupplierReturnsFn({ data: { supplierId, queue } }),
  });
}

export function useSupplierReturn(id: string | null) {
  return useQuery({ queryKey: ["supplier-return", id], queryFn: () => getSupplierReturnFn({ data: { id: id! } }), enabled: !!id });
}

export function useDebitNotePreview(id: string | null) {
  return useQuery({ queryKey: ["debit-note-preview", id], queryFn: () => previewDebitNoteFn({ data: { id: id! } }), enabled: !!id });
}

export async function invalidateSupplierReturnQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["supplier-returns"] }),
    queryClient.invalidateQueries({ queryKey: ["supplier-return"] }),
    queryClient.invalidateQueries({ queryKey: ["purchase-returnable"] }),
    queryClient.invalidateQueries({ queryKey: ["debit-note-preview"] }),
    queryClient.invalidateQueries({ queryKey: ["supplier"] }),
    queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    queryClient.invalidateQueries({ queryKey: ["activity-timeline"] }),
    invalidateFinanceQueries(queryClient),
  ]);
}

export function useSupplierReturnMutations() {
  const queryClient = useQueryClient();
  const done = (message: string) => async () => {
    await invalidateSupplierReturnQueries(queryClient);
    toast.success(message);
  };
  const failed = (error: Error) => toast.error(error.message);
  return {
    request: useMutation({ mutationFn: requestSupplierReturnFn, onSuccess: done("Return requested"), onError: failed }),
    dispatch: useMutation({ mutationFn: dispatchSupplierReturnFn, onSuccess: done("Marked as dispatched"), onError: failed }),
    complete: useMutation({ mutationFn: completeSupplierReturnFn, onSuccess: done("Debit note issued"), onError: failed }),
    cancel: useMutation({ mutationFn: cancelSupplierReturnFn, onSuccess: done("Return cancelled"), onError: failed }),
    voidNote: useMutation({ mutationFn: voidSupplierReturnFn, onSuccess: done("Debit note voided"), onError: failed }),
    useCredit: useMutation({ mutationFn: applySupplierCreditFn, onSuccess: done("Paid from supplier credit"), onError: failed }),
  };
}
```

- [ ] **Step 4: Implement the sheet**

```tsx
// src/components/suppliers/request-supplier-return-sheet.tsx
import Big from "big.js";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { usePurchaseReturnable, useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { supplierReturnValue } from "@/lib/suppliers/supplier-returns";

const QTY = /^\d+(\.\d{1,3})?$/;
const short = (value: string) => new Big(value).toString();

export function RequestSupplierReturnSheet({ open, onOpenChange, purchaseId }: { open: boolean; onOpenChange: (open: boolean) => void; purchaseId: string | null }) {
  const { data, isLoading } = usePurchaseReturnable(open ? purchaseId : null);
  const { request } = useSupplierReturnMutations();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (!open) { setQuantity(""); setReason(""); setNotes(""); } }, [open]);

  const valid = QTY.test(quantity) && new Big(quantity).gt(0);
  const tooMuch = !!data && valid && new Big(quantity).gt(data.max);
  const canSubmit = !!data && !data.blockedReason && valid && !tooMuch && reason.trim().length > 0 && !request.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Return to supplier"
      description={data ? `${data.materialName} back to ${data.supplierName}` : undefined}>
      {isLoading || !data ? <Skeleton className="h-40" /> : data.blockedReason ? (
        <p className="text-sm text-muted-foreground">{data.blockedReason}</p>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit || !purchaseId) return;
          await request.mutateAsync({ data: { purchaseId, quantity, reason: reason.trim(), notes: notes.trim() } });
          onOpenChange(false);
        }}>
          <FieldGroup>
            <p className="text-sm text-muted-foreground">Up to {short(data.max)} {data.unit} left of this purchase in {data.warehouseName}</p>
            <Field>
              <FieldLabel htmlFor="return-qty">Quantity ({data.unit})</FieldLabel>
              <Input id="return-qty" inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value.trim())} />
              {tooMuch && <FieldError>Only {short(data.max)} {data.unit} can go back</FieldError>}
              {valid && !tooMuch && <p className="text-sm font-medium">Debit note value: {formatRupees(supplierReturnValue(quantity, data.unitCost))}</p>}
            </Field>
            <Field>
              <FieldLabel htmlFor="return-reason">Why is it going back?</FieldLabel>
              <Input id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wet bags, wrong grade, extra delivered" />
            </Field>
            <Field>
              <FieldLabel htmlFor="return-notes">Notes (optional)</FieldLabel>
              <Textarea id="return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
            <p className="text-xs text-muted-foreground">Stock stays in the store until you mark the return as dispatched.</p>
            <Button type="submit" disabled={!canSubmit}>Request return</Button>
          </FieldGroup>
        </form>
      )}
    </ResponsiveDialog>
  );
}
```

Check `ResponsiveDialog`'s actual prop names in `src/components/custom/responsive-dialog.tsx` before using `title`/`description`; match whatever `record-payment-dialog.tsx` passes.

- [ ] **Step 5: Add the row action and render the sheet**

In `purchase-history-table.tsx`, add the prop `onReturnToSupplier?: (item: PurchaseRecord) => void;` to the props type and destructure it. In the per-row dropdown, next to "Record payment":

```tsx
{onReturnToSupplier && !record.voidedAt && (record.stockLeft ?? 0) > 0 && (
  <DropdownMenuItem onClick={() => onReturnToSupplier(record)}>
    <Undo2 className="size-3.5 mr-2" />
    Return to supplier
  </DropdownMenuItem>
)}
```

Import `Undo2` from the icon library the file already uses (lucide-react).

In both supplier route files: read the viewer's permissions the same way `canCreateReport` does, set `const canManageSuppliers = hasPermission(viewer?.permissions ?? [], "suppliers.manage");`, add `const [returnPurchaseId, setReturnPurchaseId] = useState<string | null>(null);`, pass `onReturnToSupplier={canManageSuppliers ? (r) => setReturnPurchaseId(r.id) : undefined}` to `PurchaseHistoryTable`, and render:

```tsx
<RequestSupplierReturnSheet open={!!returnPurchaseId} onOpenChange={(o) => { if (!o) setReturnPurchaseId(null); }} purchaseId={returnPurchaseId} />
```

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test src/__tests__/supplier-return-sheet.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/suppliers src/components/suppliers/request-supplier-return-sheet.tsx src/components/suppliers/purchase-history-table.tsx src/routes/_protected/suppliers src/__tests__/supplier-return-sheet.behavior.test.tsx
git commit -m "feat(suppliers): Return to supplier action on purchases"
```

---

### Task 11: Returns tab, complete dialog, cancel and void

**Files:**
- Create: `src/components/suppliers/supplier-returns-panel.tsx`
- Create: `src/components/suppliers/complete-supplier-return-dialog.tsx`
- Create: `src/components/suppliers/supplier-return-reason-dialog.tsx`
- Modify: `src/routes/_protected/suppliers/$supplierId.tsx` (third tab; credit line on the Outstanding card)
- Test: `src/__tests__/supplier-returns-panel.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 10 hooks; `SupplierReturnRow` (Task 8); `getWalletsListFn` from `@/server-functions/finance-fn` (query key `["wallets"]`, same as the delete-purchase dialog).
- Produces:
  - `<SupplierReturnsPanel supplierId canManage />`
  - `<CompleteSupplierReturnDialog open onOpenChange returnId />`
  - `<SupplierReturnReasonDialog open onOpenChange mode: "cancel" | "void" row: SupplierReturnRow | null />`

- [ ] **Step 1: Write the failing behaviour test**

```tsx
// src/__tests__/supplier-returns-panel.behavior.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierReturnsPanel } from "@/components/suppliers/supplier-returns-panel";
import { CompleteSupplierReturnDialog } from "@/components/suppliers/complete-supplier-return-dialog";

const fns = vi.hoisted(() => ({
  dispatch: vi.fn(async (_i: unknown) => ({ returnNumber: "SR-0001", quantity: "10.000" })),
  complete: vi.fn(async (_i: unknown) => ({ debitNoteNumber: "DN-0001", applied: "0.00", refund: "2000.00", credit: "3000.00" })),
}));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: vi.fn(), getPurchaseReturnableFn: vi.fn(), listSupplierReturnsFn: vi.fn(), getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(), dispatchSupplierReturnFn: fns.dispatch, completeSupplierReturnFn: fns.complete,
  cancelSupplierReturnFn: vi.fn(), voidSupplierReturnFn: vi.fn(), applySupplierCreditFn: vi.fn(),
}));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));

const row = {
  id: "r1", returnNumber: "SR-0001", status: "requested", requestedAt: new Date("2026-11-27"), dispatchedAt: null, completedAt: null,
  materialName: "Soda Ash", unit: "kg", warehouseName: "Main Store", quantity: "10.000", unitCost: "500.00", totalAmount: "5000.00",
  reason: "Wet", notes: null, debitNoteNumber: null, appliedToPurchaseAmount: "0.00", refundAmount: "0.00", refundWalletName: null,
  supplierCreditAmount: "0.00", purchaseInvoiceNumber: "INV-9", purchaseDate: new Date("2026-11-20"), cancelReason: null, voidReason: null, requestedByName: "Ahmed",
};

function client() {
  const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  c.setQueryData(["supplier-returns", "s1", "to_dispatch"], { rows: [row], counts: { to_dispatch: 1, dispatched: 0, done: 2 } });
  c.setQueryData(["wallets"], [{ id: "cash", name: "Cash in Hand", type: "cash", balance: "1000.00" }]);
  c.setQueryData(["debit-note-preview", "r1"], { value: "5000.00", owedBefore: "0.00", applied: "0.00", leftover: "5000.00", supplierName: "Ali Traders" });
  return c;
}

describe("Supplier returns tab", () => {
  afterEach(() => { cleanup(); fns.dispatch.mockClear(); fns.complete.mockClear(); });

  it("opens on To dispatch with counts and one primary action", async () => {
    render(<QueryClientProvider client={client()}><SupplierReturnsPanel supplierId="s1" canManage /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "To dispatch (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done (2)" })).toBeTruthy();
    expect(screen.getByText("10 kg Soda Ash")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    await waitFor(() => expect(fns.dispatch).toHaveBeenCalledWith({ data: { id: "r1" } }));
  });

  it("hides actions from view-only users", () => {
    render(<QueryClientProvider client={client()}><SupplierReturnsPanel supplierId="s1" canManage={false} /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "Mark as dispatched" })).toBeNull();
  });

  it("shows the money consequence and splits cash back from credit before completing", async () => {
    render(<QueryClientProvider client={client()}><CompleteSupplierReturnDialog open onOpenChange={vi.fn()} returnId="r1" /></QueryClientProvider>);
    expect(screen.getByText("Rs 5,000 is more than this purchase still owes.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Cash back from supplier (PKR)"), { target: { value: "2000" } });
    expect(screen.getByText("Rs 3,000 stays with Ali Traders as supplier credit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete and issue debit note" }));
    await waitFor(() => expect(fns.complete).toHaveBeenCalledWith({ data: { id: "r1", cashBack: "2000", refundWalletId: "cash" } }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/__tests__/supplier-returns-panel.behavior.test.tsx`
Expected: FAIL, components missing.

- [ ] **Step 3: Implement the panel**

```tsx
// src/components/suppliers/supplier-returns-panel.tsx
import Big from "big.js";
import { format } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierReturnMutations, useSupplierReturns } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SUPPLIER_RETURN_STATUS_LABELS, type SupplierReturnQueue } from "@/lib/suppliers/supplier-returns";
import type { SupplierReturnRow } from "@/lib/suppliers/supplier-returns.server";
import { CompleteSupplierReturnDialog } from "./complete-supplier-return-dialog";
import { DebitNotePrintDialog } from "./debit-note-print-dialog";
import { SupplierReturnReasonDialog } from "./supplier-return-reason-dialog";

const QUEUES: { key: SupplierReturnQueue; label: string }[] = [
  { key: "to_dispatch", label: "To dispatch" },
  { key: "dispatched", label: "Dispatched" },
  { key: "done", label: "Done" },
];

export function SupplierReturnsPanel({ supplierId, canManage }: { supplierId: string; canManage: boolean }) {
  const [queue, setQueue] = useState<SupplierReturnQueue>("to_dispatch");
  const { data, isLoading } = useSupplierReturns(supplierId, queue);
  const { dispatch } = useSupplierReturnMutations();
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const [reason, setReason] = useState<{ mode: "cancel" | "void"; row: SupplierReturnRow } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <Button key={q.key} size="sm" variant={queue === q.key ? "default" : "outline"} onClick={() => setQueue(q.key)}>
            {q.label} ({data?.counts[q.key] ?? 0})
          </Button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-24" /> : !data?.rows.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {queue === "to_dispatch" ? "Nothing waiting to go back. Use Return to supplier on a purchase to start one." : "No returns here."}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {data.rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{new Big(row.quantity).toString()} {row.unit} {row.materialName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.debitNoteNumber ?? row.returnNumber} · {format(row.requestedAt, "d MMM yyyy")} · {row.warehouseName} · {row.reason}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{formatRupees(row.totalAmount)}</span>
                {queue === "done" && <Badge variant={row.status === "completed" ? "default" : "secondary"}>{SUPPLIER_RETURN_STATUS_LABELS[row.status]}</Badge>}
                {canManage && row.status === "requested" && (
                  <Button size="sm" disabled={dispatch.isPending} onClick={() => dispatch.mutate({ data: { id: row.id } })}>Mark as dispatched</Button>
                )}
                {canManage && row.status === "dispatched" && (
                  <Button size="sm" onClick={() => setCompleteId(row.id)}>Complete and issue debit note</Button>
                )}
                {(row.status === "completed" || (canManage && (row.status === "requested" || row.status === "dispatched"))) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="More actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {row.status === "completed" && <DropdownMenuItem onClick={() => setPrintId(row.id)}>Print debit note</DropdownMenuItem>}
                      {canManage && row.status === "completed" && <DropdownMenuItem onClick={() => setReason({ mode: "void", row })}>Void debit note</DropdownMenuItem>}
                      {canManage && (row.status === "requested" || row.status === "dispatched") && <DropdownMenuItem onClick={() => setReason({ mode: "cancel", row })}>Cancel return</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CompleteSupplierReturnDialog open={!!completeId} onOpenChange={(o) => { if (!o) setCompleteId(null); }} returnId={completeId} />
      <SupplierReturnReasonDialog open={!!reason} onOpenChange={(o) => { if (!o) setReason(null); }} mode={reason?.mode ?? "cancel"} row={reason?.row ?? null} />
      <DebitNotePrintDialog open={!!printId} onOpenChange={(o) => { if (!o) setPrintId(null); }} returnId={printId} />
    </div>
  );
}
```

`DebitNotePrintDialog` is built in Task 12. To keep this task self-contained, create it now as a minimal stub in `src/components/suppliers/debit-note-print-dialog.tsx`:

```tsx
export function DebitNotePrintDialog(_props: { open: boolean; onOpenChange: (open: boolean) => void; returnId: string | null }) {
  return null;
}
```

Task 12 replaces the body.

`SupplierReturnRow` is a type-only import from a `.server.ts` file. If the bundler complains, move the `SupplierReturnRow` type to `src/lib/suppliers/supplier-returns.ts` and re-export it from the server file.

- [ ] **Step 4: Implement the complete dialog**

```tsx
// src/components/suppliers/complete-supplier-return-dialog.tsx
import Big from "big.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebitNotePreview, useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { getWalletsListFn } from "@/server-functions/finance-fn";

const MONEY = /^\d+(\.\d{1,2})?$/;

export function CompleteSupplierReturnDialog({ open, onOpenChange, returnId }: { open: boolean; onOpenChange: (open: boolean) => void; returnId: string | null }) {
  const { data: preview } = useDebitNotePreview(open ? returnId : null);
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWalletsListFn(), enabled: open });
  const { complete } = useSupplierReturnMutations();
  const [cashBack, setCashBack] = useState("");
  const [walletId, setWalletId] = useState("");
  useEffect(() => { if (!open) { setCashBack(""); setWalletId(""); } }, [open]);
  useEffect(() => { if (!walletId && wallets.length) setWalletId(wallets[0].id); }, [wallets, walletId]);

  if (!preview) return <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Complete return"><Skeleton className="h-32" /></ResponsiveDialog>;

  const leftover = new Big(preview.leftover);
  const cashValid = cashBack === "" || MONEY.test(cashBack);
  const cash = cashValid && cashBack ? new Big(cashBack) : new Big(0);
  const tooMuch = cash.gt(leftover);
  const credit = tooMuch ? new Big(0) : leftover.minus(cash);
  const owedAfter = new Big(preview.owedBefore).minus(preview.applied);
  const canSubmit = cashValid && !tooMuch && (cash.eq(0) || !!walletId) && !complete.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Complete return" description={`Debit note worth ${formatRupees(preview.value)} for ${preview.supplierName}`}>
      <FieldGroup>
        {new Big(preview.applied).gt(0) && (
          <p className="text-sm">What we owe on this purchase goes from {formatRupees(preview.owedBefore)} to {formatRupees(owedAfter.toFixed(2))}.</p>
        )}
        {leftover.gt(0) && (
          <>
            <p className="text-sm">{formatRupees(preview.leftover)} is more than this purchase still owes.</p>
            <Field>
              <FieldLabel htmlFor="cash-back">Cash back from supplier (PKR)</FieldLabel>
              <Input id="cash-back" inputMode="decimal" value={cashBack} onChange={(e) => setCashBack(e.target.value.trim())} placeholder="0" />
              {!cashValid && <FieldError>Enter an amount with at most 2 decimals</FieldError>}
              {tooMuch && <FieldError>Cash back can't be more than {formatRupees(preview.leftover)}</FieldError>}
            </Field>
            {cash.gt(0) && (
              <Field>
                <FieldLabel>Into account</FieldLabel>
                <Select value={walletId} onValueChange={setWalletId}>
                  <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                  <SelectContent>{wallets.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {credit.gt(0) && <p className="text-sm text-muted-foreground">{formatRupees(credit.toFixed(2))} stays with {preview.supplierName} as supplier credit</p>}
          </>
        )}
        <Button disabled={!canSubmit} onClick={async () => {
          if (!returnId) return;
          await complete.mutateAsync({ data: { id: returnId, ...(cash.gt(0) ? { cashBack, refundWalletId: walletId } : {}) } });
          onOpenChange(false);
        }}>Complete and issue debit note</Button>
      </FieldGroup>
    </ResponsiveDialog>
  );
}
```

Check what `getWalletsListFn` returns (array vs `{ data }`) in `src/server-functions/finance-fn.ts` and adapt the destructuring; the delete-purchase dialog already uses it with key `["wallets"]`.

- [ ] **Step 5: Implement the reason dialog**

```tsx
// src/components/suppliers/supplier-return-reason-dialog.tsx
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { SupplierReturnRow } from "@/lib/suppliers/supplier-returns.server";
import Big from "big.js";

export function SupplierReturnReasonDialog({ open, onOpenChange, mode, row }: { open: boolean; onOpenChange: (open: boolean) => void; mode: "cancel" | "void"; row: SupplierReturnRow | null }) {
  const { cancel, voidNote } = useSupplierReturnMutations();
  const [reason, setReason] = useState("");
  useEffect(() => { if (!open) setReason(""); }, [open]);
  if (!row) return null;
  const qty = `${new Big(row.quantity).toString()} ${row.unit} ${row.materialName}`;
  const consequences = mode === "cancel"
    ? [row.status === "dispatched" ? `${qty} goes back into ${row.warehouseName}.` : "Nothing has moved yet; the request is closed."]
    : [
        `${qty} goes back into ${row.warehouseName}.`,
        new Big(row.appliedToPurchaseAmount).gt(0) ? `What we owe on the purchase goes up by ${formatRupees(row.appliedToPurchaseAmount)}.` : null,
        new Big(row.refundAmount).gt(0) ? `${formatRupees(row.refundAmount)} comes out of ${row.refundWalletName ?? "the account"} again. It can go below zero.` : null,
        new Big(row.supplierCreditAmount).gt(0) ? `${formatRupees(row.supplierCreditAmount)} supplier credit is taken back.` : null,
      ].filter((line): line is string => !!line);
  const pending = cancel.isPending || voidNote.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={mode === "cancel" ? `Cancel ${row.returnNumber}` : `Void ${row.debitNoteNumber}`}>
      <FieldGroup>
        <ul className="list-disc pl-5 text-sm">{consequences.map((line) => <li key={line}>{line}</li>)}</ul>
        <Field>
          <FieldLabel htmlFor="return-reason-text">Reason</FieldLabel>
          <Textarea id="return-reason-text" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <Button variant="destructive" disabled={!reason.trim() || pending} onClick={async () => {
          const input = { data: { id: row.id, reason: reason.trim() } };
          if (mode === "cancel") await cancel.mutateAsync(input); else await voidNote.mutateAsync(input);
          onOpenChange(false);
        }}>{mode === "cancel" ? "Cancel return" : "Void debit note"}</Button>
      </FieldGroup>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 6: Put the tab and the credit line on the supplier page**

In `$supplierId.tsx`:
- Add a third `TabsTrigger value="returns"` labelled "Returns" (icon `Undo2`) after Recent Payments, and
  `<TabsContent value="returns" className="mt-0"><SupplierReturnsPanel supplierId={supplierId} canManage={canManageSuppliers} /></TabsContent>`.
- On the Outstanding Balance `StatCard`, change `sub` to show credit when there is some:

```tsx
              sub={Number(supplier.supplierCredit) > 0
                ? `Supplier credit ${formatRupees(supplier.supplierCredit)}`
                : isOverdue ? "View unpaid purchases" : "Fully paid — no dues"}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `bun run test src/__tests__/supplier-returns-panel.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/suppliers/supplier-returns-panel.tsx src/components/suppliers/complete-supplier-return-dialog.tsx src/components/suppliers/supplier-return-reason-dialog.tsx src/components/suppliers/debit-note-print-dialog.tsx src/routes/_protected/suppliers/\$supplierId.tsx src/__tests__/supplier-returns-panel.behavior.test.tsx
git commit -m "feat(suppliers): Returns tab with dispatch, complete, cancel and void"
```

---

### Task 12: Debit note print and "Use supplier credit" in the payment dialog

**Files:**
- Modify: `src/components/suppliers/debit-note-print-dialog.tsx` (replace the stub)
- Modify: `src/components/suppliers/record-payment-dialog.tsx`
- Modify: `src/routes/_protected/suppliers/$supplierId.tsx`, `$supplierId_.details.tsx` (pass `supplierCredit` to the dialog)
- Test: `src/__tests__/supplier-credit-payment.behavior.test.tsx`

**Interfaces:**
- Consumes: `useSupplierReturn` and `useSupplierReturnMutations().useCredit` (Task 10).
- Produces: `RecordPaymentDialog` gains optional prop `supplierCredit?: string`.

- [ ] **Step 1: Write the failing behaviour test**

```tsx
// src/__tests__/supplier-credit-payment.behavior.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordPaymentDialog } from "@/components/suppliers/record-payment-dialog";

const credit = vi.hoisted(() => vi.fn(async (_i: unknown) => ({ paymentId: "pay1", balanceAfter: "1000.00" })));
vi.mock("@/server-functions/suppliers/supplier-returns-fn", () => ({
  requestSupplierReturnFn: vi.fn(), getPurchaseReturnableFn: vi.fn(), listSupplierReturnsFn: vi.fn(), getSupplierReturnFn: vi.fn(),
  previewDebitNoteFn: vi.fn(), dispatchSupplierReturnFn: vi.fn(), completeSupplierReturnFn: vi.fn(),
  cancelSupplierReturnFn: vi.fn(), voidSupplierReturnFn: vi.fn(), applySupplierCreditFn: credit,
}));
vi.mock("@/server-functions/suppliers/add-payment-fn", () => ({ addPaymentFn: vi.fn() }));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn(async () => []) }));

function open(supplierCredit?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <RecordPaymentDialog open onOpenChange={vi.fn()} supplierId="s1" supplierName="Ali Traders" outstandingBalance={21000} purchaseId="p2" defaultAmount="21000" supplierCredit={supplierCredit} />
  </QueryClientProvider>);
}

describe("Use supplier credit", () => {
  afterEach(() => { cleanup(); credit.mockClear(); });

  it("offers the credit, up to what is owed", async () => {
    open("3000.00");
    expect(screen.getByText("Supplier credit Rs 3,000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use supplier credit" }));
    await waitFor(() => expect(credit).toHaveBeenCalledWith({ data: { purchaseId: "p2", amount: "3000.00" } }));
  });

  it("hides the offer when there is no credit or no purchase", () => {
    open("0.00");
    expect(screen.queryByRole("button", { name: "Use supplier credit" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/__tests__/supplier-credit-payment.behavior.test.tsx`
Expected: FAIL, the credit line is not rendered.

- [ ] **Step 3: Add credit to the payment dialog**

In `record-payment-dialog.tsx`:
- Add `supplierCredit?: string;` to `Props` and destructure it.
- Add:

```tsx
  const { useCredit } = useSupplierReturnMutations();
  const creditAvailable = supplierCredit ? new Big(supplierCredit) : new Big(0);
  const creditToUse = creditAvailable.lt(outstandingBalance) ? creditAvailable : new Big(outstandingBalance);
```

- Render, at the top of the form body, only when `purchaseId && creditToUse.gt(0)`:

```tsx
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 p-3">
          <span className="text-sm">Supplier credit {formatRupees(creditAvailable.toFixed(2))}</span>
          <Button type="button" size="sm" variant="outline" disabled={useCredit.isPending} onClick={async () => {
            await useCredit.mutateAsync({ data: { purchaseId: purchaseId!, amount: creditToUse.toFixed(2) } });
            onOpenChange(false);
          }}>Use supplier credit</Button>
        </div>
```

Imports: `Big` from `big.js`, `formatRupees`, `useSupplierReturnMutations`.

In both supplier routes, pass `supplierCredit={supplier.supplierCredit}` to `RecordPaymentDialog`, and make sure `outstandingBalance` passed for a purchase is `purchaseOwed(item)` (Task 9 already set `remainingBalance` that way).

- [ ] **Step 4: Build the debit note print**

Replace the stub with a dialog shaped like `src/components/sales/credit-note-print-dialog.tsx`: same `escapeHtml`, same popup-blocked toast, same table styling. Content:

```tsx
// src/components/suppliers/debit-note-print-dialog.tsx
import Big from "big.js";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplierReturn } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function DebitNotePrintDialog({ open, onOpenChange, returnId }: { open: boolean; onOpenChange: (open: boolean) => void; returnId: string | null }) {
  const { data, isLoading } = useSupplierReturn(open ? returnId : null);

  const handlePrint = () => {
    if (!data) return;
    const win = window.open("", "_blank");
    if (!win) { toast.error("Popup blocked. Please allow popups for this site to print."); return; }
    const cell = "border:1px solid #cbd5e1;padding:6px 8px;";
    const lines = [
      ["Taken off what we owe", data.appliedToPurchaseAmount],
      ["Cash back" + (data.refundWalletName ? ` (${data.refundWalletName})` : ""), data.refundAmount],
      ["Kept as supplier credit", data.supplierCreditAmount],
    ].filter(([, amount]) => new Big(amount).gt(0));
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(data.debitNoteNumber)}</title></head>
<body style="font-family:system-ui,sans-serif;color:#0f172a;padding:24px;">
<h1 style="margin:0 0 4px;">Debit Note ${escapeHtml(data.debitNoteNumber)}</h1>
<p style="margin:0 0 16px;color:#475569;">${escapeHtml(format(data.completedAt ?? data.requestedAt, "d MMM yyyy"))} · Return ${escapeHtml(data.returnNumber)}${data.status === "voided" ? " · VOIDED" : ""}</p>
<p><strong>To:</strong> ${escapeHtml(data.supplierName)}${data.supplierPhone ? ` · ${escapeHtml(data.supplierPhone)}` : ""}${data.supplierAddress ? `<br/>${escapeHtml(data.supplierAddress)}` : ""}</p>
<p><strong>Against purchase:</strong> ${escapeHtml(data.purchaseInvoiceNumber ?? "—")} of ${escapeHtml(format(data.purchaseDate, "d MMM yyyy"))}</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0;">
<thead><tr><th style="${cell}text-align:left;">Item</th><th style="${cell}text-align:right;">Quantity</th><th style="${cell}text-align:right;">Rate</th><th style="${cell}text-align:right;">Amount</th></tr></thead>
<tbody><tr><td style="${cell}">${escapeHtml(data.materialName)}</td><td style="${cell}text-align:right;">${escapeHtml(new Big(data.quantity).toString())} ${escapeHtml(data.unit)}</td>
<td style="${cell}text-align:right;">${escapeHtml(formatRupees(data.unitCost))}</td><td style="${cell}text-align:right;font-weight:600;">${escapeHtml(formatRupees(data.totalAmount))}</td></tr></tbody>
</table>
<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>
${lines.map(([label, amount]) => `<p>${escapeHtml(label)}: <strong>${escapeHtml(formatRupees(amount))}</strong></p>`).join("")}
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`);
    win.document.close();
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={data?.debitNoteNumber ? `Debit note ${data.debitNoteNumber}` : "Debit note"}>
      {isLoading || !data ? <Skeleton className="h-24" /> : (
        <div className="space-y-3 text-sm">
          <p>{new Big(data.quantity).toString()} {data.unit} {data.materialName} back to {data.supplierName}: {formatRupees(data.totalAmount)}</p>
          <Button onClick={handlePrint}><Printer className="mr-2 size-4" />Print</Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run test src/__tests__/supplier-credit-payment.behavior.test.tsx src/__tests__/supplier-returns-panel.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/suppliers/debit-note-print-dialog.tsx src/components/suppliers/record-payment-dialog.tsx src/routes/_protected/suppliers src/__tests__/supplier-credit-payment.behavior.test.tsx
git commit -m "feat(suppliers): print debit notes and pay with supplier credit"
```

---

### Task 13: Monthly report nets debit notes off purchases

**Files:**
- Modify: `src/server-functions/reports/monthly-report-queries.server.ts` (the year query list ~line 68–175, the purchase maps ~216–220, and the drill-down ~482–513)
- Modify: `src/__tests__/integration/monthly-report.test.ts` (or the closest existing monthly report integration suite)

**Interfaces:**
- Consumes: `supplierReturns` (Task 2).
- Produces: no new exports; `purchaseRawMaterial` / `purchasePacking` month values are net of completed debit notes; drill-down rows include negative debit-note rows.

- [ ] **Step 1: Write the failing test**

Open `src/__tests__/integration/monthly-report.test.ts`, reuse its fixture style, and add:

```ts
it("takes completed debit notes off the month's raw material bought", () => withRollback(async (tx) => {
  // Use the supplier-return fixture pattern from src/__tests__/integration/supplier-returns.test.ts:
  // buy 100 kg at Rs 500 (Rs 50,000) this month, request + dispatch + complete a 10 kg return (Rs 5,000).
  // Then:
  const report = await loadMonthlyReport(startYear, todayKey);
  const month = todayKey.slice(0, 7);
  expect(lineValue(report, "purchaseRawMaterial", month)).toBe("45000.00");
  const detail = await loadMonthlyReportDetail({ line: "purchaseRawMaterial", month });
  expect(detail.rows.some((r) => r.reference.startsWith("DN-") && r.amount === "-5000.00")).toBe(true);
}));
```

Replace `lineValue` and `loadMonthlyReportDetail` with the helper and function names that suite already uses to read a line's month value and the drill-down (search the file for `purchaseRawMaterial`). If the suite has no such reader, add a small local helper that finds the line in `report` and reads the month. Write the fixture steps out in full in the test (copy `supplierReturnFixture` into a shared `src/__tests__/integration/supplier-return-fixture.ts` and import it from both suites, rather than importing one test file from another).

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run -c vitest.integration.config.ts src/__tests__/integration/monthly-report.test.ts`
Expected: FAIL, value is `50000.00`.

- [ ] **Step 3: Implement**

Add `supplierReturns` to the imports (`@/db/schemas/supplier-schema`). Add one more query to the `Promise.all` list and destructure it as `debitNoteRows`:

```ts
    db
      .select({ type: supplierReturns.materialType, date: supplierReturns.completedAt, amount: supplierReturns.totalAmount })
      .from(supplierReturns)
      .where(
        and(
          eq(supplierReturns.status, "completed"),
          gte(supplierReturns.completedAt, fromDate),
          lte(supplierReturns.completedAt, toDate),
        ),
      ),
```

After the purchase loop:

```ts
  // Debit notes lower what was bought, in the month the supplier accepted the goods back.
  for (const row of debitNoteRows) {
    const negative = new Big(row.amount).times(-1).toFixed(2);
    if (row.type === "chemical") addDated(purchaseRawMaterial, row.date, negative);
    else if (row.type === "packaging") addDated(purchasePacking, row.date, negative);
  }
```

In the drill-down branch, after loading purchase `rows`, load debit notes for the same month and material type and append them:

```ts
    const notes = await db
      .select({
        date: supplierReturns.completedAt,
        number: supplierReturns.debitNoteNumber,
        quantity: supplierReturns.quantity,
        chemical: chemicals.name,
        chemicalUnit: chemicals.unit,
        packaging: packagingMaterials.name,
        supplier: suppliers.supplierName,
        amount: supplierReturns.totalAmount,
      })
      .from(supplierReturns)
      .leftJoin(chemicals, eq(supplierReturns.chemicalId, chemicals.id))
      .leftJoin(packagingMaterials, eq(supplierReturns.packagingMaterialId, packagingMaterials.id))
      .innerJoin(suppliers, eq(supplierReturns.supplierId, suppliers.id))
      .where(
        and(
          eq(supplierReturns.materialType, line === "purchaseRawMaterial" ? "chemical" : "packaging"),
          eq(supplierReturns.status, "completed"),
          gte(supplierReturns.completedAt, fromDate),
          lte(supplierReturns.completedAt, toDate),
        ),
      );
```

and build the detail rows as the purchase rows followed by:

```ts
      ...notes.map((row) => ({
        date: reportDateKey(row.date!),
        reference: row.number ?? "",
        description: `Returned ${new Big(row.quantity).toString()} ${row.chemical ? (row.chemicalUnit ?? "kg") : "units"} ${row.chemical ?? row.packaging ?? "material"} to ${row.supplier}`,
        amount: money(new Big(row.amount).times(-1).toFixed(2)),
      })),
```

If `money()` or `addToMonth` reject negative strings, fix them to accept a leading minus (they should only format/sum).

- [ ] **Step 4: Run tests**

Run: `bunx vitest run -c vitest.integration.config.ts src/__tests__/integration/monthly-report.test.ts src/__tests__/integration/supplier-returns.test.ts && bun run test src/__tests__/monthly-report.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/reports/monthly-report-queries.server.ts src/__tests__/integration
git commit -m "feat(reports): monthly purchases net of supplier debit notes"
```

---

### Task 14: Final checks

- [ ] **Step 1: Full test, typecheck and build**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all pass. Then run the whole integration suite: `bunx vitest run -c vitest.integration.config.ts`.

- [ ] **Step 2: Browser walkthrough (once, at the end)**

With `bun run dev` and a local DB that has a supplier with a purchase:
1. Purchase menu → Return to supplier → 10 kg, "Wet bags" → Request return. Returns tab shows it under To dispatch.
2. Mark as dispatched → store stock drops by 10 kg; the purchase row's stock left drops.
3. Complete and issue debit note on an unpaid purchase → Outstanding Balance drops by the value; purchase badge goes Partial.
4. Repeat on a fully paid purchase with Rs 2,000 cash back into Cash in Hand → wallet up Rs 2,000; header shows "Supplier credit Rs 3,000".
5. Record payment on another purchase → Use supplier credit → credit drops; payment shows "Supplier credit".
6. Try to edit/delete the purchase with the completed return → refused with the SR number.
7. Void the debit note → refused while credit is spent; works after the credit-paid purchase is deleted (credit given back).
8. Print debit note. Check the monthly report raw material line and its drill-down.
9. Log in as a `suppliers.view`-only user: Returns tab visible, no action buttons, no Return to supplier menu item.

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Commit anything left**

```bash
git status
git add -A src
git commit -m "chore(suppliers): supplier returns final touches" # only if there are changes
```

## Self-review notes

- Spec coverage: Requested → Dispatched → Completed flow (Tasks 3–5, 11); completion reduces raw material/packaging stock (moved to Dispatched by decision 3, Task 4); debit note that reduces what is owed (Tasks 5, 9); consuming returned damaged stock from Fix 2 is out by decision 1; "mistakes are fixable" via cancel and void (Tasks 3, 4, 6); money consequence before the click (Tasks 10, 11); work-queue tabs (Task 11); readable numbers via `formatRupees` throughout.
- Leftover handling follows decision 8 (cash back, credit, or both), with credit used on later payments (Tasks 7, 12) and given back when such a purchase is deleted (Task 7).
- Names used across tasks: `requestSupplierReturn`, `dispatchSupplierReturn`, `completeSupplierReturn`, `cancelSupplierReturn`, `voidSupplierReturn`, `applySupplierCredit`, `supplierCreditBalance`, `previewDebitNote`, `listSupplierReturns`, `getSupplierReturn`, `returnableForPurchase`, `assertPurchaseHasNoActiveReturn`, `restoreCreditUsedOnPurchase`, and the `*Fn` wrappers in Task 8. The hooks in Task 10 call exactly those `*Fn` names.
