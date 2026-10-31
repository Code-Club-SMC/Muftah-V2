# Production Loss Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Production Loss report under Reports shows every production loss (batch shortfall, extra chemical, powder loss, packing material loss, store and floor loss) for a date range, with its cost and reason. Rows above a loss limit show red, and the open tab prints on A4 landscape.

**Architecture:** The report only reads what Parts 1 and 2 save. It adds one table, `production_loss_limits`, which has a single row for the five limits. Two pure modules do the work and can be imported by the client. `src/lib/production/loss-report.ts` holds the row types, the loss maths and the code that turns database rows into report rows. `src/lib/production/loss-display.ts` holds the column definitions, summaries, totals, filters and formatting, and the screen table and the print both use it. One server-only module, `production-loss-queries.server.ts`, runs the five queries and reads the limits. Two server functions serve the page and the print, and one saves the limits. The page lives at `/reports/production-loss` and is one client component. Its row clicks are passed in from the route, so tests need no router.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (PostgreSQL), big.js, zod, React + TanStack Query, shadcn/ui (Tabs, Switch, Dialog, NativeSelect, Table), Vitest (jsdom unit tests, real-DB integration tests through `vitest.integration.config.ts`), fast-check.

**Spec:** `docs/superpowers/specs/2026-10-29-production-loss-report-spec.md` (Part 3 of 3. Part 1 plan: `docs/superpowers/plans/2026-10-29-material-price-lots.md`, done. Part 2 plan: `docs/superpowers/plans/2026-10-30-actual-material-use.md`, done.)

## Global Constraints

- Read-only. The report adds no new data entry. The only thing it saves is the loss limits.
- New permissions: `reports.loss.view` ("View loss report") and `reports.loss.limits.manage` ("Manage loss limits"). Both belong to the `reports` module. The `admin` role seed gets both. `super-admin` already has `*`.
- `/reports/production-loss` needs `reports.loss.view`. The Production Loss card on the Reports page shows only with that permission.
- The date range covers the whole page and defaults to the current month in Pakistan time (`currentReportMonth()`). Days are Pakistan calendar days (`reportDateBounds`).
- Each tab shows 25 rows per page, newest first.
- Loss % has 1 decimal, rounded half up. A row is red when its rounded loss % is **strictly above** its limit, so 10.0% at a 10% limit is not red.
- Limits start at 10%. Allowed range is 0–100 with at most one decimal place. Changing a limit only changes highlighting.
- Money shows whole rupees with Lac/Crore grouping (`formatIndianStyle`), for example `Rs 1,08,000`.
- Tab 1: only `completed` batches whose actual output is below target. Failed batches never appear.
- Tab 2: only chemical rows with extra above 0.
- Tab 3: only packing entries with powder loss above 0. Loss Rs = lost × the batch's `chemicalCostPerUnit`, which is its chemical cost per KG of output.
- Tab 4: every shopper (KG) row, and pieces rows with extra above 0. A shopper row with more packs than expected shows "check weight". It adds 0 to loss totals, is left out of the weighted shopper loss %, and is never red.
- Tab 5: only adjustments that remove stock (`delta < 0`) with reason Damaged, Spilled, Expired, Count short or Other. These rows have no loss % and are never red.
- Print: every matching row, A4 landscape. Over-limit rows print bold red with "▲" before the loss %. Header rows repeat on every page and rows never split. More than 2,000 rows are blocked with exactly: "Too many rows to print. Narrow the date range or filters."
- Never hand-edit files under `src/db/migrations/`. Always run `bun run db:generate`.
- Do not edit `src/routeTree.gen.ts`.

## Decisions this plan makes where the spec is open

- **Row dates.** Tabs 1 and 2 use the batch's `actualCompletionDate`. Tabs 3 and 4 use the packing entry's `packedAt`. Tab 5 uses the adjustment's `createdAt`.
- **Row clicks.** Rows in tabs 1–4 open `/manufacturing/mixing/$runId`, the batch page, which also lists its packing. Rows in tab 5 open `/inventory/item/$itemType/$itemId`.
- **"Most-lost" chemical or material** is the one with the highest total loss Rs among the filtered rows.
- **The summary strip** adds up loss Rs for each tab across the date range, ignoring that tab's filters and the "Only over limit" switch.
- **Filter options** come from the tab's rows in the date range, so a dropdown never offers a choice that would show nothing.
- **Mixed units.** Quantity totals and summaries list each unit on its own, for example "4,500 KG · 200 L". A loss % total is shown only when every row uses the same unit.
- **Old batches** saved before Part 2 may have a free-text shortfall reason and no reason code. That text is shown as the reason.

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
| `src/lib/rbac.ts` (modify) | Two permission keys and their definitions, the admin seed, and the route rule |
| `src/lib/middlewares.ts` (modify) | `requireLossReportViewMiddleware`, `requireLossLimitsManageMiddleware` |
| `src/db/schemas/production-schema.ts` (modify) | `productionLossLimits` table (single row) |
| `src/lib/production/loss-report.ts` (create) | Tabs, limits, row types, loss maths, and building rows from query rows. Client-safe |
| `src/lib/production/loss-display.ts` (create) | Formatting, columns, totals, summaries, filters, strip totals and paging. Client-safe |
| `src/server-functions/reports/production-loss-queries.server.ts` (create) | The five SQL queries and the limits read |
| `src/server-functions/reports/production-loss-fn.ts` (create) | `getProductionLossFn`, `getProductionLossPrintFn`, `updateLossLimitsFn` |
| `src/components/reports/production-loss/loss-print.ts` (create) | Print HTML and opening the print window |
| `src/components/reports/production-loss/loss-limits-dialog.tsx` (create) | Loss limits form |
| `src/components/reports/production-loss/production-loss-report.tsx` (create) | The page: date range, strip, tabs, filters, table and paging |
| `src/routes/_protected/reports/production-loss/index.tsx` (create) | Route that wires row clicks to the router |
| `src/routes/_protected/reports/index.tsx` (modify) | Production Loss card, shown only with the permission |

---

### Task 1: Permissions and the loss limits table

**Files:**
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/middlewares.ts`
- Modify: `src/db/schemas/production-schema.ts`
- Generated: a new migration under `src/db/migrations/` (by `bun run db:generate` only)
- Test: `src/lib/production-loss-access.test.ts`

**Interfaces:**
- Produces: permission keys `"reports.loss.view"` and `"reports.loss.limits.manage"`. `requireLossReportViewMiddleware` and `requireLossLimitsManageMiddleware` from `@/lib/middlewares`. `productionLossLimits` and `PRODUCTION_LOSS_LIMITS_ID` from `@/db/schemas/production-schema`, with columns `id`, `batch`, `chemical`, `powder`, `shopper`, `otherPacking` (decimal strings like `"10.0"`), `updatedBy`, `createdAt` and `updatedAt`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/production-loss-access.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_DEFINITIONS, PERMISSION_KEYS, SYSTEM_ROLE_SEEDS, canAccessPath } from "@/lib/rbac";

describe("production loss access", () => {
  it("adds view and limits permissions under reports", () => {
    expect(PERMISSION_KEYS).toEqual(expect.arrayContaining(["reports.loss.view", "reports.loss.limits.manage"]));
    const view = PERMISSION_DEFINITIONS.find((p) => p.key === "reports.loss.view");
    const manage = PERMISSION_DEFINITIONS.find((p) => p.key === "reports.loss.limits.manage");
    expect([view?.moduleKey, view?.kind, view?.routePattern]).toEqual(["reports", "route", "/reports/production-loss"]);
    expect([manage?.moduleKey, manage?.kind]).toEqual(["reports", "action"]);
  });
  it("gives admin both permissions", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin");
    expect(admin?.permissionKeys).toEqual(expect.arrayContaining(["reports.loss.view", "reports.loss.limits.manage"]));
  });
  it("locks the page to the loss permission, not the general reports one", () => {
    expect(canAccessPath("/reports/production-loss", ["reports.view"])).toBe(false);
    expect(canAccessPath("/reports/production-loss", ["reports.loss.view"])).toBe(true);
    expect(canAccessPath("/reports/sales", ["reports.view"])).toBe(true);
  });
  it("has middleware for both permissions and a single-row limits table", () => {
    const middlewares = readFileSync("src/lib/middlewares.ts", "utf8");
    expect(middlewares).toMatch(/requireLossReportViewMiddleware = createPermissionMiddleware\(\s*"reports\.loss\.view"/);
    expect(middlewares).toMatch(/requireLossLimitsManageMiddleware = createPermissionMiddleware\(\s*"reports\.loss\.limits\.manage"/);
    const schema = readFileSync("src/db/schemas/production-schema.ts", "utf8");
    expect(schema).toContain('pgTable("production_loss_limits"');
    expect(schema).toContain('PRODUCTION_LOSS_LIMITS_ID = "default"');
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/lib/production-loss-access.test.ts`
Expected: FAIL. `reports.loss.view` is not in `PERMISSION_KEYS`.

- [ ] **Step 3: Add the permissions**

In `src/lib/rbac.ts`:

1. In `PERMISSION_KEYS`, right after `"reports.view",`, add:
   ```ts
     "reports.loss.view",
     "reports.loss.limits.manage",
   ```
2. In `PERMISSION_DEFINITIONS`, right after the `reports.view` entry, add:
   ```ts
     {
       key: "reports.loss.view",
       moduleKey: "reports",
       label: "View loss report",
       description: "Open the production loss report and print it.",
       kind: "route",
       routePattern: "/reports/production-loss",
     },
     {
       key: "reports.loss.limits.manage",
       moduleKey: "reports",
       label: "Manage loss limits",
       description: "Change the loss % limits that mark rows red in the production loss report.",
       kind: "action",
     },
   ```
3. In the `admin` role seed's `permissionKeys`, right after `"reports.view",`, add `"reports.loss.view",` and `"reports.loss.limits.manage",`.
4. In `ROUTE_PERMISSION_RULES`, add this rule **directly before** the `/^\/reports(?:\/.*)?$/` rule. The first matching rule wins:
   ```ts
     {
       matcher: /^\/reports\/production-loss(?:\/.*)?$/,
       permissions: ["reports.loss.view"],
     },
   ```

In `src/lib/middlewares.ts`, after `requireReportsViewMiddleware`:

```ts
export const requireLossReportViewMiddleware = createPermissionMiddleware(
  "reports.loss.view",
);
export const requireLossLimitsManageMiddleware = createPermissionMiddleware(
  "reports.loss.limits.manage",
);
```

- [ ] **Step 4: Add the limits table**

In `src/db/schemas/production-schema.ts`, after `outsidePackMovements`:

```ts
// ---------------------------------------------------------------------------
// PRODUCTION LOSS LIMITS — One row. Loss % above a limit shows red in the loss report.
// ---------------------------------------------------------------------------
export const PRODUCTION_LOSS_LIMITS_ID = "default";

export const productionLossLimits = pgTable("production_loss_limits", {
  id: text("id").primaryKey().default(PRODUCTION_LOSS_LIMITS_ID),
  batch: decimal("batch", { precision: 4, scale: 1 }).notNull().default("10.0"),
  chemical: decimal("chemical", { precision: 4, scale: 1 }).notNull().default("10.0"),
  powder: decimal("powder", { precision: 4, scale: 1 }).notNull().default("10.0"),
  shopper: decimal("shopper", { precision: 4, scale: 1 }).notNull().default("10.0"),
  otherPacking: decimal("other_packing", { precision: 4, scale: 1 }).notNull().default("10.0"),
  updatedBy: text("updated_by").references(() => user.id),
  ...timestamps,
});
```

- [ ] **Step 5: Generate the migration and apply it to the test database**

```bash
bun run db:generate
DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
```
Expected: one new migration that only creates `production_loss_limits`. Do not edit the generated files.

- [ ] **Step 6: Run the tests and check that they pass**

Run: `bun run test -- src/lib/production-loss-access.test.ts src/lib/rbac.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/rbac.ts src/lib/middlewares.ts src/db/schemas/production-schema.ts src/db/migrations src/lib/production-loss-access.test.ts
git commit -m "feat(reports): add loss report permissions and loss limits table"
```

---

### Task 2: Loss maths and report rows

**Files:**
- Create: `src/lib/production/loss-report.ts`
- Test: `src/lib/production/loss-report.test.ts`

**Interfaces:**
- Consumes: `MIXING_REASONS`, `PACKING_REASONS`, `POWDER_LOSS_REASONS`, `ADJUSTMENT_REASONS`, `reasonLabel` from `@/lib/production/material-use` (Part 2). `packagingUnit` from `@/lib/inventory/material-units` (Part 2).
- Produces (all exported from `@/lib/production/loss-report`):
  - `LOSS_TABS`, `type LossTab`, `LOSS_TAB_LABELS`, `LOSS_STRIP_LABELS`
  - `LOSS_LIMIT_KEYS`, `type LossLimitKey`, `type LossLimits`, `LOSS_LIMIT_LABELS`, `DEFAULT_LOSS_LIMITS`
  - `STORE_LOSS_REASONS`, `LOSS_PAGE_SIZE` (25), `LOSS_PRINT_MAX_ROWS` (2000), `TOO_MANY_TO_PRINT`
  - `lossPercent(loss, base): string | null`, `isOverLimit(percent, limit): boolean`
  - `batchLoss`, `chemicalLoss`, `powderLoss`, `shopperLoss`, `piecesLoss`, `weightedShopperPercent`, `sumMoney`
  - Row types `BatchLossRow`, `ChemicalLossRow`, `PowderLossRow`, `PackingLossRow`, `StoreLossRow`, `LossRow`, `LossRowOf<T>`, `LossRowLink`
  - Query row types `BatchQueryRow`, `ChemicalQueryRow`, `PowderQueryRow`, `PackingQueryRow`, `StoreQueryRow`
  - Builders `toBatchRow`, `toChemicalRow`, `toPowderRow`, `toPackingRow`, `toStoreRow`. Each takes a query row and `LossLimits` and returns a report row.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/production/loss-report.test.ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOSS_LIMITS, batchLoss, chemicalLoss, isOverLimit, lossPercent, piecesLoss, powderLoss, shopperLoss,
  sumMoney, toBatchRow, toPackingRow, toStoreRow, weightedShopperPercent,
} from "./loss-report";

const limits = DEFAULT_LOSS_LIMITS;
const runBase = { runId: "r1", batchId: "A0104", date: new Date("2026-10-12T06:00:00Z"), productId: "p1", product: "Surf Powder" };

describe("loss percent and limits", () => {
  it("rounds to one decimal, half up, and has no percent without a base", () => {
    expect(lossPercent(5, 400)).toBe("1.3");
    expect(lossPercent(30, 1080)).toBe("2.8");
    expect(lossPercent(1, 0)).toBeNull();
  });
  it("is red only strictly above the limit", () => {
    expect(isOverLimit("10.0", "10.0")).toBe(false);
    expect(isOverLimit("10.1", "10.0")).toBe(true);
    expect(isOverLimit(null, "0.0")).toBe(false);
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (p, l) =>
      isOverLimit((p / 10).toFixed(1), (l / 10).toFixed(1)) === p > l));
  });
});

describe("loss per tab", () => {
  it("costs batch loss at the batch's chemical cost per KG of target", () => {
    expect(batchLoss({ target: "500", actual: "400", chemicalCost: "150575" })).toEqual({ loss: "100.000", percent: "20.0", cost: "30115.00" });
  });
  it("costs extra chemical at its saved lot cost", () => {
    expect(chemicalLoss({ formula: "50", used: "55", extraCost: "575.00" })).toEqual({ extra: "5.000", percent: "10.0", cost: "575.00" });
  });
  it("counts powder given to packing as packed plus lost", () => {
    expect(powderLoss({ packed: "395", lost: "5", costPerUnit: "301.15" })).toEqual({ given: "400.000", percent: "1.3", cost: "1505.75" });
  });
  it("measures shopper loss and ignores negative loss in cost", () => {
    expect(shopperLoss({ expected: 1200, actual: 1080, lossCost: "62.40" })).toEqual({ loss: 120, percent: "10.0", cost: "62.40", checkWeight: false });
    expect(shopperLoss({ expected: 1000, actual: 1010, lossCost: "0.00" })).toEqual({ loss: -10, percent: "-1.0", cost: "0.00", checkWeight: true });
  });
  it("measures pieces loss against the need", () => {
    expect(piecesLoss({ needed: "1080", used: "1110", extraCost: "60.00" })).toEqual({ loss: "30.000", percent: "2.8", cost: "60.00" });
  });
  it("weights shopper loss by expected and skips check-weight rows", () => {
    expect(weightedShopperPercent([
      { expected: 1200, loss: 120, checkWeight: false },
      { expected: 800, loss: 40, checkWeight: false },
      { expected: 1000, loss: -10, checkWeight: true },
    ])).toBe("8.0"); // 160 ÷ 2,000
    expect(weightedShopperPercent([])).toBeNull();
  });
  it("adds money exactly", () => {
    expect(sumMoney(["0.10", "0.20", "30115.00"])).toBe("30115.30");
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 10_000_000 })), (paise) =>
      sumMoney(paise.map((p) => (p / 100).toFixed(2))) === (paise.reduce((a, b) => a + b, 0) / 100).toFixed(2)));
  });
});

describe("report rows", () => {
  it("builds a red batch row with the reason and note", () => {
    const row = toBatchRow({ ...runBase, target: "500", actual: "400", unit: "kg", chemicalCost: "150575", reasonCode: "spill", note: "mixer seal", formulaId: "f1", formula: "Surf 500" }, limits);
    expect([row.loss, row.percent, row.cost, row.over, row.reason, row.reasonName]).toEqual(["100.000", "20.0", "30115.00", true, 'Spill · "mixer seal"', "Spill"]);
    expect(row.link).toEqual({ kind: "run", runId: "r1" });
    expect(row.date).toBe("2026-10-12T06:00:00.000Z");
  });
  it("shows an old free-text shortfall reason as is", () => {
    const row = toBatchRow({ ...runBase, target: "500", actual: "490", unit: "kg", chemicalCost: "1000", reasonCode: null, note: "power cut", formulaId: "f1", formula: "F" }, limits);
    expect([row.reason, row.reasonCode]).toEqual(["power cut", null]);
  });
  it("names a shopper row with its KG and never marks a check-weight row red", () => {
    const base = { ...runBase, useId: "u1", materialId: "m1", material: "100g shopper", measuredInKg: true, needed: "1080.000", used: "1.200", extraQuantity: "0.000", extraCost: "62.40", reasonCode: null, note: null };
    const shopper = toPackingRow({ ...base, expectedShoppers: 1200, actualShoppers: 1080, lossShoppers: 120 }, limits);
    expect([shopper.material, shopper.needed, shopper.used, shopper.loss, shopper.percent, shopper.cost, shopper.over, shopper.reason]).toEqual(["100g shopper (1.20 KG)", "1200", "1080", "120", "10.0", "62.40", false, "Measured"]);
    const over = toPackingRow({ ...base, extraCost: "0.00", expectedShoppers: 500, actualShoppers: 700, lossShoppers: -200 }, { ...limits, shopper: "0.0" });
    expect([over.checkWeight, over.over, over.cost]).toEqual([true, false, "0.00"]);
  });
  it("uses the other-packing limit for pieces", () => {
    const row = toPackingRow({ ...runBase, useId: "u2", materialId: "m2", material: "Cap 38mm", measuredInKg: false, needed: "1080.000", used: "1110.000", extraQuantity: "30.000", extraCost: "60.00", reasonCode: "broken", note: null, expectedShoppers: null, actualShoppers: null, lossShoppers: null }, { ...limits, otherPacking: "2.5" });
    expect([row.loss, row.percent, row.over, row.reason]).toEqual(["30.000", "2.8", true, "Broken"]);
  });
  it("turns a stock removal into a positive loss with no limit", () => {
    const row = toStoreRow({ id: "a1", date: new Date("2026-10-18T05:00:00Z"), storeId: "w1", store: "Factory floor", materialType: "chemical", chemicalId: "c1", chemicalName: "Soda Ash", chemicalUnit: "kg", packagingId: null, packagingName: null, measuredInKg: null, lotPrice: "115.00", delta: "-2.000", value: "-230.00", reasonCode: "count_short", note: null, by: "Ali" }, limits);
    expect([row.material, row.unit, row.quantity, row.cost, row.reason, row.over, row.by]).toEqual(["Soda Ash", "kg", "2.000", "230.00", "Count short", false, "Ali"]);
    expect(row.link).toEqual({ kind: "item", itemType: "chemical", itemId: "c1" });
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/lib/production/loss-report.test.ts`
Expected: FAIL. The module `./loss-report` cannot be found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/production/loss-report.ts
import Big from "big.js";
import { packagingUnit } from "@/lib/inventory/material-units";
import { ADJUSTMENT_REASONS, MIXING_REASONS, PACKING_REASONS, POWDER_LOSS_REASONS, reasonLabel } from "./material-use";

export const LOSS_TABS = ["batch", "chemical", "powder", "packing", "store"] as const;
export type LossTab = (typeof LOSS_TABS)[number];
export const LOSS_TAB_LABELS: Record<LossTab, string> = {
  batch: "Batch loss", chemical: "Chemical loss", powder: "Powder loss", packing: "Packing material loss", store: "Store & floor loss",
};
export const LOSS_STRIP_LABELS: Record<LossTab, string> = {
  batch: "Batch", chemical: "Chemical", powder: "Powder", packing: "Packing", store: "Store/floor",
};

export const LOSS_LIMIT_KEYS = ["batch", "chemical", "powder", "shopper", "otherPacking"] as const;
export type LossLimitKey = (typeof LOSS_LIMIT_KEYS)[number];
export type LossLimits = Record<LossLimitKey, string>;
export const LOSS_LIMIT_LABELS: Record<LossLimitKey, string> = {
  batch: "Batch loss", chemical: "Chemical loss", powder: "Powder loss", shopper: "Shopper loss", otherPacking: "Other packing material",
};
export const DEFAULT_LOSS_LIMITS: LossLimits = { batch: "10.0", chemical: "10.0", powder: "10.0", shopper: "10.0", otherPacking: "10.0" };

// Stock removals that count as loss. "count_over" only ever adds stock.
export const STORE_LOSS_REASONS = ["damaged", "spilled", "expired", "count_short", "other"] as const;
export const LOSS_PAGE_SIZE = 25;
export const LOSS_PRINT_MAX_ROWS = 2000;
export const TOO_MANY_TO_PRINT = "Too many rows to print. Narrow the date range or filters.";

const money = (value: Big) => value.round(2, Big.roundHalfUp).toFixed(2);
const qty = (value: Big) => value.toFixed(3);

export function lossPercent(loss: Big.BigSource, base: Big.BigSource): string | null {
  const total = new Big(base);
  if (total.lte(0)) return null;
  return new Big(loss).times(100).div(total).round(1, Big.roundHalfUp).toFixed(1);
}

// Strictly above: 10.0% at a 10% limit is not red.
export function isOverLimit(percent: string | null, limit: string) {
  return percent !== null && new Big(percent).gt(limit);
}

export function batchLoss(input: { target: string; actual: string; chemicalCost: string }) {
  const target = new Big(input.target);
  const loss = target.minus(input.actual);
  const cost = target.gt(0) ? loss.times(input.chemicalCost).div(target) : new Big(0);
  return { loss: qty(loss), percent: lossPercent(loss, target), cost: money(cost) };
}

export function chemicalLoss(input: { formula: string; used: string; extraCost: string }) {
  const extra = new Big(input.used).minus(input.formula);
  return { extra: qty(extra), percent: lossPercent(extra, input.formula), cost: money(new Big(input.extraCost)) };
}

export function powderLoss(input: { packed: string; lost: string; costPerUnit: string }) {
  const given = new Big(input.packed).plus(input.lost);
  return { given: qty(given), percent: lossPercent(input.lost, given), cost: money(new Big(input.lost).times(input.costPerUnit)) };
}

// lossCost is the saved cost of lost shoppers. More packs than expected is a weight problem, not a gain.
export function shopperLoss(input: { expected: number; actual: number; lossCost: string }) {
  const loss = input.expected - input.actual;
  const checkWeight = loss < 0;
  return { loss, percent: lossPercent(loss, input.expected), cost: checkWeight ? "0.00" : money(new Big(input.lossCost)), checkWeight };
}

export function piecesLoss(input: { needed: string; used: string; extraCost: string }) {
  const loss = new Big(input.used).minus(input.needed);
  return { loss: qty(loss), percent: lossPercent(loss, input.needed), cost: money(new Big(input.extraCost)) };
}

export function weightedShopperPercent(rows: { expected: number; loss: number; checkWeight: boolean }[]) {
  const counted = rows.filter((row) => !row.checkWeight);
  return lossPercent(counted.reduce((sum, row) => sum + row.loss, 0), counted.reduce((sum, row) => sum + row.expected, 0));
}

export function sumMoney(values: string[]) {
  return money(values.reduce((sum, value) => sum.plus(value), new Big(0)));
}

// ── Report rows ─────────────────────────────────────────────────────────────

export type LossRowLink = { kind: "run"; runId: string } | { kind: "item"; itemType: "chemical" | "packaging"; itemId: string };
type RowBase = { id: string; date: string; reasonCode: string | null; reasonName: string; reason: string; over: boolean; link: LossRowLink };
type RunFields = { batchId: string; productId: string; product: string };

export type BatchLossRow = RowBase & RunFields & { tab: "batch"; formulaId: string; formula: string; unit: string; target: string; actual: string; loss: string; percent: string | null; cost: string };
export type ChemicalLossRow = RowBase & RunFields & { tab: "chemical"; chemicalId: string; chemical: string; unit: string; formula: string; used: string; extra: string; percent: string | null; cost: string };
export type PowderLossRow = RowBase & RunFields & { tab: "powder"; unit: string; given: string; lost: string; percent: string | null; cost: string };
export type PackingLossRow = RowBase & RunFields & { tab: "packing"; materialId: string; material: string; shopper: boolean; needed: string; used: string; loss: string; percent: string | null; cost: string; checkWeight: boolean };
export type StoreLossRow = RowBase & { tab: "store"; storeId: string; store: string; materialId: string; material: string; unit: string; lotPrice: string; quantity: string; cost: string; by: string };
export type LossRow = BatchLossRow | ChemicalLossRow | PowderLossRow | PackingLossRow | StoreLossRow;
export type LossRowOf<T extends LossTab> = Extract<LossRow, { tab: T }>;

type RunQueryFields = { runId: string; batchId: string; date: Date; productId: string; product: string };
export type BatchQueryRow = RunQueryFields & { target: string; actual: string; unit: string; chemicalCost: string; reasonCode: string | null; note: string | null; formulaId: string; formula: string };
export type ChemicalQueryRow = RunQueryFields & { useId: string; chemicalId: string; chemical: string; unit: string; formula: string; used: string; extraCost: string; reasonCode: string | null; note: string | null };
export type PowderQueryRow = RunQueryFields & { receiptId: string; unit: string; packed: string; lost: string; costPerUnit: string; reasonCode: string | null; note: string | null };
export type PackingQueryRow = RunQueryFields & { useId: string; materialId: string; material: string; measuredInKg: boolean; needed: string; used: string; extraQuantity: string; extraCost: string; reasonCode: string | null; note: string | null; expectedShoppers: number | null; actualShoppers: number | null; lossShoppers: number | null };
export type StoreQueryRow = { id: string; date: Date; storeId: string; store: string; materialType: string; chemicalId: string | null; chemicalName: string | null; chemicalUnit: string | null; packagingId: string | null; packagingName: string | null; measuredInKg: boolean | null; lotPrice: string; delta: string; value: string; reasonCode: string; note: string | null; by: string };

type ReasonList = readonly { code: string; label: string }[];
// Label plus a quoted note. Old batches have only free text and no code.
function reasonText(list: ReasonList, code: string | null, note: string | null) {
  const name = code ? reasonLabel(list, code) : "";
  if (!name) return { reasonName: "", reason: note?.trim() ?? "" };
  return { reasonName: name, reason: note?.trim() ? `${name} · "${note.trim()}"` : name };
}
const runFields = (row: RunQueryFields) => ({
  batchId: row.batchId, productId: row.productId, product: row.product, date: row.date.toISOString(), link: { kind: "run" as const, runId: row.runId },
});

export function toBatchRow(row: BatchQueryRow, limits: LossLimits): BatchLossRow {
  const loss = batchLoss({ target: row.target, actual: row.actual, chemicalCost: row.chemicalCost });
  return {
    tab: "batch", id: row.runId, ...runFields(row), ...reasonText(MIXING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    formulaId: row.formulaId, formula: row.formula, unit: row.unit, target: row.target, actual: row.actual, ...loss, over: isOverLimit(loss.percent, limits.batch),
  };
}

export function toChemicalRow(row: ChemicalQueryRow, limits: LossLimits): ChemicalLossRow {
  const loss = chemicalLoss({ formula: row.formula, used: row.used, extraCost: row.extraCost });
  return {
    tab: "chemical", id: row.useId, ...runFields(row), ...reasonText(MIXING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    chemicalId: row.chemicalId, chemical: row.chemical, unit: row.unit, formula: row.formula, used: row.used, ...loss, over: isOverLimit(loss.percent, limits.chemical),
  };
}

export function toPowderRow(row: PowderQueryRow, limits: LossLimits): PowderLossRow {
  const loss = powderLoss({ packed: row.packed, lost: row.lost, costPerUnit: row.costPerUnit });
  return {
    tab: "powder", id: row.receiptId, ...runFields(row), ...reasonText(POWDER_LOSS_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode,
    unit: row.unit, lost: row.lost, ...loss, over: isOverLimit(loss.percent, limits.powder),
  };
}

export function toPackingRow(row: PackingQueryRow, limits: LossLimits): PackingLossRow {
  const common = { tab: "packing" as const, id: row.useId, ...runFields(row), materialId: row.materialId };
  if (row.measuredInKg) {
    const loss = shopperLoss({ expected: row.expectedShoppers ?? 0, actual: row.actualShoppers ?? 0, lossCost: row.extraCost });
    return {
      ...common, material: `${row.material} (${new Big(row.used).toFixed(2)} KG)`, shopper: true,
      needed: String(row.expectedShoppers ?? 0), used: String(row.actualShoppers ?? 0), loss: String(loss.loss), percent: loss.percent, cost: loss.cost,
      checkWeight: loss.checkWeight, reasonCode: null, reasonName: "Measured", reason: "Measured",
      over: !loss.checkWeight && isOverLimit(loss.percent, limits.shopper),
    };
  }
  const loss = piecesLoss({ needed: row.needed, used: row.used, extraCost: row.extraCost });
  return {
    ...common, material: row.material, shopper: false, needed: row.needed, used: row.used, ...loss, checkWeight: false,
    ...reasonText(PACKING_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode, over: isOverLimit(loss.percent, limits.otherPacking),
  };
}

export function toStoreRow(row: StoreQueryRow, _limits: LossLimits): StoreLossRow {
  const chemical = row.materialType === "chemical";
  const materialId = (chemical ? row.chemicalId : row.packagingId) ?? "";
  return {
    tab: "store", id: row.id, date: row.date.toISOString(), storeId: row.storeId, store: row.store, materialId,
    material: (chemical ? row.chemicalName : row.packagingName) ?? "",
    unit: chemical ? (row.chemicalUnit ?? "") : packagingUnit({ measuredInKg: row.measuredInKg }),
    lotPrice: row.lotPrice, quantity: new Big(row.delta).abs().toFixed(3), cost: money(new Big(row.value).abs()), by: row.by,
    ...reasonText(ADJUSTMENT_REASONS, row.reasonCode, row.note), reasonCode: row.reasonCode, over: false,
    link: { kind: "item", itemType: chemical ? "chemical" : "packaging", itemId: materialId },
  };
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `bun run test -- src/lib/production/loss-report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/production/loss-report.ts src/lib/production/loss-report.test.ts
git commit -m "feat(reports): add loss maths and report rows"
```

---

### Task 3: Columns, totals, summaries, filters and paging

**Files:**
- Create: `src/lib/production/loss-display.ts`
- Test: `src/lib/production/loss-display.test.ts`

**Interfaces:**
- Consumes: everything from Task 2. `formatIndianStyle` and `formatNumber` from `@/lib/currency-format`. `formatReportDate` from `@/lib/report-dates`.
- Produces (all exported from `@/lib/production/loss-display`):
  - `formatLossMoney(value): string` (whole rupees with Lac/Crore grouping, no "Rs"), `unitLabel(unit): string`, `formatLossQuantity(value, unit): string`, `formatLossRange(dateFrom, dateTo): string`
  - `type LossColumn = { key: string; label: string; numeric?: boolean; percent?: boolean; cell: (row: LossRow) => string; total?: (rows: LossRow[]) => string }`
  - `lossColumns(tab: LossTab): LossColumn[]`
  - `type LossSummaryItem = { label: string; value: string }`, `lossSummary(tab, rows): LossSummaryItem[]`
  - `type LossFilterKey`, `type LossFilters`, `LOSS_FILTER_KEYS: Record<LossTab, LossFilterKey[]>`, `type LossFilterOption = { key: LossFilterKey; label: string; options: { value: string; label: string }[] }`
  - `lossFilterOptions(tab, rows): LossFilterOption[]`, `filterLossRows(tab, rows, filters, onlyOverLimit): LossRow[]`, `lossFiltersText(tab, filters, options): string`
  - `lossStripTotals(rowsByTab: Record<LossTab, LossRow[]>): Record<LossTab | "total", string>`
  - `pageLossRows(rows, page): { rows: LossRow[]; page: number; pageCount: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/production/loss-display.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LOSS_LIMITS, toBatchRow, toChemicalRow, toPackingRow, toStoreRow, type LossRow } from "./loss-report";
import {
  filterLossRows, formatLossMoney, formatLossQuantity, lossColumns, lossFilterOptions, lossFiltersText, lossStripTotals, lossSummary, pageLossRows,
} from "./loss-display";

const limits = DEFAULT_LOSS_LIMITS;
const run = (id: string, product = "Surf Powder") => ({ runId: id, batchId: `A${id}`, date: new Date("2026-10-12T06:00:00Z"), productId: `p-${product}`, product });
const batch = (id: string, target: string, actual: string, unit = "kg", reasonCode: string | null = "spill") =>
  toBatchRow({ ...run(id), target, actual, unit, chemicalCost: "150575", reasonCode, note: null, formulaId: "f1", formula: "F" }, limits);

describe("formatting", () => {
  it("shows whole rupees with Lac grouping and short unit names", () => {
    expect(formatLossMoney("108000.40")).toBe("1,08,000");
    expect(formatLossMoney("1505.75")).toBe("1,506");
    expect(formatLossQuantity("100.000", "kg")).toBe("100 KG");
    expect(formatLossQuantity("2.5", "liters")).toBe("2.50 L");
  });
});

describe("columns and totals", () => {
  it("prints the batch row cells in the spec's column order", () => {
    const columns = lossColumns("batch");
    expect(columns.map((c) => c.label)).toEqual(["Date", "Batch", "Product", "Target", "Actual", "Loss", "Loss %", "Loss Rs", "Reason"]);
    expect(columns.map((c) => c.cell(batch("1", "500", "400")))).toEqual(["12 Oct 2026", "A1", "Surf Powder", "500 KG", "400 KG", "100 KG", "20.0%", "30,115", "Spill"]);
  });
  it("totals one unit with a loss %, and lists mixed units without one", () => {
    const columns = lossColumns("batch");
    const total = (rows: LossRow[]) => columns.map((c) => c.total?.(rows) ?? "");
    expect(total([batch("1", "500", "400"), batch("2", "500", "490")])).toEqual(["Total", "", "", "1,000 KG", "890 KG", "110 KG", "11.0%", "33,127", ""]);
    expect(total([batch("1", "500", "400"), batch("2", "200", "190", "liters")])[5]).toBe("100 KG · 10 L");
    expect(total([batch("1", "500", "400"), batch("2", "200", "190", "liters")])[6]).toBe("");
  });
  it("shows check weight on a shopper row and leaves it out of totals", () => {
    const shopper = (id: string, expected: number, actual: number, extraCost: string) => toPackingRow({ ...run(id), useId: id, materialId: "s", material: "Shopper", measuredInKg: true, needed: "0", used: "1.2", extraQuantity: "0", extraCost, reasonCode: null, note: null, expectedShoppers: expected, actualShoppers: actual, lossShoppers: expected - actual }, limits);
    const rows = [shopper("1", 1200, 1080, "62.40"), shopper("2", 1000, 1010, "0.00")];
    const columns = lossColumns("packing");
    expect(columns.find((c) => c.key === "loss")!.cell(rows[1])).toBe("-10 · check weight");
    expect(columns.find((c) => c.key === "cost")!.total!(rows)).toBe("62");
    expect(lossSummary("packing", rows)).toEqual([
      { label: "Loss cost", value: "Rs 62" }, { label: "Shopper loss %", value: "10.0%" }, { label: "Most-lost material", value: "Shopper" },
    ]);
  });
});

describe("summaries", () => {
  it("summarises batch loss per unit", () => {
    expect(lossSummary("batch", [batch("1", "500", "400"), batch("2", "500", "490")])).toEqual([
      { label: "Target", value: "1,000 KG" }, { label: "Actual", value: "890 KG" }, { label: "Loss", value: "110 KG (11.0%)" }, { label: "Loss cost", value: "Rs 33,127" },
    ]);
  });
  it("names the chemical with the highest loss cost", () => {
    const chem = (id: string, chemical: string, extraCost: string) => toChemicalRow({ ...run(id), useId: id, chemicalId: chemical, chemical, unit: "kg", formula: "50", used: "55", extraCost, reasonCode: "spill", note: null }, limits);
    expect(lossSummary("chemical", [chem("1", "Soda Ash", "575"), chem("2", "LABSA", "300"), chem("3", "LABSA", "400")])[2]).toEqual({ label: "Most-lost chemical", value: "LABSA" });
  });
  it("splits store loss by reason", () => {
    const store = (id: string, reasonCode: string, value: string) => toStoreRow({ id, date: new Date("2026-10-18T05:00:00Z"), storeId: "w", store: "Floor", materialType: "chemical", chemicalId: "c", chemicalName: "Soda Ash", chemicalUnit: "kg", packagingId: null, packagingName: null, measuredInKg: null, lotPrice: "115", delta: "-2", value, reasonCode, note: null, by: "Ali" }, limits);
    expect(lossSummary("store", [store("1", "damaged", "-260"), store("2", "count_short", "-230")])).toEqual([
      { label: "Loss cost", value: "Rs 490" }, { label: "By reason", value: "Damaged Rs 260 · Count short Rs 230" },
    ]);
  });
});

describe("filters, strip and paging", () => {
  const rows = [batch("1", "500", "400"), batch("2", "500", "490", "kg", "leak")];
  it("offers only values present in the rows and filters by them", () => {
    const options = lossFilterOptions("batch", rows);
    expect(options.map((o) => o.label)).toEqual(["Product", "Formula", "Reason"]);
    expect(options[2].options).toEqual([{ value: "leak", label: "Leak" }, { value: "spill", label: "Spill" }]);
    expect(filterLossRows("batch", rows, { reason: "leak" }, false).map((r) => r.id)).toEqual(["2"]);
    expect(filterLossRows("batch", rows, {}, true).map((r) => r.id)).toEqual(["1"]); // only 20.0% is above 10%
    expect(lossFiltersText("batch", { reason: "leak" }, options)).toBe("Product All · Formula All · Reason Leak");
  });
  it("totals the strip across tabs", () => {
    // 30,115.00 + 3,011.50
    expect(lossStripTotals({ batch: rows, chemical: [], powder: [], packing: [], store: [] })).toEqual({ batch: "33126.50", chemical: "0.00", powder: "0.00", packing: "0.00", store: "0.00", total: "33126.50" });
  });
  it("pages 25 rows at a time and clamps the page", () => {
    const many = Array.from({ length: 30 }, (_, i) => batch(String(i), "500", "400"));
    expect(pageLossRows(many, 2)).toMatchObject({ page: 2, pageCount: 2 });
    expect(pageLossRows(many, 2).rows).toHaveLength(5);
    expect(pageLossRows(many, 9).page).toBe(2);
    expect(pageLossRows([], 1)).toEqual({ rows: [], page: 1, pageCount: 1 });
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/lib/production/loss-display.test.ts`
Expected: FAIL. The module `./loss-display` cannot be found.

- [ ] **Step 3: Write the module**

```ts
// src/lib/production/loss-display.ts
import Big from "big.js";
import { formatIndianStyle, formatNumber } from "@/lib/currency-format";
import { formatReportDate } from "@/lib/report-dates";
import {
  LOSS_PAGE_SIZE, LOSS_TABS, lossPercent, sumMoney, weightedShopperPercent,
  type LossRow, type LossRowOf, type LossTab,
} from "./loss-report";

export const formatLossMoney = (value: Big.BigSource) => formatIndianStyle(new Big(value).round(0, Big.roundHalfUp).toNumber());
const rupees = (value: Big.BigSource) => `Rs ${formatLossMoney(value)}`;
const UNIT_LABELS: Record<string, string> = { kg: "KG", liters: "L", l: "L", pcs: "pcs" };
export const unitLabel = (unit: string) => UNIT_LABELS[unit.toLowerCase()] ?? unit;
export const formatLossQuantity = (value: Big.BigSource, unit: string) => `${formatNumber(new Big(value).toNumber())} ${unitLabel(unit)}`.trim();
export const formatLossRange = (dateFrom: string, dateTo: string) => `${formatReportDate(dateFrom)} – ${formatReportDate(dateTo)}`;
const percentText = (percent: string | null) => (percent === null ? "—" : `${percent}%`);

// Sums a quantity per unit: "4,500 KG · 200 L".
function byUnit<R>(rows: R[], unit: (row: R) => string, value: (row: R) => Big.BigSource) {
  const sums = new Map<string, Big>();
  for (const row of rows) sums.set(unit(row), (sums.get(unit(row)) ?? new Big(0)).plus(value(row)));
  return sums;
}
const byUnitText = (sums: Map<string, Big>) => [...sums].map(([unit, sum]) => formatLossQuantity(sum, unit)).join(" · ");
const sumCost = (rows: { cost: string }[]) => sumMoney(rows.map((row) => row.cost));
// Loss % of a total only when every row shares one unit.
function totalPercent(loss: Map<string, Big>, base: Map<string, Big>) {
  if (loss.size !== 1) return "";
  const [unit] = [...loss.keys()];
  return percentText(lossPercent(loss.get(unit)!, base.get(unit) ?? 0));
}
function mostLost<R extends { cost: string }>(rows: R[], name: (row: R) => string) {
  const totals = new Map<string, Big>();
  for (const row of rows) totals.set(name(row), (totals.get(name(row)) ?? new Big(0)).plus(row.cost));
  let best: [string, Big] | null = null;
  for (const entry of totals) if (entry[1].gt(0) && (!best || entry[1].gt(best[1]))) best = entry;
  return best?.[0] ?? "—";
}

export type LossColumn = { key: string; label: string; numeric?: boolean; percent?: boolean; cell: (row: LossRow) => string; total?: (rows: LossRow[]) => string };
type Column<R> = { key: string; label: string; numeric?: boolean; percent?: boolean; cell: (row: R) => string; total?: (rows: R[]) => string };

const dateColumn = <R extends LossRow>(): Column<R> => ({ key: "date", label: "Date", cell: (row) => formatReportDate(row.date), total: () => "Total" });
const batchColumn = <R extends { batchId: string }>(): Column<R> => ({ key: "batch", label: "Batch", cell: (row) => row.batchId });
const productColumn = <R extends { product: string }>(): Column<R> => ({ key: "product", label: "Product", cell: (row) => row.product });
const costColumn = <R extends { cost: string }>(): Column<R> => ({ key: "cost", label: "Loss Rs", numeric: true, cell: (row) => formatLossMoney(row.cost), total: (rows) => formatLossMoney(sumCost(rows)) });
const reasonColumn = <R extends LossRow>(): Column<R> => ({ key: "reason", label: "Reason", cell: (row) => row.reason });

const BATCH: Column<LossRowOf<"batch">>[] = [
  dateColumn(), batchColumn(), productColumn(),
  { key: "target", label: "Target", numeric: true, cell: (r) => formatLossQuantity(r.target, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.target)) },
  { key: "actual", label: "Actual", numeric: true, cell: (r) => formatLossQuantity(r.actual, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.actual)) },
  { key: "loss", label: "Loss", numeric: true, cell: (r) => formatLossQuantity(r.loss, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.loss)) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent), total: (rows) => totalPercent(byUnit(rows, (r) => r.unit, (r) => r.loss), byUnit(rows, (r) => r.unit, (r) => r.target)) },
  costColumn(), reasonColumn(),
];
const CHEMICAL: Column<LossRowOf<"chemical">>[] = [
  dateColumn(), batchColumn(),
  { key: "chemical", label: "Chemical", cell: (r) => r.chemical },
  { key: "formula", label: "Formula", numeric: true, cell: (r) => formatLossQuantity(r.formula, r.unit) },
  { key: "used", label: "Used", numeric: true, cell: (r) => formatLossQuantity(r.used, r.unit) },
  { key: "extra", label: "Extra", numeric: true, cell: (r) => formatLossQuantity(r.extra, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.extra)) },
  { key: "percent", label: "Extra %", numeric: true, percent: true, cell: (r) => percentText(r.percent) },
  costColumn(), reasonColumn(),
];
const POWDER: Column<LossRowOf<"powder">>[] = [
  dateColumn(), batchColumn(), productColumn(),
  { key: "given", label: "Given to packing", numeric: true, cell: (r) => formatLossQuantity(r.given, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.given)) },
  { key: "lost", label: "Lost", numeric: true, cell: (r) => formatLossQuantity(r.lost, r.unit), total: (rows) => byUnitText(byUnit(rows, (r) => r.unit, (r) => r.lost)) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent), total: (rows) => totalPercent(byUnit(rows, (r) => r.unit, (r) => r.lost), byUnit(rows, (r) => r.unit, (r) => r.given)) },
  costColumn(), reasonColumn(),
];
const PACKING: Column<LossRowOf<"packing">>[] = [
  dateColumn(), batchColumn(),
  { key: "material", label: "Material", cell: (r) => r.material },
  { key: "needed", label: "Needed / expected", numeric: true, cell: (r) => (r.shopper ? `${formatNumber(Number(r.needed))} expected` : formatNumber(Number(r.needed))) },
  { key: "used", label: "Used / actual", numeric: true, cell: (r) => (r.shopper ? `${formatNumber(Number(r.used))} made` : formatNumber(Number(r.used))) },
  { key: "loss", label: "Loss", numeric: true, cell: (r) => (r.checkWeight ? `${formatNumber(Number(r.loss))} · check weight` : formatNumber(Number(r.loss))) },
  { key: "percent", label: "Loss %", numeric: true, percent: true, cell: (r) => percentText(r.percent) },
  costColumn(), reasonColumn(),
];
const STORE: Column<LossRowOf<"store">>[] = [
  dateColumn(),
  { key: "store", label: "Store", cell: (r) => r.store },
  { key: "material", label: "Material", cell: (r) => r.material },
  { key: "lot", label: "Lot", cell: (r) => `Rs ${formatNumber(Number(r.lotPrice))}/${unitLabel(r.unit)}` },
  { key: "quantity", label: "Quantity", numeric: true, cell: (r) => formatLossQuantity(r.quantity, r.unit) },
  costColumn(), reasonColumn(),
  { key: "by", label: "By", cell: (r) => r.by },
];
const COLUMNS = { batch: BATCH, chemical: CHEMICAL, powder: POWDER, packing: PACKING, store: STORE };
export function lossColumns(tab: LossTab): LossColumn[] {
  return COLUMNS[tab] as unknown as LossColumn[];
}

export type LossSummaryItem = { label: string; value: string };
export function lossSummary(tab: LossTab, rows: LossRow[]): LossSummaryItem[] {
  const cost = { label: "Loss cost", value: rupees(sumCost(rows)) };
  if (tab === "batch") {
    const r = rows as LossRowOf<"batch">[];
    const target = byUnit(r, (x) => x.unit, (x) => x.target);
    const loss = byUnit(r, (x) => x.unit, (x) => x.loss);
    const lossText = [...loss].map(([unit, sum]) => `${formatLossQuantity(sum, unit)} (${percentText(lossPercent(sum, target.get(unit) ?? 0))})`).join(" · ");
    return [
      { label: "Target", value: byUnitText(target) || "—" }, { label: "Actual", value: byUnitText(byUnit(r, (x) => x.unit, (x) => x.actual)) || "—" },
      { label: "Loss", value: lossText || "—" }, cost,
    ];
  }
  if (tab === "chemical") {
    const r = rows as LossRowOf<"chemical">[];
    return [{ label: "Extra used", value: byUnitText(byUnit(r, (x) => x.unit, (x) => x.extra)) || "—" }, cost, { label: "Most-lost chemical", value: mostLost(r, (x) => x.chemical) }];
  }
  if (tab === "powder") {
    const r = rows as LossRowOf<"powder">[];
    const given = byUnit(r, (x) => x.unit, (x) => x.given);
    const lost = byUnit(r, (x) => x.unit, (x) => x.lost);
    const percent = [...lost].map(([unit, sum]) => percentText(lossPercent(sum, given.get(unit) ?? 0))).join(" · ");
    return [{ label: "Given to packing", value: byUnitText(given) || "—" }, { label: "Lost", value: byUnitText(lost) || "—" }, { label: "Loss %", value: percent || "—" }, cost];
  }
  if (tab === "packing") {
    const r = rows as LossRowOf<"packing">[];
    const shoppers = r.filter((x) => x.shopper).map((x) => ({ expected: Number(x.needed), loss: Number(x.loss), checkWeight: x.checkWeight }));
    // The material name without the " (1.20 KG)" suffix shoppers carry.
    const name = (x: LossRowOf<"packing">) => (x.shopper ? x.material.replace(/ \([\d.]+ KG\)$/, "") : x.material);
    return [cost, { label: "Shopper loss %", value: percentText(weightedShopperPercent(shoppers)) }, { label: "Most-lost material", value: mostLost(r, name) }];
  }
  const r = rows as LossRowOf<"store">[];
  const byReason = new Map<string, Big>();
  for (const x of r) byReason.set(x.reasonName, (byReason.get(x.reasonName) ?? new Big(0)).plus(x.cost));
  return [cost, { label: "By reason", value: [...byReason].map(([reason, sum]) => `${reason} ${rupees(sum)}`).join(" · ") || "—" }];
}

export type LossFilterKey = "productId" | "formulaId" | "chemicalId" | "materialId" | "storeId" | "reason";
export type LossFilters = Partial<Record<LossFilterKey, string>>;
export const LOSS_FILTER_KEYS: Record<LossTab, LossFilterKey[]> = {
  batch: ["productId", "formulaId", "reason"], chemical: ["chemicalId", "productId", "reason"], powder: ["productId", "reason"],
  packing: ["materialId", "productId", "reason"], store: ["storeId", "materialId", "reason"],
};
const FILTER_LABELS: Record<LossFilterKey, string> = { productId: "Product", formulaId: "Formula", chemicalId: "Chemical", materialId: "Material", storeId: "Store", reason: "Reason" };
export type LossFilterOption = { key: LossFilterKey; label: string; options: { value: string; label: string }[] };

function filterValue(row: LossRow, key: LossFilterKey): { value: string; label: string } | null {
  if (key === "reason") return row.reasonCode ? { value: row.reasonCode, label: row.reasonName } : null;
  if (key === "productId") return "productId" in row ? { value: row.productId, label: row.product } : null;
  if (key === "formulaId") return row.tab === "batch" ? { value: row.formulaId, label: row.formula } : null;
  if (key === "chemicalId") return row.tab === "chemical" ? { value: row.chemicalId, label: row.chemical } : null;
  if (key === "storeId") return row.tab === "store" ? { value: row.storeId, label: row.store } : null;
  if (row.tab === "packing") return { value: row.materialId, label: row.material.replace(/ \([\d.]+ KG\)$/, "") };
  return row.tab === "store" ? { value: row.materialId, label: row.material } : null;
}

export function lossFilterOptions(tab: LossTab, rows: LossRow[]): LossFilterOption[] {
  return LOSS_FILTER_KEYS[tab].map((key) => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const found = filterValue(row, key);
      if (found) seen.set(found.value, found.label);
    }
    const options = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    return { key, label: FILTER_LABELS[key], options };
  });
}

export function filterLossRows(tab: LossTab, rows: LossRow[], filters: LossFilters, onlyOverLimit: boolean) {
  return rows.filter((row) =>
    LOSS_FILTER_KEYS[tab].every((key) => !filters[key] || filterValue(row, key)?.value === filters[key]) && (!onlyOverLimit || row.over));
}

export function lossFiltersText(tab: LossTab, filters: LossFilters, options: LossFilterOption[]) {
  return LOSS_FILTER_KEYS[tab].map((key) => {
    const option = options.find((o) => o.key === key);
    const chosen = filters[key] ? option?.options.find((o) => o.value === filters[key])?.label : undefined;
    return `${FILTER_LABELS[key]} ${chosen ?? "All"}`;
  }).join(" · ");
}

export function lossStripTotals(rowsByTab: Record<LossTab, LossRow[]>) {
  const totals = Object.fromEntries(LOSS_TABS.map((tab) => [tab, sumCost(rowsByTab[tab])])) as Record<LossTab, string>;
  return { ...totals, total: sumMoney(Object.values(totals)) };
}

export function pageLossRows(rows: LossRow[], page: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / LOSS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  return { rows: rows.slice((current - 1) * LOSS_PAGE_SIZE, current * LOSS_PAGE_SIZE), page: current, pageCount };
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `bun run test -- src/lib/production/loss-display.test.ts src/lib/production/loss-report.test.ts`
Expected: PASS. If `formatNumber` shows "2.5" instead of "2.50", check `formatNumber`'s current behaviour in `src/lib/currency-format.ts` and fix the test's expected value, not the helper.

- [ ] **Step 5: Commit**

```bash
git add src/lib/production/loss-display.ts src/lib/production/loss-display.test.ts
git commit -m "feat(reports): add loss report columns, summaries and filters"
```

---

### Task 4: Loss queries and server functions

**Files:**
- Create: `src/server-functions/reports/production-loss-queries.server.ts`
- Create: `src/server-functions/reports/production-loss-fn.ts`
- Test: `src/__tests__/production-loss-server.test.ts` (source inspection)
- Test: `src/__tests__/integration/production-loss.test.ts` (real database)

**Interfaces:**
- Consumes: Tasks 1–3. `reportDateBounds` from `@/lib/report-dates`. The schema tables `mixingRuns`, `formulas`, `mixingMaterialUse`, `batchPackingReceipts`, `packingMaterialUse` and `productionLossLimits` (production schema), `products`, `chemicals`, `packagingMaterials`, `warehouses`, `materialAdjustments` and `materialLots` (inventory schema), and `user` from `@/db`.
- Produces:
  - `loadLossRows(reader, tab, bounds, limits): Promise<LossRow[]>` and `readLossLimits(reader): Promise<{ limits: LossLimits; updatedAt: string | null; updatedBy: string | null }>` from `production-loss-queries.server.ts`. `bounds` is `{ fromDate: Date; toDate: Date }`.
  - `getProductionLossFn({ data: { tab, dateFrom, dateTo, filters, onlyOverLimit, page } })`, which returns `{ strip, limits, limitsUpdatedAt, limitsUpdatedBy, options, summary, totals, columns, rows, total, page, pageCount }`. `columns` is `{ key, label, numeric, percent }[]` and `totals` is `string[]` in column order.
  - `getProductionLossPrintFn({ data: { tab, dateFrom, dateTo, filters, onlyOverLimit } })`, which returns `LossPrintData` (exported type: `{ tab, dateFrom, dateTo, filtersText, summary, columns, rows: { over: boolean; cells: string[] }[], totals }`). It throws `TOO_MANY_TO_PRINT` above 2,000 rows.
  - `updateLossLimitsFn({ data: LossLimits })`.

- [ ] **Step 1: Write the failing source-inspection test**

```ts
// src/__tests__/production-loss-server.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = readFileSync("src/server-functions/reports/production-loss-fn.ts", "utf8");
const queries = readFileSync("src/server-functions/reports/production-loss-queries.server.ts", "utf8");

describe("production loss server functions", () => {
  it("guards reads with the view permission and limits with the manage permission", () => {
    expect(fn.match(/middleware\(\[requireLossReportViewMiddleware\]\)/g)).toHaveLength(2);
    expect(fn).toContain("middleware([requireLossLimitsManageMiddleware])");
    expect(fn).not.toContain("requireReportsViewMiddleware");
  });
  it("filters every tab by the report date range", () => {
    expect(fn).toContain("reportDateBounds(");
    for (const column of ["mixingRuns.actualCompletionDate", "batchPackingReceipts.packedAt", "materialAdjustments.createdAt"])
      expect(queries).toContain(`between(${column}, bounds.fromDate, bounds.toDate)`);
  });
  it("leaves failed batches out and keeps only stock-reducing loss reasons", () => {
    expect(queries.match(/eq\(mixingRuns\.status, "completed"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(queries).toContain("lt(materialAdjustments.delta, \"0\")");
    expect(queries).toContain("inArray(materialAdjustments.reason, [...STORE_LOSS_REASONS])");
  });
  it("blocks printing more than the row cap", () => {
    expect(fn).toContain("LOSS_PRINT_MAX_ROWS");
    expect(fn).toContain("throw new Error(TOO_MANY_TO_PRINT)");
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/__tests__/production-loss-server.test.ts`
Expected: FAIL with ENOENT, because the files don't exist yet.

- [ ] **Step 3: Write the queries**

```ts
// src/server-functions/reports/production-loss-queries.server.ts
import { and, between, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db";
import { chemicals, materialAdjustments, materialLots, packagingMaterials, products, warehouses } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, formulas, mixingMaterialUse, mixingRuns, packingMaterialUse, PRODUCTION_LOSS_LIMITS_ID, productionLossLimits } from "@/db/schemas/production-schema";
import {
  DEFAULT_LOSS_LIMITS, STORE_LOSS_REASONS, toBatchRow, toChemicalRow, toPackingRow, toPowderRow, toStoreRow,
  type LossLimits, type LossRow, type LossTab,
} from "@/lib/production/loss-report";

type Reader = Pick<typeof db, "select">;
export type LossBounds = { fromDate: Date; toDate: Date };

const runColumns = {
  runId: mixingRuns.id, batchId: mixingRuns.batchId, productId: products.id, product: products.name,
};

async function batchRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: mixingRuns.actualCompletionDate, target: mixingRuns.targetBulkQuantity, actual: mixingRuns.actualBulkProduced,
    unit: mixingRuns.bulkUnit, chemicalCost: mixingRuns.totalChemicalCost, reasonCode: mixingRuns.shortfallReasonCode, note: mixingRuns.shortfallReason,
    formulaId: formulas.id, formula: formulas.name,
  }).from(mixingRuns)
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(
      eq(mixingRuns.status, "completed"),
      sql`${mixingRuns.actualBulkProduced} < ${mixingRuns.targetBulkQuantity}`,
      between(mixingRuns.actualCompletionDate, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(mixingRuns.actualCompletionDate), desc(mixingRuns.batchId));
  return rows.map((row) => toBatchRow({ ...row, date: row.date!, actual: row.actual ?? "0", chemicalCost: row.chemicalCost ?? "0" }, limits));
}

async function chemicalRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: mixingRuns.actualCompletionDate, useId: mixingMaterialUse.id, chemicalId: chemicals.id, chemical: chemicals.name, unit: chemicals.unit,
    formula: mixingMaterialUse.formulaQuantity, used: mixingMaterialUse.usedQuantity, extraCost: mixingMaterialUse.extraCost,
    reasonCode: mixingMaterialUse.reason, note: mixingMaterialUse.note,
  }).from(mixingMaterialUse)
    .innerJoin(mixingRuns, eq(mixingRuns.id, mixingMaterialUse.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .innerJoin(chemicals, eq(chemicals.id, mixingMaterialUse.chemicalId))
    .where(and(
      eq(mixingRuns.status, "completed"),
      gt(mixingMaterialUse.extraQuantity, "0"),
      between(mixingRuns.actualCompletionDate, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(mixingRuns.actualCompletionDate), desc(mixingRuns.batchId), chemicals.name);
  return rows.map((row) => toChemicalRow({ ...row, date: row.date!, unit: row.unit ?? "kg" }, limits));
}

async function powderRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: batchPackingReceipts.packedAt, receiptId: batchPackingReceipts.id, unit: mixingRuns.bulkUnit,
    packed: batchPackingReceipts.bulkConsumed, lost: batchPackingReceipts.lossBulk, costPerUnit: mixingRuns.chemicalCostPerUnit,
    reasonCode: batchPackingReceipts.lossReasonCode, note: batchPackingReceipts.lossReason,
  }).from(batchPackingReceipts)
    .innerJoin(mixingRuns, eq(mixingRuns.id, batchPackingReceipts.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(gt(batchPackingReceipts.lossBulk, "0"), between(batchPackingReceipts.packedAt, bounds.fromDate, bounds.toDate)))
    .orderBy(desc(batchPackingReceipts.packedAt), desc(batchPackingReceipts.id));
  return rows.map((row) => toPowderRow({ ...row, costPerUnit: row.costPerUnit ?? "0" }, limits));
}

async function packingRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    ...runColumns, date: batchPackingReceipts.packedAt, useId: packingMaterialUse.id, materialId: packagingMaterials.id, material: packagingMaterials.name,
    measuredInKg: packingMaterialUse.measuredInKg, needed: packingMaterialUse.neededQuantity, used: packingMaterialUse.usedQuantity,
    extraQuantity: packingMaterialUse.extraQuantity, extraCost: packingMaterialUse.extraCost, reasonCode: packingMaterialUse.reason, note: packingMaterialUse.note,
    expectedShoppers: packingMaterialUse.expectedShoppers, actualShoppers: packingMaterialUse.actualShoppers, lossShoppers: packingMaterialUse.lossShoppers,
  }).from(packingMaterialUse)
    .innerJoin(batchPackingReceipts, eq(batchPackingReceipts.id, packingMaterialUse.receiptId))
    .innerJoin(mixingRuns, eq(mixingRuns.id, batchPackingReceipts.mixingRunId))
    .innerJoin(formulas, eq(formulas.id, mixingRuns.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .innerJoin(packagingMaterials, eq(packagingMaterials.id, packingMaterialUse.materialId))
    .where(and(
      or(eq(packingMaterialUse.measuredInKg, true), gt(packingMaterialUse.extraQuantity, "0")),
      between(batchPackingReceipts.packedAt, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(batchPackingReceipts.packedAt), desc(batchPackingReceipts.id), packagingMaterials.name);
  return rows.map((row) => toPackingRow(row, limits));
}

async function storeRows(reader: Reader, bounds: LossBounds, limits: LossLimits) {
  const rows = await reader.select({
    id: materialAdjustments.id, date: materialAdjustments.createdAt, storeId: warehouses.id, store: warehouses.name,
    materialType: materialAdjustments.materialType, chemicalId: chemicals.id, chemicalName: chemicals.name, chemicalUnit: chemicals.unit,
    packagingId: packagingMaterials.id, packagingName: packagingMaterials.name, measuredInKg: packagingMaterials.measuredInKg,
    lotPrice: materialLots.unitPrice, delta: materialAdjustments.delta, value: materialAdjustments.value,
    reasonCode: materialAdjustments.reason, note: materialAdjustments.note, by: user.name,
  }).from(materialAdjustments)
    .innerJoin(warehouses, eq(warehouses.id, materialAdjustments.warehouseId))
    .innerJoin(materialLots, eq(materialLots.id, materialAdjustments.lotId))
    .innerJoin(user, eq(user.id, materialAdjustments.performedById))
    .leftJoin(chemicals, eq(chemicals.id, materialAdjustments.chemicalId))
    .leftJoin(packagingMaterials, eq(packagingMaterials.id, materialAdjustments.packagingMaterialId))
    .where(and(
      lt(materialAdjustments.delta, "0"),
      inArray(materialAdjustments.reason, [...STORE_LOSS_REASONS]),
      between(materialAdjustments.createdAt, bounds.fromDate, bounds.toDate),
    ))
    .orderBy(desc(materialAdjustments.createdAt), desc(materialAdjustments.id));
  return rows.map((row) => toStoreRow(row, limits));
}

const LOADERS: Record<LossTab, (reader: Reader, bounds: LossBounds, limits: LossLimits) => Promise<LossRow[]>> = {
  batch: batchRows, chemical: chemicalRows, powder: powderRows, packing: packingRows, store: storeRows,
};

export function loadLossRows(reader: Reader, tab: LossTab, bounds: LossBounds, limits: LossLimits) {
  return LOADERS[tab](reader, bounds, limits);
}

export async function readLossLimits(reader: Reader) {
  const [row] = await reader.select({
    batch: productionLossLimits.batch, chemical: productionLossLimits.chemical, powder: productionLossLimits.powder,
    shopper: productionLossLimits.shopper, otherPacking: productionLossLimits.otherPacking, updatedAt: productionLossLimits.updatedAt, updatedBy: user.name,
  }).from(productionLossLimits)
    .leftJoin(user, eq(user.id, productionLossLimits.updatedBy))
    .where(eq(productionLossLimits.id, PRODUCTION_LOSS_LIMITS_ID));
  if (!row) return { limits: DEFAULT_LOSS_LIMITS, updatedAt: null, updatedBy: null };
  const { updatedAt, updatedBy, ...limits } = row;
  return { limits, updatedAt: updatedAt.toISOString(), updatedBy: updatedBy ?? null };
}
```

- [ ] **Step 4: Write the server functions**

```ts
// src/server-functions/reports/production-loss-fn.ts
import Big from "big.js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { PRODUCTION_LOSS_LIMITS_ID, productionLossLimits } from "@/db/schemas/production-schema";
import { requireLossLimitsManageMiddleware, requireLossReportViewMiddleware } from "@/lib/middlewares";
import { reportDateBounds } from "@/lib/report-dates";
import { LOSS_PRINT_MAX_ROWS, LOSS_TABS, TOO_MANY_TO_PRINT, type LossTab } from "@/lib/production/loss-report";
import {
  filterLossRows, lossColumns, lossFilterOptions, lossFiltersText, lossStripTotals, lossSummary, pageLossRows, type LossSummaryItem,
} from "@/lib/production/loss-display";
import { loadLossRows, readLossLimits } from "./production-loss-queries.server";

const filtersSchema = z.object({
  productId: z.string().optional(), formulaId: z.string().optional(), chemicalId: z.string().optional(),
  materialId: z.string().optional(), storeId: z.string().optional(), reason: z.string().optional(),
}).default({});
const viewSchema = z.object({
  tab: z.enum(LOSS_TABS), dateFrom: z.string(), dateTo: z.string(), filters: filtersSchema, onlyOverLimit: z.boolean().default(false),
});

function bounds(input: { dateFrom: string; dateTo: string }) {
  const { fromDate, toDate } = reportDateBounds(input);
  if (!fromDate || !toDate) throw new Error("Pick a date range");
  return { fromDate, toDate };
}

const columnHeads = (tab: LossTab) => lossColumns(tab).map(({ key, label, numeric, percent }) => ({ key, label, numeric: !!numeric, percent: !!percent }));
const totalsRow = (tab: LossTab, rows: Parameters<typeof lossSummary>[1]) => lossColumns(tab).map((column) => column.total?.(rows) ?? "");

export const getProductionLossFn = createServerFn()
  .middleware([requireLossReportViewMiddleware])
  .inputValidator(viewSchema.extend({ page: z.number().int().positive().default(1) }))
  .handler(async ({ data }) => {
    const range = bounds(data);
    const { limits, updatedAt, updatedBy } = await readLossLimits(db);
    const loaded = await Promise.all(LOSS_TABS.map((tab) => loadLossRows(db, tab, range, limits)));
    const byTab = Object.fromEntries(LOSS_TABS.map((tab, i) => [tab, loaded[i]])) as Record<LossTab, (typeof loaded)[number]>;
    const tabRows = byTab[data.tab];
    const filtered = filterLossRows(data.tab, tabRows, data.filters, data.onlyOverLimit);
    const paged = pageLossRows(filtered, data.page);
    return {
      strip: lossStripTotals(byTab), limits, limitsUpdatedAt: updatedAt, limitsUpdatedBy: updatedBy,
      options: lossFilterOptions(data.tab, tabRows), summary: lossSummary(data.tab, filtered), totals: totalsRow(data.tab, filtered),
      columns: columnHeads(data.tab), rows: paged.rows, total: filtered.length, page: paged.page, pageCount: paged.pageCount,
    };
  });

export type LossPrintData = {
  tab: LossTab; dateFrom: string; dateTo: string; filtersText: string; summary: LossSummaryItem[];
  columns: ReturnType<typeof columnHeads>; rows: { over: boolean; cells: string[] }[]; totals: string[];
};

export const getProductionLossPrintFn = createServerFn()
  .middleware([requireLossReportViewMiddleware])
  .inputValidator(viewSchema)
  .handler(async ({ data }): Promise<LossPrintData> => {
    const { limits } = await readLossLimits(db);
    const tabRows = await loadLossRows(db, data.tab, bounds(data), limits);
    const filtered = filterLossRows(data.tab, tabRows, data.filters, data.onlyOverLimit);
    if (filtered.length > LOSS_PRINT_MAX_ROWS) throw new Error(TOO_MANY_TO_PRINT);
    const columns = lossColumns(data.tab);
    return {
      tab: data.tab, dateFrom: data.dateFrom, dateTo: data.dateTo,
      filtersText: lossFiltersText(data.tab, data.filters, lossFilterOptions(data.tab, tabRows)),
      summary: lossSummary(data.tab, filtered), columns: columnHeads(data.tab),
      rows: filtered.map((row) => ({ over: row.over, cells: columns.map((column) => column.cell(row)) })),
      totals: totalsRow(data.tab, filtered),
    };
  });

const limitValue = z.string().trim()
  .regex(/^\d{1,3}(?:\.\d)?$/, "Use a number with up to one decimal place")
  .refine((value) => new Big(value).lte(100), "Use a limit from 0 to 100");

export const updateLossLimitsFn = createServerFn()
  .middleware([requireLossLimitsManageMiddleware])
  .inputValidator(z.object({ batch: limitValue, chemical: limitValue, powder: limitValue, shopper: limitValue, otherPacking: limitValue }))
  .handler(async ({ data, context }) => {
    const values = { ...data, updatedBy: context.session.user.id };
    await db.insert(productionLossLimits).values({ id: PRODUCTION_LOSS_LIMITS_ID, ...values })
      .onConflictDoUpdate({ target: productionLossLimits.id, set: { ...values, updatedAt: new Date() } });
    return { success: true as const };
  });
```

- [ ] **Step 5: Run the source test and the type check**

Run: `bun run test -- src/__tests__/production-loss-server.test.ts && bun run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 6: Write the integration test**

```ts
// src/__tests__/integration/production-loss.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { user, products, warehouses, chemicals, packagingMaterials } from "@/db";
import { materialAdjustments } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, formulas, mixingMaterialUse, mixingRuns, packingMaterialUse, productionLossLimits } from "@/db/schemas/production-schema";
import { findOrCreateLot, type Tx } from "@/lib/inventory/material-lots.server";
import { DEFAULT_LOSS_LIMITS, type LossRow } from "@/lib/production/loss-report";
import { reportDateBounds } from "@/lib/report-dates";
import { loadLossRows, readLossLimits } from "@/server-functions/reports/production-loss-queries.server";
import { withRollback } from "./with-rollback";

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };
const october = reportDateBounds({ dateFrom: "2026-10-01", dateTo: "2026-10-31" }) as { fromDate: Date; toDate: Date };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Ali", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [product] = await tx.insert(products).values({ name: `${id}-surf` }).returning();
  const [formula] = await tx.insert(formulas).values({ productId: product.id, name: id, batchSize: "500", batchUnit: "kg" }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  const [shopper] = await tx.insert(packagingMaterials).values({ name: `${id}-shopper`, measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520" }).returning();
  const [cap] = await tx.insert(packagingMaterials).values({ name: `${id}-cap`, type: "extra", costPerUnit: "2" }).returning();
  const [carton] = await tx.insert(packagingMaterials).values({ name: `${id}-carton`, type: "master", costPerUnit: "40" }).returning();
  const run = async (suffix: string, values: Partial<typeof mixingRuns.$inferInsert>) => (await tx.insert(mixingRuns).values({
    batchId: `${id}-${suffix}`, formulaId: formula.id, warehouseId: floor.id, operatorId: actor.id, targetBulkQuantity: "500", bulkUnit: "kg", ...values,
  }).returning())[0];
  const short = await run("short", { status: "completed", actualBulkProduced: "400", totalChemicalCost: "150575", chemicalCostPerUnit: "376.4375", shortfallQuantity: "100", shortfallReasonCode: "spill", shortfallReason: "mixer seal", actualCompletionDate: new Date("2026-10-12T06:00:00Z") });
  await run("failed", { status: "failed", actualBulkProduced: "0", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-10-12T07:00:00Z") });
  await run("full", { status: "completed", actualBulkProduced: "500", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-10-12T08:00:00Z") });
  await run("september", { status: "completed", actualBulkProduced: "300", totalChemicalCost: "150575", actualCompletionDate: new Date("2026-09-12T06:00:00Z") });
  await tx.insert(mixingMaterialUse).values([
    { mixingRunId: short.id, chemicalId: soda.id, formulaQuantity: "50", usedQuantity: "55", extraQuantity: "5", extraCost: "575.00", reason: "spill" },
  ]);
  const [receipt] = await tx.insert(batchPackingReceipts).values({
    mixingRunId: short.id, requestId: id, requestPayload: "{}", actorId: actor.id, packedAt: new Date("2026-10-14T06:00:00Z"),
    bulkConsumed: "395", lossBulk: "5", lossReasonCode: "stuck_in_machine", totalPacks: 1080, costAudit: { chemicalCost: "0", lossCostPolicy: "test" },
  }).returning();
  await tx.insert(packingMaterialUse).values([
    { receiptId: receipt.id, materialId: shopper.id, measuredInKg: true, neededQuantity: "1080", usedQuantity: "1.2", extraCost: "62.40", totalCost: "624.00", shopperWeightGrams: "1.000", expectedShoppers: 1200, actualShoppers: 1080, lossShoppers: 120 },
    { receiptId: receipt.id, materialId: cap.id, measuredInKg: false, neededQuantity: "1080", usedQuantity: "1110", extraQuantity: "30", extraCost: "60.00", totalCost: "2220.00", reason: "broken" },
    { receiptId: receipt.id, materialId: carton.id, measuredInKg: false, neededQuantity: "45", usedQuantity: "45", totalCost: "1800.00" },
  ]);
  const lot = await findOrCreateLot(tx, { materialType: "chemical", materialId: soda.id }, "115");
  const adjustment = { warehouseId: floor.id, materialType: "chemical", chemicalId: soda.id, lotId: lot.id, unitPrice: "115.00", source: "manual", performedById: actor.id };
  await tx.insert(materialAdjustments).values([
    { ...adjustment, delta: "-2.000", value: "-230.00", reason: "count_short", createdAt: new Date("2026-10-18T05:00:00Z") },
    { ...adjustment, delta: "1.000", value: "115.00", reason: "count_over", createdAt: new Date("2026-10-18T05:00:00Z") },
    { ...adjustment, delta: "-1.000", value: "-115.00", reason: "damaged", createdAt: new Date("2026-09-18T05:00:00Z") },
  ]);
  return { id, short, floor };
}

// Other suites may leave rows, so only this seed's rows are checked.
const mine = (rows: LossRow[], id: string) => rows.filter((row) => ("batchId" in row ? row.batchId.startsWith(id) : row.tab === "store" && row.store === id));

describe.skipIf(!process.env.TEST_DATABASE_URL)("production loss queries", () => {
  it("reads each loss once, with its cost, and leaves out what is not loss", () => withRollback(async (tx) => {
    const f = await seed(tx);
    const load = async (tab: Parameters<typeof loadLossRows>[1]) => mine(await loadLossRows(tx, tab, october, DEFAULT_LOSS_LIMITS), f.id);

    const batch = await load("batch");
    expect(batch.map((r) => r.tab === "batch" && [r.batchId, r.loss, r.percent, r.cost, r.reason, r.over])).toEqual([[`${f.id}-short`, "100.000", "20.0", "30115.00", 'Spill · "mixer seal"', true]]);

    const chemical = await load("chemical");
    expect(chemical.map((r) => r.tab === "chemical" && [r.extra, r.percent, r.cost, r.reason])).toEqual([["5.000", "10.0", "575.00", "Spill"]]);

    const powder = await load("powder");
    expect(powder.map((r) => r.tab === "powder" && [r.given, r.percent, r.cost, r.reason])).toEqual([["400.000", "1.3", "1882.19", "Stuck in machine"]]);

    const packing = await load("packing");
    expect(packing.map((r) => r.tab === "packing" && [r.shopper, r.needed, r.used, r.loss, r.cost, r.reason]).sort()).toEqual([
      [false, "1080.000", "1110.000", "30.000", "60.00", "Broken"],
      [true, "1200", "1080", "120", "62.40", "Measured"],
    ].sort());

    const store = await load("store");
    expect(store.map((r) => r.tab === "store" && [r.quantity, r.cost, r.reason, r.by, r.lotPrice])).toEqual([["2.000", "230.00", "Count short", "Ali", "115.00"]]);
  }));

  it("uses saved limits and falls back to 10%", () => withRollback(async (tx) => {
    await tx.delete(productionLossLimits);
    expect((await readLossLimits(tx)).limits).toEqual(DEFAULT_LOSS_LIMITS);
    const f = await seed(tx);
    await tx.insert(productionLossLimits).values({ batch: "25.0", updatedBy: null });
    const { limits } = await readLossLimits(tx);
    expect(limits.batch).toBe("25.0");
    const [row] = mine(await loadLossRows(tx, "batch", october, limits), f.id);
    expect(row.over).toBe(false); // 20.0% is not above 25%
  }));
});
```

- [ ] **Step 7: Run the integration test**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/production-loss.test.ts`
Expected: PASS. Powder cost is 5 × 376.4375 = 1,882.19. `withRollback` rolls everything back.

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/reports/production-loss-queries.server.ts src/server-functions/reports/production-loss-fn.ts src/__tests__/production-loss-server.test.ts src/__tests__/integration/production-loss.test.ts
git commit -m "feat(reports): read production losses and save loss limits"
```

---

### Task 5: Print the open tab

**Files:**
- Create: `src/components/reports/production-loss/loss-print.ts`
- Test: `src/components/reports/production-loss/loss-print.test.ts`

**Interfaces:**
- Consumes: `LossPrintData` (Task 4, import it as a type only), `LOSS_TAB_LABELS` (Task 2) and `formatLossRange` (Task 3).
- Produces: `productionLossPrintHtml(data: LossPrintData, printedAt?: Date, origin?: string): string` and `printProductionLoss(data: LossPrintData): boolean`, which returns false when the browser blocks the pop-up.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/reports/production-loss/loss-print.test.ts
import { describe, expect, it } from "vitest";
import type { LossPrintData } from "@/server-functions/reports/production-loss-fn";
import { productionLossPrintHtml } from "./loss-print";

const data: LossPrintData = {
  tab: "batch", dateFrom: "2026-10-01", dateTo: "2026-10-29", filtersText: "Product All · Formula All · Reason All",
  summary: [{ label: "Loss cost", value: "Rs 33,115" }],
  columns: [
    { key: "date", label: "Date", numeric: false, percent: false },
    { key: "percent", label: "Loss %", numeric: true, percent: true },
    { key: "reason", label: "Reason", numeric: false, percent: false },
  ],
  rows: [
    { over: true, cells: ["12 Oct 2026", "20.0%", 'Spill · "<seal>"'] },
    { over: false, cells: ["13 Oct 2026", "2.0%", "Moisture loss"] },
  ],
  totals: ["Total", "8.0%", ""],
};
const html = productionLossPrintHtml(data, new Date("2026-10-29T10:40:00Z"), "https://erp.test");

describe("production loss print", () => {
  it("prints A4 landscape with repeating headers and unsplit rows", () => {
    expect(html).toContain("@page { size: A4 landscape;");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("tr { break-inside: avoid; }");
    expect(html).toContain("counter(page)");
  });
  it("has the title, range, filters, summary and logo", () => {
    expect(html).toContain("Production Loss Report · Batch loss");
    expect(html).toContain("01 Oct 2026 – 29 Oct 2026");
    expect(html).toContain("Filters: Product All · Formula All · Reason All");
    expect(html).toContain("Rs 33,115");
    expect(html).toContain('src="https://erp.test/company-logo.svg"');
  });
  it("escapes cell text", () => {
    expect(html).toContain("Spill · &quot;&lt;seal&gt;&quot;");
    expect(html).not.toContain("<seal>");
  });
  it("marks over-limit rows bold red with a triangle before the loss %", () => {
    expect(html).toMatch(/<tr class="over">[\s\S]*?<td class="num">▲20\.0%<\/td>/);
    expect(html).not.toContain("▲2.0%");
  });
  it("ends the table with a total row and has signature lines", () => {
    expect(html).toMatch(/<tfoot><tr class="total"><td>Total<\/td><td class="num">8\.0%<\/td><td><\/td><\/tr><\/tfoot>/);
    for (const text of ["Prepared by", "Approved by (name and signature)", "Date"]) expect(html).toContain(text);
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/components/reports/production-loss/loss-print.test.ts`
Expected: FAIL. The module `./loss-print` cannot be found.

- [ ] **Step 3: Write the print module**

```ts
// src/components/reports/production-loss/loss-print.ts
import type { LossPrintData } from "@/server-functions/reports/production-loss-fn";
import { LOSS_TAB_LABELS } from "@/lib/production/loss-report";
import { formatLossRange } from "@/lib/production/loss-display";

const COMPANY_NAME = "Muftah Chemical Pvt Ltd.";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Same look as the Production QC print, but landscape for the wide tables.
const PRINT_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4 landscape; margin: 12mm 12mm 16mm; @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 10px Arial, Helvetica, sans-serif; color: #6b7280; } }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; background: #fff; }
.sheet { display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 10px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.brand img { width: 44px; height: 44px; object-fit: contain; }
.doc { text-align: right; }
.doc h1 { font-size: 16px; }
.doc p { color: #4b5563; font-size: 11px; }
.filters { color: #374151; }
.summary { display: flex; flex-wrap: wrap; border: 1px solid #9ca3af; }
.summary div { padding: 6px 10px; border-right: 1px solid #9ca3af; }
.summary div:last-child { border-right: 0; }
.summary span { display: block; color: #4b5563; font-size: 10px; text-transform: uppercase; }
.summary b { font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
td, th { border: 1px solid #9ca3af; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #e5e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
.num { text-align: right; white-space: nowrap; }
tr.over td { color: #b91c1c; font-weight: 700; }
tr.total td { font-weight: 700; background: #f3f4f6; }
.signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 30px; break-inside: avoid; }
.sign { border-top: 1.5px solid #111827; padding-top: 6px; color: #4b5563; }
.foot { color: #6b7280; font-size: 10px; border-top: 1px solid #d1d5db; padding-top: 6px; }
`;

export function productionLossPrintHtml(data: LossPrintData, printedAt = new Date(), origin = window.location.origin) {
  const title = `Production Loss Report · ${LOSS_TAB_LABELS[data.tab]}`;
  const cellClass = (index: number) => (data.columns[index]?.numeric ? ' class="num"' : "");
  const head = data.columns.map((column, i) => `<th${cellClass(i)}>${escapeHtml(column.label)}</th>`).join("");
  const body = data.rows.map((row) => `<tr${row.over ? ' class="over"' : ""}>${row.cells.map((cell, i) =>
    `<td${cellClass(i)}>${row.over && data.columns[i]?.percent ? "▲" : ""}${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n");
  const totals = `<tr class="total">${data.totals.map((cell, i) => `<td${cellClass(i)}>${escapeHtml(cell)}</td>`).join("")}</tr>`;
  const summary = data.summary.map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`).join("");
  const printed = printedAt.toLocaleString("en-PK", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<main class="sheet">
  <header class="head">
    <div class="brand"><img src="${origin}/company-logo.svg" alt="" />${COMPANY_NAME}</div>
    <div class="doc">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(formatLossRange(data.dateFrom, data.dateTo))}</p>
    </div>
  </header>
  <p class="filters">Filters: ${escapeHtml(data.filtersText)}</p>
  <section class="summary">${summary}</section>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot>${totals}</tfoot>
  </table>
  <section class="signs">
    <div class="sign">Prepared by</div>
    <div class="sign">Approved by (name and signature)</div>
    <div class="sign">Date</div>
  </section>
  <footer class="foot">Printed ${escapeHtml(printed)}</footer>
</main>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;
}

export function printProductionLoss(data: LossPrintData) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.document.write(productionLossPrintHtml(data));
  printWindow.document.close();
  return true;
}
```

The `<tfoot>` row in the test has no newlines or spaces between cells. Keep it that way: `data.totals.map(...).join("")`.

- [ ] **Step 4: Run the test and check that it passes**

Run: `bun run test -- src/components/reports/production-loss/loss-print.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/production-loss/loss-print.ts src/components/reports/production-loss/loss-print.test.ts
git commit -m "feat(reports): print the production loss report on A4 landscape"
```

---

### Task 6: The Production Loss page

**Files:**
- Create: `src/components/reports/production-loss/loss-limits-dialog.tsx`
- Create: `src/components/reports/production-loss/production-loss-report.tsx`
- Create: `src/routes/_protected/reports/production-loss/index.tsx`
- Modify: `src/routes/_protected/reports/index.tsx`
- Test: `src/components/reports/production-loss/production-loss-report.behavior.test.tsx`

**Interfaces:**
- Consumes: `getProductionLossFn`, `getProductionLossPrintFn` and `updateLossLimitsFn` (Task 4). `printProductionLoss` (Task 5). `LOSS_TABS`, `LOSS_TAB_LABELS`, `LOSS_STRIP_LABELS`, `LOSS_LIMIT_KEYS`, `LOSS_LIMIT_LABELS`, `LossLimits`, `LossRowLink` and `LossTab` (Task 2). `lossColumns`, `formatLossMoney` and `LossFilters` (Task 3). `useViewerAccess` from `@/hooks/use-viewer-access`. `hasPermission` from `@/lib/rbac`. `currentReportMonth` and `datePickerKey` from `@/lib/report-dates`. `DatePickerWithRange` from `@/components/custom/date-range-picker`.
- Produces: `ProductionLossReport({ onOpenRow }: { onOpenRow: (link: LossRowLink) => void })` and `LossLimitsDialog({ open, onOpenChange, limits, updatedAt, updatedBy })`.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/reports/production-loss/production-loss-report.behavior.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: ["reports.loss.view"] as string[],
  view: vi.fn(),
  print: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("@/server-functions/reports/production-loss-fn", () => ({
  getProductionLossFn: mocks.view, getProductionLossPrintFn: mocks.print, updateLossLimitsFn: mocks.update,
}));
import { ProductionLossReport } from "./production-loss-report";

const limits = { batch: "10.0", chemical: "10.0", powder: "10.0", shopper: "10.0", otherPacking: "10.0" };
const row = { tab: "batch", id: "r1", date: "2026-10-12T06:00:00.000Z", batchId: "A0104", productId: "p", product: "Surf Powder", formulaId: "f", formula: "F", unit: "kg", target: "500", actual: "400", loss: "100.000", percent: "20.0", cost: "30115.00", reasonCode: "spill", reasonName: "Spill", reason: "Spill", over: true, link: { kind: "run", runId: "r1" } };
const result = {
  strip: { batch: "30115.00", chemical: "575.00", powder: "0.00", packing: "0.00", store: "0.00", total: "30690.00" },
  limits, limitsUpdatedAt: null, limitsUpdatedBy: null,
  options: [{ key: "reason", label: "Reason", options: [{ value: "spill", label: "Spill" }] }],
  summary: [{ label: "Loss cost", value: "Rs 30,115" }], totals: ["Total", "", "", "500 KG", "400 KG", "100 KG", "20.0%", "30,115", ""],
  columns: [], rows: [row], total: 1, page: 1, pageCount: 1,
};

function renderReport(onOpenRow = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProductionLossReport onOpenRow={onOpenRow} /></QueryClientProvider>);
  return onOpenRow;
}
const lastInput = () => mocks.view.mock.calls.at(-1)![0].data;

describe("production loss page", () => {
  beforeEach(() => {
    mocks.permissions = ["reports.loss.view"];
    // The batch row only fits batch columns, so other tabs come back empty.
    mocks.view.mockReset().mockImplementation(({ data }: { data: { tab: string } }) =>
      Promise.resolve(data.tab === "batch" ? result : { ...result, rows: [], totals: [], total: 0 }));
  });
  afterEach(cleanup);

  it("shows the strip, opens a tab from it and keeps the date range", async () => {
    renderReport();
    await screen.findByText("Rs 30,690");
    const first = lastInput();
    expect(first.tab).toBe("batch");
    fireEvent.click(screen.getByRole("button", { name: /Chemical\s*Rs 575/ }));
    await waitFor(() => expect(lastInput().tab).toBe("chemical"));
    expect([lastInput().dateFrom, lastInput().dateTo]).toEqual([first.dateFrom, first.dateTo]);
  });

  it("asks for only over-limit rows when switched on", async () => {
    renderReport();
    await screen.findByText("A0104");
    fireEvent.click(screen.getByRole("switch", { name: "Only over limit" }));
    await waitFor(() => expect(lastInput().onlyOverLimit).toBe(true));
  });

  it("marks over-limit rows and opens the batch on click", async () => {
    const onOpenRow = renderReport();
    const cell = await screen.findByText("A0104");
    expect(cell.closest("tr")?.getAttribute("data-over")).toBe("true");
    fireEvent.click(cell);
    expect(onOpenRow).toHaveBeenCalledWith({ kind: "run", runId: "r1" });
  });

  it("hides loss limits without the manage permission", async () => {
    renderReport();
    await screen.findByText("A0104");
    expect(screen.queryByRole("button", { name: "Loss limits" })).toBeNull();
    cleanup();
    mocks.permissions = ["reports.loss.view", "reports.loss.limits.manage"];
    renderReport();
    expect(await screen.findByRole("button", { name: "Loss limits" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `bun run test -- src/components/reports/production-loss/production-loss-report.behavior.test.tsx`
Expected: FAIL. The module `./production-loss-report` cannot be found.

- [ ] **Step 3: Write the limits dialog**

```tsx
// src/components/reports/production-loss/loss-limits-dialog.tsx
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatReportTimestamp } from "@/lib/report-dates";
import { LOSS_LIMIT_KEYS, LOSS_LIMIT_LABELS, type LossLimits } from "@/lib/production/loss-report";
import { updateLossLimitsFn } from "@/server-functions/reports/production-loss-fn";

const VALID = /^\d{1,3}(?:\.\d)?$/;

export function LossLimitsDialog({ open, onOpenChange, limits, updatedAt, updatedBy }: {
  open: boolean; onOpenChange: (open: boolean) => void; limits: LossLimits; updatedAt: string | null; updatedBy: string | null;
}) {
  const [draft, setDraft] = useState<LossLimits>(limits);
  useEffect(() => { if (open) setDraft(limits); }, [open, limits]);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => updateLossLimitsFn({ data: draft }),
    onSuccess: () => {
      toast.success("Loss limits saved");
      void queryClient.invalidateQueries({ queryKey: ["reports", "production-loss"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save loss limits"),
  });
  const invalid = LOSS_LIMIT_KEYS.some((key) => !VALID.test(draft[key].trim()) || Number(draft[key]) > 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Loss limits</DialogTitle>
          <DialogDescription>Rows with loss % above the limit show red. Changing a limit doesn't change saved data.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {LOSS_LIMIT_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Label htmlFor={`limit-${key}`}>{LOSS_LIMIT_LABELS[key]}</Label>
              <div className="flex items-center gap-1.5">
                <Input id={`limit-${key}`} inputMode="decimal" className="w-20 text-right" value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
          {invalid && <p className="text-sm text-destructive">Use 0 to 100, with up to one decimal place.</p>}
          <p className="text-xs text-muted-foreground">
            {updatedAt ? `Last changed by ${updatedBy ?? "someone"} on ${formatReportTimestamp(updatedAt)}` : "Not changed yet. Every limit starts at 10%."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the page component**

```tsx
// src/components/reports/production-loss/production-loss-report.tsx
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { currentReportMonth, datePickerKey } from "@/lib/report-dates";
import { formatLossMoney, lossColumns, type LossFilters } from "@/lib/production/loss-display";
import { LOSS_STRIP_LABELS, LOSS_TABS, LOSS_TAB_LABELS, type LossRow, type LossRowLink, type LossTab } from "@/lib/production/loss-report";
import { getProductionLossFn, getProductionLossPrintFn } from "@/server-functions/reports/production-loss-fn";
import { LossLimitsDialog } from "./loss-limits-dialog";
import { printProductionLoss } from "./loss-print";

const perTab = <T,>(value: T) => Object.fromEntries(LOSS_TABS.map((tab) => [tab, value])) as Record<LossTab, T>;
const toPicker = (key: string) => new Date(`${key}T12:00:00`);

export function ProductionLossReport({ onOpenRow }: { onOpenRow: (link: LossRowLink) => void }) {
  const [range, setRange] = useState(() => {
    const month = currentReportMonth();
    return { dateFrom: month.from, dateTo: month.to };
  });
  const [tab, setTab] = useState<LossTab>("batch");
  const [filters, setFilters] = useState<Record<LossTab, LossFilters>>(() => perTab({}));
  const [onlyOver, setOnlyOver] = useState<Record<LossTab, boolean>>(() => perTab(false));
  const [pages, setPages] = useState<Record<LossTab, number>>(() => perTab(1));
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { data: access } = useViewerAccess();
  const canManageLimits = hasPermission(access?.permissions ?? [], "reports.loss.limits.manage");

  const view = { tab, ...range, filters: filters[tab], onlyOverLimit: onlyOver[tab] };
  const { data, isFetching, error } = useQuery({
    queryKey: ["reports", "production-loss", { ...view, page: pages[tab] }],
    queryFn: () => getProductionLossFn({ data: { ...view, page: pages[tab] } }),
    placeholderData: keepPreviousData,
  });
  const columns = lossColumns(tab);

  const changeRange = (next: DateRange | undefined) => {
    if (!next?.from || !next?.to) return;
    setRange({ dateFrom: datePickerKey(next.from), dateTo: datePickerKey(next.to) });
    setPages(perTab(1));
  };
  const setFilter = (key: keyof LossFilters, value: string) => {
    setFilters({ ...filters, [tab]: { ...filters[tab], [key]: value || undefined } });
    setPages({ ...pages, [tab]: 1 });
  };
  const print = async () => {
    setPrinting(true);
    try {
      if (!printProductionLoss(await getProductionLossPrintFn({ data: view }))) toast.error("Allow pop-ups to print the report");
    } catch (printError) {
      toast.error(printError instanceof Error ? printError.message : "Could not print the report");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Production Loss</h1>
        <p className="text-sm text-muted-foreground mt-1">Every loss in mixing, packing and the stores, with its cost and reason.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DatePickerWithRange date={{ from: toPicker(range.dateFrom), to: toPicker(range.dateTo) }} onDateChange={changeRange} />
        <div className="flex gap-2">
          {canManageLimits && <Button variant="outline" onClick={() => setLimitsOpen(true)}>Loss limits</Button>}
          <Button onClick={print} disabled={printing || !data}>Print report</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not load the report"}</p>}

      <section>
        <h2 className="text-sm font-medium mb-2">Loss this period</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {LOSS_TABS.map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${tab === key ? "border-primary" : ""}`}>
              <span className="block text-xs text-muted-foreground">{LOSS_STRIP_LABELS[key]}</span>
              <span className="block font-mono font-semibold tabular-nums">Rs {formatLossMoney(data?.strip[key] ?? 0)}</span>
            </button>
          ))}
          <div className="rounded-lg border bg-muted/40 p-3">
            <span className="block text-xs text-muted-foreground">Total</span>
            <span className="block font-mono font-semibold tabular-nums">Rs {formatLossMoney(data?.strip.total ?? 0)}</span>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(value) => setTab(value as LossTab)}>
        <TabsList className="flex-wrap h-auto">
          {LOSS_TABS.map((key) => <TabsTrigger key={key} value={key}>{LOSS_TAB_LABELS[key]}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        {data?.options.map((option) => (
          <div key={option.key} className="space-y-1">
            <Label htmlFor={`loss-filter-${option.key}`} className="text-xs">{option.label}</Label>
            <NativeSelect id={`loss-filter-${option.key}`} value={filters[tab][option.key] ?? ""} onChange={(event) => setFilter(option.key, event.target.value)}>
              <NativeSelectOption value="">All</NativeSelectOption>
              {option.options.map((choice) => <NativeSelectOption key={choice.value} value={choice.value}>{choice.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        ))}
        {tab !== "store" && (
          <div className="flex items-center gap-2 pb-2">
            <Switch id="loss-only-over" checked={onlyOver[tab]} aria-label="Only over limit"
              onCheckedChange={(checked) => { setOnlyOver({ ...onlyOver, [tab]: checked }); setPages({ ...pages, [tab]: 1 }); }} />
            <Label htmlFor="loss-only-over">Only over limit</Label>
          </div>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {data.summary.map((item) => (
            <div key={item.label}>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</div>
              <div className="font-mono font-semibold tabular-nums">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-lg border ${isFetching ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>{columns.map((column) => <TableHead key={column.key} className={column.numeric ? "text-right" : ""}>{column.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.length === 0 && (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">No losses for this range and filters.</TableCell></TableRow>
            )}
            {data?.rows.map((row: LossRow) => (
              <TableRow key={row.id} data-over={row.over} onClick={() => onOpenRow(row.link)}
                className={`cursor-pointer ${row.over ? "text-red-600 dark:text-red-400 font-medium" : ""}`}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.numeric ? "text-right tabular-nums" : ""}>{column.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {data && data.rows.length > 0 && (
            <TableFooter>
              <TableRow>{data.totals.map((cell, i) => <TableCell key={columns[i]?.key ?? i} className={columns[i]?.numeric ? "text-right tabular-nums" : ""}>{cell}</TableCell>)}</TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">Page {data.page} of {data.pageCount} · {data.total} rows</span>
          <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPages({ ...pages, [tab]: data.page - 1 })}>Previous</Button>
          <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setPages({ ...pages, [tab]: data.page + 1 })}>Next</Button>
        </div>
      )}

      {canManageLimits && data && (
        <LossLimitsDialog open={limitsOpen} onOpenChange={setLimitsOpen} limits={data.limits} updatedAt={data.limitsUpdatedAt} updatedBy={data.limitsUpdatedBy} />
      )}
    </div>
  );
}
```

The test uses `getByRole("button", { name: /Chemical\s*Rs 575/ })`. The strip button's accessible name joins its two spans, so it reads "ChemicalRs 575". The test's `\s*` allows for that.

- [ ] **Step 5: Run the component test**

Run: `bun run test -- src/components/reports/production-loss/production-loss-report.behavior.test.tsx`
Expected: PASS. If `DatePickerWithRange` or `Switch` need a browser API that jsdom lacks (for example `ResizeObserver`), stub it at the top of this test file with `globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;`. Do not change `src/__tests__/setup.ts`.

- [ ] **Step 6: Add the route and the Reports card**

```tsx
// src/routes/_protected/reports/production-loss/index.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProductionLossReport } from "@/components/reports/production-loss/production-loss-report";
import type { LossRowLink } from "@/lib/production/loss-report";

export const Route = createFileRoute("/_protected/reports/production-loss/")({
  component: ProductionLossPage,
});

function ProductionLossPage() {
  const navigate = useNavigate();
  const open = (link: LossRowLink) =>
    link.kind === "run"
      ? navigate({ to: "/manufacturing/mixing/$runId", params: { runId: link.runId } })
      : navigate({ to: "/inventory/item/$itemType/$itemId", params: { itemType: link.itemType, itemId: link.itemId }, search: { page: 1 } });
  return <ProductionLossReport onOpenRow={open} />;
}
```

If the item route's search schema needs more than `page`, the type check will say so. Pass what it asks for.

In `src/routes/_protected/reports/index.tsx`:

1. Add `Factory` to the `lucide-react` import, and add these imports:
   ```ts
   import { useViewerAccess } from "@/hooks/use-viewer-access";
   import { hasPermission, type PermissionKey } from "@/lib/rbac";
   ```
2. Give each report type an optional permission. Change the array declaration to `const reportTypes: { title: string; description: string; href: string; icon: typeof BarChart3; permission?: PermissionKey }[] = [` and add at the end:
   ```ts
     {
       title: "Production Loss",
       description: "Every loss in mixing, packing and the stores, with its cost and reason.",
       href: "/reports/production-loss",
       icon: Factory,
       permission: "reports.loss.view",
     },
   ```
3. In `ReportsLandingPage`, before `return`:
   ```ts
   const { data: access } = useViewerAccess();
   const visible = reportTypes.filter((report) => !report.permission || hasPermission(access?.permissions ?? [], report.permission));
   ```
   and render `visible.map(...)` instead of `reportTypes.map(...)`.

- [ ] **Step 7: Generate routes and type check**

Run: `bun run build` (this regenerates `src/routeTree.gen.ts`), then `bun run typecheck`.
Expected: both pass. Never edit `src/routeTree.gen.ts` by hand.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports/production-loss src/routes/_protected/reports/production-loss src/routes/_protected/reports/index.tsx src/routeTree.gen.ts
git commit -m "feat(reports): add the production loss page with tabs, limits and print"
```

---

### Task 7: Whole check, full test run and graph update

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

- [ ] **Step 2: Check the page by hand**

Start `bun run dev` and sign in as an admin. Then:
1. Reports shows the Production Loss card. Open it.
2. The date range is the current month. Change it and switch tabs. The range stays.
3. Click a strip box. Its tab opens.
4. Turn on "Only over limit". Only red rows stay.
5. Open Loss limits, set Batch loss to 25 and save. Rows between 10% and 25% stop being red. The form shows your name and the time.
6. Click Print report. The print preview is A4 landscape, has the total row and signature lines, and shows "▲" on red rows.
7. Sign in as a user with `reports.view` but not `reports.loss.view`. The card is hidden, and `/reports/production-loss` is refused.

- [ ] **Step 3: Update the graph and commit**

```bash
graphify update .
git status --short
```

If Steps 1–2 led to fixes, commit them with `fix(reports): <what was fixed>`. Only commit files this plan created or changed. Leave anything else in `git status` alone. If nothing changed, there is nothing to commit.

---

## Self-review notes (for the executor)

- Spec §Where (card, two permissions, separate from QC): Task 1 and Task 6. The loss report never touches `production-qc` files.
- §Layout (whole-page date range, current month, strip with five boxes and total, box opens tab, 25 rows newest first, red rows, Only over limit, row click, PKR Lac/Crore): Tasks 3, 4 and 6.
- §Tab 1 (completed only, loss Rs = loss × cost ÷ target, KG and L apart): Tasks 2, 3 and 4.
- §Tab 2 (extra > 0, extra % of formula, exact lot cost): Tasks 2 and 4. The cost is the `extraCost` that Part 2 saved from the lots.
- §Tab 3 (given = packed + lost, cost per KG of output): Tasks 2 and 4.
- §Tab 4 (shopper expected/actual/loss with KG in the name, check weight, weighted shopper %, pieces extra only): Tasks 2, 3 and 4.
- §Tab 5 (stock-reducing loss reasons only, no %, no red): Tasks 2 and 4.
- §Loss limits (5 limits, 10% default, 0–100 with one decimal, strictly above, who/when, highlighting only): Tasks 1, 2, 4 and 6.
- §Print (all rows, A4 landscape, QC style, filters, summary, total row, signatures, footer with print time and pages, ▲ bold red, header repeat, no split rows, 2,000 cap): Tasks 4 and 5.
- §Testing: unit and property tests in Tasks 2–3, source inspection in Task 4, print tests in Task 5, component tests in Task 6.
