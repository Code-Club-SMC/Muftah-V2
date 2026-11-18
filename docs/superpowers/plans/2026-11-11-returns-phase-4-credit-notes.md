# Returns Phase 4: Credit Notes, Customer Store Credit, and Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or inline task-by-task execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the sales-return financial loop by issuing sequential printable credit notes (`CN-XXXX`) on return completion, capping invoice return reduction cleanly at open balance (`outstandingAmount >= 0`), pooling excess into FIFO customer store credit lots (`customer_credit_lots`), allowing back-office store credit application (`customer_credit`) on invoices and slip recoveries, supporting cash/bank customer refunds and refund reversals, handling return voiding cleanly (blocking when refunded cash is active; auto-unapplying applied store credit with split-lot preservation), and keeping ledgers, daily closing, and P&L reconciliation exact.

**Architecture:** All schema changes originate exclusively in Drizzle schemas (`src/db/schemas/sales-schema.ts`, `sales-erp-schema.ts`) and deploy through a single generated migration (`bun run db:generate`), with an idempotent in-app safety initializer (`ensureCreditNotesBackfilled`) for non-production rows. Transactional store credit accounting lives in a dedicated server domain service (`src/server-functions/sales/customer-credit-service.ts`) invoked inside database transactions alongside `settlement-service.ts` and `sales-returns-fn.ts`. Browser-facing server functions keep `@/db` dynamically imported (`await import("@/db")`) and enforce `finance.refunds.issue` (with multi-source backfill from `finance.manage` and `inventory.returns.receive`) and `finance.payments.reverse || finance.manage`.

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, React 19, Drizzle ORM + PostgreSQL, Zod, Big.js, Vitest, Testing Library, shadcn/ui + Tailwind CSS v4.

---

## Global Constraints

1. **Order Booker Portal strictly untouched:** Never modify, wire into, or add features to `src/routes/_protected/order-booker/*`, `src/server-functions/sales/order-booker-self-service-fn.ts`, `src/hooks/sales/use-order-booker-self-service.ts`, or `src/components/order-booker/*`. Preserve backward compatibility of `recordRecoveryPayment(tx, ...)`.
2. **Generated migrations immutable:** Never edit, rename, delete, or reorder existing files under `src/db/migrations/` (SQL, snapshots, or `meta/_journal.json`). Only mutate Drizzle schema `.ts` files and run `bun run db:generate`. Never manually modify `src/routeTree.gen.ts`.
3. **Browser-facing server function safety:** `invoices-fn.ts`, `invoice-detail-fn.ts`, `invoice-timeline-fn.ts`, `sales-returns-fn.ts`, and `customer-credit-fn.ts` must NOT have top-level `import { db } from "@/db"`; load via `const { db } = await import("@/db");` inside handlers. `customer-credit-service.ts` accepts `tx`/`db` parameters and only uses `import type { db as rootDb } from "@/db";`.
4. **Leave unrelated dirty files alone:** Keep `docker-compose.yml` and `docs/Monthly Report.xlsx` unstaged and untouched.

## File Structure

| Area | File | Role |
|---|---|---|
| Schemas | `src/db/schemas/sales-schema.ts`, `src/db/schemas/sales-erp-schema.ts`, `src/db/index.ts` | Add `creditBalance`, `excessCreditedAmount`, return CN/split columns, `customer_credit` payment method, and 6 credit/refund tables + relations + exports. |
| Schema tests | `src/db/schemas/invoice-settlement-schema.test.ts`, `src/db/schemas/credit-notes-schema.test.ts` | Enforce column, constraint, index, and migration immutability contracts. |
| RBAC | `src/lib/rbac.ts`, `src/lib/authz.server.ts`, `src/lib/middlewares.ts` | Add `finance.refunds.issue`, multi-source `PERMISSION_BACKFILLS`, `requireFinanceRefundsIssueMiddleware`, and `requireFinancePaymentReversalOrManageMiddleware`. |
| RBAC tests | `src/lib/sales-returns-access.test.ts`, `src/lib/credit-notes-access.test.ts` | Verify permissions, role seeds, multi-source backfills, and middleware gating. |
| Pure domain | `src/lib/sales/settlement/contracts.ts`, `src/lib/sales/settlement/math.ts`, `src/lib/sales/returns/return-lifecycle.ts`, `src/db/zod_schemas.ts` | Add `customer_credit` payment method, return credit split calculation (`computeReturnCreditSplit`), CN formatting (`formatCreditNoteNumber`). |
| Domain service | `src/server-functions/sales/customer-credit-service.ts` | Atomic `CN-XXXX` counter, FIFO credit lot issuance/application/reversal/refund/void/overage reclaim, idempotent `ensureCreditNotesBackfilled`. |
| Pure & service tests | `src/lib/sales/settlement/math.test.ts`, `src/lib/sales/returns/return-lifecycle.test.ts`, `src/server-functions/sales/customer-credit-service.test.ts` | Unit tests covering split math, CN numbers, FIFO conservation, split-lot void, overage reclaim, and refund blocking. |
| Settlement & Sales fns | `src/server-functions/sales/settlement-service.ts`, `src/server-functions/sales/sales-returns-fn.ts`, `src/server-functions/sales/invoice-posting-service.ts`, `src/server-functions/sales/invoices-fn.ts`, `src/server-functions/sales/reconciliation-fn.ts`, `src/server-functions/sales/payment-settlement-fn.ts`, `src/server-functions/sales/customer-credit-fn.ts` | Complete settlement integration, delayed overage creation/pullback, single payment reversal of `customer_credit`, credit summary/refund/reverse server actions. |
| Server fn tests | `src/server-functions/sales/settlement-service.integration.test.ts`, `src/server-functions/sales/customer-credit-fn.test.ts`, `src/lib/sales-workflows.test.ts` | Test settlement invariants, server validation, and no top-level `@/db` imports. |
| Ledger, Closing & P&L | `src/lib/ledger-types.ts`, `src/server-functions/sales/ledger-fn.ts`, `src/server-functions/sales/customers-fn.ts`, `src/server-functions/sales/sales-config-fn.ts`, `src/server-functions/reports/profit-loss/company-reporting-core.ts`, `src/components/finance/ledger-container.tsx` | Chronological ledger (`CN-XXXX`, zero-delta `customer_credit`, `+refund`, `-refund_reversal`), daily closing `totalCreditApplied`, P&L non-expense refund tracking. |
| Accounting tests | `src/lib/ledger-events.test.ts`, `src/lib/pnl-reporting.test.ts`, `src/lib/daily-closing-credit.test.ts` | Verify ledger equation, P&L exclusion + bridge category, and daily closing totals. |
| Hooks & UI | `src/hooks/sales/use-customer-credit.ts`, `src/hooks/sales/use-sales-returns.ts`, `src/hooks/sales/use-invoices.ts`, `src/hooks/sales/use-payment-settlement.ts`, `src/components/finance/overdraw-confirm-dialog.tsx`, `src/components/finance/payment-verification-page.tsx`, `src/components/sales/credit-note-print-dialog.tsx`, `src/components/sales/return-lifecycle-actions.tsx`, `src/components/sales/returns/return-actions.tsx`, `src/components/sales/create-invoice-form/payment-rows-field.tsx`, `src/components/sales/create-invoice-form/settlement-section.tsx`, `src/components/sales/create-invoice-form.tsx`, `src/components/sales/batch-recoveries-dialog.tsx`, `src/components/sales/customer-credit-section.tsx`, `src/components/sales/customer-kpi-cards.tsx`, `src/components/sales/customers-table.tsx`, `src/components/sales/invoice-detail-sheet.tsx`, `src/components/sales/ledger-print-export.tsx`, sales routes under `src/routes/_protected/sales/` | Screen 4 post-inspection settlement, printable credit notes, void-blocked customer links, invoice/recovery Store Credit apply UI, reusable `CustomerCreditSection`, KPIs, and ledger rows. |
| UI tests | `src/__tests__/sales-return-cache.behavior.test.tsx`, `src/__tests__/sales-return-ui.behavior.test.tsx`, `src/__tests__/sales-returns-pages.behavior.test.tsx`, `src/components/sales/create-invoice-form/payment-rows-field.test.tsx`, `src/__tests__/store-credit-apply.behavior.test.tsx`, `src/__tests__/ledger-return-rendering.test.tsx`, `src/__tests__/customer-credit-section.behavior.test.tsx` | Cache invalidation, Screen 4, CN print, Apply Store Credit, refund overdraw, refund reversal, and ledger rendering behavior. |

---

## Task 1: Database Schemas, Exports, Schema Contract Tests & Migration

**Files:**
- Modify: `src/db/schemas/sales-schema.ts`
- Modify: `src/db/schemas/sales-erp-schema.ts`
- Modify: `src/db/index.ts`
- Test (modify): `src/db/schemas/invoice-settlement-schema.test.ts`
- Test (create): `src/db/schemas/credit-notes-schema.test.ts`
- Generated artifact via CLI: new SQL migration, snapshot, and journal update under `src/db/migrations/` (never hand-edited)

**Interfaces:**
- Consumes: existing Drizzle tables in `sales-schema.ts`, `sales-erp-schema.ts`, `finance-schema.ts` (`wallets`, `transactions`), `auth-schema.ts` (`user`)
- Produces: exported schema tables `creditNoteCounters`, `customerCreditLots`, `customerCreditPaymentAllocations`, `customerRefunds`, `customerRefundAllocations`, `customerCreditMovements`, plus updated `customers`, `invoices`, `payments`, `slipRecords`, `salesReturns`

- [ ] **Step 1: Write the failing schema contract tests**

Update `src/db/schemas/invoice-settlement-schema.test.ts` (update `payment` check names assertion if untouched — keep existing assertions passing — and verify `excess_credited_amount` and `credit_balance`) and create `src/db/schemas/credit-notes-schema.test.ts`:

```ts
// Create src/db/schemas/credit-notes-schema.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  creditNoteCounters,
  customerCreditLots,
  customerCreditMovements,
  customerCreditPaymentAllocations,
  customerRefundAllocations,
  customerRefunds,
  payments,
  salesReturns,
  slipRecords,
} from "./sales-erp-schema";
import { customers, invoices } from "./sales-schema";

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe("credit notes & customer credit database contract", () => {
  it("adds credit_balance with non-negative check on customers", () => {
    expect(columnNames(customers)).toContain("credit_balance");
    expect(checkNames(customers)).toContain("customers_credit_balance_nonnegative_check");
  });

  it("adds excess_credited_amount and updated settlement check on invoices and slip_records", () => {
    expect(columnNames(invoices)).toContain("excess_credited_amount");
    expect(checkNames(invoices)).toContain("invoices_settlement_amounts_check");
    expect(columnNames(slipRecords)).toContain("excess_credited_amount");
    expect(checkNames(slipRecords)).toContain("slip_records_settlement_amounts_check");
  });

  it("adds credit note and split settlement columns and partial unique index on sales_returns", () => {
    expect(columnNames(salesReturns)).toEqual(
      expect.arrayContaining([
        "credit_note_number",
        "credit_note_issued_at",
        "applied_to_invoice_amount",
        "customer_credit_amount",
      ]),
    );
    expect(indexNames(salesReturns)).toContain("uq_sales_returns_credit_note_number");
    expect(checkNames(salesReturns)).toEqual(
      expect.arrayContaining([
        "sales_returns_credit_split_nonnegative_check",
        "sales_returns_completion_credit_note_check",
      ]),
    );
  });

  it("allows customer_credit in payments without wallet_id", () => {
    const methodColumn = getTableConfig(payments).columns.find((c) => c.name === "method");
    expect(methodColumn?.enumValues).toContain("customer_credit");
    expect(checkNames(payments)).toEqual(
      expect.arrayContaining(["payments_method_status_check", "payments_method_details_check"]),
    );
  });

  it("defines credit_note_counters and all customer credit/refund tables with conservation checks", () => {
    expect(getTableConfig(creditNoteCounters).name).toBe("credit_note_counters");
    expect(columnNames(creditNoteCounters)).toEqual(["id", "last_number", "updated_at"]);
    expect(checkNames(creditNoteCounters)).toContain("credit_note_counters_last_number_check");

    expect(getTableConfig(customerCreditLots).name).toBe("customer_credit_lots");
    expect(columnNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "customer_id",
        "source_type",
        "source_return_id",
        "source_invoice_id",
        "source_payment_id",
        "credit_note_number",
        "original_amount",
        "remaining_amount",
        "applied_amount",
        "refunded_amount",
        "reclaimed_amount",
        "voided_at",
      ]),
    );
    expect(checkNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "customer_credit_lots_amounts_check",
        "customer_credit_lots_conservation_check",
      ]),
    );
    expect(indexNames(customerCreditLots)).toEqual(
      expect.arrayContaining([
        "idx_customer_credit_lots_customer_created",
        "idx_customer_credit_lots_source_return",
      ]),
    );

    expect(getTableConfig(customerCreditPaymentAllocations).name).toBe(
      "customer_credit_payment_allocations",
    );
    expect(getTableConfig(customerRefunds).name).toBe("customer_refunds");
    expect(checkNames(customerRefunds)).toContain("customer_refunds_status_check");
    expect(getTableConfig(customerRefundAllocations).name).toBe("customer_refund_allocations");
    expect(getTableConfig(customerCreditMovements).name).toBe("customer_credit_movements");
    expect(indexNames(customerCreditMovements)).toContain("idx_customer_credit_movements_customer");
  });

  it("exports all Phase 4 tables from src/db/index.ts and leaves baseline migration untouched", () => {
    const dbIndex = readFileSync(resolve(process.cwd(), "src/db/index.ts"), "utf8");
    for (const sym of [
      "creditNoteCounters",
      "customerCreditLots",
      "customerCreditPaymentAllocations",
      "customerRefunds",
      "customerRefundAllocations",
      "customerCreditMovements",
    ]) {
      expect(dbIndex).toContain(sym);
    }
  });
});
```

Also append a quick assertion in `src/db/schemas/invoice-settlement-schema.test.ts` (before the closing `});`) verifying `excess_credited_amount` is present on `invoices` and `slipRecords` and `credit_balance` is present on `customers`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/db/schemas/credit-notes-schema.test.ts`
Expected: FAIL with `"export 'creditNoteCounters' is not defined"` or `"expected [...] to contain 'credit_balance'"`.

- [ ] **Step 3: Edit schemas and `src/db/index.ts`, then generate migration**

1. Edit `src/db/schemas/sales-schema.ts`:
   - In `customers` (`lines 53-96`): add `creditBalance` and table check builder:
     ```ts
     export const customers = pgTable(
       "customers",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         sNo: serial("s_no"),
         name: text("name").notNull(),
         address: text("address"),
         cnic: text("cnic"),
         city: text("city"),
         state: text("state"),
         bankAccount: text("bank_account"),
         mobileNumber: text("mobile_number"),
         totalSale: decimal("total_sale", { precision: 12, scale: 2 }).default("0"),
         totalPaidAmount: decimal("total_paid_amount", { precision: 12, scale: 2 })
           .notNull()
           .default("0"),
         outstandingAmount: decimal("outstanding_amount", {
           precision: 12,
           scale: 2,
         })
           .notNull()
           .default("0"),
         creditBalance: decimal("credit_balance", {
           precision: 12,
           scale: 2,
         })
           .notNull()
           .default("0"),
         weightSaleKg: decimal("weight_sale_kg", { precision: 12, scale: 3 }).default(
           "0",
         ),
         expenses: decimal("expenses", { precision: 12, scale: 2 }).default("0"),
         averagePerKg: decimal("average_per_kg", { precision: 12, scale: 2 }).default(
           "0",
         ),
         averageKgWithExpense: decimal("average_kg_with_expense", {
           precision: 12,
           scale: 2,
         }).default("0"),
         expenseAverage: decimal("expense_average", {
           precision: 12,
           scale: 2,
         }).default("0"),
         customerType: text("customer_type").notNull().default("retailer"),
         salesmanId: text("salesman_id").references(() => salesmen.id),
         defaultMargin: decimal("default_margin", { precision: 5, scale: 2 }).default("0"),
         creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }).default("0"),
         creditHold: boolean("credit_hold").default(false),
         ...timestamps,
       },
       (table) => ({
         creditBalanceNonNegativeCheck: check(
           "customers_credit_balance_nonnegative_check",
           sql`${table.creditBalance} >= 0`,
         ),
       }),
     );
     ```
   - In `invoices` (`lines 114-185`): add `excessCreditedAmount` after `returnedAmount`, add `excessCreditedNonNegativeCheck`, and update `settlementAmountsCheck`:
     ```ts
       excessCreditedAmount: decimal("excess_credited_amount", {
         precision: 12,
         scale: 2,
       })
         .notNull()
         .default("0"),
     ```
     and:
     ```ts
       settlementAmountsCheck: check(
         "invoices_settlement_amounts_check",
         sql`${table.paidAmount} >= 0 and ${table.returnedAmount} >= 0 and ${table.excessCreditedAmount} >= 0 and ${table.outstandingAmount} >= 0 and ${table.paidAmount} + ${table.returnedAmount} - ${table.excessCreditedAmount} + ${table.outstandingAmount} = ${table.totalPrice}`,
       ),
     ```

2. Edit `src/db/schemas/sales-erp-schema.ts`:
   - Line 22: change `import { wallets } from "./finance-schema";` to `import { transactions, wallets } from "./finance-schema";`.
   - In `payments` (`lines 162-216`):
     - `method: text("method", { enum: ["cash", "bank_transfer", "cheque", "expense_offset", "customer_credit"] }).notNull()`
     - `methodStatusCheck`: `(${table.method} in ('cash', 'expense_offset', 'customer_credit') and ${table.status} in ('confirmed', 'reversed')) or ...`
     - `methodDetailsCheck`: `(${table.method} in ('expense_offset', 'customer_credit') or ${table.walletId} is not null) and ...`
   - In `slipRecords` (`lines 262-296`):
     - Add `excessCreditedAmount: decimal("excess_credited_amount", { precision: 12, scale: 2 }).notNull().default("0")`
     - Update `settlementAmountsCheck`:
       `sql`${table.invoiceAmount} >= 0 and ${table.paidAmount} >= 0 and ${table.returnedAmount} >= 0 and ${table.excessCreditedAmount} >= 0 and ${table.outstandingAmount} >= 0 and ${table.paidAmount} + ${table.returnedAmount} - ${table.excessCreditedAmount} + ${table.outstandingAmount} = ${table.invoiceAmount}``
   - In `salesReturns` (`lines 720-760`):
     - Add columns:
       ```ts
         creditNoteNumber: text("credit_note_number"),
         creditNoteIssuedAt: timestamp("credit_note_issued_at"),
         appliedToInvoiceAmount: decimal("applied_to_invoice_amount", { precision: 12, scale: 2 })
           .notNull()
           .default("0"),
         customerCreditAmount: decimal("customer_credit_amount", { precision: 12, scale: 2 })
           .notNull()
           .default("0"),
       ```
     - Add partial unique index & check constraints in `salesReturns` table callback:
       ```ts
         creditNoteNumberUnique: uniqueIndex("uq_sales_returns_credit_note_number")
           .on(table.creditNoteNumber)
           .where(sql`${table.creditNoteNumber} is not null`),
         creditSplitNonNegativeCheck: check(
           "sales_returns_credit_split_nonnegative_check",
           sql`${table.appliedToInvoiceAmount} >= 0 and ${table.customerCreditAmount} >= 0`,
         ),
         completionCreditNoteCheck: check(
           "sales_returns_completion_credit_note_check",
           sql`${table.status} not in ('completed', 'voided') or (nullif(btrim(${table.creditNoteNumber}), '') is not null and ${table.appliedToInvoiceAmount} + ${table.customerCreditAmount} = ${table.totalAmount})`,
         ),
       ```
   - Right after `salesReturnStockTraces` (`line 825`), add the 6 new tables:
     ```ts
     export const creditNoteCounters = pgTable(
       "credit_note_counters",
       {
         id: text("id").primaryKey(),
         lastNumber: integer("last_number").notNull().default(0),
         updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
       },
       (table) => ({
         lastNumberCheck: check("credit_note_counters_last_number_check", sql`${table.lastNumber} >= 0`),
       }),
     );

     export const customerCreditLots = pgTable(
       "customer_credit_lots",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         customerId: text("customer_id")
           .notNull()
           .references(() => customers.id, { onDelete: "restrict" }),
         sourceType: text("source_type", { enum: ["sales_return", "payment_overage"] }).notNull(),
         sourceReturnId: text("source_return_id").references(() => salesReturns.id, {
           onDelete: "restrict",
         }),
         sourceInvoiceId: text("source_invoice_id")
           .notNull()
           .references(() => invoices.id, { onDelete: "restrict" }),
         sourcePaymentId: text("source_payment_id").references(() => payments.id, {
           onDelete: "restrict",
         }),
         creditNoteNumber: text("credit_note_number"),
         originalAmount: decimal("original_amount", { precision: 12, scale: 2 }).notNull(),
         remainingAmount: decimal("remaining_amount", { precision: 12, scale: 2 }).notNull(),
         appliedAmount: decimal("applied_amount", { precision: 12, scale: 2 }).notNull().default("0"),
         refundedAmount: decimal("refunded_amount", { precision: 12, scale: 2 }).notNull().default("0"),
         reclaimedAmount: decimal("reclaimed_amount", { precision: 12, scale: 2 }).notNull().default("0"),
         createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
         voidedAt: timestamp("voided_at", { withTimezone: true }),
       },
       (table) => ({
         customerCreatedIdx: index("idx_customer_credit_lots_customer_created").on(
           table.customerId,
           table.createdAt,
           table.id,
         ),
         sourceReturnIdx: index("idx_customer_credit_lots_source_return").on(table.sourceReturnId),
         sourceInvoiceIdx: index("idx_customer_credit_lots_source_invoice").on(table.sourceInvoiceId),
         amountsCheck: check(
           "customer_credit_lots_amounts_check",
           sql`${table.originalAmount} > 0 and ${table.remainingAmount} >= 0 and ${table.appliedAmount} >= 0 and ${table.refundedAmount} >= 0 and ${table.reclaimedAmount} >= 0`,
         ),
         conservationCheck: check(
           "customer_credit_lots_conservation_check",
           sql`${table.voidedAt} is not null or (${table.remainingAmount} + ${table.appliedAmount} + ${table.refundedAmount} + ${table.reclaimedAmount} = ${table.originalAmount})`,
         ),
         sourceTypeCheck: check(
           "customer_credit_lots_source_type_check",
           sql`${table.sourceType} in ('sales_return', 'payment_overage')`,
         ),
       }),
     );

     export const customerCreditPaymentAllocations = pgTable(
       "customer_credit_payment_allocations",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         paymentId: text("payment_id")
           .notNull()
           .references(() => payments.id, { onDelete: "restrict" }),
         creditLotId: text("credit_lot_id")
           .notNull()
           .references(() => customerCreditLots.id, { onDelete: "restrict" }),
         amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
         status: text("status", { enum: ["active", "reversed"] }).notNull().default("active"),
         createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
         reversedAt: timestamp("reversed_at", { withTimezone: true }),
       },
       (table) => ({
         paymentIdx: index("idx_credit_payment_alloc_payment").on(table.paymentId),
         lotIdx: index("idx_credit_payment_alloc_lot").on(table.creditLotId),
         amountCheck: check("credit_payment_alloc_amount_check", sql`${table.amount} > 0`),
         statusCheck: check(
           "credit_payment_alloc_status_check",
           sql`${table.status} in ('active', 'reversed')`,
         ),
       }),
     );

     export const customerRefunds = pgTable(
       "customer_refunds",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         customerId: text("customer_id")
           .notNull()
           .references(() => customers.id, { onDelete: "restrict" }),
         salesReturnId: text("sales_return_id").references(() => salesReturns.id, {
           onDelete: "restrict",
         }),
         creditNoteNumber: text("credit_note_number"),
         walletId: text("wallet_id")
           .notNull()
           .references(() => wallets.id, { onDelete: "restrict" }),
         walletTransactionId: text("wallet_transaction_id")
           .notNull()
           .references(() => transactions.id, { onDelete: "restrict" }),
         amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
         refundDate: timestamp("refund_date", { withTimezone: true }).notNull(),
         notes: text("notes"),
         status: text("status", { enum: ["active", "reversed"] }).notNull().default("active"),
         issuedById: text("issued_by_id")
           .notNull()
           .references(() => user.id, { onDelete: "restrict" }),
         createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
         reversedById: text("reversed_by_id").references(() => user.id, { onDelete: "restrict" }),
         reversedAt: timestamp("reversed_at", { withTimezone: true }),
         reverseReason: text("reverse_reason"),
         reversalTransactionId: text("reversal_transaction_id").references(() => transactions.id, {
           onDelete: "restrict",
         }),
       },
       (table) => ({
         customerDateIdx: index("idx_customer_refunds_customer_date").on(
           table.customerId,
           table.refundDate,
         ),
         salesReturnIdx: index("idx_customer_refunds_return").on(table.salesReturnId),
         amountCheck: check("customer_refunds_amount_check", sql`${table.amount} > 0`),
         statusCheck: check(
           "customer_refunds_status_check",
           sql`(
             (${table.status} = 'active' and ${table.reversedById} is null and ${table.reversedAt} is null and ${table.reverseReason} is null and ${table.reversalTransactionId} is null) or
             (${table.status} = 'reversed' and ${table.reversedById} is not null and ${table.reversedAt} is not null and nullif(btrim(${table.reverseReason}), '') is not null and ${table.reversalTransactionId} is not null)
           )`,
         ),
       }),
     );

     export const customerRefundAllocations = pgTable(
       "customer_refund_allocations",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         refundId: text("refund_id")
           .notNull()
           .references(() => customerRefunds.id, { onDelete: "restrict" }),
         creditLotId: text("credit_lot_id")
           .notNull()
           .references(() => customerCreditLots.id, { onDelete: "restrict" }),
         amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
         status: text("status", { enum: ["active", "reversed"] }).notNull().default("active"),
         createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
         reversedAt: timestamp("reversed_at", { withTimezone: true }),
       },
       (table) => ({
         refundIdx: index("idx_customer_refund_alloc_refund").on(table.refundId),
         lotIdx: index("idx_customer_refund_alloc_lot").on(table.creditLotId),
         amountCheck: check("customer_refund_alloc_amount_check", sql`${table.amount} > 0`),
         statusCheck: check(
           "customer_refund_alloc_status_check",
           sql`${table.status} in ('active', 'reversed')`,
         ),
       }),
     );

     export const customerCreditMovements = pgTable(
       "customer_credit_movements",
       {
         id: text("id")
           .primaryKey()
           .$defaultFn(() => createId()),
         customerId: text("customer_id")
           .notNull()
           .references(() => customers.id, { onDelete: "restrict" }),
         creditLotId: text("credit_lot_id").references(() => customerCreditLots.id, {
           onDelete: "restrict",
         }),
         type: text("type", {
           enum: [
             "issued",
             "applied",
             "application_reversed",
             "refunded",
             "refund_reversed",
             "void_reclaimed",
             "void_unapplied",
           ],
         }).notNull(),
         amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
         signedDelta: decimal("signed_delta", { precision: 12, scale: 2 }).notNull(),
         balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
         salesReturnId: text("sales_return_id").references(() => salesReturns.id, {
           onDelete: "restrict",
         }),
         creditNoteNumber: text("credit_note_number"),
         invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
         paymentId: text("payment_id").references(() => payments.id, { onDelete: "restrict" }),
         refundId: text("refund_id").references(() => customerRefunds.id, {
           onDelete: "restrict",
         }),
         walletId: text("wallet_id").references(() => wallets.id, { onDelete: "restrict" }),
         notes: text("notes"),
         performedById: text("performed_by_id")
           .notNull()
           .references(() => user.id, { onDelete: "restrict" }),
         createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
       },
       (table) => ({
         customerCreatedIdx: index("idx_customer_credit_movements_customer").on(
           table.customerId,
           table.createdAt,
           table.id,
         ),
         amountCheck: check("customer_credit_movements_amount_check", sql`${table.amount} > 0`),
         balanceAfterCheck: check(
           "customer_credit_movements_balance_after_check",
           sql`${table.balanceAfter} >= 0`,
         ),
         typeCheck: check(
           "customer_credit_movements_type_check",
           sql`${table.type} in ('issued', 'applied', 'application_reversed', 'refunded', 'refund_reversed', 'void_reclaimed', 'void_unapplied')`,
         ),
       }),
     );
     ```
   - Update `paymentsRelations` (`lines 573-601`, changing `({ one })` to `({ one, many })`) and `salesReturnsRelations` (`lines 889-924`), then add the 5 relations right after `salesReturnStockTracesRelations`:
     ```ts
     // In paymentsRelations:
     export const paymentsRelations = relations(payments, ({ one, many }) => ({
       // ...existing fields unchanged...
       creditAllocations: many(customerCreditPaymentAllocations),
     }));

     // In salesReturnsRelations:
       items: many(salesReturnItems),
       stockTraces: many(salesReturnStockTraces),
       creditLots: many(customerCreditLots),
       refunds: many(customerRefunds),

     // Add after salesReturnStockTracesRelations:
     export const customerCreditLotsRelations = relations(customerCreditLots, ({ one, many }) => ({
       customer: one(customers, {
         fields: [customerCreditLots.customerId],
         references: [customers.id],
       }),
       sourceReturn: one(salesReturns, {
         fields: [customerCreditLots.sourceReturnId],
         references: [salesReturns.id],
       }),
       sourceInvoice: one(invoices, {
         fields: [customerCreditLots.sourceInvoiceId],
         references: [invoices.id],
       }),
       sourcePayment: one(payments, {
         fields: [customerCreditLots.sourcePaymentId],
         references: [payments.id],
       }),
       paymentAllocations: many(customerCreditPaymentAllocations),
       refundAllocations: many(customerRefundAllocations),
     }));

     export const customerCreditPaymentAllocationsRelations = relations(
       customerCreditPaymentAllocations,
       ({ one }) => ({
         payment: one(payments, {
           fields: [customerCreditPaymentAllocations.paymentId],
           references: [payments.id],
         }),
         creditLot: one(customerCreditLots, {
           fields: [customerCreditPaymentAllocations.creditLotId],
           references: [customerCreditLots.id],
         }),
       }),
     );

     export const customerRefundsRelations = relations(customerRefunds, ({ one, many }) => ({
       customer: one(customers, {
         fields: [customerRefunds.customerId],
         references: [customers.id],
       }),
       salesReturn: one(salesReturns, {
         fields: [customerRefunds.salesReturnId],
         references: [salesReturns.id],
       }),
       wallet: one(wallets, {
         fields: [customerRefunds.walletId],
         references: [wallets.id],
       }),
       walletTransaction: one(transactions, {
         fields: [customerRefunds.walletTransactionId],
         references: [transactions.id],
       }),
       reversalTransaction: one(transactions, {
         fields: [customerRefunds.reversalTransactionId],
         references: [transactions.id],
       }),
       issuedBy: one(user, {
         fields: [customerRefunds.issuedById],
         references: [user.id],
       }),
       reversedBy: one(user, {
         fields: [customerRefunds.reversedById],
         references: [user.id],
       }),
       allocations: many(customerRefundAllocations),
     }));

     export const customerRefundAllocationsRelations = relations(
       customerRefundAllocations,
       ({ one }) => ({
         refund: one(customerRefunds, {
           fields: [customerRefundAllocations.refundId],
           references: [customerRefunds.id],
         }),
         creditLot: one(customerCreditLots, {
           fields: [customerRefundAllocations.creditLotId],
           references: [customerCreditLots.id],
         }),
       }),
     );

     export const customerCreditMovementsRelations = relations(
       customerCreditMovements,
       ({ one }) => ({
         customer: one(customers, {
           fields: [customerCreditMovements.customerId],
           references: [customers.id],
         }),
         creditLot: one(customerCreditLots, {
           fields: [customerCreditMovements.creditLotId],
           references: [customerCreditLots.id],
         }),
         salesReturn: one(salesReturns, {
           fields: [customerCreditMovements.salesReturnId],
           references: [salesReturns.id],
         }),
         invoice: one(invoices, {
           fields: [customerCreditMovements.invoiceId],
           references: [invoices.id],
         }),
         payment: one(payments, {
           fields: [customerCreditMovements.paymentId],
           references: [payments.id],
         }),
         refund: one(customerRefunds, {
           fields: [customerCreditMovements.refundId],
           references: [customerRefunds.id],
         }),
         wallet: one(wallets, {
           fields: [customerCreditMovements.walletId],
           references: [wallets.id],
         }),
         performedBy: one(user, {
           fields: [customerCreditMovements.performedById],
           references: [user.id],
         }),
       }),
     );
     ```

3. Update `src/db/index.ts` lines 115-121 to export:
   `creditNoteCounters`, `customerCreditLots`, `customerCreditPaymentAllocations`, `customerRefunds`, `customerRefundAllocations`, `customerCreditMovements`.

4. Generate the Drizzle migration:
   Run: `bun run db:generate`
   Inspect the generated SQL file under `src/db/migrations/` and verify it only contains `ALTER TABLE` / `CREATE TABLE` / `CREATE INDEX` / constraint changes for the tables above, with zero `DROP TABLE` or `TRUNCATE`.

- [ ] **Step 4: Run schema tests & typecheck**

Run: `bun run test src/db/schemas/credit-notes-schema.test.ts src/db/schemas/invoice-settlement-schema.test.ts && bun run typecheck`
Expected: PASS (all assertions green, 0 TS errors).

- [ ] **Step 5: Commit**

```bash
git add src/db/schemas/sales-schema.ts src/db/schemas/sales-erp-schema.ts src/db/index.ts src/db/schemas/invoice-settlement-schema.test.ts src/db/schemas/credit-notes-schema.test.ts src/db/migrations/
git commit -m "feat(db): add credit notes, customer credit lots, and customer refunds schema"
```

---

## Task 2: RBAC Permissions (`finance.refunds.issue`), Multi-Source Backfill & Middlewares

**Files:**
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/authz.server.ts`
- Modify: `src/lib/middlewares.ts`
- Test (modify): `src/lib/sales-returns-access.test.ts`
- Test (create): `src/lib/credit-notes-access.test.ts`

**Interfaces:**
- Consumes: `createPermissionMiddleware`, `authContextMiddleware`, `hasPermission`
- Produces: `"finance.refunds.issue"` permission, multi-source `PERMISSION_BACKFILLS` support (`PermissionKey | readonly PermissionKey[]`), `requireFinanceRefundsIssueMiddleware`, `requireFinancePaymentReversalOrManageMiddleware`

- [ ] **Step 1: Write the failing RBAC and middleware tests**

Create `src/lib/credit-notes-access.test.ts` and update `src/lib/sales-returns-access.test.ts:26-35` so multi-source `PERMISSION_BACKFILLS` passes cleanly alongside existing return checks:

```ts
// Create src/lib/credit-notes-access.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_BACKFILLS,
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLE_SEEDS,
} from "@/lib/rbac";

describe("credit notes & refund RBAC contract", () => {
  it("defines finance.refunds.issue as a finance action permission", () => {
    expect(PERMISSION_KEYS).toContain("finance.refunds.issue");
    const def = PERMISSION_DEFINITIONS.find((p) => p.key === "finance.refunds.issue");
    expect(def).toMatchObject({
      key: "finance.refunds.issue",
      moduleKey: "finance",
      kind: "action",
      label: "Issue customer refunds",
    });
  });

  it("seeds finance.refunds.issue on admin and finance-manager roles", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((r) => r.slug === "admin")!;
    const financeManager = SYSTEM_ROLE_SEEDS.find((r) => r.slug === "finance-manager")!;
    expect(admin.permissionKeys).toContain("finance.refunds.issue");
    expect(financeManager.permissionKeys).toContain("finance.refunds.issue");
  });

  it("configures multi-source backfill for finance.refunds.issue and supports array sources in authz.server.ts", () => {
    expect(PERMISSION_BACKFILLS["finance.refunds.issue"]).toEqual([
      "finance.manage",
      "inventory.returns.receive",
    ]);
    const authz = readFileSync(resolve(process.cwd(), "src/lib/authz.server.ts"), "utf8");
    expect(authz).toContain("Array.isArray(sourceKey)");
    expect(authz).toContain("inArray(appRolePermissions.permissionId");
  });

  it("exposes requireFinanceRefundsIssueMiddleware and requireFinancePaymentReversalOrManageMiddleware", () => {
    const middlewares = readFileSync(resolve(process.cwd(), "src/lib/middlewares.ts"), "utf8");
    expect(middlewares).toContain('requireFinanceRefundsIssueMiddleware = createPermissionMiddleware(\n  "finance.refunds.issue",');
    expect(middlewares).toContain("requireFinancePaymentReversalOrManageMiddleware");
    expect(middlewares).toContain('"finance.payments.reverse"');
    expect(middlewares).toContain('"finance.manage"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/lib/credit-notes-access.test.ts`
Expected: FAIL asserting `"finance.refunds.issue"` in `PERMISSION_KEYS`.

- [ ] **Step 3: Implement RBAC permission, multi-source backfill, and middlewares**

1. In `src/lib/rbac.ts`:
   - Add `"finance.refunds.issue",` after `"finance.payments.reverse",` (`line 89`).
   - Add definition after `finance.payments.reverse` (`line 550`):
     ```ts
       {
         key: "finance.refunds.issue",
         moduleKey: "finance",
         label: "Issue customer refunds",
         description: "Pay out customer store credit in cash or bank transfer.",
         kind: "action",
       },
     ```
   - Update `PERMISSION_BACKFILLS` (`line 741`):
     ```ts
     export const PERMISSION_BACKFILLS: Partial<
       Record<PermissionKey, PermissionKey | readonly PermissionKey[]>
     > = {
       "sales.returns.create": "sales.manage",
       "sales.returns.approve": "sales.manage",
       "inventory.returns.receive": "inventory.manage",
       "finance.refunds.issue": ["finance.manage", "inventory.returns.receive"],
     };
     ```
   - Add `"finance.refunds.issue"` to `admin` (`line 816`) and `finance-manager` (`line 863`) in `SYSTEM_ROLE_SEEDS`.
2. In `src/lib/authz.server.ts` (`lines 160-180`):
   Update backfill loop to handle single or multi-source arrays and deduplicate `roleId` before insert:
   ```ts
        for (const [newKey, sourceKey] of Object.entries(PERMISSION_BACKFILLS)) {
          if (!sourceKey || existingPermissionKeys.has(newKey)) continue;
          const newPermissionId = permissionIdByKey.get(newKey);
          const sourceKeys = Array.isArray(sourceKey) ? sourceKey : [sourceKey];
          const sourcePermissionIds = sourceKeys
            .map((key) => permissionIdByKey.get(key))
            .filter((id): id is string => Boolean(id));
          if (!newPermissionId || sourcePermissionIds.length === 0) continue;
          const holders = await tx.query.appRolePermissions.findMany({
            where: inArray(appRolePermissions.permissionId, sourcePermissionIds),
            columns: { roleId: true },
          });
          const uniqueRoleIds = [...new Set(holders.map((holder) => holder.roleId))];
          if (uniqueRoleIds.length > 0) {
            await tx
              .insert(appRolePermissions)
              .values(
                uniqueRoleIds.map((roleId) => ({
                  roleId,
                  permissionId: newPermissionId,
                })),
              )
              .onConflictDoNothing();
          }
        }
   ```
   (Verify `inArray` is imported from `drizzle-orm` at the top of `src/lib/authz.server.ts` — add if not present.)
3. In `src/lib/middlewares.ts` (`after line 273`):
   `createAnyPermissionMiddleware` already exists at line 71 of `src/lib/middlewares.ts`, so reuse it directly and export both middlewares:
   ```ts
   export const requireFinanceRefundsIssueMiddleware = createPermissionMiddleware(
     "finance.refunds.issue",
   );
   export const requireFinancePaymentReversalOrManageMiddleware =
     createAnyPermissionMiddleware(["finance.payments.reverse", "finance.manage"]);
   ```
4. Update `src/lib/sales-returns-access.test.ts` lines 26-31 from exact `.toEqual({...})` to `.toMatchObject({...})` so multi-source `"finance.refunds.issue"` coexists with the Phase 3 assertions.

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/lib/credit-notes-access.test.ts src/lib/sales-returns-access.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rbac.ts src/lib/authz.server.ts src/lib/middlewares.ts src/lib/sales-returns-access.test.ts src/lib/credit-notes-access.test.ts
git commit -m "feat(rbac): add finance.refunds.issue with multi-source backfill and middlewares"
```

---

## Task 3: Pure Math, Credit Note Formatting, Split Logic & Transactional `customer-credit-service.ts`

**Files:**
- Modify: `src/lib/sales/settlement/contracts.ts`
- Modify: `src/lib/sales/settlement/math.ts`
- Modify: `src/lib/sales/returns/return-lifecycle.ts`
- Create: `src/server-functions/sales/customer-credit-service.ts`
- Test (modify): `src/lib/sales/settlement/math.test.ts`, `src/lib/sales/returns/return-lifecycle.test.ts`
- Test (create): `src/server-functions/sales/customer-credit-service.test.ts`

**Interfaces:**
- Consumes: `Big` from `big.js`, `roundMoney` / `moneyString` from `@/lib/sales/settlement/money`, `overdrawError` from `@/lib/finance/expense-corrections`, `hasPermission` from `@/lib/rbac`, Drizzle tables from `@/db/schemas/sales-schema`, `@/db/schemas/sales-erp-schema`, `@/db/schemas/finance-schema`
- Produces:
  - `paymentMethodSchema` including `"customer_credit"`, optional `walletId` on `PaymentInput` when `method === "customer_credit"`
  - `formatCreditNoteNumber(sequence: number): string`
  - `computeReturnCreditSplit(returnTotal: number, preReturnOpenBalance: number): { appliedToInvoiceAmount: number; customerCreditAmount: number }`
  - `VOID_BLOCKED_BY_REFUND` structured error + parser
  - Transactional service exports:
    - `allocateNextCreditNoteNumber(tx)`
    - `issueCustomerCreditFromReturn(tx, input)`
    - `issuePaymentOverageCredit(tx, input)`
    - `reclaimPaymentOverageCredit(tx, input)`
    - `reclaimInvoiceReturnCreditForPaymentReversal(tx, input)`
    - `applyCustomerCreditToPayment(tx, input)`
    - `restoreCustomerCreditForReversedPayment(tx, input)`
    - `issueCustomerRefund(tx, input)`
    - `reverseCustomerRefund(tx, input)`
    - `voidReturnCreditSettlement(tx, input)`
    - `getCustomerCreditSummary(db, customerId)`
    - `ensureCreditNotesBackfilled(db)`

- [ ] **Step 1: Write failing unit tests for split math, CN formatting, and transactional credit service**

Append pure tests to `src/lib/sales/settlement/math.test.ts` and `src/lib/sales/returns/return-lifecycle.test.ts`, and create `src/server-functions/sales/customer-credit-service.test.ts` using an in-memory mock Drizzle `tx` testing FIFO ordering, lot conservation, partial refunds, refund reversal, co-funded payment splitting on void, delayed overage reclaim, and refund-blocking void:

```ts
// Append to src/lib/sales/returns/return-lifecycle.test.ts
import { computeReturnCreditSplit, formatCreditNoteNumber } from "./return-lifecycle";

describe("credit note formatting and split allocation", () => {
  it("formats CN-XXXX padded to 4 digits and expands past 9999 without truncation", () => {
    expect(formatCreditNoteNumber(1)).toBe("CN-0001");
    expect(formatCreditNoteNumber(42)).toBe("CN-0042");
    expect(formatCreditNoteNumber(10000)).toBe("CN-10000");
  });

  it("splits return amount between open invoice balance and customer store credit without negatives", () => {
    expect(computeReturnCreditSplit(3000, 5000)).toEqual({
      appliedToInvoiceAmount: 3000,
      customerCreditAmount: 0,
    });
    expect(computeReturnCreditSplit(4500, 3000)).toEqual({
      appliedToInvoiceAmount: 3000,
      customerCreditAmount: 1500,
    });
    expect(computeReturnCreditSplit(2000, 0)).toEqual({
      appliedToInvoiceAmount: 0,
      customerCreditAmount: 2000,
    });
    expect(computeReturnCreditSplit(1000.05, 333.33)).toEqual({
      appliedToInvoiceAmount: 333.33,
      customerCreditAmount: 666.72,
    });
  });
});
```

```ts
// Create src/server-functions/sales/customer-credit-service.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  formatVoidBlockedByRefundError,
  parseVoidBlockedByRefundError,
  selectFifoAllocations,
  VOID_BLOCKED_BY_REFUND,
} from "./customer-credit-service";

describe("customer-credit-service pure FIFO & void error mechanics", () => {
  it("allocates requested amount deterministically across active lots in FIFO order", () => {
    const plan = selectFifoAllocations(2500, [
      { id: "lot-1", remainingAmount: "1000.00", createdAt: new Date("2026-10-01") },
      { id: "lot-2", remainingAmount: "2000.00", createdAt: new Date("2026-10-02") },
      { id: "lot-3", remainingAmount: "500.00", createdAt: new Date("2026-10-03") },
    ]);
    expect(plan).toEqual([
      { lotId: "lot-1", amount: 1000 },
      { lotId: "lot-2", amount: 1500 },
    ]);
  });

  it("throws when FIFO lots hold less than requested amount", () => {
    expect(() =>
      selectFifoAllocations(1200, [
        { id: "lot-1", remainingAmount: "1000.00", createdAt: new Date("2026-10-01") },
      ]),
    ).toThrow(/exceeds available store credit/i);
  });

  it("formats and parses VOID_BLOCKED_BY_REFUND with customer routing metadata", () => {
    const err = formatVoidBlockedByRefundError({
      refundedAmount: 1500,
      customerId: "cust-123",
      customerName: "Ahmed Traders",
      customerType: "distributor",
    });
    expect(err.message).toContain(VOID_BLOCKED_BY_REFUND);
    expect(parseVoidBlockedByRefundError(err)).toEqual({
      refundedAmount: 1500,
      customerId: "cust-123",
      customerName: "Ahmed Traders",
      customerType: "distributor",
      displayMessage:
        "Rs 1,500 of this return's credit was already refunded. Reverse the refund on Ahmed Traders's page before voiding.",
    });
  });

  it("handles zero credit balance cleanly", () => {
    expect(selectFifoAllocations(0, [])).toEqual([]);
  });
});
```

Also append a test in `src/lib/sales/settlement/math.test.ts`:

```ts
  it("treats confirmed customer_credit payments as paid settlement without violating positive checks", () => {
    expect(
      calculateSettlement(5_000, [
        { amount: 1_500, status: "confirmed", method: "customer_credit" },
        { amount: 3_500, status: "confirmed", method: "cash" },
      ]),
    ).toMatchObject({
      paidAmount: 5_000,
      outstandingAmount: 0,
      payLaterAmount: 0,
      paymentStatus: "paid",
    });
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/lib/sales/returns/return-lifecycle.test.ts src/server-functions/sales/customer-credit-service.test.ts src/lib/sales/settlement/math.test.ts`
Expected: FAIL (`formatCreditNoteNumber`, `computeReturnCreditSplit`, `customer-credit-service.ts`, and `"customer_credit"` method check fail).

- [ ] **Step 3: Implement pure contracts, math helpers, and `customer-credit-service.ts`**

1. Edit `src/lib/sales/settlement/contracts.ts`:
   Add `"customer_credit"` to `paymentMethodSchema`, make `walletId` optional on `PaymentInput` (or refine `walletId?: string`):
   ```ts
   export const paymentMethodSchema = z.enum([
     "cash",
     "bank_transfer",
     "cheque",
     "expense_offset",
     "customer_credit",
   ]);
   ```
   And update `PaymentInput`:
   ```ts
   export type PaymentInput = {
     method: Exclude<PaymentMethod, "expense_offset">;
     amount: number;
     walletId?: string;
     reference?: string;
     chequeNumber?: string;
     chequeBank?: string;
     chequeDate?: Date;
     paymentDate: Date;
     sourceRecordId?: string;
     notes?: string;
     instantVerify?: boolean;
   };
   ```

2. Edit `src/lib/sales/returns/return-lifecycle.ts` (append at bottom; note: keeping `VOID_BLOCKED_BY_REFUND`, `formatVoidBlockedByRefundError`, and `parseVoidBlockedByRefundError` in this client-safe module ensures UI components like `return-lifecycle-actions.tsx` can parse void errors without pulling server/DB imports into the browser bundle):
   ```ts
   import { formatPakistaniNumber } from "@/lib/currency-format";
   import { roundMoney } from "../settlement/money";

   export function formatCreditNoteNumber(sequence: number): string {
     if (!Number.isInteger(sequence) || sequence <= 0) {
       throw new Error("Credit note sequence must be a positive integer");
     }
     return `CN-${String(sequence).padStart(4, "0")}`;
   }

   export function computeReturnCreditSplit(
     returnTotal: number,
     preReturnOpenBalance: number,
   ): { appliedToInvoiceAmount: number; customerCreditAmount: number } {
     const total = roundMoney(Math.max(0, returnTotal));
     const open = roundMoney(Math.max(0, preReturnOpenBalance));
     const appliedToInvoiceAmount = roundMoney(Math.min(total, open));
     const customerCreditAmount = roundMoney(new Big(total).minus(appliedToInvoiceAmount).toNumber());
     return { appliedToInvoiceAmount, customerCreditAmount };
   }

   export const VOID_BLOCKED_BY_REFUND = "VOID_BLOCKED_BY_REFUND";

   export function formatVoidBlockedByRefundError(params: {
     refundedAmount: number;
     customerId: string;
     customerName: string;
     customerType: string;
   }): Error {
     const payload = JSON.stringify({
       code: VOID_BLOCKED_BY_REFUND,
       refundedAmount: roundMoney(params.refundedAmount),
       customerId: params.customerId,
       customerName: params.customerName,
       customerType: params.customerType,
     });
     return new Error(
       `${VOID_BLOCKED_BY_REFUND}:${payload}:Rs ${formatPakistaniNumber(roundMoney(params.refundedAmount))} of this return's credit was already refunded. Reverse the refund on ${params.customerName}'s page before voiding.`,
     );
   }

   export function parseVoidBlockedByRefundError(error: unknown): {
     refundedAmount: number;
     customerId: string;
     customerName: string;
     customerType: string;
     displayMessage: string;
   } | null {
     if (!(error instanceof Error)) return null;
     const marker = `${VOID_BLOCKED_BY_REFUND}:`;
     const idx = error.message.indexOf(marker);
     if (idx === -1) return null;
     const rest = error.message.slice(idx + marker.length);
     const splitIdx = rest.indexOf("}:");
     if (splitIdx === -1) return null;
     try {
       const parsed = JSON.parse(rest.slice(0, splitIdx + 1));
       return {
         refundedAmount: Number(parsed.refundedAmount),
         customerId: String(parsed.customerId),
         customerName: String(parsed.customerName),
         customerType: String(parsed.customerType ?? "retailer"),
         displayMessage: rest.slice(splitIdx + 2),
       };
     } catch {
       return null;
     }
   }
   ```
   (Move the two new imports to the top of `src/lib/sales/returns/return-lifecycle.ts`, right below `import Big from "big.js";`.)

3. Create `src/server-functions/sales/customer-credit-service.ts` with complete transactional logic (no top-level `@/db` value import — only `import type { db as rootDb } from "@/db";`):

```ts
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { db as rootDb } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import {
  creditNoteCounters,
  customerCreditLots,
  customerCreditMovements,
  customerCreditPaymentAllocations,
  customerRefundAllocations,
  customerRefunds,
  payments,
  salesReturns,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import { formatPakistaniNumber } from "@/lib/currency-format";
import { overdrawError } from "@/lib/finance/expense-corrections";
import { hasPermission } from "@/lib/rbac";
import {
  computeReturnCreditSplit,
  formatCreditNoteNumber,
  formatVoidBlockedByRefundError,
  parseVoidBlockedByRefundError,
  VOID_BLOCKED_BY_REFUND,
} from "@/lib/sales/returns/return-lifecycle";
import { moneyString, roundMoney } from "@/lib/sales/settlement/money";

export {
  formatVoidBlockedByRefundError,
  parseVoidBlockedByRefundError,
  VOID_BLOCKED_BY_REFUND,
};

export type DbOrTx = Pick<typeof rootDb, "select" | "insert" | "update" | "query">;

export function selectFifoAllocations(
  requestedAmount: number,
  lots: Array<{ id: string; remainingAmount: string | number; createdAt: Date }>,
): Array<{ lotId: string; amount: number }> {
  const needed = roundMoney(requestedAmount);
  if (needed < 0) throw new Error("Credit allocation amount cannot be negative");
  if (needed === 0) return [];

  let remainingNeeded = new Big(needed);
  const allocations: Array<{ lotId: string; amount: number }> = [];

  for (const lot of lots) {
    if (remainingNeeded.lte(0)) break;
    const avail = new Big(roundMoney(lot.remainingAmount));
    if (avail.lte(0)) continue;
    const take = avail.lt(remainingNeeded) ? avail : remainingNeeded;
    allocations.push({ lotId: lot.id, amount: roundMoney(take.toNumber()) });
    remainingNeeded = remainingNeeded.minus(take);
  }

  if (remainingNeeded.gt(0)) {
    throw new Error("Requested credit amount exceeds available store credit.");
  }
  return allocations;
}

async function lockCustomerRow(tx: DbOrTx, customerId: string) {
  await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for("update");
  const customer = await tx.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, customerType: true, creditBalance: true, outstandingAmount: true },
  });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

async function lockActiveCustomerLots(tx: DbOrTx, customerId: string) {
  return tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.customerId, customerId),
        isNull(customerCreditLots.voidedAt),
        gt(customerCreditLots.remainingAmount, "0"),
      ),
    )
    .orderBy(asc(customerCreditLots.createdAt), asc(customerCreditLots.id))
    .for("update");
}

export async function allocateNextCreditNoteNumber(tx: DbOrTx): Promise<string> {
  await tx
    .insert(creditNoteCounters)
    .values({ id: "credit_note", lastNumber: 0 })
    .onConflictDoNothing();

  const [counter] = await tx
    .select()
    .from(creditNoteCounters)
    .where(eq(creditNoteCounters.id, "credit_note"))
    .for("update");

  const next = Number(counter?.lastNumber ?? 0) + 1;
  await tx
    .update(creditNoteCounters)
    .set({ lastNumber: next, updatedAt: new Date() })
    .where(eq(creditNoteCounters.id, "credit_note"));

  return formatCreditNoteNumber(next);
}

export async function issueCustomerCreditFromReturn(
  tx: DbOrTx,
  input: {
    customerId: string;
    salesReturnId: string;
    sourceInvoiceId: string;
    creditNoteNumber: string;
    amount: number;
    performedById: string;
    notes?: string | null;
  },
): Promise<{ lotId: string; balanceAfter: number }> {
  const creditAmount = roundMoney(input.amount);
  if (creditAmount <= 0) {
    const customer = await lockCustomerRow(tx, input.customerId);
    return { lotId: "", balanceAfter: roundMoney(customer.creditBalance) };
  }

  const customer = await lockCustomerRow(tx, input.customerId);
  const newBalance = roundMoney(new Big(customer.creditBalance).plus(creditAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  const lotId = createId();
  await tx.insert(customerCreditLots).values({
    id: lotId,
    customerId: input.customerId,
    sourceType: "sales_return",
    sourceReturnId: input.salesReturnId,
    sourceInvoiceId: input.sourceInvoiceId,
    creditNoteNumber: input.creditNoteNumber,
    originalAmount: moneyString(creditAmount),
    remainingAmount: moneyString(creditAmount),
    appliedAmount: "0.00",
    refundedAmount: "0.00",
    reclaimedAmount: "0.00",
  });

  await tx.insert(customerCreditMovements).values({
    id: createId(),
    customerId: input.customerId,
    creditLotId: lotId,
    type: "issued",
    amount: moneyString(creditAmount),
    signedDelta: moneyString(creditAmount),
    balanceAfter: moneyString(newBalance),
    salesReturnId: input.salesReturnId,
    creditNoteNumber: input.creditNoteNumber,
    invoiceId: input.sourceInvoiceId,
    notes: input.notes ?? `Credit Note ${input.creditNoteNumber} leftover store credit`,
    performedById: input.performedById,
  });

  return { lotId, balanceAfter: newBalance };
}

export async function issuePaymentOverageCredit(
  tx: DbOrTx,
  input: {
    customerId: string;
    sourceInvoiceId: string;
    sourcePaymentId: string | null;
    amount: number;
    performedById: string;
    notes?: string;
  },
): Promise<{ lotId: string; balanceAfter: number }> {
  const overageAmount = roundMoney(input.amount);
  if (overageAmount <= 0) {
    const customer = await lockCustomerRow(tx, input.customerId);
    return { lotId: "", balanceAfter: roundMoney(customer.creditBalance) };
  }

  const customer = await lockCustomerRow(tx, input.customerId);
  const newBalance = roundMoney(new Big(customer.creditBalance).plus(overageAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  const lotId = createId();
  await tx.insert(customerCreditLots).values({
    id: lotId,
    customerId: input.customerId,
    sourceType: "payment_overage",
    sourceReturnId: null,
    sourceInvoiceId: input.sourceInvoiceId,
    sourcePaymentId: input.sourcePaymentId,
    creditNoteNumber: null,
    originalAmount: moneyString(overageAmount),
    remainingAmount: moneyString(overageAmount),
    appliedAmount: "0.00",
    refundedAmount: "0.00",
    reclaimedAmount: "0.00",
  });

  await tx.insert(customerCreditMovements).values({
    id: createId(),
    customerId: input.customerId,
    creditLotId: lotId,
    type: "issued",
    amount: moneyString(overageAmount),
    signedDelta: moneyString(overageAmount),
    balanceAfter: moneyString(newBalance),
    invoiceId: input.sourceInvoiceId,
    paymentId: input.sourcePaymentId,
    notes: input.notes ?? "Confirmed payment exceeded invoice balance after returns",
    performedById: input.performedById,
  });

  return { lotId, balanceAfter: newBalance };
}

export async function applyCustomerCreditToPayment(
  tx: DbOrTx,
  input: {
    customerId: string;
    paymentId: string;
    invoiceId: string;
    amount: number;
    performedById: string;
    notes?: string | null;
  },
): Promise<{ balanceAfter: number }> {
  const applyAmount = roundMoney(input.amount);
  if (applyAmount <= 0) throw new Error("Store credit amount must be greater than zero");

  const customer = await lockCustomerRow(tx, input.customerId);
  const currentBalance = roundMoney(customer.creditBalance);
  if (applyAmount > currentBalance) {
    throw new Error(
      `Store credit applied (Rs ${formatPakistaniNumber(applyAmount)}) exceeds available credit (Rs ${formatPakistaniNumber(currentBalance)}).`,
    );
  }

  const activeLots = await lockActiveCustomerLots(tx, input.customerId);
  const plan = selectFifoAllocations(applyAmount, activeLots);
  const newBalance = roundMoney(new Big(currentBalance).minus(applyAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  let runningBalance = currentBalance;
  const lotMap = new Map(activeLots.map((lot) => [lot.id, lot]));

  for (const chunk of plan) {
    const lot = lotMap.get(chunk.lotId)!;
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).minus(chunk.amount).toNumber());
    const nextApplied = roundMoney(new Big(lot.appliedAmount).plus(chunk.amount).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(chunk.amount).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(nextRemaining),
        appliedAmount: moneyString(nextApplied),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditPaymentAllocations).values({
      id: createId(),
      paymentId: input.paymentId,
      creditLotId: lot.id,
      amount: moneyString(chunk.amount),
      status: "active",
    });

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "applied",
      amount: moneyString(chunk.amount),
      signedDelta: moneyString(-chunk.amount),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      notes: input.notes ?? "Applied store credit to invoice",
      performedById: input.performedById,
    });
  }

  return { balanceAfter: newBalance };
}

export async function restoreCustomerCreditForReversedPayment(
  tx: DbOrTx,
  input: {
    paymentId: string;
    invoiceId: string;
    customerId: string;
    performedById: string;
    reason: string;
  },
) {
  const customer = await lockCustomerRow(tx, input.customerId);
  const allocations = await tx
    .select()
    .from(customerCreditPaymentAllocations)
    .where(
      and(
        eq(customerCreditPaymentAllocations.paymentId, input.paymentId),
        eq(customerCreditPaymentAllocations.status, "active"),
      ),
    )
    .for("update");

  if (allocations.length === 0) return;

  const lotIds = allocations.map((a) => a.creditLotId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(inArray(customerCreditLots.id, lotIds))
    .for("update");
  const lotMap = new Map(lots.map((l) => [l.id, l]));
  const now = new Date();
  let runningBalance = roundMoney(customer.creditBalance);

  for (const alloc of allocations) {
    const lot = lotMap.get(alloc.creditLotId);
    if (!lot) throw new Error("Linked customer credit lot not found");
    if (lot.voidedAt) {
      throw new Error("Cannot restore store credit from a voided credit note.");
    }
    const chunk = roundMoney(alloc.amount);
    const nextApplied = roundMoney(new Big(lot.appliedAmount).minus(chunk).toNumber());
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).plus(chunk).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).plus(chunk).toNumber());

    await tx
      .update(customerCreditPaymentAllocations)
      .set({ status: "reversed", reversedAt: now })
      .where(eq(customerCreditPaymentAllocations.id, alloc.id));

    await tx
      .update(customerCreditLots)
      .set({
        appliedAmount: moneyString(nextApplied),
        remainingAmount: moneyString(nextRemaining),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "application_reversed",
      amount: moneyString(chunk),
      signedDelta: moneyString(chunk),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      notes: input.reason,
      performedById: input.performedById,
    });
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));
}

export async function issueCustomerRefund(
  tx: DbOrTx,
  input: {
    customerId: string;
    amount: number;
    walletId: string;
    refundDate: Date;
    notes?: string;
    salesReturnId?: string;
    allowOverdraw?: boolean;
    performedById: string;
    permissions: string[];
  },
) {
  const refundAmount = roundMoney(input.amount);
  if (refundAmount <= 0) throw new Error("Refund amount must be greater than zero");

  const customer = await lockCustomerRow(tx, input.customerId);
  const currentBalance = roundMoney(customer.creditBalance);
  if (refundAmount > currentBalance) {
    throw new Error(
      `Refund amount (Rs ${formatPakistaniNumber(refundAmount)}) exceeds available credit (Rs ${formatPakistaniNumber(currentBalance)}).`,
    );
  }

  await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, input.walletId)).for("update");
  const wallet = await tx.query.wallets.findFirst({
    where: eq(wallets.id, input.walletId),
    columns: { id: true, name: true, balance: true, type: true },
  });
  if (!wallet) throw new Error("Selected account not found");

  const nextWalletBalance = new Big(wallet.balance).minus(refundAmount);
  if (nextWalletBalance.lt(0)) {
    const canOverdraw = hasPermission(input.permissions, "finance.manage");
    if (!canOverdraw) {
      throw new Error(
        `"${wallet.name}" only has Rs ${formatPakistaniNumber(roundMoney(wallet.balance))}. Pick a funded account or ask Finance to record a deposit first.`,
      );
    }
    if (!input.allowOverdraw) {
      throw overdrawError(wallet.name, nextWalletBalance.toFixed(2));
    }
  }

  let scopedReturn: { id: string; creditNoteNumber: string | null } | null = null;
  let candidateLots = await lockActiveCustomerLots(tx, input.customerId);

  if (input.salesReturnId) {
    const ret = await tx.query.salesReturns.findFirst({
      where: and(
        eq(salesReturns.id, input.salesReturnId),
        eq(salesReturns.customerId, input.customerId),
      ),
      columns: { id: true, creditNoteNumber: true, status: true },
    });
    if (!ret || ret.status !== "completed") {
      throw new Error("Completed return not found for customer refund");
    }
    scopedReturn = { id: ret.id, creditNoteNumber: ret.creditNoteNumber };
    candidateLots = candidateLots.filter((lot) => lot.sourceReturnId === ret.id);
    const returnAvailable = roundMoney(
      candidateLots.reduce((sum, lot) => sum + roundMoney(lot.remainingAmount), 0),
    );
    if (refundAmount > returnAvailable) {
      throw new Error(
        `Refund amount (Rs ${formatPakistaniNumber(refundAmount)}) exceeds remaining credit from this return (Rs ${formatPakistaniNumber(returnAvailable)}).`,
      );
    }
  }

  const plan = selectFifoAllocations(refundAmount, candidateLots);
  const newCustomerBalance = roundMoney(new Big(currentBalance).minus(refundAmount).toNumber());
  const refundId = createId();
  const walletTxId = createId();

  await tx
    .update(wallets)
    .set({ balance: nextWalletBalance.toFixed(2) })
    .where(eq(wallets.id, wallet.id));

  await tx.insert(transactions).values({
    id: walletTxId,
    walletId: wallet.id,
    type: "debit",
    amount: moneyString(refundAmount),
    source: "Customer Refund",
    referenceId: refundId,
    description: `${customer.name}${scopedReturn?.creditNoteNumber ? ` (${scopedReturn.creditNoteNumber})` : ""}${input.notes ? ` — ${input.notes}` : ""}`,
    effectiveDate: input.refundDate,
    performedById: input.performedById,
  });

  await tx.insert(customerRefunds).values({
    id: refundId,
    customerId: input.customerId,
    salesReturnId: scopedReturn?.id ?? null,
    creditNoteNumber: scopedReturn?.creditNoteNumber ?? null,
    walletId: wallet.id,
    walletTransactionId: walletTxId,
    amount: moneyString(refundAmount),
    refundDate: input.refundDate,
    notes: input.notes?.trim() || null,
    status: "active",
    issuedById: input.performedById,
  });

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newCustomerBalance) })
    .where(eq(customers.id, input.customerId));

  const lotMap = new Map(candidateLots.map((lot) => [lot.id, lot]));
  let runningBalance = currentBalance;

  for (const chunk of plan) {
    const lot = lotMap.get(chunk.lotId)!;
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).minus(chunk.amount).toNumber());
    const nextRefunded = roundMoney(new Big(lot.refundedAmount).plus(chunk.amount).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(chunk.amount).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(nextRemaining),
        refundedAmount: moneyString(nextRefunded),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerRefundAllocations).values({
      id: createId(),
      refundId,
      creditLotId: lot.id,
      amount: moneyString(chunk.amount),
      status: "active",
    });

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "refunded",
      amount: moneyString(chunk.amount),
      signedDelta: moneyString(-chunk.amount),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      refundId,
      walletId: wallet.id,
      notes: input.notes?.trim() || `Refunded from ${wallet.name}`,
      performedById: input.performedById,
    });
  }

  return {
    refundId,
    walletTransactionId: walletTxId,
    walletName: wallet.name,
    amount: refundAmount,
    balanceAfter: newCustomerBalance,
  };
}

export async function reverseCustomerRefund(
  tx: DbOrTx,
  input: {
    refundId: string;
    reason: string;
    performedById: string;
  },
) {
  const [refund] = await tx
    .select()
    .from(customerRefunds)
    .where(eq(customerRefunds.id, input.refundId))
    .for("update");
  if (!refund) throw new Error("Refund record not found");
  if (refund.status === "reversed") {
    throw new Error("This refund has already been reversed");
  }

  if (refund.salesReturnId) {
    const ret = await tx.query.salesReturns.findFirst({
      where: eq(salesReturns.id, refund.salesReturnId),
      columns: { status: true, returnNumber: true },
    });
    if (ret?.status === "voided") {
      throw new Error(`Return #${ret.returnNumber} is already voided`);
    }
  }

  const customer = await lockCustomerRow(tx, refund.customerId);
  await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, refund.walletId)).for("update");
  const wallet = await tx.query.wallets.findFirst({
    where: eq(wallets.id, refund.walletId),
    columns: { id: true, name: true, balance: true },
  });
  if (!wallet) throw new Error("Refund wallet not found");

  const refundAmount = roundMoney(refund.amount);
  const now = new Date();
  const reversalTxId = createId();

  await tx
    .update(wallets)
    .set({ balance: new Big(wallet.balance).plus(refundAmount).toFixed(2) })
    .where(eq(wallets.id, wallet.id));

  await tx.insert(transactions).values({
    id: reversalTxId,
    walletId: wallet.id,
    type: "credit",
    amount: moneyString(refundAmount),
    source: "Customer Refund Reversal",
    referenceId: refund.id,
    reversalOfTransactionId: refund.walletTransactionId,
    description: `Reversed refund for ${customer.name}: ${input.reason.trim()}`,
    effectiveDate: now,
    performedById: input.performedById,
  });

  await tx
    .update(customerRefunds)
    .set({
      status: "reversed",
      reversedById: input.performedById,
      reversedAt: now,
      reverseReason: input.reason.trim(),
      reversalTransactionId: reversalTxId,
    })
    .where(eq(customerRefunds.id, refund.id));

  const allocations = await tx
    .select()
    .from(customerRefundAllocations)
    .where(
      and(
        eq(customerRefundAllocations.refundId, refund.id),
        eq(customerRefundAllocations.status, "active"),
      ),
    )
    .for("update");

  const lotIds = allocations.map((a) => a.creditLotId);
  const lots =
    lotIds.length > 0
      ? await tx
          .select()
          .from(customerCreditLots)
          .where(inArray(customerCreditLots.id, lotIds))
          .for("update")
      : [];
  const lotMap = new Map(lots.map((l) => [l.id, l]));
  let runningBalance = roundMoney(customer.creditBalance);

  for (const alloc of allocations) {
    const lot = lotMap.get(alloc.creditLotId);
    if (!lot) throw new Error("Linked customer credit lot not found");
    if (lot.voidedAt) {
      throw new Error("Cannot reverse refund for a voided credit note lot.");
    }
    const chunk = roundMoney(alloc.amount);
    const nextRefunded = roundMoney(new Big(lot.refundedAmount).minus(chunk).toNumber());
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).plus(chunk).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).plus(chunk).toNumber());

    await tx
      .update(customerRefundAllocations)
      .set({ status: "reversed", reversedAt: now })
      .where(eq(customerRefundAllocations.id, alloc.id));

    await tx
      .update(customerCreditLots)
      .set({
        refundedAmount: moneyString(nextRefunded),
        remainingAmount: moneyString(nextRemaining),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: refund.customerId,
      creditLotId: lot.id,
      type: "refund_reversed",
      amount: moneyString(chunk),
      signedDelta: moneyString(chunk),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      refundId: refund.id,
      walletId: wallet.id,
      notes: input.reason.trim(),
      performedById: input.performedById,
    });
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, refund.customerId));

  return { refundId: refund.id, balanceAfter: runningBalance };
}

async function unapplyAllocationsFromVoidingLots(
  tx: DbOrTx,
  params: {
    customerId: string;
    voidingLots: Array<typeof customerCreditLots.$inferSelect>;
    reason: string;
    performedById: string;
    currentCreditBalance: number;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
) {
  const lotIds = params.voidingLots.map((l) => l.id);
  if (lotIds.length === 0) return;

  const allocRows = await tx
    .select()
    .from(customerCreditPaymentAllocations)
    .where(
      and(
        inArray(customerCreditPaymentAllocations.creditLotId, lotIds),
        eq(customerCreditPaymentAllocations.status, "active"),
      ),
    )
    .for("update");

  if (allocRows.length === 0) return;

  const affectedPaymentIds = [...new Set(allocRows.map((a) => a.paymentId))];
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(inArray(payments.id, affectedPaymentIds))
    .orderBy(asc(payments.invoiceId), asc(payments.id))
    .for("update");

  const affectedInvoiceIds = [...new Set(paymentRows.map((p) => p.invoiceId))].sort();
  await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.id, affectedInvoiceIds))
    .orderBy(asc(invoices.id))
    .for("update");

  const invoiceNumbers = await tx.query.invoices.findMany({
    where: inArray(invoices.id, affectedInvoiceIds),
    columns: { id: true, invoiceNumber: true },
  });
  const invoiceNumberMap = new Map(invoiceNumbers.map((inv) => [inv.id, inv.invoiceNumber]));
  const lotSet = new Set(lotIds);
  const lotMap = new Map(params.voidingLots.map((l) => [l.id, l]));
  const now = new Date();

  for (const payment of paymentRows) {
    const allPaymentAllocs = await tx
      .select()
      .from(customerCreditPaymentAllocations)
      .where(
        and(
          eq(customerCreditPaymentAllocations.paymentId, payment.id),
          eq(customerCreditPaymentAllocations.status, "active"),
        ),
      )
      .for("update");

    const voidingAllocs = allPaymentAllocs.filter((a) => lotSet.has(a.creditLotId));
    const keepingAllocs = allPaymentAllocs.filter((a) => !lotSet.has(a.creditLotId));
    if (voidingAllocs.length === 0) continue;

    await tx
      .update(payments)
      .set({
        status: "reversed",
        resolvedById: params.performedById,
        resolvedAt: now,
        resolutionReason: `Credit note voided: ${params.reason}`,
      })
      .where(eq(payments.id, payment.id));

    for (const vAlloc of voidingAllocs) {
      await tx
        .update(customerCreditPaymentAllocations)
        .set({ status: "reversed", reversedAt: now })
        .where(eq(customerCreditPaymentAllocations.id, vAlloc.id));

      const lot = lotMap.get(vAlloc.creditLotId)!;
      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: params.customerId,
        creditLotId: lot.id,
        type: "void_unapplied",
        amount: vAlloc.amount,
        signedDelta: "0.00",
        balanceAfter: moneyString(params.currentCreditBalance),
        salesReturnId: lot.sourceReturnId,
        creditNoteNumber: lot.creditNoteNumber,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        notes: `Removed from Invoice ${invoiceNumberMap.get(payment.invoiceId) ?? payment.invoiceId}: ${params.reason}`,
        performedById: params.performedById,
      });
    }

    if (keepingAllocs.length > 0) {
      const preservedSum = roundMoney(
        keepingAllocs.reduce((sum, a) => sum + roundMoney(a.amount), 0),
      );
      const replacementPaymentId = createId();
      await tx.insert(payments).values({
        id: replacementPaymentId,
        customerId: payment.customerId,
        invoiceId: payment.invoiceId,
        amount: moneyString(preservedSum),
        method: "customer_credit",
        status: "confirmed",
        walletId: null,
        reference: payment.reference,
        recordedById: params.performedById,
        paymentDate: payment.paymentDate,
        effectiveDate: payment.effectiveDate ?? now,
        source: payment.source,
        sourceRecordId: null,
        allocationGroupId: payment.allocationGroupId,
        confirmedById: params.performedById,
        confirmedAt: now,
        notes: payment.notes ?? "Remaining active store credit allocation after void",
      });

      await tx
        .update(customerCreditPaymentAllocations)
        .set({ paymentId: replacementPaymentId })
        .where(
          inArray(
            customerCreditPaymentAllocations.id,
            keepingAllocs.map((a) => a.id),
          ),
        );
    }

    const removedTotal = roundMoney(
      voidingAllocs.reduce((sum, a) => sum + roundMoney(a.amount), 0),
    );
    await params.recordTimeline({
      invoiceId: payment.invoiceId,
      eventType: "payment",
      title: `Store credit payment reversed (${formatPakistaniNumber(removedTotal)})`,
      description: `Store credit of PKR ${removedTotal.toFixed(2)} was removed because the source return was voided (${params.reason}).`,
      metadata: { paymentId: payment.id, removedAmount: removedTotal, reason: params.reason },
      actorId: params.performedById,
    });
  }

  for (const invId of affectedInvoiceIds) {
    await params.recalculateInvoice(invId);
  }
}

export async function reclaimPaymentOverageCredit(
  tx: DbOrTx,
  input: {
    invoiceId: string;
    customerId: string;
    reclaimAmount: number;
    reason: string;
    performedById: string;
    allowUnapplyApplied: boolean;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
): Promise<number> {
  const needed = roundMoney(input.reclaimAmount);
  if (needed <= 0) return 0;

  const customer = await lockCustomerRow(tx, input.customerId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceInvoiceId, input.invoiceId),
        eq(customerCreditLots.sourceType, "payment_overage"),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .orderBy(desc(customerCreditLots.createdAt), desc(customerCreditLots.id))
    .for("update");

  let leftToReclaim = new Big(needed);
  let runningBalance = roundMoney(customer.creditBalance);

  // Check if refunded cash blocks reclaim
  const totalRefunded = roundMoney(
    lots.reduce((sum, lot) => sum + roundMoney(lot.refundedAmount), 0),
  );
  const totalReclaimableCapacity = roundMoney(
    lots.reduce(
      (sum, lot) =>
        sum +
        roundMoney(lot.remainingAmount) +
        (input.allowUnapplyApplied ? roundMoney(lot.appliedAmount) : 0),
      0,
    ),
  );

  if (totalReclaimableCapacity < needed) {
    if (totalRefunded > 0) {
      throw formatVoidBlockedByRefundError({
        refundedAmount: totalRefunded,
        customerId: customer.id,
        customerName: customer.name,
        customerType: customer.customerType,
      });
    }
    throw new Error(
      `Cannot reverse payment: Rs ${formatPakistaniNumber(needed)} of overpayment credit on this invoice was already applied or refunded.`,
    );
  }

  const lotsNeedingUnapply: Array<{ lot: typeof customerCreditLots.$inferSelect; takeApplied: number }> = [];

  for (const lot of lots) {
    if (leftToReclaim.lte(0)) break;
    const rem = new Big(roundMoney(lot.remainingAmount));
    const takeRem = rem.lt(leftToReclaim) ? rem : leftToReclaim;
    if (takeRem.gt(0)) {
      const amt = roundMoney(takeRem.toNumber());
      runningBalance = roundMoney(new Big(runningBalance).minus(amt).toNumber());
      await tx
        .update(customerCreditLots)
        .set({
          remainingAmount: moneyString(roundMoney(rem.minus(takeRem).toNumber())),
          reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(takeRem).toNumber())),
        })
        .where(eq(customerCreditLots.id, lot.id));

      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: input.customerId,
        creditLotId: lot.id,
        type: "void_reclaimed",
        amount: moneyString(amt),
        signedDelta: moneyString(-amt),
        balanceAfter: moneyString(runningBalance),
        invoiceId: input.invoiceId,
        notes: input.reason,
        performedById: input.performedById,
      });
      leftToReclaim = leftToReclaim.minus(takeRem);
    }

    if (leftToReclaim.gt(0) && input.allowUnapplyApplied && new Big(lot.appliedAmount).gt(0)) {
      const takeApplied = new Big(lot.appliedAmount).lt(leftToReclaim)
        ? new Big(lot.appliedAmount)
        : leftToReclaim;
      lotsNeedingUnapply.push({ lot, takeApplied: roundMoney(takeApplied.toNumber()) });
      leftToReclaim = leftToReclaim.minus(takeApplied);
    }
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));

  if (lotsNeedingUnapply.length > 0) {
    await unapplyAllocationsFromVoidingLots(tx, {
      customerId: input.customerId,
      voidingLots: lotsNeedingUnapply.map((entry) => entry.lot),
      reason: input.reason,
      performedById: input.performedById,
      currentCreditBalance: runningBalance,
      recalculateInvoice: input.recalculateInvoice,
      recordTimeline: input.recordTimeline,
    });
    for (const { lot, takeApplied } of lotsNeedingUnapply) {
      const appliedNum = roundMoney(lot.appliedAmount);
      const surplusReturned = roundMoney(Math.max(0, appliedNum - takeApplied));
      runningBalance = roundMoney(new Big(runningBalance).plus(surplusReturned).toNumber());
      await tx
        .update(customerCreditLots)
        .set({
          appliedAmount: "0.00",
          reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(takeApplied).toNumber())),
          remainingAmount: moneyString(surplusReturned),
          voidedAt: surplusReturned > 0 ? null : new Date(),
        })
        .where(eq(customerCreditLots.id, lot.id));
    }
    await tx
      .update(customers)
      .set({ creditBalance: moneyString(runningBalance) })
      .where(eq(customers.id, input.customerId));
  }

  return needed;
}

export async function reclaimInvoiceReturnCreditForPaymentReversal(
  tx: DbOrTx,
  input: {
    invoiceId: string;
    customerId: string;
    reopenNeeded: number;
    performedById: string;
  },
) {
  const needed = roundMoney(input.reopenNeeded);
  if (needed <= 0) return;

  const returnLots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceInvoiceId, input.invoiceId),
        eq(customerCreditLots.sourceType, "sales_return"),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .orderBy(desc(customerCreditLots.createdAt), desc(customerCreditLots.id))
    .for("update");

  if (returnLots.length === 0) return;

  const totalRemaining = roundMoney(
    returnLots.reduce((sum, l) => sum + roundMoney(l.remainingAmount), 0),
  );
  const totalCustomerCreditFromReturns = roundMoney(
    returnLots.reduce((sum, l) => sum + roundMoney(l.originalAmount), 0),
  );
  const pullTarget = roundMoney(Math.min(needed, totalCustomerCreditFromReturns));

  if (pullTarget > totalRemaining) {
    throw new Error(
      "Cannot reverse payment: store credit generated after returns on this invoice has already been applied or refunded. Reverse the refund or credit application first.",
    );
  }

  const customer = await lockCustomerRow(tx, input.customerId);
  let left = new Big(pullTarget);
  let runningBalance = roundMoney(customer.creditBalance);

  for (const lot of returnLots) {
    if (left.lte(0)) break;
    const rem = new Big(roundMoney(lot.remainingAmount));
    if (rem.lte(0)) continue;
    const take = rem.lt(left) ? rem : left;
    const takeNum = roundMoney(take.toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(takeNum).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(roundMoney(rem.minus(take).toNumber())),
        reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(take).toNumber())),
      })
      .where(eq(customerCreditLots.id, lot.id));

    if (lot.sourceReturnId) {
      const ret = await tx.query.salesReturns.findFirst({
        where: eq(salesReturns.id, lot.sourceReturnId),
        columns: { id: true, appliedToInvoiceAmount: true, customerCreditAmount: true },
      });
      if (ret) {
        await tx
          .update(salesReturns)
          .set({
            appliedToInvoiceAmount: moneyString(
              roundMoney(new Big(ret.appliedToInvoiceAmount).plus(takeNum).toNumber()),
            ),
            customerCreditAmount: moneyString(
              roundMoney(Math.max(0, new Big(ret.customerCreditAmount).minus(takeNum).toNumber())),
            ),
          })
          .where(eq(salesReturns.id, ret.id));
      }
    }

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "void_reclaimed",
      amount: moneyString(takeNum),
      signedDelta: moneyString(-takeNum),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      notes: "Reclaimed unused return credit onto invoice after payment reversal",
      performedById: input.performedById,
    });

    left = left.minus(take);
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));
}

export async function voidReturnCreditSettlement(
  tx: DbOrTx,
  input: {
    salesReturnId: string;
    invoiceId: string;
    customerId: string;
    creditNoteNumber: string | null;
    reason: string;
    performedById: string;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
) {
  const customer = await lockCustomerRow(tx, input.customerId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceReturnId, input.salesReturnId),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .for("update");

  const refundedSum = roundMoney(
    lots.reduce((sum, lot) => sum + roundMoney(lot.refundedAmount), 0),
  );
  if (refundedSum > 0) {
    throw formatVoidBlockedByRefundError({
      refundedAmount: refundedSum,
      customerId: customer.id,
      customerName: customer.name,
      customerType: customer.customerType,
    });
  }

  let runningBalance = roundMoney(customer.creditBalance);
  const now = new Date();
  const appliedLots: Array<typeof customerCreditLots.$inferSelect> = [];

  for (const lot of lots) {
    const rem = roundMoney(lot.remainingAmount);
    if (rem > 0) {
      runningBalance = roundMoney(Math.max(0, new Big(runningBalance).minus(rem).toNumber()));
      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: input.customerId,
        creditLotId: lot.id,
        type: "void_reclaimed",
        amount: moneyString(rem),
        signedDelta: moneyString(-rem),
        balanceAfter: moneyString(runningBalance),
        salesReturnId: input.salesReturnId,
        creditNoteNumber: lot.creditNoteNumber,
        invoiceId: input.invoiceId,
        notes: `Reclaimed unused credit on void of ${lot.creditNoteNumber ?? input.salesReturnId}: ${input.reason}`,
        performedById: input.performedById,
      });
    }
    if (roundMoney(lot.appliedAmount) > 0) {
      appliedLots.push(lot);
    }
  }

  if (runningBalance !== roundMoney(customer.creditBalance)) {
    await tx
      .update(customers)
      .set({ creditBalance: moneyString(runningBalance) })
      .where(eq(customers.id, input.customerId));
  }

  if (appliedLots.length > 0) {
    await unapplyAllocationsFromVoidingLots(tx, {
      customerId: input.customerId,
      voidingLots: appliedLots,
      reason: input.reason,
      performedById: input.performedById,
      currentCreditBalance: runningBalance,
      recalculateInvoice: input.recalculateInvoice,
      recordTimeline: input.recordTimeline,
    });
  }

  if (lots.length > 0) {
    await tx
      .update(customerCreditLots)
      .set({ remainingAmount: "0.00", appliedAmount: "0.00", voidedAt: now })
      .where(inArray(customerCreditLots.id, lots.map((l) => l.id)));
  }
  // Note: Any payment_overage credit excess on the parent invoice is reclaimed inside
  // recalculateInvoiceSettlement(tx, salesReturn.invoiceId, { allowUnapplyOverageOnReturnVoid: true, ... })
  // immediately after marking this salesReturn row as 'voided'.
}

export async function getCustomerCreditSummary(db: DbOrTx, customerId: string) {
  await ensureCreditNotesBackfilled(db as typeof rootDb);

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, customerType: true, creditBalance: true, outstandingAmount: true },
  });
  if (!customer) throw new Error("Customer not found");

  const movements = await db.query.customerCreditMovements.findMany({
    where: eq(customerCreditMovements.customerId, customerId),
    with: {
      wallet: { columns: { id: true, name: true } },
      invoice: { columns: { id: true, invoiceNumber: true } },
      salesReturn: { columns: { id: true, returnNumber: true, creditNoteNumber: true, status: true } },
      refund: {
        columns: {
          id: true,
          status: true,
          refundDate: true,
          reverseReason: true,
          reversedAt: true,
          walletTransactionId: true,
        },
      },
      performedBy: { columns: { id: true, name: true } },
    },
    orderBy: [desc(customerCreditMovements.createdAt), desc(customerCreditMovements.id)],
    limit: 50,
  });

  const refunds = await db.query.customerRefunds.findMany({
    where: eq(customerRefunds.customerId, customerId),
    with: {
      wallet: { columns: { id: true, name: true, type: true } },
      issuedBy: { columns: { id: true, name: true } },
      reversedBy: { columns: { id: true, name: true } },
    },
    orderBy: [desc(customerRefunds.refundDate), desc(customerRefunds.createdAt)],
    limit: 50,
  });

  return {
    customerId: customer.id,
    customerName: customer.name,
    customerType: customer.customerType,
    creditBalance: roundMoney(customer.creditBalance),
    outstandingAmount: roundMoney(customer.outstandingAmount),
    movements: movements.map((m) => ({
      ...m,
      amount: roundMoney(m.amount),
      signedDelta: roundMoney(m.signedDelta),
      balanceAfter: roundMoney(m.balanceAfter),
    })),
    refunds: refunds.map((r) => ({
      ...r,
      amount: roundMoney(r.amount),
    })),
  };
}

let backfillCompleted = false;

export async function ensureCreditNotesBackfilled(db: typeof rootDb): Promise<void> {
  if (backfillCompleted) return;
  if (typeof (db as { transaction?: unknown }).transaction !== "function") return;

  const missingCountRows = await db
    .select({ id: salesReturns.id })
    .from(salesReturns)
    .where(and(inArray(salesReturns.status, ["completed", "voided"]), isNull(salesReturns.creditNoteNumber)))
    .limit(1);

  if (missingCountRows.length === 0) {
    backfillCompleted = true;
    return;
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(salesReturns)
      .where(and(inArray(salesReturns.status, ["completed", "voided"]), isNull(salesReturns.creditNoteNumber)))
      .orderBy(asc(salesReturns.completedAt), asc(salesReturns.createdAt), asc(salesReturns.id))
      .for("update");

    for (const ret of rows) {
      const creditNoteNumber = await allocateNextCreditNoteNumber(tx);
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, ret.invoiceId))
        .for("update");

      const totalAmount = roundMoney(ret.totalAmount);
      if (!inv || ret.status === "voided") {
        await tx
          .update(salesReturns)
          .set({
            creditNoteNumber,
            creditNoteIssuedAt: ret.completedAt ?? ret.createdAt,
            appliedToInvoiceAmount: ret.status === "voided" ? moneyString(totalAmount) : "0.00",
            customerCreditAmount: "0.00",
          })
          .where(eq(salesReturns.id, ret.id));
        continue;
      }

      const priorReturns = await tx
        .select({ applied: salesReturns.appliedToInvoiceAmount })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.invoiceId, inv.id),
            eq(salesReturns.status, "completed"),
            sql`${salesReturns.creditNoteNumber} is not null`,
          ),
        );
      const priorApplied = roundMoney(
        priorReturns.reduce((s, r) => s + roundMoney(r.applied), 0),
      );
      const preReturnOpen = roundMoney(
        Math.max(
          0,
          roundMoney(inv.totalPrice) -
            priorApplied -
            roundMoney(inv.paidAmount) +
            roundMoney(inv.excessCreditedAmount),
        ),
      );
      const split = computeReturnCreditSplit(totalAmount, preReturnOpen);
      const newReturnedTotal = roundMoney(priorApplied + split.appliedToInvoiceAmount);
      const nextOutstanding = roundMoney(
        Math.max(
          0,
          roundMoney(inv.totalPrice) -
            roundMoney(inv.paidAmount) -
            newReturnedTotal +
            roundMoney(inv.excessCreditedAmount),
        ),
      );

      await tx
        .update(salesReturns)
        .set({
          creditNoteNumber,
          creditNoteIssuedAt: ret.completedAt ?? ret.createdAt,
          appliedToInvoiceAmount: moneyString(split.appliedToInvoiceAmount),
          customerCreditAmount: moneyString(split.customerCreditAmount),
        })
        .where(eq(salesReturns.id, ret.id));

      await tx
        .update(invoices)
        .set({
          returnedAmount: moneyString(newReturnedTotal),
          outstandingAmount: moneyString(nextOutstanding),
          paymentStatus: nextOutstanding <= 0 ? "paid" : roundMoney(inv.paidAmount) > 0 ? "partially_paid" : "unpaid",
        })
        .where(eq(invoices.id, inv.id));

      await tx
        .update(slipRecords)
        .set({
          returnedAmount: moneyString(newReturnedTotal),
          outstandingAmount: moneyString(nextOutstanding),
          status: nextOutstanding <= 0 ? "closed" : roundMoney(inv.paidAmount) > 0 ? "partially_recovered" : "open",
        })
        .where(eq(slipRecords.invoiceId, inv.id));

      if (split.customerCreditAmount > 0) {
        await issueCustomerCreditFromReturn(tx, {
          customerId: ret.customerId,
          salesReturnId: ret.id,
          sourceInvoiceId: inv.id,
          creditNoteNumber,
          amount: split.customerCreditAmount,
          performedById: ret.receivedById ?? ret.createdById ?? inv.performedById,
          notes: `Backfilled store credit for ${creditNoteNumber}`,
        });
      }

      const [sumOutstanding] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${invoices.outstandingAmount}), 0)` })
        .from(invoices)
        .where(and(eq(invoices.customerId, ret.customerId), sql`${invoices.status} <> 'voided'`));
      await tx
        .update(customers)
        .set({ outstandingAmount: moneyString(roundMoney(sumOutstanding?.total ?? 0)) })
        .where(eq(customers.id, ret.customerId));
    }
  });

  backfillCompleted = true;
}
```

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/lib/sales/returns/return-lifecycle.test.ts src/server-functions/sales/customer-credit-service.test.ts src/lib/sales/settlement/math.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/settlement/contracts.ts src/lib/sales/returns/return-lifecycle.ts src/server-functions/sales/customer-credit-service.ts src/lib/sales/settlement/math.test.ts src/lib/sales/returns/return-lifecycle.test.ts src/server-functions/sales/customer-credit-service.test.ts
git commit -m "feat(sales): add return credit note split logic and customer credit service"
```


---

## Task 4: Settlement Service, Server Functions & `customer-credit-fn.ts`

**Files:**
- Modify: `src/server-functions/sales/settlement-service.ts`
- Modify: `src/server-functions/sales/sales-returns-fn.ts`
- Modify: `src/server-functions/sales/invoice-detail-fn.ts`
- Modify: `src/server-functions/sales/invoice-posting-service.ts`
- Modify: `src/server-functions/sales/invoices-fn.ts`
- Modify: `src/db/zod_schemas.ts`
- Modify: `src/server-functions/sales/reconciliation-fn.ts`
- Modify: `src/server-functions/sales/payment-settlement-fn.ts`
- Create: `src/server-functions/sales/customer-credit-fn.ts`
- Test (modify): `src/lib/sales-workflows.test.ts`
- Test (create): `src/server-functions/sales/customer-credit-fn.test.ts`

**Interfaces:**
- Consumes: `customer-credit-service.ts`, `return-lifecycle.ts`, `math.ts`, `middlewares.ts`
- Produces:
  - `settlement-service.ts` handling `customer_credit` payments, non-negative `outstandingAmount`, `excessCreditedAmount` tracking + delayed overage issuance/reclaim, and `customer_credit` reversal + payment-reversal return-credit pullback
  - `sales-returns-fn.ts` returning `{ ...updated, creditNoteNumber, appliedToInvoiceAmount, customerCreditAmount, customerName, customerId, customerType, leftoverCreditBalance }` on completion, blocking or auto-unapplying credit on void, and exposing CN + split metadata + refund info on list/detail
  - `customer-credit-fn.ts` exporting `getCustomerCreditSummaryFn`, `issueCustomerRefundFn`, `reverseCustomerRefundFn` with dynamic `await import("@/db")`

- [ ] **Step 1: Write the failing server-function contract & behavioral tests**

Create `src/server-functions/sales/customer-credit-fn.test.ts` and add `"customer-credit-fn.ts"` to the dynamic `@/db` guard in `src/lib/sales-workflows.test.ts:313-320`:

```ts
// Create src/server-functions/sales/customer-credit-fn.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { invoicePaymentInputSchema } from "@/db/zod_schemas";

describe("customer-credit-fn & settlement server contracts", () => {
  it("gates customer credit summary, refund issuance, and refund reversal with exact middlewares and dynamic db imports", () => {
    const fnSource = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/customer-credit-fn.ts"),
      "utf8",
    );
    expect(fnSource).not.toContain('import { db } from "@/db"');
    expect(fnSource).toContain('await import("@/db")');
    expect(fnSource).toContain("requireSalesViewMiddleware");
    expect(fnSource).toContain("requireFinanceRefundsIssueMiddleware");
    expect(fnSource).toContain("requireFinancePaymentReversalOrManageMiddleware");
    expect(fnSource).toContain("issueCustomerRefund(tx,");
    expect(fnSource).toContain("reverseCustomerRefund(tx,");
  });

  it("validates customer_credit invoice payment rows without requiring walletId", () => {
    const parsed = invoicePaymentInputSchema.parse({
      method: "customer_credit",
      amount: 1500,
      paymentDate: "2026-11-11T10:00:00Z",
    });
    expect(parsed.method).toBe("customer_credit");
    expect(parsed.walletId).toBeUndefined();
  });

  it("wires credit note counter and split logic into sales-returns-fn and settlement-service", () => {
    const returnsFn = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/sales-returns-fn.ts"),
      "utf8",
    );
    const settlement = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/settlement-service.ts"),
      "utf8",
    );
    const posting = readFileSync(
      resolve(process.cwd(), "src/server-functions/sales/invoice-posting-service.ts"),
      "utf8",
    );

    expect(returnsFn).toContain("allocateNextCreditNoteNumber");
    expect(returnsFn).toContain("computeReturnCreditSplit");
    expect(returnsFn).toContain("issueCustomerCreditFromReturn");
    expect(returnsFn).toContain("voidReturnCreditSettlement");
    expect(returnsFn).toContain("allowUnapplyOverageOnReturnVoid: true");

    expect(settlement).toContain("applyCustomerCreditToPayment");
    expect(settlement).toContain("restoreCustomerCreditForReversedPayment");
    expect(settlement).toContain("issuePaymentOverageCredit");
    expect(settlement).toContain("reclaimPaymentOverageCredit");
    expect(settlement).toContain("reclaimInvoiceReturnCreditForPaymentReversal");
    expect(settlement).not.toContain('throw new Error("Returned Amount cannot exceed invoice total")');

    expect(posting).toContain('payment.method === "customer_credit"');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test src/server-functions/sales/customer-credit-fn.test.ts`
Expected: FAIL (`customer-credit-fn.ts` does not exist; `invoicePaymentInputSchema` rejects `"customer_credit"`).

- [ ] **Step 3: Update `settlement-service.ts`**

Edit `src/server-functions/sales/settlement-service.ts`:
1. Add imports at top (`line 21`):
   ```ts
   import {
     applyCustomerCreditToPayment,
     issuePaymentOverageCredit,
     reclaimInvoiceReturnCreditForPaymentReversal,
     reclaimPaymentOverageCredit,
     restoreCustomerCreditForReversedPayment,
   } from "./customer-credit-service";
   ```
2. Update `preparePayment` (`lines 113-181`): handle `input.method === "customer_credit"` right after `input.method === "expense_offset"`:
   ```ts
   	if (input.method === "customer_credit") {
   		return {
   			method: input.method,
   			amount,
   			walletId: null,
   			reference: cleanOptional(input.reference),
   			chequeNumber: null,
   			chequeBank: null,
   			chequeDate: null,
   			expenseType: null,
   			expenseEmployeeId: null,
   			paymentDate: input.paymentDate,
   			sourceRecordId: cleanOptional(input.sourceRecordId),
   			allocationGroupId: cleanOptional(input.allocationGroupId),
   			notes: cleanOptional(input.notes),
   			instantVerify: true,
   		};
   	}
   ```
3. Update `initialStatus` (`lines 183-187`):
   ```ts
   function initialStatus(method: PaymentMethod): PaymentStatus {
   	return method === "cash" ||
   		method === "expense_offset" ||
   		method === "customer_credit"
   		? "confirmed"
   		: "pending";
   }
   ```
4. Update `getReceivedReturnAmount` (`lines 229-244`) to sum `appliedToInvoiceAmount`:
   ```ts
   async function getReceivedReturnAmount(
   	tx: SalesTransaction,
   	invoiceId: string,
   ): Promise<number> {
   	const rows = await tx.query.salesReturns.findMany({
   		where: and(
   			eq(salesReturns.invoiceId, invoiceId),
   			eq(salesReturns.status, "completed"),
   			isNotNull(salesReturns.completedAt),
   		),
   		columns: { appliedToInvoiceAmount: true },
   	});
   	return roundMoney(
   		rows.reduce((sum, row) => sum + Number(row.appliedToInvoiceAmount), 0),
   	);
   }
   ```
5. Update `assertWalletType` (`line 249`), `creditWalletForPayment` (`line 272`), and `validatePreparedWallets` (`line 372`) to skip `customer_credit`:
   ```ts
   async function assertWalletType(
   	tx: SalesTransaction,
   	walletId: string,
   	method: Exclude<PaymentMethod, "expense_offset" | "customer_credit">,
   ): Promise<void> { ... }
   ```
   In `creditWalletForPayment`:
   ```ts
   if (payment.method === "expense_offset" || payment.method === "customer_credit") return;
   ```
   In `validatePreparedWallets`:
   ```ts
   if (
   	payment.method === "expense_offset" ||
   	payment.method === "customer_credit" ||
   	!payment.walletId
   ) {
   	continue;
   }
   ```
6. Update `insertPayment` (`lines 362-365`) so inserting a `customer_credit` payment immediately allocates FIFO store credit lots inside the transaction:
   ```ts
   	if (!payment) throw new Error("Payment could not be recorded");
   	if (prepared.method === "customer_credit") {
   		await applyCustomerCreditToPayment(tx, {
   			customerId: invoice.customerId,
   			paymentId: payment.id,
   			invoiceId: invoice.id,
   			amount: prepared.amount,
   			performedById: actorId,
   			notes: prepared.notes ?? `Applied to Invoice #${invoice.invoiceNumber ?? invoice.id}`,
   		});
   	}
   	return payment;
   ```
7. Update `assertProposedSettlement` (`lines 396-416`) so existing over-paid invoices or prior returned invoices don't reject valid additional settlements within remaining open capacity, and validate due dates against remaining capacity:
   ```ts
   async function assertProposedSettlement(
   	tx: SalesTransaction,
   	invoice: InvoiceRecord,
   	newPayments: PreparedPayment[],
   ): Promise<void> {
   	const existing = await listSettlementPayments(tx, invoice.id);
   	const proposed = newPayments.map((payment) => ({
   		amount: payment.amount,
   		method: payment.method,
   		status:
   			payment.instantVerify || payment.method === "customer_credit"
   				? ("confirmed" as const)
   				: initialStatus(payment.method),
   	}));
   	const returnedAmount = await getReceivedReturnAmount(tx, invoice.id);
   	const netReceivable = roundMoney(
   		Math.max(0, Number(invoice.totalPrice) - returnedAmount),
   	);
   	const existingTotals = calculateSettlement(netReceivable, existing, {
   		allowCreditBalance: true,
   	});
   	const remainingCapacity = roundMoney(
   		Math.max(
   			0,
   			netReceivable - existingTotals.paidAmount - existingTotals.pendingAmount,
   		),
   	);
   	const proposedTotal = roundMoney(
   		proposed.reduce((sum, item) => sum + item.amount, 0),
   	);
   	if (proposedTotal > remainingCapacity) {
   		throw new Error("Payments cannot exceed invoice total");
   	}
   	const combinedTotals = calculateSettlement(
   		netReceivable,
   		[...existing, ...proposed],
   		{ allowCreditBalance: true },
   	);
   	assertSettlementDueDate(
   		{
   			...combinedTotals,
   			outstandingAmount: Math.max(0, combinedTotals.outstandingAmount),
   			payLaterAmount: Math.max(0, combinedTotals.payLaterAmount),
   		},
   		invoice.paymentDueDate,
   	);
   }
   ```
8. Update `recalculateInvoiceSettlement` (`lines 418-499`) to maintain non-negative `outstandingAmount`, track `excessCreditedAmount` on `invoices` & `slipRecords`, and issue or reclaim `payment_overage` store credit lots automatically:
   ```ts
   export async function recalculateInvoiceSettlement(
   	tx: SalesTransaction,
   	invoiceId: string,
   	options?: {
   		totalPrice?: number;
   		paymentDueDate?: Date | null;
   		actorId?: string;
   		sourcePaymentId?: string | null;
   		reason?: string;
   		allowUnapplyOverageOnReturnVoid?: boolean;
   	},
   ): Promise<SettlementTotals> {
   	const invoice = await lockInvoice(tx, invoiceId);
   	const totalPrice = options?.totalPrice ?? Number(invoice.totalPrice);
   	const returnedAmount = await getReceivedReturnAmount(tx, invoice.id);
   	const netReceivable = roundMoney(Math.max(0, totalPrice - returnedAmount));
   	const paymentDueDate =
   		options && "paymentDueDate" in options
   			? options.paymentDueDate
   			: invoice.paymentDueDate;
   	const paymentTotals = calculateSettlement(
   		netReceivable,
   		await listSettlementPayments(tx, invoice.id),
   		{ allowCreditBalance: true },
   	);

   	const storedOutstanding = roundMoney(Math.max(0, paymentTotals.outstandingAmount));
   	const desiredExcess = roundMoney(Math.max(0, -paymentTotals.outstandingAmount));
   	const storedPayLater = roundMoney(
   		Math.max(0, storedOutstanding - paymentTotals.pendingAmount),
   	);
   	const totals: SettlementTotals = {
   		...paymentTotals,
   		totalPrice,
   		outstandingAmount: storedOutstanding,
   		payLaterAmount: storedPayLater,
   	};
   	assertSettlementDueDate(totals, paymentDueDate);

   	const previousExcess = roundMoney(invoice.excessCreditedAmount ?? 0);
   	const excessDelta = roundMoney(desiredExcess - previousExcess);

   	if (excessDelta > 0) {
   		await issuePaymentOverageCredit(tx, {
   			customerId: invoice.customerId,
   			sourceInvoiceId: invoice.id,
   			sourcePaymentId: options?.sourcePaymentId ?? null,
   			amount: excessDelta,
   			performedById: options?.actorId ?? invoice.performedById,
   		});
   	} else if (excessDelta < 0) {
   		await reclaimPaymentOverageCredit(tx, {
   			invoiceId: invoice.id,
   			customerId: invoice.customerId,
   			reclaimAmount: roundMoney(-excessDelta),
   			reason: options?.reason ?? "Invoice settlement changed",
   			performedById: options?.actorId ?? invoice.performedById,
   			allowUnapplyApplied: options?.allowUnapplyOverageOnReturnVoid ?? false,
   			recalculateInvoice: async (affectedInvoiceId) => {
   				await recalculateInvoiceSettlement(tx, affectedInvoiceId, {
   					actorId: options?.actorId,
   					reason: options?.reason,
   				});
   			},
   			recordTimeline: async (params) => {
   				await recordInvoiceTimelineEvent(params, tx);
   			},
   		});
   	}

   	const paidDelta = roundMoney(totals.paidAmount - Number(invoice.paidAmount));
   	const outstandingDelta = roundMoney(
   		totals.outstandingAmount - Number(invoice.outstandingAmount),
   	);

   	await tx
   		.update(invoices)
   		.set({
   			...(options?.totalPrice !== undefined
   				? { totalPrice: moneyString(totals.totalPrice) }
   				: {}),
   			...(options && "paymentDueDate" in options ? { paymentDueDate } : {}),
   			paidAmount: moneyString(totals.paidAmount),
   			returnedAmount: moneyString(returnedAmount),
   			excessCreditedAmount: moneyString(desiredExcess),
   			outstandingAmount: moneyString(totals.outstandingAmount),
   			paymentStatus: totals.paymentStatus,
   		})
   		.where(eq(invoices.id, invoice.id));

   	await tx
   		.update(slipRecords)
   		.set({
   			invoiceAmount: moneyString(totals.totalPrice),
   			paidAmount: moneyString(totals.paidAmount),
   			returnedAmount: moneyString(returnedAmount),
   			excessCreditedAmount: moneyString(desiredExcess),
   			outstandingAmount: moneyString(totals.outstandingAmount),
   			status:
   				totals.outstandingAmount <= 0
   					? "closed"
   					: totals.paidAmount > 0
   						? "partially_recovered"
   						: "open",
   			reconciledAt: totals.outstandingAmount <= 0 ? new Date() : null,
   			recoveryStatus: totals.outstandingAmount <= 0 ? null : undefined,
   			recoveryAssignedToId: totals.outstandingAmount <= 0 ? null : undefined,
   			nextFollowUpDate: totals.outstandingAmount <= 0 ? null : undefined,
   			lastFollowUpDate: totals.outstandingAmount <= 0 ? null : undefined,
   			escalationLevel: totals.outstandingAmount <= 0 ? 0 : undefined,
   		})
   		.where(eq(slipRecords.invoiceId, invoice.id));

   	if (paidDelta !== 0 || outstandingDelta !== 0) {
   		await tx
   			.update(customers)
   			.set({
   				totalPaidAmount: sql`${customers.totalPaidAmount} + ${paidDelta}`,
   				outstandingAmount: sql`${customers.outstandingAmount} + ${outstandingDelta}`,
   			})
   			.where(eq(customers.id, invoice.customerId));
   	}

   	return totals;
   }
   ```
9. Pass `{ actorId: input.actorId, sourcePaymentId: changed.id }` into `recalculateInvoiceSettlement` in `confirmPendingPayment` (`line 707`), and `{ actorId: input.actorId, reason }` in `resolvePendingPayment` (`line 762`), and `{ actorId: input.actorId }` in `createInitialPayments` / `addPaymentsToInvoice` / `recordRecoveryPayment`.
10. Update `reverseConfirmedPayment` (`lines 788-871`) so `customer_credit` payments restore store credit without looking up a wallet movement, and real-money reversals pull back unused `sales_return` store credit before recalculation:
   ```ts
   	const invoice = await lockInvoice(tx, current.invoiceId);
   	const now = new Date();
   	const [changed] = await tx
   		.update(payments)
   		.set({
   			status: "reversed",
   			resolvedById: input.actorId,
   			resolvedAt: now,
   			resolutionReason: reason,
   		})
   		.where(
   			and(eq(payments.id, input.paymentId), eq(payments.status, "confirmed")),
   		)
   		.returning();
   	if (!changed) throw new Error("Payment is no longer confirmed");

   	if (changed.method === "customer_credit") {
   		await restoreCustomerCreditForReversedPayment(tx, {
   			paymentId: changed.id,
   			invoiceId: changed.invoiceId,
   			customerId: changed.customerId,
   			performedById: input.actorId,
   			reason,
   		});
   	} else if (changed.method !== "expense_offset") {
   		const originalMovement = await tx.query.transactions.findFirst({
   			where: and(
   				eq(transactions.referenceId, changed.id),
   				eq(transactions.source, "Customer Payment"),
   				eq(transactions.type, "credit"),
   			),
   		});
   		if (!originalMovement) {
   			throw new Error("Original wallet payment movement was not found");
   		}

   		await tx
   			.update(wallets)
   			.set({ balance: sql`${wallets.balance} - ${changed.amount}` })
   			.where(eq(wallets.id, originalMovement.walletId));
   		await tx.insert(transactions).values({
   			id: createId(),
   			walletId: originalMovement.walletId,
   			type: "debit",
   			amount: changed.amount,
   			source: "Customer Payment Reversal",
   			referenceId: changed.id,
   			effectiveDate: input.effectiveDate,
   			reversalOfTransactionId: originalMovement.id,
   			performedById: input.actorId,
   		});

   		const previousExcess = roundMoney(invoice.excessCreditedAmount ?? 0);
   		const reopenPortion = roundMoney(
   			Math.max(0, roundMoney(changed.amount) - previousExcess),
   		);
   		await reclaimInvoiceReturnCreditForPaymentReversal(tx, {
   			invoiceId: changed.invoiceId,
   			customerId: changed.customerId,
   			reopenNeeded: reopenPortion,
   			performedById: input.actorId,
   		});
   	}

   	if (input.paymentDueDate) {
   		await tx
   			.update(invoices)
   			.set({ paymentDueDate: input.paymentDueDate })
   			.where(eq(invoices.id, changed.invoiceId));
   	}
   	await recalculateInvoiceSettlement(tx, changed.invoiceId, {
   		actorId: input.actorId,
   		reason,
   	});
   ```

- [ ] **Step 4: Update `sales-returns-fn.ts`, `invoice-posting-service.ts`, `invoices-fn.ts`, `zod_schemas.ts`, `reconciliation-fn.ts`, `payment-settlement-fn.ts`, and create `customer-credit-fn.ts`**

1. **`src/server-functions/sales/sales-returns-fn.ts`**:
   - Import `computeReturnCreditSplit` from `@/lib/sales/returns/return-lifecycle`, `moneyString` / `roundMoney` from `@/lib/sales/settlement/money`, and `{ allocateNextCreditNoteNumber, ensureCreditNotesBackfilled, issueCustomerCreditFromReturn, voidReturnCreditSettlement }` from `./customer-credit-service`. Keep `@/db` imported dynamically inside handlers (`const { db } = await import("@/db");`).
   - Call `await ensureCreditNotesBackfilled(db);` at the start of `listSalesReturnsFn`, `getSalesReturnDetailFn`, and `completeSalesReturnFn`.
   - In `getSalesReturnDetailFn` (`lines 141-170`):
     - Add `date: true` inside `invoice.columns`:
       ```ts
       invoice: {
         columns: {
           id: true,
           invoiceNumber: true,
           slipNumber: true,
           date: true,
           totalPrice: true,
           invoiceDiscount: true,
           status: true,
         },
         with: { items: true },
       },
       ```
     - Add `city: true`, `mobileNumber: true`, `creditBalance: true`, and `customerType: true` inside `customer.columns` (needed by `CreditNotePrintDialog` and return/void settlement UI):
       ```ts
       customer: {
         columns: {
           id: true,
           name: true,
           city: true,
           mobileNumber: true,
           outstandingAmount: true,
           creditBalance: true,
           customerType: true,
         },
       },
       ```
     - Include inside `with`:
     ```ts
     refunds: {
       with: {
         wallet: { columns: { id: true, name: true } },
         issuedBy: person,
         reversedBy: person,
       },
     },
     ```
   - In `getSalesReturnsByInvoiceFn` (`lines 107-125`) and `src/server-functions/sales/invoice-detail-fn.ts` (`lines 70-88`): also include `refunds: { with: { wallet: { columns: { id: true, name: true } } } }` on `salesReturns` so invoice pages and print actions can show any linked refunds directly without extra round trips.
   - In `listSalesReturnsFn`: include `creditNoteNumber: salesReturns.creditNoteNumber`, `appliedToInvoiceAmount: salesReturns.appliedToInvoiceAmount`, `customerCreditAmount: salesReturns.customerCreditAmount`, `customerId: salesReturns.customerId` in the selected projection.
   - In `completeSalesReturnFn` (`lines 670-712`, inside `db.transaction`):
     ```ts
     const creditNoteNumber = await allocateNextCreditNoteNumber(tx);
     const [lockedInvoice] = await tx
       .select({
         id: invoices.id,
         invoiceNumber: invoices.invoiceNumber,
         totalPrice: invoices.totalPrice,
         paidAmount: invoices.paidAmount,
         excessCreditedAmount: invoices.excessCreditedAmount,
       })
       .from(invoices)
       .where(eq(invoices.id, salesReturn.invoiceId));
     if (!lockedInvoice) throw new Error("Parent invoice not found");

     const priorCompleted = await tx
       .select({ applied: salesReturns.appliedToInvoiceAmount })
       .from(salesReturns)
       .where(and(eq(salesReturns.invoiceId, salesReturn.invoiceId), eq(salesReturns.status, "completed")));
     const priorApplied = roundMoney(
       priorCompleted.reduce((sum, r) => sum + roundMoney(r.applied), 0),
     );
     const preReturnOpenBalance = roundMoney(
       Math.max(
         0,
         roundMoney(lockedInvoice.totalPrice) -
           priorApplied -
           roundMoney(lockedInvoice.paidAmount) +
           roundMoney(lockedInvoice.excessCreditedAmount),
       ),
     );
     const split = computeReturnCreditSplit(Number(totalAmount), preReturnOpenBalance);
     const now = new Date();
     const [updated] = await tx
       .update(salesReturns)
       .set({
         status: "completed",
         completedAt: now,
         receivedById: userId,
         totalAmount,
         creditNoteNumber,
         creditNoteIssuedAt: now,
         appliedToInvoiceAmount: moneyString(split.appliedToInvoiceAmount),
         customerCreditAmount: moneyString(split.customerCreditAmount),
         notes: data.notes || salesReturn.notes,
         updatedAt: now,
       })
       .where(eq(salesReturns.id, salesReturn.id))
       .returning();

     let leftoverCreditBalance = 0;
     if (split.customerCreditAmount > 0) {
       const issued = await issueCustomerCreditFromReturn(tx, {
         customerId: salesReturn.customerId,
         salesReturnId: salesReturn.id,
         sourceInvoiceId: salesReturn.invoiceId,
         creditNoteNumber,
         amount: split.customerCreditAmount,
         performedById: userId,
         notes: `Credit Note ${creditNoteNumber} from Return #${salesReturn.returnNumber}`,
       });
       leftoverCreditBalance = issued.balanceAfter;
     }

     await recalculateInvoiceSettlement(tx, salesReturn.invoiceId, {
       actorId: userId,
       reason: `Completed return #${salesReturn.returnNumber} (${creditNoteNumber})`,
     });

     const customerInfo = await tx.query.customers.findFirst({
       where: eq(customers.id, salesReturn.customerId),
       columns: { id: true, name: true, customerType: true, creditBalance: true },
     });

     const received = inspection.reduce((sum: number, line: (typeof inspection)[number]) => sum + receivedUnits(line), 0);
     const requested = inspection.reduce((sum: number, line: (typeof inspection)[number]) => sum + line.approvedUnits, 0);
     await recordInvoiceTimelineEvent(
       {
         invoiceId: salesReturn.invoiceId,
         eventType: "status_change",
         title: `Credit Note ${creditNoteNumber} issued (Return #${salesReturn.returnNumber})`,
         description: `Return #${salesReturn.returnNumber} received: ${received} of ${requested} packs arrived${requested > received ? ` (${requested - received} short, closed)` : ""}. PKR ${moneyString(split.appliedToInvoiceAmount)} cleared invoice balance${split.customerCreditAmount > 0 ? `; PKR ${moneyString(split.customerCreditAmount)} transferred to store credit` : ""}.`,
         metadata: {
           salesReturnId: salesReturn.id,
           returnNumber: salesReturn.returnNumber,
           creditNoteNumber,
           action: "complete",
           totalAmount,
           appliedToInvoiceAmount: split.appliedToInvoiceAmount,
           customerCreditAmount: split.customerCreditAmount,
           receivedUnits: received,
           requestedUnits: requested,
         },
         actorId: userId,
       },
       tx,
     );
     return {
       ...updated,
       creditNoteNumber,
       appliedToInvoiceAmount: split.appliedToInvoiceAmount,
       customerCreditAmount: split.customerCreditAmount,
       customerId: salesReturn.customerId,
       customerName: customerInfo?.name ?? "",
       customerType: customerInfo?.customerType ?? "retailer",
       invoiceNumber: lockedInvoice.invoiceNumber,
       leftoverCreditBalance: customerInfo ? roundMoney(customerInfo.creditBalance) : leftoverCreditBalance,
     };
     ```
   - In `voidSalesReturnFn` (`lines 752-778`): call `voidReturnCreditSettlement` inside `db.transaction` BEFORE marking `salesReturns` `"voided"` (so `VOID_BLOCKED_BY_REFUND` rolls back cleanly before voiding):
     ```ts
     await voidReturnCreditSettlement(tx, {
       salesReturnId: salesReturn.id,
       invoiceId: salesReturn.invoiceId,
       customerId: salesReturn.customerId,
       creditNoteNumber: salesReturn.creditNoteNumber,
       reason: data.reason,
       performedById: userId,
       recalculateInvoice: async (affectedInvoiceId) => {
         await recalculateInvoiceSettlement(tx, affectedInvoiceId, {
           actorId: userId,
           reason: `Credit note ${salesReturn.creditNoteNumber ?? salesReturn.id} voided`,
         });
       },
       recordTimeline: async (params) => {
         await recordInvoiceTimelineEvent(params, tx);
       },
     });

     const now = new Date();
     const [updated] = await tx
       .update(salesReturns)
       .set({ status: "voided", voidedById: userId, voidedAt: now, voidReason: data.reason, updatedAt: now })
       .where(eq(salesReturns.id, salesReturn.id))
       .returning();

     await recalculateInvoiceSettlement(tx, salesReturn.invoiceId, {
       actorId: userId,
       reason: `Return #${salesReturn.returnNumber} voided: ${data.reason}`,
       allowUnapplyOverageOnReturnVoid: true,
     });
     ```

2. **`src/server-functions/sales/invoice-posting-service.ts`** (`line 953`):
   Update `settlementPreview` so `"customer_credit"` and `"expense_offset"` count as confirmed immediately:
   ```ts
   const settlementPreview = calculateSettlement(
   	totalPayable,
   	(normalizedPayments ?? []).map((payment) => ({
   		amount: payment.amount,
   		method: payment.method,
   		status:
   			payment.method === "cash" ||
   			payment.method === "expense_offset" ||
   			payment.method === "customer_credit" ||
   			payment.instantVerify
   				? "confirmed"
   				: "pending",
   	})),
   );
   ```

3. **`src/server-functions/sales/invoices-fn.ts`** (`line 1469`):
   Update the intermediate `updateInvoiceFn` write:
   ```ts
   outstandingAmount: Math.max(
     0,
     totalPayable -
       Number(existing.paidAmount) -
       Number(existing.returnedAmount) +
       Number(existing.excessCreditedAmount ?? 0),
   ).toFixed(2),
   ```
   (`recalculateInvoiceSettlement` immediately recomputes exact totals right after.)

4. **`src/db/zod_schemas.ts`** (`lines 13-37`):
   Add `"customer_credit"` to `invoicePaymentInputSchema`'s `method` enum and exempt `"customer_credit"` from `walletId` check:
   ```ts
   method: z.enum(["cash", "bank_transfer", "cheque", "expense_offset", "customer_credit"]),
   ...
   if (
     row.method !== "expense_offset" &&
     row.method !== "customer_credit" &&
     (!row.walletId || row.walletId.trim().length === 0)
   ) { ... }
   ```

5. **`src/server-functions/sales/reconciliation-fn.ts`**:
   - In `lookupSlipFn` (`lines 40, 92`): select `creditBalance: true` inside `customer: { columns: { ..., creditBalance: true } }`, and include `customerCreditBalance: Number(slip.customer?.creditBalance ?? 0)` in the returned object.
   - In `reconcileSlipFn` (`lines 162, 176, 233`):
     - Expand `method` enum: `z.enum(["cash", "bank_transfer", "cheque", "expense_offset", "customer_credit"]).default("cash")`
     - Exempt `"customer_credit"` in `.superRefine`: `if (row.method !== "expense_offset" && row.method !== "customer_credit" && !row.walletId)`
     - Pass `walletId: data.method === "customer_credit" ? undefined : data.walletId!` inside `recordRecoveryPayment(tx, { ... })`. (Keep `recordRecoveryPayment(tx, {` occurrences at **exactly 2** for `payment-settlement-fn.test.ts`!)
   - In `getOpenSlipsForRecoveryFn` (`lines 431, 470`): select `creditBalance: true` on `customer` and include `customerCreditBalance: Number(slip.customer?.creditBalance ?? 0)` per slip row.
   - In `batchReconcileSlipsFn` (`lines 503-595`):
     - Change `method` enum to `z.enum(["cash", "bank_transfer", "cheque", "customer_credit"]).default("cash")`
     - Make `walletId: z.string().optional()`
     - In `.superRefine`: require `walletId` whenever `row.method !== "customer_credit"`.
     - Inside `recordRecoveryPayment(tx, { ... })`: pass `walletId: data.method === "customer_credit" ? undefined : data.walletId`.

6. **`src/server-functions/sales/payment-settlement-fn.ts`** (`line 74`):
   Add `ne(payments.method, "customer_credit")` alongside `"cash"` and `"expense_offset"` in `getPendingPaymentVerificationFn`.

7. **Create `src/server-functions/sales/customer-credit-fn.ts`** (no top-level `@/db` import!):

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireFinancePaymentReversalOrManageMiddleware,
  requireFinanceRefundsIssueMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import {
  getCustomerCreditSummary,
  issueCustomerRefund,
  reverseCustomerRefund,
} from "./customer-credit-service";

export const getCustomerCreditSummaryFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: unknown) =>
    z.object({ customerId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    return getCustomerCreditSummary(db, data.customerId);
  });

export const issueCustomerRefundFn = createServerFn()
  .middleware([requireFinanceRefundsIssueMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        customerId: z.string().min(1),
        amount: z.number().positive("Refund amount must be positive"),
        walletId: z.string().min(1, "Pick an account"),
        refundDate: z.coerce.date().default(() => new Date()),
        notes: z.string().trim().max(500).optional(),
        salesReturnId: z.string().min(1).optional(),
        allowOverdraw: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;
    const permissions = Array.from(context.authContext.permissions);

    return db.transaction(async (tx) =>
      issueCustomerRefund(tx, {
        customerId: data.customerId,
        amount: data.amount,
        walletId: data.walletId,
        refundDate: data.refundDate,
        notes: data.notes,
        salesReturnId: data.salesReturnId,
        allowOverdraw: data.allowOverdraw,
        performedById: userId,
        permissions,
      }),
    );
  });

export const reverseCustomerRefundFn = createServerFn()
  .middleware([requireFinancePaymentReversalOrManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        refundId: z.string().min(1),
        reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const userId = context.session.user.id;

    return db.transaction(async (tx) =>
      reverseCustomerRefund(tx, {
        refundId: data.refundId,
        reason: data.reason,
        performedById: userId,
      }),
    );
  });
```

- [ ] **Step 5: Run tests & typecheck**

Run: `bun run test src/server-functions/sales/customer-credit-fn.test.ts src/server-functions/sales/settlement-service.test.ts src/server-functions/sales/payment-settlement-fn.test.ts src/lib/sales-workflows.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/sales/settlement-service.ts src/server-functions/sales/sales-returns-fn.ts src/server-functions/sales/invoice-detail-fn.ts src/server-functions/sales/invoice-posting-service.ts src/server-functions/sales/invoices-fn.ts src/db/zod_schemas.ts src/server-functions/sales/reconciliation-fn.ts src/server-functions/sales/payment-settlement-fn.ts src/server-functions/sales/customer-credit-fn.ts src/server-functions/sales/customer-credit-fn.test.ts src/lib/sales-workflows.test.ts
git commit -m "feat(sales): integrate credit notes, store credit payments, and customer refunds into settlement"
```

---

## Task 5: Chronological Ledgers, Customer Stats/Profiles, Daily Closing & P&L Reconciliation

**Files:**
- Modify: `src/lib/ledger-types.ts`
- Modify: `src/server-functions/sales/ledger-fn.ts`
- Modify: `src/server-functions/sales/customers-fn.ts`
- Modify: `src/server-functions/sales/reconciliation-fn.ts` (`getDailyClosingSummaryFn`)
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts`
- Modify: `src/components/finance/ledger-container.tsx`
- Test (modify): `src/lib/ledger-events.test.ts`, `src/lib/sales-workflows.test.ts`, `src/lib/pnl-reporting.test.ts`
- Test (create): `src/lib/daily-closing-credit.test.ts`

**Interfaces:**
- Consumes: `customerRefunds`, `salesReturns`, `payments`, `transactions`, `customers`
- Produces:
  - `LedgerRefundEntry`, updated `LedgerTypeFilter` (`"all" | "invoice" | "payment" | "return" | "refund"`)
  - Exact ledger running balance equation (`customer_credit` payments contribute `0` to `runningBalance` so returns aren't double-subtracted; `refund` adds `+amount`; `refund_reversal` subtracts `-amount`)
  - `getCustomerStatsFn` exposing `totalCustomerCredit`, `customersWithCredit`; `generateDistributorLedgerFn`, `generateShopkeeperLedgerFn`, and `getSalesmanShopLedgerFn` returning `customer.creditBalance`
  - `getDailyClosingSummaryFn` exposing `totalCreditApplied` and `totalCustomerRefunds` separately from cash/bank/cheque `totalCollected`
  - `company-reporting-core.ts` excluding `"Customer Refund"` and `"Customer Refund Reversal"` from operating expenses while tracking them cleanly inside `buildFinanceReconciliation`

- [ ] **Step 1: Write failing tests for ledger math, P&L refund handling, and daily closing**

1. Add tests to `src/lib/ledger-events.test.ts`:
   ```ts
   import { computeChronologicalLedgerStep } from "@/lib/ledger-types";

   describe("Phase 4 store credit ledger balance deltas", () => {
     it("does not double-subtract when customer_credit settles a second invoice, and recovers balance on cash refund", () => {
       let bal = 0;
       bal = computeChronologicalLedgerStep(bal, { type: "invoice", totalPrice: 10000 });
       expect(bal).toBe(10000);
       bal = computeChronologicalLedgerStep(bal, { type: "payment", method: "cash", amount: 10000 });
       expect(bal).toBe(0);
       bal = computeChronologicalLedgerStep(bal, { type: "return", eventKind: "return", amount: 4000 });
       expect(bal).toBe(-4000);
       // Applying store credit toward invoice #2 (Rs 6,000) keeps balance = -4000 + 6000 = +2000 (not -2000)
       bal = computeChronologicalLedgerStep(bal, { type: "invoice", totalPrice: 6000 });
       expect(bal).toBe(2000);
       bal = computeChronologicalLedgerStep(bal, { type: "payment", method: "customer_credit", amount: 4000 });
       expect(bal).toBe(2000);
     });

     it("moves negative balance toward zero on cash refund and back down on refund reversal", () => {
       let bal = -4000;
       bal = computeChronologicalLedgerStep(bal, { type: "refund", eventKind: "refund", amount: 4000 });
       expect(bal).toBe(0);
       bal = computeChronologicalLedgerStep(bal, { type: "refund", eventKind: "refund_reversal", amount: 4000 });
       expect(bal).toBe(-4000);
     });
   });
   ```
2. Update `src/lib/sales-workflows.test.ts:255` from `'kind: "invoice" | "return" | "payment"'` to `'kind: "invoice" | "return" | "payment" | "refund"'`.
3. Create `src/lib/daily-closing-credit.test.ts`:
   ```ts
   import { readFileSync } from "node:fs";
   import { resolve } from "node:path";
   import { describe, expect, it } from "vitest";
   import { summarizeDailyClosingBuckets } from "@/lib/sales/settlement/contracts";

   describe("daily closing store credit and refund isolation", () => {
     it("excludes customer_credit payments from cash/bank/cheque totalCollected while tracking credit applied & refunds", () => {
       const summary = summarizeDailyClosingBuckets(
         [
           { method: "cash", amount: "1000.00" },
           { method: "bank_transfer", amount: "2000.00" },
           { method: "cheque", amount: "500.00" },
           { method: "expense_offset", amount: "300.00" },
           { method: "customer_credit", amount: "1500.00" },
         ],
         [{ amount: "750.00", status: "active" }],
       );
       expect(summary).toEqual({
         totalCash: 1000,
         totalBankTransfer: 2000,
         totalCheque: 500,
         totalExpenseOffset: 300,
         totalCollected: 3800,
         totalCreditApplied: 1500,
         totalCustomerRefunds: 750,
       });
     });

     it("keeps Customer Refund out of FINANCE_EXPENSE_SOURCES and reconciles in P&L bridge", () => {
       const reporting = readFileSync(
         resolve(process.cwd(), "src/server-functions/reports/profit-loss/company-reporting-core.ts"),
         "utf8",
       );
       expect(reporting).toContain("FINANCE_CUSTOMER_REFUND_SOURCES");
       expect(reporting).toContain('"Customer Refund"');
       expect(reporting).toContain('"Customer Refund Reversal"');
       expect(reporting).toContain("customer_refunds");
     });
   });
   ```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/lib/ledger-events.test.ts src/lib/daily-closing-credit.test.ts`
Expected: FAIL (`computeChronologicalLedgerStep` and `summarizeDailyClosingBuckets` missing).

- [ ] **Step 3: Implement ledger types, `ledger-fn.ts`, daily closing, P&L bridge, and Finance UI source options**

1. **`src/lib/sales/settlement/contracts.ts`**: append `summarizeDailyClosingBuckets`:
   ```ts
   export function summarizeDailyClosingBuckets(
   	todayPayments: Array<{ method: string; amount: string | number }>,
   	todayRefunds: Array<{ amount: string | number; status?: string }> = [],
   ) {
   	const sumMethod = (method: string) =>
   		Math.round(
   			todayPayments
   				.filter((p) => p.method === method)
   				.reduce((sum, p) => sum + Number(p.amount), 0) * 100,
   		) / 100;
   	const totalCash = sumMethod("cash");
   	const totalBankTransfer = sumMethod("bank_transfer");
   	const totalCheque = sumMethod("cheque");
   	const totalExpenseOffset = sumMethod("expense_offset");
   	const totalCreditApplied = sumMethod("customer_credit");
   	const totalCollected =
   		Math.round((totalCash + totalBankTransfer + totalCheque + totalExpenseOffset) * 100) / 100;
   	const totalCustomerRefunds =
   		Math.round(
   			todayRefunds
   				.filter((r) => !r.status || r.status === "active")
   				.reduce((sum, r) => sum + Number(r.amount), 0) * 100,
   		) / 100;
   	return {
   		totalCash,
   		totalBankTransfer,
   		totalCheque,
   		totalExpenseOffset,
   		totalCollected,
   		totalCreditApplied,
   		totalCustomerRefunds,
   	};
   }
   ```

2. **`src/lib/ledger-types.ts`**:
   - Add `creditNoteNumber?: string | null;` to `LedgerReturnEntry`.
   - Add `isStoreCreditApplied?: boolean;` to `LedgerPaymentEntry`.
   - Add `LedgerRefundEntry`:
     ```ts
     export interface LedgerRefundEntry {
       type: "refund";
       eventKind: "refund" | "refund_reversal";
       id: string;
       date: Date;
       amount: number;
       creditNoteNumber?: string | null;
       walletName?: string | null;
       notes?: string | null;
       reverseReason?: string | null;
       runningBalance: number;
       customerName?: string | null;
     }
     ```
   - Expand `LedgerEntry = LedgerInvoiceEntry | LedgerPaymentEntry | LedgerReturnEntry | LedgerRefundEntry`.
   - Expand `LedgerTypeFilter = "all" | "invoice" | "payment" | "return" | "refund"`.
   - Add `creditBalance?: string | number | null;` on `LedgerCustomerInfo` (matching `outstandingAmount`).
   - Export pure `computeChronologicalLedgerStep`:
     ```ts
     export function computeChronologicalLedgerStep(
       currentBalance: number,
       event:
         | { type: "invoice"; totalPrice: number }
         | { type: "payment"; method: string; amount: number }
         | { type: "return"; eventKind: "return" | "void"; amount: number }
         | { type: "refund"; eventKind: "refund" | "refund_reversal"; amount: number },
     ): number {
       const round = (v: number) => Math.round(v * 100) / 100;
       if (event.type === "invoice") return round(currentBalance + event.totalPrice);
       if (event.type === "return") {
         return event.eventKind === "return"
           ? round(currentBalance - event.amount)
           : round(currentBalance + event.amount);
       }
       if (event.type === "refund") {
         return event.eventKind === "refund"
           ? round(currentBalance + event.amount)
           : round(currentBalance - event.amount);
       }
       if (event.method === "customer_credit") return round(currentBalance);
       return round(currentBalance - event.amount);
     }
     ```

3. **`src/server-functions/sales/ledger-fn.ts`**:
   - Update `ledgerQuerySchema` `typeFilter` enum (`["all", "invoice", "payment", "return", "refund"]`).
   - Update `filterAndSortEntries` to handle `type === "refund"` search (credit note #, wallet name, notes, reverseReason, customerName).
   - Import `customerRefunds` from `@/db/schemas/sales-erp-schema`.
   - In `buildLedger`:
     - Load `customerRefunds` through `throughDate` (`lte(customerRefunds.refundDate, throughDate)`), ordered chronologically (`refundDate`, `createdAt`, `id`), with `wallet: { columns: { name: true } }`.
     - Expand each refund row into 1 or 2 money events (`{ kind: "refund", date: row.refundDate, amount: safeNumber(row.amount), row }` and if `row.status === "reversed" && row.reversedAt`, `{ kind: "refund_reversal", date: row.reversedAt, amount: safeNumber(row.amount), row }`).
     - In `openingBalance` (`lines 237-264`):
       - Add `ne(payments.method, "customer_credit")` inside `prePayments` `where` clause so store credit settlements never get double-subtracted before `fromDate`.
       - Add `+ refundEvents.filter(e => e.date < fromDate).reduce((s, e) => s + (e.kind === "refund" ? e.amount : -e.amount), 0)` to `openingBalance`.
     - In timeline assembly (`lines 319-354`):
       - Set `kind: "invoice" | "return" | "payment" | "refund"`.
       - Set `kindRank = { invoice: 0, return: 1, payment: 2, refund: 3 } as const`.
     - Inside timeline loop:
       - `return` (`line 394`): pass `creditNoteNumber: salesReturn.creditNoteNumber`.
       - `payment` (`line 413`):
         ```ts
         const payment = paymentRows[event.index];
         const amount = safeNumber(payment.amount);
         if (payment.method !== "customer_credit") {
           runningBalance = roundMoney(runningBalance - amount);
         }
         entries.push({
           type: "payment",
           id: payment.id,
           date: payment.effectiveDate ?? payment.paymentDate,
           reference: payment.reference ?? payment.chequeNumber,
           method: payment.method,
           isStoreCreditApplied: payment.method === "customer_credit",
           amount,
           notes: payment.notes,
           runningBalance,
           invoiceId: payment.invoiceId,
           invoiceNumber: payment.invoice.invoiceNumber,
           customerName: customerNames.get(payment.customerId) ?? null,
           walletName: payment.wallet?.name ?? null,
           walletType: payment.wallet?.type ?? null,
           chequeNumber: payment.chequeNumber ?? null,
           chequeBank: payment.chequeBank ?? null,
           chequeDate: payment.chequeDate ?? null,
         });
         ```
       - `refund`:
         ```ts
         const refEvent = periodRefundEvents[event.index];
         runningBalance = roundMoney(
           refEvent.kind === "refund"
             ? runningBalance + refEvent.amount
             : runningBalance - refEvent.amount,
         );
         entries.push({
           type: "refund",
           eventKind: refEvent.kind,
           id: `${refEvent.row.id}:${refEvent.kind}`,
           date: refEvent.date,
           amount: refEvent.amount,
           creditNoteNumber: refEvent.row.creditNoteNumber,
           walletName: refEvent.row.wallet?.name ?? null,
           notes: refEvent.row.notes,
           reverseReason: refEvent.row.reverseReason,
           runningBalance,
           customerName: customerNames.get(refEvent.row.customerId) ?? null,
         });
         ```
     - In `periodPayments` (`line 439`): exclude `customer_credit` (`paymentRows.filter((row) => row.method !== "customer_credit")`) so cash/bank collections remain accurate; exclude `"customer_credit"` from `paymentCount` or keep consistent.
   - Update `getCustomer` (`line 489`) to include `creditBalance: true` in `columns`, AND update `generateCustomerLedger` (`lines 534-541`) to include `creditBalance: customer.creditBalance` in the returned `customer` object (`generateDistributorLedgerFn`, `generateShopkeeperLedgerFn`, and `getSalesmanShopLedgerFn` all rely on `getCustomer` / `generateCustomerLedger`).

4. **`src/server-functions/sales/customers-fn.ts`**:
   - In `getCustomerStatsFn` (`lines 173-216`): add two aggregate selects over `customers` (`totalCustomerCredit: drizzleSum(customers.creditBalance)`, `customersWithCredit: count()` where `gt(customers.creditBalance, "0")`) and return them in addition to existing fields.

5. **`src/server-functions/sales/reconciliation-fn.ts`** (`getDailyClosingSummaryFn` lines 611-683):
   - Query `customerRefunds` where `and(gte(customerRefunds.refundDate, dayStart), lte(customerRefunds.refundDate, dayEnd), eq(customerRefunds.status, "active"))` with `customer: { columns: { name: true } }`, `wallet: { columns: { name: true } }`.
   - Call `summarizeDailyClosingBuckets(todayPayments, todayRefunds)`.
   - Return `refunds: todayRefunds`, `totalCustomerRefunds`, `totalCreditApplied`, along with all existing fields (`totalCollected`, `totalCash`, `totalBankTransfer`, `totalCheque`, `totalExpenseOffset`, etc.).

6. **`src/server-functions/reports/profit-loss/company-reporting-core.ts`**:
   - Right below `FINANCE_EXPENSE_SOURCES` (`line 53`), define:
     ```ts
     const FINANCE_CUSTOMER_REFUND_SOURCES = [
       "Customer Refund",
       "Customer Refund Reversal",
     ] as const;
     ```
   - Notice P&L expenses query reads the `expenses` table and `FINANCE_EXPENSE_SOURCES` does NOT include `"Customer Refund"` — explicitly track `customerRefundOutflows` inside `buildFinanceReconciliation`:
     ```ts
     const customerRefundOutflows = roundCurrency(
       -sumBySource((source) =>
         FINANCE_CUSTOMER_REFUND_SOURCES.includes(
           source as (typeof FINANCE_CUSTOMER_REFUND_SOURCES)[number],
         ),
       ),
     );
     ```
     Exclude `FINANCE_CUSTOMER_REFUND_SOURCES` from `otherMovements` (`lines 1476-1492`), add bridge row (`type: "customer_refunds"`, `label: "Less Customer Store-Credit Refunds"`, `amount: customerRefundOutflows`, `direction: "negative"`, `description: "Cash/bank payouts returning overpaid or returned customer store credit (balance-sheet settlement, not an operating expense)."`), and return `customerRefundOutflows` (check `FinanceReconciliation` type at top of `company-reporting-core.ts` / `reporting-types.ts` and add optional `customerRefundOutflows?: number` and `"customer_refunds"` to bridge row type union).

7. **`src/components/finance/ledger-container.tsx`** (`lines 285-291`):
   - Add `<SelectItem value="Customer Refund" className="rounded-none">Customer Refund</SelectItem>` and `<SelectItem value="Customer Refund Reversal" className="rounded-none">Customer Refund Reversal</SelectItem>` inside the Source `<SelectContent>`.

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/lib/ledger-events.test.ts src/lib/daily-closing-credit.test.ts src/lib/sales-workflows.test.ts src/lib/pnl-reporting.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger-types.ts src/lib/sales/settlement/contracts.ts src/server-functions/sales/ledger-fn.ts src/server-functions/sales/customers-fn.ts src/server-functions/sales/reconciliation-fn.ts src/server-functions/reports/profit-loss/company-reporting-core.ts src/components/finance/ledger-container.tsx src/lib/ledger-events.test.ts src/lib/daily-closing-credit.test.ts src/lib/sales-workflows.test.ts
git commit -m "feat(accounting): update chronological ledgers, daily closing, and P&L bridge for store credit & refunds"
```

---

## Task 6: Client Hooks & Cache Invalidation

**Files:**
- Create: `src/hooks/sales/use-customer-credit.ts`
- Modify: `src/hooks/finance/use-finance.ts` (`useWallets`)
- Modify: `src/hooks/sales/use-sales-returns.ts`
- Modify: `src/hooks/sales/use-invoices.ts`
- Modify: `src/hooks/sales/use-payment-settlement.ts`
- Test (modify): `src/__tests__/sales-return-cache.behavior.test.tsx`

**Interfaces:**
- Consumes: `getCustomerCreditSummaryFn`, `issueCustomerRefundFn`, `reverseCustomerRefundFn`, `isOverdrawConfirmError`
- Produces: `customerCreditKeys`, `useCustomerCreditSummary`, `useIssueCustomerRefund`, `useReverseCustomerRefund`; updated `useWallets(options?: { enabled?: boolean })`; synchronized query invalidations across return/payment/invoice/refund hooks

- [ ] **Step 1: Update `src/__tests__/sales-return-cache.behavior.test.tsx`**

1. Add `"customer-credit"` to `physical` in `src/__tests__/sales-return-cache.behavior.test.tsx:27-29`.
2. Append a separate `describe("customer credit and refund cache invalidation", ...)` test verifying that `useIssueCustomerRefund` and `useReverseCustomerRefund` invalidate `["customer-credit", customerId]`, `["wallets"]`, `["transactions"]`, `["customers"]`, `["invoices"]`, `["invoice-detail"]`, `["sales-returns"]`, ledger queries, and `["reports"]`, while `useIssueCustomerRefund` suppresses error toast when `isOverdrawConfirmError(err)` is true (matching `useCreateExpense`).

- [ ] **Step 2: Run cache test to verify failure**

Run: `bun run test src/__tests__/sales-return-cache.behavior.test.tsx`
Expected: FAIL (`customer-credit` prefix missing; `use-customer-credit.ts` missing).

- [ ] **Step 3: Implement `use-customer-credit.ts` and update hooks**

1. **Create `src/hooks/sales/use-customer-credit.ts`**:
   ```ts
   import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
   import { toast } from "sonner";
   import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
   import {
     getCustomerCreditSummaryFn,
     issueCustomerRefundFn,
     reverseCustomerRefundFn,
   } from "@/server-functions/sales/customer-credit-fn";

   export const customerCreditKeys = {
     all: ["customer-credit"] as const,
     detail: (customerId: string) => [...customerCreditKeys.all, customerId] as const,
   };

   export function useCustomerCreditSummary(customerId: string | null | undefined, enabled = true) {
     return useQuery({
       queryKey: customerCreditKeys.detail(customerId ?? ""),
       queryFn: () => getCustomerCreditSummaryFn({ data: { customerId: customerId ?? "" } }),
       enabled: Boolean(customerId) && enabled,
     });
   }

   function invalidateCreditAndMoney(qc: ReturnType<typeof useQueryClient>, customerId?: string) {
     const keys: readonly unknown[][] = [
       ["customer-credit"],
       ...(customerId ? [[...customerCreditKeys.detail(customerId)]] : []),
       ["customers"],
       ["distributor-profile"],
       ["shopkeeper-profile"],
       ["distributor-ledger"],
       ["shopkeeper-ledger"],
       ["salesman-ledger"],
       ["salesman-shop-ledger"],
       ["sales-returns"],
       ["invoices"],
       ["invoice-detail"],
       ["wallets"],
       ["transactions"],
       ["transactions-recent"],
       ["daily-closing"],
       ["reports"],
     ];
     return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
   }

   export function useIssueCustomerRefund(customerId?: string) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: (data: {
         customerId: string;
         amount: number;
         walletId: string;
         refundDate?: Date;
         notes?: string;
         salesReturnId?: string;
         allowOverdraw?: boolean;
       }) => issueCustomerRefundFn({ data }),
       onSuccess: async (result, variables) => {
         toast.success(`Refund recorded from ${result.walletName}`);
         await invalidateCreditAndMoney(qc, customerId ?? variables.customerId);
       },
       onError: (err: Error) => {
         if (isOverdrawConfirmError(err)) {
           void qc.invalidateQueries({ queryKey: ["wallets"] });
           return;
         }
         toast.error("Failed to record refund", { description: err.message });
       },
     });
   }

   export function useReverseCustomerRefund(customerId?: string) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: (data: { refundId: string; reason: string }) =>
         reverseCustomerRefundFn({ data }),
       onSuccess: async () => {
         toast.success("Refund reversed and store credit restored");
         await invalidateCreditAndMoney(qc, customerId);
       },
       onError: (err: Error) => {
         toast.error("Failed to reverse refund", { description: err.message });
       },
     });
   }
   ```
2. **Edit `src/hooks/finance/use-finance.ts`** (`line 169`):
   ```ts
   export const useWallets = (options?: { enabled?: boolean }) =>
     useQuery({
       queryKey: ["wallets"],
       queryFn: () => getWalletsListFn(),
       enabled: options?.enabled ?? true,
     });
   ```
3. **Edit `src/hooks/sales/use-sales-returns.ts`** (`lines 97-102`):
   Add `"customer-credit"` to `prefixes` inside `refreshReceipt`.
4. **Edit `src/hooks/sales/use-invoices.ts`** (`onSuccess` of `useCreateInvoice` & `useUpdateInvoice`):
   Add `queryClient.invalidateQueries({ queryKey: ["customer-credit"] });`, `queryClient.invalidateQueries({ queryKey: ["distributor-profile"] });`, and `queryClient.invalidateQueries({ queryKey: ["shopkeeper-profile"] });`.
5. **Edit `src/hooks/sales/use-payment-settlement.ts`** (`lines 49-57` `relatedQueryKeys`):
   Add `["customer-credit"]`, `["distributor-profile"]`, `["shopkeeper-profile"]`, `["distributor-ledger"]`, `["shopkeeper-ledger"]`, `["salesman-ledger"]`, `["salesman-shop-ledger"]`.

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/__tests__/sales-return-cache.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/sales/use-customer-credit.ts src/hooks/finance/use-finance.ts src/hooks/sales/use-sales-returns.ts src/hooks/sales/use-invoices.ts src/hooks/sales/use-payment-settlement.ts src/__tests__/sales-return-cache.behavior.test.tsx
git commit -m "feat(hooks): add customer credit hooks and wire Phase 4 cache invalidations"
```


---

## Task 7: OverdrawConfirmDialog, Printable Credit Note Dialog, Screen 4 Completion Modal, Void-Blocked Link & Returns UI

**Files:**
- Modify: `src/components/finance/overdraw-confirm-dialog.tsx`
- Create: `src/components/sales/credit-note-print-dialog.tsx`
- Modify: `src/components/sales/return-lifecycle-actions.tsx`
- Modify: `src/components/sales/returns/return-actions.tsx`
- Modify: `src/routes/_protected/sales/returns/$returnId.tsx`
- Modify: `src/routes/_protected/sales/returns/index.tsx`
- Test (modify): `src/__tests__/sales-return-ui.behavior.test.tsx`, `src/__tests__/sales-returns-pages.behavior.test.tsx`
- Test (create): `src/__tests__/credit-note-screen4.behavior.test.tsx`

**Interfaces:**
- Consumes: `useSalesReturnDetail`, `useCompleteSalesReturn`, `useVoidSalesReturn`, `useIssueCustomerRefund`, `useWallets`, `OverdrawConfirmDialog`, `isOverdrawConfirmError`, `parseVoidBlockedByRefundError`, `formatAmountInput`, `parseAmountInput`, `formatRupees`, `getBalanceAfter`
- Produces:
  - `OverdrawConfirmDialog` optional `descriptionLabel?: string` prop (default `"expense"`)
  - `<CreditNotePrintDialog open onOpenChange returnId />` for formal A4 Credit Note preview & print
  - Screen 4 Credit Note Settlement modal inside `ReturnLifecycleActions` (triggers ONLY when `complete` returns `creditNoteNumber`, supports Keep as Store Credit vs Refund Cash/Bank Now + overdraw confirmation + Print CN)
  - Void-blocked alert with direct `<Link>` to customer profile when active refunds block voiding
  - Credit Note number badges & split summary on Returns detail/queue

- [ ] **Step 1: Add test mocks & write failing Screen 4 and Credit Note print behavior tests**

1. Update BOTH `src/__tests__/sales-return-ui.behavior.test.tsx` (top near lines 7-18) AND `src/__tests__/sales-returns-pages.behavior.test.tsx` (top near lines 25-40) so JSdom tests do NOT pull `@/db` via top-level `finance-fn.ts`:
   ```ts
   vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
     getCustomerCreditSummaryFn: vi.fn(),
     issueCustomerRefundFn: vi.fn(),
     reverseCustomerRefundFn: vi.fn(),
   }));

   vi.mock("@/server-functions/finance-fn", () => ({
     getWalletsListFn: vi.fn().mockResolvedValue([]),
   }));
   ```
2. Append a test in `src/__tests__/sales-returns-pages.behavior.test.tsx` inside `"SalesReturnDetailPage detail sheet"` testing that when `makeDetail` includes `creditNoteNumber: "CN-2026-0001"`, `appliedToInvoiceAmount: "800.00"`, `customerCreditAmount: "400.00"`, `status: "completed"`, `completedAt: new Date("2026-11-02T12:00:00.000Z")`, the page shows the `CN-2026-0001` badge, split summary (`Rs 800`, `Rs 400`), and `"Print credit note"` button.
3. Create `src/__tests__/credit-note-screen4.behavior.test.tsx`:
   ```tsx
   import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
   import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { CreditNotePrintDialog } from "@/components/sales/credit-note-print-dialog";
   import { ReturnLifecycleActions } from "@/components/sales/return-lifecycle-actions";
   import { formatVoidBlockedByRefundError } from "@/lib/sales/returns/return-lifecycle";

   const mocks = vi.hoisted(() => ({
     complete: vi.fn(),
     voidRet: vi.fn(),
     issueRefund: vi.fn(),
     wallets: vi.fn(),
     detail: vi.fn(),
     permissions: ["*"] as string[],
   }));

   vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
     createSalesReturnFn: vi.fn(),
     decideSalesReturnFn: vi.fn(),
     completeSalesReturnFn: mocks.complete,
     cancelSalesReturnFn: vi.fn(),
     voidSalesReturnFn: mocks.voidRet,
     listSalesReturnsFn: vi.fn(),
     getSalesReturnDetailFn: mocks.detail,
   }));

   vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
     getCustomerCreditSummaryFn: vi.fn(),
     issueCustomerRefundFn: mocks.issueRefund,
     reverseCustomerRefundFn: vi.fn(),
   }));

   vi.mock("@/server-functions/finance-fn", () => ({
     getWalletsListFn: mocks.wallets,
   }));

   vi.mock("@/hooks/use-viewer-access", () => ({
     useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
   }));

   vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

   vi.mock("@tanstack/react-router", () => ({
     Link: ({ children, to, params }: { children: React.ReactNode; to?: string; params?: Record<string, string> }) => (
       <a href={to ?? "#"} data-to={to} data-params={params ? JSON.stringify(params) : undefined}>
         {children}
       </a>
     ),
   }));

   let client: QueryClient;

   beforeEach(() => {
     vi.resetAllMocks();
     mocks.permissions = ["*"];
     mocks.wallets.mockResolvedValue([
       { id: "w-cash", name: "Main Cash", type: "cash", balance: "100.00" },
     ]);
     mocks.complete.mockResolvedValue({
       success: true,
       creditNoteNumber: "CN-2026-0001",
       totalAmount: 1000,
       appliedToInvoiceAmount: 400,
       customerCreditAmount: 600,
       customerId: "cust-1",
       customerName: "Khan Distributors",
       customerType: "distributor",
       invoiceNumber: "INV-100",
       leftoverCreditBalance: 600,
     });
     mocks.issueRefund.mockResolvedValue({
       id: "ref-1",
       walletName: "Main Cash",
     });
     client = new QueryClient({
       defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
     });
     HTMLElement.prototype.scrollIntoView = vi.fn();
     HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
     HTMLElement.prototype.setPointerCapture = vi.fn();
     HTMLElement.prototype.releasePointerCapture = vi.fn();
   });

   afterEach(() => {
     cleanup();
     client.clear();
   });

   function mount(ui: React.ReactNode) {
     return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
   }

   describe("Screen 4 credit note settlement & void-blocked UX", () => {
     it("opens Screen 4 on completion with split, lazily loads wallets on refund selection, and retries after overdraw confirmation", async () => {
       mount(
         <ReturnLifecycleActions
           invoiceId="inv-1"
           returnId="ret-1"
           status="approved"
           items={[{ id: "li-1", label: "Bottle", approvedUnits: 5 }]}
         />,
       );
       expect(mocks.wallets).not.toHaveBeenCalled();

       fireEvent.click(screen.getByRole("button", { name: "Receive" }));
       fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "5" } });
       fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));

       await screen.findByText(/CN-2026-0001/);
       expect(screen.getByText(/Khan Distributors/)).toBeTruthy();
       expect(mocks.wallets).not.toHaveBeenCalled();

       fireEvent.click(screen.getByRole("button", { name: /Refund Cash \/ Bank Now/i }));
       await waitFor(() => expect(mocks.wallets).toHaveBeenCalledTimes(1));

       const walletTrigger = screen.getByRole("combobox", { name: /Refund from account/i });
       fireEvent.keyDown(walletTrigger, { key: "ArrowDown" });
       fireEvent.click(await screen.findByRole("option", { name: /Main Cash/ }));

       mocks.issueRefund.mockRejectedValueOnce(new Error("OVERDRAW_CONFIRM_REQUIRED:Main Cash:100.00"));
       fireEvent.click(screen.getByRole("button", { name: /Record refund/i }));

       await screen.findByText("This account will go below zero");
       expect(screen.getByText(/after this refund/)).toBeTruthy();

       fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
       await waitFor(() => expect(mocks.issueRefund).toHaveBeenCalledTimes(2));
       expect(mocks.issueRefund).toHaveBeenLastCalledWith({
         data: expect.objectContaining({
           customerId: "cust-1",
           amount: 600,
           walletId: "w-cash",
           salesReturnId: "ret-1",
           allowOverdraw: true,
         }),
       });
     });

     it("hides Refund Cash / Bank option when user lacks finance.refunds.issue", async () => {
       mocks.permissions = ["sales.view", "inventory.returns.receive"];
       mount(
         <ReturnLifecycleActions
           invoiceId="inv-1"
           returnId="ret-1"
           status="approved"
           items={[{ id: "li-1", label: "Bottle", approvedUnits: 5 }]}
         />,
       );

       fireEvent.click(screen.getByRole("button", { name: "Receive" }));
       fireEvent.change(screen.getByLabelText("Bottle good packs"), { target: { value: "5" } });
       fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));

       await screen.findByText(/CN-2026-0001/);
       expect(screen.queryByRole("button", { name: /Refund Cash \/ Bank Now/i })).toBeNull();
       expect(screen.getByText(/finance\.refunds\.issue/i)).toBeTruthy();
     });

     it("shows customer profile link when void is blocked by active refunds", async () => {
       mocks.voidRet.mockRejectedValueOnce(
         new Error(
           formatVoidBlockedByRefundError({
             customerId: "cust-99",
             customerType: "distributor",
             activeRefundCount: 1,
             activeRefundTotal: 600,
           }),
         ),
       );
       mount(<ReturnLifecycleActions invoiceId="inv-1" returnId="ret-1" status="completed" />);

       fireEvent.click(screen.getByRole("button", { name: "Void receipt" }));
       fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong item inspected" } });
       fireEvent.click(screen.getByRole("button", { name: "Void receipt" }));

       const link = await screen.findByRole("link", { name: /Open customer profile to reverse refund/i });
       expect(link.getAttribute("data-to")).toBe("/sales/people/distributors/$customerId");
       expect(link.getAttribute("data-params")).toContain("cust-99");
     });

     it("renders formal credit note details and split in CreditNotePrintDialog when open", async () => {
       mocks.detail.mockResolvedValue({
         id: "ret-1",
         returnNumber: 12,
         creditNoteNumber: "CN-2026-0005",
         creditNoteIssuedAt: "2026-11-11T10:00:00.000Z",
         completedAt: "2026-11-11T10:00:00.000Z",
         status: "completed",
         reason: "Damaged box",
         totalAmount: "1000.00",
         appliedToInvoiceAmount: "300.00",
         customerCreditAmount: "700.00",
         invoice: { id: "inv-1", invoiceNumber: "INV-101", date: "2026-11-01" },
         customer: { id: "c-1", name: "Al-Noor Traders", city: "Lahore", mobileNumber: "0300-1112233" },
         items: [
           {
             id: "ri-1",
             goodUnits: 5,
             damagedUnits: 0,
             expiredUnits: 0,
             refundPerUnit: "200.00",
             totalRefund: "1000.00",
             invoiceItem: { id: "ii-1", pack: "Mango 1L" },
           },
         ],
         refunds: [],
       });
       mount(<CreditNotePrintDialog open onOpenChange={vi.fn()} returnId="ret-1" />);
       await screen.findByText("CN-2026-0005");
       expect(screen.getByText(/Al-Noor Traders/)).toBeTruthy();
       expect(screen.getByText(/Mango 1L/)).toBeTruthy();
     });
   });
   ```

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test src/__tests__/credit-note-screen4.behavior.test.tsx src/__tests__/sales-return-ui.behavior.test.tsx src/__tests__/sales-returns-pages.behavior.test.tsx`
Expected: FAIL (`credit-note-print-dialog.tsx` does not exist yet; `descriptionLabel` prop not yet accepted; Screen 4 not wired yet).

- [ ] **Step 3: Implement `OverdrawConfirmDialog` label, `CreditNotePrintDialog`, Screen 4, Void Link & Returns UI**

1. **`src/components/finance/overdraw-confirm-dialog.tsx`**: add optional `descriptionLabel?: string` (`descriptionLabel = "expense"`):
   ```tsx
   export function OverdrawConfirmDialog({
     open,
     onOpenChange,
     walletName,
     balance,
     balanceAfter,
     onConfirm,
     pending,
     descriptionLabel = "expense",
   }: {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     walletName: string;
     balance: string;
     balanceAfter: string;
     onConfirm: () => void;
     pending: boolean;
     descriptionLabel?: string;
   }) {
     return (
       <AlertDialog open={open} onOpenChange={onOpenChange}>
         <AlertDialogContent>
           <AlertDialogHeader>
             <AlertDialogTitle>This account will go below zero</AlertDialogTitle>
             <AlertDialogDescription>
               {`${walletName} has ${formatRupees(balance)} now and will be ${formatRupees(balanceAfter)} after this ${descriptionLabel}. Save anyway?`}
             </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter>
             <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
             <AlertDialogAction onClick={onConfirm} disabled={pending}>
               Save anyway
             </AlertDialogAction>
           </AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
     );
   }
   ```

2. **Create `src/components/sales/credit-note-print-dialog.tsx`**:
   ```tsx
   import { format } from "date-fns";
   import { AlertCircle, Printer } from "lucide-react";
   import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
   import { Badge } from "@/components/ui/badge";
   import { Button } from "@/components/ui/button";
   import { Skeleton } from "@/components/ui/skeleton";
   import {
     Table,
     TableBody,
     TableCell,
     TableHead,
     TableHeader,
     TableRow,
   } from "@/components/ui/table";
   import { useSalesReturnDetail } from "@/hooks/sales/use-sales-returns";
   import { formatRupees } from "@/lib/finance/expense-entry";
   import { receivedUnits } from "@/lib/sales/returns/return-lifecycle";

   interface Props {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     returnId: string | null;
   }

   export function CreditNotePrintDialog({ open, onOpenChange, returnId }: Props) {
     const { data, isLoading, isError } = useSalesReturnDetail(open ? returnId : null);

     const handlePrint = () => {
       if (!data) return;
       const win = window.open("", "_blank");
       if (!win) return;
       const issuedAt = data.creditNoteIssuedAt ?? data.completedAt ?? data.returnDate;
       const itemRows = data.items
         .map((item) => {
           const qty = receivedUnits(item);
           return `
             <tr>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;">${item.invoiceItem?.pack ?? "Item"}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.goodUnits}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.damagedUnits}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${item.expiredUnits}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${qty}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${formatRupees(item.refundPerUnit)}</td>
               <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;font-weight:600;">${formatRupees(item.totalRefund)}</td>
             </tr>`;
         })
         .join("");
       const html = `<!DOCTYPE html>
   <html>
   <head>
     <title>Credit Note ${data.creditNoteNumber ?? `#${data.returnNumber}`}</title>
     <style>
       @page { size: A4 portrait; margin: 14mm; }
       body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
       table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
       th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
       .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
       .split { margin-top: 16px; margin-left: auto; width: 320px; font-size: 12px; }
       .split div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
       .watermark { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 64px; color: rgba(220, 38, 38, 0.14); font-weight: 800; pointer-events: none; }
     </style>
   </head>
   <body>
     ${data.status === "voided" ? '<div class="watermark">VOIDED</div>' : ""}
     <div class="header">
       <div>
         <h1 style="margin:0;font-size:22px;">CREDIT NOTE</h1>
         <div style="font-size:13px;font-weight:700;margin-top:4px;">${data.creditNoteNumber ?? `RET-${data.returnNumber}`}</div>
         <div style="font-size:11px;color:#475569;">Return #${data.returnNumber} · Invoice #${data.invoice?.invoiceNumber ?? "—"}</div>
       </div>
       <div style="text-align:right;font-size:12px;">
         <div><strong>Issued:</strong> ${issuedAt ? format(new Date(issuedAt), "dd MMM yyyy") : "—"}</div>
         <div><strong>Customer:</strong> ${data.customer?.name ?? "—"}</div>
         ${data.customer?.city ? `<div>${data.customer.city}</div>` : ""}
         ${data.customer?.mobileNumber ? `<div>${data.customer.mobileNumber}</div>` : ""}
       </div>
     </div>
     <table>
       <thead>
         <tr>
           <th>Item</th>
           <th style="text-align:right;">Good</th>
           <th style="text-align:right;">Damaged</th>
           <th style="text-align:right;">Expired</th>
           <th style="text-align:right;">Received</th>
           <th style="text-align:right;">Per Unit</th>
           <th style="text-align:right;">Line Credit</th>
         </tr>
       </thead>
       <tbody>${itemRows}</tbody>
     </table>
     <div class="split">
       <div><span>Credit Note Total</span><strong>${formatRupees(data.totalAmount)}</strong></div>
       <div><span>Applied to Invoice Balance</span><span>${formatRupees(data.appliedToInvoiceAmount ?? 0)}</span></div>
       <div><span>Transferred to Store Credit</span><span>${formatRupees(data.customerCreditAmount ?? 0)}</span></div>
     </div>
     <script>window.onload = () => { window.print(); };</script>
   </body>
   </html>`;
       win.document.write(html);
       win.document.close();
     };

     return (
       <ResponsiveDialog
         title="Print Credit Note"
         description="Preview and print the issued Credit Note"
         open={open}
         onOpenChange={onOpenChange}
         className="lg:min-w-[70vw]"
         icon={Printer}
       >
         {isLoading ? (
           <Skeleton className="h-64 w-full" />
         ) : isError || !data ? (
           <div className="flex flex-col items-center justify-center gap-3 py-12">
             <AlertCircle className="size-10 text-destructive" />
             <p className="text-sm text-destructive">Failed to load Credit Note details.</p>
           </div>
         ) : (
           <div className="space-y-5">
             <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
               <div className="space-y-1">
                 <div className="flex items-center gap-2">
                   <span className="font-mono text-lg font-bold">
                     {data.creditNoteNumber ?? `RET-${data.returnNumber}`}
                   </span>
                   <Badge variant={data.status === "voided" ? "destructive" : "default"}>
                     {data.status === "voided" ? "Voided" : "Completed"}
                   </Badge>
                 </div>
                 <p className="text-xs text-muted-foreground">
                   Return #{data.returnNumber} · Invoice #{data.invoice?.invoiceNumber}
                   {data.invoice?.date ? ` (${format(new Date(data.invoice.date), "dd MMM yyyy")})` : ""}
                 </p>
               </div>
               <div className="text-right text-sm">
                 <p className="font-semibold">{data.customer?.name}</p>
                 {(data.customer?.city || data.customer?.mobileNumber) && (
                   <p className="text-xs text-muted-foreground">
                     {[data.customer.city, data.customer.mobileNumber].filter(Boolean).join(" · ")}
                   </p>
                 )}
               </div>
             </div>

             {data.status === "voided" && data.voidReason && (
               <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                 Voided: {data.voidReason}
               </div>
             )}

             <div className="overflow-x-auto rounded-lg border">
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead>Item</TableHead>
                     <TableHead className="text-right">Good</TableHead>
                     <TableHead className="text-right">Damaged</TableHead>
                     <TableHead className="text-right">Expired</TableHead>
                     <TableHead className="text-right">Received</TableHead>
                     <TableHead className="text-right">Per unit</TableHead>
                     <TableHead className="text-right">Credit</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {data.items.map((item) => (
                     <TableRow key={item.id}>
                       <TableCell className="text-sm font-medium">{item.invoiceItem?.pack ?? "Item"}</TableCell>
                       <TableCell className="text-right text-sm tabular-nums">{item.goodUnits}</TableCell>
                       <TableCell className="text-right text-sm tabular-nums">{item.damagedUnits}</TableCell>
                       <TableCell className="text-right text-sm tabular-nums">{item.expiredUnits}</TableCell>
                       <TableCell className="text-right text-sm tabular-nums">{receivedUnits(item)}</TableCell>
                       <TableCell className="text-right text-sm tabular-nums">{formatRupees(item.refundPerUnit)}</TableCell>
                       <TableCell className="text-right text-sm font-medium tabular-nums">{formatRupees(item.totalRefund)}</TableCell>
                     </TableRow>
                   ))}
                 </TableBody>
               </Table>
             </div>

             <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3">
               <div>
                 <p className="text-xs text-muted-foreground">Credit Note Total</p>
                 <p className="text-base font-bold tabular-nums">{formatRupees(data.totalAmount)}</p>
               </div>
               <div>
                 <p className="text-xs text-muted-foreground">Applied to Invoice</p>
                 <p className="text-base font-semibold tabular-nums">
                   {formatRupees(data.appliedToInvoiceAmount ?? 0)}
                 </p>
               </div>
               <div>
                 <p className="text-xs text-muted-foreground">Transferred to Store Credit</p>
                 <p className="text-base font-semibold tabular-nums text-emerald-600">
                   {formatRupees(data.customerCreditAmount ?? 0)}
                 </p>
               </div>
             </div>

             {!!data.refunds?.length && (
               <div className="space-y-2 rounded-lg border p-3">
                 <p className="text-xs font-semibold uppercase text-muted-foreground">Linked Customer Refunds</p>
                 {data.refunds.map((refund: any) => (
                   <div key={refund.id} className="flex items-center justify-between text-xs">
                     <span>
                       {format(new Date(refund.refundDate), "dd MMM yyyy")} · {refund.wallet?.name ?? "Account"} ({refund.status})
                     </span>
                     <span className="font-semibold tabular-nums">{formatRupees(refund.amount)}</span>
                   </div>
                 ))}
               </div>
             )}

             <div className="flex justify-end gap-2">
               <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                 Close
               </Button>
               <Button type="button" onClick={handlePrint} className="gap-1.5">
                 <Printer className="size-4" />
                 Print credit note
               </Button>
             </div>
           </div>
         )}
       </ResponsiveDialog>
     );
   }
   ```

3. **`src/components/sales/return-lifecycle-actions.tsx`**:
   - Import `Link` from `@tanstack/react-router`, `format` from `date-fns`, `Alert`/`AlertDescription` from `@/components/ui/alert`, `Select*` from `@/components/ui/select`, `OverdrawConfirmDialog` from `@/components/finance/overdraw-confirm-dialog`, `CreditNotePrintDialog` from `./credit-note-print-dialog`, `useWallets` from `@/hooks/finance/use-finance`, `useIssueCustomerRefund` from `@/hooks/sales/use-customer-credit`, `{ isOverdrawConfirmError }` from `@/lib/finance/expense-corrections`, `{ formatAmountInput, formatRupees, getBalanceAfter, parseAmountInput }` from `@/lib/finance/expense-entry`, and `{ parseVoidBlockedByRefundError }` from `@/lib/sales/returns/return-lifecycle`.
   - Accept optional `creditNoteNumber?: string | null` on props (`{ invoiceId, returnId, status, items, creditNoteNumber }`).
   - Add `canIssueRefund = canRead && hasPermission(viewer?.permissions ?? [], "finance.refunds.issue");`.
   - Maintain Screen 4 state:
     ```ts
     type SettledCreditNoteResult = {
       returnId: string;
       creditNoteNumber: string;
       totalAmount: number;
       appliedToInvoiceAmount: number;
       customerCreditAmount: number;
       customerId: string;
       customerName: string;
       customerType: string;
       invoiceNumber: string;
       leftoverCreditBalance: number;
     };
     const [settledCreditNote, setSettledCreditNote] = useState<SettledCreditNoteResult | null>(null);
     const [settlementChoice, setSettlementChoice] = useState<"keep" | "refund">("keep");
     const [refundWalletId, setRefundWalletId] = useState("");
     const [refundAmount, setRefundAmount] = useState("");
     const [refundDate, setRefundDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
     const [refundNotes, setRefundNotes] = useState("");
     const [refundError, setRefundError] = useState("");
     const [overdrawOpen, setOverdrawOpen] = useState(false);
     const [printOpen, setPrintOpen] = useState(false);

     const walletsQuery = useWallets({
       enabled: Boolean(settledCreditNote) && settlementChoice === "refund",
     });
     const issueRefund = useIssueCustomerRefund(settledCreditNote?.customerId);
     ```
   - Inside `submit`:
     ```ts
     } else if (nextAction === "receive") {
       checkInspection(inspection);
       const result = await complete.mutateAsync({
         returnId,
         notes: notes.trim() || undefined,
         lines: inspection.map((line) => ({
           returnItemId: line.id,
           goodUnits: line.goodUnits,
           damagedUnits: line.damagedUnits,
           expiredUnits: line.expiredUnits,
         })),
       });
       if (
         result &&
         typeof result === "object" &&
         "creditNoteNumber" in result &&
         Boolean((result as { creditNoteNumber?: string | null }).creditNoteNumber)
       ) {
         const cn = result as unknown as SettledCreditNoteResult;
         setSettledCreditNote({ ...cn, returnId });
         setSettlementChoice("keep");
         setRefundWalletId("");
         setRefundAmount(String(cn.customerCreditAmount ?? 0));
         setRefundDate(format(new Date(), "yyyy-MM-dd"));
         setRefundNotes("");
         setRefundError("");
       }
     }
     ```
   - Parse `const voidBlocked = !action && error ? parseVoidBlockedByRefundError(error) : null;` and render:
     ```tsx
     {voidBlocked ? (
       <Alert variant="destructive">
         <AlertDescription className="space-y-1.5">
           <p>{error}</p>
           <Link
             to={
               voidBlocked.customerType === "distributor"
                 ? "/sales/people/distributors/$customerId"
                 : voidBlocked.customerType === "shopkeeper"
                   ? "/sales/people/shopkeepers/$customerId"
                   : "/sales/customers/$customerId"
             }
             params={{ customerId: voidBlocked.customerId }}
             className="inline-block font-semibold underline"
           >
             Open customer profile to reverse refund
           </Link>
         </AlertDescription>
       </Alert>
     ) : !action && error ? (
       <p role="alert">{error}</p>
     ) : null}
     ```
     Inside `<Dialog>`, also render the `<Link>` block next to `{error}` when `parseVoidBlockedByRefundError(error)` matches while `action === "void"` is still open so users see both inline link inside dialog AND if dialog was left open! (Remember to add `if (parseVoidBlockedByRefundError(msg))` inside the dialog `{error && ...}` block as well!)
   - Render Screen 4 `<Dialog open={Boolean(settledCreditNote)} onOpenChange={(o) => { if (!o && !issueRefund.isPending) setSettledCreditNote(null); }}>`:
     - Displays `settledCreditNote.creditNoteNumber`, `settledCreditNote.customerName`, `Invoice #${settledCreditNote.invoiceNumber}`, `Credit Note Total`, `Applied to Invoice Balance` (`appliedToInvoiceAmount`), `Transferred to Store Credit` (`customerCreditAmount`).
     - When `settledCreditNote.customerCreditAmount > 0`:
       - Renders `"Keep as Store Credit"` button and, only if `canIssueRefund`, `"Refund Cash / Bank Now"` button; otherwise renders subtle info callout explaining `finance.refunds.issue` permission is needed to issue a cash/bank refund.
       - When `settlementChoice === "refund"` and `canIssueRefund`:
         - Account `<Select>` (`aria-label="Refund from account"`) listing active wallets (`(walletsQuery.data ?? []).filter((w: any) => !w.archived)`).
         - Amount `<Input>` (`formatAmountInput`), Date `<Input type="date">`, Notes `<Input>`.
         - `"Record refund"` submit calling `issueRefund.mutateAsync({ ..., allowOverdraw: false })`, catching `isOverdrawConfirmError` -> opening `<OverdrawConfirmDialog descriptionLabel="refund" ... />`.
     - Footer renders `"Print credit note"` button (`setPrintOpen(true)`) and `"Done"` button closing Screen 4.
   - Mount `<CreditNotePrintDialog open={printOpen} onOpenChange={setPrintOpen} returnId={settledCreditNote?.returnId ?? returnId} />` when `creditNoteNumber || settledCreditNote` is present.

4. **`src/components/sales/returns/return-actions.tsx`**:
   Add optional `creditNoteNumber?: string | null` on `salesReturn` prop and forward `creditNoteNumber={salesReturn.creditNoteNumber}` to `<ReturnLifecycleActions />`.

5. **`src/routes/_protected/sales/returns/$returnId.tsx`**:
   - Add `const [printOpen, setPrintOpen] = useState(false);`.
   - Next to `<ReturnStatusBadge status={data.status} />`:
     ```tsx
     {inspected && data.creditNoteNumber && (
       <Badge variant="secondary" className="font-mono">
         {data.creditNoteNumber}
       </Badge>
     )}
     ```
   - Next to `<ReturnActions salesReturn={data} />`: when `inspected && Boolean(data.creditNoteNumber)`, render:
     ```tsx
     <Button type="button" variant="outline" size="sm" onClick={() => setPrintOpen(true)}>
       <Printer className="mr-1.5 size-4" />
       Print credit note
     </Button>
     ```
     and `<CreditNotePrintDialog open={printOpen} onOpenChange={setPrintOpen} returnId={data.id} />`.
   - Inside Details `<Card>` when `inspected && Boolean(data.creditNoteNumber)`: show `Applied to invoice` (`data.appliedToInvoiceAmount`), `Transferred to store credit` (`data.customerCreditAmount`), and linked `data.refunds` list.

6. **`src/routes/_protected/sales/returns/index.tsx`**:
   Inside the Return `#${row.returnNumber}` cell (`line 235`), if `row.creditNoteNumber` is truthy, render:
   ```tsx
   {row.creditNoteNumber && (
     <div className="font-mono text-[11px] text-muted-foreground">{row.creditNoteNumber}</div>
   )}
   ```

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/__tests__/credit-note-screen4.behavior.test.tsx src/__tests__/sales-return-ui.behavior.test.tsx src/__tests__/sales-returns-pages.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/overdraw-confirm-dialog.tsx src/components/sales/credit-note-print-dialog.tsx src/components/sales/return-lifecycle-actions.tsx src/components/sales/returns/return-actions.tsx src/routes/_protected/sales/returns/\$returnId.tsx src/routes/_protected/sales/returns/index.tsx src/__tests__/sales-return-ui.behavior.test.tsx src/__tests__/sales-returns-pages.behavior.test.tsx src/__tests__/credit-note-screen4.behavior.test.tsx
git commit -m "feat(returns-ui): add printable credit notes, Screen 4 refund/credit modal, and void-blocked customer links"
```

---

## Task 8: Apply Store Credit (`customer_credit`) Across Create/Edit Invoice, Reconciliation, Batch Recoveries, and Invoice Views

**Files:**
- Modify: `src/components/sales/create-invoice-form/payment-rows-field.tsx`
- Modify: `src/components/sales/create-invoice-form/settlement-section.tsx`
- Modify: `src/components/sales/create-invoice-form.tsx`
- Modify: `src/routes/_protected/sales/reconciliation/index.tsx`
- Modify: `src/components/sales/batch-recoveries-dialog.tsx`
- Modify: `src/routes/_protected/sales/invoices/$invoiceId/index.tsx`
- Modify: `src/components/sales/invoice-detail-sheet.tsx`
- Modify: `src/components/finance/payment-verification-page.tsx`
- Test (modify): `src/components/sales/create-invoice-form/payment-rows-field.test.tsx`
- Test (create): `src/__tests__/store-credit-apply.behavior.test.tsx`

**Interfaces:**
- Consumes: `useCustomerCreditSummary`, `calculatePaymentBreakdown`, `blankPayment`, `reconcileSlipFn`, `batchReconcileSlipsFn`, `CreditNotePrintDialog`
- Produces: `"customer_credit"` (`"Store Credit"`) payment method across invoice creation/edit, single slip reconciliation, cumulative-capped batch recoveries, daily closing credit/refund metrics, and invoice/verification UI labels

- [ ] **Step 1: Write failing tests for `customer_credit` breakdown & form/reconciliation controls**

1. Add tests to `src/components/sales/create-invoice-form/payment-rows-field.test.tsx`:
   - `calculatePaymentBreakdown(1_000, [payment("customer_credit", 400)])` treats `customer_credit` as immediately `paidAmount: 400`, `pendingAmount: 0`, `outstandingAmount: 600`, `payLaterAmount: 600`.
   - `calculatePaymentBreakdown(1_000, [payment("expense_offset", 300)])` treats `expense_offset` as immediately `paidAmount: 300`, `pendingAmount: 0`, `outstandingAmount: 700`.
   - Source checks: `PaymentRowsField` contains `<SelectItem value="customer_credit"`, preserves `'payment.method === "cash" ? "cash" : "bank"'`, and `SettlementSection` contains `"Apply Store Credit"`.
2. Create `src/__tests__/store-credit-apply.behavior.test.tsx`:
   ```tsx
   import { readFileSync } from "node:fs";
   import { resolve } from "node:path";
   import { describe, expect, it } from "vitest";
   import { calculatePaymentBreakdown, blankPayment } from "@/components/sales/create-invoice-form/payment-rows-field";

   describe("store credit application safeguards across invoice, reconciliation, and batch recoveries", () => {
     it("counts customer_credit as confirmed paid immediately with zero pending amount", () => {
       const breakdown = calculatePaymentBreakdown(1500, [
         { ...blankPayment("customer_credit"), amount: 600 },
         { ...blankPayment("cash"), amount: 400, walletId: "w-cash" },
       ]);
       expect(breakdown).toEqual({
         invoiceTotal: 1500,
         paidAmount: 1000,
         pendingAmount: 0,
         outstandingAmount: 500,
         payLaterAmount: 500,
         overAllocatedAmount: 0,
       });
     });

     it("wires customer_credit validation, zero-wallet handling, and cumulative caps across invoice, reconciliation, and batch recovery flows", () => {
       const formSource = readFileSync(resolve(process.cwd(), "src/components/sales/create-invoice-form.tsx"), "utf8");
       const recSource = readFileSync(resolve(process.cwd(), "src/routes/_protected/sales/reconciliation/index.tsx"), "utf8");
       const batchSource = readFileSync(resolve(process.cwd(), "src/components/sales/batch-recoveries-dialog.tsx"), "utf8");

       expect(formSource).toContain("useCustomerCreditSummary");
       expect(formSource).toContain('payment.method !== "expense_offset" && payment.method !== "customer_credit" && !payment.walletId');
       expect(recSource).toContain('"customer_credit"');
       expect(recSource).toContain("Apply Store Credit");
       expect(recSource).toContain("totalCreditApplied");
       expect(recSource).toContain("totalCustomerRefunds");
       expect(batchSource).toContain('"customer_credit"');
       expect(batchSource).toContain("customerCreditBalance");
     });
   });
   ```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/components/sales/create-invoice-form/payment-rows-field.test.tsx src/__tests__/store-credit-apply.behavior.test.tsx`
Expected: FAIL (`customer_credit` missing from payment breakdown & UI files).

- [ ] **Step 3: Implement `customer_credit` across invoice form, reconciliation, batch recoveries, and detail views**

1. **`src/components/sales/create-invoice-form/payment-rows-field.tsx`**:
   - Expand `PaymentInput["method"]` to:
     `"cash" | "bank_transfer" | "digital_wallet" | "cheque" | "expense_offset" | "customer_credit"`.
   - Update `calculatePaymentBreakdown`:
     ```ts
     const countsAsPaid = (payment: PaymentInput) =>
       payment.status
         ? payment.status === "confirmed"
         : payment.method === "cash" ||
           payment.method === "expense_offset" ||
           payment.method === "customer_credit" ||
           Boolean(payment.instantVerify);
     const countsAsPending = (payment: PaymentInput) =>
       payment.status
         ? payment.status === "pending"
         : !["cash", "expense_offset", "customer_credit"].includes(payment.method) &&
           !payment.instantVerify;
     ```
   - Update `paymentMethodLabel`: add `if (method === "customer_credit") return "Store Credit";`.
   - Accept optional `availableCustomerCredit?: number` in `PaymentRowsField` props.
   - Keep `const requiredWalletType = payment.method === "cash" ? "cash" : "bank";` intact on line 218.
   - Badge (line 275): render `Pending Verification` only when `!payment.status && !["cash", "expense_offset", "customer_credit"].includes(payment.method)`. When `!payment.status && payment.method === "customer_credit"`, render `<Badge variant="default">Instant Credit</Badge>`.
   - Method `<SelectContent>` (`line 307`): add:
     ```tsx
     <SelectItem
       value="customer_credit"
       disabled={availableCustomerCredit !== undefined && availableCustomerCredit <= 0}
     >
       Store Credit
     </SelectItem>
     ```
   - Destination Account (`line 347`): wrap with `payment.method !== "expense_offset" && payment.method !== "customer_credit"`.
   - Render helper card when `payment.method === "customer_credit"` showing available credit (when `availableCustomerCredit !== undefined`) and `"Deducted FIFO from active customer credit lots. No cash or bank account movement."`, and ensure the fallback Receipt/Memo Reference field ignores both `expense_offset` and `customer_credit`!
   - Instant Verification checkbox (`line 652`): guard with `!["cash", "expense_offset", "customer_credit"].includes(payment.method) && !rowReadOnly`.

2. **`src/components/sales/create-invoice-form/settlement-section.tsx`**:
   - Add `availableCustomerCredit?: number` to `SettlementSectionProps` (default `0`).
   - Compute new (unsaved) Store Credit allocated across `payments`:
     ```ts
     const newCreditAllocated = Number(
       payments
         .filter((p) => !p.status && p.method === "customer_credit")
         .reduce((sum, p) => sum + Number(p.amount || 0), 0)
         .toFixed(2),
     );
     const remainingCustomerCredit = Number(
       Math.max(0, availableCustomerCredit - newCreditAllocated).toFixed(2),
     );
     const storeCreditOverLimit = Number(
       Math.max(0, newCreditAllocated - availableCustomerCredit).toFixed(2),
     );

     function addStoreCreditPayment() {
       if (remainingCustomerCredit <= 0 || breakdown.payLaterAmount <= 0) return;
       const currentPayments = form.getFieldValue("payments") as PaymentInput[];
       const applyAmount = Number(
         Math.min(remainingCustomerCredit, breakdown.payLaterAmount).toFixed(2),
       );
       form.setFieldValue("payments", [
         ...currentPayments,
         {
           ...blankPayment("customer_credit"),
           amount: applyAmount,
         },
       ]);
     }
     ```
   - When `availableCustomerCredit > 0`: render a Store Credit summary card above quick cash/pay-later buttons showing `Available Store Credit: {PKR(availableCustomerCredit)}` and `<Button type="button" variant="outline" size="sm" onClick={addStoreCreditPayment} disabled={remainingCustomerCredit <= 0 || breakdown.payLaterAmount <= 0}>Apply Store Credit</Button>`.
   - When `storeCreditOverLimit > 0`: render a destructive banner `"Store credit allocated exceeds available balance by {PKR(storeCreditOverLimit)}."`.
   - Pass `availableCustomerCredit={availableCustomerCredit}` to `<PaymentRowsField />`.

3. **`src/components/sales/create-invoice-form.tsx`**:
   - Import `useCustomerCreditSummary` from `@/hooks/sales/use-customer-credit`.
   - Declare `const availableCustomerCreditRef = useRef(0);` ABOVE `const form = useForm({ ... })` so `onSubmit` never suffers temporal dead zone initialization ordering.
   - After `selectedCustomerId` & `selectedCustomerData` (`line 563`):
     ```ts
     const { data: creditSummary } = useCustomerCreditSummary(
       customerMode === "existing" ? (selectedCustomerId || initialData?.customerId || null) : null,
       customerMode === "existing" && Boolean(selectedCustomerId || initialData?.customerId),
     );
     const availableCustomerCredit = roundMoney(
       creditSummary?.creditBalance ?? Number(selectedCustomerData?.creditBalance ?? 0),
     );
     availableCustomerCreditRef.current = availableCustomerCredit;
     ```
   - Inside `onSubmit` (`line 342`):
     ```ts
     if (payment.method !== "expense_offset" && payment.method !== "customer_credit" && !payment.walletId) {
       toast.error(
         payment.method === "cash"
           ? `Payment ${i + 1}: Select a cash destination account.`
           : `Payment ${i + 1}: Select a bank destination account.`,
       );
       return;
     }
     ```
     and check cumulative new Store Credit payments BEFORE submitting:
     ```ts
     const newCreditAllocated = roundMoney(
       value.payments
         .filter((p) => !p.status && p.method === "customer_credit")
         .reduce((sum, p) => sum + Number(p.amount || 0), 0),
     );
     if (newCreditAllocated > availableCustomerCreditRef.current) {
       toast.error(
         `Store Credit allocated (${PKR(newCreditAllocated)}) exceeds available credit (${PKR(availableCustomerCreditRef.current)}).`,
       );
       return;
     }
     ```
   - Inside `normalizedPayments` (`lines 416 & 439`):
     ```ts
     const backendMethod: "cash" | "bank_transfer" | "cheque" | "expense_offset" | "customer_credit" =
       isDigital ? "bank_transfer" : payment.method;
     ...
     walletId:
       payment.method === "expense_offset" || payment.method === "customer_credit"
         ? undefined
         : payment.walletId || undefined,
     instantVerify:
       payment.method === "cash" ||
       payment.method === "expense_offset" ||
       payment.method === "customer_credit"
         ? false
         : Boolean(payment.instantVerify),
     ```
   - Pass `availableCustomerCredit={availableCustomerCredit}` to `<SettlementSection />`.

4. **`src/routes/_protected/sales/reconciliation/index.tsx`**:
   - Derive `const customerCreditBalance = Number((slip as any)?.customerCreditBalance ?? 0);`.
   - Expand `reconcileSlip` mutation payload `method` and `form.defaultValues.method` to include `"customer_credit"`.
   - In `onSubmit`:
     - Validate `if (value.method === "customer_credit" && value.amount > customerCreditBalance)` -> toast error & return.
     - Require `walletId` only when `value.method !== "expense_offset" && value.method !== "customer_credit"`.
     - Map `backendMethod`: include `"customer_credit"`.
     - Pass `walletId: value.method === "expense_offset" || value.method === "customer_credit" ? undefined : value.walletId`.
     - Pass `instantVerify: !["cash", "expense_offset", "customer_credit"].includes(value.method) ? Boolean(value.instantVerify) : undefined`.
   - In `reconcileSlip.onSuccess`: also invalidate `["customer-credit"]`, `["distributor-profile"]`, `["shopkeeper-profile"]`, `["distributor-ledger"]`, `["shopkeeper-ledger"]`, `["salesman-ledger"]`, `["salesman-shop-ledger"]`.
   - In Slip Details card (`lines 470-493`) & Record Payment card (`lines 536-575`): when `customerCreditBalance > 0`, show `Available Store Credit: {PKR(customerCreditBalance)}` pill/callout and `"Apply Store Credit"` button (`disabled={unallocatedAmount <= 0}`) setting `method = "customer_credit"`, `amount = Math.round(Math.min(customerCreditBalance, unallocatedAmount) * 100) / 100`, `walletId = ""`, `instantVerify = false`.
   - Add `<SelectItem value="customer_credit" disabled={customerCreditBalance <= 0}>Store Credit</SelectItem>` inside Method `<SelectContent>`.
   - Guard `walletId` `<form.Field>` render with `if (currentMethod === "expense_offset" || currentMethod === "customer_credit") return null;`.
   - In Daily Closing tab (`lines 1281-1365`):
     - Render KPI cards including `Total Collected` (clarify Cash/Bank/Cheque), `Cash`, `Bank Transfer`, `Store Credit Applied` (`dailySummary.totalCreditApplied ?? 0`), `Customer Refunds` (`dailySummary.totalCustomerRefunds ?? 0`), `Slips Closed Today`.
     - Display `p.method === "customer_credit" ? "Store Credit" : p.method.replace("_", " ")` cleanly in today's payments table.
     - Below payments table, if `Boolean(dailySummary.refunds?.length)`, render a `Customer Refunds Issued Today` `<Table>` listing Time, Customer, Account (`wallet?.name`), Credit Note #, Amount.

5. **`src/components/sales/batch-recoveries-dialog.tsx`**:
   - Expand `method` state to `"cash" | "bank_transfer" | "customer_credit"`.
   - Include `customerId: slip.customerId` and `customerCreditBalance: Number((slip as any).customerCreditBalance ?? 0)` inside `RecoveryEntry` when selecting slips.
   - Show `<Badge variant="secondary" className="ml-2 text-[10px]">Credit: {PKR(Number((slip as any).customerCreditBalance ?? 0))}</Badge>` next to customer name when `Number((slip as any).customerCreditBalance ?? 0) > 0`.
   - Add `<SelectItem value="customer_credit">Store Credit</SelectItem>` to Method `<Select>`.
   - Hide Deposit Account field when `method === "customer_credit"` (and keep `useEffect` clearing/ignoring `walletId` when `method === "customer_credit"`).
   - Compute per-customer cumulative requested store credit across selected slips (`Map<string, { customerName: string; requested: number; available: number }>`). When `method === "customer_credit"`, display warning alert if any customer's total exceeds their `available` credit, and block `handleSubmit` if over-allocated!
   - Guard `!walletId` check in `handleSubmit` with `if (method !== "customer_credit" && !walletId)`.
   - Pass `walletId: method === "customer_credit" ? undefined : walletId || undefined` in `batchReconcile`.
   - Invalidate `["customer-credit"]`, `["customers"]`, `["distributor-profile"]`, `["shopkeeper-profile"]`, `["distributor-ledger"]`, `["shopkeeper-ledger"]` inside `onSuccess`.

6. **`src/routes/_protected/sales/invoices/$invoiceId/index.tsx`**, **`src/components/sales/invoice-detail-sheet.tsx`**, & **`src/components/finance/payment-verification-page.tsx`**:
   - Update `paymentMethodLabel` in `$invoiceId/index.tsx` (`line 510`) and `invoice-detail-sheet.tsx` (`line 685`) and `methodLabel` in `payment-verification-page.tsx` (`line 126`) to return `"Store Credit"` for `"customer_credit"` and `"Expense Offset"` for `"expense_offset"`.
   - Update Destination cell/text in all three files:
     - `p.method === "customer_credit" ? "Customer Store Credit" : p.method === "expense_offset" ? "Salary Offset" : (p.wallet?.name ?? "No account")` (matching `"Not available"` default in `payment-verification-page.tsx`).
   - In `$invoiceId/index.tsx`: add `<CreditNotePrintDialog open={Boolean(printCreditNoteReturnId)} onOpenChange={(o) => { if (!o) setPrintCreditNoteReturnId(null); }} returnId={printCreditNoteReturnId} />`, render `ret.creditNoteNumber` `<Badge>` + `"Applied to invoice / Transferred to store credit"` summary + `"Print credit note"` button when `ret.creditNoteNumber` is present, and pass `creditNoteNumber={ret.creditNoteNumber}` to `<ReturnLifecycleActions />`.

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/components/sales/create-invoice-form/payment-rows-field.test.tsx src/__tests__/store-credit-apply.behavior.test.tsx src/__tests__/sales-return-ui.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/create-invoice-form/payment-rows-field.tsx src/components/sales/create-invoice-form/settlement-section.tsx src/components/sales/create-invoice-form.tsx src/routes/_protected/sales/reconciliation/index.tsx src/components/sales/batch-recoveries-dialog.tsx src/routes/_protected/sales/invoices/\$invoiceId/index.tsx src/components/sales/invoice-detail-sheet.tsx src/components/finance/payment-verification-page.tsx src/components/sales/create-invoice-form/payment-rows-field.test.tsx src/__tests__/store-credit-apply.behavior.test.tsx
git commit -m "feat(sales-ui): support customer_credit settlements across invoices, slip reconciliation, batch recoveries, and detail views"
```

---

## Task 9: Customer Credit Section on Profiles, Customers Summary, LedgerPrintExport & All 4 Chronological Ledgers

**Files:**
- Create: `src/components/sales/customer-credit-section.tsx`
- Modify: `src/routes/_protected/sales/customers/$customerId/index.tsx`
- Modify: `src/routes/_protected/sales/people/distributors/$customerId/index.tsx`
- Modify: `src/routes/_protected/sales/people/shopkeepers/$customerId/index.tsx`
- Modify: `src/components/sales/customer-kpi-cards.tsx`
- Modify: `src/components/sales/customers-table.tsx`
- Modify: `src/routes/_protected/sales/customers/index.tsx`
- Modify: `src/components/sales/ledger-print-export.tsx`
- Modify: `src/routes/_protected/sales/people/distributors/$customerId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/shopkeepers/$customerId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/salesmen/$salesmanId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/salesmen/$salesmanId/shops/$customerId.tsx`
- Test (create): `src/__tests__/customer-credit-section.behavior.test.tsx`
- Test (modify): `src/__tests__/ledger-return-rendering.test.tsx`

**Interfaces:**
- Consumes: `useCustomerCreditSummary`, `useIssueCustomerRefund`, `useReverseCustomerRefund`, `useWallets`, `OverdrawConfirmDialog`, `LedgerEntry` (`"invoice" | "payment" | "return" | "refund"`)
- Produces:
  - `<CustomerCreditSection customerId customerName />` showing active store credit balance, FIFO credit lots & Credit Note provenance, movement audit trail, Issue Refund modal (with overdraw flow), and Reverse Refund modal
  - Store Credit KPI + table column on `/sales/customers/`
  - Updated `LedgerPrintExport` + all 4 ledger screens displaying `"refund"`, `"refund_reversal"`, and zero-cash `"Store Credit Applied"` rows cleanly while retaining existing `RET-N` / `VOID-N` export contracts

- [ ] **Step 1: Write failing behavior tests for `CustomerCreditSection`, `LedgerPrintExport`, and all 4 ledgers**

1. Create `src/__tests__/customer-credit-section.behavior.test.tsx`:
   ```tsx
   import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
   import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { CustomerCreditSection } from "@/components/sales/customer-credit-section";

   const mocks = vi.hoisted(() => ({
     summary: vi.fn(),
     issueRefund: vi.fn(),
     reverseRefund: vi.fn(),
     wallets: vi.fn(),
     permissions: ["*"] as string[],
   }));

   vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
     getCustomerCreditSummaryFn: mocks.summary,
     issueCustomerRefundFn: mocks.issueRefund,
     reverseCustomerRefundFn: mocks.reverseRefund,
   }));

   vi.mock("@/server-functions/finance-fn", () => ({
     getWalletsListFn: mocks.wallets,
   }));

   vi.mock("@/hooks/use-viewer-access", () => ({
     useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
   }));

   vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

   let client: QueryClient;

   beforeEach(() => {
     vi.resetAllMocks();
     mocks.permissions = ["*"];
     mocks.wallets.mockResolvedValue([
       { id: "w-1", name: "Petty Cash", type: "cash", balance: "50.00" },
     ]);
     mocks.summary.mockResolvedValue({
       customerId: "c-1",
       creditBalance: 1200,
       lots: [
         {
           id: "lot-1",
           sourceType: "sales_return",
           creditNoteNumber: "CN-2026-0001",
           originalAmount: "1200.00",
           remainingAmount: "1200.00",
           status: "active",
           createdAt: "2026-11-10T10:00:00.000Z",
         },
       ],
       refunds: [
         {
           id: "ref-1",
           amount: "300.00",
           status: "active",
           refundDate: "2026-11-10T11:00:00.000Z",
           creditNoteNumber: "CN-2026-0001",
           wallet: { id: "w-1", name: "Petty Cash" },
           issuedBy: { id: "u-1", name: "Admin" },
           notes: "Paid customer via cash",
         },
       ],
       movements: [
         {
           id: "m-1",
           movementType: "credit_issued",
           amount: "1200.00",
           balanceAfter: "1200.00",
           creditNoteNumber: "CN-2026-0001",
           createdAt: "2026-11-10T10:00:00.000Z",
           notes: "Overpayment from return",
         },
       ],
     });
     mocks.issueRefund.mockResolvedValue({ id: "ref-2", walletName: "Petty Cash" });
     mocks.reverseRefund.mockResolvedValue({ success: true });
     client = new QueryClient({
       defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
     });
     HTMLElement.prototype.scrollIntoView = vi.fn();
     HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
     HTMLElement.prototype.setPointerCapture = vi.fn();
     HTMLElement.prototype.releasePointerCapture = vi.fn();
   });

   afterEach(() => {
     cleanup();
     client.clear();
   });

   function mount(ui: React.ReactNode) {
     return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
   }

   describe("CustomerCreditSection", () => {
     it("shows store credit balance, credit note lots, and opens refund modal with overdraw guard", async () => {
       mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
       await screen.findByText(/CN-2026-0001/);

       fireEvent.click(screen.getByRole("button", { name: /Issue Refund/i }));
       await waitFor(() => expect(mocks.wallets).toHaveBeenCalledTimes(1));

       const trigger = screen.getByRole("combobox", { name: /Refund account/i });
       fireEvent.keyDown(trigger, { key: "ArrowDown" });
       fireEvent.click(await screen.findByRole("option", { name: /Petty Cash/ }));

       fireEvent.change(screen.getByLabelText(/Refund amount/i), { target: { value: "1200" } });
       mocks.issueRefund.mockRejectedValueOnce(new Error("OVERDRAW_CONFIRM_REQUIRED:Petty Cash:50.00"));
       fireEvent.click(screen.getByRole("button", { name: /Confirm refund/i }));

       await screen.findByText("This account will go below zero");
       fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));

       await waitFor(() => expect(mocks.issueRefund).toHaveBeenCalledTimes(2));
       expect(mocks.issueRefund).toHaveBeenLastCalledWith({
         data: expect.objectContaining({
           customerId: "c-1",
           amount: 1200,
           walletId: "w-1",
           allowOverdraw: true,
         }),
       });
     });

     it("allows finance users to reverse an active refund with a reason", async () => {
       mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
       await screen.findByText("Reverse refund");

       fireEvent.click(screen.getByRole("button", { name: "Reverse refund" }));
       fireEvent.change(screen.getByLabelText(/Reversal reason/i), {
         target: { value: "Wrong account selected" },
       });
       fireEvent.click(screen.getByRole("button", { name: /Confirm reversal/i }));

       await waitFor(() => expect(mocks.reverseRefund).toHaveBeenCalledTimes(1));
       expect(mocks.reverseRefund).toHaveBeenCalledWith({
         data: { refundId: "ref-1", reason: "Wrong account selected" },
       });
     });

     it("hides Issue Refund and Reverse refund buttons when user lacks finance permissions", async () => {
       mocks.permissions = ["sales.view"];
       mount(<CustomerCreditSection customerId="c-1" customerName="Al-Noor" />);
       await screen.findByText(/CN-2026-0001/);

       expect(screen.queryByRole("button", { name: /Issue Refund/i })).toBeNull();
       expect(screen.queryByRole("button", { name: /Reverse refund/i })).toBeNull();
     });
   });
   ```
2. Extend `src/__tests__/ledger-return-rendering.test.tsx` with a `describe("store credit and refund rows in ledgers & exports", ...)` block testing:
   - `{ type: "payment", method: "customer_credit", isStoreCreditApplied: true, amount: 400, ... }` renders in Debit & Credit as `"—"` on screen (`distributor`, `shopkeeper`, `salesman`) and `"0.00"` in BOTH Debit & Credit in HTML export (`""` in CSV)!
   - `{ type: "refund", eventKind: "refund", amount: 600, creditNoteNumber: "CN-2026-0001", walletName: "Main Cash", runningBalance: 0 }` renders on the debt-INCREASING column (`4` on `distributor`/`shopkeeper`, `4` on `salesman`) and `{ type: "refund", eventKind: "refund_reversal", amount: 600, ... }` renders on the debt-DECREASING column (`3` on `distributor`/`shopkeeper`, `5` on `salesman`).

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test src/__tests__/customer-credit-section.behavior.test.tsx src/__tests__/ledger-return-rendering.test.tsx`
Expected: FAIL (`customer-credit-section.tsx` missing; refund/store-credit columns missing in ledgers).

- [ ] **Step 3: Implement `CustomerCreditSection`, customer KPIs/tables, `LedgerPrintExport`, and all 4 ledgers**

1. **Create `src/components/sales/customer-credit-section.tsx`**:
   > IMPORTANT: Follow `src/lib/sales-workflows.test.ts` — NEVER include `"Record Payment"`, `"RecordPaymentDialog"`, or `"setPaymentDialogOpen"` anywhere in this file or in `customers/$customerId/index.tsx`! Use `"Issue Refund"` and `"Reverse refund"`.
   ```tsx
   import { format } from "date-fns";
   import { ArrowDownLeft, Banknote, RotateCcw, Wallet } from "lucide-react";
   import { useState } from "react";
   import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
   import { OverdrawConfirmDialog } from "@/components/finance/overdraw-confirm-dialog";
   import { Badge } from "@/components/ui/badge";
   import { Button } from "@/components/ui/button";
   import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
   import { Input } from "@/components/ui/input";
   import { Label } from "@/components/ui/label";
   import {
     Select,
     SelectContent,
     SelectItem,
     SelectTrigger,
     SelectValue,
   } from "@/components/ui/select";
   import { Skeleton } from "@/components/ui/skeleton";
   import {
     Table,
     TableBody,
     TableCell,
     TableHead,
     TableHeader,
     TableRow,
   } from "@/components/ui/table";
   import { Textarea } from "@/components/ui/textarea";
   import { useWallets } from "@/hooks/finance/use-finance";
   import {
     useCustomerCreditSummary,
     useIssueCustomerRefund,
     useReverseCustomerRefund,
   } from "@/hooks/sales/use-customer-credit";
   import { useViewerAccess } from "@/hooks/use-viewer-access";
   import { isOverdrawConfirmError } from "@/lib/finance/expense-corrections";
   import {
     formatAmountInput,
     formatRupees,
     getBalanceAfter,
     parseAmountInput,
   } from "@/lib/finance/expense-entry";
   import { hasPermission } from "@/lib/rbac";

   interface Props {
     customerId: string;
     customerName?: string;
   }

   export function CustomerCreditSection({ customerId, customerName }: Props) {
     const { data: viewer } = useViewerAccess();
     const permissions = viewer?.permissions ?? [];
     const canIssueRefund = hasPermission(permissions, "finance.refunds.issue");
     const canReverseRefund =
       hasPermission(permissions, "finance.payment-reversal") ||
       hasPermission(permissions, "finance.manage");

     const { data: summary, isLoading } = useCustomerCreditSummary(customerId);
     const [refundOpen, setRefundOpen] = useState(false);
     const [walletId, setWalletId] = useState("");
     const [amountInput, setAmountInput] = useState("");
     const [refundDate, setRefundDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
     const [notes, setNotes] = useState("");
     const [formError, setFormError] = useState("");
     const [overdrawOpen, setOverdrawOpen] = useState(false);

     const [reversingRefundId, setReversingRefundId] = useState<string | null>(null);
     const [reverseReason, setReverseReason] = useState("");
     const [reverseError, setReverseError] = useState("");

     const walletsQuery = useWallets({ enabled: refundOpen });
     const issueMutation = useIssueCustomerRefund(customerId);
     const reverseMutation = useReverseCustomerRefund(customerId);

     const creditBalance = Number(summary?.creditBalance ?? 0);
     const activeWallets = (walletsQuery.data ?? []).filter((w: any) => !w.archived);
     const selectedWallet = activeWallets.find((w: any) => w.id === walletId);
     const parsedAmount = parseAmountInput(amountInput);

     const openRefundDialog = () => {
       setWalletId("");
       setAmountInput(creditBalance > 0 ? String(creditBalance) : "");
       setRefundDate(format(new Date(), "yyyy-MM-dd"));
       setNotes("");
       setFormError("");
       setRefundOpen(true);
     };

     const submitRefund = async (allowOverdraw: boolean) => {
       setFormError("");
       if (!walletId) {
         setFormError("Pick a company account.");
         return;
       }
       if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
         setFormError("Enter a positive refund amount.");
         return;
       }
       if (parsedAmount > creditBalance) {
         setFormError(`Refund amount cannot exceed store credit (${formatRupees(creditBalance)}).`);
         return;
       }
       try {
         await issueMutation.mutateAsync({
           customerId,
           amount: parsedAmount,
           walletId,
           refundDate: new Date(`${refundDate}T12:00:00`),
           notes: notes.trim() || undefined,
           allowOverdraw,
         });
         setOverdrawOpen(false);
         setRefundOpen(false);
       } catch (err) {
         if (isOverdrawConfirmError(err)) {
           setOverdrawOpen(true);
           return;
         }
         setFormError(err instanceof Error ? err.message : "Failed to issue refund");
       }
     };

     const submitReverse = async () => {
       if (!reversingRefundId) return;
       setReverseError("");
       if (reverseReason.trim().length < 3) {
         setReverseError("Give a reason (at least 3 characters).");
         return;
       }
       try {
         await reverseMutation.mutateAsync({
           refundId: reversingRefundId,
           reason: reverseReason.trim(),
         });
         setReversingRefundId(null);
         setReverseReason("");
       } catch (err) {
         setReverseError(err instanceof Error ? err.message : "Failed to reverse refund");
       }
     };

     if (isLoading) {
       return <Skeleton className="h-44 w-full rounded-xl" />;
     }

     const lots = summary?.lots ?? [];
     const refunds = summary?.refunds ?? [];
     const movements = summary?.movements ?? [];

     return (
       <Card>
         <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
           <div>
             <CardTitle className="flex items-center gap-2 text-base">
               <Wallet className="size-4 text-emerald-600" />
               Store Credit & Refunds
             </CardTitle>
             <CardDescription>
               FIFO credit balance available for future invoices or cash/bank payouts.
             </CardDescription>
           </div>
           <div className="flex items-center gap-3">
             <div className="text-right">
               <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                 Available Store Credit
               </p>
               <p className="text-xl font-bold tabular-nums text-emerald-600">
                 {formatRupees(creditBalance)}
               </p>
             </div>
             {canIssueRefund && creditBalance > 0 && (
               <Button type="button" size="sm" onClick={openRefundDialog} className="gap-1.5">
                 <Banknote className="size-4" />
                 Issue Refund
               </Button>
             )}
           </div>
         </CardHeader>

         <CardContent className="space-y-6">
           {!!lots.length && (
             <div className="space-y-2">
               <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                 Credit Lots ({lots.length})
               </h4>
               <div className="overflow-x-auto rounded-lg border">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead className="text-[11px]">Date</TableHead>
                       <TableHead className="text-[11px]">Source / Credit Note</TableHead>
                       <TableHead className="text-[11px]">Status</TableHead>
                       <TableHead className="text-[11px] text-right">Original</TableHead>
                       <TableHead className="text-[11px] text-right">Remaining</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {lots.map((lot: any) => (
                       <TableRow key={lot.id}>
                         <TableCell className="text-xs tabular-nums">
                           {format(new Date(lot.createdAt), "dd MMM yyyy")}
                         </TableCell>
                         <TableCell className="text-xs">
                           <span className="font-mono font-medium">
                             {lot.creditNoteNumber ?? lot.sourceType.replace("_", " ")}
                           </span>
                         </TableCell>
                         <TableCell>
                           <Badge variant={lot.status === "active" ? "default" : "outline"} className="text-[10px] capitalize">
                             {lot.status}
                           </Badge>
                         </TableCell>
                         <TableCell className="text-right text-xs tabular-nums">
                           {formatRupees(lot.originalAmount)}
                         </TableCell>
                         <TableCell className="text-right text-xs font-semibold tabular-nums">
                           {formatRupees(lot.remainingAmount)}
                         </TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
             </div>
           )}

           {!!refunds.length && (
             <div className="space-y-2">
               <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                 Cash / Bank Refunds ({refunds.length})
               </h4>
               <div className="overflow-x-auto rounded-lg border">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead className="text-[11px]">Date</TableHead>
                       <TableHead className="text-[11px]">Account</TableHead>
                       <TableHead className="text-[11px]">Credit Note</TableHead>
                       <TableHead className="text-[11px]">Status</TableHead>
                       <TableHead className="text-[11px] text-right">Amount</TableHead>
                       <TableHead className="text-[11px] text-right" />
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {refunds.map((refund: any) => (
                       <TableRow key={refund.id}>
                         <TableCell className="text-xs tabular-nums">
                           {format(new Date(refund.refundDate), "dd MMM yyyy")}
                         </TableCell>
                         <TableCell className="text-xs">{refund.wallet?.name ?? "—"}</TableCell>
                         <TableCell className="font-mono text-xs">{refund.creditNoteNumber ?? "—"}</TableCell>
                         <TableCell>
                           <Badge
                             variant={refund.status === "active" ? "default" : "destructive"}
                             className="text-[10px] capitalize"
                           >
                             {refund.status}
                           </Badge>
                         </TableCell>
                         <TableCell className="text-right text-xs font-semibold tabular-nums">
                           {formatRupees(refund.amount)}
                         </TableCell>
                         <TableCell className="text-right">
                           {canReverseRefund && refund.status === "active" && (
                             <Button
                               type="button"
                               variant="ghost"
                               size="sm"
                               className="h-7 text-xs text-destructive hover:text-destructive"
                               onClick={() => {
                                 setReversingRefundId(refund.id);
                                 setReverseReason("");
                                 setReverseError("");
                               }}
                             >
                               <RotateCcw className="mr-1 size-3" />
                               Reverse refund
                             </Button>
                           )}
                         </TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
             </div>
           )}

           {!!movements.length && (
             <div className="space-y-2">
               <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                 Audit Trail ({movements.length})
               </h4>
               <div className="overflow-x-auto rounded-lg border">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       <TableHead className="text-[11px]">Date</TableHead>
                       <TableHead className="text-[11px]">Event</TableHead>
                       <TableHead className="text-[11px]">Reference</TableHead>
                       <TableHead className="text-[11px] text-right">Amount</TableHead>
                       <TableHead className="text-[11px] text-right">Balance After</TableHead>
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {movements.map((mov: any) => (
                       <TableRow key={mov.id}>
                         <TableCell className="text-xs tabular-nums">
                           {format(new Date(mov.createdAt), "dd MMM yyyy")}
                         </TableCell>
                         <TableCell className="text-xs capitalize">
                           <span className="inline-flex items-center gap-1">
                             <ArrowDownLeft className="size-3 text-muted-foreground" />
                             {mov.movementType.replaceAll("_", " ")}
                           </span>
                         </TableCell>
                         <TableCell className="text-xs text-muted-foreground">
                           {mov.creditNoteNumber || mov.notes || "—"}
                         </TableCell>
                         <TableCell className="text-right text-xs font-medium tabular-nums">
                           {formatRupees(mov.amount)}
                         </TableCell>
                         <TableCell className="text-right text-xs font-semibold tabular-nums">
                           {formatRupees(mov.balanceAfter)}
                         </TableCell>
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </div>
             </div>
           )}

           {!lots.length && !refunds.length && !movements.length && (
             <p className="text-xs text-muted-foreground">
               No store credit activity recorded for {customerName ?? "this customer"}.
             </p>
           )}
         </CardContent>

         <ResponsiveDialog
           title="Issue Customer Refund"
           description={`Return unused store credit (${formatRupees(creditBalance)} available) from a company account.`}
           open={refundOpen}
           onOpenChange={setRefundOpen}
           icon={Banknote}
         >
           <form
             onSubmit={(e) => {
               e.preventDefault();
               void submitRefund(false);
             }}
             className="space-y-4"
           >
             <div className="space-y-1.5">
               <Label htmlFor="customer-refund-wallet">Refund account</Label>
               <Select value={walletId} onValueChange={setWalletId}>
                 <SelectTrigger id="customer-refund-wallet" aria-label="Refund account">
                   <SelectValue placeholder="Choose cash or bank account" />
                 </SelectTrigger>
                 <SelectContent>
                   {activeWallets.map((w: any) => (
                     <SelectItem key={w.id} value={w.id}>
                       {w.name} ({formatRupees(w.balance)})
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
             <div className="grid gap-3 sm:grid-cols-2">
               <div className="space-y-1.5">
                 <Label htmlFor="customer-refund-amount">Refund amount</Label>
                 <Input
                   id="customer-refund-amount"
                   value={amountInput}
                   onChange={(e) => setAmountInput(formatAmountInput(e.target.value))}
                   placeholder="0.00"
                 />
               </div>
               <div className="space-y-1.5">
                 <Label htmlFor="customer-refund-date">Refund date</Label>
                 <Input
                   id="customer-refund-date"
                   type="date"
                   value={refundDate}
                   onChange={(e) => setRefundDate(e.target.value)}
                 />
               </div>
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="customer-refund-notes">Notes (optional)</Label>
               <Input
                 id="customer-refund-notes"
                 value={notes}
                 onChange={(e) => setNotes(e.target.value)}
                 placeholder="Receipt / transfer note"
               />
             </div>
             {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
             <div className="flex justify-end gap-2">
               <Button type="button" variant="outline" onClick={() => setRefundOpen(false)}>
                 Cancel
               </Button>
               <Button type="submit" disabled={issueMutation.isPending}>
                 Confirm refund
               </Button>
             </div>
           </form>
         </ResponsiveDialog>

         <OverdrawConfirmDialog
           open={overdrawOpen}
           onOpenChange={setOverdrawOpen}
           walletName={selectedWallet?.name ?? "Selected account"}
           balance={String(selectedWallet?.balance ?? "0")}
           balanceAfter={getBalanceAfter(selectedWallet?.balance ?? "0", Number.isFinite(parsedAmount) ? parsedAmount : 0)}
           onConfirm={() => void submitRefund(true)}
           pending={issueMutation.isPending}
           descriptionLabel="refund"
         />

         <ResponsiveDialog
           title="Reverse Customer Refund"
           description="Restores the company account balance and credits the store credit lot back to active."
           open={Boolean(reversingRefundId)}
           onOpenChange={(o) => {
             if (!o && !reverseMutation.isPending) setReversingRefundId(null);
           }}
           icon={RotateCcw}
         >
           <form
             onSubmit={(e) => {
               e.preventDefault();
               void submitReverse();
             }}
             className="space-y-4"
           >
             <div className="space-y-1.5">
               <Label htmlFor="reverse-refund-reason">Reversal reason</Label>
               <Textarea
                 id="reverse-refund-reason"
                 value={reverseReason}
                 onChange={(e) => setReverseReason(e.target.value)}
                 minLength={3}
                 maxLength={500}
                 placeholder="Why is this refund being reversed?"
               />
             </div>
             {reverseError && <p role="alert" className="text-xs text-destructive">{reverseError}</p>}
             <div className="flex justify-end gap-2">
               <Button type="button" variant="outline" onClick={() => setReversingRefundId(null)}>
                 Cancel
               </Button>
               <Button type="submit" variant="destructive" disabled={reverseMutation.isPending}>
                 Confirm reversal
               </Button>
             </div>
           </form>
         </ResponsiveDialog>
       </Card>
     );
   }
   ```

2. **Mount `<CustomerCreditSection>` on all 3 customer/partner profile routes**:
   - `src/routes/_protected/sales/people/distributors/$customerId/index.tsx`: render `<CustomerCreditSection customerId={customerId} customerName={customer.name} />` below Info Cards (before Default Margin) + add a subtle emerald Store Credit pill/KPI if `Number(customer.creditBalance ?? 0) > 0`.
   - `src/routes/_protected/sales/people/shopkeepers/$customerId/index.tsx`: render `<CustomerCreditSection customerId={customerId} customerName={customer.name} />` below Info Cards.
   - `src/routes/_protected/sales/customers/$customerId/index.tsx`:
     - Render `<CustomerCreditSection customerId={customerId} customerName={customer.name} />` cleanly below the overdue alert / balance row! (Double-check this file NEVER contains `"Record Payment"`, `"RecordPaymentDialog"`, or `"setPaymentDialogOpen"` so `sales-workflows.test.ts:437-440` keeps passing!).
     - In `PrintExportToolbar` (`line 206`): filter out `p.method === "customer_credit"` (or keep balance unchanged on store credit rows) so exported running balance doesn't double-subtract.

3. **Customers list & KPI cards**:
   - `src/components/sales/customer-kpi-cards.tsx`: add a 5th card in `cards`:
     ```ts
     {
       key: "totalCustomerCredit",
       label: "Total Store Credit",
       icon: Wallet,
       format: PKR,
       theme: "violet",
     }
     ```
     and update grid class to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4`.
   - `src/components/sales/customers-table.tsx` (`line 106`): add a `Store Credit` column (`accessorKey: "creditBalance"`, showing green badge if `> 0`, `"—"` otherwise).
   - `src/routes/_protected/sales/customers/index.tsx` (`line 172` & `line 262`): add `<TableHead className="text-[11px] text-right">Store Credit</TableHead>` + matching `<TableCell>` displaying emerald `PKR(Number(customer.creditBalance ?? 0))` when `> 0`, else `"—"`.

4. **`src/components/sales/ledger-print-export.tsx`**:
   > PRESERVE `if (entry.type === "payment")` + `return entry.amount` (`src/lib/sales-workflows.test.ts:267-269`) and `RET-N` / `VOID-N` Vr. No (`src/__tests__/ledger-return-rendering.test.tsx:61-62,82-83`)!
   - Update `getDebitAmount`:
     ```ts
     const getDebitAmount = (entry: LedgerEntry) => {
       if (entry.type === "return") {
         return entry.eventKind === "return" ? entry.amount : 0;
       }
       if (entry.type === "refund") {
         return entry.eventKind === "refund_reversal" ? entry.amount : 0;
       }
       if (entry.type === "payment") {
         if (entry.isStoreCreditApplied || entry.method === "customer_credit") return 0;
         return entry.amount;
       }
       return 0;
     };
     ```
   - Update `getCreditAmount`:
     ```ts
     const getCreditAmount = (entry: LedgerEntry) => {
       if (entry.type === "invoice") return entry.totalPrice;
       if (entry.type === "return" && entry.eventKind === "void") return entry.amount;
       if (entry.type === "refund" && entry.eventKind === "refund") return entry.amount;
       return 0;
     };
     ```
   - In both `handlePrintDocument` AND `handleCSV`:
     - Handle `const isRefund = entry.type === "refund";`
     - `isReturn`: keep `vrNo = ${entry.eventKind === "void" ? "VOID" : "RET"}-${entry.returnNumber ?? "—"}`, keep `"Sales Return..."` / `"RET-..."`, and include `${entry.creditNoteNumber ? \` · CN: ${entry.creditNoteNumber}\` : ""}` inside `subDesc` / CSV `desc`.
     - `isRefund`:
       - `vrNo = entry.creditNoteNumber ? \`REF-${entry.creditNoteNumber}\` : \`REF-${entry.id.slice(-6).toUpperCase()}\``
       - `titleDesc` = `${entry.eventKind === "refund_reversal" ? "Customer Refund Reversal" : "Customer Refund"}${entry.walletName ? \` (${entry.walletName})\` : ""}`
       - `subDesc` includes `${entry.creditNoteNumber ? \`CN: ${entry.creditNoteNumber} · \` : ""}${entry.reverseReason ? \`Reason: ${entry.reverseReason}\` : (entry.notes ?? "")}`
     - `pay?.isStoreCreditApplied || pay?.method === "customer_credit"`:
       - `titleDesc` = `"Store Credit Applied"`
       - `subDesc` = `Invoice #${entry.invoiceNumber} · Settled from Store Credit (${fmtPKR(pay.amount)} applied; no cash movement)` (with both HTML Debit/Credit rendered as `"0.00"` and CSV Debit/Credit as `""`).

5. **All 4 ledger routes**:
   - `src/routes/_protected/sales/people/distributors/$customerId/ledger.tsx` and `src/routes/_protected/sales/people/shopkeepers/$customerId/ledger.tsx`:
     - Add `<SelectItem value="refund">Refunds Only</SelectItem>` to Type `<SelectContent>`.
     - Show Customer Store Credit badge in header if `Number(customer?.creditBalance ?? 0) > 0`.
     - Update `LedgerTableRow` (remember col 3 = `Debit` debt-DECREASING, col 4 = `Credit` debt-INCREASING):
       - Add `const isRefund = entry.type === "refund";` and `const isCreditApplied = entry.type === "payment" && (Boolean(entry.isStoreCreditApplied) || entry.method === "customer_credit");`
       - Return rows: show `entry.creditNoteNumber` badge beneath return title if present.
       - Refund rows: show `Customer Refund` / `Customer Refund Reversal`, `walletName`, `creditNoteNumber`, `notes` / `reverseReason`; Debit shows `formatPKR(entry.amount, false)` on `refund_reversal`, Credit shows `formatPKR(entry.amount, false)` on `refund`.
       - Store-credit payment rows (`isCreditApplied`): show `"Store Credit Applied"` badge + `${formatPKR(entry.amount, false)} applied (no cash movement)` note, and render `"—"` in BOTH Debit & Credit cells!
   - `src/routes/_protected/sales/people/salesmen/$salesmanId/ledger.tsx`:
     - Add `<SelectItem value="refund">Refunds Only</SelectItem>` to Type `<SelectContent>`.
     - Update `LedgerTableRow` (NOTE column order on salesman ledger: col 4 = `Debit` debt-INCREASING, col 5 = `Credit` debt-DECREASING!):
       - `refund`: Debt-increasing -> renders in col 4 (`Debit`), `"—"` in col 5.
       - `refund_reversal`: Debt-decreasing -> renders `"—"` in col 4, amount in col 5 (`Credit`).
       - `isCreditApplied`: renders `"Store Credit"` badge + applied note, and `"—"` in BOTH col 4 & col 5!
   - `src/routes/_protected/sales/people/salesmen/$salesmanId/shops/$customerId.tsx`:
     - Update inline row mapping (col 3 = debt-INCREASING, col 4 = debt-DECREASING) for `"refund"`, `"refund_reversal"`, `"return"` void, and zero-cash `"customer_credit"` payments.

- [ ] **Step 4: Run tests & typecheck**

Run: `bun run test src/__tests__/customer-credit-section.behavior.test.tsx src/__tests__/ledger-return-rendering.test.tsx src/lib/sales-workflows.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/customer-credit-section.tsx src/routes/_protected/sales/customers/\$customerId/index.tsx src/routes/_protected/sales/people/distributors/\$customerId/index.tsx src/routes/_protected/sales/people/shopkeepers/\$customerId/index.tsx src/components/sales/customer-kpi-cards.tsx src/components/sales/customers-table.tsx src/routes/_protected/sales/customers/index.tsx src/components/sales/ledger-print-export.tsx src/routes/_protected/sales/people/distributors/\$customerId/ledger.tsx src/routes/_protected/sales/people/shopkeepers/\$customerId/ledger.tsx src/routes/_protected/sales/people/salesmen/\$salesmanId/ledger.tsx src/routes/_protected/sales/people/salesmen/\$salesmanId/shops/\$customerId.tsx src/__tests__/customer-credit-section.behavior.test.tsx src/__tests__/ledger-return-rendering.test.tsx
git commit -m "feat(profiles-ledgers): add store credit profiles, refund workflows, and credit/refund ledger displays"
```

---

## Task 10: Final Verification, Migration Run, Browser E2E QA Matrix & Knowledge Graph Update

**Files:**
- Verify all touched files + database migration + build + tests
- Update: `graphify-out/` (via `graphify update .`)

- [ ] **Step 1: Full static verification (typecheck, full Vitest suite, production build)**

Run cleanly in sequence:
```bash
bun run typecheck
bun run test
bun run build
```
Expected: ZERO TypeScript errors, 100% of Vitest specs PASS, production `.output/` build succeeds cleanly with zero missing imports or top-level `@/db` client bundling failures.

- [ ] **Step 2: Database migration & integrity checks**

Verify PostgreSQL is running (port `5433`), apply all generated migrations, and confirm NO manual edits touched older migrations or `/order-booker/` routes:
```bash
bun run db:migrate
git diff --stat origin/main -- src/routes/_protected/order-booker/ src/server-functions/sales/order-booker-self-service-fn.ts src/hooks/sales/use-order-booker-self-service.ts src/components/order-booker/
```
Expected:
- `bun run db:migrate` completes cleanly with `credit_note_counters`, `customer_credit_lots`, `customer_credit_payment_allocations`, `customer_refunds`, `customer_refund_allocations`, `customer_credit_movements`, and altered `customers`, `invoices`, `slip_records`, `sales_returns`, `payments` present.
- `/order-booker/` diff is completely empty.

- [ ] **Step 3: Live end-to-end QA matrix against dev server (`bun run dev`)**

Test all 10 scenarios cleanly in browser / running database:
1. Unpaid invoice partial return -> CN issued -> `appliedToInvoiceAmount = returnTotal`, `customerCreditAmount = 0`.
2. Overpaid invoice return (e.g. PKR 10,000 invoice paid PKR 10,000 cash, return PKR 4,000) -> CN issued -> `customerCreditAmount = PKR 4,000`, `customers.credit_balance = 4,000`, `customers.outstanding_amount = 0`.
3. Screen 4 Keep as Store Credit + Print Credit Note -> Print dialog shows formal CN with split & A4 layout.
4. Second invoice settled via `"Apply Store Credit"` -> creates `"customer_credit"` payment row, FIFO consumes credit lot, zero wallet balance change, Daily Closing shows Store Credit Applied separately from Cash/Bank.
5. Reverse Store Credit payment in Payment Verification -> restores lot balance & `customers.credit_balance`.
6. Issue Cash/Bank Refund from Customer Profile -> creates `customer_refunds` row, debits wallet (triggers `OverdrawConfirmDialog` on low balance), P&L reconciliation shows refund outside operating expenses, customer chronological ledger recovers running balance toward 0.
7. Attempt to Void a return whose Credit Note credit was refunded -> blocked with `VOID_BLOCKED_BY_REFUND` message + customer profile `<Link>`.
8. Reverse Refund first -> then Void the return -> succeeds cleanly, voids CN, removes credit lot & restores invoice numbers cleanly.
9. Batch Recoveries with multiple selected slips belonging to the same customer -> enforces cumulative store credit cap across rows.
10. Over-recovery cash payment (> invoice total) -> excess settles invoice cleanly + deposits overage into Store Credit.

- [ ] **Step 4: Keep code knowledge graph current**

Run:
```bash
graphify update .
```

- [ ] **Step 5: Final git status & commit verification**

Ensure working tree has zero unintended changes, only committed feature work on `feat/returns-phase-4-credit-notes` (with `docker-compose.yml` and `docs/Monthly Report.xlsx` left untouched unless requested).
