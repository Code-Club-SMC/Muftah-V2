# Returns Phase 5 — Salvage Value, Write-offs and Disposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Value damaged and expired returned packs honestly. At inspection they enter returned stock at a salvage value (default 0), and the difference from their original cost is booked as a "Return Write-offs" loss. A new Inventory → Returned Stock page lets staff scrap packs, sell them as seconds for cash, or lower their value, and every one of these actions is logged, shown in P&L and can be voided.

**Architecture:** Pure, client-safe money rules (salvage split, pool share, write-down, seconds sale amount, dated loss events) live in `src/lib/inventory/returned-stock.ts`. Receiving writes a per-trace `writeOffAmount` (original cost minus the value that entered stock); voiding a return reverses the COGS at original cost and the write-off by what actually left stock. Disposals and value changes are rows in a new `returned_stock_movements` log, written by `src/lib/inventory/returned-stock.server.ts` and exposed by `src/server-functions/inventory/returned-stock-fn.ts`. The P&L reads trace write-offs (dated like returns) and movement losses (dated on the movement and reversed on its void date) into two new deduction lines.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, zod, `big.js`, React 19 + TanStack Query, shadcn/ui (Dialog, Table, RadioGroup, Select, Badge), Vitest (unit, behaviour and real-DB integration tests via `vitest.integration.config.ts`).

**Spec:** `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md`, Part A: A2 Screen 3 (salvage field), A3 Fix 2, A3 Fix 5 (void reverses the write-off), A5, B3, delivery phase 5.

## Global Constraints

- At inspection, damaged/expired quantities go into returned stock at their **salvage value** (default 0), not full cost.
- The difference between original cost and salvage value is booked as a **Return write-off** loss in the completion period and appears as its own line in P&L ("Return Write-offs").
- Screen 3: damaged/expired rows show a "Salvage value" field defaulting to 0, with the write-off amount next to it ("Loss booked: Rs 1,800").
- Salvage value is entered **per pack** and can never be more than the pack's original cost.
- Voiding a completed return reverses the write-off, dated on the void date. It never edits the original rows.
- Dispose action on returned stock with exactly two options in this phase: **Scrap** (packs leave stock, their remaining value is booked as a loss) and **Sell as seconds** (a quick cash sale: packs, price per pack and account; the money goes into the account and the difference against their stock value is booked). **Return to supplier is left out until phase 7.**
- **Set value** action on each returned stock row: the user types what one pack is worth now; the value can only go down; the drop is booked as a loss on its own P&L line ("Returned Stock Write-downs"). This replaces the spec's one-time go-live write-down (decided with the user on 2026-11-23): old packs that still carry full cost are marked down with Set value.
- Every scrap, seconds sale and value change is logged with who, when and a note, and can be voided with a reason. A void puts the packs and value back (and takes the sale money back out of the account), dated on the void date.
- Write-offs, scrap and write-downs move no cash; they appear in P&L, not as wallet expenses. A seconds sale credits the chosen account with transaction source `Returned Stock Sale`; its void debits it with source `Returned Stock Sale Reversal`.
- New permission key, exactly: `inventory.returns.dispose` ("Dispose returned stock"). Roles holding `inventory.returns.receive` get it once on first creation (backfill). Admin seed gets it.
- New page: **Inventory → Returned Stock** at `/inventory/returned-stock` (covered by the existing `inventory.view` route rule).
- **Production data exists.** Every new column has a default that is correct for existing rows (`0` write-off, `0` salvage). Existing damaged/expired stock keeps its current value until someone uses Set value.
- Schema changes only through `bun run db:generate`. Never hand-edit anything under `src/db/migrations/`.
- The order booker portal is not in use; do not touch it.
- Out of scope: return to supplier and debit notes (phase 7), seconds stock on invoices, the monthly report page.

## Definitions used in this plan

- **Original cost** of received units = the existing `allocateReturnCost(basis, unitsBefore, units)` result. It stays in the trace's `totalCost` and is what reduces COGS.
- **Stock value** of received units = what enters stock. Good: the original cost. Damaged/expired: `salvage per pack × units`, rounded to paisa.
- **Write-off** of a receive trace = original cost − stock value (stored in `writeOffAmount`, 0 for good packs).
- **Void of a damaged/expired trace:** `totalCost` = −(original receive `totalCost`), `writeOffAmount` = −(original cost − value actually taken out of stock). Sellable void traces are unchanged (`totalCost` = −value taken out, `writeOffAmount` 0).
- **Pool share:** returned stock rows are pooled per warehouse + item + condition. Taking `n` of `N` packs removes `round2(value × n / N)`, or the whole value when `n = N`.
- **Movement loss:** scrap = value removed; seconds sale = value removed − sale amount (negative means a gain); revalue = old value − new value.
- **Loss events:** a receive/void trace write-off is dated like the return (completion / void date). A movement's loss is dated on `movementDate`; a voided movement adds the opposite amount on `voidedAt`. Scrap and seconds feed "Return Write-offs"; revalue feeds "Returned Stock Write-downs".
- **Returned packing** of an item: `unitsPerCarton = containersPerCarton` when the recipe has a carton packaging and `containersPerCarton > 0`, else 1; `usesCartons` is true only in the first case.

## How to run tests

- Unit and behaviour tests: `bun run test -- <path>`
- Integration tests (real PostgreSQL) need a database whose name ends in `_test`. With docker compose running (`docker compose up -d`):
  ```bash
  export TEST_DATABASE_URL=postgres://<user>:<password>@localhost:5433/titan_test
  DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
  DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts <path>
  ```
  Use the user and password from `.env`'s `DATABASE_URL`, with the database name changed to `titan_test`.
- Type check: `bun run typecheck`

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/inventory/returned-stock.ts` (create) | Salvage split, pool share, write-down, seconds sale amount, returned packing, movement labels, loss events |
| `src/lib/inventory/returned-stock.test.ts` (create) | Unit tests for the above |
| `src/lib/sales/returns/return-lifecycle.ts` (modify) | `returnMoneyEvents` also carries `writeOff` |
| `src/lib/sales/returns/return-lifecycle.test.ts` (modify) | Expect `writeOff` on events |
| `src/lib/rbac.ts`, `src/lib/middlewares.ts` (modify) | `inventory.returns.dispose`, backfill, middleware |
| `src/lib/returned-stock-access.test.ts` (create) | Permission tests |
| `src/db/schemas/sales-erp-schema.ts`, `src/db/index.ts` (modify) | Salvage and write-off columns, `returned_stock_movements` table and relations |
| `src/db/migrations/*` (generated) | One migration, only via `bun run db:generate` |
| `src/lib/sales/returns/return-stock.server.ts` (modify) | Restock at stock value, write-off on traces, void reverses at original cost |
| `src/server-functions/sales/sales-returns-fn.ts` (modify) | Salvage per pack on receive, line write-off |
| `src/lib/inventory/returned-stock.server.ts` (create) | Scrap, sell as seconds, set value, void a movement |
| `src/server-functions/inventory/returned-stock-fn.ts` (create) | List returned stock + movements; the four actions |
| `src/server-functions/reports/profit-loss/company-reporting-core.ts` (modify) | Two new P&L lines and a reconciliation add-back |
| `src/server-functions/reports/profit-loss/export-csv-fn.ts`, `src/routes/_protected/reports/profit-loss/index.tsx` (modify) | Show the two lines |
| `src/__tests__/pnl-csv.behavior.test.ts`, `src/__tests__/pnl-route-state.behavior.test.tsx`, `src/__tests__/pnl-print-fixtures.test.tsx` (modify) | Fixtures gain the two summary fields |
| `src/components/sales/return-lifecycle-actions.tsx` (modify) | Salvage per pack inputs and "Loss booked" on Screen 3 |
| `src/__tests__/return-salvage.behavior.test.tsx` (create) | Screen 3 salvage behaviour |
| `src/hooks/inventory/use-returned-stock.ts` (create) | Query and mutations |
| `src/components/inventory/returned-stock/returned-stock-view.tsx` (create) | Stock table, history table, void dialog |
| `src/components/inventory/returned-stock/dispose-returned-stock-dialog.tsx` (create) | Scrap / Sell as seconds |
| `src/components/inventory/returned-stock/set-returned-stock-value-dialog.tsx` (create) | Set value |
| `src/routes/_protected/inventory/returned-stock.tsx` (create) | Page |
| `src/lib/constants.ts` (modify) | "Returned Stock" in the Inventory menu |
| `src/__tests__/returned-stock-page.behavior.test.tsx` (create) | Page behaviour |
| `src/__tests__/integration/two-phase-invoice-mutations.test.ts` (modify) | Salvage, disposal and P&L integration tests |

---

### Task 1: Returned stock money rules (pure)

**Files:**
- Create: `src/lib/inventory/returned-stock.ts`
- Test: `src/lib/inventory/returned-stock.test.ts` (create)
- Modify: `src/lib/sales/returns/return-lifecycle.ts` (`returnMoneyEvents`)
- Modify: `src/lib/sales/returns/return-lifecycle.test.ts` (test "dates a return on completion and its reversal on the void date")

**Interfaces:**
- Consumes: nothing.
- Produces (from `@/lib/inventory/returned-stock`):
  - `type ReturnedCondition = "damaged" | "expired"`, `RETURNED_CONDITIONS`
  - `salvageSplit(input: { label: string; units: number; salvagePerUnit: number | string; cost: string }): { stockValue: string; writeOff: string }`
  - `poolShare(pool: { units: number; value: string }, units: number): string`
  - `writeDownAmount(pool: { units: number; value: string }, valuePerPack: number | string): { newValue: string; writeDown: string }`
  - `secondsSaleAmount(units: number, unitPrice: number | string): string`
  - `returnedPacking(recipe: { cartonPackagingId: string | null; containersPerCarton: number | null }): { unitsPerCarton: number; usesCartons: boolean }`
  - `RETURNED_STOCK_MOVEMENT_KINDS`, `type ReturnedStockMovementKind = "scrap" | "seconds_sale" | "revalue"`, `RETURNED_STOCK_MOVEMENT_LABELS`
  - `type ReturnedStockMoneyEvent = { line: "write_off" | "write_down"; date: Date; amount: number }`, `returnedStockMoneyEvents(row: { kind: string; lossAmount: string | number; movementDate: Date; voidedAt: Date | null }): ReturnedStockMoneyEvent[]`
  - `RETURNED_STOCK_SALE_SOURCE = "Returned Stock Sale"`, `RETURNED_STOCK_SALE_REVERSAL_SOURCE = "Returned Stock Sale Reversal"`
- Produces (changed, from `@/lib/sales/returns/return-lifecycle`): `ReturnMoneyEvent` gains `writeOff: number`; `returnMoneyEvents` traces accept an optional `writeOffAmount`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/inventory/returned-stock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  poolShare,
  RETURNED_STOCK_MOVEMENT_LABELS,
  returnedPacking,
  returnedStockMoneyEvents,
  salvageSplit,
  secondsSaleAmount,
  writeDownAmount,
} from "./returned-stock";

describe("returned stock money rules", () => {
  it("splits received damaged packs into stock value and write-off", () => {
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 5, cost: "30.00" }))
      .toEqual({ stockValue: "15.00", writeOff: "15.00" });
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 0, cost: "30.00" }))
      .toEqual({ stockValue: "0.00", writeOff: "30.00" });
    expect(salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 10, cost: "30.00" }))
      .toEqual({ stockValue: "30.00", writeOff: "0.00" });
    expect(() => salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: 11, cost: "30.00" }))
      .toThrow("Mango 1L: salvage value Rs 33.00 is more than what these 3 packs cost (Rs 30.00).");
    expect(() => salvageSplit({ label: "Mango 1L", units: 3, salvagePerUnit: -1, cost: "30.00" }))
      .toThrow("Mango 1L: salvage value can't be below zero.");
  });

  it("takes value out of a pool the same way its average is kept", () => {
    expect(poolShare({ units: 3, value: "10.00" }, 1)).toBe("3.33");
    expect(poolShare({ units: 3, value: "10.00" }, 3)).toBe("10.00");
    expect(poolShare({ units: 4, value: "0.00" }, 2)).toBe("0.00");
    expect(() => poolShare({ units: 1, value: "2.00" }, 5)).toThrow("Only 1 pack is in this stock.");
    expect(() => poolShare({ units: 4, value: "2.00" }, 5)).toThrow("Only 4 packs are in this stock.");
    expect(() => poolShare({ units: 4, value: "2.00" }, 0)).toThrow("Pick at least 1 pack.");
  });

  it("only lets value go down and returns the loss", () => {
    expect(writeDownAmount({ units: 4, value: "20.00" }, 2)).toEqual({ newValue: "8.00", writeDown: "12.00" });
    expect(writeDownAmount({ units: 4, value: "20.00" }, 0)).toEqual({ newValue: "0.00", writeDown: "20.00" });
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, 6))
      .toThrow("The new value (Rs 24.00) is above the current value (Rs 20.00). Value can only be lowered.");
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, 5)).toThrow("The value is unchanged.");
    expect(() => writeDownAmount({ units: 0, value: "0.00" }, 0)).toThrow("There are no packs left to value.");
    expect(() => writeDownAmount({ units: 4, value: "20.00" }, -1)).toThrow("Value per pack can't be below zero.");
  });

  it("prices a seconds sale and reads packing from the item", () => {
    expect(secondsSaleAmount(3, "12.50")).toBe("37.50");
    expect(returnedPacking({ cartonPackagingId: "c1", containersPerCarton: 12 })).toEqual({ unitsPerCarton: 12, usesCartons: true });
    expect(returnedPacking({ cartonPackagingId: null, containersPerCarton: 12 })).toEqual({ unitsPerCarton: 1, usesCartons: false });
    expect(returnedPacking({ cartonPackagingId: "c1", containersPerCarton: 0 })).toEqual({ unitsPerCarton: 1, usesCartons: false });
    expect(RETURNED_STOCK_MOVEMENT_LABELS).toEqual({ scrap: "Scrapped", seconds_sale: "Sold as seconds", revalue: "Value lowered" });
  });

  it("dates movement losses and reverses voided ones on the void date", () => {
    const movementDate = new Date("2026-12-03T10:00:00Z");
    const voidedAt = new Date("2027-01-04T10:00:00Z");
    expect(returnedStockMoneyEvents({ kind: "scrap", lossAmount: "12.00", movementDate, voidedAt: null }))
      .toEqual([{ line: "write_off", date: movementDate, amount: 12 }]);
    expect(returnedStockMoneyEvents({ kind: "seconds_sale", lossAmount: "-10.00", movementDate, voidedAt }))
      .toEqual([
        { line: "write_off", date: movementDate, amount: -10 },
        { line: "write_off", date: voidedAt, amount: 10 },
      ]);
    expect(returnedStockMoneyEvents({ kind: "revalue", lossAmount: "4.00", movementDate, voidedAt: null }))
      .toEqual([{ line: "write_down", date: movementDate, amount: 4 }]);
  });
});
```

In `src/lib/sales/returns/return-lifecycle.test.ts`, replace the whole test `it("dates a return on completion and its reversal on the void date", () => { ... });` with:

```ts
  it("dates a return on completion and its reversal on the void date", () => {
    const completedAt = new Date("2026-10-05T10:00:00Z");
    const voidedAt = new Date("2026-11-02T09:00:00Z");
    const traces = [
      { kind: "receive", totalCost: "30.00", writeOffAmount: "20.00" },
      { kind: "void", totalCost: "-30.00", writeOffAmount: "-18.00" },
    ];
    expect(returnMoneyEvents({ status: "approved", totalAmount: "100.00", completedAt: null, voidedAt: null, stockTraces: [] })).toEqual([]);
    expect(returnMoneyEvents({ status: "completed", totalAmount: "100.00", completedAt, voidedAt: null, stockTraces: traces.slice(0, 1) }))
      .toEqual([{ kind: "return", date: completedAt, amount: 100, cost: 30, writeOff: 20 }]);
    expect(returnMoneyEvents({ status: "voided", totalAmount: "100.00", completedAt, voidedAt, stockTraces: traces })).toEqual([
      { kind: "return", date: completedAt, amount: 100, cost: 30, writeOff: 20 },
      { kind: "void", date: voidedAt, amount: 100, cost: 30, writeOff: 18 },
    ]);
    // Traces written before phase 5 have no write-off.
    expect(returnMoneyEvents({ status: "completed", totalAmount: "50.00", completedAt, voidedAt: null, stockTraces: [{ kind: "receive", totalCost: "10.00" }] }))
      .toEqual([{ kind: "return", date: completedAt, amount: 50, cost: 10, writeOff: 0 }]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/lib/inventory/returned-stock.test.ts src/lib/sales/returns/return-lifecycle.test.ts`
Expected: FAIL. `./returned-stock` cannot be resolved, and the lifecycle test fails because events have no `writeOff`.

- [ ] **Step 3: Write the rules**

Create `src/lib/inventory/returned-stock.ts`:

```ts
import Big from "big.js";

// Client-safe money rules for damaged and expired returned stock. No database access here.

export const RETURNED_CONDITIONS = ["damaged", "expired"] as const;
export type ReturnedCondition = (typeof RETURNED_CONDITIONS)[number];

export const RETURNED_STOCK_SALE_SOURCE = "Returned Stock Sale";
export const RETURNED_STOCK_SALE_REVERSAL_SOURCE = "Returned Stock Sale Reversal";

/** Value that received damaged/expired packs enter stock at, and the loss booked for them. */
export function salvageSplit(input: {
  label: string;
  units: number;
  salvagePerUnit: number | string;
  cost: string;
}): { stockValue: string; writeOff: string } {
  const salvage = new Big(input.salvagePerUnit || 0);
  if (salvage.lt(0)) throw new Error(`${input.label}: salvage value can't be below zero.`);
  const stockValue = salvage.times(input.units).round(2);
  const cost = new Big(input.cost);
  if (stockValue.gt(cost)) {
    throw new Error(
      `${input.label}: salvage value Rs ${stockValue.toFixed(2)} is more than what these ${input.units} packs cost (Rs ${cost.toFixed(2)}).`,
    );
  }
  return { stockValue: stockValue.toFixed(2), writeOff: cost.minus(stockValue).toFixed(2) };
}

/** Value that leaves a pooled stock row when `units` packs are taken out. */
export function poolShare(pool: { units: number; value: string }, units: number): string {
  if (!Number.isInteger(units) || units <= 0) throw new Error("Pick at least 1 pack.");
  if (units > pool.units) {
    throw new Error(`Only ${pool.units} ${pool.units === 1 ? "pack is" : "packs are"} in this stock.`);
  }
  const value = new Big(pool.value);
  return units === pool.units ? value.toFixed(2) : value.times(units).div(pool.units).round(2).toFixed(2);
}

/** New value and loss when a stock row is marked down to `valuePerPack`. Raising it is refused. */
export function writeDownAmount(
  pool: { units: number; value: string },
  valuePerPack: number | string,
): { newValue: string; writeDown: string } {
  if (pool.units <= 0) throw new Error("There are no packs left to value.");
  const perPack = new Big(valuePerPack || 0);
  if (perPack.lt(0)) throw new Error("Value per pack can't be below zero.");
  const current = new Big(pool.value);
  const newValue = perPack.times(pool.units).round(2);
  if (newValue.gt(current)) {
    throw new Error(
      `The new value (Rs ${newValue.toFixed(2)}) is above the current value (Rs ${current.toFixed(2)}). Value can only be lowered.`,
    );
  }
  if (newValue.eq(current)) throw new Error("The value is unchanged.");
  return { newValue: newValue.toFixed(2), writeDown: current.minus(newValue).toFixed(2) };
}

export function secondsSaleAmount(units: number, unitPrice: number | string): string {
  return new Big(unitPrice).times(units).round(2).toFixed(2);
}

export function returnedPacking(recipe: {
  cartonPackagingId: string | null;
  containersPerCarton: number | null;
}): { unitsPerCarton: number; usesCartons: boolean } {
  const perCarton = recipe.containersPerCarton ?? 0;
  return recipe.cartonPackagingId && perCarton > 0
    ? { unitsPerCarton: perCarton, usesCartons: true }
    : { unitsPerCarton: 1, usesCartons: false };
}

export const RETURNED_STOCK_MOVEMENT_KINDS = ["scrap", "seconds_sale", "revalue"] as const;
export type ReturnedStockMovementKind = (typeof RETURNED_STOCK_MOVEMENT_KINDS)[number];

export const RETURNED_STOCK_MOVEMENT_LABELS: Record<ReturnedStockMovementKind, string> = {
  scrap: "Scrapped",
  seconds_sale: "Sold as seconds",
  revalue: "Value lowered",
};

export type ReturnedStockMoneyEvent = { line: "write_off" | "write_down"; date: Date; amount: number };

/** Scrap and seconds feed "Return Write-offs"; value changes feed "Returned Stock Write-downs". */
export function returnedStockMoneyEvents(row: {
  kind: string;
  lossAmount: string | number;
  movementDate: Date;
  voidedAt: Date | null;
}): ReturnedStockMoneyEvent[] {
  const line = row.kind === "revalue" ? "write_down" : "write_off";
  const amount = Number(row.lossAmount);
  const events: ReturnedStockMoneyEvent[] = [{ line, date: row.movementDate, amount }];
  if (row.voidedAt) events.push({ line, date: row.voidedAt, amount: -amount });
  return events;
}
```

In `src/lib/sales/returns/return-lifecycle.ts`, replace the whole `ReturnMoneyEvent` type and `returnMoneyEvents` function (from `export type ReturnMoneyEvent` to the closing `}` of `returnMoneyEvents`) with:

```ts
export type ReturnMoneyEvent = { kind: "return" | "void"; date: Date; amount: number; cost: number; writeOff: number };

export function returnMoneyEvents(row: {
  status: string;
  totalAmount: string | number;
  completedAt: Date | null;
  voidedAt: Date | null;
  stockTraces: Array<{ kind: string; totalCost: string | number; writeOffAmount?: string | number | null }>;
}): ReturnMoneyEvent[] {
  if (!row.completedAt || (row.status !== "completed" && row.status !== "voided")) return [];
  const amount = Number(row.totalAmount);
  const sumOf = (kind: string, field: "totalCost" | "writeOffAmount") =>
    row.stockTraces
      .filter((trace) => trace.kind === kind)
      .reduce((sum, trace) => sum + Number(trace[field] ?? 0), 0);
  const events: ReturnMoneyEvent[] = [
    { kind: "return", date: row.completedAt, amount, cost: sumOf("receive", "totalCost"), writeOff: sumOf("receive", "writeOffAmount") },
  ];
  if (row.status === "voided" && row.voidedAt) {
    // Void traces are stored negative; the reversal carries the amounts taken back out.
    events.push({
      kind: "void",
      date: row.voidedAt,
      amount,
      cost: -sumOf("void", "totalCost"),
      writeOff: -sumOf("void", "writeOffAmount"),
    });
  }
  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- src/lib/inventory/returned-stock.test.ts src/lib/sales/returns/return-lifecycle.test.ts src/lib/sales-workflows.test.ts src/lib/pnl-reporting.test.ts`
Expected: PASS. (`-0` and `0` compare equal under `toEqual`, so voids with no write-off still match.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/returned-stock.ts src/lib/inventory/returned-stock.test.ts src/lib/sales/returns/return-lifecycle.ts src/lib/sales/returns/return-lifecycle.test.ts
git commit -m "feat(inventory): add salvage, disposal and write-down money rules for returned stock"
```

---

### Task 2: Permission to dispose returned stock

**Files:**
- Modify: `src/lib/rbac.ts` (`PERMISSION_KEYS`, `PERMISSION_DEFINITIONS`, `PERMISSION_BACKFILLS`, admin seed)
- Modify: `src/lib/middlewares.ts` (after `requireReturnsReceiveMiddleware`)
- Test: `src/lib/returned-stock-access.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: permission key `"inventory.returns.dispose"`; middleware `requireReturnsDisposeMiddleware` from `@/lib/middlewares`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/returned-stock-access.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_BACKFILLS, PERMISSION_DEFINITIONS, PERMISSION_KEYS, SYSTEM_ROLE_SEEDS } from "@/lib/rbac";

describe("returned stock disposal permission", () => {
  it("defines dispose as an inventory action", () => {
    expect(PERMISSION_KEYS).toContain("inventory.returns.dispose");
    const definition = PERMISSION_DEFINITIONS.find((permission) => permission.key === "inventory.returns.dispose");
    expect(definition).toMatchObject({ moduleKey: "inventory", kind: "action", label: "Dispose returned stock" });
  });

  it("gives it to admin and once to everyone who can receive returns", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin")!;
    expect(admin.permissionKeys).toContain("inventory.returns.dispose");
    expect(PERMISSION_BACKFILLS["inventory.returns.dispose"]).toBe("inventory.returns.receive");
  });

  it("exposes a middleware for it", () => {
    const middlewares = readFileSync(resolve(process.cwd(), "src/lib/middlewares.ts"), "utf8");
    expect(middlewares).toContain('requireReturnsDisposeMiddleware = createPermissionMiddleware(\n  "inventory.returns.dispose",');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/returned-stock-access.test.ts`
Expected: FAIL. `inventory.returns.dispose` is missing.

- [ ] **Step 3: Add the permission**

In `src/lib/rbac.ts`:

1. In `PERMISSION_KEYS`, directly after `"inventory.returns.receive",` (the first occurrence, in the keys array), add `"inventory.returns.dispose",`.
2. In `PERMISSION_DEFINITIONS`, directly after the `inventory.returns.receive` entry (the one ending `description: "Count and inspect returned goods and complete the return.",\n    kind: "action",\n  },`), add:

```ts
  {
    key: "inventory.returns.dispose",
    moduleKey: "inventory",
    label: "Dispose returned stock",
    description: "Scrap damaged or expired returned packs, sell them as seconds, lower their value and void these entries.",
    kind: "action",
  },
```

3. In `PERMISSION_BACKFILLS`, directly after `"finance.refunds.issue": ["finance.manage", "inventory.returns.receive"],` add:

```ts
  "inventory.returns.dispose": "inventory.returns.receive",
```

4. In the `admin` role seed's `permissionKeys`, directly after `"inventory.returns.receive",` add `"inventory.returns.dispose",`.

In `src/lib/middlewares.ts`, directly after:

```ts
export const requireReturnsReceiveMiddleware = createPermissionMiddleware(
  "inventory.returns.receive",
);
```

add:

```ts
export const requireReturnsDisposeMiddleware = createPermissionMiddleware(
  "inventory.returns.dispose",
);
```

- [ ] **Step 4: Run tests and type check**

Run: `bun run test -- src/lib/returned-stock-access.test.ts src/lib/sales-returns-access.test.ts src/lib/credit-notes-access.test.ts src/lib/rbac.test.ts && bun run typecheck`
Expected: PASS, no type errors. If an existing RBAC test pins an exact permission list, add `"inventory.returns.dispose"` to that list.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rbac.ts src/lib/middlewares.ts src/lib/returned-stock-access.test.ts
git commit -m "feat(rbac): add the right to dispose returned stock"
```

---

### Task 3: Schema — salvage and write-off columns, disposal log

**Files:**
- Modify: `src/db/schemas/sales-erp-schema.ts` (`salesReturnItems`, `salesReturnStockTraces`, new table after `salesReturnStockTraces`, relations)
- Modify: `src/db/index.ts` (export the new table)
- Generated: one migration under `src/db/migrations/` (only via `bun run db:generate`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `salesReturnItems`: `damagedSalvagePerUnit`, `expiredSalvagePerUnit`, `writeOffAmount` (decimal(12,2), not null, default `"0"`).
  - `salesReturnStockTraces`: `writeOffAmount` (decimal(12,2), not null, default `"0"`).
  - Table `returnedStockMovements` (`returned_stock_movements`): `id`, `kind`, `warehouseId`, `recipeId`, `condition`, `units`, `unitsBefore`, `valueBefore`, `valueRemoved`, `unitPrice`, `saleAmount`, `lossAmount`, `walletId`, `transactionId`, `note`, `movementDate`, `performedById`, `voidedAt`, `voidedById`, `voidReason`, `voidTransactionId`, timestamps. Relations: `warehouse`, `recipe`, `wallet`, `performedBy`, `voidedBy`.
  - `returnedStockMovements` exported from `@/db`.

- [ ] **Step 1: Add the columns**

In `src/db/schemas/sales-erp-schema.ts`, in `salesReturnItems`, directly after `expiredUnits: integer("expired_units").notNull().default(0),` add:

```ts
  damagedSalvagePerUnit: decimal("damaged_salvage_per_unit", { precision: 12, scale: 2 }).notNull().default("0"),
  expiredSalvagePerUnit: decimal("expired_salvage_per_unit", { precision: 12, scale: 2 }).notNull().default("0"),
  writeOffAmount: decimal("write_off_amount", { precision: 12, scale: 2 }).notNull().default("0"),
```

In `salesReturnStockTraces`, directly after `totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0"),` add:

```ts
  // Original cost minus the value that entered (or, negative, left) stock. 0 for sellable packs.
  writeOffAmount: decimal("write_off_amount", { precision: 12, scale: 2 }).notNull().default("0"),
```

- [ ] **Step 2: Add the disposal log table and relations**

Directly after the closing `}));` of `salesReturnStockTraces` (the table, not its relations), add:

```ts
// Scrap, seconds sales and value changes on damaged/expired returned stock. Voids keep the row.
export const returnedStockMovements = pgTable("returned_stock_movements", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  kind: text("kind").notNull(), // scrap | seconds_sale | revalue
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  recipeId: text("recipe_id")
    .notNull()
    .references(() => recipes.id),
  condition: text("condition").notNull(), // damaged | expired
  units: integer("units").notNull().default(0),
  unitsBefore: integer("units_before").notNull(),
  valueBefore: decimal("value_before", { precision: 14, scale: 2 }).notNull(),
  valueRemoved: decimal("value_removed", { precision: 14, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }),
  saleAmount: decimal("sale_amount", { precision: 14, scale: 2 }),
  lossAmount: decimal("loss_amount", { precision: 14, scale: 2 }).notNull(),
  walletId: text("wallet_id").references(() => wallets.id),
  transactionId: text("transaction_id").references(() => transactions.id),
  note: text("note"),
  movementDate: timestamp("movement_date").notNull().defaultNow(),
  performedById: text("performed_by_id")
    .notNull()
    .references(() => user.id),
  voidedAt: timestamp("voided_at"),
  voidedById: text("voided_by_id").references(() => user.id),
  voidReason: text("void_reason"),
  voidTransactionId: text("void_transaction_id").references(() => transactions.id),
  ...timestamps,
}, (table) => ({
  dateIdx: index("idx_returned_stock_movements_date").on(table.movementDate),
  stockIdx: index("idx_returned_stock_movements_stock").on(table.warehouseId, table.recipeId, table.condition),
  kindCheck: check("returned_stock_movements_kind", sql`${table.kind} in ('scrap', 'seconds_sale', 'revalue')`),
}));
```

Directly after the closing `}));` of `salesReturnStockTracesRelations`, add:

```ts
export const returnedStockMovementsRelations = relations(returnedStockMovements, ({ one }) => ({
  warehouse: one(warehouses, {
    fields: [returnedStockMovements.warehouseId],
    references: [warehouses.id],
  }),
  recipe: one(recipes, {
    fields: [returnedStockMovements.recipeId],
    references: [recipes.id],
  }),
  wallet: one(wallets, {
    fields: [returnedStockMovements.walletId],
    references: [wallets.id],
  }),
  performedBy: one(user, {
    fields: [returnedStockMovements.performedById],
    references: [user.id],
  }),
  voidedBy: one(user, {
    fields: [returnedStockMovements.voidedById],
    references: [user.id],
  }),
}));
```

In `src/db/index.ts`, in the `salesErpSchema` destructuring, directly after `  salesReturnStockTraces,` add `  returnedStockMovements,`.

- [ ] **Step 3: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file that adds `damaged_salvage_per_unit`, `expired_salvage_per_unit`, `write_off_amount` to `sales_return_items` and `write_off_amount` to `sales_return_stock_traces` (all `DEFAULT '0' NOT NULL`), creates `returned_stock_movements` with its check constraint, two indexes and foreign keys to `warehouses`, `recipes`, `wallets`, `transactions` (two) and `user` (two). Nothing is dropped or renamed. If the generator asks whether a column is a rename, answer "create column". Do not edit the generated files.

- [ ] **Step 4: Apply to the local and test databases**

Run: `bun run db:migrate` and `DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test`
Expected: both apply without errors. Existing return lines and traces read `0.00` in the new columns.

- [ ] **Step 5: Type check**

Run: `bun run typecheck`
Expected: no errors (all new columns have defaults, so existing inserts still compile).

- [ ] **Step 6: Commit**

```bash
git add src/db/schemas/sales-erp-schema.ts src/db/index.ts src/db/migrations
git commit -m "feat(db): store salvage and write-offs on returns and add the returned stock movement log"
```

---

### Task 4: Receive at salvage value and reverse the write-off on void

**Files:**
- Modify: `src/lib/sales/returns/return-stock.server.ts` (`restockReturnedUnits`, `takeFromReturnedStock`, `reverseReturnStock`, `PLACE` message)
- Modify: `src/server-functions/sales/sales-returns-fn.ts` (`completeSalesReturnFn`)
- Test: `src/__tests__/integration/two-phase-invoice-mutations.test.ts` (add one test in `describe("sales return lifecycle")`)

**Interfaces:**
- Consumes: `salvageSplit`, `poolShare` (Task 1); new columns (Task 3).
- Produces:
  - `restockReturnedUnits(tx, input)` input gains `stockValue: string` and `writeOffAmount: string` (`inventoryValue` stays the original cost written to `totalCost`).
  - `completeSalesReturnFn` line input gains `damagedSalvagePerUnit?: number` and `expiredSalvagePerUnit?: number` (Rs per pack, ≥ 0, at most 2 decimals, default 0).

- [ ] **Step 1: Write the failing integration test**

In `src/__tests__/integration/two-phase-invoice-mutations.test.ts`, inside `describe("sales return lifecycle", () => {`, directly after the closing `});` of the test `it("voids a damaged return and lets the same packs be returned again", ...)`, add:

```ts
    it("puts damaged packs in at salvage value, books the write-off and reverses it on void", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4); // 4 packs at Rs 10
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 3)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const salesReturn = await requestReturn(f, invoice.id, item.id, [3]);
        await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        const lines = (damagedSalvagePerUnit: number) => [
          { returnItemId: salesReturn.items[0].id, goodUnits: 1, damagedUnits: 2, damagedSalvagePerUnit },
        ];

        await expect(invoke(completeSalesReturnFn, { returnId: salesReturn.id, lines: lines(11) }, f.actor.id))
          .rejects.toThrow("salvage value Rs 22.00 is more than what these 2 packs cost (Rs 20.00)");
        await invoke(completeSalesReturnFn, { returnId: salesReturn.id, lines: lines(3) }, f.actor.id);

        const damagedStock = async () => (await tx.select().from(returnedFinishedGoodsStock).where(and(
          eq(returnedFinishedGoodsStock.recipeId, f.recipe.id), eq(returnedFinishedGoodsStock.condition, "damaged"))))[0];
        const afterReceipt = await damagedStock();
        expect([afterReceipt.quantityCartons * 4 + afterReceipt.quantityContainers, afterReceipt.totalInventoryValue]).toEqual([2, "6.00"]);
        const [returnLine] = await tx.select().from(salesReturnItems).where(eq(salesReturnItems.salesReturnId, salesReturn.id));
        expect([returnLine.damagedSalvagePerUnit, returnLine.expiredSalvagePerUnit, returnLine.writeOffAmount]).toEqual(["3.00", "0.00", "14.00"]);
        const traces = () => tx.select().from(salesReturnStockTraces).where(eq(salesReturnStockTraces.salesReturnId, salesReturn.id));
        expect((await traces()).map(t => [t.kind, t.destination, t.totalCost, t.writeOffAmount]).sort()).toEqual([
          ["receive", "damaged", "20.00", "14.00"],
          ["receive", "sellable", "10.00", "0.00"],
        ]);
        await assertStock(tx, f, 2);

        await invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Entered against the wrong invoice" }, f.actor.id);
        const afterVoid = await damagedStock();
        expect([afterVoid.quantityCartons * 4 + afterVoid.quantityContainers, afterVoid.totalInventoryValue]).toEqual([0, "0.00"]);
        expect((await traces()).filter(t => t.kind === "void").map(t => [t.destination, t.totalCost, t.writeOffAmount]).sort()).toEqual([
          ["damaged", "-20.00", "-14.00"],
          ["sellable", "-10.00", "0.00"],
        ]);
      });
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts -t "salvage value"`
Expected: FAIL. The salvage field is ignored, so the first call does not throw.

- [ ] **Step 3: Restock at stock value and record the write-off**

In `src/lib/sales/returns/return-stock.server.ts`:

1. Add to the imports:

```ts
import { poolShare } from "@/lib/inventory/returned-stock";
```

2. In `restockReturnedUnits`'s input type, directly after `inventoryValue: string;` add:

```ts
    /** Value that enters stock: the original cost for good packs, salvage for damaged/expired. */
    stockValue: string;
    /** inventoryValue minus stockValue. */
    writeOffAmount: string;
```

3. In the `else` branch (damaged/expired), in the `calculateInboundStockState({ ... })` call, replace `inboundInventoryValue: input.inventoryValue,` with `inboundInventoryValue: input.stockValue,`. Leave the good branch as it is.

4. In the trace insert at the end of `restockReturnedUnits`, directly after `totalCost: input.inventoryValue,` add `writeOffAmount: input.writeOffAmount,`.

5. In `takeFromReturnedStock`, replace:

```ts
  const removed = nextUnits === 0 ? oldValue : new Big(oldValue.times(input.units).div(oldUnits).toFixed(2));
```

with:

```ts
  const removed = new Big(poolShare({ units: oldUnits, value: oldValue.toFixed(2) }, input.units));
```

6. In `reverseReturnStock`, replace the whole `for (const trace of traces) { ... }` loop (the one that pushes into `voidTraces`) with:

```ts
    const sellable = first.destination === "sellable";
    // Big keeps the sign of zero, so write zero explicitly instead of "-0.00".
    const negate = (value: Big) => (value.eq(0) ? "0.00" : value.times(-1).toFixed(2));
    for (const trace of traces) {
      const share =
        unitsLeft === trace.totalUnitsMoved
          ? valueLeft
          : removedValue.times(trace.totalUnitsMoved).div(units).round(2);
      valueLeft = valueLeft.minus(share);
      unitsLeft -= trace.totalUnitsMoved;
      // Damaged/expired: COGS goes back at the original cost; the write-off is reversed by
      // what actually left stock, so a later value change is not double counted.
      const originalCost = new Big(trace.totalCost);
      voidTraces.push({
        id: createId(),
        salesReturnId: trace.salesReturnId,
        salesReturnItemId: trace.salesReturnItemId,
        invoiceId: trace.invoiceId,
        invoiceItemId: trace.invoiceItemId,
        warehouseId: trace.warehouseId,
        recipeId: trace.recipeId,
        destination: trace.destination,
        condition: trace.condition,
        kind: "void",
        cartonsMoved: -trace.cartonsMoved,
        quantityMoved: -trace.quantityMoved,
        totalUnitsMoved: -trace.totalUnitsMoved,
        costPerUnit: sellable
          ? trace.totalUnitsMoved > 0 ? share.div(trace.totalUnitsMoved).toFixed(4) : "0.0000"
          : trace.costPerUnit,
        totalCost: sellable ? negate(share) : negate(originalCost),
        writeOffAmount: sellable ? "0.00" : negate(originalCost.minus(share)),
      });
    }
```

7. In the shortage message, replace `Some were sold or used since.` with `Some were sold, scrapped or sold as seconds since.`

- [ ] **Step 4: Take salvage per pack on receive**

In `src/server-functions/sales/sales-returns-fn.ts`:

1. Add to the imports:

```ts
import { salvageSplit } from "@/lib/inventory/returned-stock";
```

2. Directly above `export const completeSalesReturnFn = createServerFn()`, add:

```ts
const salvagePerUnitSchema = z
  .number()
  .min(0, "Salvage value can't be below zero.")
  .max(1_000_000)
  .refine((value) => new Big(value).round(2).eq(value), "Salvage value can have at most 2 decimals (paisa).")
  .default(0);
```

3. In `completeSalesReturnFn`'s line object, directly after `expiredUnits: z.number().int().min(0).default(0),` add:

```ts
              damagedSalvagePerUnit: salvagePerUnitSchema,
              expiredSalvagePerUnit: salvagePerUnitSchema,
```

4. In the `inspection` map's returned object, directly after `expiredUnits: line?.expiredUnits ?? 0,` add:

```ts
          damagedSalvagePerUnit: line?.damagedSalvagePerUnit ?? 0,
          expiredSalvagePerUnit: line?.expiredSalvagePerUnit ?? 0,
```

5. Replace this block:

```ts
        const basis = returnCostBasis(invoiceItem, unitsPerCarton);
        let unitsBefore = alreadyReceived;
        for (const condition of ["good", "damaged", "expired"] as const) {
          const units = line[`${condition}Units`];
          if (units <= 0) continue;
          await restockReturnedUnits(tx, {
            salesReturnId: salesReturn.id,
            returnItemId: returnItem.id,
            invoiceId: salesReturn.invoiceId,
            invoiceItem,
            warehouseId,
            condition,
            units,
            unitsPerCarton,
            costPerUnit: basis.costPerUnit,
            inventoryValue: allocateReturnCost(basis, unitsBefore, units),
            userId,
          });
          unitsBefore += units;
        }
```

with:

```ts
        const basis = returnCostBasis(invoiceItem, unitsPerCarton);
        let unitsBefore = alreadyReceived;
        let lineWriteOff = new Big(0);
        for (const condition of ["good", "damaged", "expired"] as const) {
          const units = line[`${condition}Units`];
          if (units <= 0) continue;
          const cost = allocateReturnCost(basis, unitsBefore, units);
          const { stockValue, writeOff } =
            condition === "good"
              ? { stockValue: cost, writeOff: "0.00" }
              : salvageSplit({
                  label: `${line.label} (${condition})`,
                  units,
                  salvagePerUnit: line[`${condition}SalvagePerUnit`],
                  cost,
                });
          await restockReturnedUnits(tx, {
            salesReturnId: salesReturn.id,
            returnItemId: returnItem.id,
            invoiceId: salesReturn.invoiceId,
            invoiceItem,
            warehouseId,
            condition,
            units,
            unitsPerCarton,
            costPerUnit: basis.costPerUnit,
            inventoryValue: cost,
            stockValue,
            writeOffAmount: writeOff,
            userId,
          });
          lineWriteOff = lineWriteOff.plus(writeOff);
          unitsBefore += units;
        }
        totalWriteOff = totalWriteOff.plus(lineWriteOff);
```

6. Directly above `for (const line of inspection) {` (the loop that contains the block above), add:

```ts
      let totalWriteOff = new Big(0);
```

7. In the `tx.update(salesReturnItems).set({ ... })` inside that loop, directly after `expiredUnits: line.expiredUnits,` add:

```ts
            damagedSalvagePerUnit: new Big(line.damagedUnits > 0 ? line.damagedSalvagePerUnit : 0).toFixed(2),
            expiredSalvagePerUnit: new Big(line.expiredUnits > 0 ? line.expiredSalvagePerUnit : 0).toFixed(2),
            writeOffAmount: lineWriteOff.toFixed(2),
```

8. In the completion timeline event, replace the `description:` line with:

```ts
          description: `Return #${salesReturn.returnNumber} received: ${received} of ${requested} packs arrived${requested > received ? ` (${requested - received} short, closed)` : ""}. PKR ${moneyString(split.appliedToInvoiceAmount)} cleared invoice balance${split.customerCreditAmount > 0 ? `; PKR ${moneyString(split.customerCreditAmount)} transferred to store credit` : ""}.${totalWriteOff.gt(0) ? ` Loss booked on damaged/expired packs: PKR ${totalWriteOff.toFixed(2)}.` : ""}`,
```

and in its `metadata`, directly after `requestedUnits: requested,` add `writeOffAmount: totalWriteOff.toFixed(2),`.

- [ ] **Step 5: Run the integration tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts`
Expected: PASS, including the new test and the existing "voids a damaged return and lets the same packs be returned again" (salvage defaults to 0, so damaged stock is still valued `0.00`).

- [ ] **Step 6: Run unit tests and type check**

Run: `bun run test -- src/lib/sales-workflows.test.ts src/lib/pnl-reporting.test.ts && bun run typecheck`
Expected: PASS. If a source-inspection test pins the old `inventoryValue: allocateReturnCost(basis, unitsBefore, units),` line, update that expectation to `inventoryValue: cost,`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sales/returns/return-stock.server.ts src/server-functions/sales/sales-returns-fn.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts
git commit -m "feat(sales): receive damaged and expired packs at salvage value and book the write-off"
```

---

### Task 5: Scrap, sell as seconds, set value and void — server

**Files:**
- Create: `src/lib/inventory/returned-stock.server.ts`
- Create: `src/server-functions/inventory/returned-stock-fn.ts`
- Test: `src/__tests__/integration/two-phase-invoice-mutations.test.ts` (new `describe("returned stock")`)

**Interfaces:**
- Consumes: Task 1 rules; `returnedStockMovements` (Task 3); `requireReturnsDisposeMiddleware` (Task 2); `requireInventoryViewMiddleware`; `lockFinishedGoods` from `@/lib/production/finished-goods-lock.server`.
- Produces (from `@/server-functions/inventory/returned-stock-fn`):
  - `getReturnedStockFn()` → `{ rows: Array<{ warehouseId; warehouseName; recipeId; recipeName; condition: "damaged" | "expired"; units: number; unitsPerCarton: number; value: string }>; movements: Array<{ id; kind; recipeName; warehouseName; condition; units; valueRemoved; unitPrice: string | null; saleAmount: string | null; lossAmount; walletName: string | null; note: string | null; movementDate: Date; performedByName: string | null; voidedAt: Date | null; voidReason: string | null }> }`
  - `scrapReturnedStockFn({ data: { warehouseId, recipeId, condition, units, note? } })`
  - `sellReturnedStockFn({ data: { warehouseId, recipeId, condition, units, unitPrice, walletId, note? } })`
  - `setReturnedStockValueFn({ data: { warehouseId, recipeId, condition, valuePerPack, note } })`
  - `voidReturnedStockMovementFn({ data: { movementId, reason } })`
  - Each action returns the movement row.

- [ ] **Step 1: Write the failing integration test**

In `src/__tests__/integration/two-phase-invoice-mutations.test.ts`:

1. Add to the imports:

```ts
import { getReturnedStockFn, scrapReturnedStockFn, sellReturnedStockFn, setReturnedStockValueFn, voidReturnedStockMovementFn } from "@/server-functions/inventory/returned-stock-fn";
```

and add `returnedStockMovements` to the existing `@/db/schemas/sales-erp-schema` import.

2. In the `vi.mock("@/lib/middlewares", ...)` line, replace `requireReturnsReceiveMiddleware: {},` with `requireReturnsReceiveMiddleware: {}, requireReturnsDisposeMiddleware: {},`.

3. Directly before the final `});` of the file (the one closing the outermost `describe`), add:

```ts
  describe("returned stock", () => {
    // 4 damaged packs worth Rs 5 each (salvage), from an invoice of 4 packs costing Rs 10.
    async function damagedReturn(tx: Tx, f: Fixture) {
      await receive(tx, f, 4);
      const invoice = await invoke(createInvoiceFn, request(f, [line(f, 4)]), f.actor.id);
      const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      const salesReturn = await requestReturn(f, invoice.id, item.id, [4]);
      await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
      await invoke(completeSalesReturnFn, {
        returnId: salesReturn.id,
        lines: [{ returnItemId: salesReturn.items[0].id, damagedUnits: 4, damagedSalvagePerUnit: 5 }],
      }, f.actor.id);
      return salesReturn;
    }
    const key = (f: Fixture) => ({ warehouseId: f.warehouse.id, recipeId: f.recipe.id, condition: "damaged" as const });
    async function damagedRow(tx: Tx, f: Fixture) {
      const [row] = await tx.select().from(returnedFinishedGoodsStock).where(and(
        eq(returnedFinishedGoodsStock.recipeId, f.recipe.id), eq(returnedFinishedGoodsStock.condition, "damaged")));
      return [row.quantityCartons * 4 + row.quantityContainers, row.totalInventoryValue];
    }

    it("lowers value, scraps, sells as seconds and voids, keeping stock, money and the log in step", async () => {
      await withFixture(async (tx, f) => {
        const salesReturn = await damagedReturn(tx, f);
        expect(await damagedRow(tx, f)).toEqual([4, "20.00"]);
        const listed = await readAccounting(tx, () => invoke(getReturnedStockFn, {}, f.actor.id));
        expect(listed.rows.find((row: { recipeId: string }) => row.recipeId === f.recipe.id))
          .toMatchObject({ condition: "damaged", units: 4, value: "20.00", unitsPerCarton: 4 });

        await expect(invoke(setReturnedStockValueFn, { ...key(f), valuePerPack: 6, note: "Checked again" }, f.actor.id))
          .rejects.toThrow("Value can only be lowered");
        const revalue = await invoke(setReturnedStockValueFn, { ...key(f), valuePerPack: 2, note: "Boxes torn" }, f.actor.id);
        expect([revalue.kind, revalue.units, revalue.valueRemoved, revalue.lossAmount]).toEqual(["revalue", 0, "12.00", "12.00"]);
        expect(await damagedRow(tx, f)).toEqual([4, "8.00"]);

        const scrap = await invoke(scrapReturnedStockFn, { ...key(f), units: 1, note: "Leaking" }, f.actor.id);
        expect([scrap.kind, scrap.units, scrap.valueRemoved, scrap.lossAmount]).toEqual(["scrap", 1, "2.00", "2.00"]);
        expect(await damagedRow(tx, f)).toEqual([3, "6.00"]);

        const [wallet] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: "cash" }).returning();
        await expect(invoke(sellReturnedStockFn, { ...key(f), units: 5, unitPrice: 7, walletId: wallet.id }, f.actor.id))
          .rejects.toThrow("Only 3 packs are in this stock.");
        const sale = await invoke(sellReturnedStockFn, { ...key(f), units: 2, unitPrice: 7, walletId: wallet.id }, f.actor.id);
        expect([sale.kind, sale.units, sale.valueRemoved, sale.saleAmount, sale.lossAmount]).toEqual(["seconds_sale", 2, "4.00", "14.00", "-10.00"]);
        expect(await damagedRow(tx, f)).toEqual([1, "2.00"]);
        expect((await tx.query.wallets.findFirst({ where: eq(wallets.id, wallet.id) }))!.balance).toBe("14.00");
        const [credit] = await tx.select().from(transactions).where(eq(transactions.id, sale.transactionId));
        expect([credit.type, credit.amount, credit.source]).toEqual(["credit", "14.00", "Returned Stock Sale"]);

        await invoke(voidReturnedStockMovementFn, { movementId: sale.id, reason: "Buyer returned them" }, f.actor.id);
        expect(await damagedRow(tx, f)).toEqual([3, "6.00"]);
        expect((await tx.query.wallets.findFirst({ where: eq(wallets.id, wallet.id) }))!.balance).toBe("0.00");
        await expect(invoke(voidReturnedStockMovementFn, { movementId: sale.id, reason: "Again please" }, f.actor.id))
          .rejects.toThrow("This entry is already voided.");
        const [voidedSale] = await tx.select().from(returnedStockMovements).where(eq(returnedStockMovements.id, sale.id));
        expect(voidedSale.voidedAt).not.toBeNull();
        expect(voidedSale.voidReason).toBe("Buyer returned them");

        // The return can't be voided while one scrapped pack is gone.
        await expect(invoke(voidSalesReturnFn, { returnId: salesReturn.id, reason: "Wrong invoice" }, f.actor.id))
          .rejects.toThrow("but only 3 are left");
      });
    });

    it("refuses a seconds sale with a bad price and refuses without a note on value change", async () => {
      await withFixture(async (tx, f) => {
        await damagedReturn(tx, f);
        const [wallet] = await tx.insert(wallets).values({ id: randomUUID(), name: randomUUID(), type: "cash" }).returning();
        await expect(invoke(sellReturnedStockFn, { ...key(f), units: 1, unitPrice: 0, walletId: wallet.id }, f.actor.id))
          .rejects.toThrow("Price must be above zero");
        await expect(invoke(sellReturnedStockFn, { ...key(f), units: 1, unitPrice: 1.005, walletId: wallet.id }, f.actor.id))
          .rejects.toThrow("at most 2 decimals");
        await expect(invoke(setReturnedStockValueFn, { ...key(f), valuePerPack: 1, note: "" }, f.actor.id))
          .rejects.toThrow("Say why the value changed");
        expect(await damagedRow(tx, f)).toEqual([4, "20.00"]);
      });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts -t "returned stock"`
Expected: FAIL. `@/server-functions/inventory/returned-stock-fn` cannot be resolved.

- [ ] **Step 3: Write the server core**

Create `src/lib/inventory/returned-stock.server.ts`:

```ts
import Big from "big.js";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, gte, sql } from "drizzle-orm";
import type { db } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import { recipes, returnedFinishedGoodsStock } from "@/db/schemas/inventory-schema";
import { returnedStockMovements } from "@/db/schemas/sales-erp-schema";
import { formatRupees } from "@/lib/finance/expense-entry";
import { lockFinishedGoods } from "@/lib/production/finished-goods-lock.server";
import {
  poolShare,
  RETURNED_STOCK_SALE_REVERSAL_SOURCE,
  RETURNED_STOCK_SALE_SOURCE,
  returnedPacking,
  secondsSaleAmount,
  writeDownAmount,
  type ReturnedCondition,
} from "./returned-stock";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReturnedStockKey = { warehouseId: string; recipeId: string; condition: ReturnedCondition };
type Movement = typeof returnedStockMovements.$inferSelect;

/** Locks one returned stock row the same way receiving and voiding a return do. */
async function lockReturnedRow(tx: Tx, key: ReturnedStockKey) {
  await lockFinishedGoods(tx, key.warehouseId, [key.recipeId]);
  const [row] = await tx
    .select()
    .from(returnedFinishedGoodsStock)
    .where(
      and(
        eq(returnedFinishedGoodsStock.warehouseId, key.warehouseId),
        eq(returnedFinishedGoodsStock.recipeId, key.recipeId),
        eq(returnedFinishedGoodsStock.condition, key.condition),
      ),
    )
    .for("update");
  if (!row) throw new Error("This returned stock was not found.");
  const recipe = await tx.query.recipes.findFirst({
    where: eq(recipes.id, key.recipeId),
    columns: { name: true, cartonPackagingId: true, containersPerCarton: true },
  });
  if (!recipe) throw new Error("Item not found");
  const packing = returnedPacking(recipe);
  return {
    row,
    recipe,
    ...packing,
    units: row.quantityCartons * packing.unitsPerCarton + row.quantityContainers,
    value: new Big(row.totalInventoryValue ?? 0).toFixed(2),
  };
}
type LockedRow = Awaited<ReturnType<typeof lockReturnedRow>>;

async function writeReturnedRow(tx: Tx, locked: LockedRow, nextUnits: number, nextValue: Big) {
  const wac = nextUnits > 0 ? nextValue.div(nextUnits) : new Big(0);
  await tx
    .update(returnedFinishedGoodsStock)
    .set({
      quantityCartons: locked.usesCartons ? Math.floor(nextUnits / locked.unitsPerCarton) : 0,
      quantityContainers: locked.usesCartons ? nextUnits % locked.unitsPerCarton : nextUnits,
      weightedAverageCostPerPack: wac.toFixed(4),
      weightedAverageCostPerCarton: locked.usesCartons ? wac.times(locked.unitsPerCarton).toFixed(4) : "0.0000",
      totalInventoryValue: nextValue.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(returnedFinishedGoodsStock.id, locked.row.id));
}

/**
 * Adds or removes money on one account and writes its ledger row. A debit is refused when the
 * account holds less than the amount; the balance check and update are one row-locking statement.
 */
async function moveWalletMoney(
  tx: Tx,
  input: { walletId: string; type: "credit" | "debit"; amount: string; source: string; referenceId: string; performedById: string; description: string },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance: input.type === "credit" ? sql`${wallets.balance} + ${input.amount}` : sql`${wallets.balance} - ${input.amount}`,
    })
    .where(
      input.type === "debit"
        ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
        : eq(wallets.id, input.walletId),
    )
    .returning({ id: wallets.id });
  if (!wallet) {
    const existing = await tx.query.wallets.findFirst({ where: eq(wallets.id, input.walletId), columns: { name: true, balance: true } });
    if (!existing) throw new Error("Account not found");
    throw new Error(`${existing.name} has only ${formatRupees(existing.balance)}. Voiding would take it below zero.`);
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
    performedById: input.performedById,
  });
  return id;
}

async function insertMovement(tx: Tx, values: typeof returnedStockMovements.$inferInsert): Promise<Movement> {
  const [movement] = await tx.insert(returnedStockMovements).values(values).returning();
  return movement;
}

export async function scrapReturnedStock(
  tx: Tx,
  input: ReturnedStockKey & { units: number; note?: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const removed = poolShare({ units: locked.units, value: locked.value }, input.units);
  await writeReturnedRow(tx, locked, locked.units - input.units, new Big(locked.value).minus(removed));
  return insertMovement(tx, {
    kind: "scrap",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: input.units,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: removed,
    lossAmount: removed,
    note: input.note || null,
    performedById: input.userId,
  });
}

export async function sellReturnedStock(
  tx: Tx,
  input: ReturnedStockKey & { units: number; unitPrice: number; walletId: string; note?: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const removed = poolShare({ units: locked.units, value: locked.value }, input.units);
  const saleAmount = secondsSaleAmount(input.units, input.unitPrice);
  await writeReturnedRow(tx, locked, locked.units - input.units, new Big(locked.value).minus(removed));
  const id = createId();
  const transactionId = await moveWalletMoney(tx, {
    walletId: input.walletId,
    type: "credit",
    amount: saleAmount,
    source: RETURNED_STOCK_SALE_SOURCE,
    referenceId: id,
    performedById: input.userId,
    description: `Sold ${input.units} ${input.condition} ${locked.recipe.name} as seconds`,
  });
  return insertMovement(tx, {
    id,
    kind: "seconds_sale",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: input.units,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: removed,
    unitPrice: new Big(input.unitPrice).toFixed(2),
    saleAmount,
    lossAmount: new Big(removed).minus(saleAmount).toFixed(2),
    walletId: input.walletId,
    transactionId,
    note: input.note || null,
    performedById: input.userId,
  });
}

export async function setReturnedStockValue(
  tx: Tx,
  input: ReturnedStockKey & { valuePerPack: number; note: string; userId: string },
): Promise<Movement> {
  const locked = await lockReturnedRow(tx, input);
  const { newValue, writeDown } = writeDownAmount({ units: locked.units, value: locked.value }, input.valuePerPack);
  await writeReturnedRow(tx, locked, locked.units, new Big(newValue));
  return insertMovement(tx, {
    kind: "revalue",
    warehouseId: input.warehouseId,
    recipeId: input.recipeId,
    condition: input.condition,
    units: 0,
    unitsBefore: locked.units,
    valueBefore: locked.value,
    valueRemoved: writeDown,
    unitPrice: new Big(input.valuePerPack).toFixed(2),
    lossAmount: writeDown,
    note: input.note,
    performedById: input.userId,
  });
}

/** Puts the packs and value back (and the sale money back out), dated today. The row is kept. */
export async function voidReturnedStockMovement(
  tx: Tx,
  input: { movementId: string; reason: string; userId: string },
): Promise<Movement> {
  const [movement] = await tx
    .select()
    .from(returnedStockMovements)
    .where(eq(returnedStockMovements.id, input.movementId))
    .for("update");
  if (!movement) throw new Error("Entry not found");
  if (movement.voidedAt) throw new Error("This entry is already voided.");
  const locked = await lockReturnedRow(tx, {
    warehouseId: movement.warehouseId,
    recipeId: movement.recipeId,
    condition: movement.condition as ReturnedCondition,
  });
  if (movement.kind === "revalue" && locked.units === 0) {
    throw new Error("These packs are gone, so the old value can't be put back.");
  }
  await writeReturnedRow(
    tx,
    locked,
    locked.units + movement.units,
    new Big(locked.value).plus(movement.valueRemoved),
  );
  let voidTransactionId: string | null = null;
  if (movement.kind === "seconds_sale" && movement.walletId && movement.saleAmount) {
    voidTransactionId = await moveWalletMoney(tx, {
      walletId: movement.walletId,
      type: "debit",
      amount: movement.saleAmount,
      source: RETURNED_STOCK_SALE_REVERSAL_SOURCE,
      referenceId: movement.id,
      performedById: input.userId,
      description: `Void of seconds sale: ${locked.recipe.name}`,
    });
  }
  const [voided] = await tx
    .update(returnedStockMovements)
    .set({ voidedAt: new Date(), voidedById: input.userId, voidReason: input.reason, voidTransactionId, updatedAt: new Date() })
    .where(eq(returnedStockMovements.id, movement.id))
    .returning();
  return voided;
}
```

- [ ] **Step 4: Write the server functions**

Create `src/server-functions/inventory/returned-stock-fn.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schemas/auth-schema";
import { wallets } from "@/db/schemas/finance-schema";
import { recipes, returnedFinishedGoodsStock, warehouses } from "@/db/schemas/inventory-schema";
import { returnedStockMovements } from "@/db/schemas/sales-erp-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { RETURNED_STOCK_MOVEMENT_LABELS, returnedPacking, type ReturnedCondition } from "@/lib/inventory/returned-stock";
import {
  scrapReturnedStock,
  sellReturnedStock,
  setReturnedStockValue,
  voidReturnedStockMovement,
} from "@/lib/inventory/returned-stock.server";
import { requireInventoryViewMiddleware, requireReturnsDisposeMiddleware } from "@/lib/middlewares";

const stockKey = {
  warehouseId: z.string().min(1),
  recipeId: z.string().min(1),
  condition: z.enum(["damaged", "expired"]),
};
const packs = z.number().int("Packs must be a whole number").positive("Pick at least 1 pack.").max(999_999);
const rupees = (label: string) =>
  z
    .number()
    .finite()
    .max(1_000_000)
    .refine((value) => new Big(value).round(2).eq(value), `${label} can have at most 2 decimals (paisa)`);
const note = z.string().trim().max(500).optional();

type Actor = { session: { user: { id: string } }; authContext: { session: { user: { id: string; name: string } } } };
function logMovement(context: Actor, action: "created" | "deleted", entityId: string, description: string) {
  logActivityQuiet({
    module: "inventory",
    action,
    entityType: "returned_stock_movement",
    entityId,
    actorId: context.authContext.session.user.id,
    actorName: context.authContext.session.user.name,
    description,
  });
}

export const getReturnedStockFn = createServerFn()
  .middleware([requireInventoryViewMiddleware])
  .inputValidator(z.object({}).optional())
  .handler(async () => {
    const { db } = await import("@/db");
    const stock = await db
      .select({
        warehouseId: returnedFinishedGoodsStock.warehouseId,
        warehouseName: warehouses.name,
        recipeId: returnedFinishedGoodsStock.recipeId,
        recipeName: recipes.name,
        condition: returnedFinishedGoodsStock.condition,
        quantityCartons: returnedFinishedGoodsStock.quantityCartons,
        quantityContainers: returnedFinishedGoodsStock.quantityContainers,
        totalInventoryValue: returnedFinishedGoodsStock.totalInventoryValue,
        cartonPackagingId: recipes.cartonPackagingId,
        containersPerCarton: recipes.containersPerCarton,
      })
      .from(returnedFinishedGoodsStock)
      .innerJoin(warehouses, eq(returnedFinishedGoodsStock.warehouseId, warehouses.id))
      .innerJoin(recipes, eq(returnedFinishedGoodsStock.recipeId, recipes.id))
      .orderBy(asc(recipes.name), asc(warehouses.name), asc(returnedFinishedGoodsStock.condition));
    const rows = stock
      .map((row) => {
        const { unitsPerCarton } = returnedPacking(row);
        return {
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          recipeId: row.recipeId,
          recipeName: row.recipeName,
          condition: row.condition as ReturnedCondition,
          units: row.quantityCartons * unitsPerCarton + row.quantityContainers,
          unitsPerCarton,
          value: new Big(row.totalInventoryValue ?? 0).toFixed(2),
        };
      })
      .filter((row) => row.units > 0 || Number(row.value) !== 0);

    const voider = alias(user, "returned_stock_voider");
    const movements = await db
      .select({
        id: returnedStockMovements.id,
        kind: returnedStockMovements.kind,
        recipeName: recipes.name,
        warehouseName: warehouses.name,
        condition: returnedStockMovements.condition,
        units: returnedStockMovements.units,
        valueRemoved: returnedStockMovements.valueRemoved,
        unitPrice: returnedStockMovements.unitPrice,
        saleAmount: returnedStockMovements.saleAmount,
        lossAmount: returnedStockMovements.lossAmount,
        walletName: wallets.name,
        note: returnedStockMovements.note,
        movementDate: returnedStockMovements.movementDate,
        performedByName: user.name,
        voidedAt: returnedStockMovements.voidedAt,
        voidedByName: voider.name,
        voidReason: returnedStockMovements.voidReason,
      })
      .from(returnedStockMovements)
      .innerJoin(recipes, eq(returnedStockMovements.recipeId, recipes.id))
      .innerJoin(warehouses, eq(returnedStockMovements.warehouseId, warehouses.id))
      .leftJoin(wallets, eq(returnedStockMovements.walletId, wallets.id))
      .leftJoin(user, eq(returnedStockMovements.performedById, user.id))
      .leftJoin(voider, eq(returnedStockMovements.voidedById, voider.id))
      .orderBy(desc(returnedStockMovements.movementDate), desc(returnedStockMovements.createdAt))
      .limit(100);
    return { rows, movements };
  });

export const scrapReturnedStockFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(z.object({ ...stockKey, units: packs, note }))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => scrapReturnedStock(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Scrapped ${data.units} ${data.condition} packs (loss Rs ${movement.lossAmount})`);
    return movement;
  });

export const sellReturnedStockFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      ...stockKey,
      units: packs,
      unitPrice: rupees("Price").pipe(z.number().positive("Price must be above zero")),
      walletId: z.string().min(1, "Please pick the account"),
      note,
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => sellReturnedStock(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Sold ${data.units} ${data.condition} packs as seconds for Rs ${movement.saleAmount}`);
    return movement;
  });

export const setReturnedStockValueFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      ...stockKey,
      valuePerPack: rupees("Value per pack").pipe(z.number().min(0, "Value per pack can't be below zero.")),
      note: z.string().trim().min(3, "Say why the value changed (at least 3 characters).").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => setReturnedStockValue(tx, { ...data, userId: context.session.user.id }));
    logMovement(context, "created", movement.id, `Lowered ${data.condition} stock value by Rs ${movement.lossAmount}: ${data.note}`);
    return movement;
  });

export const voidReturnedStockMovementFn = createServerFn()
  .middleware([requireReturnsDisposeMiddleware])
  .inputValidator(
    z.object({
      movementId: z.string().min(1),
      reason: z.string().trim().min(3, "Give a reason for voiding (at least 3 characters).").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db");
    const movement = await db.transaction((tx) => voidReturnedStockMovement(tx, { ...data, userId: context.session.user.id }));
    const label = RETURNED_STOCK_MOVEMENT_LABELS[movement.kind as keyof typeof RETURNED_STOCK_MOVEMENT_LABELS] ?? movement.kind;
    logMovement(context, "deleted", movement.id, `Voided "${label}" entry: ${data.reason}`);
    return movement;
  });
```

Note: with `.pipe(...)`, a price of `0` fails the `positive` check with "Price must be above zero", and `1.005` fails the decimals check, which the test expects.

- [ ] **Step 5: Run the integration tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts`
Expected: PASS.

- [ ] **Step 6: Type check**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/inventory/returned-stock.server.ts src/server-functions/inventory/returned-stock-fn.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts
git commit -m "feat(inventory): scrap, sell as seconds, lower value and void on returned stock"
```

---

### Task 6: P&L lines for return write-offs and stock write-downs

**Files:**
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts`
- Modify: `src/server-functions/reports/profit-loss/export-csv-fn.ts` (summary rows ~line 94)
- Modify: `src/routes/_protected/reports/profit-loss/index.tsx` (summary type ~line 296, deduction cards ~line 561)
- Modify: `src/__tests__/pnl-csv.behavior.test.ts`, `src/__tests__/pnl-route-state.behavior.test.tsx`, `src/__tests__/pnl-print-fixtures.test.tsx` (fixtures)
- Test: `src/__tests__/integration/two-phase-invoice-mutations.test.ts` (add one test in `describe("returned stock")`)
- Test: `src/lib/pnl-reporting.test.ts` (one source check)

**Interfaces:**
- Consumes: `returnMoneyEvents` with `writeOff` (Task 1), `returnedStockMoneyEvents` (Task 1), `returnedStockMovements` (Task 3).
- Produces: `CompanySummary` gains `returnWriteOffs: number` and `returnedStockWriteDowns: number` (both inside `totalOperatingExpenses`); deduction rows of type `"return_write_offs"` and `"returned_stock_write_downs"`; reconciliation bridge row of type `"returned_stock_losses"`; `CompanyReportData.deductions` gains the same two fields.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/integration/two-phase-invoice-mutations.test.ts`, add `returnedStockMovements` to the imports if Task 5 did not already, then inside `describe("returned stock", () => {`, directly after the closing `});` of the test `it("refuses a seconds sale with a bad price ...")`, add:

```ts
    it("shows return write-offs and write-downs as their own P&L lines", async () => {
      await withFixture(async (tx, f) => {
        await receive(tx, f, 4);
        const invoice = await invoke(createInvoiceFn, request(f, [line(f, 2)]), f.actor.id);
        const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        const salesReturn = await requestReturn(f, invoice.id, item.id, [2]);
        await invoke(decideSalesReturnFn, { returnId: salesReturn.id, action: "approve" }, f.actor.id);
        await invoke(completeSalesReturnFn, {
          returnId: salesReturn.id,
          lines: [{ returnItemId: salesReturn.items[0].id, damagedUnits: 2, damagedSalvagePerUnit: 3 }],
        }, f.actor.id); // cost 20, stock 6, write-off 14
        await tx.update(salesReturns).set({ completedAt: new Date("2026-05-05T12:00:00Z") }).where(eq(salesReturns.id, salesReturn.id));
        const revalue = await invoke(setReturnedStockValueFn, { ...key(f), valuePerPack: 1, note: "Labels faded" }, f.actor.id); // 6 -> 2, write-down 4
        const scrap = await invoke(scrapReturnedStockFn, { ...key(f), units: 1 }, f.actor.id); // loss 1
        await tx.update(returnedStockMovements).set({ movementDate: new Date("2026-05-10T12:00:00Z") })
          .where(inArray(returnedStockMovements.id, [revalue.id, scrap.id]));

        const may = createReportDateRange({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
        const snapshot = (source: "all" | "online") =>
          readAccounting(tx, async () => buildSnapshot(await loadContext(may.fromDate, may.toDate, source), may));
        const all = await snapshot("all");
        expect([all.summary.returnWriteOffs, all.summary.returnedStockWriteDowns]).toEqual([15, 4]);
        expect(all.deductionBreakdown.filter(row => row.type.startsWith("return")).map(row => [row.type, row.amount])).toEqual([
          ["return_write_offs", 15],
          ["returned_stock_write_downs", 4],
        ]);
        const online = await snapshot("online");
        expect([online.summary.returnWriteOffs, online.summary.returnedStockWriteDowns]).toEqual([14, 0]);

        await invoke(voidReturnedStockMovementFn, { movementId: scrap.id, reason: "Pack was fine" }, f.actor.id);
        await tx.update(returnedStockMovements).set({ voidedAt: new Date("2026-06-02T12:00:00Z") }).where(eq(returnedStockMovements.id, scrap.id));
        const june = createReportDateRange({ dateFrom: "2026-06-01", dateTo: "2026-06-30" });
        const juneSnapshot = await readAccounting(tx, async () => buildSnapshot(await loadContext(june.fromDate, june.toDate, "all"), june));
        expect(juneSnapshot.summary.returnWriteOffs).toBe(-1);
      });
    });
```

Also add `inArray` to the existing `drizzle-orm` import of that file if it is not there (it already imports `and, eq, inArray, ne, sql`).

In `src/lib/pnl-reporting.test.ts`, add a new test at the end of the outermost `describe` block:

```ts
	it("adds back non-cash returned stock losses in the reconciliation bridge", () => {
		const src = readFileSync(resolve(process.cwd(), "src/server-functions/reports/profit-loss/company-reporting-core.ts"), "utf8");
		expect(src).toContain('type: "returned_stock_losses"');
		expect(src).toContain('type: "return_write_offs"');
		expect(src).toContain('type: "returned_stock_write_downs"');
	});
```

(If the file does not import `readFileSync` and `resolve` yet, add `import { readFileSync } from "node:fs";` and `import { resolve } from "node:path";` at the top.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/lib/pnl-reporting.test.ts` and `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts -t "own P&L lines"`
Expected: FAIL. `returnWriteOffs` is undefined and the source strings are missing.

- [ ] **Step 3: Load write-offs and movements**

In `src/server-functions/reports/profit-loss/company-reporting-core.ts`:

1. Add `returnedStockMovements` to the `@/db/schemas/sales-erp-schema` import, and add:

```ts
import { returnedStockMoneyEvents } from "@/lib/inventory/returned-stock";
```

2. In `interface ReturnItemRecord`, directly after `totalCost: number;` add `totalWriteOff: number;`.

3. Directly after the closing `}` of `interface ReturnItemRecord`, add:

```ts
interface ReturnedStockMovementRecord {
  kind: string;
  lossAmount: number;
  movementDate: Date;
  voidedAt: Date | null;
}
```

4. In `interface CompanySummary`, directly after `generalExpenses: number;` add:

```ts
  returnWriteOffs: number;
  returnedStockWriteDowns: number;
```

5. In `CompanyReportData.deductions`, directly after `generalExpenses: number;` add the same two lines.

6. In `interface LoadedContext`, directly after `failedProductionLosses: FailedProductionLossRecord[];` add `returnedStockMovements: ReturnedStockMovementRecord[];`.

7. In the returns flattening inside `loadContext`, directly after `totalCost: direction * event.cost,` add `totalWriteOff: direction * event.writeOff,`.

8. In `loadContext`, directly above the `return {` that starts with `lines: lines.map((row) => ({`, add:

```ts
  // Disposals and value changes are not tied to an invoice, so only the all-sources report shows them.
  const returnedStockMovementRows: ReturnedStockMovementRecord[] =
    source === "all"
      ? (
          await db
            .select({
              kind: returnedStockMovements.kind,
              lossAmount: returnedStockMovements.lossAmount,
              movementDate: returnedStockMovements.movementDate,
              voidedAt: returnedStockMovements.voidedAt,
            })
            .from(returnedStockMovements)
            .where(
              or(
                and(gte(returnedStockMovements.movementDate, fromDate), lte(returnedStockMovements.movementDate, toDate)),
                and(gte(returnedStockMovements.voidedAt, fromDate), lte(returnedStockMovements.voidedAt, toDate)),
              ),
            )
        ).map((row) => ({ ...row, lossAmount: toNumber(row.lossAmount) }))
      : [];
```

9. In that `return { ... }`, directly after `failedProductionLosses: source === "all" ? failedProductionLossRows : [],` add `returnedStockMovements: returnedStockMovementRows,`.

- [ ] **Step 4: Add the lines to the snapshot**

Still in `company-reporting-core.ts`, in `buildSnapshot`:

1. Directly after `const generalExpense = financeGeneralExpense + failedProductionLossExpense;` add:

```ts
  const returnedStockEvents = context.returnedStockMovements
    .flatMap((movement) => returnedStockMoneyEvents(movement))
    .filter((event) => isWithinRange(event.date, range));
  const sumEvents = (line: "write_off" | "write_down") =>
    returnedStockEvents.filter((event) => event.line === line).reduce((sum, event) => sum + event.amount, 0);
  const returnWriteOffs =
    context.returns
      .filter((item) => isWithinRange(item.effectiveDate, range))
      .reduce((sum, item) => sum + item.totalWriteOff, 0) + sumEvents("write_off");
  const returnedStockWriteDowns = sumEvents("write_down");
```

2. Replace:

```ts
  const totalOperatingExpenses =
    invoiceExpenses +
    payrollExpense +
    commissionExpense +
    tadaExpense +
    generalExpense;
```

with:

```ts
  const totalOperatingExpenses =
    invoiceExpenses +
    payrollExpense +
    commissionExpense +
    tadaExpense +
    generalExpense +
    returnWriteOffs +
    returnedStockWriteDowns;
```

3. In the `summary` object, directly after `generalExpenses: roundCurrency(generalExpense),` add:

```ts
    returnWriteOffs: roundCurrency(returnWriteOffs),
    returnedStockWriteDowns: roundCurrency(returnedStockWriteDowns),
```

4. In `deductionBreakdown`, directly after the `general_expenses` row (ending `impact: -summary.generalExpenses,\n    },`), add:

```ts
    {
      type: "return_write_offs",
      label: "Return Write-offs",
      description:
        "Damaged and expired returned packs booked below their original cost, plus scrap and seconds sales. No cash moved except the seconds sale money.",
      amount: summary.returnWriteOffs,
      impact: -summary.returnWriteOffs,
    },
    {
      type: "returned_stock_write_downs",
      label: "Returned Stock Write-downs",
      description: "Value lowered on damaged and expired returned packs still in stock.",
      amount: summary.returnedStockWriteDowns,
      impact: -summary.returnedStockWriteDowns,
    },
```

5. In `getCompanyReportData`'s `deductions` object, directly after `generalExpenses: current.summary.generalExpenses,` add:

```ts
      returnWriteOffs: current.summary.returnWriteOffs,
      returnedStockWriteDowns: current.summary.returnedStockWriteDowns,
```

6. In `buildFinanceReconciliation`, directly after the `failed_batch_losses` bridge row (ending `"Failed-batch chemical write-offs reduce profit when settled but do not move wallet cash.",\n    },`), add:

```ts
    {
      type: "returned_stock_losses",
      label: "Add Back Non-cash Returned Stock Losses",
      amount: Math.abs(roundCurrency(summary.returnWriteOffs + summary.returnedStockWriteDowns)),
      direction: summary.returnWriteOffs + summary.returnedStockWriteDowns >= 0 ? "positive" : "negative",
      description:
        "Return write-offs, scrap and value write-downs reduce profit but move no cash. Seconds sale money is counted with other wallet movements.",
    },
```

7. Search the file for every other object literal that builds a `CompanySummary` (for example empty trend points with `invoiceCount: 0,` near lines 1100 and 1126). If one lists `generalExpenses`, add `returnWriteOffs: 0, returnedStockWriteDowns: 0,` next to it. `bun run typecheck` reports any you miss.

- [ ] **Step 5: Show the lines in CSV and on the page**

In `src/server-functions/reports/profit-loss/export-csv-fn.ts`, directly after `["General Expenses", formatReportMoney(report.summary.generalExpenses)],` add:

```ts
        ["Return Write-offs", formatReportMoney(report.summary.returnWriteOffs)],
        ["Returned Stock Write-downs", formatReportMoney(report.summary.returnedStockWriteDowns)],
```

In `src/routes/_protected/reports/profit-loss/index.tsx`:

1. In the local `summary: { ... }` type, directly after `generalExpenses: number;` add:

```ts
    returnWriteOffs: number;
    returnedStockWriteDowns: number;
```

2. In the deduction cards list, directly after the "General Expenses" card (ending `icon: User,\n              accent: "violet",\n            },`), add:

```tsx
            {
              label: "Return Write-offs",
              value: data.summary.returnWriteOffs,
              icon: Receipt,
              accent: "orange",
            },
            {
              label: "Stock Write-downs",
              value: data.summary.returnedStockWriteDowns,
              icon: Receipt,
              accent: "cyan",
            },
```

In each of `src/__tests__/pnl-csv.behavior.test.ts`, `src/__tests__/pnl-route-state.behavior.test.tsx` and `src/__tests__/pnl-print-fixtures.test.tsx`, directly after the fixture line `generalExpenses: 0,` add `returnWriteOffs: 0,` and `returnedStockWriteDowns: 0,` on their own lines.

- [ ] **Step 6: Run the tests**

Run: `bun run test -- src/lib/pnl-reporting.test.ts src/__tests__/pnl-csv.behavior.test.ts src/__tests__/pnl-route-state.behavior.test.tsx src/__tests__/pnl-print-fixtures.test.tsx` and `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts src/__tests__/integration/two-phase-production.test.ts`
Expected: PASS. If a CSV test pins the exact list of summary rows, add the two new rows to its expectation in the same position.

- [ ] **Step 7: Type check**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/reports/profit-loss/company-reporting-core.ts src/server-functions/reports/profit-loss/export-csv-fn.ts src/routes/_protected/reports/profit-loss/index.tsx src/__tests__/pnl-csv.behavior.test.ts src/__tests__/pnl-route-state.behavior.test.tsx src/__tests__/pnl-print-fixtures.test.tsx src/lib/pnl-reporting.test.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts
git commit -m "feat(reports): show return write-offs and returned stock write-downs in P&L"
```

---

### Task 7: Salvage on the receive and inspect screen (Screen 3)

**Files:**
- Modify: `src/components/sales/return-lifecycle-actions.tsx`
- Test: `src/__tests__/return-salvage.behavior.test.tsx` (create)

**Interfaces:**
- Consumes: `salvageSplit` (Task 1); `completeSalesReturnFn` salvage inputs (Task 4); `useSalesReturnDetail`; `returnCostBasis` from `@/lib/sales/returns/return-lifecycle`; `formatRupees`.
- Produces: no new exports. Screen 3 shows "<item> damaged salvage per pack" / "<item> expired salvage per pack" inputs (only when that condition has packs) and "Loss booked: Rs X" per row. Salvage fields are sent only for conditions with packs.

- [ ] **Step 1: Write the failing behaviour test**

Create `src/__tests__/return-salvage.behavior.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnLifecycleActions } from "@/components/sales/return-lifecycle-actions";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), detail: vi.fn() }));

vi.mock("@/server-functions/sales/sales-returns-fn", () => ({
  createSalesReturnFn: vi.fn(),
  decideSalesReturnFn: vi.fn(),
  completeSalesReturnFn: mocks.complete,
  cancelSalesReturnFn: vi.fn(),
  voidSalesReturnFn: vi.fn(),
  listSalesReturnsFn: vi.fn(),
  getSalesReturnDetailFn: mocks.detail,
}));
vi.mock("@/server-functions/sales/customer-credit-fn", () => ({
  getCustomerCreditSummaryFn: vi.fn(),
  issueCustomerRefundFn: vi.fn(),
  reverseCustomerRefundFn: vi.fn(),
}));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: vi.fn() }));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: ["*"] } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  mocks.detail.mockResolvedValue({
    id: "ret-1",
    status: "approved",
    items: [{
      id: "ri-1",
      cartonsRequested: 0,
      quantityRequested: 3,
      invoiceItem: {
        pack: "Mango 1L", packsPerCarton: 1, actualPackSize: 1,
        costOfGoodsSold: "30.00", costOfGoodsSoldPerUnit: "10.0000", perCartonPrice: "10",
        dispatchedUnits: 3, numberOfCartons: 0, quantity: 3,
      },
    }],
  });
  mocks.complete.mockResolvedValue({ id: "ret-1" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ReturnLifecycleActions invoiceId="inv-1" returnId="ret-1" status="approved"
        items={[{ id: "ri-1", label: "Mango 1L", approvedUnits: 3 }]} />
    </QueryClientProvider>,
  );
}

describe("Screen 3 salvage value", () => {
  it("asks for salvage only for damaged packs, shows the loss and sends it", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.change(screen.getByLabelText("Mango 1L good packs"), { target: { value: "1" } });
    expect(screen.queryByLabelText("Mango 1L damaged salvage per pack")).toBeNull();

    fireEvent.change(screen.getByLabelText("Mango 1L damaged packs"), { target: { value: "2" } });
    const salvage = await screen.findByLabelText("Mango 1L damaged salvage per pack");
    expect(await screen.findByText("Loss booked: Rs 20")).toBeTruthy();
    fireEvent.change(salvage, { target: { value: "3" } });
    expect(await screen.findByText("Loss booked: Rs 14")).toBeTruthy();

    fireEvent.change(salvage, { target: { value: "11" } });
    expect(await screen.findByText(/salvage value Rs 22\.00 is more than what these 2 packs cost/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm receipt" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(salvage, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    expect(mocks.complete).toHaveBeenCalledWith({
      data: {
        returnId: "ret-1",
        notes: undefined,
        lines: [{ returnItemId: "ri-1", goodUnits: 1, damagedUnits: 2, expiredUnits: 0, damagedSalvagePerUnit: 3 }],
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/__tests__/return-salvage.behavior.test.tsx`
Expected: FAIL. There is no "Mango 1L damaged salvage per pack" input.

- [ ] **Step 3: Add salvage state, cost lookup and preview**

In `src/components/sales/return-lifecycle-actions.tsx`:

1. Add to the imports:

```ts
import Big from "big.js";
import { salvageSplit } from "@/lib/inventory/returned-stock";
```

and add `returnCostBasis,` to the existing `@/lib/sales/returns/return-lifecycle` import list.

2. Replace:

```ts
  const [lines, setLines] = useState<Array<{ returnItemId: string; goodUnits: string; damagedUnits: string; expiredUnits: string }>>([]);
```

with:

```ts
  type LineInput = {
    returnItemId: string;
    goodUnits: string;
    damagedUnits: string;
    expiredUnits: string;
    damagedSalvage: string;
    expiredSalvage: string;
  };
  const emptyLine = (returnItemId: string): LineInput => ({
    returnItemId, goodUnits: "", damagedUnits: "", expiredUnits: "", damagedSalvage: "", expiredSalvage: "",
  });
  const [lines, setLines] = useState<LineInput[]>([]);
```

3. Directly after the line `const detailQuery = useSalesReturnDetail(needsDetail ? returnId : null);` add:

```ts
  // Cost per pack drives the "Loss booked" preview; the server works out the exact amount.
  const costQuery = useSalesReturnDetail(action === "receive" ? returnId : null);
  const costPerUnitById = new Map(
    (costQuery.data?.items ?? []).map((line) => [
      line.id,
      returnCostBasis(line.invoiceItem, getReturnUnitsPerCarton(line.invoiceItem)).costPerUnit,
    ]),
  );
```

4. Replace the `inspection` mapping:

```ts
  const inspection = resolvedItems.map(item => {
    const line = lines.find(line => line.returnItemId === item.id);
    return { ...item, goodUnits: Number(line?.goodUnits ?? ""), damagedUnits: Number(line?.damagedUnits ?? ""), expiredUnits: Number(line?.expiredUnits ?? "") };
  });
  let inspectionError = "";
  try { checkInspection(inspection); } catch (error) { inspectionError = (error as Error).message; }
```

with:

```ts
  const inspection = resolvedItems.map(item => {
    const line = lines.find(line => line.returnItemId === item.id);
    return {
      ...item,
      goodUnits: Number(line?.goodUnits ?? ""),
      damagedUnits: Number(line?.damagedUnits ?? ""),
      expiredUnits: Number(line?.expiredUnits ?? ""),
      damagedSalvage: Number(line?.damagedSalvage || 0),
      expiredSalvage: Number(line?.expiredSalvage || 0),
    };
  });
  /** Loss preview per item and condition; throws the server's message when salvage is above cost. */
  function salvagePreview(line: (typeof inspection)[number], condition: "damaged" | "expired") {
    const units = line[`${condition}Units`];
    const costPerUnit = costPerUnitById.get(line.id);
    if (!units || costPerUnit === undefined) return null;
    return salvageSplit({
      label: `${line.label} (${condition})`,
      units,
      salvagePerUnit: line[`${condition}Salvage`],
      cost: new Big(costPerUnit).times(units).toFixed(2),
    });
  }
  let inspectionError = "";
  try {
    checkInspection(inspection);
    for (const line of inspection) {
      salvagePreview(line, "damaged");
      salvagePreview(line, "expired");
    }
  } catch (error) { inspectionError = (error as Error).message; }
```

5. In `function open(nextAction: ReturnAction)`, replace:

```ts
    setLines((items ?? []).map(item => ({ returnItemId: item.id, goodUnits: "", damagedUnits: "", expiredUnits: "" })));
```

with:

```ts
    setLines((items ?? []).map(item => emptyLine(item.id)));
```

6. Replace the whole `function updateLineValue(...) { ... }` with:

```ts
  function updateLineValue(itemId: string, key: Exclude<keyof LineInput, "returnItemId">, value: string) {
    setLines(current => {
      if (current.some(line => line.returnItemId === itemId)) {
        return current.map(line => (line.returnItemId === itemId ? { ...line, [key]: value } : line));
      }
      return [...current, { ...emptyLine(itemId), [key]: value }];
    });
  }
```

7. In `submit`, replace:

```ts
          lines: inspection.map(line => ({
            returnItemId: line.id,
            goodUnits: line.goodUnits,
            damagedUnits: line.damagedUnits,
            expiredUnits: line.expiredUnits,
          })),
```

with:

```ts
          lines: inspection.map(line => ({
            returnItemId: line.id,
            goodUnits: line.goodUnits,
            damagedUnits: line.damagedUnits,
            expiredUnits: line.expiredUnits,
            ...(line.damagedUnits > 0 ? { damagedSalvagePerUnit: line.damagedSalvage } : {}),
            ...(line.expiredUnits > 0 ? { expiredSalvagePerUnit: line.expiredSalvage } : {}),
          })),
```

8. In the receive form, replace:

```tsx
                      {resolvedItems.map(item => {
                        const line = lines.find(line => line.returnItemId === item.id);
                        return <FieldGroup key={item.id}>
```

with:

```tsx
                      {resolvedItems.map(item => {
                        const line = lines.find(line => line.returnItemId === item.id);
                        const inspected = inspection.find(row => row.id === item.id)!;
                        return <FieldGroup key={item.id}>
```

and directly after that item's quantity grid (`</div>` closing `<div className="grid grid-cols-3 gap-3">`), before `</FieldGroup>;`, add:

```tsx
                          {(["damaged", "expired"] as const).map(condition => {
                            if (!inspected[`${condition}Units`]) return null;
                            const id = `${returnId}-${item.id}-${condition}-salvage`;
                            let loss: string | null = null;
                            try { loss = salvagePreview(inspected, condition)?.writeOff ?? null; } catch { loss = null; }
                            return <div key={condition} className="grid grid-cols-2 items-end gap-3">
                              <Field>
                                <Label htmlFor={id}>{item.label} {condition} salvage per pack</Label>
                                <Input id={id} type="number" min={0} step="0.01" placeholder="0"
                                  value={line?.[`${condition}Salvage`] ?? ""}
                                  onChange={event => updateLineValue(item.id, `${condition}Salvage`, event.target.value)} />
                              </Field>
                              {loss !== null && <p className="pb-2 text-sm text-amber-700 dark:text-amber-300">Loss booked: {formatRupees(loss)}</p>}
                            </div>;
                          })}
```

9. In the receive dialog description, replace `damaged and expired packs stay segregated.` with `damaged and expired packs stay segregated at their salvage value (0 unless you enter one); the rest of their cost is booked as a loss.`

- [ ] **Step 4: Run the behaviour tests**

Run: `bun run test -- src/__tests__/return-salvage.behavior.test.tsx src/__tests__/credit-note-screen4.behavior.test.tsx src/__tests__/sales-return-ui.behavior.test.tsx src/__tests__/sales-returns-pages.behavior.test.tsx src/__tests__/sales-return-cache.behavior.test.tsx src/__tests__/stock-cache-sales.behavior.test.tsx`
Expected: PASS. Existing tests send no damaged or expired packs, so their `complete` call arguments are unchanged. If one asserts `getSalesReturnDetailFn` is never called while receiving, update it to allow the cost lookup.

- [ ] **Step 5: Type check**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/return-lifecycle-actions.tsx src/__tests__/return-salvage.behavior.test.tsx
git commit -m "feat(returns-ui): ask for salvage value per pack and show the loss on the receive screen"
```

---

### Task 8: Inventory → Returned Stock page

**Files:**
- Create: `src/hooks/inventory/use-returned-stock.ts`
- Create: `src/components/inventory/returned-stock/returned-stock-view.tsx`
- Create: `src/components/inventory/returned-stock/dispose-returned-stock-dialog.tsx`
- Create: `src/components/inventory/returned-stock/set-returned-stock-value-dialog.tsx`
- Create: `src/routes/_protected/inventory/returned-stock.tsx`
- Modify: `src/lib/constants.ts` (Inventory Management items)
- Test: `src/__tests__/returned-stock-page.behavior.test.tsx` (create)

**Interfaces:**
- Consumes: Task 5 server functions; Task 1 rules and labels; `useWallets` from `@/hooks/finance/use-finance`; `useViewerAccess`; `hasPermission`; `formatRupees`; `formatUnits` from `@/lib/sales/returns/return-lifecycle`.
- Produces: page at `/inventory/returned-stock`; `useReturnedStock`, `useScrapReturnedStock`, `useSellReturnedStock`, `useSetReturnedStockValue`, `useVoidReturnedStockMovement`, `returnedStockKey`, types `ReturnedStockRow`, `ReturnedStockMovementRow`.

- [ ] **Step 1: Write the failing behaviour test**

Create `src/__tests__/returned-stock-page.behavior.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnedStockView } from "@/components/inventory/returned-stock/returned-stock-view";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), scrap: vi.fn(), sell: vi.fn(), setValue: vi.fn(), voidMovement: vi.fn(), wallets: vi.fn(),
  permissions: ["*"] as string[],
}));

vi.mock("@/server-functions/inventory/returned-stock-fn", () => ({
  getReturnedStockFn: mocks.list,
  scrapReturnedStockFn: mocks.scrap,
  sellReturnedStockFn: mocks.sell,
  setReturnedStockValueFn: mocks.setValue,
  voidReturnedStockMovementFn: mocks.voidMovement,
}));
vi.mock("@/server-functions/finance-fn", () => ({ getWalletsListFn: mocks.wallets }));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  mocks.permissions = ["*"];
  mocks.list.mockResolvedValue({
    rows: [{ warehouseId: "w1", warehouseName: "Factory", recipeId: "r1", recipeName: "Mango 1L", condition: "damaged", units: 4, unitsPerCarton: 12, value: "20.00" }],
    movements: [{
      id: "m1", kind: "scrap", recipeName: "Mango 1L", warehouseName: "Factory", condition: "damaged", units: 1,
      valueRemoved: "5.00", unitPrice: null, saleAmount: null, lossAmount: "5.00", walletName: null, note: "Leaking",
      movementDate: new Date("2026-12-01T10:00:00Z"), performedByName: "Ali", voidedAt: null, voidedByName: null, voidReason: null,
    }],
  });
  mocks.wallets.mockResolvedValue([{ id: "cash", name: "Main Cash", type: "cash", balance: "100.00" }]);
  mocks.scrap.mockResolvedValue({ id: "m2" });
  mocks.setValue.mockResolvedValue({ id: "m3" });
  mocks.voidMovement.mockResolvedValue({ id: "m1" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

const mount = () => render(<QueryClientProvider client={client}><ReturnedStockView /></QueryClientProvider>);

describe("Returned Stock page", () => {
  it("lists stock and history, scraps with a loss preview, lowers value and voids", async () => {
    mount();
    const row = (await screen.findByRole("cell", { name: "Mango 1L" })).closest("tr")!;
    expect(within(row).getByText("Rs 20")).toBeTruthy();
    expect(within(row).getByText("Rs 5")).toBeTruthy(); // value per pack
    expect(screen.getByText("Scrapped")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Dispose" }));
    fireEvent.change(screen.getByLabelText("Packs"), { target: { value: "2" } });
    expect(await screen.findByText("Loss booked: Rs 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scrap 2 packs" }));
    await waitFor(() => expect(mocks.scrap).toHaveBeenCalledWith({
      data: { warehouseId: "w1", recipeId: "r1", condition: "damaged", units: 2, note: undefined },
    }));

    fireEvent.click(within(row).getByRole("button", { name: "Set value" }));
    fireEvent.change(screen.getByLabelText("Value per pack"), { target: { value: "2" } });
    expect(await screen.findByText(/Loss booked: Rs 12\b/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Boxes torn" } });
    fireEvent.click(screen.getByRole("button", { name: "Lower value" }));
    await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith({
      data: { warehouseId: "w1", recipeId: "r1", condition: "damaged", valuePerPack: 2, note: "Boxes torn" },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Pack was fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Void entry" }));
    await waitFor(() => expect(mocks.voidMovement).toHaveBeenCalledWith({ data: { movementId: "m1", reason: "Pack was fine" } }));
  });

  it("hides actions from people who can only view", async () => {
    mocks.permissions = ["inventory.view"];
    mount();
    await screen.findByRole("cell", { name: "Mango 1L" });
    expect(screen.queryByRole("button", { name: "Dispose" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set value" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/__tests__/returned-stock-page.behavior.test.tsx`
Expected: FAIL. The component file does not exist.

- [ ] **Step 3: Write the hooks**

Create `src/hooks/inventory/use-returned-stock.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getReturnedStockFn,
  scrapReturnedStockFn,
  sellReturnedStockFn,
  setReturnedStockValueFn,
  voidReturnedStockMovementFn,
} from "@/server-functions/inventory/returned-stock-fn";
import type { ReturnedCondition } from "@/lib/inventory/returned-stock";

export const returnedStockKey = ["returned-stock"] as const;
export type ReturnedStockData = Awaited<ReturnType<typeof getReturnedStockFn>>;
export type ReturnedStockRow = ReturnedStockData["rows"][number];
export type ReturnedStockMovementRow = ReturnedStockData["movements"][number];

type StockKey = { warehouseId: string; recipeId: string; condition: ReturnedCondition };
export type ScrapInput = StockKey & { units: number; note?: string };
export type SellInput = StockKey & { units: number; unitPrice: number; walletId: string; note?: string };
export type SetValueInput = StockKey & { valuePerPack: number; note: string };
export type VoidMovementInput = { movementId: string; reason: string };

export function useReturnedStock() {
  return useQuery({ queryKey: returnedStockKey, queryFn: () => getReturnedStockFn() });
}

/** Errors stay in the dialog that sent them; success refreshes stock and account balances. */
function useReturnedStockMutation<TInput>(send: (input: TInput) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    retry: false,
    onSuccess: async () => {
      toast.success(success);
      await Promise.all([
        qc.invalidateQueries({ queryKey: returnedStockKey }),
        qc.invalidateQueries({ queryKey: ["wallets"] }),
      ]);
    },
  });
}

export const useScrapReturnedStock = () =>
  useReturnedStockMutation((data: ScrapInput) => scrapReturnedStockFn({ data }), "Packs scrapped.");
export const useSellReturnedStock = () =>
  useReturnedStockMutation((data: SellInput) => sellReturnedStockFn({ data }), "Seconds sale recorded.");
export const useSetReturnedStockValue = () =>
  useReturnedStockMutation((data: SetValueInput) => setReturnedStockValueFn({ data }), "Value lowered.");
export const useVoidReturnedStockMovement = () =>
  useReturnedStockMutation((data: VoidMovementInput) => voidReturnedStockMovementFn({ data }), "Entry voided.");
```

- [ ] **Step 4: Write the dispose dialog**

Create `src/components/inventory/returned-stock/dispose-returned-stock-dialog.tsx`:

```tsx
import { useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWallets } from "@/hooks/finance/use-finance";
import { useScrapReturnedStock, useSellReturnedStock, type ReturnedStockRow } from "@/hooks/inventory/use-returned-stock";
import { formatRupees } from "@/lib/finance/expense-entry";
import { poolShare, secondsSaleAmount } from "@/lib/inventory/returned-stock";

export function DisposeReturnedStockDialog({ row, onClose }: { row: ReturnedStockRow; onClose: () => void }) {
  const [method, setMethod] = useState<"scrap" | "seconds">("scrap");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const scrap = useScrapReturnedStock();
  const sell = useSellReturnedStock();
  const wallets = useWallets({ enabled: method === "seconds" });
  const pending = scrap.isPending || sell.isPending;

  const packs = Number(units);
  let removed: string | null = null;
  let checkError = "";
  try {
    if (units) removed = poolShare({ units: row.units, value: row.value }, packs);
  } catch (err) { checkError = (err as Error).message; }
  const unitPrice = Number(price);
  const sale = method === "seconds" && removed && unitPrice > 0 ? secondsSaleAmount(packs, unitPrice) : null;
  const loss = removed === null ? null : sale ? new Big(removed).minus(sale).toFixed(2) : removed;
  const walletName = (wallets.data ?? []).find((wallet: { id: string }) => wallet.id === walletId)?.name;
  const valid = !!removed && !checkError && (method === "scrap" || (unitPrice > 0 && !!walletId));

  async function submit() {
    if (!valid || pending) return;
    setError("");
    const key = { warehouseId: row.warehouseId, recipeId: row.recipeId, condition: row.condition };
    try {
      if (method === "scrap") await scrap.mutateAsync({ ...key, units: packs, note: note.trim() || undefined });
      else await sell.mutateAsync({ ...key, units: packs, unitPrice, walletId, note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Your entries are kept.");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Dispose {row.condition} {row.recipeName}</DialogTitle>
            <DialogDescription>{row.units} packs at {row.warehouseName}, worth {formatRupees(row.value)} in stock.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={pending}>
            <FieldGroup>
              <RadioGroup value={method} onValueChange={value => setMethod(value as "scrap" | "seconds")} className="flex gap-6">
                <div className="flex items-center gap-2"><RadioGroupItem id="dispose-scrap" value="scrap" /><Label htmlFor="dispose-scrap">Scrap</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem id="dispose-seconds" value="seconds" /><Label htmlFor="dispose-seconds">Sell as seconds</Label></div>
              </RadioGroup>
              <Field>
                <Label htmlFor="dispose-units">Packs</Label>
                <Input id="dispose-units" type="number" min={1} max={row.units} step={1} value={units} onChange={event => setUnits(event.target.value)} />
              </Field>
              {method === "seconds" && (
                <>
                  <Field>
                    <Label htmlFor="dispose-price">Price per pack</Label>
                    <Input id="dispose-price" type="number" min={0.01} step="0.01" value={price} onChange={event => setPrice(event.target.value)} />
                  </Field>
                  <Field>
                    <Label htmlFor="dispose-wallet">Money goes into</Label>
                    <Select value={walletId} onValueChange={setWalletId}>
                      <SelectTrigger id="dispose-wallet" aria-label="Money goes into"><SelectValue placeholder="Pick the account" /></SelectTrigger>
                      <SelectContent>
                        {(wallets.data ?? []).map((wallet: { id: string; name: string }) => (
                          <SelectItem key={wallet.id} value={wallet.id}>{wallet.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              )}
              <Field>
                <Label htmlFor="dispose-note">Note</Label>
                <Textarea id="dispose-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
              </Field>
            </FieldGroup>
          </fieldset>
          {checkError && <p role="alert" className="text-sm text-destructive">{checkError}</p>}
          {loss !== null && !checkError && (
            <p className="text-sm">
              {sale && walletName ? `${formatRupees(sale)} goes into ${walletName}. ` : ""}
              {new Big(loss).lt(0) ? `Profit booked: ${formatRupees(new Big(loss).abs().toFixed(2))}` : `Loss booked: ${formatRupees(loss)}`}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Close</Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? "Saving..." : `${method === "scrap" ? "Scrap" : "Sell"} ${packs} ${packs === 1 ? "pack" : "packs"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the set value dialog**

Create `src/components/inventory/returned-stock/set-returned-stock-value-dialog.tsx`:

```tsx
import { useState } from "react";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetReturnedStockValue, type ReturnedStockRow } from "@/hooks/inventory/use-returned-stock";
import { formatRupees } from "@/lib/finance/expense-entry";
import { writeDownAmount } from "@/lib/inventory/returned-stock";

export function SetReturnedStockValueDialog({ row, onClose }: { row: ReturnedStockRow; onClose: () => void }) {
  const [valuePerPack, setValuePerPack] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const setValue = useSetReturnedStockValue();
  const currentPerPack = row.units > 0 ? new Big(row.value).div(row.units).toFixed(2) : "0.00";

  let preview: { newValue: string; writeDown: string } | null = null;
  let checkError = "";
  try {
    if (valuePerPack !== "") preview = writeDownAmount({ units: row.units, value: row.value }, Number(valuePerPack));
  } catch (err) { checkError = (err as Error).message; }
  const valid = !!preview && note.trim().length >= 3;

  async function submit() {
    if (!valid || setValue.isPending) return;
    setError("");
    try {
      await setValue.mutateAsync({
        warehouseId: row.warehouseId, recipeId: row.recipeId, condition: row.condition,
        valuePerPack: Number(valuePerPack), note: note.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Your entries are kept.");
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !setValue.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Set value: {row.condition} {row.recipeName}</DialogTitle>
            <DialogDescription>
              {row.units} packs at {row.warehouseName}, now {formatRupees(currentPerPack)} a pack ({formatRupees(row.value)} in total). Value can only be lowered.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={setValue.isPending}>
            <FieldGroup>
              <Field>
                <Label htmlFor="value-per-pack">Value per pack</Label>
                <Input id="value-per-pack" type="number" min={0} step="0.01" value={valuePerPack} onChange={event => setValuePerPack(event.target.value)} />
              </Field>
              <Field>
                <Label htmlFor="value-note">Why</Label>
                <Textarea id="value-note" minLength={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
              </Field>
            </FieldGroup>
          </fieldset>
          {checkError && <p role="alert" className="text-sm text-destructive">{checkError}</p>}
          {preview && <p className="text-sm">Loss booked: {formatRupees(preview.writeDown)}. New stock value: {formatRupees(preview.newValue)}.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={setValue.isPending} onClick={onClose}>Close</Button>
            <Button type="submit" disabled={!valid || setValue.isPending}>{setValue.isPending ? "Saving..." : "Lower value"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Write the page view**

Create `src/components/inventory/returned-stock/returned-stock-view.tsx`:

```tsx
import { useState } from "react";
import Big from "big.js";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useReturnedStock,
  useVoidReturnedStockMovement,
  type ReturnedStockMovementRow,
  type ReturnedStockRow,
} from "@/hooks/inventory/use-returned-stock";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { formatRupees } from "@/lib/finance/expense-entry";
import { RETURNED_STOCK_MOVEMENT_LABELS, type ReturnedStockMovementKind } from "@/lib/inventory/returned-stock";
import { hasPermission } from "@/lib/rbac";
import { formatUnits } from "@/lib/sales/returns/return-lifecycle";
import { DisposeReturnedStockDialog } from "./dispose-returned-stock-dialog";
import { SetReturnedStockValueDialog } from "./set-returned-stock-value-dialog";

function VoidMovementDialog({ movement, onClose }: { movement: ReturnedStockMovementRow; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const voidMovement = useVoidReturnedStockMovement();
  const valid = reason.trim().length >= 3;
  async function submit() {
    if (!valid || voidMovement.isPending) return;
    setError("");
    try {
      await voidMovement.mutateAsync({ movementId: movement.id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void. Your entries are kept.");
    }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !voidMovement.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Void this entry</DialogTitle>
            <DialogDescription>
              {movement.kind === "seconds_sale"
                ? `The packs go back into stock and ${formatRupees(movement.saleAmount ?? "0")} is taken back out of ${movement.walletName ?? "the account"}.`
                : movement.kind === "scrap"
                  ? "The packs and their value go back into stock."
                  : "The old value goes back onto these packs."}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Label htmlFor="void-movement-reason">Reason</Label>
            <Textarea id="void-movement-reason" minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={voidMovement.isPending} onClick={onClose}>Close</Button>
            <Button type="submit" variant="destructive" disabled={!valid || voidMovement.isPending}>
              {voidMovement.isPending ? "Voiding..." : "Void entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnedStockView() {
  const { data: viewer } = useViewerAccess();
  const canDispose = hasPermission(viewer?.permissions ?? [], "inventory.returns.dispose");
  const stock = useReturnedStock();
  const [disposing, setDisposing] = useState<ReturnedStockRow | null>(null);
  const [valuing, setValuing] = useState<ReturnedStockRow | null>(null);
  const [voiding, setVoiding] = useState<ReturnedStockMovementRow | null>(null);

  if (stock.isLoading) return <Skeleton className="h-48 w-full" />;
  if (stock.isError) return <p role="alert" className="text-destructive">{stock.error.message}</p>;
  const { rows, movements } = stock.data ?? { rows: [], movements: [] };

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Returned stock">
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No damaged or expired packs</EmptyTitle>
              <EmptyDescription>Packs marked damaged or expired when a return is received show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Packs</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Per pack</TableHead>
                {canDispose && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={`${row.warehouseId}-${row.recipeId}-${row.condition}`}>
                  <TableCell>{row.recipeName}</TableCell>
                  <TableCell>{row.warehouseName}</TableCell>
                  <TableCell><Badge variant={row.condition === "expired" ? "destructive" : "secondary"}>{row.condition}</Badge></TableCell>
                  <TableCell className="text-right">{formatUnits(row.units, row.unitsPerCarton)}</TableCell>
                  <TableCell className="text-right">{formatRupees(row.value)}</TableCell>
                  <TableCell className="text-right">{row.units > 0 ? formatRupees(new Big(row.value).div(row.units).toFixed(2)) : "—"}</TableCell>
                  {canDispose && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={row.units === 0} onClick={() => setValuing(row)}>Set value</Button>
                        <Button size="sm" disabled={row.units === 0} onClick={() => setDisposing(row)}>Dispose</Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-label="Disposal history" className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">History</h2>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing scrapped, sold or revalued yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Packs</TableHead>
                <TableHead className="text-right">Sale</TableHead>
                <TableHead className="text-right">Loss</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Note</TableHead>
                {canDispose && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map(movement => (
                <TableRow key={movement.id} className={movement.voidedAt ? "opacity-60" : undefined}>
                  <TableCell>{format(new Date(movement.movementDate), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    {RETURNED_STOCK_MOVEMENT_LABELS[movement.kind as ReturnedStockMovementKind] ?? movement.kind}
                    {movement.voidedAt && <Badge variant="outline" className="ml-2">Voided</Badge>}
                  </TableCell>
                  <TableCell>{movement.recipeName} ({movement.condition}), {movement.warehouseName}</TableCell>
                  <TableCell className="text-right">{movement.units || "—"}</TableCell>
                  <TableCell className="text-right">
                    {movement.saleAmount ? `${formatRupees(movement.saleAmount)}${movement.walletName ? ` → ${movement.walletName}` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatRupees(movement.lossAmount)}</TableCell>
                  <TableCell>{movement.performedByName ?? "—"}</TableCell>
                  <TableCell>{movement.voidedAt ? `Voided: ${movement.voidReason ?? ""}` : movement.note ?? ""}</TableCell>
                  {canDispose && (
                    <TableCell className="text-right">
                      {!movement.voidedAt && <Button size="sm" variant="ghost" onClick={() => setVoiding(movement)}>Void</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {disposing && <DisposeReturnedStockDialog row={disposing} onClose={() => setDisposing(null)} />}
      {valuing && <SetReturnedStockValueDialog row={valuing} onClose={() => setValuing(null)} />}
      {voiding && <VoidMovementDialog movement={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}
```

`formatRupees("5.00")` renders "Rs 5" and `formatRupees("20.00")` renders "Rs 20", which the test expects for the value columns.

- [ ] **Step 7: Add the route and the menu item**

Create `src/routes/_protected/inventory/returned-stock.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ReturnedStockView } from "@/components/inventory/returned-stock/returned-stock-view";

export const Route = createFileRoute("/_protected/inventory/returned-stock")({
  component: ReturnedStockPage,
});

function ReturnedStockPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">Returned Stock</h1>
          <p className="mt-2 text-muted-foreground">
            Damaged and expired packs from customer returns. Scrap them, sell them as seconds, or lower their value.
          </p>
        </header>
        <div className="flex-1 py-8">
          <ReturnedStockView />
        </div>
      </div>
    </main>
  );
}
```

In `src/lib/constants.ts`, in the "Inventory Management" `items`, directly after the "Factory-Floor" item (`url: "/inventory/factory-floor",\n        icon: FactoryFloorIcon,\n      },`), add:

```ts
      {
        title: "Returned Stock",
        url: "/inventory/returned-stock",
        icon: WarehouseIcon,
      },
```

Start `bun run dev` once (or run `bun run build`) so the router plugin regenerates `src/routeTree.gen.ts`. Do not edit that file by hand.

- [ ] **Step 8: Run the tests**

Run: `bun run test -- src/__tests__/returned-stock-page.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 9: Type check**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/inventory/use-returned-stock.ts src/components/inventory/returned-stock src/routes/_protected/inventory/returned-stock.tsx src/routeTree.gen.ts src/lib/constants.ts src/__tests__/returned-stock-page.behavior.test.tsx
git commit -m "feat(inventory): add the Returned Stock page with dispose, set value and history"
```

---

### Task 9: Full verification

**Files:** none new.

- [ ] **Step 1: Unit and behaviour tests**

Run: `bun run test -- src/lib src/__tests__ --exclude "src/__tests__/integration/**" --exclude "src/__tests__/e2e/**"`
Expected: everything passes except tests that already failed on `main` before this phase. For any failure, run that one file on `main` (`git worktree add ../titan-main main`, then the same command there); report every failure that is new on this branch.

- [ ] **Step 2: Integration tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/two-phase-invoice-mutations.test.ts src/__tests__/integration/two-phase-production.test.ts`
Expected: PASS.

- [ ] **Step 3: Type check and build**

Run: `bun run typecheck && bun run build`
Expected: no type errors, build succeeds.

- [ ] **Step 4: Migration check on a copy of real-shaped data**

Run `bun run db:migrate` against the local database (which already holds completed returns from earlier phases). Then open Inventory → Returned Stock: earlier damaged/expired packs appear at their old (full-cost) value, and Set value can lower them. Open a completed pre-phase-5 return's detail page: nothing changed.

- [ ] **Step 5: Walk through in the browser**

With `bun run dev`:
1. Receive a return with 1 good and 2 damaged packs; enter salvage 3 per pack; check "Loss booked" and the success toast.
2. Open Inventory → Returned Stock: the damaged row shows 2 packs at Rs 6.
3. Set value to 1 per pack, scrap 1 pack, sell 1 pack as seconds into a cash account; check the account balance and the history table.
4. Void the seconds sale; check the account balance goes back and the packs return.
5. Open Reports → P&L for this month: "Return Write-offs" and "Returned Stock Write-downs" appear, and the finance reconciliation shows "Add Back Non-cash Returned Stock Losses" with no unexplained "remaining difference".
6. Try voiding the return: it is blocked with "Some were sold, scrapped or sold as seconds since."

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

---

## Self-review notes

- **Spec coverage:** salvage at inspection (Tasks 4, 7); write-off as its own P&L line in the completion period (Tasks 4, 6); Screen 3 salvage field and "Loss booked" (Task 7); Dispose with Scrap and Sell as seconds, every disposal logged (Tasks 5, 8); void reverses the write-off, dated on the void date (Tasks 4, 6); disposals in P&L, not wallet expenses (Task 6, B3); A5 line salvage, write-off amount and disposal log (Task 3). Return to supplier is deferred to phase 7 by decision. The one-time go-live write-down is replaced, by decision, with the always-available Set value action and its own P&L line.
- **Existing rows:** all new columns default to 0, which is exactly right for traces and lines written before this phase (no write-off). Old damaged stock keeps its full-cost value until someone lowers it.
- **Void with pooled stock:** a return's damaged void reverses COGS at original cost and the write-off by what actually left the pool. Total profit across lines is right; if packs were revalued in between, the write-down line and the write-off line move in opposite directions and net out.
- **Source filter:** trace write-offs follow the invoice source like returns do; disposals and value changes have no invoice and only appear in the all-sources report, like failed-batch losses.
