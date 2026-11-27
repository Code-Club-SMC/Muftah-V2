# Recovery-Based Order Booker Commission (Returns Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order bookers earn commission only when customer money for their order is actually confirmed, only on that amount, at a rate locked when the order is delivered.

**Architecture:** The rate is locked on the order at delivery (two new order columns). A new append-only ledger table, `commission_earnings`, gets one row per confirmed payment (positive), reversed payment (negative, unless the company bears it), and return that pushes collected money above what is owed (negative, undone if the return is voided). One server module, `recovery-commission-service.ts`, owns every write and is called from the existing settlement and returns code inside the same database transactions. Payroll sums all unpaid ledger rows up to the end of the pay period. If the total is negative, the payslip shows 0 and the rows wait for the next payslip; that is the carry-forward. Old delivery commission is moved over lazily, per order, so nothing depends on a one-time script.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, React + shadcn/ui, TanStack Query, Vitest (jsdom unit tests + `vitest.integration.config.ts` against `titan_test`).

**Spec:** `docs/superpowers/specs/2026-10-27-recovery-based-commission-spec.md` (parent: `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md`, phase 6)

## Global Constraints

- Generated migrations are immutable: never edit SQL, snapshots or `meta/_journal.json` under `src/db/migrations/`. Change the schema source and run `bun run db:generate`.
- Production has real data. Every new column is nullable or has a default, and old rows must keep working.
- The order booker self-service portal (`src/routes/_protected/order-booker/`, `src/server-functions/sales/order-booker-self-service-fn.ts`, `src/hooks/sales/use-order-booker-self-service.ts`, `src/components/order-booker/`) is out of scope. Do not touch it.
- Money is rounded to 2 decimals with `roundMoney` from `@/lib/sales/settlement/money`. Locked rates keep 4 decimals.
- Rule: nothing is ever earned on delivery. Commission is earned only on recovered money, and never twice for the same rupee.
- Earning methods: `cash`, `bank_transfer`, `cheque` (only once confirmed/cleared) and `expense_offset`. `customer_credit` never earns. Payments that are pending, returned or cancelled never earn.
- Commission month = the payment's `effectiveDate` (or the reversal/return date for negative rows).
- Browser-facing server functions keep `@/db` dynamically imported (`const { db } = await import("@/db")`) like `payment-settlement-fn.ts`.
- UI copy is plain English, in the spec's words: "Deduct from booker", "Company bears the loss", "Commission on recoveries", "Deductions (reversed payments)", "carried forward", "Delivered", "Returned", "Collected", "Earned", "Still owed", "Waiting".
- Branch: these changes touch files changed by phase 5 (`sales-returns-fn.ts`), so start a new branch `feat/commission-phase-6` from `feat/returns-phase-5-tasks-4-6`, or from `main` once phase 5 is merged.

## Decisions taken while checking the spec against the code (2026-11-26)

1. **Paid, then returned (user decision).** If a return makes the money already collected bigger than what the customer now owes, the commission on the difference is taken back. A negative row is dated on the day the return completes, and the normal carry-forward applies. Voiding the return adds the row back.
   Example: Rs 1,00,000 paid at 2% earns Rs 2,000. A Rs 30,000 return completes, so a −Rs 600 row is added. Voiding the return adds +Rs 600.
2. **"Owed" means invoice total minus the value of completed returns**, which is the sum of `sales_returns.total_amount` for completed returns. It is not `applied_to_invoice_amount`, because that leaves out the part that went to store credit.
3. **Locked rate = the effective rate**: total slab commission ÷ delivered amount × 100, from `calculateOrderBookerCommission(...).effectiveRate`, stored with 4 decimals. A fully paid order earns the same total as the old delivery commission did.
4. **Company bears the loss** still writes a ledger row (kind `payment_reversal`, bearer `company`, amount 0, base 0), so the choice and who made it are on record. Because the base stays counted, a replacement payment for the same money earns nothing. The booker already kept that commission, so this prevents earning twice.
5. **Orders delivered with the salesman "Fulfill" button and invoiced later** lock their rate at fulfil time. Payments on the later invoice earn at that rate. Orders with no invoice never earn, because no payment can be recorded against them.
6. **Old orders move over lazily** the first time anything touches their commission, and in bulk before payroll and the commission screens read:
   - Unpaid (`accrued`) delivery record: set its status to `cancelled` and lock the rate (mode `recovery`).
   - Already paid (`paid`) record: mode `delivery_paid`, earns nothing more.
   - Delivered with no record: mode `suppressed`, earns nothing.
   No old payment is back-filled. Only payments confirmed after release earn.
7. **Payroll carry-forward**: a payslip takes every unpaid ledger row dated before the end of the pay period. If the total is above 0, it is paid and all those rows are marked paid. If the total is 0 or below, the payslip commission is 0, the rows stay unpaid, and the shortfall shows as "carried forward". Old `accrued` delivery records that are still in the period (only possible when a pre-release payslip is deleted) are still paid as before.
8. **Invoice edits** don't change ledger rows, which matches today: invoice edits don't recompute commission either. Payments can never exceed the net invoice, so the cap check on each new payment covers this.

## File map

| Area | File | Responsibility |
|---|---|---|
| Money rules (pure) | `src/lib/order-booker/recovery-commission.ts` (create) | Which methods earn, earnable base, clawback base, row amount, payslip settlement, month summary maths, payslip breakdown type |
| Money rules tests | `src/lib/order-booker/recovery-commission.test.ts` (create) | Unit tests for every rule |
| Schema | `src/db/schemas/sales-erp-schema.ts` (modify) | `orders.commission_mode`, `orders.commission_rate_locked`, new `commission_earnings` table + relations |
| Schema test | `src/db/schemas/commission-earnings-schema.test.ts` (create) | Column and index shape |
| Ledger service | `src/server-functions/sales/recovery-commission-service.ts` (create) | Lock terms, legacy switch, earn, reverse, return clawback/undo, payslip collect/mark/unmark, payment commission lookup |
| Delivery hooks | `src/server-functions/sales/invoice-posting-service.ts`, `src/server-functions/sales/orders-fn.ts` (modify) | Lock terms instead of writing delivery commission |
| Settlement hooks | `src/server-functions/sales/settlement-service.ts`, `src/server-functions/sales/payment-settlement-fn.ts` (modify) | Earn on confirm, reverse with bearer |
| Returns hooks | `src/server-functions/sales/sales-returns-fn.ts` (modify) | Clawback on complete, undo on void |
| Payroll | `src/server-functions/hr/payroll/core.ts`, `src/server-functions/hr/payroll/sales-performance-fn.ts`, `src/db/schemas/hr-schema.ts` (modify) | Read ledger, carry forward, snapshot breakdown, reset on payslip delete |
| Readers | `src/server-functions/sales/recovery-commission-fn.ts` (create), `src/hooks/sales/use-recovery-commission.ts` (create) | Month summary, per-booker month detail, payment commission lookup |
| Screens | `src/components/sales/commission/commission-summary.tsx`, `src/components/sales/commission/booker-commission-tab.tsx` (create); `src/routes/_protected/sales/people/index.tsx`, `src/routes/_protected/sales/people/order-bookers/$orderBookerId/index.tsx` (modify) | Summary table, Commission tab |
| Screens | `src/components/finance/payment-verification-page.tsx`, `src/hooks/sales/use-payment-settlement.ts`, `src/components/hr/payroll/payslip-view.tsx` (modify) | "Who bears it?" question, payslip lines |
| Integration tests | `src/__tests__/integration/recovery-commission.test.ts` (create) | Behaviour 1–12 from the spec, against a real database |
| UI tests | `src/__tests__/commission-screens.behavior.test.tsx`, `src/__tests__/payment-reversal-commission.behavior.test.tsx`, `src/__tests__/payslip-commission.behavior.test.tsx` (create) | Screen behaviour |

---

### Task 1: Money rules (pure functions)

**Files:**
- Create: `src/lib/order-booker/recovery-commission.ts`
- Test: `src/lib/order-booker/recovery-commission.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–10):
  - `type CommissionMode = "recovery" | "suppressed" | "delivery_paid"`
  - `type CommissionEntryKind = "payment" | "payment_reversal" | "return_clawback" | "return_clawback_undo"`
  - `paymentEarnsCommission(method: string): boolean`
  - `commissionAmount(base: number, rate: number): number` (rounded to 2 decimals, keeps the sign of `base`)
  - `earnableBase(input: { paymentAmount: number; owed: number; commissionedBase: number }): number`
  - `clawbackBase(input: { owed: number; commissionedBase: number }): number`
  - `settlePayslipCommission(entries: Array<{ amount: number }>): PayslipCommissionSettlement` where `PayslipCommissionSettlement = { earned: number; deductions: number; net: number; payable: number; carriedForward: number; paysEntries: boolean }`
  - `type RecoveryCommissionBreakdown = { kind: "recovery"; paymentsCount: number; earned: number; deductions: number; carriedForward: number; lines: Array<{ entryDate: string; invoiceNumber: string; kind: CommissionEntryKind; base: number; rate: number; amount: number }> }`
  - `type LegacyCommissionLine = { orderId: string; orderRef: string; orderDate: string; orderValue: number; rate: number; amount: number }`
  - `type PayslipCommissionBreakdown = LegacyCommissionLine[] | RecoveryCommissionBreakdown`
  - `summarizeBookerMonth(input: BookerMonthInput): BookerMonthSummary`. The full types are in the code below.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/order-booker/recovery-commission.test.ts
import { describe, expect, it } from "vitest";
import {
  clawbackBase,
  commissionAmount,
  earnableBase,
  paymentEarnsCommission,
  settlePayslipCommission,
  summarizeBookerMonth,
} from "./recovery-commission";

describe("recovery commission money rules", () => {
  it("earns on cash, bank, cheque and expense offsets but never on store credit", () => {
    expect(["cash", "bank_transfer", "cheque", "expense_offset"].map(paymentEarnsCommission)).toEqual([true, true, true, true]);
    expect(paymentEarnsCommission("customer_credit")).toBe(false);
  });

  it("rounds commission to paisa and keeps the sign", () => {
    expect(commissionAmount(200000, 2)).toBe(4000);
    expect(commissionAmount(-30000, 2)).toBe(-600);
    expect(commissionAmount(333.33, 1.5)).toBe(5);
    expect(commissionAmount(100000, 1.8333)).toBe(1833.3);
  });

  it("caps the earning base at what is still owed and never goes below zero", () => {
    expect(earnableBase({ paymentAmount: 40000, owed: 100000, commissionedBase: 0 })).toBe(40000);
    expect(earnableBase({ paymentAmount: 60000, owed: 100000, commissionedBase: 70000 })).toBe(30000);
    expect(earnableBase({ paymentAmount: 10000, owed: 70000, commissionedBase: 100000 })).toBe(0);
  });

  it("takes back only what was commissioned above what is now owed", () => {
    expect(clawbackBase({ owed: 70000, commissionedBase: 100000 })).toBe(30000);
    expect(clawbackBase({ owed: 70000, commissionedBase: 50000 })).toBe(0);
  });

  it("pays a positive month and carries a negative one forward", () => {
    expect(settlePayslipCommission([{ amount: 4000 }, { amount: 8400 }, { amount: -600 }])).toEqual({
      earned: 12400, deductions: 600, net: 11800, payable: 11800, carriedForward: 0, paysEntries: true,
    });
    // Spec example: Rs 4,000 bounces in November when Rs 1,000 was earned.
    expect(settlePayslipCommission([{ amount: 1000 }, { amount: -4000 }])).toEqual({
      earned: 1000, deductions: 4000, net: -3000, payable: 0, carriedForward: 3000, paysEntries: false,
    });
    // December earns Rs 10,000 with the Rs 3,000 still waiting: pays Rs 7,000.
    expect(settlePayslipCommission([{ amount: 1000 }, { amount: -4000 }, { amount: 10000 }]).payable).toBe(7000);
    expect(settlePayslipCommission([])).toEqual({ earned: 0, deductions: 0, net: 0, payable: 0, carriedForward: 0, paysEntries: false });
  });

  it("summarizes a booker month from invoice, return, payment and ledger rows", () => {
    const monthStart = new Date("2026-10-01T00:00:00+05:00");
    const monthEnd = new Date("2026-10-31T23:59:59.999+05:00");
    const summary = summarizeBookerMonth({
      monthStart,
      monthEnd,
      invoices: [
        { id: "a", date: new Date("2026-10-05T10:00:00+05:00"), totalPrice: 500000, mode: "recovery", rate: 2 },
        { id: "b", date: new Date("2026-09-20T10:00:00+05:00"), totalPrice: 100000, mode: "suppressed", rate: null },
      ],
      returns: [
        { invoiceId: "a", totalAmount: 100000, completedAt: new Date("2026-10-25T10:00:00+05:00"), voidedAt: null },
      ],
      payments: [
        { invoiceId: "a", amount: 200000, method: "cash", status: "confirmed", effectiveDate: new Date("2026-10-20T10:00:00+05:00"), reversedAt: null },
        { invoiceId: "b", amount: 50000, method: "bank_transfer", status: "confirmed", effectiveDate: new Date("2026-10-03T10:00:00+05:00"), reversedAt: null },
        { invoiceId: "a", amount: 5000, method: "customer_credit", status: "confirmed", effectiveDate: new Date("2026-10-21T10:00:00+05:00"), reversedAt: null },
      ],
      entries: [{ amount: 4000, entryDate: new Date("2026-10-20T10:00:00+05:00") }],
    });
    expect(summary).toEqual({
      delivered: 500000, returned: 100000, collected: 250000, earned: 4000,
      stillOwed: 245000, waiting: 3900,
    });
  });
});
```

The month summary numbers above, worked out:
- Delivered: only invoice `a` is dated in October, so 5,00,000.
- Collected: 2,00,000 + 50,000. Store credit doesn't count.
- Still owed for `a`: 5,00,000 − 1,00,000 (return) − 2,00,000 − 5,000 (store credit clears debt too) = 1,95,000.
- Still owed for `b`: 1,00,000 − 50,000 = 50,000. Total still owed: 2,45,000.
- Waiting: only `a` is in recovery mode, so 1,95,000 × 2% = 3,900.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/order-booker/recovery-commission.test.ts`
Expected: FAIL with "Failed to resolve import "./recovery-commission"".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/order-booker/recovery-commission.ts
import { roundMoney } from "@/lib/sales/settlement/money";

export type CommissionMode = "recovery" | "suppressed" | "delivery_paid";
export type CommissionEntryKind = "payment" | "payment_reversal" | "return_clawback" | "return_clawback_undo";
export type CommissionBearer = "booker" | "company";

const EARNING_METHODS = new Set(["cash", "bank_transfer", "cheque", "expense_offset"]);

/** Store credit is not new money, so it never earns. */
export function paymentEarnsCommission(method: string): boolean {
  return EARNING_METHODS.has(method);
}

export function commissionAmount(base: number, rate: number): number {
  return roundMoney((base * rate) / 100);
}

/** Commission is earned only up to what the customer really owes (invoice total minus returns). */
export function earnableBase(input: { paymentAmount: number; owed: number; commissionedBase: number }): number {
  const room = roundMoney(Math.max(0, input.owed - input.commissionedBase));
  return roundMoney(Math.max(0, Math.min(input.paymentAmount, room)));
}

/** After a return, money already commissioned above what is now owed is taken back. */
export function clawbackBase(input: { owed: number; commissionedBase: number }): number {
  return roundMoney(Math.max(0, input.commissionedBase - input.owed));
}

export type PayslipCommissionSettlement = {
  earned: number;
  deductions: number;
  net: number;
  payable: number;
  carriedForward: number;
  paysEntries: boolean;
};

/** A negative month pays 0 and its rows wait for the next payslip. */
export function settlePayslipCommission(entries: Array<{ amount: number }>): PayslipCommissionSettlement {
  const earned = roundMoney(entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0));
  const deductions = roundMoney(-entries.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0));
  const net = roundMoney(earned - deductions);
  return {
    earned,
    deductions,
    net,
    payable: net > 0 ? net : 0,
    carriedForward: net < 0 ? roundMoney(-net) : 0,
    paysEntries: net > 0,
  };
}

export type LegacyCommissionLine = { orderId: string; orderRef: string; orderDate: string; orderValue: number; rate: number; amount: number };
export type RecoveryCommissionBreakdown = {
  kind: "recovery";
  paymentsCount: number;
  earned: number;
  deductions: number;
  carriedForward: number;
  lines: Array<{ entryDate: string; invoiceNumber: string; kind: CommissionEntryKind; base: number; rate: number; amount: number }>;
};
export type PayslipCommissionBreakdown = LegacyCommissionLine[] | RecoveryCommissionBreakdown;

export function isRecoveryBreakdown(value: unknown): value is RecoveryCommissionBreakdown {
  return Boolean(value) && !Array.isArray(value) && (value as { kind?: string }).kind === "recovery";
}

export type BookerMonthInput = {
  monthStart: Date;
  monthEnd: Date;
  invoices: Array<{ id: string; date: Date; totalPrice: number; mode: CommissionMode | null; rate: number | null }>;
  returns: Array<{ invoiceId: string; totalAmount: number; completedAt: Date; voidedAt: Date | null }>;
  payments: Array<{ invoiceId: string; amount: number; method: string; status: string; effectiveDate: Date | null; reversedAt: Date | null }>;
  entries: Array<{ amount: number; entryDate: Date }>;
};
export type BookerMonthSummary = { delivered: number; returned: number; collected: number; earned: number; stillOwed: number; waiting: number };

const within = (date: Date | null, from: Date, to: Date) => Boolean(date) && date!.getTime() >= from.getTime() && date!.getTime() <= to.getTime();
const byEnd = (date: Date | null, end: Date) => Boolean(date) && date!.getTime() <= end.getTime();

export function summarizeBookerMonth(input: BookerMonthInput): BookerMonthSummary {
  const { monthStart, monthEnd } = input;
  const delivered = input.invoices.filter((i) => within(i.date, monthStart, monthEnd)).reduce((s, i) => s + i.totalPrice, 0);
  const returned = input.returns
    .filter((r) => within(r.completedAt, monthStart, monthEnd) && !byEnd(r.voidedAt, monthEnd))
    .reduce((s, r) => s + r.totalAmount, 0);
  const counted = (p: BookerMonthInput["payments"][number]) => p.status === "confirmed" || p.status === "reversed";
  const collected = input.payments
    .filter((p) => counted(p) && paymentEarnsCommission(p.method) && within(p.effectiveDate, monthStart, monthEnd))
    .reduce((s, p) => s + p.amount, 0);
  const earned = input.entries.filter((e) => within(e.entryDate, monthStart, monthEnd)).reduce((s, e) => s + e.amount, 0);

  let stillOwed = 0;
  let waiting = 0;
  for (const invoice of input.invoices.filter((i) => byEnd(i.date, monthEnd))) {
    const returnedByEnd = input.returns
      .filter((r) => r.invoiceId === invoice.id && byEnd(r.completedAt, monthEnd) && !byEnd(r.voidedAt, monthEnd))
      .reduce((s, r) => s + r.totalAmount, 0);
    const paidByEnd = input.payments
      .filter((p) => p.invoiceId === invoice.id && counted(p) && byEnd(p.effectiveDate, monthEnd) && !byEnd(p.reversedAt, monthEnd))
      .reduce((s, p) => s + p.amount, 0);
    const owed = roundMoney(Math.max(0, invoice.totalPrice - returnedByEnd - paidByEnd));
    stillOwed += owed;
    if (invoice.mode === "recovery" && invoice.rate) waiting += commissionAmount(owed, invoice.rate);
  }
  return {
    delivered: roundMoney(delivered),
    returned: roundMoney(returned),
    collected: roundMoney(collected),
    earned: roundMoney(earned),
    stillOwed: roundMoney(stillOwed),
    waiting: roundMoney(waiting),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/order-booker/recovery-commission.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-booker/recovery-commission.ts src/lib/order-booker/recovery-commission.test.ts
git commit -m "feat(commission): recovery-based commission money rules (phase 6)"
```

---

### Task 2: Schema: locked rate on orders and the commission ledger

**Files:**
- Modify: `src/db/schemas/sales-erp-schema.ts` (orders table near line 362; new table after `commissionRecords` near line 487; relations near line 702)
- Modify: `src/db/schemas/hr-schema.ts:515-522` (`commissionBreakdown` type only)
- Create: `src/db/schemas/commission-earnings-schema.test.ts`
- Generated: one new migration under `src/db/migrations/` from `bun run db:generate` (never hand-edited)

**Interfaces:**
- Consumes: `CommissionMode`, `CommissionEntryKind`, `CommissionBearer`, `PayslipCommissionBreakdown` from Task 1.
- Produces: `orders.commissionMode`, `orders.commissionRateLocked`, table export `commissionEarnings` (columns: `id`, `orderBookerId`, `orderId`, `invoiceId`, `paymentId`, `salesReturnId`, `kind`, `bearer`, `baseAmount`, `rate`, `amount`, `entryDate`, `paidInPayslipId`, `createdById`, `note`, `createdAt`), relation `commissionEarningsRelations`. `commission_records.status` also accepts `"cancelled"`. It's a text column, so the schema doesn't change.

- [ ] **Step 1: Write the failing test**

```ts
// src/db/schemas/commission-earnings-schema.test.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { commissionEarnings, orders } from "./sales-erp-schema";

describe("recovery commission schema", () => {
  it("locks the commission terms on the order, both optional for existing rows", () => {
    const columns = getTableConfig(orders).columns;
    const mode = columns.find((c) => c.name === "commission_mode")!;
    const rate = columns.find((c) => c.name === "commission_rate_locked")!;
    expect(mode.notNull).toBe(false);
    expect(rate.notNull).toBe(false);
    expect(rate.getSQLType()).toBe("numeric(7, 4)");
  });

  it("stores one ledger row per payment event and per return event", () => {
    const config = getTableConfig(commissionEarnings);
    expect(config.name).toBe("commission_earnings");
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      "amount", "base_amount", "bearer", "created_at", "created_by_id", "entry_date", "id", "invoice_id", "kind",
      "note", "order_booker_id", "order_id", "paid_in_payslip_id", "payment_id", "rate", "sales_return_id",
    ]);
    const unique = config.indexes.filter((i) => i.config.unique).map((i) => i.config.name).sort();
    expect(unique).toEqual(["commission_earnings_payment_kind_unique", "commission_earnings_return_kind_unique"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/db/schemas/commission-earnings-schema.test.ts`
Expected: FAIL with "commissionEarnings" not exported / undefined.

- [ ] **Step 3: Write the schema**

In `src/db/schemas/sales-erp-schema.ts`, add to the `orders` columns (after `fulfilledAmount`):

```ts
  // Recovery-based commission (phase 6): locked once, when the order is first delivered.
  // null = not delivered yet, or an old order not yet moved over (see recovery-commission-service).
  commissionMode: text("commission_mode", { enum: ["recovery", "suppressed", "delivery_paid"] }),
  commissionRateLocked: decimal("commission_rate_locked", { precision: 7, scale: 4 }),
```

Add after the `commissionRecords` table:

```ts
// --- COMMISSION EARNINGS (recovery-based ledger, phase 6) ---
// Append-only. Corrections are new rows, never edits (except paid_in_payslip_id).
export const commissionEarnings = pgTable("commission_earnings", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  orderBookerId: text("order_booker_id").notNull().references(() => orderBookers.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  paymentId: text("payment_id").references(() => payments.id),
  salesReturnId: text("sales_return_id").references(() => salesReturns.id),
  kind: text("kind", { enum: ["payment", "payment_reversal", "return_clawback", "return_clawback_undo"] }).notNull(),
  bearer: text("bearer", { enum: ["booker", "company"] }),
  baseAmount: decimal("base_amount", { precision: 12, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 7, scale: 4 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull(),
  paidInPayslipId: text("paid_in_payslip_id"),
  createdById: text("created_by_id").references(() => user.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  paymentKindUnique: uniqueIndex("commission_earnings_payment_kind_unique")
    .on(table.paymentId, table.kind)
    .where(sql`${table.paymentId} is not null`),
  returnKindUnique: uniqueIndex("commission_earnings_return_kind_unique")
    .on(table.salesReturnId, table.kind)
    .where(sql`${table.salesReturnId} is not null`),
  bookerDateIdx: index("commission_earnings_booker_date_idx").on(table.orderBookerId, table.entryDate),
  invoiceIdx: index("commission_earnings_invoice_idx").on(table.invoiceId),
  unpaidIdx: index("commission_earnings_unpaid_idx").on(table.orderBookerId).where(sql`${table.paidInPayslipId} is null`),
}));
```

`invoices` lives in `sales-schema.ts`. Check the existing imports at the top of `sales-erp-schema.ts`: `payments` already references `invoices`, so the import is there. `salesReturns` is defined in the same file. If it's declared below `commissionEarnings`, move the new table under `salesReturns` instead. The arrow-function references already allow forward references, but keep the file order readable. Make sure `uniqueIndex`, `index` and `sql` are imported. They're used by `payments`.

Add relations next to `commissionRecordsRelations`:

```ts
export const commissionEarningsRelations = relations(commissionEarnings, ({ one }) => ({
  orderBooker: one(orderBookers, { fields: [commissionEarnings.orderBookerId], references: [orderBookers.id] }),
  order: one(orders, { fields: [commissionEarnings.orderId], references: [orders.id] }),
  invoice: one(invoices, { fields: [commissionEarnings.invoiceId], references: [invoices.id] }),
  payment: one(payments, { fields: [commissionEarnings.paymentId], references: [payments.id] }),
}));
```

Update the status comment on `commissionRecords.status` to `// "accrued" | "paid" | "reversed" | "cancelled" (cancelled = unpaid delivery commission dropped at the phase 6 switch-over)`.

In `src/db/schemas/hr-schema.ts`, change the `commissionBreakdown` type (the jsonb column itself stays the same):

```ts
  commissionBreakdown: jsonb("commission_breakdown").$type<PayslipCommissionBreakdown>(),
```

with `import type { PayslipCommissionBreakdown } from "@/lib/order-booker/recovery-commission";`. Update the comment above it: old payslips hold the per-order array, new ones hold `{ kind: "recovery", ... }`.

Export the new table from `src/db/index.ts` if that file lists tables one by one (check how `commissionRecords` is exported there and do the same).

- [ ] **Step 4: Generate the migration and run the test**

Run: `bun run db:generate`
Expected: one new SQL file. It adds 2 nullable columns to `orders` and creates `commission_earnings` with foreign keys and 5 indexes. It doesn't touch any other table. Read the generated SQL. If it changes anything else, stop and fix the schema source. Never edit the SQL.

Run: `bunx vitest run src/db/schemas/commission-earnings-schema.test.ts && bun run typecheck`
Expected: PASS, no type errors. Payslip code that builds the old array still type-checks, because the type is a union.

Run: `DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test`
Expected: migrations applied to `titan_test`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schemas/sales-erp-schema.ts src/db/schemas/hr-schema.ts src/db/schemas/commission-earnings-schema.test.ts src/db/index.ts src/db/migrations
git commit -m "feat(db): lock commission terms on orders and add the commission earnings ledger"
```

---

### Task 3: Lock the rate at delivery and move old orders over

**Files:**
- Create: `src/server-functions/sales/recovery-commission-service.ts`
- Modify: `src/server-functions/sales/invoice-posting-service.ts:1050-1077`
- Modify: `src/server-functions/sales/orders-fn.ts:374-380`
- Modify: `src/lib/order-booker-regressions.test.ts:57-65`, `src/server-functions/sales/invoice-posting-service.test.ts:42`
- Create: `src/__tests__/integration/recovery-commission.test.ts`

**Interfaces:**
- Consumes: `calculateOrderBookerCommission` (`@/lib/order-booker/commission`), `commissionEarnings`, `orders.commissionMode`, `orders.commissionRateLocked` (Task 2), `CommissionMode` (Task 1). The existing tier lookup in `order-booker-commission-calc.ts` (booker tiers, then global tiers, then flat rate) is moved into `resolveDeliveryRate`.
- Produces:
  - `lockOrderCommissionTerms(tx: SalesTransaction, input: { orderId: string; orderBookerId: string; deliveredAmount: number; policy: "normal" | "suppress" }): Promise<OrderCommissionTerms>`
  - `resolveOrderCommissionTerms(tx: SalesTransaction, orderId: string): Promise<OrderCommissionTerms | null>`. It moves one old order over if needed. It returns null for an order that hasn't been delivered.
  - `ensureRecoveryCommissionSwitchover(): Promise<void>`. Bulk and idempotent. It uses the root `db` in its own transaction, and a module flag that is set only after commit.
  - `type OrderCommissionTerms = { mode: CommissionMode; rate: number }`

- [ ] **Step 1: Write the failing integration test (fixture + delivery cases)**

Create `src/__tests__/integration/recovery-commission.test.ts`. Its fixture is used again in Tasks 4–8: each later task adds `it(...)` blocks to this file. The fixture copies the transport mocks and the stock-receipt pattern from `src/__tests__/integration/two-phase-invoice-mutations.test.ts:27-110`.

```ts
// src/__tests__/integration/recovery-commission.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, user, warehouses, products, packagingMaterials, recipes, customers, invoiceItems, invoices, wallets, payments } from "@/db";
import { formulas, mixingRuns, packagingAllocations } from "@/db/schemas/production-schema";
import { commissionEarnings, commissionRecords, commissionTiers, orderBookers, orders, salesReturnReasons, salesReturns } from "@/db/schemas/sales-erp-schema";
import { createInvoiceFn } from "@/server-functions/sales/invoices-fn";
import { completePackagingAllocationCore } from "@/server-functions/manufacturing/packaging/complete-packaging-allocation-core.server";
import { addPaymentsToInvoice, confirmPendingPayment, reverseConfirmedPayment } from "@/server-functions/sales/settlement-service";
import { completeSalesReturnFn, createSalesReturnFn, decideSalesReturnFn, voidSalesReturnFn } from "@/server-functions/sales/sales-returns-fn";
import { resolveOrderCommissionTerms } from "@/server-functions/sales/recovery-commission-service";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | ((data: unknown) => unknown);
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) =>
      handler({ ...input, data: typeof validator === "function" ? validator(input.data) : validator.parse(input.data) }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map((key) => [key, key.endsWith("Middleware") ? {} : actual[key]]));
});
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => ({}) }));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("rollback commission fixture");

async function invoke(fn: unknown, data: unknown, actorId: string): Promise<any> {
  const session = { user: { id: actorId, name: "Commission test" } };
  return (fn as Function)({ data, context: { session, authContext: { session, permissions: new Set(["*"]) } } });
}

async function seed(tx: Tx, bookerRate = "2") {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: id, email: `${id}@test.invalid` }).returning();
  const warehouse = (await tx.select().from(warehouses).where(and(eq(warehouses.type, "factory_floor"), eq(warehouses.isActive, true))).limit(1))[0] ??
    (await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0", type: "factory_floor" }).returning())[0];
  const [product] = await tx.insert(products).values({ name: id }).returning();
  const [pack] = await tx.insert(packagingMaterials).values({ name: `${id}-pack`, costPerUnit: "1" }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "20", batchUnit: "kg" }).returning();
  const [recipe] = await tx.insert(recipes).values({ productId: product.id, formulaId: formula.id, name: id, batchSize: "20", batchUnit: "kg", containerType: "pack", containerPackagingId: pack.id, containersPerCarton: 0, fillAmount: "1000", fillUnit: "g" }).returning();
  const [run] = await tx.insert(mixingRuns).values({ batchId: id, formulaId: formula.id, warehouseId: warehouse.id, operatorId: actor.id, targetBulkQuantity: "2000", bulkUnit: "kg", status: "completed" }).returning();
  const [allocation] = await tx.insert(packagingAllocations).values({ mixingRunId: run.id, recipeId: recipe.id, warehouseId: warehouse.id, operatorId: actor.id,
    allocatedBulkQuantity: "2000", allocatedBulkUnit: "kg", allocatedChemicalCost: "2000", targetContainers: 2000, completedContainers: 2000, status: "in_progress" }).returning();
  await completePackagingAllocationCore(tx, allocation.id, actor.id);
  const [customer] = await tx.insert(customers).values({ name: id, customerType: "retailer" }).returning();
  const [booker] = await tx.insert(orderBookers).values({ name: `Booker ${id.slice(0, 6)}`, commissionRate: bookerRate }).returning();
  const [cash] = await tx.insert(wallets).values({ id: randomUUID(), name: `cash-${id}`, type: "cash" }).returning();
  const [bank] = await tx.insert(wallets).values({ id: randomUUID(), name: `bank-${id}`, type: "bank" }).returning();
  const [reason] = await tx.insert(salesReturnReasons).values({ name: id }).returning();
  return { actor, warehouse, recipe, customer, booker, cash, bank, reason };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

async function withFixture(check: (tx: Tx, f: Fixture) => Promise<void>, bookerRate = "2") {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Isolated TEST_DATABASE_URL required");
  try {
    await db.transaction(async (tx) => {
      const f = await seed(tx, bookerRate);
      const spy = vi.spyOn(db, "transaction").mockImplementation(((cb: Parameters<typeof db.transaction>[0]) => tx.transaction(cb)) as typeof db.transaction);
      try { await check(tx, f); } finally { spy.mockRestore(); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

let billNumber = 1;
/** Books an order and converts it into an invoice of `units` packs at Rs 100 each (invoice total = units × 100). */
async function deliverOrder(tx: Tx, f: Fixture, units: number) {
  const [order] = await tx.insert(orders).values({ billNumber: billNumber++, orderBookerId: f.booker.id, shopkeeperName: "Shop" }).returning();
  const invoice = await invoke(createInvoiceFn, {
    customerId: f.customer.id, warehouseId: f.warehouse.id, paymentDueDate: new Date("2099-01-01"), orderId: order.id,
    items: [{ recipeId: f.recipe.id, pack: f.recipe.name, unitType: "units", numberOfUnits: units, numberOfCartons: 0, perCartonPrice: 100, retailPrice: 100 }],
  }, f.actor.id);
  return { order, invoice };
}

async function pay(tx: Tx, f: Fixture, invoiceId: string, amount: number, method: "cash" | "cheque" = "cash", paymentDate = new Date()) {
  const [payment] = await addPaymentsToInvoice(tx, { invoiceId, actorId: f.actor.id, payments: [
    method === "cash"
      ? { method: "cash", walletId: f.cash.id, amount, paymentDate }
      : { method: "cheque", walletId: f.bank.id, amount, paymentDate, chequeNumber: `CHQ-${randomUUID().slice(0, 6)}`, chequeBank: "HBL", chequeDate: paymentDate },
  ] });
  return payment;
}

const ledger = (tx: Tx, invoiceId: string) =>
  tx.select().from(commissionEarnings).where(eq(commissionEarnings.invoiceId, invoiceId)).orderBy(commissionEarnings.createdAt);

describe.skipIf(!process.env.TEST_DATABASE_URL)("recovery-based commission", () => {
  it("locks the booker's effective rate at delivery and earns nothing on delivery", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 10);
      const saved = (await tx.query.orders.findFirst({ where: eq(orders.id, order.id) }))!;
      expect([saved.commissionMode, saved.commissionRateLocked]).toEqual(["recovery", "2.0000"]);
      expect(await ledger(tx, invoice.id)).toEqual([]);
      expect(await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, order.id))).toEqual([]);
    });
  });

  it("locks the blended slab rate, so a fully paid order earns what the slabs give", async () => {
    await withFixture(async (tx, f) => {
      await tx.insert(commissionTiers).values([
        { orderBookerId: f.booker.id, minAmount: "0", maxAmount: "500", rate: "1" },
        { orderBookerId: f.booker.id, minAmount: "500", maxAmount: null, rate: "3" },
      ]);
      const { order } = await deliverOrder(tx, f, 10); // Rs 1,000: 500×1% + 500×3% = Rs 20, i.e. 2%
      expect((await tx.query.orders.findFirst({ where: eq(orders.id, order.id) }))!.commissionRateLocked).toBe("2.0000");
    });
  });

  it("moves old orders over: unpaid delivery commission is cancelled, paid stays and earns nothing more", async () => {
    await withFixture(async (tx, f) => {
      const make = async (status: string | null) => {
        const [order] = await tx.insert(orders).values({ billNumber: billNumber++, orderBookerId: f.booker.id, shopkeeperName: "Old", status: "delivered", fulfilledAmount: "100000.00" }).returning();
        if (status) await tx.insert(commissionRecords).values({ orderBookerId: f.booker.id, orderId: order.id, fulfilledAmount: "100000.00", appliedRate: "2.00", commissionAmount: "2000.00", status });
        return order;
      };
      const unpaid = await make("accrued");
      const paid = await make("paid");
      const none = await make(null);
      expect(await resolveOrderCommissionTerms(tx, unpaid.id)).toEqual({ mode: "recovery", rate: 2 });
      expect(await resolveOrderCommissionTerms(tx, paid.id)).toEqual({ mode: "delivery_paid", rate: 2 });
      expect(await resolveOrderCommissionTerms(tx, none.id)).toEqual({ mode: "suppressed", rate: 0 });
      const [record] = await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, unpaid.id));
      expect(record.status).toBe("cancelled");
      // Running it again changes nothing.
      expect(await resolveOrderCommissionTerms(tx, unpaid.id)).toEqual({ mode: "recovery", rate: 2 });
    });
  });

  it("keeps the locked rate when the booker's rate changes later", async () => {
    await withFixture(async (tx, f) => {
      const { order } = await deliverOrder(tx, f, 10);
      await tx.update(orderBookers).set({ commissionRate: "5" }).where(eq(orderBookers.id, f.booker.id));
      expect(await resolveOrderCommissionTerms(tx, order.id)).toEqual({ mode: "recovery", rate: 2 });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts`
Expected: FAIL with "Failed to resolve import "@/server-functions/sales/recovery-commission-service"".

- [ ] **Step 3: Write the service (terms part) and switch the delivery hooks**

```ts
// src/server-functions/sales/recovery-commission-service.ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { commissionRecords, commissionTiers, orderBookers, orders } from "@/db/schemas/sales-erp-schema";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";
import type { CommissionMode } from "@/lib/order-booker/recovery-commission";
import { roundMoney } from "@/lib/sales/settlement/money";
import type { SalesTransaction } from "./settlement-service";

export type OrderCommissionTerms = { mode: CommissionMode; rate: number };

/** Same tier lookup as delivery commission used: booker tiers, then global tiers, then the flat rate. */
async function resolveDeliveryRate(tx: SalesTransaction, orderBookerId: string, deliveredAmount: number): Promise<number> {
  let tiers = await tx.query.commissionTiers.findMany({
    where: and(eq(commissionTiers.orderBookerId, orderBookerId), eq(commissionTiers.isActive, true)),
    orderBy: [commissionTiers.minAmount],
  });
  if (tiers.length === 0) {
    tiers = await tx.query.commissionTiers.findMany({
      where: and(isNull(commissionTiers.orderBookerId), eq(commissionTiers.isActive, true)),
      orderBy: [commissionTiers.minAmount],
    });
  }
  let flatRate = 0;
  if (tiers.length === 0) {
    const booker = await tx.query.orderBookers.findFirst({ where: eq(orderBookers.id, orderBookerId), columns: { commissionRate: true } });
    flatRate = Number(booker?.commissionRate ?? 0);
  }
  const result = calculateOrderBookerCommission({ fulfilledAmount: deliveredAmount, tiers, flatRate });
  if (result.mode === "flat") return result.rate;
  return deliveredAmount > 0 ? Math.round((result.amount / deliveredAmount) * 100 * 10000) / 10000 : 0;
}

const termsOf = (row: { commissionMode: string | null; commissionRateLocked: string | null }): OrderCommissionTerms | null =>
  row.commissionMode ? { mode: row.commissionMode as CommissionMode, rate: Number(row.commissionRateLocked ?? 0) } : null;

/** Locks the rate the first time an order is delivered. Later deliveries (fulfil, then invoice) keep it. */
export async function lockOrderCommissionTerms(
  tx: SalesTransaction,
  input: { orderId: string; orderBookerId: string; deliveredAmount: number; policy: "normal" | "suppress" },
): Promise<OrderCommissionTerms> {
  const [current] = await tx.select({ commissionMode: orders.commissionMode, commissionRateLocked: orders.commissionRateLocked })
    .from(orders).where(eq(orders.id, input.orderId)).for("update");
  const existing = current && termsOf(current);
  if (existing) return existing;
  const rate = input.policy === "suppress" ? 0 : await resolveDeliveryRate(tx, input.orderBookerId, input.deliveredAmount);
  const mode: CommissionMode = input.policy === "suppress" ? "suppressed" : "recovery";
  await tx.update(orders).set({ commissionMode: mode, commissionRateLocked: rate.toFixed(4), updatedAt: new Date() }).where(eq(orders.id, input.orderId));
  return { mode, rate };
}

/** Effective rate of an old delivery record: commission ÷ delivered × 100. */
const legacyRate = (record: { commissionAmount: string; fulfilledAmount: string }) =>
  Number(record.fulfilledAmount) > 0 ? Math.round((Number(record.commissionAmount) / Number(record.fulfilledAmount)) * 100 * 10000) / 10000 : 0;

/** Moves one old (pre-phase-6) delivered order over to recovery terms. Returns null for orders not delivered yet. */
export async function resolveOrderCommissionTerms(tx: SalesTransaction, orderId: string): Promise<OrderCommissionTerms | null> {
  const [order] = await tx.select({ id: orders.id, status: orders.status, commissionMode: orders.commissionMode, commissionRateLocked: orders.commissionRateLocked })
    .from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) return null;
  const existing = termsOf(order);
  if (existing) return existing;
  const hasInvoice = (await tx.execute(sql`select 1 from invoices where order_id = ${orderId} and status = 'saved' limit 1`)).rows.length > 0;
  if (order.status !== "delivered" && !hasInvoice) return null;

  const records = await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, orderId));
  const paid = records.find((r) => r.status === "paid");
  const accrued = records.find((r) => r.status === "accrued");
  let terms: OrderCommissionTerms;
  if (paid) terms = { mode: "delivery_paid", rate: legacyRate(paid) };
  else if (accrued) {
    terms = { mode: "recovery", rate: legacyRate(accrued) };
    await tx.update(commissionRecords).set({ status: "cancelled", updatedAt: new Date() }).where(eq(commissionRecords.id, accrued.id));
  } else terms = { mode: "suppressed", rate: 0 };
  await tx.update(orders).set({ commissionMode: terms.mode, commissionRateLocked: terms.rate.toFixed(4), updatedAt: new Date() }).where(eq(orders.id, orderId));
  return terms;
}

let switchoverDone = false;
/** Moves every old delivered order over. Runs before payroll and the commission screens read. Idempotent. */
export async function ensureRecoveryCommissionSwitchover(): Promise<void> {
  if (switchoverDone) return;
  const { db } = await import("@/db");
  await db.transaction(async (tx) => {
    const pending = await tx.execute(sql`
      select o.id from orders o
      where o.commission_mode is null
        and (o.status = 'delivered' or exists (select 1 from invoices i where i.order_id = o.id and i.status = 'saved'))`);
    for (const row of pending.rows as Array<{ id: string }>) {
      await resolveOrderCommissionTerms(tx as unknown as SalesTransaction, row.id);
    }
  });
  switchoverDone = true;
}

/** Test-only: lets integration tests run the bulk switch-over again. */
export function resetRecoveryCommissionSwitchoverForTests() {
  switchoverDone = false;
}

export { roundMoney as _roundMoney, inArray as _inArray };
```

Drop the last `export { ... }` line if Tasks 4–7 import `roundMoney`/`inArray` straight from their modules. It's only there so the linter doesn't flag unused imports while the file is half-built. Remove it in Task 4 when those imports get used.

In `src/server-functions/sales/invoice-posting-service.ts`, replace the block at lines 1068-1076:

```ts
    if (input.commissionPolicy !== "suppress") {
      await calculateCommissionForOrder(
        tx,
        orderBookerId,
        data.orderId,
        commissionBaseAmount,
        input.businessDate,
      );
    }
```

with:

```ts
    // Phase 6: nothing is earned on delivery. Lock the rate; payments earn it later.
    await lockOrderCommissionTerms(tx, {
      orderId: data.orderId,
      orderBookerId,
      deliveredAmount: commissionBaseAmount,
      policy: input.commissionPolicy === "suppress" ? "suppress" : "normal",
    });
```

Swap the import at line 44: `import { lockOrderCommissionTerms } from "./recovery-commission-service";`.

In `src/server-functions/sales/orders-fn.ts`, replace lines 374-380 (`// Calculate commission within same transaction` + `calculateCommissionForOrder(...)`) with:

```ts
      // Phase 6: lock the rate at delivery; commission is earned when the invoice is paid.
      await lockOrderCommissionTerms(tx as any, {
        orderId: order.id,
        orderBookerId: order.orderBookerId,
        deliveredAmount: data.fulfilledAmount,
        policy: "normal",
      });
```

and swap the import at line 13 to `import { lockOrderCommissionTerms } from "./recovery-commission-service";`.

Delete `src/server-functions/sales/order-booker-commission-calc.ts` once `grep -rn calculateCommissionForOrder src` shows no callers left. The two source-inspection tests are updated next.

Update the source tests:
- `src/lib/order-booker-regressions.test.ts:57-65`: rename the test to `"locks commission terms when invoice conversion delivers a linked order"` and change the assertion to `expect(source).toContain("await lockOrderCommissionTerms(tx, {");`, keeping the `linkedOrderStatus` assertion.
- `src/server-functions/sales/invoice-posting-service.test.ts:42`: change it to `expect(postingSource).toContain("lockOrderCommissionTerms(tx, {");` and add `expect(postingSource).not.toContain("calculateCommissionForOrder(");`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts`
Expected: PASS (4 tests).

Run: `bunx vitest run src/lib/order-booker-regressions.test.ts src/server-functions/sales/invoice-posting-service.test.ts && bun run typecheck`
Expected: the changed tests pass and there are no type errors. The orders-page regression test in `order-booker-regressions.test.ts` (`"uses shared commission math in order fulfillment preview..."`) checks `src/routes/_protected/sales/orders/index.tsx`. If it already fails on the starting commit, leave it and say so in the report. Don't fix it here.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/sales/invoice-posting-service.ts src/server-functions/sales/orders-fn.ts src/lib/order-booker-regressions.test.ts src/server-functions/sales/invoice-posting-service.test.ts src/__tests__/integration/recovery-commission.test.ts
git rm src/server-functions/sales/order-booker-commission-calc.ts
git commit -m "feat(commission): lock the rate at delivery instead of earning on delivery"
```

---

### Task 4: Earn commission when a payment is confirmed

**Files:**
- Modify: `src/server-functions/sales/recovery-commission-service.ts` (add `earnCommissionForPayment`, `commissionedBase`, `owedOnInvoice`)
- Modify: `src/server-functions/sales/settlement-service.ts:643, 711, 763, 825` (call it after each `creditWalletForPayment`)
- Test: `src/__tests__/integration/recovery-commission.test.ts`

**Interfaces:**
- Consumes: `resolveOrderCommissionTerms` (Task 3), `paymentEarnsCommission`, `earnableBase`, `commissionAmount` (Task 1), `PaymentRecord` type from `settlement-service.ts`.
- Produces:
  - `earnCommissionForPayment(tx: SalesTransaction, payment: { id: string; invoiceId: string; amount: string; method: string; status: string; effectiveDate: Date | null }, actorId: string): Promise<void>`
  - `owedOnInvoice(tx, invoiceId): Promise<number>`: invoice total minus completed returns' `total_amount`.
  - `commissionedBase(tx, invoiceId): Promise<number>`: sum of `base_amount` over the invoice's ledger rows.

- [ ] **Step 1: Write the failing tests**

Add inside the `describe` in `src/__tests__/integration/recovery-commission.test.ts`:

```ts
  it("earns on a full payment, dated on the payment day (behaviour 1)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000); // Rs 1,00,000
      const paidOn = new Date("2026-10-20T10:00:00+05:00");
      const payment = await pay(tx, f, invoice.id, 100000, "cash", paidOn);
      const rows = await ledger(tx, invoice.id);
      expect(rows.map((r) => [r.kind, r.paymentId, r.baseAmount, r.rate, r.amount, r.entryDate.toISOString()])).toEqual([
        ["payment", payment.id, "100000.00", "2.0000", "2000.00", paidOn.toISOString()],
      ]);
      expect(rows[0].orderBookerId).toBe(f.booker.id);
    });
  });

  it("splits partial payments by month (behaviour 2)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000
      await pay(tx, f, invoice.id, 200000, "cash", new Date("2026-10-20T10:00:00+05:00"));
      await pay(tx, f, invoice.id, 200000, "cash", new Date("2026-11-15T10:00:00+05:00"));
      expect((await ledger(tx, invoice.id)).map((r) => [r.amount, r.entryDate.toISOString().slice(0, 7)])).toEqual([
        ["4000.00", "2026-10"], ["4000.00", "2026-11"],
      ]);
    });
  });

  it("earns on a cheque only when it clears, dated on the clear date (behaviour 5)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const cheque = await pay(tx, f, invoice.id, 50000, "cheque");
      expect(cheque.status).toBe("pending");
      expect(await ledger(tx, invoice.id)).toEqual([]);
      const cleared = new Date("2026-11-03T12:00:00+05:00");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: cleared });
      const rows = await ledger(tx, invoice.id);
      expect(rows.map((r) => [r.amount, r.entryDate.toISOString()])).toEqual([["1000.00", cleared.toISOString()]]);
    });
  });

  it("earns nothing on a suppressed order or an old order already paid on delivery (behaviours 8, 11)", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 1000);
      await tx.update(orders).set({ commissionMode: "suppressed", commissionRateLocked: "0.0000" }).where(eq(orders.id, order.id));
      await pay(tx, f, invoice.id, 10000);
      const second = await deliverOrder(tx, f, 1000);
      await tx.update(orders).set({ commissionMode: "delivery_paid" }).where(eq(orders.id, second.order.id));
      await pay(tx, f, second.invoice.id, 10000);
      expect(await ledger(tx, invoice.id)).toEqual([]);
      expect(await ledger(tx, second.invoice.id)).toEqual([]);
    });
  });

  it("earns at the old order's rate after its unpaid delivery commission was cancelled (behaviour 9)", async () => {
    await withFixture(async (tx, f) => {
      const { order, invoice } = await deliverOrder(tx, f, 1000);
      // Make it look like a pre-phase-6 order: no locked terms, an unpaid 1.5% delivery record.
      await tx.update(orders).set({ commissionMode: null, commissionRateLocked: null }).where(eq(orders.id, order.id));
      await tx.insert(commissionRecords).values({ orderBookerId: f.booker.id, orderId: order.id, fulfilledAmount: "100000.00", appliedRate: "1.50", commissionAmount: "1500.00", status: "accrued" });
      await pay(tx, f, invoice.id, 40000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.rate, r.amount])).toEqual([["1.5000", "600.00"]]);
      expect((await tx.select().from(commissionRecords).where(eq(commissionRecords.orderId, order.id)))[0].status).toBe("cancelled");
    });
  });

  it("writes one row per payment even if the earning step runs twice (behaviour 12)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 10000);
      const { earnCommissionForPayment } = await import("@/server-functions/sales/recovery-commission-service");
      await earnCommissionForPayment(tx, payment, f.actor.id);
      expect(await ledger(tx, invoice.id)).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts`
Expected: the 6 new tests FAIL (no ledger rows, or the `earnCommissionForPayment` import is missing). The 4 Task 3 tests still pass.

- [ ] **Step 3: Implement earning and hook it in**

Add to `recovery-commission-service.ts` (and remove the temporary `export { roundMoney as _roundMoney, ... }` line):

```ts
import { commissionEarnings, salesReturns } from "@/db/schemas/sales-erp-schema";
import { invoices } from "@/db/schemas/sales-schema";
import { commissionAmount, earnableBase, paymentEarnsCommission } from "@/lib/order-booker/recovery-commission";

/** What the customer really owes on the invoice: total minus the value of completed returns. */
export async function owedOnInvoice(tx: SalesTransaction, invoiceId: string): Promise<number> {
  const [row] = await tx.select({
    total: invoices.totalPrice,
    returned: sql<string>`coalesce((select sum(${salesReturns.totalAmount}) from ${salesReturns}
      where ${salesReturns.invoiceId} = ${invoiceId} and ${salesReturns.status} = 'completed'), 0)`,
  }).from(invoices).where(eq(invoices.id, invoiceId));
  return roundMoney(Math.max(0, Number(row?.total ?? 0) - Number(row?.returned ?? 0)));
}

/** Money on this invoice that commission has already been worked out on (net of reversals and take-backs). */
export async function commissionedBase(tx: SalesTransaction, invoiceId: string): Promise<number> {
  const [row] = await tx.select({ base: sql<string>`coalesce(sum(${commissionEarnings.baseAmount}), 0)` })
    .from(commissionEarnings).where(eq(commissionEarnings.invoiceId, invoiceId));
  return roundMoney(Number(row?.base ?? 0));
}

type InvoiceCommissionContext = { orderId: string; orderBookerId: string; terms: OrderCommissionTerms };

async function invoiceCommissionContext(tx: SalesTransaction, invoiceId: string): Promise<InvoiceCommissionContext | null> {
  const invoice = await tx.query.invoices.findFirst({ where: eq(invoices.id, invoiceId), columns: { orderId: true, orderBookerId: true } });
  if (!invoice?.orderId || !invoice.orderBookerId) return null;
  const terms = await resolveOrderCommissionTerms(tx, invoice.orderId);
  if (!terms || terms.mode !== "recovery" || terms.rate <= 0) return null;
  return { orderId: invoice.orderId, orderBookerId: invoice.orderBookerId, terms };
}

/** Called right after a payment becomes confirmed (the wallet is credited at the same point). */
export async function earnCommissionForPayment(
  tx: SalesTransaction,
  payment: { id: string; invoiceId: string; amount: string; method: string; status: string; effectiveDate: Date | null },
  actorId: string,
): Promise<void> {
  if (payment.status !== "confirmed" || !payment.effectiveDate || !paymentEarnsCommission(payment.method)) return;
  const context = await invoiceCommissionContext(tx, payment.invoiceId);
  if (!context) return;
  const base = earnableBase({
    paymentAmount: Number(payment.amount),
    owed: await owedOnInvoice(tx, payment.invoiceId),
    commissionedBase: await commissionedBase(tx, payment.invoiceId),
  });
  if (base <= 0) return;
  await tx.insert(commissionEarnings).values({
    orderBookerId: context.orderBookerId,
    orderId: context.orderId,
    invoiceId: payment.invoiceId,
    paymentId: payment.id,
    kind: "payment",
    baseAmount: base.toFixed(2),
    rate: context.terms.rate.toFixed(4),
    amount: commissionAmount(base, context.terms.rate).toFixed(2),
    entryDate: payment.effectiveDate,
    createdById: actorId,
  }).onConflictDoNothing();
}
```

`settlement-service.ts` imports from `recovery-commission-service.ts`, and the service imports only the `SalesTransaction` **type** from settlement-service. That makes it a type-only cycle, which is fine. Keep it `import type`.

In `src/server-functions/sales/settlement-service.ts`, add `import { earnCommissionForPayment } from "./recovery-commission-service";`. Then add one line straight after each of the four `creditWalletForPayment` calls:
- line 643 (`createInitialPayments`): `await earnCommissionForPayment(tx, payment, input.actorId);`
- line 711 (`addPaymentsToInvoice`): `await earnCommissionForPayment(tx, payment, input.actorId);`
- line 763 (`recordRecoveryPayment`): `await earnCommissionForPayment(tx, payment, input.actorId);`
- line 825 (`confirmPendingPayment`): `await earnCommissionForPayment(tx, changed, input.actorId);`

In `createInitialPayments` the order's terms must already be locked, and they are: posting locks them at line ~1069 and creates payments at line ~1249.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts`
Expected: PASS. The existing invoice/payment suite must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/sales/settlement-service.ts src/__tests__/integration/recovery-commission.test.ts
git commit -m "feat(commission): earn commission when customer money is confirmed"
```

---

### Task 5: Reversed payments: who bears the commission

**Files:**
- Modify: `src/server-functions/sales/recovery-commission-service.ts` (add `reverseCommissionForPayment`, `getPaymentCommission`)
- Modify: `src/server-functions/sales/settlement-service.ts:84-90` (`ReversePaymentInput`), `:913-1017` (`reverseConfirmedPayment`)
- Modify: `src/server-functions/sales/payment-settlement-fn.ts:28-30, 205-226` (schema + new `getPaymentCommissionFn`)
- Test: `src/__tests__/integration/recovery-commission.test.ts`

**Interfaces:**
- Consumes: `commissionAmount` (Task 1), `commissionEarnings` (Task 2).
- Produces:
  - `reverseCommissionForPayment(tx, input: { paymentId: string; bearer: CommissionBearer; actorId: string; date: Date; reason: string }): Promise<void>`
  - `getPaymentCommission(tx, paymentId): Promise<{ amount: number; orderBookerName: string } | null>`. It returns null when the payment earned nothing or was already reversed.
  - `ReversePaymentInput.commissionBearer?: CommissionBearer` (default `"booker"`)
  - `getPaymentCommissionFn({ data: { paymentId } })`, behind `requirePaymentReversalMiddleware`.

- [ ] **Step 1: Write the failing tests**

```ts
  it("deducts from the booker on the reversal date by default (behaviour 6)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000);
      const cheque = await pay(tx, f, invoice.id, 200000, "cheque");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-10-10T10:00:00+05:00") });
      const bounced = new Date("2026-11-05T10:00:00+05:00");
      await reverseConfirmedPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: bounced, reason: "Cheque bounced" });
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.bearer, r.baseAmount, r.amount, r.entryDate.toISOString()])).toEqual([
        ["payment", null, "200000.00", "4000.00", "2026-10-10T05:00:00.000Z"],
        ["payment_reversal", "booker", "-200000.00", "-4000.00", bounced.toISOString()],
      ]);
    });
  });

  it("records the company bearing the loss without a deduction, and does not earn twice on the replacement payment", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 100000);
      await reverseConfirmedPayment(tx, { paymentId: payment.id, actorId: f.actor.id, effectiveDate: new Date(), reason: "Wrong account", commissionBearer: "company" });
      await pay(tx, f, invoice.id, 100000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.bearer, r.amount, r.createdById])).toEqual([
        ["payment", null, "2000.00", f.actor.id],
        ["payment_reversal", "company", "0.00", f.actor.id],
      ]);
    });
  });

  it("tells the reversal dialog how much commission a payment earned", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      const payment = await pay(tx, f, invoice.id, 100000);
      const { getPaymentCommission } = await import("@/server-functions/sales/recovery-commission-service");
      expect(await getPaymentCommission(tx, payment.id)).toEqual({ amount: 2000, orderBookerName: f.booker.name });
      await reverseConfirmedPayment(tx, { paymentId: payment.id, actorId: f.actor.id, effectiveDate: new Date(), reason: "Bounced" });
      expect(await getPaymentCommission(tx, payment.id)).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts -t "booker|company|dialog"`
Expected: FAIL (no reversal row, unknown `commissionBearer`, missing export).

- [ ] **Step 3: Implement**

Add to `recovery-commission-service.ts`:

```ts
import type { CommissionBearer } from "@/lib/order-booker/recovery-commission";

export async function reverseCommissionForPayment(
  tx: SalesTransaction,
  input: { paymentId: string; bearer: CommissionBearer; actorId: string; date: Date; reason: string },
): Promise<void> {
  const earned = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.paymentId, input.paymentId), eq(commissionEarnings.kind, "payment")),
  });
  if (!earned) return;
  const deduct = input.bearer === "booker";
  await tx.insert(commissionEarnings).values({
    orderBookerId: earned.orderBookerId,
    orderId: earned.orderId,
    invoiceId: earned.invoiceId,
    paymentId: input.paymentId,
    kind: "payment_reversal",
    bearer: input.bearer,
    baseAmount: deduct ? (-Number(earned.baseAmount)).toFixed(2) : "0.00",
    rate: earned.rate,
    amount: deduct ? (-Number(earned.amount)).toFixed(2) : "0.00",
    entryDate: input.date,
    createdById: input.actorId,
    note: input.reason,
  }).onConflictDoNothing();
}

export async function getPaymentCommission(tx: SalesTransaction, paymentId: string): Promise<{ amount: number; orderBookerName: string } | null> {
  const rows = await tx.query.commissionEarnings.findMany({
    where: eq(commissionEarnings.paymentId, paymentId),
    with: { orderBooker: { columns: { name: true } } },
  });
  const earned = rows.find((r) => r.kind === "payment");
  if (!earned || rows.some((r) => r.kind === "payment_reversal")) return null;
  return { amount: Number(earned.amount), orderBookerName: earned.orderBooker.name };
}
```

`commissionEarningsRelations` from Task 2 already defines `orderBooker`.

In `settlement-service.ts`:
- `ReversePaymentInput` gets `commissionBearer?: "booker" | "company";`.
- In `reverseConfirmedPayment`, straight after the `if (!changed) throw new Error("Payment is no longer confirmed");` line, add:

```ts
	await reverseCommissionForPayment(tx, {
		paymentId: changed.id,
		bearer: input.commissionBearer ?? "booker",
		actorId: input.actorId,
		date: input.effectiveDate,
		reason,
	});
```

and extend the import to `import { earnCommissionForPayment, reverseCommissionForPayment } from "./recovery-commission-service";`.

In `payment-settlement-fn.ts`:

```ts
const reverseSchema = resolveSchema.extend({
	effectiveDate: z.coerce.date(),
	commissionBearer: z.enum(["booker", "company"]).default("booker"),
});
```

and add:

```ts
export const getPaymentCommissionFn = createServerFn()
	.middleware([requirePaymentReversalMiddleware])
	.inputValidator((input: unknown) => z.object({ paymentId: z.string().min(1) }).parse(input))
	.handler(async ({ data }) => {
		const { db } = await import("@/db");
		const { getPaymentCommission } = await import("./recovery-commission-service");
		return getPaymentCommission(db as unknown as SalesTransaction, data.paymentId);
	});
```

(`SalesTransaction` is already imported in this file. If it isn't, import it as a type from `./settlement-service`.) When the reversal is saved with `commissionBearer: "company"`, also log it: in `reversePaymentFn`'s `logActivityQuiet` description use `` `Reversed payment${data.commissionBearer === "company" ? " (company bears the booker's commission)" : ""}` ``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts && bunx vitest run src/server-functions/sales/payment-settlement-fn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/sales/settlement-service.ts src/server-functions/sales/payment-settlement-fn.ts src/__tests__/integration/recovery-commission.test.ts
git commit -m "feat(commission): deduct or keep commission when a payment is reversed"
```

---

### Task 6: Returns: take back commission above what is owed, add it back on void

**Files:**
- Modify: `src/server-functions/sales/recovery-commission-service.ts` (add `capCommissionAfterReturn`, `restoreCommissionAfterReturnVoid`)
- Modify: `src/server-functions/sales/sales-returns-fn.ts:802-805` (complete) and `:913-917` (void)
- Test: `src/__tests__/integration/recovery-commission.test.ts`

**Interfaces:**
- Consumes: `owedOnInvoice`, `commissionedBase` (Task 4), `clawbackBase`, `commissionAmount` (Task 1).
- Produces:
  - `capCommissionAfterReturn(tx, input: { invoiceId: string; salesReturnId: string; actorId: string; date: Date }): Promise<void>`
  - `restoreCommissionAfterReturnVoid(tx, input: { salesReturnId: string; actorId: string; date: Date }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
  async function returnPacks(tx: Tx, f: Fixture, invoiceId: string, packs: number) {
    const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    const created = await invoke(createSalesReturnFn, { invoiceId, reasonId: f.reason.id, items: [{ invoiceItemId: item.id, quantityReturned: packs, refundPerUnit: 100 }] }, f.actor.id);
    await invoke(decideSalesReturnFn, { returnId: created.id, action: "approve" }, f.actor.id);
    await invoke(completeSalesReturnFn, { returnId: created.id, lines: [{ returnItemId: created.items[0].id, goodUnits: packs }] }, f.actor.id);
    return created;
  }

  it("earns only on money paid when a return comes before the rest of the payment (behaviour 3)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000
      await pay(tx, f, invoice.id, 200000);
      await returnPacks(tx, f, invoice.id, 1000); // Rs 1,00,000 back, still owed 2,00,000: nothing to take back
      await pay(tx, f, invoice.id, 200000);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.amount])).toEqual([["payment", "4000.00"], ["payment", "4000.00"]]);
    });
  });

  it("takes back commission on money above what is owed after a return, and adds it back on void (decision 1)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000); // Rs 1,00,000
      await pay(tx, f, invoice.id, 100000); // +2,000
      const salesReturn = await returnPacks(tx, f, invoice.id, 300); // Rs 30,000 to store credit
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.salesReturnId, r.baseAmount, r.amount])).toEqual([
        ["payment", null, "100000.00", "2000.00"],
        ["return_clawback", salesReturn.id, "-30000.00", "-600.00"],
      ]);
      await invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Wrong invoice" }, f.actor.id);
      expect((await ledger(tx, invoice.id)).map((r) => [r.kind, r.amount])).toEqual([
        ["payment", "2000.00"], ["return_clawback", "-600.00"], ["return_clawback_undo", "600.00"],
      ]);
    });
  });

  it("caps earnings at the net invoice, so later money above it earns nothing (behaviour 4)", async () => {
    await withFixture(async (tx, f) => {
      const { invoice } = await deliverOrder(tx, f, 1000);
      await returnPacks(tx, f, invoice.id, 300); // owes 70,000
      await pay(tx, f, invoice.id, 70000);
      expect((await ledger(tx, invoice.id)).map((r) => r.baseAmount)).toEqual(["70000.00"]);
    });
  });
```

The helper reads the invoice item through `tx`. Inside `withFixture`, only `db.transaction` is pointed at the fixture transaction, so a root `db.select` wouldn't see rows that haven't been committed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts -t "return|net invoice"`
Expected: the "takes back" test FAILS (no `return_clawback` row). Behaviours 3 and 4 may already pass because of the Task 4 cap. That's fine; keep them as regression guards.

- [ ] **Step 3: Implement**

Add to `recovery-commission-service.ts`:

```ts
import { clawbackBase } from "@/lib/order-booker/recovery-commission";

/** After a return completes: if money already commissioned is above what is now owed, take back the difference. */
export async function capCommissionAfterReturn(
  tx: SalesTransaction,
  input: { invoiceId: string; salesReturnId: string; actorId: string; date: Date },
): Promise<void> {
  const base = clawbackBase({ owed: await owedOnInvoice(tx, input.invoiceId), commissionedBase: await commissionedBase(tx, input.invoiceId) });
  if (base <= 0) return;
  const latest = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.invoiceId, input.invoiceId), eq(commissionEarnings.kind, "payment")),
    orderBy: (row, { desc }) => [desc(row.createdAt)],
  });
  if (!latest) return;
  const rate = Number(latest.rate);
  await tx.insert(commissionEarnings).values({
    orderBookerId: latest.orderBookerId,
    orderId: latest.orderId,
    invoiceId: input.invoiceId,
    salesReturnId: input.salesReturnId,
    kind: "return_clawback",
    baseAmount: (-base).toFixed(2),
    rate: latest.rate,
    amount: (-commissionAmount(base, rate)).toFixed(2),
    entryDate: input.date,
    createdById: input.actorId,
  }).onConflictDoNothing();
}

/** A voided return gives back exactly what it took. */
export async function restoreCommissionAfterReturnVoid(
  tx: SalesTransaction,
  input: { salesReturnId: string; actorId: string; date: Date },
): Promise<void> {
  const taken = await tx.query.commissionEarnings.findFirst({
    where: and(eq(commissionEarnings.salesReturnId, input.salesReturnId), eq(commissionEarnings.kind, "return_clawback")),
  });
  if (!taken) return;
  await tx.insert(commissionEarnings).values({
    orderBookerId: taken.orderBookerId,
    orderId: taken.orderId,
    invoiceId: taken.invoiceId,
    salesReturnId: input.salesReturnId,
    kind: "return_clawback_undo",
    baseAmount: (-Number(taken.baseAmount)).toFixed(2),
    rate: taken.rate,
    amount: (-Number(taken.amount)).toFixed(2),
    entryDate: input.date,
    createdById: input.actorId,
  }).onConflictDoNothing();
}
```

The rate always comes from the invoice's ledger rows. They all carry the order's single locked rate, so there's no need to resolve terms again.

In `src/server-functions/sales/sales-returns-fn.ts`:
- After the `recalculateInvoiceSettlement` call in `completeSalesReturnFn` (line ~802-805), add:

```ts
      await capCommissionAfterReturn(tx, { invoiceId: salesReturn.invoiceId, salesReturnId: salesReturn.id, actorId: userId, date: now });
```

  `now` is the completion timestamp already used for `completedAt: now` at line ~775. If that variable is scoped inside a block, use the same `Date` that was written to `completedAt`.
- After the final `recalculateInvoiceSettlement` in `voidSalesReturnFn` (line ~913-917), add:

```ts
      await restoreCommissionAfterReturnVoid(tx, { salesReturnId: salesReturn.id, actorId: userId, date: now });
```

- Import: `import { capCommissionAfterReturn, restoreCommissionAfterReturnVoid } from "./recovery-commission-service";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/sales/sales-returns-fn.ts src/__tests__/integration/recovery-commission.test.ts
git commit -m "feat(commission): take back commission when a return leaves money above what is owed"
```

---

### Task 7: Payroll reads the ledger and carries a negative month forward

**Files:**
- Modify: `src/server-functions/sales/recovery-commission-service.ts` (add `collectPayslipCommission`, `markPayslipCommissionPaid`, `releasePayslipCommission`)
- Modify: `src/server-functions/hr/payroll/core.ts:15, 283-292, 524-588, 868-890, 1068-1127`
- Modify: `src/server-functions/hr/payroll/sales-performance-fn.ts:52-80`
- Test: `src/__tests__/integration/recovery-commission.test.ts`, `src/server-functions/hr/payroll/recovery-commission-payroll.test.ts` (create, source inspection)

**Interfaces:**
- Consumes: `settlePayslipCommission`, `RecoveryCommissionBreakdown` (Task 1), `ensureRecoveryCommissionSwitchover` (Task 3).
- Produces:
  - `collectPayslipCommission(tx: SalesTransaction, orderBookerId: string, periodEndExclusive: Date): Promise<{ entryIds: string[]; settlement: PayslipCommissionSettlement; breakdown: RecoveryCommissionBreakdown }>`
  - `markPayslipCommissionPaid(tx, entryIds: string[], payslipId: string): Promise<void>`. It throws `"Commission entries changed during payroll generation. Please recalculate the payslip."` if any row was already paid.
  - `releasePayslipCommission(tx, payslipId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Add to `recovery-commission.test.ts`:

```ts
  it("pays a positive month, then carries a bounced cheque's deduction into later months (behaviour 6 carry-forward)", async () => {
    await withFixture(async (tx, f) => {
      const { collectPayslipCommission, markPayslipCommissionPaid } = await import("@/server-functions/sales/recovery-commission-service");
      const { invoice } = await deliverOrder(tx, f, 5000);
      const cheque = await pay(tx, f, invoice.id, 200000, "cheque");
      await confirmPendingPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-10-10T10:00:00+05:00") });
      const october = await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"));
      expect(october.settlement.payable).toBe(4000);
      await markPayslipCommissionPaid(tx, october.entryIds, "payslip-oct");

      await pay(tx, f, invoice.id, 50000, "cash", new Date("2026-11-20T10:00:00+05:00")); // +1,000
      await reverseConfirmedPayment(tx, { paymentId: cheque.id, actorId: f.actor.id, effectiveDate: new Date("2026-11-05T10:00:00+05:00"), reason: "Bounced" }); // −4,000
      const november = await collectPayslipCommission(tx, f.booker.id, new Date("2026-12-01T00:00:00+05:00"));
      expect([november.settlement.payable, november.settlement.carriedForward, november.settlement.paysEntries]).toEqual([0, 3000, false]);
      expect(november.breakdown).toMatchObject({ kind: "recovery", paymentsCount: 1, earned: 1000, deductions: 4000, carriedForward: 3000 });

      const second = await deliverOrder(tx, f, 5000);
      await pay(tx, f, second.invoice.id, 500000, "cash", new Date("2026-12-10T10:00:00+05:00")); // +10,000
      const december = await collectPayslipCommission(tx, f.booker.id, new Date("2027-01-01T00:00:00+05:00"));
      expect(december.settlement.payable).toBe(7000);
      expect(december.entryIds).toHaveLength(3);
    });
  });

  it("frees a deleted payslip's rows so the next payslip pays them again", async () => {
    await withFixture(async (tx, f) => {
      const { collectPayslipCommission, markPayslipCommissionPaid, releasePayslipCommission } = await import("@/server-functions/sales/recovery-commission-service");
      const { invoice } = await deliverOrder(tx, f, 1000);
      await pay(tx, f, invoice.id, 100000, "cash", new Date("2026-10-10T10:00:00+05:00"));
      const first = await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"));
      await markPayslipCommissionPaid(tx, first.entryIds, "payslip-x");
      expect((await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"))).entryIds).toEqual([]);
      await releasePayslipCommission(tx, "payslip-x");
      expect((await collectPayslipCommission(tx, f.booker.id, new Date("2026-11-01T00:00:00+05:00"))).settlement.payable).toBe(2000);
    });
  });
```

Create `src/server-functions/hr/payroll/recovery-commission-payroll.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const core = readFileSync(resolve(__dirname, "core.ts"), "utf8");
const performance = readFileSync(resolve(__dirname, "sales-performance-fn.ts"), "utf8");

describe("payroll reads recovery commission", () => {
  it("collects ledger commission in both payslip generation and the preview", () => {
    expect(core.match(/collectPayslipCommission\(/g)?.length).toBe(2);
    expect(core.match(/ensureRecoveryCommissionSwitchover\(\)/g)?.length).toBe(2);
    expect(core).toContain("markPayslipCommissionPaid(tx,");
    expect(core).toContain("releasePayslipCommission(tx, payslipId)");
  });

  it("counts ledger commission in monthly sales performance", () => {
    expect(performance).toContain("commissionEarnings");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts -t "payslip|carries" && bunx vitest run src/server-functions/hr/payroll/recovery-commission-payroll.test.ts`
Expected: FAIL (missing exports; the source doesn't call the new functions yet).

- [ ] **Step 3: Implement**

Add to `recovery-commission-service.ts`:

```ts
import { lt } from "drizzle-orm";
import { settlePayslipCommission, type PayslipCommissionSettlement, type RecoveryCommissionBreakdown } from "@/lib/order-booker/recovery-commission";

export async function collectPayslipCommission(
  tx: SalesTransaction,
  orderBookerId: string,
  periodEndExclusive: Date,
): Promise<{ entryIds: string[]; settlement: PayslipCommissionSettlement; breakdown: RecoveryCommissionBreakdown }> {
  const rows = await tx.query.commissionEarnings.findMany({
    where: and(
      eq(commissionEarnings.orderBookerId, orderBookerId),
      isNull(commissionEarnings.paidInPayslipId),
      lt(commissionEarnings.entryDate, periodEndExclusive),
    ),
    with: { invoice: { columns: { invoiceNumber: true } } },
    orderBy: (row, { asc }) => [asc(row.entryDate), asc(row.createdAt)],
  });
  const settlement = settlePayslipCommission(rows.map((r) => ({ amount: Number(r.amount) })));
  return {
    entryIds: rows.map((r) => r.id),
    settlement,
    breakdown: {
      kind: "recovery",
      paymentsCount: rows.filter((r) => r.kind === "payment").length,
      earned: settlement.earned,
      deductions: settlement.deductions,
      carriedForward: settlement.carriedForward,
      lines: rows.map((r) => ({
        entryDate: r.entryDate.toISOString().slice(0, 10),
        invoiceNumber: String(r.invoice?.invoiceNumber ?? r.invoiceId.slice(0, 8)),
        kind: r.kind,
        base: Number(r.baseAmount),
        rate: Number(r.rate),
        amount: Number(r.amount),
      })),
    },
  };
}

export async function markPayslipCommissionPaid(tx: SalesTransaction, entryIds: string[], payslipId: string): Promise<void> {
  if (entryIds.length === 0) return;
  const updated = await tx.update(commissionEarnings).set({ paidInPayslipId: payslipId })
    .where(and(inArray(commissionEarnings.id, entryIds), isNull(commissionEarnings.paidInPayslipId)))
    .returning({ id: commissionEarnings.id });
  if (updated.length !== entryIds.length) {
    throw new Error("Commission entries changed during payroll generation. Please recalculate the payslip.");
  }
}

export async function releasePayslipCommission(tx: SalesTransaction, payslipId: string): Promise<void> {
  await tx.update(commissionEarnings).set({ paidInPayslipId: null }).where(eq(commissionEarnings.paidInPayslipId, payslipId));
}
```

In `src/server-functions/hr/payroll/core.ts`:

1. Imports: add `import { collectPayslipCommission, ensureRecoveryCommissionSwitchover, markPayslipCommissionPaid, releasePayslipCommission } from "@/server-functions/sales/recovery-commission-service";` and `import type { PayslipCommissionBreakdown } from "@/lib/order-booker/recovery-commission";`.

2. In `reversePayslipSideEffects` (after the `commissionRecords` reset at lines 283-292) add `await releasePayslipCommission(tx, payslipId);`.

3. In `generateEmployeePayslipCore` section 5.5 (lines 524-588):
   - Change `commissionBreakdownSnapshot`'s type to `PayslipCommissionBreakdown`, starting as `[]`.
   - Add `let recoveryEntryIds: string[] = [];`.
   - Keep the legacy `commissionRecords` query and sum exactly as they are. They only find delivery records reopened by deleting an old payslip.
   - After it, inside `if (linkedOrderBooker)`, add:

```ts
    await ensureRecoveryCommissionSwitchover();
    const recovery = await collectPayslipCommission(db as unknown as SalesTransaction, linkedOrderBooker.id, payrollEndExclusiveTs);
    recoveryEntryIds = recovery.settlement.paysEntries ? recovery.entryIds : [];
    orderBookerCommission += recovery.settlement.payable;
    if (recovery.entryIds.length > 0) {
      // Legacy lines (if any) are history from before phase 6; the recovery breakdown is what this payslip pays now.
      commissionBreakdownSnapshot = recovery.breakdown;
    }
```

   (Import `type SalesTransaction` from `@/server-functions/sales/settlement-service`.)

4. In section 8d (lines 868-890), after the legacy update block, add:

```ts
    if (recoveryEntryIds.length > 0) {
      await markPayslipCommissionPaid(tx, recoveryEntryIds, slip.id);
    }
```

5. Make the same change in `simulateEmployeePayslipCore` section 5.5 (lines 1068-1127): call `await ensureRecoveryCommissionSwitchover();` and `collectPayslipCommission(...)`, add `settlement.payable` to `orderBookerCommission` and set the breakdown. A preview marks nothing.

6. Where the payslip row is inserted (line ~761-762), `commissionBreakdown: commissionBreakdownSnapshot.length > 0 ? commissionBreakdownSnapshot : null` no longer type-checks for the object form. Change it to:

```ts
        commissionBreakdown: Array.isArray(commissionBreakdownSnapshot)
          ? (commissionBreakdownSnapshot.length > 0 ? commissionBreakdownSnapshot : null)
          : commissionBreakdownSnapshot,
```

In `src/server-functions/hr/payroll/sales-performance-fn.ts` (lines 52-80), keep the legacy sum but skip `cancelled` records (add `ne(commissionRecords.status, "cancelled")`). Then add the ledger total for the same month:

```ts
    const [ledger] = await db
      .select({ total: sql<string>`coalesce(sum(${commissionEarnings.amount}), 0)` })
      .from(commissionEarnings)
      .where(and(eq(commissionEarnings.orderBookerId, obId), gte(commissionEarnings.entryDate, monthStart), lt(commissionEarnings.entryDate, monthEndExclusive)));
    totalCommission += Number(ledger?.total ?? 0);
```

(Import `commissionEarnings` from `@/db/schemas/sales-erp-schema`, plus `ne` and `sql` from `drizzle-orm` if they're missing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts src/__tests__/integration/attendance-payroll.test.ts && bunx vitest run src/server-functions/hr/payroll && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/hr/payroll/core.ts src/server-functions/hr/payroll/sales-performance-fn.ts src/server-functions/hr/payroll/recovery-commission-payroll.test.ts src/__tests__/integration/recovery-commission.test.ts
git commit -m "feat(payroll): pay recovery commission and carry a negative month forward"
```

---

### Task 8: Commission readers: month summary and per-booker detail

**Files:**
- Create: `src/server-functions/sales/recovery-commission-fn.ts`
- Create: `src/hooks/sales/use-recovery-commission.ts`
- Modify: `src/server-functions/sales/recovery-commission-service.ts` (add `loadBookerMonthInputs`)
- Test: `src/__tests__/integration/recovery-commission.test.ts`

**Interfaces:**
- Consumes: `summarizeBookerMonth`, `BookerMonthInput`, `BookerMonthSummary` (Task 1), `ensureRecoveryCommissionSwitchover` (Task 3), `createReportDateRange` from `@/server-functions/reports/profit-loss/reporting-math` (PKT month bounds: `{ fromDate, toDate }`), `requireSalesPeopleViewMiddleware` from `@/lib/middlewares`.
- Produces:
  - `loadBookerMonthInputs(tx, input: { orderBookerIds: string[] | "all"; monthStart: Date; monthEnd: Date }): Promise<Map<string, BookerMonthInput>>` (keyed by booker id)
  - `getCommissionMonthSummaryFn({ data: { month: "YYYY-MM" } })` returns `{ month, rows: Array<{ orderBookerId: string; name: string } & BookerMonthSummary>, total: BookerMonthSummary }`
  - `getBookerCommissionMonthFn({ data: { orderBookerId, month } })` returns `{ summary: BookerMonthSummary; invoices: Array<{ invoiceId; invoiceNumber; date; delivered; returned; collected; stillOwed; rate: number | null; mode: CommissionMode | null; earnedSoFar: number; entries: Array<{ id; kind; bearer; entryDate; base; amount; paymentMethod: string | null; note: string | null }> }> }`
  - Hooks: `useCommissionMonthSummary(month: string)`, `useBookerCommissionMonth(orderBookerId: string, month: string)`, `usePaymentCommission(paymentId: string | null)`. Query keys: `["recovery-commission", "summary", month]`, `["recovery-commission", "booker", orderBookerId, month]`, `["recovery-commission", "payment", paymentId]`.

- [ ] **Step 1: Write the failing test**

```ts
  it("builds the month summary from real rows (spec example)", async () => {
    await withFixture(async (tx, f) => {
      const { loadBookerMonthInputs } = await import("@/server-functions/sales/recovery-commission-service");
      const { summarizeBookerMonth } = await import("@/lib/order-booker/recovery-commission");
      const { invoice } = await deliverOrder(tx, f, 5000); // Rs 5,00,000 today
      await pay(tx, f, invoice.id, 200000, "cash", new Date());
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const inputs = await loadBookerMonthInputs(tx, { orderBookerIds: [f.booker.id], monthStart, monthEnd });
      expect(summarizeBookerMonth(inputs.get(f.booker.id)!)).toEqual({
        delivered: 500000, returned: 0, collected: 200000, earned: 4000, stillOwed: 300000, waiting: 6000,
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts -t "month summary"`
Expected: FAIL ("loadBookerMonthInputs is not a function").

- [ ] **Step 3: Implement**

Add to `recovery-commission-service.ts`:

```ts
import { lte, ne } from "drizzle-orm";
import { payments } from "@/db/schemas/sales-erp-schema";
import type { BookerMonthInput } from "@/lib/order-booker/recovery-commission";

export async function loadBookerMonthInputs(
  tx: SalesTransaction,
  input: { orderBookerIds: string[] | "all"; monthStart: Date; monthEnd: Date },
): Promise<Map<string, BookerMonthInput>> {
  const bookerFilter = input.orderBookerIds === "all" ? sql`${invoices.orderBookerId} is not null` : inArray(invoices.orderBookerId, input.orderBookerIds);
  const invoiceRows = await tx.select({
    id: invoices.id, orderBookerId: invoices.orderBookerId, date: invoices.date, totalPrice: invoices.totalPrice,
    mode: orders.commissionMode, rate: orders.commissionRateLocked,
  }).from(invoices).leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(and(bookerFilter, eq(invoices.status, "saved"), lte(invoices.date, input.monthEnd)));
  const ids = invoiceRows.map((r) => r.id);
  const map = new Map<string, BookerMonthInput>();
  const bucket = (bookerId: string) => {
    if (!map.has(bookerId)) map.set(bookerId, { monthStart: input.monthStart, monthEnd: input.monthEnd, invoices: [], returns: [], payments: [], entries: [] });
    return map.get(bookerId)!;
  };
  const bookerOf = new Map(invoiceRows.map((r) => [r.id, r.orderBookerId!]));
  for (const r of invoiceRows) {
    bucket(r.orderBookerId!).invoices.push({ id: r.id, date: r.date, totalPrice: Number(r.totalPrice), mode: (r.mode as BookerMonthInput["invoices"][number]["mode"]) ?? null, rate: r.rate === null ? null : Number(r.rate) });
  }
  if (ids.length === 0) return map;
  const returnRows = await tx.select({ invoiceId: salesReturns.invoiceId, totalAmount: salesReturns.totalAmount, completedAt: salesReturns.completedAt, voidedAt: salesReturns.voidedAt })
    .from(salesReturns).where(and(inArray(salesReturns.invoiceId, ids), sql`${salesReturns.completedAt} is not null`));
  for (const r of returnRows) bucket(bookerOf.get(r.invoiceId)!).returns.push({ invoiceId: r.invoiceId, totalAmount: Number(r.totalAmount), completedAt: r.completedAt!, voidedAt: r.voidedAt });
  const paymentRows = await tx.select({ invoiceId: payments.invoiceId, amount: payments.amount, method: payments.method, status: payments.status, effectiveDate: payments.effectiveDate, resolvedAt: payments.resolvedAt })
    .from(payments).where(and(inArray(payments.invoiceId, ids), inArray(payments.status, ["confirmed", "reversed"])));
  for (const p of paymentRows) {
    bucket(bookerOf.get(p.invoiceId)!).payments.push({ invoiceId: p.invoiceId, amount: Number(p.amount), method: p.method, status: p.status, effectiveDate: p.effectiveDate, reversedAt: p.status === "reversed" ? p.resolvedAt : null });
  }
  const entryRows = await tx.select({ orderBookerId: commissionEarnings.orderBookerId, amount: commissionEarnings.amount, entryDate: commissionEarnings.entryDate })
    .from(commissionEarnings)
    .where(and(
      input.orderBookerIds === "all" ? sql`true` : inArray(commissionEarnings.orderBookerId, input.orderBookerIds),
      sql`${commissionEarnings.entryDate} >= ${input.monthStart}`, lte(commissionEarnings.entryDate, input.monthEnd),
    ));
  for (const e of entryRows) bucket(e.orderBookerId).entries.push({ amount: Number(e.amount), entryDate: e.entryDate });
  return map;
}
```

Notes for the implementer:
- `salesReturns.voidedAt` and `salesReturns.completedAt` exist (`sales-returns-fn.ts:775, 909`).
- For a reversed payment, `resolvedAt` is when the reversal was recorded. That's close enough for "as of month end".
- Remove the unused `ne` import if nothing uses it.

Create `src/server-functions/sales/recovery-commission-fn.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSalesPeopleViewMiddleware } from "@/lib/middlewares";
import { summarizeBookerMonth, type BookerMonthSummary } from "@/lib/order-booker/recovery-commission";
import { createReportDateRange } from "@/server-functions/reports/profit-loss/reporting-math";

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

function monthRange(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const range = createReportDateRange({ dateFrom: `${month}-01`, dateTo: `${month}-${String(last).padStart(2, "0")}` });
  return { monthStart: range.fromDate, monthEnd: range.toDate };
}

const ZERO: BookerMonthSummary = { delivered: 0, returned: 0, collected: 0, earned: 0, stillOwed: 0, waiting: 0 };
const add = (a: BookerMonthSummary, b: BookerMonthSummary): BookerMonthSummary =>
  Object.fromEntries(Object.keys(a).map((k) => [k, Math.round(((a as any)[k] + (b as any)[k]) * 100) / 100])) as BookerMonthSummary;

export const getCommissionMonthSummaryFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input: unknown) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const service = await import("./recovery-commission-service");
    await service.ensureRecoveryCommissionSwitchover();
    const { monthStart, monthEnd } = monthRange(data.month);
    const bookers = await db.query.orderBookers.findMany({ columns: { id: true, name: true } });
    const inputs = await service.loadBookerMonthInputs(db as any, { orderBookerIds: "all", monthStart, monthEnd });
    const rows = bookers
      .map((b) => ({ orderBookerId: b.id, name: b.name, ...(inputs.has(b.id) ? summarizeBookerMonth(inputs.get(b.id)!) : ZERO) }))
      .filter((r) => r.delivered || r.returned || r.collected || r.earned || r.stillOwed);
    return { month: data.month, rows, total: rows.reduce((t, r) => add(t, r), ZERO) };
  });

export const getBookerCommissionMonthFn = createServerFn()
  .middleware([requireSalesPeopleViewMiddleware])
  .inputValidator((input: unknown) => z.object({ orderBookerId: z.string().min(1), month: monthSchema }).parse(input))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const service = await import("./recovery-commission-service");
    await service.ensureRecoveryCommissionSwitchover();
    const { monthStart, monthEnd } = monthRange(data.month);
    const input = (await service.loadBookerMonthInputs(db as any, { orderBookerIds: [data.orderBookerId], monthStart, monthEnd })).get(data.orderBookerId);
    if (!input) return { summary: ZERO, invoices: [] };
    const { commissionEarnings } = await import("@/db/schemas/sales-erp-schema");
    const { invoices: invoiceTable } = await import("@/db/schemas/sales-schema");
    const { eq, inArray } = await import("drizzle-orm");
    const ids = input.invoices.map((i) => i.id);
    const numbers = await db.select({ id: invoiceTable.id, invoiceNumber: invoiceTable.invoiceNumber }).from(invoiceTable).where(inArray(invoiceTable.id, ids));
    const entries = await db.query.commissionEarnings.findMany({
      where: eq(commissionEarnings.orderBookerId, data.orderBookerId),
      with: { payment: { columns: { method: true } } },
      orderBy: (row, { asc }) => [asc(row.entryDate)],
    });
    const owedOf = (id: string) => summarizeBookerMonth({ ...input, invoices: input.invoices.filter((i) => i.id === id), entries: [] });
    const rows = input.invoices
      .map((invoice) => {
        const own = entries.filter((e) => e.invoiceId === invoice.id);
        const one = owedOf(invoice.id);
        const returnedTotal = input.returns.filter((r) => r.invoiceId === invoice.id && !r.voidedAt).reduce((s, r) => s + r.totalAmount, 0);
        const collectedTotal = input.payments.filter((p) => p.invoiceId === invoice.id && p.status === "confirmed" && p.method !== "customer_credit").reduce((s, p) => s + p.amount, 0);
        return {
          invoiceId: invoice.id,
          invoiceNumber: String(numbers.find((n) => n.id === invoice.id)?.invoiceNumber ?? invoice.id.slice(0, 8)),
          date: invoice.date,
          delivered: invoice.totalPrice,
          returned: returnedTotal,
          collected: collectedTotal,
          stillOwed: one.stillOwed,
          rate: invoice.rate,
          mode: invoice.mode,
          earnedSoFar: Math.round(own.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100,
          entries: own.map((e) => ({ id: e.id, kind: e.kind, bearer: e.bearer, entryDate: e.entryDate, base: Number(e.baseAmount), amount: Number(e.amount), paymentMethod: e.payment?.method ?? null, note: e.note })),
        };
      })
      // Only invoices with something to show: money still owed, activity this month, or commission rows.
      .filter((r) => r.stillOwed > 0 || r.entries.length > 0 || (r.date >= monthStart && r.date <= monthEnd));
    return { summary: summarizeBookerMonth(input), invoices: rows };
  });
```

Create `src/hooks/sales/use-recovery-commission.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getBookerCommissionMonthFn, getCommissionMonthSummaryFn } from "@/server-functions/sales/recovery-commission-fn";
import { getPaymentCommissionFn } from "@/server-functions/sales/payment-settlement-fn";

export function useCommissionMonthSummary(month: string) {
  return useQuery({ queryKey: ["recovery-commission", "summary", month], queryFn: () => getCommissionMonthSummaryFn({ data: { month } }) });
}

export function useBookerCommissionMonth(orderBookerId: string, month: string) {
  return useQuery({
    queryKey: ["recovery-commission", "booker", orderBookerId, month],
    queryFn: () => getBookerCommissionMonthFn({ data: { orderBookerId, month } }),
    enabled: Boolean(orderBookerId),
  });
}

export function usePaymentCommission(paymentId: string | null) {
  return useQuery({
    queryKey: ["recovery-commission", "payment", paymentId],
    queryFn: () => getPaymentCommissionFn({ data: { paymentId: paymentId! } }),
    enabled: Boolean(paymentId),
  });
}
```

In `src/hooks/sales/use-payment-settlement.ts`, make `useSettlementInvalidation` also invalidate `["recovery-commission"]`, so the summary updates after a reversal or confirmation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/sales/recovery-commission-service.ts src/server-functions/sales/recovery-commission-fn.ts src/hooks/sales/use-recovery-commission.ts src/hooks/sales/use-payment-settlement.ts src/__tests__/integration/recovery-commission.test.ts
git commit -m "feat(commission): month summary and per-booker commission readers"
```

---

### Task 9: Screens: Commission summary and the booker's Commission tab

**Files:**
- Create: `src/components/sales/commission/month-picker.tsx`, `src/components/sales/commission/commission-summary.tsx`, `src/components/sales/commission/booker-commission-tab.tsx`
- Modify: `src/routes/_protected/sales/people/index.tsx:361-372` (render the summary above the bookers list)
- Modify: `src/routes/_protected/sales/people/order-bookers/$orderBookerId/index.tsx:16, 38-41, 111-113, 235-306` (replace the old CommissionTab, accept `?month=`)
- Test: `src/__tests__/commission-screens.behavior.test.tsx`

**Interfaces:**
- Consumes: `useCommissionMonthSummary`, `useBookerCommissionMonth` (Task 8), `formatPKR` from `@/lib/currency-format` (Lac/Crore formatting; check the exact export name with `grep -n "export function" src/lib/currency-format.ts` and use the one the sales screens use).
- Produces: `<MonthPicker month onChange />`, `<CommissionSummary />`, `<BookerCommissionTab orderBookerId month onMonthChange />`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/commission-screens.behavior.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), booker: vi.fn(), navigate: vi.fn() }));
vi.mock("@/server-functions/sales/recovery-commission-fn", () => ({
  getCommissionMonthSummaryFn: mocks.summary,
  getBookerCommissionMonthFn: mocks.booker,
}));
vi.mock("@/server-functions/sales/payment-settlement-fn", () => ({ getPaymentCommissionFn: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

import { CommissionSummary } from "@/components/sales/commission/commission-summary";
import { BookerCommissionTab } from "@/components/sales/commission/booker-commission-tab";

const row = (name: string, earned: number, delivered: number) => ({
  orderBookerId: name.toLowerCase(), name, delivered, returned: 0, collected: earned * 50, earned, stillOwed: 100000, waiting: 2000,
});
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-15T12:00:00+05:00"), toFake: ["Date"] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.summary.mockResolvedValue({
    month: "2026-10",
    rows: [row("Bilal Ahmed", 19600, 1240000), row("Usman Tariq", 11850, 850000)],
    total: { delivered: 2090000, returned: 0, collected: 1572500, earned: 31450, stillOwed: 200000, waiting: 4000 },
  });
  mocks.booker.mockResolvedValue({
    summary: { delivered: 500000, returned: 100000, collected: 200000, earned: 3400, stillOwed: 195000, waiting: 3900 },
    invoices: [{
      invoiceId: "inv1", invoiceNumber: "INV-7", date: new Date("2026-10-05"), delivered: 500000, returned: 100000, collected: 200000,
      stillOwed: 195000, rate: 2, mode: "recovery", earnedSoFar: 3400,
      entries: [
        { id: "e1", kind: "payment", bearer: null, entryDate: new Date("2026-10-20"), base: 200000, amount: 4000, paymentMethod: "cheque", note: null },
        { id: "e2", kind: "payment_reversal", bearer: "booker", entryDate: new Date("2026-10-28"), base: -30000, amount: -600, paymentMethod: "cheque", note: "Bounced" },
      ],
    }],
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

describe("Commission summary", () => {
  it("shows every column for the current month with a total row, sorts, and opens a booker", async () => {
    wrap(<CommissionSummary />);
    expect(await screen.findByText("Bilal Ahmed")).toBeTruthy();
    expect(mocks.summary).toHaveBeenCalledWith({ data: { month: "2026-10" } });
    for (const header of ["Order Booker", "Delivered", "Returned", "Collected", "Earned", "Still owed", "Waiting"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
    }
    const rows = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(rows().at(-1)).toBe("Total");
    fireEvent.click(screen.getByRole("button", { name: /Earned/ }));
    expect(rows().slice(0, 2)).toEqual(["Usman Tariq", "Bilal Ahmed"]);
    expect(rows().at(-1)).toBe("Total");
    fireEvent.click(screen.getByText("Bilal Ahmed"));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/sales/people/order-bookers/$orderBookerId", params: { orderBookerId: "bilal ahmed" }, search: { month: "2026-10" } });
  });

  it("moves to the previous month", async () => {
    wrap(<CommissionSummary />);
    await screen.findByText("Bilal Ahmed");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(mocks.summary).toHaveBeenLastCalledWith({ data: { month: "2026-09" } });
  });
});

describe("Booker Commission tab", () => {
  it("shows the four headline numbers, the invoice list with the locked rate, and each payment's commission line", async () => {
    wrap(<BookerCommissionTab orderBookerId="b1" month="2026-10" onMonthChange={() => {}} />);
    for (const label of ["Delivered", "Collected", "Earned", "Waiting"]) expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByText("INV-7")).toBeTruthy();
    expect(screen.getByText("2%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show payments for INV-7" }));
    expect(screen.getByText("Payment received")).toBeTruthy();
    expect(screen.getByText("Reversed payment (deducted from booker)")).toBeTruthy();
    expect(screen.getByText("Bounced")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/commission-screens.behavior.test.tsx`
Expected: FAIL with "Failed to resolve import "@/components/sales/commission/commission-summary"".

- [ ] **Step 3: Implement the screens**

`src/components/sales/commission/month-picker.tsx`:

```tsx
import { addMonths, format, parse } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const currentMonth = () => format(new Date(), "yyyy-MM");

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const date = parse(`${month}-01`, "yyyy-MM-dd", new Date());
  const shift = (by: number) => onChange(format(addMonths(date, by), "yyyy-MM"));
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
      <span className="min-w-32 text-center text-sm font-medium">{format(date, "MMMM yyyy")}</span>
      <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
    </div>
  );
}
```

`src/components/sales/commission/commission-summary.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCommissionMonthSummary } from "@/hooks/sales/use-recovery-commission";
import { formatPKR } from "@/lib/currency-format";
import { MonthPicker, currentMonth } from "./month-picker";

const COLUMNS = [
  ["delivered", "Delivered"], ["returned", "Returned"], ["collected", "Collected"],
  ["earned", "Earned"], ["stillOwed", "Still owed"], ["waiting", "Waiting"],
] as const;
type SortKey = "name" | (typeof COLUMNS)[number][0];

export function CommissionSummary() {
  const [month, setMonth] = useState(currentMonth);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const { data, isLoading } = useCommissionMonthSummary(month);
  const navigate = useNavigate();
  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const result = sort.key === "name" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
      return sort.asc ? result : -result;
    });
    return list;
  }, [data, sort]);
  const toggle = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));
  const header = (key: SortKey, label: string, right = true) => (
    <TableHead className={right ? "text-right text-[11px]" : "text-[11px]"}>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-[11px]" onClick={() => toggle(key)}>
        {label} <ArrowUpDown className="ml-1 size-3" />
      </Button>
    </TableHead>
  );
  return (
    <section aria-label="Commission summary" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Commission summary</h3>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      <p className="text-sm text-muted-foreground">Commission is earned only on money collected. Earned is what goes on the payslip.</p>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {header("name", "Order Booker", false)}
              {COLUMNS.map(([key, label]) => header(key, label))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No deliveries, collections or money owed this month.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.orderBookerId} className="cursor-pointer"
                onClick={() => navigate({ to: "/sales/people/order-bookers/$orderBookerId", params: { orderBookerId: r.orderBookerId }, search: { month } })}>
                <TableCell className="text-sm font-medium">{r.name}</TableCell>
                {COLUMNS.map(([key]) => <TableCell key={key} className="text-right text-sm tabular-nums">{formatPKR(r[key])}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
          {data && rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="text-sm font-semibold">Total</TableCell>
                {COLUMNS.map(([key]) => <TableCell key={key} className="text-right text-sm font-semibold tabular-nums">{formatPKR(data.total[key])}</TableCell>)}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </section>
  );
}
```

The test checks that the total row comes last among `role="row"` elements. `TableFooter` renders after `TableBody`, so it does.

`src/components/sales/commission/booker-commission-tab.tsx`:

```tsx
import { Fragment, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBookerCommissionMonth } from "@/hooks/sales/use-recovery-commission";
import { formatPKR } from "@/lib/currency-format";
import { MonthPicker } from "./month-picker";

const ENTRY_LABEL: Record<string, (bearer: string | null) => string> = {
  payment: () => "Payment received",
  payment_reversal: (bearer) => (bearer === "company" ? "Reversed payment (company bears the loss)" : "Reversed payment (deducted from booker)"),
  return_clawback: () => "Return after payment (taken back)",
  return_clawback_undo: () => "Return voided (added back)",
};

export function BookerCommissionTab({ orderBookerId, month, onMonthChange }: { orderBookerId: string; month: string; onMonthChange: (month: string) => void }) {
  const { data, isLoading } = useBookerCommissionMonth(orderBookerId, month);
  const [open, setOpen] = useState<string | null>(null);
  const s = data?.summary;
  const tiles = [["Delivered", s?.delivered], ["Collected", s?.collected], ["Earned", s?.earned], ["Waiting", s?.waiting]] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Earned only on money collected, at each order's locked rate.</p>
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold tabular-nums">{formatPKR(value ?? 0)}</p></CardContent>
          </Card>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="text-[11px]">Invoice</TableHead>
              <TableHead className="text-right text-[11px]">Delivered</TableHead>
              <TableHead className="text-right text-[11px]">Returned</TableHead>
              <TableHead className="text-right text-[11px]">Collected</TableHead>
              <TableHead className="text-right text-[11px]">Still owed</TableHead>
              <TableHead className="text-right text-[11px]">Rate</TableHead>
              <TableHead className="text-right text-[11px]">Commission earned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : !data?.invoices.length ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No invoices with money owed or collected.</TableCell></TableRow>
            ) : data.invoices.map((inv) => (
              <Fragment key={inv.invoiceId}>
                <TableRow>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Show payments for ${inv.invoiceNumber}`}
                      onClick={() => setOpen(open === inv.invoiceId ? null : inv.invoiceId)}>
                      {open === inv.invoiceId ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.delivered)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.returned)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.collected)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatPKR(inv.stillOwed)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {inv.mode === "recovery" ? `${Number(inv.rate)}%` : inv.mode === "delivery_paid" ? "Paid on delivery" : "No commission"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">{formatPKR(inv.earnedSoFar)}</TableCell>
                </TableRow>
                {open === inv.invoiceId && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/30">
                      {inv.entries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No commission yet. It is earned when money for this invoice is confirmed.</p>
                      ) : (
                        <ul className="space-y-1 text-sm">
                          {inv.entries.map((e) => (
                            <li key={e.id} className="flex flex-wrap justify-between gap-2">
                              <span>{format(new Date(e.entryDate), "dd MMM yyyy")} · {ENTRY_LABEL[e.kind]?.(e.bearer) ?? e.kind}{e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}</span>
                              <span className="tabular-nums">{formatPKR(e.base)} → {formatPKR(e.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

Wire it up:
- `src/routes/_protected/sales/people/index.tsx`: inside `OrderBookersTab`, render `<CommissionSummary />` straight after the opening `<div className="space-y-4">`, above the "Order Bookers" heading. Import it from `@/components/sales/commission/commission-summary`.
- `src/routes/_protected/sales/people/order-bookers/$orderBookerId/index.tsx`:
  - Add `validateSearch: (search: Record<string, unknown>) => ({ month: typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month) ? search.month : undefined })` to the route options.
  - Read it with `Route.useSearch()`. Keep `const [commissionMonth, setCommissionMonth] = useState(search.month ?? currentMonth())` in place of the `commissionDateRange` state at lines 38-41.
  - If `search.month` is set, open the page on the Commission tab: give `Tabs` `defaultValue={search.month ? "commission" : <existing default>}`.
  - Replace `<CommissionTab ... />` (line 112) with `<BookerCommissionTab orderBookerId={orderBookerId} month={commissionMonth} onMonthChange={setCommissionMonth} />`.
  - Delete the old `CommissionTab` function (lines 235-306) and the `useGetCommissionRecords, useGetCommissionSummary` import (line 16). Remove `DatePickerWithRange`/`DateRange` imports if nothing else in the file uses them (the Trips tab still does; check first).
- Leave `getCommissionRecordsFn`/`getCommissionSummaryFn` and their hooks in place. Old records stay readable, and the portal (out of scope) may use them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/commission-screens.behavior.test.tsx && bun run typecheck`
Expected: PASS (3 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/commission src/routes/_protected/sales/people/index.tsx 'src/routes/_protected/sales/people/order-bookers/$orderBookerId/index.tsx' src/__tests__/commission-screens.behavior.test.tsx
git commit -m "feat(sales): commission summary and recovery-based Commission tab"
```

---

### Task 10: Screens: "Who bears it?" on reversal, and the payslip lines

**Files:**
- Modify: `src/components/finance/payment-verification-page.tsx:170-250, 575-620`
- Modify: `src/hooks/sales/use-payment-settlement.ts:148-160`
- Modify: `src/components/hr/payroll/payslip-view.tsx:54-61, 213-215, 443-470`
- Test: `src/__tests__/payment-reversal-commission.behavior.test.tsx`, `src/__tests__/payslip-commission.behavior.test.tsx`

**Interfaces:**
- Consumes: `usePaymentCommission` (Task 8), `reversePaymentFn` with `commissionBearer` (Task 5), `PayslipCommissionBreakdown`, `isRecoveryBreakdown` (Task 1).
- Produces: none for later tasks.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/payment-reversal-commission.behavior.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reverse: vi.fn(), commission: vi.fn() }));
vi.mock("@/server-functions/sales/payment-settlement-fn", () => ({
  getPaymentSettlementsFn: mocks.list,
  confirmBankTransferFn: vi.fn(), clearChequeFn: vi.fn(), returnChequeFn: vi.fn(), cancelBankTransferFn: vi.fn(),
  reversePaymentFn: mocks.reverse,
  getPaymentCommissionFn: mocks.commission,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PaymentVerificationPage } from "@/components/finance/payment-verification-page";

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.list.mockResolvedValue({ data: [{
    id: "p1", amount: "200000.00", method: "cheque", status: "confirmed", paymentDate: new Date("2026-10-10"), effectiveDate: new Date("2026-10-10"), ageDays: 3,
    invoice: { id: "i1", invoiceNumber: "INV-1", paymentDueDate: null }, customer: { id: "c1", name: "Shop" },
  }], total: 1, pageCount: 1 });
  mocks.reverse.mockResolvedValue({ id: "p1" });
});
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={client}><PaymentVerificationPage /></QueryClientProvider>);

async function openReverse() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Cheque bounced" } });
}

describe("Reversing a payment that earned commission", () => {
  it("asks who bears it, defaults to the booker, and sends the choice", async () => {
    mocks.commission.mockResolvedValue({ amount: 4000, orderBookerName: "Bilal Ahmed" });
    await openReverse();
    expect(await screen.findByText(/Commission on this payment: Rs 4,000 \(Bilal Ahmed\)/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Deduct from booker" }) as HTMLInputElement).getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("radio", { name: "Company bears the loss" }));
    fireEvent.click(screen.getByRole("button", { name: "Reverse payment" }));
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalled());
    expect(mocks.reverse.mock.calls[0][0].data).toMatchObject({ paymentId: "p1", commissionBearer: "company" });
  });

  it("does not ask when the payment earned no commission", async () => {
    mocks.commission.mockResolvedValue(null);
    await openReverse();
    await waitFor(() => expect(mocks.commission).toHaveBeenCalled());
    expect(screen.queryByText(/Who bears it/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reverse payment" }));
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalled());
    expect(mocks.reverse.mock.calls[0][0].data.commissionBearer).toBe("booker");
  });
});
```

The page's export name and the shape of the list row (`getPaymentSettlementsFn`, `PaymentVerificationPage`, row fields) must match the real file. Check `src/components/finance/payment-verification-page.tsx` and `src/hooks/sales/use-payment-settlement.ts` for the list server function and export names, and fix the mock to match before running. Make that change in the test only.

```tsx
// src/__tests__/payslip-commission.behavior.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayslipView } from "@/components/hr/payroll/payslip-view";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn(), Link: (p: any) => p.children }));
afterEach(cleanup);

// Build a minimal payslip from an existing fixture: copy the object used in
// src/__tests__/*payslip*.test.tsx if one exists, otherwise fill every required field of PayslipData with zeros/strings.
import { basePayslip } from "./fixtures/payslip-fixture";

describe("Payslip commission lines", () => {
  it("shows commission on recoveries with the payment count, deductions and carried forward", () => {
    render(<PayslipView showActions={false} payslip={{ ...basePayslip, commissionAmount: "0.00", commissionBreakdown: {
      kind: "recovery", paymentsCount: 18, earned: 12400, deductions: 15400, carriedForward: 3000, lines: [],
    } }} />);
    expect(screen.getByText("Commission on recoveries: Rs 12,400 (18 payments)")).toBeTruthy();
    expect(screen.getByText("Deductions (reversed payments): −Rs 15,400")).toBeTruthy();
    expect(screen.getByText("Rs 3,000 carried forward to next month")).toBeTruthy();
  });

  it("keeps showing old per-order commission payslips as before", () => {
    render(<PayslipView showActions={false} payslip={{ ...basePayslip, commissionAmount: "2000.00", commissionBreakdown: [
      { orderId: "o1", orderRef: "ORD-1", orderDate: "2026-09-01", orderValue: 100000, rate: 2, amount: 2000 },
    ] }} />);
    expect(screen.getByText("Commission")).toBeTruthy();
  });
});
```

Create `src/__tests__/fixtures/payslip-fixture.ts` exporting `basePayslip: PayslipData`. Export the `PayslipData` type from `payslip-view.tsx` if it isn't exported yet. Fill every field the type requires: employee, payroll, and money strings `"0.00"`. Take the field list from the type at `payslip-view.tsx:20-65`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/__tests__/payment-reversal-commission.behavior.test.tsx src/__tests__/payslip-commission.behavior.test.tsx`
Expected: FAIL (no "Commission on this payment" text, no recovery payslip lines).

- [ ] **Step 3: Implement**

`src/hooks/sales/use-payment-settlement.ts`: add `commissionBearer?: "booker" | "company";` to the `useReversePayment` `mutationFn` data type.

`src/components/finance/payment-verification-page.tsx`:
- State: `const [commissionBearer, setCommissionBearer] = useState<"booker" | "company">("booker");`. Reset it to `"booker"` in `openDialog`.
- Query: `const paymentCommission = usePaymentCommission(dialog?.action === "reverse" ? dialog.payment.id : null);`
- In the `"reverse"` case of `submitAction`, add `commissionBearer` to the `mutateAsync` payload.
- Inside `<FieldGroup>`, after the reason fields, when `dialog.action === "reverse" && paymentCommission.data`:

```tsx
<Field>
  <FieldLabel>
    Commission on this payment: Rs {formatPKR(paymentCommission.data.amount).replace(/^Rs\.?\s*/, "")} ({paymentCommission.data.orderBookerName})
  </FieldLabel>
  <FieldDescription>Who bears it?</FieldDescription>
  <RadioGroup value={commissionBearer} onValueChange={(value) => setCommissionBearer(value as "booker" | "company")}>
    <div className="flex items-center gap-2">
      <RadioGroupItem id="bearer-booker" value="booker" />
      <Label htmlFor="bearer-booker">Deduct from booker</Label>
    </div>
    <div className="flex items-center gap-2">
      <RadioGroupItem id="bearer-company" value="company" />
      <Label htmlFor="bearer-company">Company bears the loss</Label>
    </div>
  </RadioGroup>
</Field>
```

  Import `RadioGroup, RadioGroupItem` from `@/components/ui/radio-group` and `Label` from `@/components/ui/label` (check both exist under `src/components/ui/`; if `radio-group` is missing, run `bunx shadcn@latest add radio-group`). Format the amount the same way the test expects (`Rs 4,000`). If `formatPKR` already prints `Rs 4,000`, use it directly and drop the `.replace`.

`src/components/hr/payroll/payslip-view.tsx`:
- Type the `commissionBreakdown` field as `PayslipCommissionBreakdown | null` (import the type from `@/lib/order-booker/recovery-commission`).
- Replace the commission earnings entry (lines 213-215) with:

```tsx
        ...(isRecoveryBreakdown(payslip.commissionBreakdown)
            ? [{ label: `Commission on recoveries (${payslip.commissionBreakdown.paymentsCount} payments)`, value: toN(payslip.commissionAmount) }]
            : toN(payslip.commissionAmount) > 0
                ? [{ label: "Commission", value: toN(payslip.commissionAmount) }]
                : []),
```

- Under the earnings table, render a small note block when `isRecoveryBreakdown(payslip.commissionBreakdown)`:

```tsx
{isRecoveryBreakdown(payslip.commissionBreakdown) && (
  <div className="space-y-0.5 text-xs text-muted-foreground">
    <p>Commission on recoveries: Rs {payslip.commissionBreakdown.earned.toLocaleString("en-PK")} ({payslip.commissionBreakdown.paymentsCount} payments)</p>
    {payslip.commissionBreakdown.deductions > 0 && (
      <p>Deductions (reversed payments): −Rs {payslip.commissionBreakdown.deductions.toLocaleString("en-PK")}</p>
    )}
    {payslip.commissionBreakdown.carriedForward > 0 && (
      <p>Rs {payslip.commissionBreakdown.carriedForward.toLocaleString("en-PK")} carried forward to next month</p>
    )}
  </div>
)}
```

  Put it where `commissionExpanded` is used today, so the existing expand/collapse still works for old per-order payslips.
- In the print HTML (lines 443-470), keep the old per-order table only when `Array.isArray(payslip.commissionBreakdown)`. For the recovery form, print the same three lines as plain text rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/__tests__/payment-reversal-commission.behavior.test.tsx src/__tests__/payslip-commission.behavior.test.tsx && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/payment-verification-page.tsx src/hooks/sales/use-payment-settlement.ts src/components/hr/payroll/payslip-view.tsx src/__tests__/payment-reversal-commission.behavior.test.tsx src/__tests__/payslip-commission.behavior.test.tsx src/__tests__/fixtures/payslip-fixture.ts src/components/ui
git commit -m "feat(commission): ask who bears commission on reversal and show recovery commission on payslips"
```

---

### Task 11: Full verification

**Files:** none new.

- [ ] **Step 1: Unit and behaviour tests**

Run: `bun run test -- src/lib src/__tests__ src/server-functions src/db --exclude "src/__tests__/integration/**" --exclude "src/__tests__/e2e/**"`
Expected: everything passes except tests that already failed on the starting branch. For any failure, run that file on the starting commit (`git stash`, or a worktree at the branch point) and report every failure that is new on this branch.

- [ ] **Step 2: Integration tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/recovery-commission.test.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts src/__tests__/integration/attendance-payroll.test.ts`
Expected: PASS.

- [ ] **Step 3: Type check and build**

Run: `bun run typecheck && bun run build`
Expected: no type errors, build succeeds.

- [ ] **Step 4: Migration check on old-shaped data**

Use a scratch database migrated to the commit before this phase. Seed through the old code:
- one delivered order with an `accrued` delivery record,
- one with a `paid` record (also give it a payslip),
- one invoice with a partial cash payment.

Snapshot the rows, then run `bun run db:migrate` on this branch. Check:
- Old rows are unchanged, and the new order columns are null.
- Opening Sales → People → Order Bookers fills them in (`recovery`/`delivery_paid`/`suppressed`), and the `accrued` record becomes `cancelled`.
- A new payment on the old unpaid order earns at that order's old rate, and one on the paid order earns nothing.

- [ ] **Step 5: Walk through in the browser**

With `bun run dev` and seeded local data:
1. Book an order for a booker at 2% and convert it to an invoice for Rs 1,00,000. The booker's Commission tab shows the invoice at rate 2% with Rs 0 earned.
2. Take Rs 40,000 cash. Earned shows Rs 800 and the summary row updates.
3. Take a Rs 60,000 cheque. Nothing is earned until you clear it on Finance → Payment verification, then Earned shows Rs 2,000.
4. Reverse the cheque and pick "Deduct from booker". Earned goes back down by Rs 1,200 and the payment list shows "Reversed payment (deducted from booker)".
5. Reverse another payment and pick "Company bears the loss". Earned doesn't change and the row says so.
6. On an invoice that's fully paid, receive a Rs 30,000 return. Earned drops by Rs 600. Void the return and the Rs 600 comes back.
7. Generate the booker's payslip on a month whose total is negative. It shows Rs 0 commission and "carried forward". Next month's payslip pays the rest.
8. The Order Bookers tab summary sorts by every column, the total row stays at the bottom, and clicking a row opens that booker's Commission tab for the same month.

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

---

## Self-review notes

- **Spec coverage:**
  - R1 lock at delivery: Task 3.
  - R2 methods: Tasks 1 and 4. Cheque only when cleared: behaviour 5. Expense offset earns: it goes through `recordRecoveryPayment` and is hooked in Task 4. Store credit doesn't earn: Task 1.
  - R3 cap: Tasks 1, 4 and 6.
  - R4 reversal choice and carry-forward: Tasks 5, 7 and 10.
  - R5 month = effective date: Task 4.
  - R6 booker on the original order earns: the ledger uses `invoices.orderBookerId`.
  - R7 suppressed: Tasks 3 and 4.
  - Switch-over: Task 3, decision 6.
  - Screens: Tasks 9 and 10.
  - Data changes: Task 2.
  - Behaviour 1–12: Tasks 3–7. Behaviour 7 (store credit applied) is the `paymentEarnsCommission("customer_credit") === false` rule in Task 1 plus the method check in `earnCommissionForPayment`.
  - The "paid, then returned" gap is closed by user decision 1 in Task 6.
- **Existing rows:** both new order columns are nullable, and old orders are moved over lazily and idempotently. `commission_records` keeps its schema. No old payment is back-filled, so nobody is paid twice.
- **Expense offset reversal:** today `reverseConfirmedPayment` refuses expense offsets, and no other path reverses them. If one is added later, it must call `reverseCommissionForPayment`.
- **Portal:** untouched. It may still read the legacy records through its own server function.
