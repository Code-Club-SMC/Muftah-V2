# Salary Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay generated payslips from a chosen Finance account (all or some), show "Paid from", allow changing the account, revising a paid slip, refunds, recovery from next salary and undo, with every money movement on the Ledger.

**Architecture:** A new `salary_payments` table holds one row per money event on a slip (`payment`, `refund`, `recovery`), linked to payroll + employee (never to the payslip row, because Revise deletes and re-inserts it). A slip's paid amount and status are derived by a pure helper from its active rows and its current net salary. Corrections never edit money: a row is marked `reversed` and a reversal Ledger line is written. Server logic lives in one `.server.ts` module that takes a transaction, so integration tests call it directly; thin `createServerFn` wrappers add permission checks.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, React + shadcn/ui, TanStack Query, date-fns, big.js, Vitest (jsdom unit/behaviour tests + `vitest.integration.config.ts` against a `_test` database).

**Spec:** `docs/superpowers/specs/2026-11-26-salary-payments-spec.md` (Option A: no Approve step).

## Global Constraints

- Generated migrations are immutable: never edit SQL, snapshots or `meta/_journal.json` under `src/db/migrations/`. Change the schema source and run `bun run db:generate`.
- Production has real data (one draft payroll, Nov 2026, no payments). The new table is additive; no backfill.
- Money maths uses `big.js`; amounts are stored and passed as 2-decimal strings. Money text uses `formatRupees` from `@/lib/finance/expense-entry` ("Rs 1,26,200").
- Overdraw is **blocked** for salaries (no override). Shortfall copy: `Cash in Hand has Rs 80,000. Needed Rs 1,28,424. Short by Rs 48,424.`
- Payment date: from the first day of the payroll month to today (Pakistan day, `reportDateKey(new Date())`). Future dates blocked. Reversal lines are dated today.
- Every payroll Ledger line has `source` = `Payroll - Nov 2026` and a description naming the employee and month.
- Write actions need `hr.manage` (middleware) **and** `finance.manage` (`requirePermission` in the handler). Reading needs `hr.view`.
- UI copy: "Pay selected", "Pay all unpaid", "Paid from", "Change account", "Undo payment", "Balance due", "Overpaid", "Nothing to pay", "Paid by distributor", "Recover from next month", "Refund received".
- Do not touch the order booker self-service portal. Do not remove the old Approve / Mark-as-paid server functions (an integration suite uses them); nothing new reads `payrolls.status`.
- User preference: no per-task review or browser walkthrough; do both once after all tasks (Task 12).
- Branch: `feat/salary-payments` from `main` if `feat/expenses-phase-7a` is merged, otherwise from `feat/expenses-phase-7a`.

## Decisions taken while checking the spec against the code (2026-11-27)

1. **Distributor-paid salaries** are stored by the sales desk as an approved salary advance whose reason starts with `Salary paid directly by distributor`. The advance is deducted on the next payslip, so the slip's net already excludes it. The payslip shows `Paid by distributor: Rs X` from that slip's advance installments. No status special-case is needed.
2. **Recover from next month** creates an approved one-installment salary advance for the overpaid amount (reason `Salary overpaid for Nov 2026 — taken back from the next salary`). The existing advance deduction takes it from the next generated slip. To stop a later Revise of the *same* month from deducting it immediately, advance deduction skips recovery advances recorded against the payroll being generated (Task 5).
3. **Undo** reverses every active row of one slip: recovery first (cancels its advance; blocked if a later slip already deducted it), then refunds, then payments.
4. **Change account** reverses each active `payment` row not already on the new account and re-pays the same amount from the new account on the chosen date.
5. **Ledger** shows, sorts and filters by `transactions.effective_date` (exists since migration 0000 and defaults to insert time, so old rows are unaffected). The "Payroll" source filter matches `Payroll - %`.
6. **Reports:** Monthly report drops the `approved/paid` status filter. Salaries report selects by payroll month and adds Paid from / Paid / Due. P&L puts a slip's gross on the date of its first active salary payment.
7. **Delete guards:** a payroll or employee with any salary payment row cannot be deleted.

## File map

- Create `src/lib/hr/salary-payments.ts` — pure status, date, ledger-text helpers.
- Modify `src/db/schemas/hr-schema.ts` — `salaryPayments` table + relations.
- Create `src/server-functions/hr/payroll/salary-payments.server.ts` — all reads/writes taking a transaction.
- Create `src/server-functions/hr/payroll/salary-payments-fn.ts` — server functions.
- Modify `src/server-functions/hr/payroll/core.ts` — skip same-month recovery advances.
- Modify `src/server-functions/hr/payroll/dashboard-fn.ts` — register payment data.
- Modify `src/server-functions/finance-fn.ts`, `src/components/finance/ledger-container.tsx` — Ledger.
- Modify `src/server-functions/reports/salaries-report-fn.ts`, `src/routes/_protected/reports/salaries/index.tsx`, `src/server-functions/reports/monthly-report-queries.server.ts`, `src/server-functions/reports/profit-loss/company-reporting-core.ts`.
- Modify `src/server-functions/hr/payroll/payroll-fn.ts`, `src/server-functions/hr/employees/delete-employee-fn.ts` — delete guards.
- Create `src/hooks/hr/use-salary-payments.ts`.
- Create `src/components/hr/payroll/salary-payment-badge.tsx`, `salary-account-dialog.tsx`, `salary-payment-actions.tsx`, `salary-payments-panel.tsx`.
- Modify `src/components/hr/payroll/payroll-container.tsx`, `salary-calculator-sheet.tsx`, `payslip-dialog.tsx`, `payslip-view.tsx`.
- Tests: `src/lib/hr/salary-payments.test.ts`, `src/db/schemas/salary-payments-schema.test.ts`, `src/__tests__/integration/salary-fixture.ts`, `src/__tests__/integration/salary-payments.test.ts`, `src/__tests__/integration/salary-ledger-reports.test.ts`, `src/server-functions/hr/payroll/salary-payments-fn.test.ts`, `src/server-functions/hr/payroll/salary-delete-guards.test.ts`, `src/__tests__/salary-account-dialog.behavior.test.tsx`.

Integration test command (apply migrations to the test DB first, once after Task 2):

```bash
DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts <file>
```

---

### Task 1: Pure salary payment helpers

**Files:**
- Create: `src/lib/hr/salary-payments.ts`
- Test: `src/lib/hr/salary-payments.test.ts`

**Interfaces:**
- Produces: `SALARY_PAYMENT_KINDS`, `SALARY_PAYMENT_STATUSES`, types `SalaryPaymentKind`, `SalaryPaymentStatus`, `SalaryPaymentLike`, `SlipPaymentStatus`, `SlipPaymentState`, `RegisterPaymentSummary`; `SLIP_PAYMENT_LABELS`, `PAYROLL_LEDGER_SOURCE_PREFIX`, `DISTRIBUTOR_SALARY_REASON_PREFIX`; functions `paidAmount(rows): Big`, `slipPaymentState(net, rows): SlipPaymentState`, `registerPaymentSummary(states)`, `firstDayOfPayrollMonth(month)`, `paymentDateError(dateKey, payrollMonth, todayKey): string | null`, `effectiveDateFromKey(dateKey): Date`, `payrollMonthLabel(month)`, `payrollLedgerSource(month)`, `salaryLedgerDescription(kind: "payment" | "refund", name, month)`, `salaryReversalDescription(name, month, reason)`, `overpaidRecoveryReason(month)`, `shortfallMessage(walletName, balance, needed)`, `isPayrollLedgerSource(source)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hr/salary-payments.test.ts
import { describe, expect, it } from "vitest";
import {
  effectiveDateFromKey,
  isPayrollLedgerSource,
  overpaidRecoveryReason,
  paymentDateError,
  payrollLedgerSource,
  registerPaymentSummary,
  salaryLedgerDescription,
  salaryReversalDescription,
  shortfallMessage,
  slipPaymentState,
  type SalaryPaymentLike,
} from "./salary-payments";

const pay = (amount: string, extra: Partial<SalaryPaymentLike> = {}): SalaryPaymentLike => ({ kind: "payment", amount, status: "active", ...extra });

describe("slipPaymentState", () => {
  it("is unpaid with no payments", () => {
    expect(slipPaymentState("26200.00", [])).toEqual({ status: "unpaid", net: "26200.00", paid: "0.00", due: "26200.00", overpaid: "0.00" });
  });
  it("is paid when payments equal net", () => {
    expect(slipPaymentState("26200.00", [pay("26200.00")]).status).toBe("paid");
  });
  it("shows balance due after a revision raises net", () => {
    expect(slipPaymentState("28200.00", [pay("26200.00")])).toMatchObject({ status: "balance_due", due: "2000.00" });
  });
  it("shows overpaid after a revision lowers net", () => {
    expect(slipPaymentState("23200.00", [pay("26200.00")])).toMatchObject({ status: "overpaid", overpaid: "3000.00", due: "0.00" });
  });
  it("counts refunds and recoveries against the paid amount and ignores reversed rows", () => {
    const rows = [pay("26200.00"), pay("26200.00", { status: "reversed" }), pay("3000.00", { kind: "refund" })];
    expect(slipPaymentState("23200.00", rows)).toMatchObject({ status: "paid", paid: "23200.00" });
    expect(slipPaymentState("23200.00", [pay("26200.00"), pay("3000.00", { kind: "recovery" })]).status).toBe("paid");
  });
  it("has nothing to pay when net is zero or negative and nothing was paid", () => {
    expect(slipPaymentState("0.00", []).status).toBe("nothing_to_pay");
    expect(slipPaymentState("-500.00", []).due).toBe("0.00");
  });
});

describe("registerPaymentSummary", () => {
  it("counts paid slips and totals paid and remaining", () => {
    const states = [slipPaymentState("100000.00", [pay("100000.00")]), slipPaymentState("28424.00", []), slipPaymentState("28200.00", [pay("26200.00")])];
    expect(registerPaymentSummary(states)).toEqual({ slipCount: 3, paidCount: 1, paidTotal: "126200.00", remainingTotal: "30424.00" });
  });
});

describe("paymentDateError", () => {
  it("allows the payroll month's first day up to today", () => {
    expect(paymentDateError("2026-11-01", "2026-11-01", "2026-12-03")).toBeNull();
    expect(paymentDateError("2026-12-03", "2026-11-01", "2026-12-03")).toBeNull();
  });
  it("blocks future dates and dates before the payroll month", () => {
    expect(paymentDateError("2026-12-04", "2026-11-01", "2026-12-03")).toBe("Payment date can't be in the future");
    expect(paymentDateError("2026-10-31", "2026-11-01", "2026-12-03")).toBe("Payment date can't be before 1 Nov 2026");
    expect(paymentDateError("", "2026-11-01", "2026-12-03")).toBe("Choose a payment date");
  });
});

describe("ledger text", () => {
  it("names the month and employee", () => {
    expect(payrollLedgerSource("2026-11-01")).toBe("Payroll - Nov 2026");
    expect(salaryLedgerDescription("payment", "Shahab Gul", "2026-11-01")).toBe("Salary — Shahab Gul — Nov 2026");
    expect(salaryLedgerDescription("refund", "Rafi Ullah", "2026-11-01")).toBe("Salary refund — Rafi Ullah — Nov 2026");
    expect(salaryReversalDescription("Shahab Gul", "2026-11-01", "Account changed to Bank")).toBe("Reversal of salary — Shahab Gul — Nov 2026 — Account changed to Bank");
    expect(overpaidRecoveryReason("2026-11-01")).toBe("Salary overpaid for Nov 2026 — taken back from the next salary");
  });
  it("matches payroll sources only", () => {
    expect(isPayrollLedgerSource("Payroll - Nov 2026")).toBe(true);
    expect(isPayrollLedgerSource("Payroll")).toBe(true);
    expect(isPayrollLedgerSource("Expense")).toBe(false);
  });
  it("dates a payment at noon Pakistan time on the chosen day", () => {
    expect(effectiveDateFromKey("2026-11-30").toISOString()).toBe("2026-11-30T07:00:00.000Z");
  });
  it("explains a shortfall", () => {
    expect(shortfallMessage("Cash in Hand", "80000.00", "128424.00")).toBe("Cash in Hand has Rs 80,000. Needed Rs 1,28,424. Short by Rs 48,424.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/lib/hr/salary-payments.test.ts`
Expected: FAIL, cannot resolve `./salary-payments`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hr/salary-payments.ts
import Big from "big.js";
import { format, parseISO } from "date-fns";
import { formatRupees } from "@/lib/finance/expense-entry";

export const SALARY_PAYMENT_KINDS = ["payment", "refund", "recovery"] as const;
export type SalaryPaymentKind = (typeof SALARY_PAYMENT_KINDS)[number];
export const SALARY_PAYMENT_STATUSES = ["active", "reversed"] as const;
export type SalaryPaymentStatus = (typeof SALARY_PAYMENT_STATUSES)[number];

export type SalaryPaymentLike = { kind: SalaryPaymentKind; amount: string; status: SalaryPaymentStatus };
export type SlipPaymentStatus = "unpaid" | "paid" | "balance_due" | "overpaid" | "nothing_to_pay";
export type SlipPaymentState = { status: SlipPaymentStatus; net: string; paid: string; due: string; overpaid: string };
export type RegisterPaymentSummary = { slipCount: number; paidCount: number; paidTotal: string; remainingTotal: string };

export const SLIP_PAYMENT_LABELS: Record<SlipPaymentStatus, string> = {
  unpaid: "Generated",
  paid: "Paid",
  balance_due: "Balance due",
  overpaid: "Overpaid",
  nothing_to_pay: "Nothing to pay",
};

export const PAYROLL_LEDGER_SOURCE_PREFIX = "Payroll";
/** Written by the sales desk when a distributor pays a salesman's salary (stored as a salary advance). */
export const DISTRIBUTOR_SALARY_REASON_PREFIX = "Salary paid directly by distributor";

/** Payments add; refunds (money handed back) and recoveries (taken from a later salary) subtract. Reversed rows never count. */
export function paidAmount(rows: SalaryPaymentLike[]): Big {
  return rows
    .filter((row) => row.status === "active")
    .reduce((sum, row) => (row.kind === "payment" ? sum.plus(row.amount) : sum.minus(row.amount)), new Big(0));
}

export function slipPaymentState(netSalary: string | null | undefined, rows: SalaryPaymentLike[]): SlipPaymentState {
  const net = new Big(netSalary || 0);
  const payable = net.gt(0) ? net : new Big(0);
  const paid = paidAmount(rows);
  const diff = payable.minus(paid);
  let status: SlipPaymentStatus;
  if (payable.eq(0) && paid.eq(0)) status = "nothing_to_pay";
  else if (paid.eq(0)) status = "unpaid";
  else if (diff.eq(0)) status = "paid";
  else if (diff.gt(0)) status = "balance_due";
  else status = "overpaid";
  return {
    status,
    net: net.toFixed(2),
    paid: paid.toFixed(2),
    due: diff.gt(0) ? diff.toFixed(2) : "0.00",
    overpaid: diff.lt(0) ? diff.abs().toFixed(2) : "0.00",
  };
}

export function registerPaymentSummary(states: SlipPaymentState[]): RegisterPaymentSummary {
  return {
    slipCount: states.length,
    paidCount: states.filter((state) => state.status === "paid").length,
    paidTotal: states.reduce((sum, state) => sum.plus(state.paid), new Big(0)).toFixed(2),
    remainingTotal: states.reduce((sum, state) => sum.plus(state.due), new Big(0)).toFixed(2),
  };
}

export function firstDayOfPayrollMonth(payrollMonth: string): string {
  return `${payrollMonth.slice(0, 7)}-01`;
}

export function paymentDateError(dateKey: string, payrollMonth: string, todayKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "Choose a payment date";
  if (dateKey > todayKey) return "Payment date can't be in the future";
  const first = firstDayOfPayrollMonth(payrollMonth);
  if (dateKey < first) return `Payment date can't be before ${format(parseISO(first), "d MMM yyyy")}`;
  return null;
}

/** Noon in Pakistan on the chosen day, so the Ledger shows the same calendar day in any time zone near PKT. */
export function effectiveDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T07:00:00.000Z`);
}

export function payrollMonthLabel(payrollMonth: string): string {
  return format(parseISO(firstDayOfPayrollMonth(payrollMonth)), "MMM yyyy");
}

export function payrollLedgerSource(payrollMonth: string): string {
  return `${PAYROLL_LEDGER_SOURCE_PREFIX} - ${payrollMonthLabel(payrollMonth)}`;
}

export function salaryLedgerDescription(kind: "payment" | "refund", employeeName: string, payrollMonth: string): string {
  const label = kind === "payment" ? "Salary" : "Salary refund";
  return `${label} — ${employeeName} — ${payrollMonthLabel(payrollMonth)}`;
}

export function salaryReversalDescription(employeeName: string, payrollMonth: string, reason: string): string {
  return `Reversal of salary — ${employeeName} — ${payrollMonthLabel(payrollMonth)} — ${reason}`;
}

export function overpaidRecoveryReason(payrollMonth: string): string {
  return `Salary overpaid for ${payrollMonthLabel(payrollMonth)} — taken back from the next salary`;
}

export function shortfallMessage(walletName: string, balance: string, needed: string): string {
  const short = new Big(needed).minus(balance).toFixed(2);
  return `${walletName} has ${formatRupees(balance)}. Needed ${formatRupees(needed)}. Short by ${formatRupees(short)}.`;
}

export function isPayrollLedgerSource(source: string): boolean {
  return source === PAYROLL_LEDGER_SOURCE_PREFIX || source.startsWith(`${PAYROLL_LEDGER_SOURCE_PREFIX} - `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/lib/hr/salary-payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hr/salary-payments.ts src/lib/hr/salary-payments.test.ts
git commit -m "feat(payroll): salary payment status, date and ledger text helpers"
```

---

### Task 2: `salary_payments` table

**Files:**
- Modify: `src/db/schemas/hr-schema.ts` (imports at top; new table after `advanceInstallments`; relations near `advanceInstallmentRelations`)
- Generated: one new migration from `bun run db:generate` (never hand-edited)
- Test: `src/db/schemas/salary-payments-schema.test.ts`

**Interfaces:**
- Consumes: `SALARY_PAYMENT_KINDS`, `SALARY_PAYMENT_STATUSES` (Task 1).
- Produces: `salaryPayments` table (`id, payrollId, employeeId, kind, amount, walletId, transactionId, advanceId, paymentDate, status, reversalTransactionId, reversalReason, reversedAt, reversedById, recordedById, createdAt, updatedAt`) and `salaryPaymentsRelations` (`payroll, employee, wallet, recordedBy, reversedBy`).

- [ ] **Step 1: Write the failing test**

```ts
// src/db/schemas/salary-payments-schema.test.ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { salaryPayments } from "./hr-schema";

describe("salary payments schema", () => {
  it("links a money event to payroll + employee with checks on shape and reversal", () => {
    const config = getTableConfig(salaryPayments);
    const column = (name: string) => config.columns.find((c) => c.name === name);
    expect(config.name).toBe("salary_payments");
    for (const name of ["payroll_id", "employee_id", "kind", "amount", "payment_date", "status", "recorded_by_id"]) {
      expect(column(name)?.notNull, name).toBe(true);
    }
    for (const name of ["wallet_id", "transaction_id", "advance_id", "reversal_transaction_id", "reversal_reason", "reversed_at", "reversed_by_id"]) {
      expect(column(name)?.notNull, name).toBe(false);
    }
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      "salary_payments_amount_check",
      "salary_payments_reversal_check",
      "salary_payments_shape_check",
    ]);
    expect(config.indexes.map((i) => i.config.name)).toContain("salary_payments_payroll_employee_idx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/db/schemas/salary-payments-schema.test.ts`
Expected: FAIL, `salaryPayments` is not exported.

- [ ] **Step 3: Add the table**

In the `drizzle-orm/pg-core` import at the top of `hr-schema.ts`, add `check`. Below `import { user } from "./auth-schema";` add:

```ts
import { transactions, wallets } from "./finance-schema";
import { SALARY_PAYMENT_KINDS, SALARY_PAYMENT_STATUSES } from "@/lib/hr/salary-payments";
```

After the `advanceInstallments` table, add:

```ts
// --- SALARY PAYMENTS ---
// One row per money event on a payslip. Linked to payroll + employee, not to the payslip row,
// because Revise deletes and re-inserts the payslip. Rows are never edited for money: a correction
// marks the row reversed and writes a reversal Ledger line.
export const salaryPayments = pgTable(
  "salary_payments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    payrollId: text("payroll_id").notNull().references(() => payrolls.id),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    kind: text("kind", { enum: SALARY_PAYMENT_KINDS }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    walletId: text("wallet_id").references(() => wallets.id),
    transactionId: text("transaction_id").references(() => transactions.id),
    advanceId: text("advance_id").references(() => salaryAdvances.id),
    paymentDate: date("payment_date").notNull(),
    status: text("status", { enum: SALARY_PAYMENT_STATUSES }).notNull().default("active"),
    reversalTransactionId: text("reversal_transaction_id").references(() => transactions.id),
    reversalReason: text("reversal_reason"),
    reversedAt: timestamp("reversed_at"),
    reversedById: text("reversed_by_id").references(() => user.id),
    recordedById: text("recorded_by_id").notNull().references(() => user.id),
    ...timestamps,
  },
  (table) => ({
    payrollEmployeeIdx: index("salary_payments_payroll_employee_idx").on(table.payrollId, table.employeeId),
    amountCheck: check("salary_payments_amount_check", sql`${table.amount} > 0`),
    shapeCheck: check(
      "salary_payments_shape_check",
      sql`(${table.kind} in ('payment', 'refund') and ${table.walletId} is not null and ${table.transactionId} is not null and ${table.advanceId} is null)
        or (${table.kind} = 'recovery' and ${table.walletId} is null and ${table.transactionId} is null and ${table.advanceId} is not null)`,
    ),
    reversalCheck: check(
      "salary_payments_reversal_check",
      sql`(${table.status} = 'active' and ${table.reversedAt} is null)
        or (${table.status} = 'reversed' and ${table.reversedAt} is not null and ${table.reversedById} is not null and ${table.reversalReason} is not null)`,
    ),
  }),
);
```

Next to `advanceInstallmentRelations`, add:

```ts
export const salaryPaymentsRelations = relations(salaryPayments, ({ one }) => ({
  payroll: one(payrolls, { fields: [salaryPayments.payrollId], references: [payrolls.id] }),
  employee: one(employees, { fields: [salaryPayments.employeeId], references: [employees.id] }),
  wallet: one(wallets, { fields: [salaryPayments.walletId], references: [wallets.id] }),
  recordedBy: one(user, { fields: [salaryPayments.recordedById], references: [user.id] }),
  reversedBy: one(user, {
    fields: [salaryPayments.reversedById],
    references: [user.id],
    relationName: "salaryPaymentReversedBy",
  }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/db/schemas/salary-payments-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate and apply the migration**

Run: `bun run db:generate`
Expected: one new SQL file creating `salary_payments` with three checks, one index and foreign keys. Do not edit it.

Run: `bun run db:migrate && DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test && bun run typecheck`
Expected: migrations apply, typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add src/db/schemas/hr-schema.ts src/db/schemas/salary-payments-schema.test.ts src/db/migrations
git commit -m "feat(payroll): salary_payments table"
```

---

### Task 3: Pay salaries (server)

**Files:**
- Create: `src/server-functions/hr/payroll/salary-payments.server.ts`
- Create: `src/server-functions/hr/payroll/salary-payments-fn.ts`
- Create: `src/__tests__/integration/salary-fixture.ts`
- Test: `src/__tests__/integration/salary-payments.test.ts`, `src/server-functions/hr/payroll/salary-payments-fn.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 table.
- Produces (in `salary-payments.server.ts`): `type Tx`, `type Executor`, `paySalaries(tx, { payrollId, employeeIds, walletId, paymentDate, todayKey, actorId }): Promise<{ paidCount: number; total: string }>`; internal helpers reused by Tasks 4–5: `loadPayroll`, `lockSlips`, `activeRows`, `assertWalletCovers`, `moveMoney`, `insertPayment`, `assertPaymentDate`, type `SlipLine`, type `ActiveRow`. Export them all.
- Produces (in `salary-payments-fn.ts`): `paySalariesFn` with input `{ payrollId: string; employeeIds: string[]; walletId: string; paymentDate: string }`.

- [ ] **Step 1: Write the fixture**

```ts
// src/__tests__/integration/salary-fixture.ts
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips, salaryPayments } from "@/db/schemas/hr-schema";

/**
 * Each call commits its own payroll in a random far-future year (payroll months are unique),
 * with its own accounts and staff. "Today" for date checks is 3 Dec of that year.
 */
export async function salaryFixture(options: { cash?: string; nets?: string[] } = {}) {
  const id = randomUUID();
  const year = 2200 + Math.floor(Math.random() * 7000);
  const month = `${year}-11-01`;
  const todayKey = `${year}-12-03`;
  const [actor] = await db.insert(user).values({ id, name: "Accountant", email: `${id}@test.invalid` }).returning();
  const [cash] = await db.insert(wallets).values({ id: `cash-${id}`, name: `Cash ${id.slice(0, 8)}`, type: "cash", balance: options.cash ?? "200000.00" }).returning();
  const [bank] = await db.insert(wallets).values({ id: `bank-${id}`, name: `Bank ${id.slice(0, 8)}`, type: "bank", balance: "500000.00" }).returning();
  const [payroll] = await db.insert(payrolls).values({ month, startDate: `${year}-10-26`, endDate: `${year}-11-25`, status: "draft" }).returning();
  const staff = [];
  for (const [index, net] of (options.nets ?? ["26200.00", "100000.00"]).entries()) {
    const [employee] = await db.insert(employees).values({
      employeeCode: `${id.slice(0, 8)}-${index}`,
      firstName: `Staff${index}`,
      lastName: id.slice(0, 6),
      designation: "Operator",
      joiningDate: "2026-01-01",
    }).returning();
    const [slip] = await db.insert(payslips).values({
      payrollId: payroll.id, employeeId: employee.id, basicSalary: net, grossSalary: net, totalDeductions: "0", netSalary: net,
    }).returning();
    staff.push({ employee, slip, name: `${employee.firstName} ${employee.lastName}` });
  }

  const balanceOf = async (walletId: string) => (await db.select().from(wallets).where(eq(wallets.id, walletId)))[0].balance;
  const rows = async (employeeId: string) =>
    db.select().from(salaryPayments)
      .where(and(eq(salaryPayments.payrollId, payroll.id), eq(salaryPayments.employeeId, employeeId)))
      .orderBy(asc(salaryPayments.createdAt));
  const line = async (transactionId: string) => (await db.select().from(transactions).where(eq(transactions.id, transactionId)))[0];
  /** Simulates a Revise that changes the net (Revise re-inserts the slip; payments stay linked by payroll + employee). */
  const setNet = async (employeeId: string, net: string) =>
    db.update(payslips).set({ netSalary: net, grossSalary: net })
      .where(and(eq(payslips.payrollId, payroll.id), eq(payslips.employeeId, employeeId)));
  const base = { payrollId: payroll.id, todayKey, actorId: actor.id };

  return { id, year, month, todayKey, actor, cash, bank, payroll, staff, base, balanceOf, rows, line, setNet };
}
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/__tests__/integration/salary-payments.test.ts
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { reportDateKey } from "@/lib/report-dates";
import { slipPaymentState } from "@/lib/hr/salary-payments";
import { paySalaries } from "@/server-functions/hr/payroll/salary-payments.server";
import { salaryFixture } from "./salary-fixture";

type Fixture = Awaited<ReturnType<typeof salaryFixture>>;
const payFor = (f: Fixture, employeeIds: string[], walletId: string, paymentDate: string) =>
  db.transaction((tx) => paySalaries(tx, { ...f.base, employeeIds, walletId, paymentDate }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("paying salaries", () => {
  it("pays the chosen slips from one account, one dated Ledger line each", async () => {
    const f = await salaryFixture();
    const [shahab] = f.staff;

    expect(await payFor(f, [shahab.employee.id], f.cash.id, `${f.year}-11-30`)).toEqual({ paidCount: 1, total: "26200.00" });

    expect(await f.balanceOf(f.cash.id)).toBe("173800.00");
    const [row] = await f.rows(shahab.employee.id);
    expect(row).toMatchObject({ kind: "payment", amount: "26200.00", walletId: f.cash.id, paymentDate: `${f.year}-11-30`, status: "active", recordedById: f.actor.id });
    const line = await f.line(row.transactionId!);
    expect(line).toMatchObject({ type: "debit", amount: "26200.00", source: `Payroll - Nov ${f.year}`, description: `Salary — ${shahab.name} — Nov ${f.year}`, referenceId: row.id });
    expect(reportDateKey(line.effectiveDate)).toBe(`${f.year}-11-30`);
    expect(await f.rows(f.staff[1].employee.id)).toHaveLength(0);
  });

  it("blocks the whole payment when the account is short", async () => {
    const f = await salaryFixture({ cash: "30000.00" });
    await expect(payFor(f, f.staff.map((s) => s.employee.id), f.cash.id, f.todayKey))
      .rejects.toThrow(`${f.cash.name} has Rs 30,000. Needed Rs 1,26,200. Short by Rs 96,200.`);
    expect(await f.balanceOf(f.cash.id)).toBe("30000.00");
    expect(await f.rows(f.staff[0].employee.id)).toHaveLength(0);
  });

  it("rejects a future date and a date before the payroll month", async () => {
    const f = await salaryFixture();
    const ids = [f.staff[0].employee.id];
    await expect(payFor(f, ids, f.cash.id, `${f.year}-12-04`)).rejects.toThrow("Payment date can't be in the future");
    await expect(payFor(f, ids, f.cash.id, `${f.year}-10-31`)).rejects.toThrow(`Payment date can't be before 1 Nov ${f.year}`);
  });

  it("never pays the same slip twice, even when two people click at once", async () => {
    const f = await salaryFixture();
    const ids = [f.staff[0].employee.id];
    const results = await Promise.allSettled([payFor(f, ids, f.cash.id, f.todayKey), payFor(f, ids, f.bank.id, f.todayKey)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason)).toContain("has nothing left to pay");
    expect(await f.rows(f.staff[0].employee.id)).toHaveLength(1);
  });

  it("pays only the balance due after a revision raises the net", async () => {
    const f = await salaryFixture();
    const rafi = f.staff[0];
    await payFor(f, [rafi.employee.id], f.cash.id, f.todayKey);
    await f.setNet(rafi.employee.id, "28200.00");

    expect(await payFor(f, [rafi.employee.id], f.bank.id, f.todayKey)).toEqual({ paidCount: 1, total: "2000.00" });
    const rows = await f.rows(rafi.employee.id);
    expect(rows.map((r) => [r.amount, r.walletId])).toEqual([["26200.00", f.cash.id], ["2000.00", f.bank.id]]);
    expect(slipPaymentState("28200.00", rows).status).toBe("paid");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts`
Expected: FAIL, cannot resolve `salary-payments.server`.

- [ ] **Step 4: Write the server module**

```ts
// src/server-functions/hr/payroll/salary-payments.server.ts
import Big from "big.js";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { db } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { employees, payrolls, payslips, salaryPayments } from "@/db/schemas/hr-schema";
import {
  effectiveDateFromKey,
  paymentDateError,
  payrollLedgerSource,
  salaryLedgerDescription,
  shortfallMessage,
  slipPaymentState,
} from "@/lib/hr/salary-payments";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
export type ActiveRow = typeof salaryPayments.$inferSelect;
export type SlipLine = { employeeId: string; payslipId: string; netSalary: string; name: string };

export async function loadPayroll(tx: Executor, payrollId: string) {
  const payroll = await tx.query.payrolls.findFirst({ where: eq(payrolls.id, payrollId) });
  if (!payroll) throw new Error("Payroll not found");
  return payroll;
}

export function assertPaymentDate(dateKey: string, payrollMonth: string, todayKey: string) {
  const error = paymentDateError(dateKey, payrollMonth, todayKey);
  if (error) throw new Error(error);
}

/** Locks the slips (in employee-code order, so concurrent calls can't deadlock) before reading their payments. */
export async function lockSlips(tx: Tx, payrollId: string, employeeIds: string[]): Promise<SlipLine[]> {
  const unique = [...new Set(employeeIds)];
  if (unique.length === 0) throw new Error("Choose at least one salary");
  const rows = await tx
    .select({
      employeeId: payslips.employeeId,
      payslipId: payslips.id,
      netSalary: payslips.netSalary,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(eq(payslips.payrollId, payrollId), inArray(payslips.employeeId, unique)))
    .orderBy(asc(employees.employeeCode))
    .for("update", { of: payslips });
  if (rows.length !== unique.length) throw new Error("A selected payslip no longer exists. Refresh and try again.");
  return rows.map((row) => ({
    employeeId: row.employeeId,
    payslipId: row.payslipId,
    netSalary: row.netSalary,
    name: `${row.firstName} ${row.lastName}`,
  }));
}

export async function activeRows(tx: Executor, payrollId: string, employeeIds: string[]): Promise<Map<string, ActiveRow[]>> {
  const map = new Map<string, ActiveRow[]>();
  if (employeeIds.length === 0) return map;
  const rows = await tx
    .select()
    .from(salaryPayments)
    .where(and(
      eq(salaryPayments.payrollId, payrollId),
      eq(salaryPayments.status, "active"),
      inArray(salaryPayments.employeeId, employeeIds),
    ))
    .orderBy(asc(salaryPayments.createdAt));
  for (const row of rows) map.set(row.employeeId, [...(map.get(row.employeeId) ?? []), row]);
  return map;
}

/** Locks the account and checks it can cover the whole amount before any money moves. */
export async function assertWalletCovers(tx: Tx, walletId: string, needed: string) {
  const [wallet] = await tx
    .select({ name: wallets.name, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .for("update");
  if (!wallet) throw new Error("Account not found");
  if (new Big(wallet.balance).lt(needed)) throw new Error(shortfallMessage(wallet.name, wallet.balance, needed));
  return wallet;
}

/** Moves money on one account and writes its Ledger line. A debit never takes the account below zero. */
export async function moveMoney(
  tx: Tx,
  input: {
    walletId: string;
    type: "debit" | "credit";
    amount: string;
    source: string;
    description: string;
    effectiveDate: Date;
    actorId: string;
    referenceId: string;
    reversalOfTransactionId?: string | null;
  },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance: input.type === "debit"
        ? sql`${wallets.balance} - ${input.amount}`
        : sql`${wallets.balance} + ${input.amount}`,
    })
    .where(input.type === "debit"
      ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
      : eq(wallets.id, input.walletId))
    .returning({ id: wallets.id });
  if (!wallet) {
    const [existing] = await tx.select({ name: wallets.name, balance: wallets.balance }).from(wallets).where(eq(wallets.id, input.walletId));
    if (!existing) throw new Error("Account not found");
    throw new Error(shortfallMessage(existing.name, existing.balance, input.amount));
  }
  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: input.source,
    referenceId: input.referenceId,
    description: input.description,
    effectiveDate: input.effectiveDate,
    reversalOfTransactionId: input.reversalOfTransactionId ?? null,
    performedById: input.actorId,
  });
  return id;
}

export async function insertPayment(
  tx: Tx,
  input: { payrollId: string; payrollMonth: string; employeeId: string; name: string; walletId: string; amount: string; paymentDate: string; actorId: string },
) {
  const id = createId();
  const transactionId = await moveMoney(tx, {
    walletId: input.walletId,
    type: "debit",
    amount: input.amount,
    source: payrollLedgerSource(input.payrollMonth),
    description: salaryLedgerDescription("payment", input.name, input.payrollMonth),
    effectiveDate: effectiveDateFromKey(input.paymentDate),
    actorId: input.actorId,
    referenceId: id,
  });
  await tx.insert(salaryPayments).values({
    id,
    payrollId: input.payrollId,
    employeeId: input.employeeId,
    kind: "payment",
    amount: input.amount,
    walletId: input.walletId,
    transactionId,
    paymentDate: input.paymentDate,
    recordedById: input.actorId,
  });
  return id;
}

export type PaySalariesInput = {
  payrollId: string;
  employeeIds: string[];
  walletId: string;
  paymentDate: string;
  todayKey: string;
  actorId: string;
};

/** Pays what is still due on each chosen slip (full net, or the balance after a revision). All or nothing. */
export async function paySalaries(tx: Tx, input: PaySalariesInput) {
  const payroll = await loadPayroll(tx, input.payrollId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const slips = await lockSlips(tx, payroll.id, input.employeeIds);
  const existing = await activeRows(tx, payroll.id, slips.map((slip) => slip.employeeId));
  const lines = slips.map((slip) => ({
    ...slip,
    due: slipPaymentState(slip.netSalary, existing.get(slip.employeeId) ?? []).due,
  }));
  const settled = lines.find((line) => !new Big(line.due).gt(0));
  if (settled) throw new Error(`${settled.name} has nothing left to pay. Refresh and try again.`);
  const total = lines.reduce((sum, line) => sum.plus(line.due), new Big(0)).toFixed(2);
  await assertWalletCovers(tx, input.walletId, total);
  for (const line of lines) {
    await insertPayment(tx, {
      payrollId: payroll.id,
      payrollMonth: payroll.month,
      employeeId: line.employeeId,
      name: line.name,
      walletId: input.walletId,
      amount: line.due,
      paymentDate: input.paymentDate,
      actorId: input.actorId,
    });
  }
  return { paidCount: lines.length, total };
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the server function and its source test**

```ts
// src/server-functions/hr/payroll/salary-payments-fn.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server-functions/hr/payroll/salary-payments-fn.ts", "utf8");
const blocks = SOURCE.split("export const ").slice(1).map((block) => ({ name: block.slice(0, block.indexOf(" ")), body: block }));

describe("salary payment server functions", () => {
  it("every write needs hr.manage plus finance.manage and runs in one transaction", () => {
    const writes = blocks.filter((b) => b.name.endsWith("Fn") && !b.name.startsWith("get"));
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.body, write.name).toContain(".middleware([requireHrManageMiddleware])");
      expect(write.body, write.name).toContain('requirePermission(context.authContext, "finance.manage")');
      expect(write.body, write.name).toContain("db.transaction(");
      expect(write.body, write.name).toContain("todayKey: reportDateKey(new Date())");
    }
  });

  it("reads need hr.view", () => {
    for (const read of blocks.filter((b) => b.name.startsWith("get"))) {
      expect(read.body, read.name).toContain(".middleware([requireHrViewMiddleware])");
    }
  });
});
```

```ts
// src/server-functions/hr/payroll/salary-payments-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireHrManageMiddleware, requireHrViewMiddleware } from "@/lib/middlewares";
import { requirePermission } from "@/lib/authz.server";
import { reportDateKey } from "@/lib/report-dates";
import { paySalaries } from "./salary-payments.server";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date");

export const paySalariesFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, "Choose at least one salary"),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      paySalaries(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });
```

`requireHrViewMiddleware` is imported now and used by the read function added in Task 6. If the linter or typecheck complains about the unused import before then, add it in Task 6 instead.

- [ ] **Step 7: Run unit test and typecheck**

Run: `bunx vitest run src/server-functions/hr/payroll/salary-payments-fn.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/hr/payroll/salary-payments.server.ts src/server-functions/hr/payroll/salary-payments-fn.ts src/server-functions/hr/payroll/salary-payments-fn.test.ts src/__tests__/integration/salary-fixture.ts src/__tests__/integration/salary-payments.test.ts
git commit -m "feat(payroll): pay selected salaries from an account"
```

---

### Task 4: Change account and undo payment (server)

**Files:**
- Modify: `src/server-functions/hr/payroll/salary-payments.server.ts`
- Modify: `src/server-functions/hr/payroll/salary-payments-fn.ts`
- Test: `src/__tests__/integration/salary-payments.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: `reverseRow(tx, row, ctx)`, `changeSalaryAccount(tx, { payrollId, employeeIds, walletId, paymentDate, todayKey, actorId }): Promise<{ movedCount: number; total: string }>`, `undoSalaryPayment(tx, { payrollId, employeeId, reason, todayKey, actorId }): Promise<{ reversedCount: number }>`; server functions `changeSalaryAccountFn` (`{ payrollId, employeeIds, walletId, paymentDate }`) and `undoSalaryPaymentFn` (`{ payrollId, employeeId, reason }`).

- [ ] **Step 1: Write the failing tests** (append inside the file, new `describe`; add `changeSalaryAccount, undoSalaryPayment` to the server import)

```ts
const changeFor = (f: Fixture, employeeIds: string[], walletId: string, paymentDate: string) =>
  db.transaction((tx) => changeSalaryAccount(tx, { ...f.base, employeeIds, walletId, paymentDate }));
const undoFor = (f: Fixture, employeeId: string, reason: string) =>
  db.transaction((tx) => undoSalaryPayment(tx, { ...f.base, employeeId, reason }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("changing the account and undoing", () => {
  it("moves a paid slip to another account, keeping both lines", async () => {
    const f = await salaryFixture();
    const shahab = f.staff[0];
    await payFor(f, [shahab.employee.id], f.cash.id, `${f.year}-11-30`);

    expect(await changeFor(f, [shahab.employee.id], f.bank.id, `${f.year}-12-01`)).toEqual({ movedCount: 1, total: "26200.00" });

    expect(await f.balanceOf(f.cash.id)).toBe("200000.00");
    expect(await f.balanceOf(f.bank.id)).toBe("473800.00");
    const [old, moved] = await f.rows(shahab.employee.id);
    expect(old).toMatchObject({ status: "reversed", walletId: f.cash.id, reversalReason: `Account changed to ${f.bank.name}`, reversedById: f.actor.id });
    const reversal = await f.line(old.reversalTransactionId!);
    expect(reversal).toMatchObject({ type: "credit", walletId: f.cash.id, amount: "26200.00", reversalOfTransactionId: old.transactionId });
    expect(reversal.description).toBe(`Reversal of salary — ${shahab.name} — Nov ${f.year} — Account changed to ${f.bank.name}`);
    expect(reportDateKey(reversal.effectiveDate)).toBe(f.todayKey);
    expect(moved).toMatchObject({ status: "active", walletId: f.bank.id, amount: "26200.00", paymentDate: `${f.year}-12-01` });
  });

  it("refuses an unpaid slip, a slip already on that account, and a short account", async () => {
    const f = await salaryFixture();
    const [a, b] = f.staff;
    await expect(changeFor(f, [a.employee.id], f.bank.id, f.todayKey)).rejects.toThrow(`${a.name} is not paid yet.`);
    await payFor(f, [a.employee.id, b.employee.id], f.bank.id, f.todayKey);
    await expect(changeFor(f, [a.employee.id], f.bank.id, f.todayKey)).rejects.toThrow(`${a.name} is already paid from ${f.bank.name}.`);
    await db.update(wallets).set({ balance: "1000.00" }).where(eq(wallets.id, f.cash.id));
    await expect(changeFor(f, [b.employee.id], f.cash.id, f.todayKey)).rejects.toThrow("Short by Rs 99,000.");
    expect(await f.balanceOf(f.bank.id)).toBe("373800.00");
  });

  it("undoes a payment: money back, slip unpaid again", async () => {
    const f = await salaryFixture();
    const a = f.staff[0];
    await payFor(f, [a.employee.id], f.cash.id, f.todayKey);
    await expect(undoFor(f, a.employee.id, "no")).rejects.toThrow("Give a reason of at least 3 characters");

    expect(await undoFor(f, a.employee.id, "Paid twice by mistake")).toEqual({ reversedCount: 1 });

    expect(await f.balanceOf(f.cash.id)).toBe("200000.00");
    const rows = await f.rows(a.employee.id);
    expect(rows[0]).toMatchObject({ status: "reversed", reversalReason: "Paid twice by mistake" });
    expect(slipPaymentState("26200.00", rows).status).toBe("unpaid");
    await expect(undoFor(f, a.employee.id, "Again")).rejects.toThrow(`${a.name} has no payment to undo.`);
  });
});
```

Add to the test file imports: `import { eq } from "drizzle-orm";` and `import { wallets } from "@/db/schemas/finance-schema";`.

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts`
Expected: FAIL, `changeSalaryAccount` is not exported.

- [ ] **Step 3: Implement** (append to `salary-payments.server.ts`; add `salaryAdvances` to the hr-schema import and `salaryReversalDescription` to the helper import)

```ts
type ReverseContext = { reason: string; actorId: string; todayKey: string; name: string; payrollMonth: string };

/**
 * Reverses one active row. Payment: money back into its account. Refund: money out again.
 * Recovery: cancels its advance, only while no later slip has deducted it. Dated today.
 */
export async function reverseRow(tx: Tx, row: ActiveRow, ctx: ReverseContext) {
  let reversalTransactionId: string | null = null;
  if (row.kind === "recovery") {
    const [cancelled] = await tx
      .update(salaryAdvances)
      .set({ status: "cancelled" })
      .where(and(eq(salaryAdvances.id, row.advanceId!), eq(salaryAdvances.status, "approved"), eq(salaryAdvances.installmentsPaid, 0)))
      .returning({ id: salaryAdvances.id });
    if (!cancelled) throw new Error(`The overpaid amount for ${ctx.name} was already taken from a later salary, so it can't be undone.`);
  } else {
    reversalTransactionId = await moveMoney(tx, {
      walletId: row.walletId!,
      type: row.kind === "payment" ? "credit" : "debit",
      amount: row.amount,
      source: payrollLedgerSource(ctx.payrollMonth),
      description: salaryReversalDescription(ctx.name, ctx.payrollMonth, ctx.reason),
      effectiveDate: effectiveDateFromKey(ctx.todayKey),
      actorId: ctx.actorId,
      referenceId: row.id,
      reversalOfTransactionId: row.transactionId,
    });
  }
  const [updated] = await tx
    .update(salaryPayments)
    .set({ status: "reversed", reversedAt: new Date(), reversedById: ctx.actorId, reversalReason: ctx.reason, reversalTransactionId })
    .where(and(eq(salaryPayments.id, row.id), eq(salaryPayments.status, "active")))
    .returning({ id: salaryPayments.id });
  if (!updated) throw new Error("This payment changed. Refresh and try again.");
}

export async function changeSalaryAccount(tx: Tx, input: PaySalariesInput) {
  const payroll = await loadPayroll(tx, input.payrollId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const slips = await lockSlips(tx, payroll.id, input.employeeIds);
  const existing = await activeRows(tx, payroll.id, slips.map((slip) => slip.employeeId));
  const [target] = await tx.select({ name: wallets.name }).from(wallets).where(eq(wallets.id, input.walletId));
  if (!target) throw new Error("Account not found");

  const moves = slips.map((slip) => {
    const payments = (existing.get(slip.employeeId) ?? []).filter((row) => row.kind === "payment");
    if (payments.length === 0) throw new Error(`${slip.name} is not paid yet.`);
    const toMove = payments.filter((row) => row.walletId !== input.walletId);
    if (toMove.length === 0) throw new Error(`${slip.name} is already paid from ${target.name}.`);
    return { slip, toMove };
  });

  const reason = `Account changed to ${target.name}`;
  for (const { slip, toMove } of moves) {
    for (const row of toMove) {
      await reverseRow(tx, row, { reason, actorId: input.actorId, todayKey: input.todayKey, name: slip.name, payrollMonth: payroll.month });
    }
  }
  const total = moves.flatMap((move) => move.toMove).reduce((sum, row) => sum.plus(row.amount), new Big(0)).toFixed(2);
  await assertWalletCovers(tx, input.walletId, total);
  for (const { slip, toMove } of moves) {
    for (const row of toMove) {
      await insertPayment(tx, {
        payrollId: payroll.id,
        payrollMonth: payroll.month,
        employeeId: slip.employeeId,
        name: slip.name,
        walletId: input.walletId,
        amount: row.amount,
        paymentDate: input.paymentDate,
        actorId: input.actorId,
      });
    }
  }
  return { movedCount: moves.length, total };
}

const UNDO_ORDER = { recovery: 0, refund: 1, payment: 2 } as const;

export async function undoSalaryPayment(
  tx: Tx,
  input: { payrollId: string; employeeId: string; reason: string; todayKey: string; actorId: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Give a reason of at least 3 characters");
  const payroll = await loadPayroll(tx, input.payrollId);
  const [slip] = await lockSlips(tx, payroll.id, [input.employeeId]);
  const rows = (await activeRows(tx, payroll.id, [slip.employeeId])).get(slip.employeeId) ?? [];
  if (rows.length === 0) throw new Error(`${slip.name} has no payment to undo.`);
  for (const row of [...rows].sort((a, b) => UNDO_ORDER[a.kind] - UNDO_ORDER[b.kind])) {
    await reverseRow(tx, row, { reason, actorId: input.actorId, todayKey: input.todayKey, name: slip.name, payrollMonth: payroll.month });
  }
  return { reversedCount: rows.length };
}
```

Append to `salary-payments-fn.ts` (add `changeSalaryAccount, undoSalaryPayment` to the import):

```ts
export const changeSalaryAccountFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, "Choose at least one salary"),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      changeSalaryAccount(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });

export const undoSalaryPaymentFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeId: z.string().min(1),
    reason: z.string().trim().min(3, "Give a reason of at least 3 characters").max(500),
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      undoSalaryPayment(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });
```

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts && bunx vitest run src/server-functions/hr/payroll/salary-payments-fn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/hr/payroll src/__tests__/integration/salary-payments.test.ts
git commit -m "feat(payroll): change the paying account and undo a salary payment"
```

---

### Task 5: Overpaid slips — refund received or recover from next month

**Files:**
- Modify: `src/server-functions/hr/payroll/salary-payments.server.ts`
- Modify: `src/server-functions/hr/payroll/salary-payments-fn.ts`
- Modify: `src/server-functions/hr/payroll/core.ts:106-175` and the three call sites (`:488`, `:728`, `:1044`)
- Test: `src/__tests__/integration/salary-payments.test.ts` (append)

**Interfaces:**
- Produces: `recordSalaryRefund(tx, { payrollId, employeeId, walletId, paymentDate, todayKey, actorId }): Promise<{ amount: string }>`, `recoverOverpaidSalary(tx, { payrollId, employeeId, todayKey, actorId }): Promise<{ amount: string }>`; server functions `recordSalaryRefundFn` (`{ payrollId, employeeId, walletId, paymentDate }`), `recoverOverpaidSalaryFn` (`{ payrollId, employeeId }`); `calculateEnrichedAdvanceDeductions(employeeId, executor?, options?: { payrollId?: string })`.

- [ ] **Step 1: Write the failing tests** (append; add `recordSalaryRefund, recoverOverpaidSalary` to the server import, `import { salaryAdvances } from "@/db/schemas/hr-schema";` and `import { calculateEnrichedAdvanceDeductions } from "@/server-functions/hr/payroll/core";`)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("overpaid slips", () => {
  const overpaid = async () => {
    const f = await salaryFixture();
    const rafi = f.staff[0];
    await payFor(f, [rafi.employee.id], f.cash.id, f.todayKey);
    await f.setNet(rafi.employee.id, "23200.00");
    return { f, rafi };
  };

  it("records money handed back into an account", async () => {
    const { f, rafi } = await overpaid();
    expect(await db.transaction((tx) => recordSalaryRefund(tx, { ...f.base, employeeId: rafi.employee.id, walletId: f.cash.id, paymentDate: `${f.year}-12-02` })))
      .toEqual({ amount: "3000.00" });
    expect(await f.balanceOf(f.cash.id)).toBe("176800.00");
    const rows = await f.rows(rafi.employee.id);
    expect(rows[1]).toMatchObject({ kind: "refund", amount: "3000.00", walletId: f.cash.id, paymentDate: `${f.year}-12-02` });
    expect((await f.line(rows[1].transactionId!)).description).toBe(`Salary refund — ${rafi.name} — Nov ${f.year}`);
    expect(slipPaymentState("23200.00", rows).status).toBe("paid");
  });

  it("takes the overpaid amount from the next salary, not from this month's revisions", async () => {
    const { f, rafi } = await overpaid();
    expect(await db.transaction((tx) => recoverOverpaidSalary(tx, { ...f.base, employeeId: rafi.employee.id }))).toEqual({ amount: "3000.00" });

    const rows = await f.rows(rafi.employee.id);
    expect(rows[1]).toMatchObject({ kind: "recovery", amount: "3000.00", walletId: null, transactionId: null });
    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, rows[1].advanceId!));
    expect(advance).toMatchObject({ status: "approved", amount: "3000.00", installmentMonths: 1, reason: `Salary overpaid for Nov ${f.year} — taken back from the next salary` });
    expect(slipPaymentState("23200.00", rows).status).toBe("paid");
    expect(await f.balanceOf(f.cash.id)).toBe("173800.00");

    expect((await calculateEnrichedAdvanceDeductions(rafi.employee.id, db, { payrollId: f.payroll.id })).totalDeduction).toBe(0);
    expect((await calculateEnrichedAdvanceDeductions(rafi.employee.id, db, { payrollId: "next-month" })).totalDeduction).toBe(3000);
  });

  it("undo cancels a recovery not yet taken, and refuses one already taken", async () => {
    const { f, rafi } = await overpaid();
    await db.transaction((tx) => recoverOverpaidSalary(tx, { ...f.base, employeeId: rafi.employee.id }));
    const advanceId = (await f.rows(rafi.employee.id))[1].advanceId!;
    await db.update(salaryAdvances).set({ installmentsPaid: 1, status: "settled" }).where(eq(salaryAdvances.id, advanceId));
    await expect(undoFor(f, rafi.employee.id, "Wrong slip")).rejects.toThrow("already taken from a later salary");

    await db.update(salaryAdvances).set({ installmentsPaid: 0, status: "approved" }).where(eq(salaryAdvances.id, advanceId));
    await undoFor(f, rafi.employee.id, "Wrong slip");
    expect((await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId)))[0].status).toBe("cancelled");
    expect(await f.balanceOf(f.cash.id)).toBe("200000.00");
  });

  it("refuses a slip that isn't overpaid", async () => {
    const f = await salaryFixture();
    const a = f.staff[0];
    await expect(db.transaction((tx) => recoverOverpaidSalary(tx, { ...f.base, employeeId: a.employee.id }))).rejects.toThrow(`${a.name} isn't overpaid.`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts`
Expected: FAIL, `recordSalaryRefund` is not exported.

- [ ] **Step 3: Implement the writes** (append to `salary-payments.server.ts`; add `overpaidRecoveryReason` to the helper import)

```ts
async function lockOverpaidSlip(tx: Tx, payrollId: string, employeeId: string) {
  const payroll = await loadPayroll(tx, payrollId);
  const [slip] = await lockSlips(tx, payroll.id, [employeeId]);
  const rows = (await activeRows(tx, payroll.id, [slip.employeeId])).get(slip.employeeId) ?? [];
  const state = slipPaymentState(slip.netSalary, rows);
  if (!new Big(state.overpaid).gt(0)) throw new Error(`${slip.name} isn't overpaid.`);
  return { payroll, slip, overpaid: state.overpaid };
}

export async function recordSalaryRefund(
  tx: Tx,
  input: { payrollId: string; employeeId: string; walletId: string; paymentDate: string; todayKey: string; actorId: string },
) {
  const { payroll, slip, overpaid } = await lockOverpaidSlip(tx, input.payrollId, input.employeeId);
  assertPaymentDate(input.paymentDate, payroll.month, input.todayKey);
  const id = createId();
  const transactionId = await moveMoney(tx, {
    walletId: input.walletId,
    type: "credit",
    amount: overpaid,
    source: payrollLedgerSource(payroll.month),
    description: salaryLedgerDescription("refund", slip.name, payroll.month),
    effectiveDate: effectiveDateFromKey(input.paymentDate),
    actorId: input.actorId,
    referenceId: id,
  });
  await tx.insert(salaryPayments).values({
    id, payrollId: payroll.id, employeeId: slip.employeeId, kind: "refund", amount: overpaid,
    walletId: input.walletId, transactionId, paymentDate: input.paymentDate, recordedById: input.actorId,
  });
  return { amount: overpaid };
}

/** Creates a one-installment advance that the next generated payslip deducts. No money moves now. */
export async function recoverOverpaidSalary(
  tx: Tx,
  input: { payrollId: string; employeeId: string; todayKey: string; actorId: string },
) {
  const { payroll, slip, overpaid } = await lockOverpaidSlip(tx, input.payrollId, input.employeeId);
  const [advance] = await tx
    .insert(salaryAdvances)
    .values({
      employeeId: slip.employeeId,
      amount: overpaid,
      date: input.todayKey,
      reason: overpaidRecoveryReason(payroll.month),
      status: "approved",
      approvedBy: input.actorId,
      installmentMonths: 1,
      installmentAmount: overpaid,
    })
    .returning({ id: salaryAdvances.id });
  await tx.insert(salaryPayments).values({
    payrollId: payroll.id, employeeId: slip.employeeId, kind: "recovery", amount: overpaid,
    advanceId: advance.id, paymentDate: input.todayKey, recordedById: input.actorId,
  });
  return { amount: overpaid };
}
```

Append to `salary-payments-fn.ts` (extend the import):

```ts
export const recordSalaryRefundFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeId: z.string().min(1),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      recordSalaryRefund(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });

export const recoverOverpaidSalaryFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string().min(1), employeeId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      recoverOverpaidSalary(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });
```

- [ ] **Step 4: Skip same-month recoveries in advance deduction** (`core.ts`)

Add `salaryPayments` to the hr-schema import in `core.ts`. Change `calculateEnrichedAdvanceDeductions`:

```ts
export async function calculateEnrichedAdvanceDeductions(
  employeeId: string,
  executor: typeof db | DbTransaction = db,
  options: { payrollId?: string } = {},
) {
  const pendingAdvances = await executor.query.salaryAdvances.findMany({
    where: and(
      eq(salaryAdvances.employeeId, employeeId),
      eq(salaryAdvances.status, "approved"),
    ),
  });

  // An overpaid amount recorded against this payroll is taken back from the NEXT salary,
  // so a revision of the same month must not deduct it.
  const sameMonthRecoveries = new Set(
    options.payrollId
      ? (await executor
          .select({ advanceId: salaryPayments.advanceId })
          .from(salaryPayments)
          .where(and(
            eq(salaryPayments.payrollId, options.payrollId),
            eq(salaryPayments.employeeId, employeeId),
            eq(salaryPayments.kind, "recovery"),
          ))).map((row) => row.advanceId)
      : [],
  );

  // Only advances that still have installments remaining
  const activeAdvances = pendingAdvances.filter(
    (a) => a.installmentsPaid < a.installmentMonths && !sameMonthRecoveries.has(a.id),
  );
```

(Leave the rest of the function unchanged.)

Change `recalculateAdvanceDeductionsAfterPayslipReversal` to take the payroll id and pass it on:

```ts
async function recalculateAdvanceDeductionsAfterPayslipReversal(
  tx: DbTransaction,
  employeeId: string,
  payrollId: string,
  previousAdvanceDeduction: number,
  payslipCalc: ReturnType<typeof calculatePayslip>,
) {
  const { totalDeduction, processedRecords } =
    await calculateEnrichedAdvanceDeductions(employeeId, tx, { payrollId });
```

Update the three call sites:
- In `generateEmployeePayslipCore` (~line 488): `await calculateEnrichedAdvanceDeductions(employeeId, db, { payrollId });`
- In `generateEmployeePayslipCore` (~line 728): `await recalculateAdvanceDeductionsAfterPayslipReversal(tx, employeeId, payrollId, advanceDeduction, payslipCalc);`
- In `simulateEmployeePayslipCore` (~line 1044): `await calculateEnrichedAdvanceDeductions(employeeId, db, { payrollId: input.payrollId });`

- [ ] **Step 5: Run tests and typecheck**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts && bun run test && bun run typecheck`
Expected: PASS (the full unit suite too, since `core.ts` changed).

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/hr/payroll src/__tests__/integration/salary-payments.test.ts
git commit -m "feat(payroll): refund or recover an overpaid salary"
```

---

### Task 6: Register payment data and payslip payment history (read side)

**Files:**
- Modify: `src/server-functions/hr/payroll/salary-payments.server.ts`
- Modify: `src/server-functions/hr/payroll/salary-payments-fn.ts`
- Modify: `src/server-functions/hr/payroll/dashboard-fn.ts:95-275`
- Test: `src/__tests__/integration/salary-payments.test.ts` (append)

**Interfaces:**
- Produces: `slipKey(payrollId, employeeId)`, `type SlipPaymentRow = ActiveRow & { walletName: string | null }`, `loadActivePaymentsForPayrolls(executor, payrollIds): Promise<Map<string, SlipPaymentRow[]>>`, `paidFromText(rows): string | null`, `type RegisterSlipPayment = SlipPaymentState & { paidFrom: string | null }`, `loadRegisterPayments(executor, payrollId): Promise<{ byEmployee: Map<string, RegisterSlipPayment>; summary: RegisterPaymentSummary; payable: PayableSlip[] }>`, `type PayableSlip = { employeeId: string; name: string; due: string }`, `getSlipPaymentHistory(executor, payslipId): Promise<SlipPaymentHistory>` where

```ts
type SlipPaymentHistory = {
  state: SlipPaymentState;
  paidFrom: string | null;
  distributorPaid: string;
  payments: {
    id: string; kind: SalaryPaymentKind; amount: string; walletName: string | null; paymentDate: string;
    enteredAt: Date; recordedBy: string | null; status: SalaryPaymentStatus;
    reversalReason: string | null; reversedAt: Date | null; reversedBy: string | null;
  }[];
};
```

- Produces: `getSalaryPaymentHistoryFn({ payslipId })`; `getMonthlyPayrollTableFn` rows gain `payment: RegisterSlipPayment | null`, response gains `paymentSummary: RegisterPaymentSummary` and `payableSlips: PayableSlip[]`.

- [ ] **Step 1: Write the failing tests** (append; add `getSlipPaymentHistory, loadRegisterPayments` to the server import, `advanceInstallments` to the hr-schema import)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("reading payments", () => {
  it("summarises the register and lists what is still payable", async () => {
    const f = await salaryFixture();
    const [a, b] = f.staff;
    await payFor(f, [a.employee.id], f.cash.id, f.todayKey);

    const register = await loadRegisterPayments(db, f.payroll.id);
    expect(register.summary).toEqual({ slipCount: 2, paidCount: 1, paidTotal: "26200.00", remainingTotal: "100000.00" });
    expect(register.payable).toEqual([{ employeeId: b.employee.id, name: b.name, due: "100000.00" }]);
    expect(register.byEmployee.get(a.employee.id)).toMatchObject({ status: "paid", paidFrom: f.cash.name });
    expect(register.byEmployee.get(b.employee.id)).toMatchObject({ status: "unpaid", paidFrom: null });
  });

  it("gives a slip's history, Paid from, and what a distributor already paid", async () => {
    const f = await salaryFixture();
    const a = f.staff[0];
    await payFor(f, [a.employee.id], f.cash.id, f.todayKey);
    await db.transaction((tx) => changeSalaryAccount(tx, { ...f.base, employeeIds: [a.employee.id], walletId: f.bank.id, paymentDate: f.todayKey }));
    const [advance] = await db.insert(salaryAdvances).values({
      employeeId: a.employee.id, amount: "5000.00", date: f.todayKey, status: "settled", installmentsPaid: 1,
      reason: "Salary paid directly by distributor. Reference: Invoice INV-1",
    }).returning();
    await db.insert(advanceInstallments).values({ advanceId: advance.id, payslipId: a.slip.id, amount: "5000.00", installmentNo: 1 });

    const history = await getSlipPaymentHistory(db, a.slip.id);
    expect(history.state.status).toBe("paid");
    expect(history.paidFrom).toBe(f.bank.name);
    expect(history.distributorPaid).toBe("5000.00");
    expect(history.payments.map((p) => [p.walletName, p.status])).toEqual([[f.cash.name, "reversed"], [f.bank.name, "active"]]);
    expect(history.payments[0]).toMatchObject({ recordedBy: "Accountant", reversedBy: "Accountant", reversalReason: `Account changed to ${f.bank.name}` });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts`
Expected: FAIL, `loadRegisterPayments` is not exported.

- [ ] **Step 3: Implement reads** (append to `salary-payments.server.ts`; add `advanceInstallments` to the hr-schema import; add `DISTRIBUTOR_SALARY_REASON_PREFIX, registerPaymentSummary` and types `RegisterPaymentSummary, SalaryPaymentKind, SalaryPaymentStatus, SlipPaymentState` to the helper import)

```ts
export const slipKey = (payrollId: string, employeeId: string) => `${payrollId}:${employeeId}`;
export type SlipPaymentRow = ActiveRow & { walletName: string | null };
export type RegisterSlipPayment = SlipPaymentState & { paidFrom: string | null };
export type PayableSlip = { employeeId: string; name: string; due: string };

export async function loadActivePaymentsForPayrolls(executor: Executor, payrollIds: string[]) {
  const map = new Map<string, SlipPaymentRow[]>();
  if (payrollIds.length === 0) return map;
  const rows = await executor
    .select({ payment: salaryPayments, walletName: wallets.name })
    .from(salaryPayments)
    .leftJoin(wallets, eq(wallets.id, salaryPayments.walletId))
    .where(and(inArray(salaryPayments.payrollId, payrollIds), eq(salaryPayments.status, "active")))
    .orderBy(asc(salaryPayments.createdAt));
  for (const { payment, walletName } of rows) {
    const key = slipKey(payment.payrollId, payment.employeeId);
    map.set(key, [...(map.get(key) ?? []), { ...payment, walletName }]);
  }
  return map;
}

/** Account names of the active payments, e.g. "Cash in Hand" or "Cash in Hand, Bank Alfalah". */
export function paidFromText(rows: SlipPaymentRow[]): string | null {
  const names = [...new Set(rows.filter((row) => row.kind === "payment" && row.walletName).map((row) => row.walletName!))];
  return names.length ? names.join(", ") : null;
}

export async function loadRegisterPayments(executor: Executor, payrollId: string) {
  const slips = await executor
    .select({ employeeId: payslips.employeeId, netSalary: payslips.netSalary, firstName: employees.firstName, lastName: employees.lastName })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.payrollId, payrollId))
    .orderBy(asc(employees.employeeCode));
  const payments = await loadActivePaymentsForPayrolls(executor, [payrollId]);
  const byEmployee = new Map<string, RegisterSlipPayment>();
  const payable: PayableSlip[] = [];
  for (const slip of slips) {
    const rows = payments.get(slipKey(payrollId, slip.employeeId)) ?? [];
    const state = slipPaymentState(slip.netSalary, rows);
    byEmployee.set(slip.employeeId, { ...state, paidFrom: paidFromText(rows) });
    if (new Big(state.due).gt(0)) payable.push({ employeeId: slip.employeeId, name: `${slip.firstName} ${slip.lastName}`, due: state.due });
  }
  const summary: RegisterPaymentSummary = registerPaymentSummary([...byEmployee.values()]);
  return { byEmployee, summary, payable };
}

export async function getSlipPaymentHistory(executor: Executor, payslipId: string) {
  const slip = await executor.query.payslips.findFirst({
    where: eq(payslips.id, payslipId),
    columns: { id: true, payrollId: true, employeeId: true, netSalary: true },
  });
  if (!slip) throw new Error("Payslip not found");
  const rows = await executor.query.salaryPayments.findMany({
    where: and(eq(salaryPayments.payrollId, slip.payrollId), eq(salaryPayments.employeeId, slip.employeeId)),
    with: {
      wallet: { columns: { name: true } },
      recordedBy: { columns: { name: true } },
      reversedBy: { columns: { name: true } },
    },
    orderBy: [asc(salaryPayments.createdAt)],
  });
  const active = rows.filter((row) => row.status === "active").map((row) => ({ ...row, walletName: row.wallet?.name ?? null }));
  const [distributor] = await executor
    .select({ total: sql<string>`coalesce(sum(${advanceInstallments.amount}), 0)` })
    .from(advanceInstallments)
    .innerJoin(salaryAdvances, eq(salaryAdvances.id, advanceInstallments.advanceId))
    .where(and(
      eq(advanceInstallments.payslipId, slip.id),
      sql`${salaryAdvances.reason} like ${`${DISTRIBUTOR_SALARY_REASON_PREFIX}%`}`,
    ));
  return {
    state: slipPaymentState(slip.netSalary, active),
    paidFrom: paidFromText(active),
    distributorPaid: new Big(distributor?.total ?? 0).toFixed(2),
    payments: rows.map((row) => ({
      id: row.id,
      kind: row.kind as SalaryPaymentKind,
      amount: row.amount,
      walletName: row.wallet?.name ?? null,
      paymentDate: row.paymentDate,
      enteredAt: row.createdAt,
      recordedBy: row.recordedBy?.name ?? null,
      status: row.status as SalaryPaymentStatus,
      reversalReason: row.reversalReason,
      reversedAt: row.reversedAt,
      reversedBy: row.reversedBy?.name ?? null,
    })),
  };
}
export type SlipPaymentHistory = Awaited<ReturnType<typeof getSlipPaymentHistory>>;
```

Append to `salary-payments-fn.ts` (extend the import):

```ts
export const getSalaryPaymentHistoryFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payslipId: z.string().min(1) }))
  .handler(async ({ data }) => getSlipPaymentHistory(db, data.payslipId));
```

- [ ] **Step 4: Add payment data to the register query** (`dashboard-fn.ts`)

Add the import:

```ts
import { loadRegisterPayments } from "./salary-payments.server";
```

After the `existingPayslips` block (~line 138), add:

```ts
    // ── Salary payments for this payroll (all pages) ───────────────────
    const registerPayments = payroll
      ? await loadRegisterPayments(db, payroll.id)
      : { byEmployee: new Map(), summary: { slipCount: 0, paidCount: 0, paidTotal: "0.00", remainingTotal: "0.00" }, payable: [] };
```

In the row object (after `status: payroll?.status || "pending",`) add:

```ts
        payment: payslip ? registerPayments.byEmployee.get(emp.id) ?? null : null,
```

In the returned object (after `payslipsGeneratedCount`) add:

```ts
      paymentSummary: registerPayments.summary,
      payableSlips: registerPayments.payable,
```

- [ ] **Step 5: Run tests and typecheck**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts && bunx vitest run src/server-functions/hr/payroll/salary-payments-fn.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/hr/payroll src/__tests__/integration/salary-payments.test.ts
git commit -m "feat(payroll): payment status on the register and payslip payment history"
```

---

### Task 7: Ledger — Payroll filter and payment dates

**Files:**
- Modify: `src/server-functions/finance-fn.ts:716-770` (`getTransactionsFn`)
- Modify: `src/components/finance/ledger-container.tsx:374-382`
- Test: `src/__tests__/integration/salary-ledger-reports.test.ts`

**Interfaces:**
- Consumes: `PAYROLL_LEDGER_SOURCE_PREFIX` (Task 1), `paySalaries` (Task 3), `salaryFixture` (Task 3).
- Produces: `getTransactionsFn({ source: "Payroll" })` returns every `Payroll - <month>` line; results sorted and date-filtered by `effectiveDate`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/integration/salary-ledger-reports.test.ts
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { paySalaries } from "@/server-functions/hr/payroll/salary-payments.server";
import { getTransactionsFn } from "@/server-functions/finance-fn";
import { salaryFixture } from "./salary-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator | ((input: unknown) => unknown)) => {
      validator = typeof schema === "function" ? { parse: schema as (input: unknown) => unknown } : schema;
      return builder;
    },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context?: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({
  requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {},
  requireHrManageMiddleware: {}, requireHrViewMiddleware: {}, requireReportsViewMiddleware: {},
}));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Fixture = Awaited<ReturnType<typeof salaryFixture>>;
const payOne = (f: Fixture, index: number, paymentDate: string) =>
  db.transaction((tx) => paySalaries(tx, { ...f.base, employeeIds: [f.staff[index].employee.id], walletId: f.cash.id, paymentDate }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("salary payments on the Ledger", () => {
  it("finds payroll lines with the Payroll filter, newest payment date first", async () => {
    const f = await salaryFixture();
    await payOne(f, 1, `${f.year}-11-30`); // entered first, paid later
    await payOne(f, 0, `${f.year}-11-28`); // entered second, back-dated earlier

    const result = (await getTransactionsFn({ data: { source: "Payroll", walletId: f.cash.id } } as never)) as { data: { description: string | null }[] };
    expect(result.data.map((t) => t.description)).toEqual([
      `Salary — ${f.staff[1].name} — Nov ${f.year}`,
      `Salary — ${f.staff[0].name} — Nov ${f.year}`,
    ]);

    const nov28 = (await getTransactionsFn({ data: { walletId: f.cash.id, dateFrom: `${f.year}-11-28T00:00:00+05:00`, dateTo: `${f.year}-11-28T23:59:59+05:00` } } as never)) as { data: unknown[] };
    expect(nov28.data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-ledger-reports.test.ts`
Expected: FAIL (empty result for `source: "Payroll"`; order by entry time).

- [ ] **Step 3: Change the server query** (`finance-fn.ts`)

Add `like` and `desc` to the `drizzle-orm` import, and `import { PAYROLL_LEDGER_SOURCE_PREFIX } from "@/lib/hr/salary-payments";`. In `getTransactionsFn` replace the source and date conditions and the ordering:

```ts
    if (data.source) {
      // Payroll lines carry the month ("Payroll - Nov 2026"); the filter's "Payroll" matches them all.
      conditions.push(
        data.source === PAYROLL_LEDGER_SOURCE_PREFIX
          ? like(transactions.source, `${PAYROLL_LEDGER_SOURCE_PREFIX} - %`)
          : eq(transactions.source, data.source),
      );
    }
    if (data.type) conditions.push(eq(transactions.type, data.type));

    // Lines are dated by when the money really moved (a back-dated salary shows on its payment day).
    if (data.dateFrom) {
      const from = parseISO(data.dateFrom);
      if (isValid(from)) conditions.push(gte(transactions.effectiveDate, from));
    }
    if (data.dateTo) {
      const to = parseISO(data.dateTo);
      if (isValid(to)) conditions.push(lte(transactions.effectiveDate, to));
    }
```

and

```ts
      orderBy: (t, { desc }) => [desc(t.effectiveDate), desc(t.createdAt)],
```

(If `desc` from the import collides with the callback parameter name, keep only the callback's `desc` and don't add it to the import.)

- [ ] **Step 4: Show the payment date and description** (`ledger-container.tsx`)

Replace the date cell contents (`format(new Date(txn.createdAt), ...)` twice) with:

```tsx
                          <span className="text-sm font-bold tabular-nums text-foreground">{format(new Date(txn.effectiveDate), "dd MMM yyyy")}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums uppercase  font-semibold">
                            Entered {format(new Date(txn.createdAt), "dd MMM, hh:mm a")}
                          </span>
```

Replace the source cell contents with:

```tsx
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-foreground">{txn.source}</span>
                          {txn.description && <span className="text-xs text-muted-foreground">{txn.description}</span>}
                        </div>
```

- [ ] **Step 5: Run tests and typecheck**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-ledger-reports.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/finance-fn.ts src/components/finance/ledger-container.tsx src/__tests__/integration/salary-ledger-reports.test.ts
git commit -m "fix(ledger): Payroll filter finds salary lines; lines dated by payment date"
```

---

### Task 8: Reports count salaries without an Approve step

**Files:**
- Modify: `src/server-functions/reports/salaries-report-fn.ts`
- Modify: `src/routes/_protected/reports/salaries/index.tsx`
- Modify: `src/__tests__/report-print-fixtures.test.tsx` (salaries fixture branch, ~line 162)
- Modify: `src/server-functions/reports/monthly-report-queries.server.ts:143` and `:433`
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts:660-695`
- Test: `src/__tests__/integration/salary-ledger-reports.test.ts` (append)

**Interfaces:**
- Consumes: `loadActivePaymentsForPayrolls`, `slipKey`, `paidFromText` (Task 6); `slipPaymentState` (Task 1); `effectiveDateFromKey` (Task 1).
- Produces: salaries report rows gain `paidFrom: string | null`, `paid: number`, `due: number`; summary gains `totalPaid`, `totalDue`. Rows are selected by payroll month.

- [ ] **Step 1: Write the failing test** (append to `salary-ledger-reports.test.ts`; add `import { getSalariesReportFn } from "@/server-functions/reports/salaries-report-fn";`)

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("salaries report", () => {
  it("selects slips by payroll month and shows what was paid and from where", async () => {
    const f = await salaryFixture();
    await payOne(f, 0, `${f.year}-12-02`);

    const report = (await getSalariesReportFn({ data: { dateFrom: `${f.year}-11-01`, dateTo: `${f.year}-11-30` } } as never)) as {
      payslips: { employeeCode: string; paidFrom: string | null; paid: number; due: number }[];
      summary: { totalPaid: number; totalDue: number; count: number };
    };
    const mine = report.payslips.filter((p) => p.employeeCode.startsWith(f.id.slice(0, 8)));
    expect(mine.map((p) => [p.paidFrom, p.paid, p.due])).toEqual([[f.cash.name, 26200, 0], [null, 0, 100000]]);
    expect(report.summary.count).toBe(2);
    expect(report.summary.totalPaid).toBe(26200);
    expect(report.summary.totalDue).toBe(100000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-ledger-reports.test.ts`
Expected: FAIL (no rows: the report filters by `payrolls.paidAt`).

- [ ] **Step 3: Rewrite the Salaries report selection** (`salaries-report-fn.ts`)

Replace the imports and the `conditions` block, ordering and return mapping:

```ts
import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { payslips, payrolls, employees } from "@/db/schemas/hr-schema";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql, desc } from "drizzle-orm";
import { firstDayOfPayrollMonth, slipPaymentState } from "@/lib/hr/salary-payments";
import { loadActivePaymentsForPayrolls, paidFromText, slipKey } from "@/server-functions/hr/payroll/salary-payments.server";
```

```ts
  .handler(async ({ data }) => {
    // Slips are selected by payroll month: a month is in range when its first day falls between
    // the first day of dateFrom's month and dateTo.
    const conditions = [];
    if (data.dateFrom) conditions.push(gte(payrolls.month, firstDayOfPayrollMonth(data.dateFrom)));
    if (data.dateTo) conditions.push(lte(payrolls.month, data.dateTo.slice(0, 10)));
```

Add `payrollId: payrolls.id, employeeId: payslips.employeeId,` to the selected columns, and change the ordering to `.orderBy(desc(payrolls.month), asc(employees.employeeCode));`. Remove the `reportDateBounds` import.

After `rows` is loaded:

```ts
    const payments = await loadActivePaymentsForPayrolls(db, [...new Set(rows.map((r) => r.payrollId))]);
    const withPayments = rows.map((r) => {
      const slipRows = payments.get(slipKey(r.payrollId, r.employeeId)) ?? [];
      const state = slipPaymentState(r.netSalary, slipRows);
      return { ...r, paidFrom: paidFromText(slipRows), paid: Number(state.paid), due: Number(state.due) };
    });
    const totalPaid = Number(withPayments.reduce((s, r) => s.plus(r.paid), new Big(0)).toFixed(2));
    const totalDue = Number(withPayments.reduce((s, r) => s.plus(r.due), new Big(0)).toFixed(2));
```

Map over `withPayments` instead of `rows` in the returned `payslips`, and add `totalPaid, totalDue` to `summary`.

- [ ] **Step 4: Update the Salaries report page** (`routes/_protected/reports/salaries/index.tsx`)

- `basis` → `"Payslips selected by payroll month. Paid and Due come from salary payments recorded on the Payroll Register."`
- `periodLabel` → `"Payroll month range"`
- Add two summary cards after "Net including arrears":

```tsx
              <SummaryCard label="Paid" value={formatReportMoney(data.summary.totalPaid)} accentColor={ACCENT} />
              <SummaryCard label="Still due" value={formatReportMoney(data.summary.totalDue)} accentColor={ACCENT} />
```

and change that grid to `md:grid-cols-3 print:grid-cols-3`.
- Table headers become `[..."Net incl. arrears", "Paid from", "Paid", "Due"]`, `alignRight={[2, 3, 4, 5, 6, 8, 9]}`.
- In each row, after the money cells map, add:

```tsx
                  <ReportCell>{p.paidFrom ?? "Not paid"}</ReportCell>
                  <ReportCell align="right" mono>{formatReportMoney(p.paid)}</ReportCell>
                  <ReportCell align="right" mono>{formatReportMoney(p.due)}</ReportCell>
```

- In the total row, after its money cells map, add:

```tsx
                <ReportCell />
                <ReportCell align="right" bold mono>{formatReportMoney(data.summary.totalPaid)}</ReportCell>
                <ReportCell align="right" bold mono>{formatReportMoney(data.summary.totalDue)}</ReportCell>
```

- In `src/__tests__/report-print-fixtures.test.tsx`, `kind === "salaries"` branch: add to each payslip object `paidFrom: "Cash in Hand", paid: <same value as that object's netSalary>, due: 0, payrollId: "payroll-1", employeeId: id`, and to `summary` add `totalPaid: <same value as totalNet>, totalDue: 0`.

- [ ] **Step 5: Monthly report counts generated slips by payroll month** (`monthly-report-queries.server.ts`)

Delete the line `inArray(payrolls.status, ["approved", "paid"]),` at ~143 and the `inArray(payrolls.status, ["approved", "paid"]), ` part at ~433 (keep the month bounds). Remove `inArray` from the import only if nothing else in the file uses it.

- [ ] **Step 6: P&L puts salaries on the first payment date** (`company-reporting-core.ts`)

Add imports: `import { salaryPayments } from "@/db/schemas/hr-schema";` (extend the existing hr-schema import), `import { effectiveDateFromKey } from "@/lib/hr/salary-payments";`, `import { reportDateKey } from "@/lib/report-dates";` (skip any already imported). Replace the payroll query (the `db.select({ payrollId: payrolls.id, ... paidAt: payrolls.paidAt, ...})` block) with:

```ts
    (() => {
      // A slip's salary cost falls on the day it was first paid (no Approve step any more).
      const firstPayment = db
        .select({
          payrollId: salaryPayments.payrollId,
          employeeId: salaryPayments.employeeId,
          paidOn: sql<string>`min(${salaryPayments.paymentDate})`.as("paid_on"),
        })
        .from(salaryPayments)
        .where(and(eq(salaryPayments.kind, "payment"), eq(salaryPayments.status, "active")))
        .groupBy(salaryPayments.payrollId, salaryPayments.employeeId)
        .as("first_payment");
      return db
        .select({
          payrollId: payrolls.id,
          payrollMonth: payrolls.month,
          payrollStartDate: payrolls.startDate,
          payrollEndDate: payrolls.endDate,
          paidOn: firstPayment.paidOn,
          payslipId: payslips.id,
          employeeId: employees.id,
          grossSalary: payslips.grossSalary,
          commissionAmount: payslips.commissionAmount,
        })
        .from(payslips)
        .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
        .innerJoin(employees, eq(payslips.employeeId, employees.id))
        .innerJoin(firstPayment, and(eq(firstPayment.payrollId, payslips.payrollId), eq(firstPayment.employeeId, payslips.employeeId)))
        .where(and(
          sql`${firstPayment.paidOn} >= ${reportDateKey(fromDate)}`,
          sql`${firstPayment.paidOn} <= ${reportDateKey(toDate)}`,
        ))
        .then((rows) =>
          rows.map((row) => ({
            payrollId: row.payrollId,
            payrollMonth: row.payrollMonth,
            payrollStartDate: row.payrollStartDate,
            payrollEndDate: row.payrollEndDate,
            paidAt: effectiveDateFromKey(String(row.paidOn).slice(0, 10)),
            payslipId: row.payslipId,
            employeeId: row.employeeId,
            grossSalary: toNumber(row.grossSalary),
            commissionAmount: toNumber(row.commissionAmount),
          })),
        );
    })(),
```

Use the same variable names for the range bounds that the surrounding code passes to the other queries in that `Promise.all` (they are `fromDate` / `toDate` in the replaced block). The output shape (`paidAt: Date` etc.) is unchanged, so callers need no change.

- [ ] **Step 7: Run tests and typecheck**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-ledger-reports.test.ts && bun run test && bun run typecheck`
Expected: PASS (including existing P&L, monthly-report and report-print tests).

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/reports src/routes/_protected/reports/salaries/index.tsx src/__tests__/report-print-fixtures.test.tsx src/__tests__/integration/salary-ledger-reports.test.ts
git commit -m "fix(reports): count salaries without an approve step; paid columns on the Salaries report"
```

---

### Task 9: Delete guards

**Files:**
- Modify: `src/server-functions/hr/payroll/payroll-fn.ts` (`deletePayrollFn`, ~line 720)
- Modify: `src/server-functions/hr/employees/delete-employee-fn.ts` (`approveEmployeeDeletionFn`, ~line 34)
- Test: `src/server-functions/hr/payroll/salary-delete-guards.test.ts`

- [ ] **Step 1: Write the failing source test**

```ts
// src/server-functions/hr/payroll/salary-delete-guards.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("salary payments block deletes", () => {
  it("a payroll with salary payments can't be deleted", () => {
    const source = read("src/server-functions/hr/payroll/payroll-fn.ts");
    const fn = source.slice(source.indexOf("export const deletePayrollFn"));
    const guard = fn.indexOf("This payroll has salary payments. Undo them before deleting the payroll.");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fn.indexOf("tx.delete(payslips)"));
  });

  it("an employee with salary payments can't be deleted", () => {
    const source = read("src/server-functions/hr/employees/delete-employee-fn.ts");
    const fn = source.slice(source.indexOf("export const approveEmployeeDeletionFn"));
    const guard = fn.indexOf("Cannot delete an employee with salary payments. Archive the employee instead.");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fn.indexOf("reversePayslipSideEffects"));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/server-functions/hr/payroll/salary-delete-guards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the guards**

In `payroll-fn.ts`, add `salaryPayments` to the hr-schema import. Inside `deletePayrollFn`'s `db.transaction(async (tx) => {`, first lines:

```ts
      const [paid] = await tx
        .select({ id: salaryPayments.id })
        .from(salaryPayments)
        .where(eq(salaryPayments.payrollId, data.payrollId))
        .limit(1);
      if (paid) throw new Error("This payroll has salary payments. Undo them before deleting the payroll.");
```

In `delete-employee-fn.ts`, add `salaryPayments` to the hr-schema import. Inside `approveEmployeeDeletionFn`'s transaction, before the `employeePayslips` query:

```ts
      const [paid] = await tx
        .select({ id: salaryPayments.id })
        .from(salaryPayments)
        .where(eq(salaryPayments.employeeId, data.id))
        .limit(1);
      if (paid) throw new Error("Cannot delete an employee with salary payments. Archive the employee instead.");
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bunx vitest run src/server-functions/hr/payroll/salary-delete-guards.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/hr/payroll/payroll-fn.ts src/server-functions/hr/employees/delete-employee-fn.ts src/server-functions/hr/payroll/salary-delete-guards.test.ts
git commit -m "fix(payroll): keep payrolls and employees that have salary payments"
```

---

### Task 10: Hooks and paying from the Payroll Register

**Files:**
- Create: `src/hooks/hr/use-salary-payments.ts`
- Create: `src/components/hr/payroll/salary-payment-badge.tsx`
- Create: `src/components/hr/payroll/salary-account-dialog.tsx`
- Modify: `src/components/hr/payroll/payroll-container.tsx`
- Test: `src/__tests__/salary-account-dialog.behavior.test.tsx`

**Interfaces:**
- Consumes: server functions from Tasks 3–6; `RegisterSlipPayment`, `RegisterPaymentSummary`, `PayableSlip` types; `useWallets` from `@/hooks/finance/use-finance`; `useViewerAccess` from `@/hooks/use-viewer-access`; `hasPermission` from `@/lib/rbac`; `reportDateKey` from `@/lib/report-dates`.
- Produces: hooks `usePaySalaries`, `useChangeSalaryAccount`, `useUndoSalaryPayment`, `useRecordSalaryRefund`, `useRecoverOverpaidSalary`, `useSalaryPaymentHistory(payslipId)`; components `SalaryPaymentBadge({ payment })`, `SalaryAccountDialog(props)` (props below), hook `useCanPaySalaries(): boolean`.

`SalaryAccountDialog` props:

```ts
type SalaryAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  lines: { employeeId: string; name: string; amount: string }[];
  wallets: { id: string; name: string; balance: string }[];
  /** Money goes out of the chosen account (pay, change account) or into it (refund). */
  direction: "out" | "in";
  payrollMonth: string;
  todayKey: string;
  pending: boolean;
  onConfirm: (choice: { walletId: string; paymentDate: string }) => void;
};
```

- [ ] **Step 1: Write the failing behaviour test**

```tsx
// src/__tests__/salary-account-dialog.behavior.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalaryAccountDialog } from "@/components/hr/payroll/salary-account-dialog";

afterEach(cleanup);

const lines = [
  { employeeId: "e1", name: "Shahab Gul", amount: "100000.00" },
  { employeeId: "e2", name: "Anees Ur Rahman", amount: "28424.00" },
];
const props = {
  open: true, onOpenChange: vi.fn(), title: "Pay salaries", description: "Choose the account", confirmLabel: "Pay Rs 1,28,424",
  lines, direction: "out" as const, payrollMonth: "2026-11-01", todayKey: "2026-12-03", pending: false,
};

describe("SalaryAccountDialog", () => {
  it("lists who is paid and the total, and confirms with the first account and today", () => {
    const onConfirm = vi.fn();
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={onConfirm} />);
    expect(screen.getByText("Shahab Gul")).toBeTruthy();
    expect(screen.getByText("Total: Rs 1,28,424")).toBeTruthy();
    expect(screen.getByText("Balance after: Rs 3,71,576")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay Rs 1,28,424" }));
    expect(onConfirm).toHaveBeenCalledWith({ walletId: "cash", paymentDate: "2026-12-03" });
  });

  it("blocks a short account and explains the shortfall", () => {
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "80000.00" }]} onConfirm={vi.fn()} />);
    expect(screen.getByText("Cash in Hand has Rs 80,000. Needed Rs 1,28,424. Short by Rs 48,424.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay Rs 1,28,424" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks a future payment date", () => {
    render(<SalaryAccountDialog {...props} wallets={[{ id: "cash", name: "Cash in Hand", balance: "500000.00" }]} onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-12-04" } });
    expect(screen.getByText("Payment date can't be in the future")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pay Rs 1,28,424" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never blocks money coming in", () => {
    render(<SalaryAccountDialog {...props} direction="in" wallets={[{ id: "cash", name: "Cash in Hand", balance: "0.00" }]} onConfirm={vi.fn()} />);
    expect(screen.queryByText(/Short by/)).toBeNull();
    expect(screen.getByText("Balance after: Rs 1,28,424")).toBeTruthy();
  });
});
```

If `ResponsiveDialog` needs `matchMedia` beyond the setup stub or renders a Drawer in jsdom, that's fine: the assertions only use text, label and button roles.

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/__tests__/salary-account-dialog.behavior.test.tsx`
Expected: FAIL, cannot resolve the component.

- [ ] **Step 3: Write the hooks**

```ts
// src/hooks/hr/use-salary-payments.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  changeSalaryAccountFn,
  getSalaryPaymentHistoryFn,
  paySalariesFn,
  recordSalaryRefundFn,
  recoverOverpaidSalaryFn,
  undoSalaryPaymentFn,
} from "@/server-functions/hr/payroll/salary-payments-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";

const AFFECTED_KEYS = ["payroll-dashboard", "salary-payments", "wallets", "transactions", "employee-payroll-history"];

function useInvalidateSalaryData() {
  const queryClient = useQueryClient();
  return () => Promise.all(AFFECTED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export function useCanPaySalaries(): boolean {
  const { data: access } = useViewerAccess();
  const permissions = access?.permissions ?? [];
  return hasPermission(permissions, "hr.manage") && hasPermission(permissions, "finance.manage");
}

export const usePaySalaries = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof paySalariesFn>[0]["data"]) => paySalariesFn({ data }),
    onSuccess: async (result) => {
      toast.success(`${result.paidCount} salar${result.paidCount === 1 ? "y" : "ies"} paid`);
      await invalidate();
    },
    onError: (error: Error) => toast.error("Payment failed", { description: error.message }),
  });
};

export const useChangeSalaryAccount = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof changeSalaryAccountFn>[0]["data"]) => changeSalaryAccountFn({ data }),
    onSuccess: async () => { toast.success("Account changed"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't change the account", { description: error.message }),
  });
};

export const useUndoSalaryPayment = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof undoSalaryPaymentFn>[0]["data"]) => undoSalaryPaymentFn({ data }),
    onSuccess: async () => { toast.success("Payment undone"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't undo the payment", { description: error.message }),
  });
};

export const useRecordSalaryRefund = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof recordSalaryRefundFn>[0]["data"]) => recordSalaryRefundFn({ data }),
    onSuccess: async () => { toast.success("Refund recorded"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't record the refund", { description: error.message }),
  });
};

export const useRecoverOverpaidSalary = () => {
  const invalidate = useInvalidateSalaryData();
  return useMutation({
    mutationFn: (data: Parameters<typeof recoverOverpaidSalaryFn>[0]["data"]) => recoverOverpaidSalaryFn({ data }),
    onSuccess: async () => { toast.success("Will be taken from the next salary"); await invalidate(); },
    onError: (error: Error) => toast.error("Couldn't set up the recovery", { description: error.message }),
  });
};

export const useSalaryPaymentHistory = (payslipId: string | null | undefined) =>
  useQuery({
    queryKey: ["salary-payments", payslipId],
    queryFn: () => getSalaryPaymentHistoryFn({ data: { payslipId: payslipId! } }),
    enabled: !!payslipId,
  });
```

If `Parameters<typeof fn>[0]["data"]` doesn't type-check with this TanStack Start version, write the input object types out by hand from the server function validators.

- [ ] **Step 4: Write the badge**

```tsx
// src/components/hr/payroll/salary-payment-badge.tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SLIP_PAYMENT_LABELS, type SlipPaymentStatus } from "@/lib/hr/salary-payments";
import type { RegisterSlipPayment } from "@/server-functions/hr/payroll/salary-payments.server";

const TONE: Record<SlipPaymentStatus, string> = {
  unpaid: "bg-emerald-500 text-white",
  paid: "bg-blue-600 text-white",
  balance_due: "bg-amber-500 text-white",
  overpaid: "bg-rose-500 text-white",
  nothing_to_pay: "bg-muted text-muted-foreground",
};

export function SalaryPaymentBadge({ payment }: { payment: RegisterSlipPayment }) {
  const detail =
    payment.status === "balance_due" ? `${formatRupees(payment.due)} still to pay`
    : payment.status === "overpaid" ? `${formatRupees(payment.overpaid)} overpaid`
    : null;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge className={cn("border-none text-[10px] px-2 py-0.5 h-5 font-semibold uppercase tracking-wider w-fit rounded-none", TONE[payment.status])}>
        {SLIP_PAYMENT_LABELS[payment.status]}
      </Badge>
      <span className="text-xs font-semibold text-foreground tabular-nums">{formatRupees(payment.net)}</span>
      {payment.paidFrom && <span className="text-[11px] text-muted-foreground">from {payment.paidFrom}</span>}
      {detail && <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{detail}</span>}
    </div>
  );
}
```

`salary-payments.server.ts` only exports types to this client file (type-only import), so no server code reaches the browser bundle.

- [ ] **Step 5: Write the account dialog**

```tsx
// src/components/hr/payroll/salary-account-dialog.tsx
import { useState } from "react";
import Big from "big.js";
import { Wallet } from "lucide-react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupees } from "@/lib/finance/expense-entry";
import { firstDayOfPayrollMonth, paymentDateError, shortfallMessage } from "@/lib/hr/salary-payments";

export type SalaryAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  lines: { employeeId: string; name: string; amount: string }[];
  wallets: { id: string; name: string; balance: string }[];
  /** Money goes out of the chosen account (pay, change account) or into it (refund). */
  direction: "out" | "in";
  payrollMonth: string;
  todayKey: string;
  pending: boolean;
  onConfirm: (choice: { walletId: string; paymentDate: string }) => void;
};

export function SalaryAccountDialog(props: SalaryAccountDialogProps) {
  const { open, onOpenChange, title, description, confirmLabel, lines, wallets, direction, payrollMonth, todayKey, pending, onConfirm } = props;
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [paymentDate, setPaymentDate] = useState(todayKey);
  const wallet = wallets.find((w) => w.id === walletId);
  const total = lines.reduce((sum, line) => sum.plus(line.amount), new Big(0)).toFixed(2);
  const after = wallet ? new Big(wallet.balance)[direction === "out" ? "minus" : "plus"](total).toFixed(2) : null;
  const shortfall = direction === "out" && wallet && new Big(wallet.balance).lt(total)
    ? shortfallMessage(wallet.name, wallet.balance, total)
    : null;
  const dateError = paymentDateError(paymentDate, payrollMonth, todayKey);
  const blocked = !wallet || !!shortfall || !!dateError || pending || lines.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} description={description} icon={Wallet}>
      <div className="space-y-4 min-w-[min(28rem,100%)]">
        <div className="space-y-1.5">
          <Label>Account</Label>
          <Select value={walletId} onValueChange={setWalletId}>
            <SelectTrigger className="rounded-none"><SelectValue placeholder="Choose an account" /></SelectTrigger>
            <SelectContent>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name} · {formatRupees(w.balance)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salary-payment-date">Payment date</Label>
          <Input
            id="salary-payment-date"
            type="date"
            className="rounded-none"
            value={paymentDate}
            min={firstDayOfPayrollMonth(payrollMonth)}
            max={todayKey}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          {dateError && <p className="text-xs text-destructive">{dateError}</p>}
        </div>
        <ul className="max-h-48 overflow-y-auto border border-border divide-y divide-border text-sm">
          {lines.map((line) => (
            <li key={line.employeeId} className="flex justify-between px-3 py-1.5">
              <span>{line.name}</span>
              <span className="tabular-nums">{formatRupees(line.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="text-sm space-y-0.5">
          <p className="font-semibold">Total: {formatRupees(total)}</p>
          {after && <p className="text-muted-foreground">Balance after: {formatRupees(after)}</p>}
          {shortfall && <p className="text-destructive font-medium">{shortfall}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="rounded-none" disabled={blocked} onClick={() => onConfirm({ walletId, paymentDate })}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 6: Run the behaviour test**

Run: `bunx vitest run src/__tests__/salary-account-dialog.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire paying into the register** (`payroll-container.tsx`)

Imports to add:

```ts
import Big from "big.js";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallets } from "@/hooks/finance/use-finance";
import { useCanPaySalaries, usePaySalaries } from "@/hooks/hr/use-salary-payments";
import { SalaryPaymentBadge } from "@/components/hr/payroll/salary-payment-badge";
import { SalaryAccountDialog } from "@/components/hr/payroll/salary-account-dialog";
import { formatRupees } from "@/lib/finance/expense-entry";
import { reportDateKey } from "@/lib/report-dates";
import type { RegisterSlipPayment } from "@/server-functions/hr/payroll/salary-payments.server";
```

Add to `EmployeePayrollRow`: `payment: RegisterSlipPayment | null;`

State, next to the other `useState` calls at the top of the component (before the early return):

```ts
  const canPay = useCanPaySalaries();
  const { data: walletList = [] } = useWallets({ enabled: canPay });
  const paySalaries = usePaySalaries();
  const [selected, setSelected] = useState<Record<string, { name: string; amount: string }>>({});
  const [payOpen, setPayOpen] = useState(false);
  const todayKey = reportDateKey(new Date());
```

In the `MonthSelector` `onChange`, also call `setSelected({});`.

Derived values (after `employees` is defined):

```ts
  const selectedLines = Object.entries(selected).map(([employeeId, v]) => ({ employeeId, ...v }));
  const payLines = selectedLines.length > 0
    ? selectedLines
    : data.payableSlips.map((slip) => ({ employeeId: slip.employeeId, name: slip.name, amount: slip.due }));
  const payTotal = payLines.reduce((sum, line) => sum.plus(line.amount), new Big(0)).toFixed(2);
  const payLabel = selectedLines.length > 0 ? `Pay selected · ${formatRupees(payTotal)}` : `Pay all unpaid · ${formatRupees(payTotal)}`;
  const isPayable = (row: EmployeePayrollRow) => !!row.payment && new Big(row.payment.due).gt(0);
```

First column in `columns` (only when `canPay`; build the array then `unshift` it, or spread conditionally):

```tsx
      ...(canPay ? [{
        id: "select",
        header: "",
        cell: ({ row }: { row: { original: EmployeePayrollRow & { missedLastMonth: boolean } } }) => {
          const emp = row.original;
          if (!isPayable(emp)) return null;
          return (
            <Checkbox
              aria-label={`Select ${emp.firstName} ${emp.lastName}`}
              checked={!!selected[emp.id]}
              onCheckedChange={(checked) =>
                setSelected((current) => {
                  const next = { ...current };
                  if (checked) next[emp.id] = { name: `${emp.firstName} ${emp.lastName}`, amount: emp.payment!.due };
                  else delete next[emp.id];
                  return next;
                })
              }
            />
          );
        },
      } as ColumnDef<EmployeePayrollRow & { missedLastMonth: boolean }>] : []),
```

In the `status` ("Payslip") column, replace the `hasPayslip` branch's JSX with:

```tsx
          if (row.original.hasPayslip && row.original.payment) {
            return <SalaryPaymentBadge payment={row.original.payment} />;
          }
```

(keep the old GENERATED badge as the fallback when `hasPayslip` is true but `payment` is null.)

Add `selected, canPay` to the `useMemo` dependency list of `columns`.

In the register header, before the search box `div`:

```tsx
            {canPay && data.payrollId && payLines.length > 0 && (
              <Button className="h-9 rounded-none whitespace-nowrap" onClick={() => setPayOpen(true)}>
                {payLabel}
              </Button>
            )}
```

Directly under the register header `div` (still inside the table card), add the summary strip:

```tsx
        {data.paymentSummary.slipCount > 0 && (
          <div className="px-6 py-2 border-b border-border text-xs text-muted-foreground">
            Paid {data.paymentSummary.paidCount} of {data.paymentSummary.slipCount} · {formatRupees(data.paymentSummary.paidTotal)} paid · {formatRupees(data.paymentSummary.remainingTotal)} remaining
          </div>
        )}
```

Change the empty-row `colSpan={7}` to `colSpan={columns.length}`.

Before `<SalaryCalculatorSheet`, add:

```tsx
      {payOpen && data.payrollId && (
        <SalaryAccountDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          title="Pay salaries"
          description="The total comes out of the account you choose and shows on the Ledger."
          confirmLabel={`Pay ${formatRupees(payTotal)}`}
          lines={payLines}
          wallets={walletList}
          direction="out"
          payrollMonth={`${month}-01`}
          todayKey={todayKey}
          pending={paySalaries.isPending}
          onConfirm={({ walletId, paymentDate }) =>
            paySalaries.mutate(
              { payrollId: data.payrollId!, employeeIds: payLines.map((line) => line.employeeId), walletId, paymentDate },
              { onSuccess: () => { setPayOpen(false); setSelected({}); } },
            )
          }
        />
      )}
```

- [ ] **Step 8: Typecheck and unit tests**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/hr/use-salary-payments.ts src/components/hr/payroll src/__tests__/salary-account-dialog.behavior.test.tsx
git commit -m "feat(payroll): pay selected or all unpaid salaries from the register"
```

---

### Task 11: Slip actions, payslip payments panel and the Revise note

**Files:**
- Create: `src/components/hr/payroll/salary-payment-actions.tsx`
- Create: `src/components/hr/payroll/salary-payments-panel.tsx`
- Modify: `src/components/hr/payroll/payroll-container.tsx` (actions cell; calculator sheet props)
- Modify: `src/components/hr/payroll/salary-calculator-sheet.tsx`
- Modify: `src/components/hr/payroll/payslip-dialog.tsx`
- Modify: `src/components/hr/payroll/payslip-view.tsx` (props; screen Net Pay rows ~line 665; print Net Pay rows ~line 445)
- Test: `src/__tests__/salary-payments-panel.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 10 hooks, dialog and types; `SlipPaymentHistory` (Task 6).
- Produces: `SalaryPaymentActions({ payrollId, payrollMonth, employeeId, name, payment, wallets, todayKey })`, `SalaryPaymentsPanel({ history })`, `PayslipView` prop `paidFrom?: string`, `SalaryCalculatorSheet` prop `paidNote?: string`.

- [ ] **Step 1: Write the failing panel test**

```tsx
// src/__tests__/salary-payments-panel.behavior.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SalaryPaymentsPanel } from "@/components/hr/payroll/salary-payments-panel";

afterEach(cleanup);

describe("SalaryPaymentsPanel", () => {
  it("lists payments with reversals and the distributor's part", () => {
    render(<SalaryPaymentsPanel history={{
      state: { status: "paid", net: "26200.00", paid: "26200.00", due: "0.00", overpaid: "0.00" },
      paidFrom: "Bank Alfalah",
      distributorPaid: "5000.00",
      payments: [
        { id: "1", kind: "payment", amount: "26200.00", walletName: "Cash in Hand", paymentDate: "2026-11-30", enteredAt: new Date("2026-12-03T05:00:00Z"), recordedBy: "Ali", status: "reversed", reversalReason: "Account changed to Bank Alfalah", reversedAt: new Date("2026-12-03T06:00:00Z"), reversedBy: "Ali" },
        { id: "2", kind: "payment", amount: "26200.00", walletName: "Bank Alfalah", paymentDate: "2026-11-30", enteredAt: new Date("2026-12-03T06:00:00Z"), recordedBy: "Ali", status: "active", reversalReason: null, reversedAt: null, reversedBy: null },
      ],
    }} />);
    expect(screen.getByText("Paid by distributor: Rs 5,000 (already deducted on this slip)")).toBeTruthy();
    expect(screen.getByText("Rs 26,200 from Bank Alfalah · paid 30 Nov 2026 · entered 3 Dec by Ali")).toBeTruthy();
    expect(screen.getByText("Reversed: Account changed to Bank Alfalah")).toBeTruthy();
  });

  it("says when nothing is paid yet", () => {
    render(<SalaryPaymentsPanel history={{ state: { status: "unpaid", net: "26200.00", paid: "0.00", due: "26200.00", overpaid: "0.00" }, paidFrom: null, distributorPaid: "0.00", payments: [] }} />);
    expect(screen.getByText("Not paid yet")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/__tests__/salary-payments-panel.behavior.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the panel**

```tsx
// src/components/hr/payroll/salary-payments-panel.tsx
import Big from "big.js";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/finance/expense-entry";
import type { SlipPaymentHistory } from "@/server-functions/hr/payroll/salary-payments.server";

const KIND_TEXT = { payment: "from", refund: "refunded into", recovery: "taken from next salary" } as const;

export function SalaryPaymentsPanel({ history }: { history: SlipPaymentHistory }) {
  return (
    <section className="mt-4 border border-border p-3 text-sm space-y-2">
      <h3 className="font-semibold">Payments</h3>
      {new Big(history.distributorPaid).gt(0) && (
        <p className="text-muted-foreground">Paid by distributor: {formatRupees(history.distributorPaid)} (already deducted on this slip)</p>
      )}
      {history.payments.length === 0 ? (
        <p className="text-muted-foreground">{history.state.status === "nothing_to_pay" ? "Nothing to pay" : "Not paid yet"}</p>
      ) : (
        <ul className="space-y-1.5">
          {history.payments.map((p) => (
            <li key={p.id} className={cn(p.status === "reversed" && "text-muted-foreground line-through decoration-1")}>
              <span>
                {formatRupees(p.amount)} {KIND_TEXT[p.kind]}{p.walletName ? ` ${p.walletName}` : ""} · paid {format(parseISO(p.paymentDate), "d MMM yyyy")} · entered {format(p.enteredAt, "d MMM")} by {p.recordedBy ?? "—"}
              </span>
              {p.status === "reversed" && <span className="block no-underline text-xs">Reversed: {p.reversalReason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`line-through` on the `li` also strikes the "Reversed:" line; if the test's `getByText` fails because of that, move the strike-through class to the first `span` only.

- [ ] **Step 4: Run the panel test**

Run: `bunx vitest run src/__tests__/salary-payments-panel.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the row actions**

```tsx
// src/components/hr/payroll/salary-payment-actions.tsx
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/finance/expense-entry";
import { SalaryAccountDialog } from "./salary-account-dialog";
import {
  useChangeSalaryAccount,
  useRecordSalaryRefund,
  useRecoverOverpaidSalary,
  useUndoSalaryPayment,
} from "@/hooks/hr/use-salary-payments";
import type { RegisterSlipPayment } from "@/server-functions/hr/payroll/salary-payments.server";

type Props = {
  payrollId: string;
  payrollMonth: string;
  employeeId: string;
  name: string;
  payment: RegisterSlipPayment;
  wallets: { id: string; name: string; balance: string }[];
  todayKey: string;
};

type Open = null | "change" | "undo" | "refund" | "recover";

export function SalaryPaymentActions({ payrollId, payrollMonth, employeeId, name, payment, wallets, todayKey }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [reason, setReason] = useState("");
  const change = useChangeSalaryAccount();
  const undo = useUndoSalaryPayment();
  const refund = useRecordSalaryRefund();
  const recover = useRecoverOverpaidSalary();
  const hasPayments = payment.paidFrom !== null;
  const isOverpaid = payment.status === "overpaid";
  if (!hasPayments && !isOverpaid && payment.paid === "0.00") return null;
  const close = () => { setOpen(null); setReason(""); };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" aria-label={`Payment actions for ${name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-none">
          {hasPayments && <DropdownMenuItem onSelect={() => setOpen("change")}>Change account</DropdownMenuItem>}
          {isOverpaid && <DropdownMenuItem onSelect={() => setOpen("recover")}>Recover from next month</DropdownMenuItem>}
          {isOverpaid && <DropdownMenuItem onSelect={() => setOpen("refund")}>Refund received</DropdownMenuItem>}
          <DropdownMenuItem className="text-destructive" onSelect={() => setOpen("undo")}>Undo payment</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {open === "change" && (
        <SalaryAccountDialog
          open onOpenChange={(o) => !o && close()}
          title={`Change account · ${name}`}
          description="The old account gets the money back and the new one is charged. Both show on the Ledger."
          confirmLabel="Change account"
          lines={[{ employeeId, name, amount: payment.paid }]}
          wallets={wallets.filter((w) => !payment.paidFrom?.split(", ").includes(w.name))}
          direction="out" payrollMonth={payrollMonth} todayKey={todayKey} pending={change.isPending}
          onConfirm={({ walletId, paymentDate }) =>
            change.mutate({ payrollId, employeeIds: [employeeId], walletId, paymentDate }, { onSuccess: close })
          }
        />
      )}

      {open === "refund" && (
        <SalaryAccountDialog
          open onOpenChange={(o) => !o && close()}
          title={`Refund received · ${name}`}
          description="The employee handed back the overpaid amount. It goes into the account you choose."
          confirmLabel={`Record ${formatRupees(payment.overpaid)}`}
          lines={[{ employeeId, name, amount: payment.overpaid }]}
          wallets={wallets} direction="in" payrollMonth={payrollMonth} todayKey={todayKey} pending={refund.isPending}
          onConfirm={({ walletId, paymentDate }) =>
            refund.mutate({ payrollId, employeeId, walletId, paymentDate }, { onSuccess: close })
          }
        />
      )}

      {open === "recover" && (
        <ResponsiveDialog open onOpenChange={(o) => !o && close()} title={`Recover from next month · ${name}`}
          description={`${formatRupees(payment.overpaid)} will be deducted from ${name}'s next payslip. No money moves now.`}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-none" onClick={close}>Cancel</Button>
            <Button className="rounded-none" disabled={recover.isPending}
              onClick={() => recover.mutate({ payrollId, employeeId }, { onSuccess: close })}>
              Recover {formatRupees(payment.overpaid)}
            </Button>
          </div>
        </ResponsiveDialog>
      )}

      {open === "undo" && (
        <ResponsiveDialog open onOpenChange={(o) => !o && close()} title={`Undo payment · ${name}`}
          description="The money goes back into its account and the slip returns to Generated. The Ledger keeps both lines.">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="undo-reason">Reason</Label>
              <Textarea id="undo-reason" className="rounded-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Paid twice by mistake" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-none" onClick={close}>Cancel</Button>
              <Button variant="destructive" className="rounded-none" disabled={undo.isPending || reason.trim().length < 3}
                onClick={() => undo.mutate({ payrollId, employeeId, reason }, { onSuccess: close })}>
                Undo payment
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}
```

- [ ] **Step 6: Use the actions and the Revise note in the register** (`payroll-container.tsx`)

Import `SalaryPaymentActions`. In the actions cell, before the `View Payroll History` button, add:

```tsx
              {canPay && emp.payment && data.payrollId && (
                <SalaryPaymentActions
                  payrollId={data.payrollId}
                  payrollMonth={`${month}-01`}
                  employeeId={emp.id}
                  name={`${emp.firstName} ${emp.lastName}`}
                  payment={emp.payment}
                  wallets={walletList}
                  todayKey={todayKey}
                />
              )}
```

Add `walletList, todayKey, month, data.payrollId` to the `columns` `useMemo` dependencies.

Compute the note and pass it to the sheet:

```ts
  const selectedRow = employees.find((e) => e.id === selectedEmployeeId);
  const paidNote = selectedRow?.payment && selectedRow.payment.paid !== "0.00"
    ? `This slip is already paid (${formatRupees(selectedRow.payment.paid)}${selectedRow.payment.paidFrom ? ` from ${selectedRow.payment.paidFrom}` : ""}). If you change it, the difference shows as balance due or overpaid.`
    : undefined;
```

```tsx
      <SalaryCalculatorSheet ... paidNote={paidNote} />
```

- [ ] **Step 7: Show the note in the calculator sheet** (`salary-calculator-sheet.tsx`)

Add `paidNote?: string;` to the props interface and destructuring, import `Alert, AlertDescription` from `@/components/ui/alert`, and render before the form:

```tsx
      {paidNote && (
        <Alert className="mb-4 rounded-none border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40">
          <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">{paidNote}</AlertDescription>
        </Alert>
      )}
```

- [ ] **Step 8: Paid from on the payslip** (`payslip-view.tsx`, `payslip-dialog.tsx`)

`PayslipViewProps` gains `paidFrom?: string;` and the component destructures it. In the screen table, directly after the Net Pay `<tr>`:

```tsx
                            {paidFrom !== undefined && (
                                <tr>
                                    <td colSpan={4} style={totLbl}>Paid from</td>
                                    <td colSpan={2} style={totNum}>{paidFrom}</td>
                                </tr>
                            )}
```

In the print HTML, directly after the Net Pay `<tr>…</tr>`:

```ts
        ${paidFrom !== undefined ? `<tr><td class="tot-l" colspan="4">Paid from</td><td class="tot-n" colspan="2">${paidFrom}</td></tr>` : ""}
```

In `payslip-dialog.tsx`:

```tsx
import { useSalaryPaymentHistory } from "@/hooks/hr/use-salary-payments";
import { SalaryPaymentsPanel } from "./salary-payments-panel";
```

At the top of the component (before `if (!open) return null;` so hooks run every render):

```ts
  const { data: history } = useSalaryPaymentHistory(open ? payslip?.id : null);
  const paidFrom = history
    ? history.paidFrom ?? (history.state.status === "nothing_to_pay" ? "Nothing to pay" : "Not paid yet")
    : undefined;
```

Render `<PayslipView payslip={payslip} showActions={true} paidFrom={paidFrom} />` and, under it, `{history && <SalaryPaymentsPanel history={history} />}`.

- [ ] **Step 9: Typecheck and unit tests**

Run: `bun run typecheck && bun run test`
Expected: PASS (existing payslip tests don't pass `paidFrom`, so the new row doesn't render for them).

- [ ] **Step 10: Commit**

```bash
git add src/components/hr/payroll src/__tests__/salary-payments-panel.behavior.test.tsx
git commit -m "feat(payroll): change account, undo, refund and recovery on a slip; Paid from on payslips"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full checks**

Run:

```bash
bun run typecheck
bun run test
DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/salary-payments.test.ts src/__tests__/integration/salary-ledger-reports.test.ts src/__tests__/integration/expense-corrections.test.ts
bun run build
```

Expected: all pass. Report any failure with its output; don't skip.

- [ ] **Step 2: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 3: One code review and one browser walkthrough** (user preference: once, at the end)

Run the dev server (`bun run dev`) against the local DB and check, as a user with HR manage + Finance manage:
1. Payroll → November: badges show GENERATED, summary strip shows "Paid 0 of N".
2. Tick two rows → "Pay selected · Rs X" → pick Cash, date 30 Nov → badges show PAID "from Cash"; Finance → Ledger with Source "Payroll" shows two lines dated 30 Nov with descriptions.
3. A short account blocks with the shortfall line.
4. Row menu → Change account → Bank: Ledger shows Cash credit + Bank debit; badge "from Bank".
5. Revise a paid slip and raise overtime: amber note shows; after saving, badge BALANCE DUE; "Pay selected" pays only the difference.
6. Revise to lower: OVERPAID; "Recover from next month" settles it; "Undo payment" asks for a reason and returns the money.
7. Payslip popup shows "Paid from" and the Payments list.
8. Reports → Salaries (Nov) shows Paid from / Paid / Due; Monthly report shows salaries for November; P&L shows them in the month they were paid.

- [ ] **Step 4: Commit any fixes from the walkthrough**

```bash
git add -A src
git commit -m "fix(payroll): walkthrough fixes for salary payments"
```
