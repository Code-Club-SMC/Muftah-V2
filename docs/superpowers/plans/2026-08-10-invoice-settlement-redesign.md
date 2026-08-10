# Invoice Settlement Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace invoice cash/credit fields with auditable cash, bank-transfer, cheque, and pay-later settlement while preserving invoice pricing, stock, booked-order, commission, and print behavior.

**Architecture:** Payment rows become settlement source of truth. One transaction-scoped service owns payment state changes, wallet movements, invoice/slip/customer cached totals, and timeline events. Online invoice creation, later recovery, batch recovery, finance verification, reports, and future offline import call this service instead of changing balances directly.

**Tech Stack:** TanStack Start server functions, React 19, TanStack Query, TanStack Form, Zod 4, Drizzle ORM, PostgreSQL, Big.js, Vitest, fast-check.

## Global Constraints

- User-facing terms are **Paid Amount**, **Outstanding Amount**, **Payment Due Date**, **Pending Verification**, **Cheque Cleared**, and **Cheque Returned**.
- Help text for Cheque Returned is exactly: `Bank did not clear this cheque.`
- Methods supported by invoice and recovery workflows: cash, bank transfer, cheque, and pay later. `expense_offset` remains internal recovery behavior.
- Cash confirms immediately. Bank transfer and cheque start pending.
- Pending instruments remain inside Outstanding Amount until confirmation.
- Confirmed plus pending allocation must never exceed invoice total.
- Cash requires a cash wallet. Bank transfer and cheque require a bank wallet.
- No JazzCash, Easypaisa, other mobile-wallet, payment-provider, FBR, or tax integration.
- Online direct and booked-order invoices both use `INV-...` from online-only transactional counter.
- Internal `sNo` must never determine public invoice number after migration.
- Confirmed payments are never edited or deleted. Use explicit reversal with required reason.
- Existing distributor and retailer/general print component markup must not change.
- `src/components/sales/distributor-invoice.tsx` SHA-256 must remain `a7bd30681352e5feff55a62e207b9850a0b56e5b2d0f819486629eabbf8dde79`.
- `src/components/sales/retailer-invoice.tsx` SHA-256 must remain `97800f9654ab58ac882fc2e1629d7417e0797372cbd6b39970b695b2af870d25`.
- No database reset. Generate and review Drizzle migration.
- Do not edit `src/routeTree.gen.ts`; build regenerates it.
- After code changes, run `graphify update .`.
- Approved design: `docs/superpowers/specs/2026-08-10-invoice-settlement-redesign-design.md`.

## Known Baseline Blockers

- On 2026-08-10, `bun run test` reported 61 files and 392 tests passed, but exited 1 because three workers timed out while starting. Those three files passed with `--maxWorkers=1`.
- On 2026-08-10, `bun run typecheck` exited 2 with pre-existing errors across charts, inventory, attendance, suppliers, and other modules.
- Every task must leave focused tests green and add no new TypeScript errors. Feature cannot be called production-ready until repository-wide `bun run test`, `bun run typecheck`, and `bun run build` all exit 0.

## File Structure

### Settlement domain

- Create `src/lib/sales/settlement/contracts.ts`: payment/status/source schemas and serializable request types.
- Create `src/lib/sales/settlement/money.ts`: one Big.js two-decimal helper.
- Create `src/lib/sales/settlement/math.ts`: pure allocation and invoice aggregate calculation.
- Create `src/lib/sales/settlement/math.test.ts`: examples and property tests.
- Create `src/lib/sales/invoice-number.ts`: pure public-number formatters.
- Create `src/lib/sales/invoice-number.server.ts`: transactional online allocation and offline serial reservation.
- Create `src/lib/sales/invoice-number.test.ts`: format and source-contract tests.

### Database

- Modify `src/db/schemas/sales-schema.ts`: clear invoice/customer aggregate names, public number, source, payment status, counter table, and unique order link.
- Modify `src/db/schemas/sales-erp-schema.ts`: payment lifecycle/audit fields and clear slip aggregates.
- Modify `src/db/schemas/finance-schema.ts`: transaction effective/reversal fields and indexes.
- Modify `src/db/index.ts`: export invoice number counter.
- Create `src/db/migrations/0009_invoice_settlement_redesign.sql` and Drizzle metadata.
- Create `src/db/schemas/invoice-settlement-schema.test.ts`: schema constraints and indexes.

### Server domain

- Create `src/server-functions/sales/settlement-service.ts`: transaction-only payment and aggregate operations.
- Create `src/server-functions/sales/settlement-service.test.ts`: pure/source boundary tests.
- Create `src/server-functions/sales/invoice-posting-service.ts`: shared invoice transaction body.
- Create `src/server-functions/sales/invoice-posting-service.test.ts`: source contract for stock/order/commission/settlement atomicity.
- Create `src/server-functions/sales/payment-settlement-fn.ts`: pending queue, confirm, clear, return, cancel, and reverse server functions.
- Modify `src/server-functions/sales/invoices-fn.ts`: thin wrappers over posting/settlement services and new columns.
- Modify `src/server-functions/sales/reconciliation-fn.ts`: recovery and batch recovery through settlement service.
- Modify `src/server-functions/sales/payments-fn.ts`: expense offset through settlement service and effective-date filtering.
- Modify `src/server-functions/sales/sales-returns-fn.ts`: clear aggregate names and settlement recalculation.
- Modify `src/server-functions/sales/invoice-detail-fn.ts`, `src/server-functions/sales/credit-recovery-fn.ts`, `src/server-functions/sales/overdue-detection-fn.ts`, `src/server-functions/sales/customers-fn.ts`, `src/server-functions/sales/sales-config-fn.ts`, `src/server-functions/sales/order-booker-self-service-fn.ts`, and `src/server-functions/sales/ledger-fn.ts`: new source-of-truth fields and labels.

### Client and reports

- Modify `src/db/zod_schemas.ts`: repeatable payment inputs and Payment Due Date.
- Create `src/components/sales/create-invoice-form/payment-rows-field.tsx`: method rows and method-specific fields.
- Modify `src/components/sales/create-invoice-form.tsx` and `src/components/sales/create-invoice-form/settlement-section.tsx`: settlement UX.
- Modify `src/components/sales/invoice-detail-sheet.tsx` and `src/routes/_protected/sales/invoices/$invoiceId/index.tsx`: payment badges, audit times, and finance actions.
- Create `src/components/finance/payment-verification-page.tsx`: pending bank/cheque queue.
- Create `src/hooks/sales/use-payment-settlement.ts`: finance mutations and invalidation.
- Create `src/routes/_protected/finance/payment-verification.tsx`: protected finance route.
- Modify `src/lib/rbac.ts`, `src/lib/middlewares.ts`, `src/lib/constants.ts`: verification/reversal permissions and navigation.
- Modify `src/server-functions/reports/sales-report-fn.ts` and `src/routes/_protected/reports/sales/index.tsx`: Paid/Outstanding columns.
- Create `src/server-functions/reports/collections-report-fn.ts` and `src/routes/_protected/reports/collections/index.tsx`: confirmed and pending method reporting.
- Rename `src/server-functions/reports/credits-report-fn.ts` to `src/server-functions/reports/outstanding-report-fn.ts`.
- Rename `src/routes/_protected/reports/credits/index.tsx` to `src/routes/_protected/reports/outstanding/index.tsx`.
- Modify `src/routes/_protected/reports/index.tsx`: Sales, Collections, and Outstanding cards.
- Modify `src/server-functions/reports/profit-loss/company-reporting-core.ts` and `src/server-functions/reports/profit-loss/export-csv-fn.ts`: wallet effective dates and public invoice number.
- Modify customer/recovery/ledger components listed in Task 8 for plain terminology.

---

### Task 1: Settlement Contracts and Exact Money Math

**Files:**
- Create: `src/lib/sales/settlement/contracts.ts`
- Create: `src/lib/sales/settlement/money.ts`
- Create: `src/lib/sales/settlement/math.ts`
- Create: `src/lib/sales/settlement/math.test.ts`
- Modify: `src/lib/sales/invoice-line-pricing.ts`

**Interfaces:**
- Produces `PaymentMethod`, `PaymentStatus`, `PaymentSource`, `PaymentInput`, `SettlementPayment`, and `SettlementTotals`.
- Produces `roundMoney(value: BigSource): number` and `moneyString(value: BigSource): string`.
- Produces `calculateSettlement(totalPrice: number, payments: SettlementPayment[]): SettlementTotals`.
- Produces `assertSettlementDueDate(totals: SettlementTotals, paymentDueDate?: Date | null): void`.

- [ ] **Step 1: Write failing unit and property tests**

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calculateSettlement } from "./math";

describe("invoice settlement math", () => {
  it("keeps pending instruments inside outstanding amount", () => {
    expect(calculateSettlement(100_000, [
      { amount: 50_000, status: "confirmed", method: "cash" },
      { amount: 10_000, status: "pending", method: "cheque" },
    ])).toEqual({
      totalPrice: 100_000,
      paidAmount: 50_000,
      pendingAmount: 10_000,
      outstandingAmount: 50_000,
      payLaterAmount: 40_000,
      paymentStatus: "partially_paid",
    });
  });

  it("rejects confirmed plus pending allocation above invoice total", () => {
    expect(() => calculateSettlement(100, [
      { amount: 80, status: "confirmed", method: "cash" },
      { amount: 30, status: "pending", method: "bank_transfer" },
    ])).toThrow("Payments cannot exceed invoice total");
  });

  it("always preserves paid plus outstanding equation", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10_000_000 }),
      fc.integer({ min: 0, max: 10_000_000 }),
      (totalPaisa, paidCandidate) => {
        const paidPaisa = Math.min(totalPaisa, paidCandidate);
        const result = calculateSettlement(totalPaisa / 100, paidPaisa === 0 ? [] : [
          { amount: paidPaisa / 100, status: "confirmed", method: "cash" },
        ]);
        expect(result.paidAmount + result.outstandingAmount).toBe(result.totalPrice);
      },
    ));
  });
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run: `bunx vitest run src/lib/sales/settlement/math.test.ts --maxWorkers=1`

Expected: FAIL because settlement modules do not exist.

- [ ] **Step 3: Implement schemas and math**

```ts
// contracts.ts
import { z } from "zod";

export const paymentMethodSchema = z.enum(["cash", "bank_transfer", "cheque", "expense_offset"]);
export const paymentStatusSchema = z.enum(["pending", "confirmed", "returned", "cancelled", "reversed"]);
export const paymentSourceSchema = z.enum(["invoice_creation", "recovery", "offline_import", "adjustment"]);
export const invoicePaymentStatusSchema = z.enum(["unpaid", "partially_paid", "paid"]);

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentSource = z.infer<typeof paymentSourceSchema>;
export type InvoicePaymentStatus = z.infer<typeof invoicePaymentStatusSchema>;

export type PaymentInput = {
  method: Exclude<PaymentMethod, "expense_offset">;
  amount: number;
  walletId: string;
  reference?: string;
  chequeNumber?: string;
  chequeBank?: string;
  chequeDate?: Date;
  paymentDate: Date;
  sourceRecordId?: string;
};

export type SettlementPayment = Pick<PaymentInput, "amount" | "method"> & {
  status: PaymentStatus;
};

export type SettlementTotals = {
  totalPrice: number;
  paidAmount: number;
  pendingAmount: number;
  outstandingAmount: number;
  payLaterAmount: number;
  paymentStatus: InvoicePaymentStatus;
};
```

```ts
// money.ts
import Big, { type BigSource } from "big.js";

export function roundMoney(value: BigSource) {
  const result = Number(new Big(value).round(2, Big.roundHalfUp).toString());
  if (!Number.isFinite(result)) throw new Error("Money amount must be finite");
  return result;
}

export function moneyString(value: BigSource) {
  return new Big(roundMoney(value)).toFixed(2);
}
```

```ts
// math.ts
import Big from "big.js";
import type { SettlementPayment, SettlementTotals } from "./contracts";
import { roundMoney } from "./money";

export function calculateSettlement(totalPrice: number, payments: SettlementPayment[]): SettlementTotals {
  const total = roundMoney(totalPrice);
  if (total < 0) throw new Error("Invoice total cannot be negative");
  for (const payment of payments) {
    if (!Number.isFinite(payment.amount) || roundMoney(payment.amount) <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }
  }
  const confirmed = payments.filter((row) => row.status === "confirmed");
  const pending = payments.filter((row) => row.status === "pending");
  const paidAmount = roundMoney(confirmed.reduce((sum, row) => new Big(sum).plus(row.amount).toNumber(), 0));
  const pendingAmount = roundMoney(pending.reduce((sum, row) => new Big(sum).plus(row.amount).toNumber(), 0));
  if (roundMoney(new Big(paidAmount).plus(pendingAmount).toNumber()) > total) {
    throw new Error("Payments cannot exceed invoice total");
  }
  const outstandingAmount = roundMoney(new Big(total).minus(paidAmount).toNumber());
  const payLaterAmount = roundMoney(new Big(outstandingAmount).minus(pendingAmount).toNumber());
  const paymentStatus = paidAmount === 0 ? "unpaid" : outstandingAmount === 0 ? "paid" : "partially_paid";
  return { totalPrice: total, paidAmount, pendingAmount, outstandingAmount, payLaterAmount, paymentStatus };
}

export function assertSettlementDueDate(totals: SettlementTotals, paymentDueDate?: Date | null) {
  if (totals.payLaterAmount > 0 && !paymentDueDate) {
    throw new Error("Payment Due Date is required when an amount remains payable later");
  }
}
```

Update `invoice-line-pricing.ts` to import `roundMoney` from `@/lib/sales/settlement/money` and delete its local copy.

- [ ] **Step 4: Run focused tests**

Run: `bunx vitest run src/lib/sales/settlement/math.test.ts src/lib/invoice-form-regressions.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/settlement src/lib/sales/invoice-line-pricing.ts src/lib/invoice-form-regressions.test.ts
git commit -m "feat: add invoice settlement domain math"
```

---

### Task 2: Settlement Schema and Safe Migration

**Files:**
- Modify: `src/db/schemas/sales-schema.ts`
- Modify: `src/db/schemas/sales-erp-schema.ts`
- Modify: `src/db/schemas/finance-schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/schemas/invoice-settlement-schema.test.ts`
- Create: `src/db/migrations/0009_invoice_settlement_redesign.sql`
- Create: `src/db/migrations/meta/0009_snapshot.json`
- Modify: `src/db/migrations/meta/_journal.json`

**Interfaces:**
- Produces `invoiceNumberCounters` with keys `online` and `offline`.
- Produces invoice columns `invoiceNumber`, `source`, `paidAmount`, `outstandingAmount`, `paymentDueDate`, `paymentStatus`.
- Produces customer columns `totalPaidAmount`, `outstandingAmount`.
- Produces payment lifecycle and slip aggregate fields from approved design.

- [ ] **Step 1: Write failing schema contract test**

Use `getTableConfig` and assert exact table/column/index/check names:

```ts
expect(getTableConfig(invoiceNumberCounters).name).toBe("invoice_number_counters");
expect(getTableConfig(invoices).uniqueIndexes.map((row) => row.config.name)).toContain("invoices_invoice_number_unique");
expect(getTableConfig(invoices).uniqueIndexes.map((row) => row.config.name)).toContain("invoices_order_id_unique");
expect(getTableConfig(payments).checks.map((row) => row.name)).toEqual(expect.arrayContaining([
  "payments_amount_positive_check",
  "payments_method_status_check",
  "payments_resolution_check",
]));
expect(getTableConfig(payments).uniqueIndexes.map((row) => row.config.name)).toContain("payments_source_record_unique");
```

- [ ] **Step 2: Run test and verify failure**

Run: `bunx vitest run src/db/schemas/invoice-settlement-schema.test.ts --maxWorkers=1`

Expected: FAIL on missing columns/table.

- [ ] **Step 3: Change Drizzle schema**

Use typed text enums and timezone-aware timestamps. Apply these exact business fields:

```ts
export const invoiceNumberCounters = pgTable("invoice_number_counters", {
  kind: text("kind", { enum: ["online", "offline"] }).primaryKey(),
  nextValue: integer("next_value").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("invoice_number_counters_next_value_check", sql`${table.nextValue} > 0`),
]);
```

Rename customer `payment` to `totalPaidAmount` and `credit` to `outstandingAmount`. Replace invoice `cash`, `credit`, `creditReturnDate`, and `slipNumber` with:

```ts
invoiceNumber: text("invoice_number").notNull(),
source: text("source", { enum: ["online", "offline_import"] }).notNull().default("online"),
paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
outstandingAmount: decimal("outstanding_amount", { precision: 12, scale: 2 }).notNull().default("0"),
paymentDueDate: timestamp("payment_due_date", { withTimezone: true }),
paymentStatus: text("payment_status", { enum: ["unpaid", "partially_paid", "paid"] }).notNull().default("unpaid"),
```

Keep lifecycle `status` limited to `saved | voided`. Add unique indexes for `invoiceNumber` and non-null `orderId`.

Replace payment fields with approved lifecycle fields, including `walletId`, `status`, cheque fields, `paymentDate`, `effectiveDate`, `source`, `sourceRecordId`, `allocationGroupId`, confirmer/resolver audit, and resolution reason. Replace slip aggregates with `invoiceAmount`, `paidAmount`, and `outstandingAmount`. Add `effectiveDate` and self-referencing `reversalOfTransactionId` to finance transactions.

- [ ] **Step 4: Generate and harden migration**

Run: `bun run db:generate`

Rename generated SQL tag to `0009_invoice_settlement_redesign`. Review SQL so it performs this order without resetting database:

1. Rename customer and invoice columns where semantics match.
2. Add nullable public number, source, and payment lifecycle columns.
3. Backfill invoice numbers from existing `slip_number`, falling back to `INV-<s_no>`.
4. Seed counter `online.next_value` to `max(s_no)+1`; seed `offline.next_value` to `1`.
5. Backfill existing payment method `invoice_cash` to `cash`, status to `confirmed`, source from note/method, `payment_date` to `effective_date`, and wallet from matching transaction or invoice account.
6. Backfill slip totals from joined invoice `total_price`, `paid_amount`, and `outstanding_amount`.
7. Add NOT NULL, check, foreign-key, and unique constraints after backfill.
8. Drop replaced old columns only after all new fields are populated.

Migration must contain no `TRUNCATE`, `DROP TABLE`, or database reset.

- [ ] **Step 5: Run schema and migration source tests**

Run: `bunx vitest run src/db/schemas/invoice-settlement-schema.test.ts src/lib/sales-workflows.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schemas/sales-schema.ts src/db/schemas/sales-erp-schema.ts src/db/schemas/finance-schema.ts src/db/index.ts src/db/schemas/invoice-settlement-schema.test.ts src/db/migrations
git commit -m "feat: migrate invoice settlement schema"
```

---

### Task 3: Transactional Public Invoice Numbering

**Files:**
- Create: `src/lib/sales/invoice-number.ts`
- Create: `src/lib/sales/invoice-number.server.ts`
- Create: `src/lib/sales/invoice-number.test.ts`
- Test: `src/__tests__/integration/invoice-number.integration.test.ts`

**Interfaces:**
- Produces `formatOnlineInvoiceNumber(serial: number): string`.
- Produces `formatOfflineInvoiceNumber(factoryCode: string, businessDate: string, serial: number): string`.
- Produces `allocateOnlineInvoiceNumber(tx: SalesTransaction): Promise<string>`.
- Produces `reserveOfflineInvoiceSerials(tx: SalesTransaction, count: number): Promise<{ start: number; end: number }>`.

Use the project database transaction type instead of inventing a loose interface:

```ts
import { db } from "@/db";

export type SalesTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

- [ ] **Step 1: Write failing formatter and concurrency tests**

```ts
expect(formatOnlineInvoiceNumber(42)).toBe("INV-42");
expect(formatOfflineInvoiceNumber("F01", "2026-08-10", 7)).toBe("OFF-F01-20260810-007");
expect(() => formatOfflineInvoiceNumber("F 01", "2026-08-10", 7)).toThrow("Factory code is invalid");
```

Integration test opens two concurrent transactions, allocates online numbers, and asserts distinct sequential values. A rolled-back allocation must be reused by next successful transaction.

- [ ] **Step 2: Implement formatter and atomic counter update**

```ts
export function formatOnlineInvoiceNumber(serial: number) {
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error("Invoice serial is invalid");
  return `INV-${serial}`;
}

export function formatOfflineInvoiceNumber(factoryCode: string, businessDate: string, serial: number) {
  if (!/^F\d{2}$/.test(factoryCode)) throw new Error("Factory code is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("Business date is invalid");
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error("Invoice serial is invalid");
  return `OFF-${factoryCode}-${businessDate.replaceAll("-", "")}-${String(serial).padStart(3, "0")}`;
}
```

Use one atomic `UPDATE ... RETURNING` against counter row inside caller transaction:

```ts
const [row] = await tx.execute<{ start: number }>(sql`
  UPDATE invoice_number_counters
  SET next_value = next_value + ${count}, updated_at = now()
  WHERE kind = ${kind}
  RETURNING next_value - ${count} AS start
`);
if (!row) throw new Error(`Invoice number counter ${kind} is missing`);
```

- [ ] **Step 3: Run tests**

Run: `bunx vitest run src/lib/sales/invoice-number.test.ts --maxWorkers=1`

When test PostgreSQL is available, run: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/invoice-number.integration.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sales/invoice-number.ts src/lib/sales/invoice-number.server.ts src/lib/sales/invoice-number.test.ts src/__tests__/integration/invoice-number.integration.test.ts
git commit -m "feat: allocate public invoice numbers transactionally"
```

---

### Task 4: Central Settlement Transaction Service

**Files:**
- Create: `src/server-functions/sales/settlement-service.ts`
- Create: `src/server-functions/sales/settlement-service.test.ts`
- Test: `src/__tests__/integration/settlement-service.integration.test.ts`

**Interfaces:**
- Defines `type PaymentRecord = typeof payments.$inferSelect`.
- Produces `createInitialPayments(tx, input): Promise<PaymentRecord[]>`.
- Produces `recordRecoveryPayment(tx, input): Promise<PaymentRecord>`.
- Produces `recalculateInvoiceSettlement(tx, invoiceId): Promise<SettlementTotals>`.
- Produces `confirmPendingPayment(tx, input): Promise<PaymentRecord>`.
- Produces `resolvePendingPayment(tx, input): Promise<PaymentRecord>`.
- Produces `reverseConfirmedPayment(tx, input): Promise<PaymentRecord>`.
- Every public function requires caller-owned transaction and actor ID.

- [ ] **Step 1: Write failing service contract tests**

Assert source contains conditional state transitions, invoice row lock, unique wallet movement source, and no direct mutation exported outside service:

```ts
expect(source).toContain("FOR UPDATE");
expect(source).toContain("eq(payments.status, \"pending\")");
expect(source).toContain("recalculateInvoiceSettlement");
expect(source).toContain("Customer Payment Reversal");
```

Integration cases: initial cash credits wallet once; bank/cheque pending credits nothing; simultaneous confirm has one success; returned cheque credits nothing; reversal debits once; confirmed+pending above total rolls back.

- [ ] **Step 2: Implement shared operations**

Use exact transition input:

```ts
export type ConfirmPaymentInput = {
  paymentId: string;
  actorId: string;
  effectiveDate: Date;
};

export type ResolvePaymentInput = {
  paymentId: string;
  actorId: string;
  resolution: "returned" | "cancelled";
  reason: string;
  paymentDueDate?: Date;
};

export type ReversePaymentInput = {
  paymentId: string;
  actorId: string;
  effectiveDate: Date;
  reason: string;
};
```

For every operation:

1. Lock invoice row using `SELECT id FROM invoices WHERE id = ... FOR UPDATE`.
2. Insert or conditionally transition payment.
3. Create wallet transaction only for confirmed cash/bank/cheque.
4. Set wallet transaction `effectiveDate` from payment business event.
5. Recalculate from payment rows and update invoice, slip, and customer by old/new delta.
6. Write invoice timeline event.
7. Return within caller transaction.

Use conditional update and reject zero returned rows:

```ts
const [changed] = await tx.update(payments).set({
  status: "confirmed",
  effectiveDate: input.effectiveDate,
  confirmedById: input.actorId,
  confirmedAt: new Date(),
}).where(and(eq(payments.id, input.paymentId), eq(payments.status, "pending"))).returning();
if (!changed) throw new Error("Payment is no longer pending");
```

For `expense_offset`, recalculate settlement but do not create customer-payment wallet credit. Existing expense workflow still creates its separate expense debit.

- [ ] **Step 3: Run focused and integration tests**

Run: `bunx vitest run src/server-functions/sales/settlement-service.test.ts src/lib/sales/settlement/math.test.ts --maxWorkers=1`

When test PostgreSQL is available, run settlement integration file with `vitest.integration.config.ts` and `--maxWorkers=1`.

Expected: PASS with wallet balance changed exactly once per confirmed or reversed payment.

- [ ] **Step 4: Commit**

```bash
git add src/server-functions/sales/settlement-service.ts src/server-functions/sales/settlement-service.test.ts src/__tests__/integration/settlement-service.integration.test.ts
git commit -m "feat: centralize invoice settlement transactions"
```

---

### Task 5: Shared Invoice Posting and Online Invoice Integration

**Files:**
- Create: `src/server-functions/sales/invoice-posting-service.ts`
- Create: `src/server-functions/sales/invoice-posting-service.test.ts`
- Modify: `src/server-functions/sales/invoices-fn.ts`
- Modify: `src/db/zod_schemas.ts`
- Modify: `src/server-functions/sales/order-booker-commission-calc.ts`
- Modify: `src/lib/sales-workflows.test.ts`

**Interfaces:**
- Defines `type PostedInvoice = typeof invoices.$inferSelect`.
- Produces `postInvoice(tx, input): Promise<PostedInvoice>` used by online now and offline plan later.
- Consumes `allocateOnlineInvoiceNumber`, `createInitialPayments`, and `recalculateInvoiceSettlement`.
- `CreateInvoiceInput` replaces `account`, `cash`, `credit`, and `creditReturnDate` with `payments` and `paymentDueDate`.

- [ ] **Step 1: Write failing posting contract tests**

Assert both direct and booked-order paths call one posting function; public number is allocated inside transaction; stock, order delivery, commission, payments, wallet, customer, slip, and timeline share same transaction; submitted totals and distributor prices remain untrusted.

- [ ] **Step 2: Replace invoice input schema**

```ts
const invoicePaymentInputSchema = z.object({
  method: z.enum(["cash", "bank_transfer", "cheque"]),
  amount: z.number().positive(),
  walletId: z.string().min(1),
  reference: z.string().trim().min(1).optional(),
  chequeNumber: z.string().trim().min(1).optional(),
  chequeBank: z.string().trim().min(1).optional(),
  chequeDate: z.coerce.date().optional(),
  paymentDate: z.coerce.date(),
}).superRefine((row, ctx) => {
  if (row.method === "bank_transfer" && !row.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Bank reference is required" });
  if (row.method === "cheque") {
    if (!row.chequeNumber) ctx.addIssue({ code: "custom", path: ["chequeNumber"], message: "Cheque number is required" });
    if (!row.chequeBank) ctx.addIssue({ code: "custom", path: ["chequeBank"], message: "Cheque bank is required" });
    if (!row.chequeDate) ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Cheque date is required" });
  }
});
```

Add `payments: z.array(invoicePaymentInputSchema).default([])` and `paymentDueDate: z.coerce.date().optional()`.

- [ ] **Step 3: Extract posting service and make `createInvoiceFn` thin**

```ts
export type PostInvoiceInput = CreateInvoiceInput & {
  performedById: string;
  source: "online" | "offline_import";
  businessDate: Date;
  publicInvoiceNumber?: string;
  stockPolicy: "strict";
};
```

Online handler must be:

```ts
return db.transaction(async (tx) => postInvoice(tx, {
  ...data,
  performedById: context.session.user.id,
  source: "online",
  businessDate: new Date(),
  stockPolicy: "strict",
}));
```

Move existing server-authoritative customer resolution, price/discount calculation, factory stock validation/deduction, order duplicate check, delivery, and commission into `postInvoice`. Replace direct payment/wallet/customer/slip writes with settlement service calls. Store `invoiceNumber` once and use same value as slip number.

- [ ] **Step 4: Restrict update/delete safely**

- Update may change items/expenses/remarks only when no returns exist and total remains at least confirmed plus pending allocation. Payment rows remain unchanged. Payment Due Date may change.
- Delete is blocked until pending instruments are cancelled/returned and confirmed payments are explicitly reversed.
- Offline-source invoices are never edited or hard-deleted by online invoice functions.

Use plain errors:

```ts
throw new AppError("Reverse confirmed payments before deleting this invoice.", "INVOICE_HAS_CONFIRMED_PAYMENTS", 400);
```

- [ ] **Step 5: Run focused tests**

Run: `bunx vitest run src/server-functions/sales/invoice-posting-service.test.ts src/lib/sales-workflows.test.ts src/lib/invoice-form-regressions.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/sales/invoice-posting-service.ts src/server-functions/sales/invoice-posting-service.test.ts src/server-functions/sales/invoices-fn.ts src/server-functions/sales/order-booker-commission-calc.ts src/db/zod_schemas.ts src/lib/sales-workflows.test.ts
git commit -m "refactor: route invoice posting through settlement service"
```

---

### Task 6: Recovery, Verification, Cheque Return, and Reversal

**Files:**
- Create: `src/server-functions/sales/payment-settlement-fn.ts`
- Create: `src/server-functions/sales/payment-settlement-fn.test.ts`
- Modify: `src/server-functions/sales/reconciliation-fn.ts`
- Modify: `src/server-functions/sales/payments-fn.ts`
- Modify: `src/server-functions/sales/credit-recovery-fn.ts`
- Create: `src/hooks/sales/use-payment-settlement.ts`
- Create: `src/components/finance/payment-verification-page.tsx`
- Create: `src/routes/_protected/finance/payment-verification.tsx`
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/middlewares.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/rbac.test.ts`

**Interfaces:**
- Produces `getPendingPaymentVerificationFn`, `confirmBankTransferFn`, `clearChequeFn`, `returnChequeFn`, `cancelBankTransferFn`, and `reversePaymentFn`.
- Produces permissions `finance.payments.verify` and `finance.payments.reverse`.

- [ ] **Step 1: Write failing RBAC and transition tests**

Assert admin and finance-manager receive both permissions, server functions use exact permission middleware, cheque-return copy is exact, and every mutation calls settlement service rather than changing wallet/customer/invoice fields.

- [ ] **Step 2: Add server functions and validation**

```ts
const confirmSchema = z.object({
  paymentId: z.string().min(1),
  effectiveDate: z.coerce.date(),
});

const resolveSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  paymentDueDate: z.coerce.date().optional(),
});

const reverseSchema = resolveSchema.extend({ effectiveDate: z.coerce.date() });
```

Pending query returns method, amount, invoice number, customer, wallet, reference/cheque details, receipt date, and age. Confirmation verifies method matches action. Return action is cheque-only. Cancellation is bank-transfer-only. Reversal is confirmed-only.

- [ ] **Step 3: Refactor single and batch recovery**

Both `reconcileSlipFn` and `batchReconcileSlipsFn` call `recordRecoveryPayment`. Batch rows share one generated `allocationGroupId`; each invoice remains transactionally valid. Remove direct changes to invoice, customer, slip, wallet, transaction, and payment tables from reconciliation functions.

Expense offset creates expense and expense wallet debit, then records confirmed `expense_offset` payment through settlement service. It never creates a customer-payment wallet credit.

- [ ] **Step 4: Build finance verification page**

Use two tabs: `Pending Verification` and `Payment History`. Each row shows invoice, customer, method, amount, received date, reference/cheque details, and destination account. Actions open confirmation dialogs requiring effective date. Returned/cancelled/reversed actions require a reason; require Payment Due Date when resolving the payment leaves any true pay-later amount.

Disable buttons while mutation is pending. Keep dialog values after server error. Use `Cheque Returned` and help text `Bank did not clear this cheque.`

- [ ] **Step 5: Run tests**

Run: `bunx vitest run src/server-functions/sales/payment-settlement-fn.test.ts src/lib/rbac.test.ts src/lib/sales-workflows.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/sales/payment-settlement-fn.ts src/server-functions/sales/payment-settlement-fn.test.ts src/server-functions/sales/reconciliation-fn.ts src/server-functions/sales/payments-fn.ts src/server-functions/sales/credit-recovery-fn.ts src/hooks/sales/use-payment-settlement.ts src/components/finance/payment-verification-page.tsx src/routes/_protected/finance/payment-verification.tsx src/lib/rbac.ts src/lib/middlewares.ts src/lib/constants.ts src/lib/rbac.test.ts
git commit -m "feat: add payment verification and reversal workflows"
```

---

### Task 7: Online Invoice Settlement UI and Detail UX

**Files:**
- Create: `src/components/sales/create-invoice-form/payment-rows-field.tsx`
- Create: `src/components/sales/create-invoice-form/payment-rows-field.test.tsx`
- Modify: `src/components/sales/create-invoice-form.tsx`
- Modify: `src/components/sales/create-invoice-form/settlement-section.tsx`
- Modify: `src/components/sales/invoice-detail-sheet.tsx`
- Modify: `src/routes/_protected/sales/invoices/$invoiceId/index.tsx`
- Modify: `src/server-functions/sales/invoice-detail-fn.ts`
- Modify: `src/hooks/sales/use-invoices.ts`
- Modify: `src/lib/invoice-form-regressions.test.ts`

**Interfaces:**
- Form field `payments` uses `PaymentInput[]`.
- Detail response exposes invoice aggregate fields and full payment lifecycle/audit fields.

- [ ] **Step 1: Write failing component and source tests**

Cover add/remove rows, method-specific fields, wallet-type filtering, mixed total, pending amount, pay-later amount, required due date, over-allocation, duplicate submit lock, retained values on failure, and edit-mode read-only payment history.

- [ ] **Step 2: Build repeatable payment rows**

Method choices are exactly `Cash`, `Bank Transfer`, and `Cheque`. Filter wallets by `cash` for cash and `bank` for transfer/cheque. Each row has amount and destination account. Transfer adds transaction reference. Cheque adds bank, number, and date. Duplicate local rows compare normalized method, amount, wallet, and instrument fields.

- [ ] **Step 3: Replace settlement summary**

Show these four values in order:

```text
Invoice Total
Paid Amount
Pending Verification
Outstanding Amount
```

Show `Payment Due Date` only when `payLaterAmount > 0`. Submit payload contains no `cash`, `credit`, `account`, or `creditReturnDate`.

- [ ] **Step 4: Update detail screens**

Payment rows display status badges and separate business/audit dates. Pending bank/cheque is not colored as received money. Returned cheque uses destructive badge plus approved help text. Reversed payment remains visible. Invoice KPI labels are Total Amount, Paid Amount, Pending Verification, and Outstanding Amount.

- [ ] **Step 5: Run UI tests**

Run: `bunx vitest run src/components/sales/create-invoice-form/payment-rows-field.test.tsx src/lib/invoice-form-regressions.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/create-invoice-form src/components/sales/create-invoice-form.tsx src/components/sales/invoice-detail-sheet.tsx 'src/routes/_protected/sales/invoices/$invoiceId/index.tsx' src/server-functions/sales/invoice-detail-fn.ts src/hooks/sales/use-invoices.ts src/lib/invoice-form-regressions.test.ts
git commit -m "feat: upgrade invoice settlement experience"
```

---

### Task 8: Ledgers, Reports, and Plain Terminology

**Files:**
- Modify: `src/server-functions/sales/ledger-fn.ts`
- Modify: `src/lib/ledger-types.ts`
- Modify: `src/server-functions/sales/sales-returns-fn.ts`
- Modify: `src/server-functions/sales/customers-fn.ts`
- Modify: `src/server-functions/sales/sales-config-fn.ts`
- Modify: `src/server-functions/sales/order-booker-self-service-fn.ts`
- Modify: `src/server-functions/sales/overdue-detection-fn.ts`
- Modify: `src/server-functions/reports/sales-report-fn.ts`
- Create: `src/server-functions/reports/collections-report-fn.ts`
- Rename: `src/server-functions/reports/credits-report-fn.ts` to `src/server-functions/reports/outstanding-report-fn.ts`
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts`
- Modify: `src/server-functions/reports/profit-loss/export-csv-fn.ts`
- Modify: `src/routes/_protected/reports/index.tsx`
- Modify: `src/routes/_protected/reports/sales/index.tsx`
- Create: `src/routes/_protected/reports/collections/index.tsx`
- Rename: `src/routes/_protected/reports/credits/index.tsx` to `src/routes/_protected/reports/outstanding/index.tsx`
- Modify: `src/routes/_protected/sales/reconciliation/index.tsx`
- Modify: `src/routes/_protected/sales/recovery/index.tsx`
- Modify: `src/components/sales/batch-recoveries-dialog.tsx`
- Modify: `src/components/sales/recovery/recovery-detail-sheet.tsx`
- Modify: `src/components/sales/invoice-kpi-cards.tsx`
- Modify: `src/components/sales/invoices-table.tsx`
- Modify: `src/components/sales/customer-kpi-cards.tsx`
- Modify: `src/components/sales/customers-table.tsx`
- Modify: `src/components/sales/ledger-print-export.tsx`
- Modify: `src/routes/_protected/sales/customers/$customerId/index.tsx`
- Modify: `src/routes/_protected/sales/people/distributors/$customerId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/shopkeepers/$customerId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/salesmen/$salesmanId/ledger.tsx`
- Modify: `src/routes/_protected/sales/people/salesmen/$salesmanId/shops/$customerId.tsx`
- Test: `src/lib/invoice-settlement-reporting.test.ts`

**Interfaces:**
- Ledger event equation: invoice total debit, every confirmed payment credit, posted return/adjustment credit.
- Collection reports date confirmed rows by `effectiveDate`; pending reports date instruments by `paymentDate`.

- [ ] **Step 1: Write failing reporting and terminology tests**

Assert reports select `invoiceNumber`, `paidAmount`, `outstandingAmount`, confirmed method groups, payment `effectiveDate`, and no longer exclude `invoice_cash`. Read user-facing files and reject labels `Cash Received`, `Total Credit`, `Credit Outstanding`, `Credit Closed`, `Credit Return Date`, `Credits Report`, and `Bounced`.

- [ ] **Step 2: Rebuild ledger calculations**

Opening/running balance uses all non-voided invoices, all confirmed non-reversed payments, approved returns, and authorized adjustments. Remove every `ne(payments.method, "invoice_cash")` condition. Sort by business date plus stable ID. Current customer cached balance remains a cross-check, not ledger event source.

- [ ] **Step 3: Upgrade reports**

Sales report columns: Date, Invoice #, Customer, Type, Items, Paid Amount, Outstanding Amount, Total. Outstanding report uses invoice amount, Paid Amount, Outstanding Amount, due date, and recovery status without subtracting twice.

Collections report returns:

```ts
type CollectionsReport = {
  confirmed: Array<{ paymentId: string; invoiceNumber: string; customerName: string; method: "cash" | "bank_transfer" | "cheque"; amount: number; effectiveDate: string }>;
  pending: Array<{ paymentId: string; invoiceNumber: string; customerName: string; method: "bank_transfer" | "cheque"; amount: number; paymentDate: string }>;
  exceptions: Array<{ paymentId: string; invoiceNumber: string; status: "returned" | "cancelled" | "reversed"; amount: number; reason: string }>;
  summary: { cash: number; bankTransfer: number; cheque: number; pending: number };
};
```

Wallet and P&L transaction date filters use `transactions.effectiveDate`, while audit screens keep `createdAt`.

- [ ] **Step 4: Apply plain wording everywhere**

Use `Outstanding Recovery`, `Pay-Later Limit`, `Payment Due Date`, `Paid Amount`, and `Outstanding Amount`. Method label `Cash` remains valid only as payment method, not as invoice aggregate label.

- [ ] **Step 5: Run report and workflow tests**

Run: `bunx vitest run src/lib/invoice-settlement-reporting.test.ts src/lib/sales-workflows.test.ts src/lib/pnl-reporting.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/sales src/server-functions/reports src/lib/ledger-types.ts src/lib/invoice-settlement-reporting.test.ts src/lib/pnl-reporting.test.ts src/routes/_protected/reports src/routes/_protected/sales src/components/sales
git commit -m "feat: report paid and outstanding invoice amounts"
```

---

### Task 9: Print Guard, Full Verification, and Release Gate

**Files:**
- Create: `src/components/sales/invoice-print-layout-regression.test.ts`
- Create: `docs/operations/invoice-settlement-runbook.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces permanent regression guard for current invoice print source.
- Produces operator/finance drill and rollback checklist.

- [ ] **Step 1: Add exact print hash guard**

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sha(path: string) {
  return createHash("sha256").update(readFileSync(resolve(process.cwd(), path))).digest("hex");
}

describe("invoice print layout preservation", () => {
  it("preserves distributor invoice source exactly", () => {
    expect(sha("src/components/sales/distributor-invoice.tsx")).toBe("a7bd30681352e5feff55a62e207b9850a0b56e5b2d0f819486629eabbf8dde79");
  });
  it("preserves retailer invoice source and existing signatures exactly", () => {
    expect(sha("src/components/sales/retailer-invoice.tsx")).toBe("97800f9654ab58ac882fc2e1629d7417e0797372cbd6b39970b695b2af870d25");
  });
});
```

- [ ] **Step 2: Make tests required in CI with controlled worker count**

Change CI tests from non-blocking default run to required `bunx vitest run --maxWorkers=2`. Keep lint non-blocking. Keep typecheck visible; do not mark settlement release complete while it fails.

- [ ] **Step 3: Write operations drill**

Runbook covers full cash, full pay later, partial cash, mixed cash/transfer/cheque, pending verification, bank confirmation, bank cancellation, cheque clearance, Cheque Returned, replacement cash after return, batch allocation, reversal, booked-order commission, return, deletion block, wallet totals, ledger totals, reports, and unchanged print comparison.

- [ ] **Step 4: Run automated gates**

```bash
bunx vitest run src/lib/sales/settlement src/server-functions/sales src/lib/invoice-form-regressions.test.ts src/lib/sales-workflows.test.ts src/lib/invoice-settlement-reporting.test.ts src/components/sales/invoice-print-layout-regression.test.ts --maxWorkers=1
bunx vitest run --maxWorkers=2
bun run typecheck
bun run build
sha256sum src/components/sales/distributor-invoice.tsx src/components/sales/retailer-invoice.tsx
graphify update .
git diff --check
```

Expected: all commands exit 0 and print hashes equal Global Constraints. If global typecheck still contains pre-existing errors, feature remains blocked from production claim and errors must be resolved under separately approved cleanup work.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/invoice-print-layout-regression.test.ts docs/operations/invoice-settlement-runbook.md .github/workflows/ci.yml graphify-out
git commit -m "test: gate invoice settlement release"
```

Settlement foundation is complete only after manual drill passes. Offline sales plan starts afterward.
