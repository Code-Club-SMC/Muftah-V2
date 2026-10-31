# Actual Material Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mixing and packing take away what was really used, not what the formula or format says. Shoppers are bought, stocked and used in KG. Every loss is saved with a reason from a fixed list, so Part 3 (Loss Report) can read it.

**Architecture:** Part 1 made `src/lib/inventory/material-lots.server.ts` the only code that changes material stock. This plan keeps that rule. Rules with no database live in one pure module, `src/lib/production/material-use.ts`: reason lists, the difference between planned and used, the "less than needed" check, and the shopper maths. Mixing completion takes the extra or returns the leftover through the lot module. Packing asks the lot picker to add up to **Used** instead of **Needed**. Mixing and packing must take the oldest lot first, and operator screens name lots by date, never by price. Three new tables hold what Part 3 needs: `mixing_material_use` (one row per chemical per batch), `packing_material_use` (one row per material per packing entry) and `material_adjustments` (one row per manual adjustment). Shoppers get a `measured_in_kg` switch on `packaging_materials`. The existing `weight_per_pack` (grams) and `price_per_kg` columns hold the shopper weight and KG price.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (PostgreSQL), big.js, zod, React + TanStack Form/Query, shadcn/ui, Vitest (jsdom unit tests, real-DB integration tests via `vitest.integration.config.ts`), fast-check.

**Spec:** `docs/superpowers/specs/2026-10-29-actual-material-use-spec.md` (Part 2 of 3; Part 1 plan: `docs/superpowers/plans/2026-10-29-material-price-lots.md`, done)

## Global Constraints

- "Measured in KG" is only allowed on **primary** packaging materials. Off by default. When on, **Weight of one shopper (grams)** and **Price per KG** are required, and the item's `costPerUnit` is the price per KG.
- The switch can only change while the material has no stock in any store and has never been used: no lot rows, no `material_stock` row above zero, no `packaging_materials_used_in_allocation` rows. Otherwise it is locked.
- Shopper purchases: **KG × price per KG**. Example: 50 KG × Rs 520 = Rs 26,000.
- Shopper stock, transfers, adjustments and low-stock alerts are in KG. The minimum stock level is a whole number of KG (the column stays an integer).
- Mixing: Used is pre-filled with the formula amount. More than formula: extra comes off the factory floor through picked lots, and a reason is required. Less: the leftover goes back to lots the batch took, and no reason is needed.
- Mixing reasons: Spill · Leak · Measuring error · Machine fault · Moisture loss · Other (note required). The batch shortfall reason uses this same list, plus an optional note.
- Packing pieces materials: Used is pre-filled with Needed. More needs a reason. Less is blocked with: "`<name>`: used can't be less than needed (`<needed>`). Check the pack count instead."
- Packing shoppers (KG): Used is blank and must be typed. No reason. Expected = KG × 1,000 ÷ grams per shopper, rounded down to whole shoppers. Actual = packs made with that shopper in this entry. Loss = expected − actual. Loss % = loss ÷ expected, 1 decimal.
- Actual above expected is allowed and saved. Warning text, exactly: "More packs than this weight should give. Check the shopper weight in material setup."
- Packing reasons: Broken · Torn · Misprint · Machine fault · Other (note required).
- Powder loss reasons: Spill · Machine fault · Stuck in machine · Other. The note is optional, except for Other.
- Adjustment reasons: Damaged · Spilled · Expired · Count short · Count over · Other (note required). Removing stock may use any reason except Count over. Adding stock may use only Count over or Other.
- Changing an item's quantity from the edit material form is a count. It is saved automatically as Count short or Count over.
- Lot picks always add up to **Used**. Part 1's rules still apply: a person picks, and each pick must not exceed that lot's stock.
- **Oldest stock first in mixing and packing.** This replaces Part 1's "no oldest-first" rule for mixing start, mixing extra at completion and packing. "Oldest" is the order lots are listed in: first-purchased date, then price, then id. A newer lot may only be used once every older lot in that store is taken in full. Saving is blocked otherwise, with: "`<name>`: use the oldest stock first. Take `<qty>` `<unit>` from `<lot>` before a newer lot." The picker is filled in oldest-first for the operator. Transfers, leftover going back, failed-batch recovery and adjustments are not affected.
- **No prices on operator screens.** In the mixing start dialog, the mixing completion screen and the packing screen, lots are named by date only: "Lot 1 Oct", or "Lot 1 Oct (2)" when two lots share a first date. Lot errors everywhere use that same date name, never a price. People without `inventory.view` or `manufacturing.run.manage` get no lot prices from the lot read, and no cost fields from the mixing batch read. Store screens (add stock, transfers, adjustments, edit material) keep showing prices.
- Weight and prices are copied onto the saved rows, so later setup changes never rewrite old losses.
- The old packing-job flow (`complete-packaging-allocation`, `log-packaging-progress`) is not changed.
- A saved batch's actual use can't be edited. Corrections go through adjustments.
- Never hand-edit files under `src/db/migrations/`. Always run `bun run db:generate`.
- Do not edit `src/routeTree.gen.ts`.

## How to run tests

- Unit and component tests: `bun run test -- <path>`
- Integration tests (real PostgreSQL): you need a database whose name ends in `_test`. With docker compose running (`docker compose up -d`):
  ```bash
  export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/titan_test
  DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
  DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts <path>
  ```
  If `TEST_DATABASE_URL` is not set, the integration suites skip themselves. Before you mark a task with integration tests as done, run them against the database.
- Type check: `bun run typecheck`

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schemas/inventory-schema.ts` (modify) | `measuredInKg` on `packagingMaterials`. New `materialAdjustments` table |
| `src/db/schemas/production-schema.ts` (modify) | `useType` on `mixingMaterialsUsed`. `shortfallReasonCode` on `mixingRuns`. `lossReasonCode` on `batchPackingReceipts`. New `mixingMaterialUse` and `packingMaterialUse` tables. `lot` relation on `mixingMaterialsUsed` |
| `src/lib/production/material-use.ts` (create) | Pure rules: reason lists and checks, mixing difference, pieces check, shopper maths, grouping a batch's formula lots. Safe for client import |
| `src/lib/inventory/material-units.ts` (create) | `packagingUnit()`: `"kg"` or `"pcs"`. Client-safe |
| `src/lib/inventory/material-units.server.ts` (create) | `packagingUnitSql()` for server selects |
| `src/server-functions/inventory/add-packaging-material-fn.ts`, `update-material-fn.ts` (modify) | KG switch, its lock, shopper weight |
| `src/components/inventory/add-packaging-material-form.tsx`, `edit-material-dialog.tsx`, `add-stock-dialog-form.tsx` (modify) | KG switch and KG purchase entry |
| Stock display files (modify) | Show `kg` for shoppers |
| `src/server-functions/manufacturing/mixing/complete-mixing-run-core.server.ts`, `complete-mixing-run-fn.ts`, `log-mixing-progress-fn.ts`, `get-mixing-run-fn.ts` (modify) | Actual use at completion. No more auto-complete |
| `src/components/operator/mixing-actual-use.tsx` (create), `mixing-console.tsx` (modify) | Chemicals-used section and shortfall reason list |
| `src/components/inventory/lot-picker.tsx` (modify) | Optional `legend` and `whereLabel` props for the "back to" picker |
| `src/server-functions/manufacturing/packaging/batch-packing-core.server.ts`, `get-batch-packing-context-fn.ts` (modify) | Used quantities, shoppers in KG, reasons, powder loss list |
| `src/components/packaging/material-use-row.tsx` (create), `batch-packing-form.tsx`, `packing-draft.ts` (modify) | Materials-used section and powder loss list |
| `src/server-functions/inventory/stock/adjust-stock-fn.ts`, `src/components/inventory/adjust-stock-dialog.tsx` (modify) | Fixed adjustment reasons |

---

### Task 1: Tables and columns for actual use

**Files:**
- Modify: `src/db/schemas/inventory-schema.ts` (`packagingMaterials` at `:66-100`; add `materialAdjustments` after `materialLotMovements`)
- Modify: `src/db/schemas/production-schema.ts` (`mixingRuns` `:94-140`, `mixingMaterialsUsed` `:198-225`, `mixingMaterialsUsedRelations` `:477-489`, `batchPackingReceipts` `:566-579`)
- Modify: `src/db/index.ts` (named export list)
- Create (generated): a new migration under `src/db/migrations/`
- Test: `src/__tests__/actual-material-use-schema.test.ts`

**Interfaces:**
- Produces: `packagingMaterials.measuredInKg` (boolean, not null, default false). `mixingMaterialsUsed.useType` (`"formula" | "extra" | "returned"`, not null, default `"formula"`). `mixingRuns.shortfallReasonCode` (text, nullable; `shortfallReason` now holds the note). `batchPackingReceipts.lossReasonCode` (text, nullable; `lossReason` now holds the note). Tables `mixingMaterialUse`, `packingMaterialUse` (from `@/db/schemas/production-schema`) and `materialAdjustments` (from `@/db/schemas/inventory-schema` and `@/db`).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/actual-material-use-schema.test.ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { materialAdjustments, packagingMaterials } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, mixingMaterialUse, mixingMaterialsUsed, mixingRuns, packingMaterialUse } from "@/db/schemas/production-schema";

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((column) => column.name);

describe("actual material use schema", () => {
  it("marks shoppers measured in KG", () => {
    expect(columns(packagingMaterials)).toContain("measured_in_kg");
  });

  it("keeps reason codes next to the existing free-text notes", () => {
    expect(columns(mixingRuns)).toEqual(expect.arrayContaining(["shortfall_reason_code", "shortfall_reason"]));
    expect(columns(batchPackingReceipts)).toEqual(expect.arrayContaining(["loss_reason_code", "loss_reason"]));
    expect(columns(mixingMaterialsUsed)).toContain("use_type");
  });

  it("stores planned and used amounts per chemical and per packing material", () => {
    expect(columns(mixingMaterialUse)).toEqual(expect.arrayContaining(["mixing_run_id", "chemical_id", "formula_quantity", "used_quantity", "extra_quantity", "extra_cost", "reason", "note"]));
    expect(columns(packingMaterialUse)).toEqual(expect.arrayContaining(["receipt_id", "material_id", "measured_in_kg", "needed_quantity", "used_quantity", "extra_quantity", "extra_cost", "total_cost", "reason", "note", "shopper_weight_grams", "expected_shoppers", "actual_shoppers", "loss_shoppers"]));
  });

  it("stores each manual adjustment with its lot, price and reason", () => {
    expect(columns(materialAdjustments)).toEqual(expect.arrayContaining(["warehouse_id", "material_type", "chemical_id", "packaging_material_id", "lot_id", "delta", "unit_price", "value", "reason", "note", "source", "performed_by_id", "created_at"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/__tests__/actual-material-use-schema.test.ts`
Expected: FAIL. `mixingMaterialUse` is not exported.

- [ ] **Step 3: Add the inventory columns and table**

In `src/db/schemas/inventory-schema.ts`, inside `packagingMaterials`, right after `pricePerKg`:

```ts
  // Shoppers: bought, stocked, moved and used in KG. weightPerPack is then the grams of one
  // shopper and costPerUnit the price per KG. Locked once the item has stock or history.
  measuredInKg: boolean("measured_in_kg").notNull().default(false),
```

Add `boolean` to the `drizzle-orm/pg-core` import if it isn't there. Then add after `materialLotMovements` (and its indexes):

```ts
// --- MATERIAL ADJUSTMENTS ---
// One row per manual stock adjustment, with the lot, its price and a fixed reason.
// The Loss Report reads this table. Count over and other additions are not losses.
export const materialAdjustments = pgTable(
  "material_adjustments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    materialType: text("material_type").notNull(), // "chemical" | "packaging"
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(() => packagingMaterials.id),
    lotId: text("lot_id").notNull().references(() => materialLots.id),
    delta: decimal("delta", { precision: 12, scale: 3 }).notNull(), // negative = removed
    unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
    value: decimal("value", { precision: 12, scale: 2 }).notNull(), // delta × unit price
    reason: text("reason").notNull(), // ADJUSTMENT_REASONS code
    note: text("note"),
    source: text("source").notNull(), // "manual" | "material_edit"
    performedById: text("performed_by_id").notNull().references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    warehouseCreatedIdx: index("material_adjustments_warehouse_created_idx").on(t.warehouseId, t.createdAt),
    reasonIdx: index("material_adjustments_reason_idx").on(t.reason),
  }),
);
```

Check that `user` is already imported in this file (it is used by `inventoryAuditLog.performedById`). If not, import it from `./auth-schema`.

In `src/db/index.ts`, add `materialAdjustments` to the `export const { warehouses, chemicals, ... } = inventorySchema;` list.

- [ ] **Step 4: Add the production columns and tables**

In `src/db/schemas/production-schema.ts`:

1. In `mixingRuns`, right after `shortfallReason`:
   ```ts
    // Fixed reason (MIXING_REASONS code). shortfallReason holds the optional note.
    shortfallReasonCode: text("shortfall_reason_code"),
   ```
2. In `mixingMaterialsUsed`, right after `totalCost`:
   ```ts
    // "formula" rows are taken at start. "extra" rows are taken at completion.
    // "returned" rows put leftover back and carry negative quantity and cost.
    useType: text("use_type").notNull().default("formula"),
   ```
3. Directly after `mixingMaterialsUsed`, add:
   ```ts
   // ---------------------------------------------------------------------------
   // MIXING MATERIAL USE — Formula amount vs real use, one row per chemical per batch
   // ---------------------------------------------------------------------------
   export const mixingMaterialUse = pgTable(
     "mixing_material_use",
     {
       id: text("id").primaryKey().$defaultFn(() => createId()),
       mixingRunId: text("mixing_run_id").notNull().references(() => mixingRuns.id, { onDelete: "cascade" }),
       chemicalId: text("chemical_id").notNull().references(() => chemicals.id),
       formulaQuantity: decimal("formula_quantity", { precision: 12, scale: 3 }).notNull(),
       usedQuantity: decimal("used_quantity", { precision: 12, scale: 3 }).notNull(),
       extraQuantity: decimal("extra_quantity", { precision: 12, scale: 3 }).notNull(), // used − formula; negative when leftover went back
       extraCost: decimal("extra_cost", { precision: 12, scale: 2 }).notNull(), // lot cost of the extra; negative for leftover
       reason: text("reason"), // MIXING_REASONS code, only when extra > 0
       note: text("note"),
       createdAt: timestamp("created_at").notNull().defaultNow(),
     },
     (t) => ({ runChemicalIdx: uniqueIndex("mixing_material_use_run_chemical_idx").on(t.mixingRunId, t.chemicalId) }),
   );
   ```
4. In `batchPackingReceipts`, right after `lossReason`:
   ```ts
  lossReasonCode: text("loss_reason_code"), // POWDER_LOSS_REASONS code; lossReason holds the note
   ```
5. Directly after `batchPackingReceipts`, add:
   ```ts
   // Needed vs real use for every packaging material in one packing entry.
   // Shoppers in KG: needed is the pack count, used is KG, and the shopper columns are filled.
   export const packingMaterialUse = pgTable("packing_material_use", {
     id: text("id").primaryKey().$defaultFn(() => createId()),
     receiptId: text("receipt_id").notNull().references(() => batchPackingReceipts.id),
     materialId: text("material_id").notNull().references(() => packagingMaterials.id),
     measuredInKg: boolean("measured_in_kg").notNull(),
     neededQuantity: decimal("needed_quantity", { precision: 12, scale: 3 }).notNull(),
     usedQuantity: decimal("used_quantity", { precision: 12, scale: 3 }).notNull(),
     extraQuantity: decimal("extra_quantity", { precision: 12, scale: 3 }).notNull().default("0"),
     extraCost: decimal("extra_cost", { precision: 12, scale: 2 }).notNull().default("0"), // cost of extra pieces or lost shoppers
     totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
     reason: text("reason"), // PACKING_REASONS code, pieces only
     note: text("note"),
     shopperWeightGrams: decimal("shopper_weight_grams", { precision: 10, scale: 3 }),
     expectedShoppers: integer("expected_shoppers"),
     actualShoppers: integer("actual_shoppers"),
     lossShoppers: integer("loss_shoppers"),
     createdAt: timestamp("created_at").notNull().defaultNow(),
   }, t => ({ receiptMaterialIdx: uniqueIndex("packing_material_use_receipt_material_idx").on(t.receiptId, t.materialId) }));
   ```
6. In `mixingMaterialsUsedRelations`, add a `lot` relation next to `chemical`:
   ```ts
    lot: one(materialLots, {
      fields: [mixingMaterialsUsed.lotId],
      references: [materialLots.id],
    }),
   ```

Add `boolean` and `uniqueIndex` to the `drizzle-orm/pg-core` import if missing. `materialLots`, `chemicals` and `packagingMaterials` are already imported (Part 1 uses them).

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file under `src/db/migrations/` that adds the columns and three tables. Read it and check it only adds things: no drops, no renames. Don't edit it.

- [ ] **Step 6: Run the test and type check**

Run: `bun run test -- src/__tests__/actual-material-use-schema.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/schemas/inventory-schema.ts src/db/schemas/production-schema.ts src/db/index.ts src/db/migrations src/__tests__/actual-material-use-schema.test.ts
git commit -m "feat(production): add tables for actual material use and loss reasons"
```

---

### Task 2: Pure rules for actual use

**Files:**
- Create: `src/lib/production/material-use.ts`
- Create: `src/lib/inventory/material-units.ts`
- Create: `src/lib/inventory/material-units.server.ts`
- Test: `src/lib/production/material-use.test.ts`

**Interfaces:**
- Consumes: `lotQuantity`, `LotBalance` from `@/lib/inventory/material-lots`.
- Produces:
  - Reason lists, each `readonly { code: string; label: string }[]`: `MIXING_REASONS`, `PACKING_REASONS`, `POWDER_LOSS_REASONS`, `ADJUSTMENT_REASONS`.
  - `reasonCodes(list)` returns a non-empty tuple of codes for `z.enum`.
  - `reasonLabel(list, code)` returns the label, or the code if unknown.
  - `checkReason(list, code, note, what)` returns `string | null` (an error message, or null when fine).
  - `adjustmentReasonsFor(adding: boolean)` returns the allowed subset. `checkAdjustmentReason(code, note, adding)` returns `string | null`.
  - `mixingUseChange(formula: string, used: string)` returns `{ kind: "same" | "extra" | "leftover"; quantity: string }`.
  - `checkPiecesUse({ name, needed, used, reason?, note? })` returns `string[]`.
  - `shopperNumbers({ kgUsed, gramsPerShopper, actualPacks })` returns `{ expected: number; actual: number; loss: number; lossPercent: string; moreThanExpected: boolean }`.
  - `SHOPPER_OVER_WARNING` (string).
  - `groupFormulaUse(rows)`: rows `{ chemicalId; lotId; quantity; unitPrice; firstPurchasedAt }[]` in, `Map<chemicalId, { formula: string; takenLots: LotBalance[] }>` out.
  - `packagingUnit(material)` returns `"kg" | "pcs"`. `packagingUnitSql(column)` is a drizzle `SQL<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/production/material-use.test.ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Big from "big.js";
import {
  ADJUSTMENT_REASONS, MIXING_REASONS, PACKING_REASONS, POWDER_LOSS_REASONS,
  adjustmentReasonsFor, checkAdjustmentReason, checkPiecesUse, checkReason, groupFormulaUse,
  mixingUseChange, reasonCodes, reasonLabel, shopperNumbers,
} from "./material-use";
import { packagingUnit } from "@/lib/inventory/material-units";

describe("reason lists", () => {
  it("match the spec", () => {
    expect(MIXING_REASONS.map((r) => r.label)).toEqual(["Spill", "Leak", "Measuring error", "Machine fault", "Moisture loss", "Other"]);
    expect(PACKING_REASONS.map((r) => r.label)).toEqual(["Broken", "Torn", "Misprint", "Machine fault", "Other"]);
    expect(POWDER_LOSS_REASONS.map((r) => r.label)).toEqual(["Spill", "Machine fault", "Stuck in machine", "Other"]);
    expect(ADJUSTMENT_REASONS.map((r) => r.label)).toEqual(["Damaged", "Spilled", "Expired", "Count short", "Count over", "Other"]);
    expect(reasonCodes(MIXING_REASONS)[0]).toBe("spill");
    expect(reasonLabel(PACKING_REASONS, "misprint")).toBe("Misprint");
  });

  it("requires a listed code, and a note for Other", () => {
    expect(checkReason(MIXING_REASONS, undefined, "", "extra Soda Ash")).toBe("Pick a reason for extra Soda Ash");
    expect(checkReason(MIXING_REASONS, "typo", "", "extra Soda Ash")).toBe("Pick a reason from the list for extra Soda Ash");
    expect(checkReason(MIXING_REASONS, "other", " ", "extra Soda Ash")).toBe('Write a note for "Other" on extra Soda Ash');
    expect(checkReason(MIXING_REASONS, "other", "pump", "extra Soda Ash")).toBeNull();
    expect(checkReason(MIXING_REASONS, "spill", "", "extra Soda Ash")).toBeNull();
  });

  it("only lets additions use Count over or Other", () => {
    expect(adjustmentReasonsFor(true).map((r) => r.code)).toEqual(["count_over", "other"]);
    expect(adjustmentReasonsFor(false).map((r) => r.code)).toEqual(["damaged", "spilled", "expired", "count_short", "other"]);
    expect(checkAdjustmentReason("damaged", "", true)).toBe("Damaged can't be used when adding stock");
    expect(checkAdjustmentReason("count_over", "", false)).toBe("Count over can't be used when removing stock");
    expect(checkAdjustmentReason("count_short", "", false)).toBeNull();
  });
});

describe("mixing use", () => {
  it("finds extra and leftover", () => {
    expect(mixingUseChange("50", "55")).toEqual({ kind: "extra", quantity: "5.000" });
    expect(mixingUseChange("20", "18")).toEqual({ kind: "leftover", quantity: "2.000" });
    expect(mixingUseChange("30", "30.000")).toEqual({ kind: "same", quantity: "0.000" });
    expect(() => mixingUseChange("30", "-1")).toThrow();
  });

  it("formula plus change is always the used amount", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.integer({ min: 0, max: 9_999_999 }), (f, u) => {
      const formula = new Big(f).div(1000).toFixed(3);
      const used = new Big(u).div(1000).toFixed(3);
      const change = mixingUseChange(formula, used);
      const signed = change.kind === "leftover" ? new Big(change.quantity).times(-1) : new Big(change.quantity);
      return new Big(formula).plus(signed).eq(used);
    }));
  });

  it("groups a batch's formula lots per chemical", () => {
    const at = new Date("2026-10-01");
    const grouped = groupFormulaUse([
      { chemicalId: "soda", lotId: "a", quantity: "30.000", unitPrice: "115.00", firstPurchasedAt: at },
      { chemicalId: "soda", lotId: "b", quantity: "20.000", unitPrice: "125.00", firstPurchasedAt: at },
      { chemicalId: "labsa", lotId: "c", quantity: "30.000", unitPrice: "200.00", firstPurchasedAt: at },
    ]);
    expect(grouped.get("soda")).toEqual({ formula: "50.000", takenLots: [
      { lotId: "a", quantity: "30.000", unitPrice: "115.00", firstPurchasedAt: at },
      { lotId: "b", quantity: "20.000", unitPrice: "125.00", firstPurchasedAt: at },
    ] });
    expect(grouped.get("labsa")?.formula).toBe("30.000");
  });
});

describe("packing use", () => {
  it("blocks pieces below needed and asks a reason above needed", () => {
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1000" })).toEqual(["Cap 38mm: used can't be less than needed (1080). Check the pack count instead."]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1110" })).toEqual(["Pick a reason for extra Cap 38mm"]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1110", reason: "broken" })).toEqual([]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "1080" })).toEqual([]);
    expect(checkPiecesUse({ name: "Cap 38mm", needed: "1080", used: "abc" })).toEqual(["Cap 38mm: enter the quantity used as a number with up to 3 decimals"]);
  });

  it("works out shoppers from KG", () => {
    expect(shopperNumbers({ kgUsed: "1.20", gramsPerShopper: "1.0", actualPacks: 1080 }))
      .toEqual({ expected: 1200, actual: 1080, loss: 120, lossPercent: "10.0", moreThanExpected: false });
    expect(shopperNumbers({ kgUsed: "1.00", gramsPerShopper: "1.0", actualPacks: 1010 }))
      .toEqual({ expected: 1000, actual: 1010, loss: -10, lossPercent: "-1.0", moreThanExpected: true });
    expect(shopperNumbers({ kgUsed: "1", gramsPerShopper: "1.5", actualPacks: 600 }).expected).toBe(666);
    expect(() => shopperNumbers({ kgUsed: "1", gramsPerShopper: "0", actualPacks: 1 })).toThrow("Set the weight of one shopper in material setup");
    expect(() => shopperNumbers({ kgUsed: "0", gramsPerShopper: "1", actualPacks: 1 })).toThrow("Enter the KG of shopper used");
  });

  it("loss is always expected minus actual", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 100, max: 50_000 }), fc.integer({ min: 0, max: 200_000 }), (kgGrams, mg, actual) => {
      const result = shopperNumbers({ kgUsed: new Big(kgGrams).div(1000).toFixed(3), gramsPerShopper: new Big(mg).div(1000).toFixed(3), actualPacks: actual });
      return result.loss === result.expected - actual && result.moreThanExpected === result.loss < 0;
    }));
  });

  it("names the unit", () => {
    expect(packagingUnit({ measuredInKg: true })).toBe("kg");
    expect(packagingUnit({ measuredInKg: false })).toBe("pcs");
    expect(packagingUnit(null)).toBe("pcs");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/lib/production/material-use.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Write the unit helpers**

```ts
// src/lib/inventory/material-units.ts
// Shoppers measured in KG are counted in kg everywhere. Every other packaging item is in pieces.
export const packagingUnit = (material?: { measuredInKg?: boolean | null } | null) => (material?.measuredInKg ? "kg" : "pcs");
```

```ts
// src/lib/inventory/material-units.server.ts
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const packagingUnitSql = (measuredInKg: AnyPgColumn) => sql<string>`case when ${measuredInKg} then 'kg' else 'pcs' end`;
```

- [ ] **Step 4: Write the rules module**

```ts
// src/lib/production/material-use.ts
import Big from "big.js";
import { lotQuantity, type LotBalance } from "@/lib/inventory/material-lots";

type Reason = { readonly code: string; readonly label: string };

export const MIXING_REASONS = [
  { code: "spill", label: "Spill" },
  { code: "leak", label: "Leak" },
  { code: "measuring_error", label: "Measuring error" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "moisture_loss", label: "Moisture loss" },
  { code: "other", label: "Other" },
] as const;
export const PACKING_REASONS = [
  { code: "broken", label: "Broken" },
  { code: "torn", label: "Torn" },
  { code: "misprint", label: "Misprint" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "other", label: "Other" },
] as const;
export const POWDER_LOSS_REASONS = [
  { code: "spill", label: "Spill" },
  { code: "machine_fault", label: "Machine fault" },
  { code: "stuck_in_machine", label: "Stuck in machine" },
  { code: "other", label: "Other" },
] as const;
export const ADJUSTMENT_REASONS = [
  { code: "damaged", label: "Damaged" },
  { code: "spilled", label: "Spilled" },
  { code: "expired", label: "Expired" },
  { code: "count_short", label: "Count short" },
  { code: "count_over", label: "Count over" },
  { code: "other", label: "Other" },
] as const;

export const SHOPPER_OVER_WARNING = "More packs than this weight should give. Check the shopper weight in material setup.";

export function reasonCodes<T extends readonly Reason[]>(list: T) {
  return list.map((reason) => reason.code) as unknown as [T[number]["code"], ...T[number]["code"][]];
}

export function reasonLabel(list: readonly Reason[], code: string | null | undefined) {
  return list.find((reason) => reason.code === code)?.label ?? code ?? "";
}

export function checkReason(list: readonly Reason[], code: string | null | undefined, note: string | null | undefined, what: string) {
  if (!code) return `Pick a reason for ${what}`;
  if (!list.some((reason) => reason.code === code)) return `Pick a reason from the list for ${what}`;
  if (code === "other" && !note?.trim()) return `Write a note for "Other" on ${what}`;
  return null;
}

const ADDING = new Set(["count_over", "other"]);
export function adjustmentReasonsFor(adding: boolean) {
  return ADJUSTMENT_REASONS.filter((reason) => (adding ? ADDING.has(reason.code) : reason.code !== "count_over"));
}

export function checkAdjustmentReason(code: string | null | undefined, note: string | null | undefined, adding: boolean) {
  const error = checkReason(ADJUSTMENT_REASONS, code, note, "this adjustment");
  if (error) return error;
  if (!adjustmentReasonsFor(adding).some((reason) => reason.code === code))
    return `${reasonLabel(ADJUSTMENT_REASONS, code)} can't be used when ${adding ? "adding" : "removing"} stock`;
  return null;
}

export function mixingUseChange(formula: string, used: string) {
  const diff = new Big(lotQuantity(used, "Used")).minus(formula);
  if (diff.gt(0)) return { kind: "extra" as const, quantity: diff.toFixed(3) };
  if (diff.lt(0)) return { kind: "leftover" as const, quantity: diff.abs().toFixed(3) };
  return { kind: "same" as const, quantity: "0.000" };
}

export function checkPiecesUse(input: { name: string; needed: string; used: string; reason?: string | null; note?: string | null }) {
  let used: Big;
  try { used = new Big(lotQuantity(input.used)); } catch { return [`${input.name}: enter the quantity used as a number with up to 3 decimals`]; }
  if (used.lt(input.needed)) return [`${input.name}: used can't be less than needed (${new Big(input.needed).toString()}). Check the pack count instead.`];
  if (used.gt(input.needed)) {
    const error = checkReason(PACKING_REASONS, input.reason, input.note, `extra ${input.name}`);
    return error ? [error] : [];
  }
  return [];
}

export function shopperNumbers(input: { kgUsed: string; gramsPerShopper: string; actualPacks: number }) {
  const grams = new Big(input.gramsPerShopper || 0);
  if (grams.lte(0)) throw new Error("Set the weight of one shopper in material setup");
  let kg: Big;
  try { kg = new Big(lotQuantity(input.kgUsed, "KG used")); } catch { throw new Error("Enter the KG of shopper used"); }
  if (kg.lte(0)) throw new Error("Enter the KG of shopper used");
  const expected = kg.times(1000).div(grams).round(0, Big.roundDown).toNumber();
  const loss = expected - input.actualPacks;
  const lossPercent = expected > 0 ? new Big(loss).times(100).div(expected).round(1, Big.roundHalfUp).toFixed(1) : "0.0";
  return { expected, actual: input.actualPacks, loss, lossPercent, moreThanExpected: loss < 0 };
}

// What one batch took at start, per chemical, in the order it took it.
export function groupFormulaUse(rows: { chemicalId: string; lotId: string; quantity: string; unitPrice: string; firstPurchasedAt: Date | string }[]) {
  const grouped = new Map<string, { formula: string; takenLots: LotBalance[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.chemicalId) ?? { formula: "0.000", takenLots: [] };
    entry.formula = new Big(entry.formula).plus(row.quantity).toFixed(3);
    const lot = entry.takenLots.find((item) => item.lotId === row.lotId);
    if (lot) lot.quantity = new Big(lot.quantity).plus(row.quantity).toFixed(3);
    else entry.takenLots.push({ lotId: row.lotId, quantity: new Big(row.quantity).toFixed(3), unitPrice: row.unitPrice, firstPurchasedAt: row.firstPurchasedAt });
    grouped.set(row.chemicalId, entry);
  }
  return grouped;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test -- src/lib/production/material-use.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/production/material-use.ts src/lib/production/material-use.test.ts src/lib/inventory/material-units.ts src/lib/inventory/material-units.server.ts
git commit -m "feat(production): add rules for actual use, shopper loss and reason lists"
```

---

### Task 3: Oldest stock first in mixing and packing, with no prices on operator screens

**Files:**
- Modify: `src/lib/inventory/material-lots.ts` (`checkLotPicks` error text; add `lotDateLabel`, `oldestFirstPicks`, `checkOldestFirst`)
- Modify: `src/lib/inventory/material-lots.server.ts` (`takeLotPicks` gets `oldestFirst?: boolean`)
- Modify: `src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts` (pass `oldestFirst: true`)
- Modify: `src/server-functions/manufacturing/packaging/batch-packing-core.server.ts:78` (pass `oldestFirst: true`)
- Modify: `src/server-functions/inventory/stock/get-material-lots-fn.ts` (hide prices from operators)
- Modify: `src/server-functions/manufacturing/mixing/get-mixing-run-fn.ts` (hide cost fields from operators)
- Modify: `src/components/inventory/lot-picker.tsx` (new `oldestFirst` prop)
- Modify: `src/components/mixing/start-mixing-dialog.tsx:19` and `src/components/packaging/batch-packing-form.tsx:276`, `:619-627` (use `oldestFirst`)
- Modify: `src/lib/inventory/material-lots.test.ts:44`, `src/__tests__/lot-picker.behavior.test.tsx:30` (error text)
- Modify: `src/__tests__/integration/batch-packing.test.ts:109-140` (two tests take a newer carton lot while the older one still has stock)
- Test: add cases to `src/lib/inventory/material-lots.test.ts`, `src/__tests__/lot-picker.behavior.test.tsx`, `src/__tests__/integration/material-lot-mixing.test.ts`

**Interfaces:**
- Produces:
  - `lotDateLabel(lot: LotBalance, lots: LotBalance[])` returns `"Lot 1 Oct"`, or `"Lot 1 Oct (2)"` for the second lot with the same first date (counted in list order). `lots` must be in `listLotBalances` order.
  - `oldestFirstPicks(required: string, balances: LotBalance[]): LotPick[]` takes from the first lot, then the next, until `required` is covered. Returns `[]` when stock is short or `required` ≤ 0.
  - `checkOldestFirst({ name, unit, required, picks, balances }): string[]` returns `[]` when the picks match `oldestFirstPicks`. Otherwise it returns the oldest-first error for the first lot that should have been emptied.
  - `takeLotPicks(tx, { ..., oldestFirst?: boolean })`. With `true`, it also runs `checkOldestFirst` and throws its message.
  - `LotPicker` props `oldestFirst?: boolean` and `hidePrices?: boolean`. `oldestFirst` pre-fills `oldestFirstPicks`, shows the oldest-first error and implies `hidePrices`. `hidePrices` labels lots with `lotDateLabel` instead of `lotLabel`. `lotPicksValid(required, picks, lots, name, unit, oldestFirst = false)`.
  - Later tasks use these: Task 6 (mixing extra), Task 7 (completion screen), Task 8 (packing), Task 9 (packing screen).

- [ ] **Step 1: Write the failing unit tests**

Add to `src/lib/inventory/material-lots.test.ts`:

```ts
import { checkOldestFirst, lotDateLabel, oldestFirstPicks } from "./material-lots";

describe("oldest stock first", () => {
  const oct1 = new Date("2026-10-01");
  const oct20 = new Date("2026-10-20");
  const lots = [
    { lotId: "a", unitPrice: "115.00", quantity: "20.000", firstPurchasedAt: oct1 },
    { lotId: "b", unitPrice: "118.00", quantity: "10.000", firstPurchasedAt: oct1 },
    { lotId: "c", unitPrice: "125.00", quantity: "100.000", firstPurchasedAt: oct20 },
  ];

  it("names lots by date, never price", () => {
    expect(lots.map((lot) => lotDateLabel(lot, lots))).toEqual(["Lot 1 Oct", "Lot 1 Oct (2)", "Lot 20 Oct"]);
  });

  it("takes from the oldest lot first", () => {
    expect(oldestFirstPicks("25", lots)).toEqual([{ lotId: "a", quantity: "20.000" }, { lotId: "b", quantity: "5.000" }]);
    expect(oldestFirstPicks("15", lots)).toEqual([{ lotId: "a", quantity: "15.000" }]);
    expect(oldestFirstPicks("500", lots)).toEqual([]);
  });

  it("blocks a newer lot while an older one still has stock", () => {
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "c", quantity: "25" }], balances: lots }))
      .toEqual(["Soda Ash: use the oldest stock first. Take 20 kg from Lot 1 Oct before a newer lot."]);
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "a", quantity: "15" }, { lotId: "b", quantity: "10" }], balances: lots }))
      .toEqual(["Soda Ash: use the oldest stock first. Take 20 kg from Lot 1 Oct before a newer lot."]);
    expect(checkOldestFirst({ name: "Soda Ash", unit: "kg", required: "25", picks: [{ lotId: "a", quantity: "20" }, { lotId: "b", quantity: "5" }], balances: lots })).toEqual([]);
  });
});
```

Change line 44's expected text from `"Soda Ash: lot Rs 115.00 has only 120 kg here"` to `"Soda Ash: Lot 1 Oct has only 120 kg here"` (match the date in that test's fixture).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/lib/inventory/material-lots.test.ts`
Expected: FAIL. `lotDateLabel` is not exported.

- [ ] **Step 3: Write the rules**

In `src/lib/inventory/material-lots.ts`, add:

```ts
// Operator screens name lots by date only. The second lot with the same first date gets "(2)".
export function lotDateLabel(lot: LotBalance, lots: LotBalance[]) {
  const day = format(new Date(lot.firstPurchasedAt), "d MMM");
  const sameDay = lots.filter((row) => format(new Date(row.firstPurchasedAt), "d MMM") === day);
  const position = sameDay.findIndex((row) => row.lotId === lot.lotId) + 1;
  return position > 1 ? `Lot ${day} (${position})` : `Lot ${day}`;
}

// balances must be oldest first, as listLotBalances returns them.
export function oldestFirstPicks(required: string, balances: LotBalance[]): LotPick[] {
  let left = new Big(required);
  if (left.lte(0)) return [];
  const picks: LotPick[] = [];
  for (const lot of balances) {
    if (left.lte(0)) break;
    const take = new Big(lot.quantity).lt(left) ? new Big(lot.quantity) : left;
    if (take.lte(0)) continue;
    picks.push({ lotId: lot.lotId, quantity: take.toFixed(3) });
    left = left.minus(take);
  }
  return left.gt(0) ? [] : picks;
}

export function checkOldestFirst(input: { name: string; unit: string; required: string; picks: LotPick[]; balances: LotBalance[] }) {
  const expected = oldestFirstPicks(input.required, input.balances);
  const given = (lotId: string) => new Big(input.picks.find((pick) => pick.lotId === lotId)?.quantity || 0);
  for (const lot of input.balances) {
    const want = new Big(expected.find((pick) => pick.lotId === lot.lotId)?.quantity ?? 0);
    if (given(lot.lotId).eq(want)) continue;
    // The first lot that differs is the one the operator should have taken more from.
    return [`${input.name}: use the oldest stock first. Take ${plain(want)} ${input.unit} from ${lotDateLabel(lot, input.balances)} before a newer lot.`];
  }
  return [];
}
```

In `checkLotPicks`, change the over-pick message to use the date name:

```ts
    if (quantity.gt(balance.quantity)) errors.push(`${name}: ${lotDateLabel(balance, input.balances)} has only ${plain(balance.quantity)} ${unit} here`);
```

Because `lotDateLabel` is defined below `checkLotPicks` as a function declaration, it is hoisted. Fine.

- [ ] **Step 4: Enforce on the server**

In `material-lots.server.ts`, add `oldestFirst?: boolean` to the `takeLotPicks` input. After the `checkLotPicks` call:

```ts
  if (input.oldestFirst) {
    const order = checkOldestFirst({ name: input.name, unit: input.unit, required: input.required, picks: input.picks, balances });
    if (order.length) throw new Error(order.join("; "));
  }
```

Pass `oldestFirst: true` in `start-mixing-run-fn.ts` (the `takeLotPicks` call) and in `batch-packing-core.server.ts` (the `takeLotPicks` call). Do not pass it in `transfer-stock-core.server.ts`.

- [ ] **Step 5: Hide prices from operators on the server**

In `get-material-lots-fn.ts`, add `context` to the handler and blank the price for callers who may not see costs:

```ts
  .handler(({ data, context }) => db.transaction(async (tx) => {
    const seesPrices = hasPermission(context.authContext.permissions, "inventory.view") || hasPermission(context.authContext.permissions, "manufacturing.run.manage");
    // ...existing body...
    for (const ref of refs) {
      const lots = await listLotBalances(tx, data.warehouseId, ref);
      result[ref.materialId] = seesPrices ? lots : lots.map((lot) => ({ ...lot, unitPrice: "" }));
    }
```

In `get-mixing-run-fn.ts`, before `return mixingRun;`:

```ts
    // Operators run the batch but never see what it costs.
    const seesCosts = hasPermission(context.authContext.permissions, "manufacturing.run.manage") || hasPermission(context.authContext.permissions, "manufacturing.run.read") || hasPermission(context.authContext.permissions, "manufacturing.view");
    if (!seesCosts) return {
      ...mixingRun, totalChemicalCost: null, chemicalCostPerUnit: null,
      materialsUsed: mixingRun.materialsUsed.map((row) => ({ ...row, costPerUnit: "0", totalCost: "0", lot: row.lot ? { ...row.lot, unitPrice: "0" } : row.lot })),
      packagingAllocations: mixingRun.packagingAllocations.map((row) => ({ ...row, allocatedChemicalCost: "0", totalPackagingCost: "0", totalProductionCost: "0", actualCostPerPack: "0", actualCostPerCarton: "0" })),
    };
```

`lot` comes from Task 6's change to this file. If you build Task 3 first, drop the `lot` part here; Task 6 adds it back when it adds the relation.

- [ ] **Step 6: Write the failing picker test**

Add to `src/__tests__/lot-picker.behavior.test.tsx`:

```tsx
it("fills oldest first, shows no price and blocks a newer lot", () => {
  const oct1 = new Date("2026-10-01");
  const lots = [
    { lotId: "a", unitPrice: "", quantity: "20.000", firstPurchasedAt: oct1 },
    { lotId: "c", unitPrice: "", quantity: "100.000", firstPurchasedAt: new Date("2026-10-20") },
  ];
  let picks: LotPick[] = [];
  const { rerender } = render(<LotPicker oldestFirst name="Soda Ash" unit="kg" required="25" lots={lots} value={picks} onChange={(next) => (picks = next)} />);
  expect(picks).toEqual([{ lotId: "a", quantity: "20.000" }, { lotId: "c", quantity: "5.000" }]);
  rerender(<LotPicker oldestFirst name="Soda Ash" unit="kg" required="25" lots={lots} value={[{ lotId: "c", quantity: "25" }]} onChange={(next) => (picks = next)} />);
  expect(screen.queryByText(/Rs/)).toBeNull();
  expect(screen.getByLabelText("Lot 1 Oct, 20 kg here")).toBeTruthy();
  expect(screen.getByText("Soda Ash: use the oldest stock first. Take 20 kg from Lot 1 Oct before a newer lot.")).toBeTruthy();
  expect(lotPicksValid("25", [{ lotId: "c", quantity: "25" }], lots, "Soda Ash", "kg", true)).toBe(false);
});
```

Change line 30's expected text to the date form (`"Soda Ash: Lot <date> has only 120 kg here"`, matching that test's lot date).

- [ ] **Step 7: Build the picker mode**

In `lot-picker.tsx`:
- `lotPicksValid(required, picks, lots, name, unit, oldestFirst = false)` also returns false when `oldestFirst` and `checkOldestFirst(...)` has errors.
- New props `oldestFirst?: boolean` and `hidePrices?: boolean`. With `oldestFirst`, use `oldestFirstPicks` instead of `defaultLotPicks` for both the pre-fill and the "untouched pre-fill follows the new requirement" check. With `oldestFirst || hidePrices`, use `lotDateLabel(lot, lots)` instead of `lotLabel(lot, unit)` in labels. Append `checkOldestFirst(...)` messages to `errors` (after the `checkLotPicks` errors, de-duplicated).
- Without either prop, behaviour stays exactly as today (transfers keep prices and free picks).

Pass `oldestFirst` to the `LotPicker` in `start-mixing-dialog.tsx` and `batch-packing-form.tsx`. Pass `true` as the last argument to each `lotPicksValid(...)` call in those two files. In `batch-packing-form.tsx:607`, change the description to "Stock is taken from the oldest lot first." In `start-mixing-dialog.tsx:38`, change it to "Stock is taken from the oldest lot first. Lots must add up to the formula amount."

- [ ] **Step 8: Write the failing integration case**

Add to `src/__tests__/integration/material-lot-mixing.test.ts` (its seed has lot A Rs 115 × 120 and lot B Rs 125 × 80, created in that order):

```ts
  it("refuses a newer lot while an older one still has stock", () => withRollback(async (tx) => {
    const { context, run, chemical, lotA, lotB } = await seed(tx);
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "100" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never))
      .rejects.toThrow("lots add up to 180");
    await tx.update(formulaIngredients).set({ quantityPerBatch: "100" }).where(eq(formulaIngredients.chemicalId, chemical.id));
    await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "20" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never))
      .rejects.toThrow("use the oldest stock first. Take 100 kg from Lot");
  }));
```

In `src/__tests__/integration/batch-packing.test.ts`, the tests at `:109` and `:125` take one carton from `f.cartonLot` (1,000 in stock) and one from the newer `dearer` lot. First move `f.cartonLot` down to exactly 1 carton (`moveLotStock(tx, { ref: cartonRef, lotId: f.cartonLot.id, warehouseId: f.warehouse.id, delta: "-999", sourceType: "adjustment" })`), so taking 1 + 1 is oldest-first. Keep their assertions.

- [ ] **Step 9: Run everything touched**

```bash
bun run test -- src/lib/inventory/material-lots.test.ts src/__tests__/lot-picker.behavior.test.tsx src/__tests__/start-mixing-dialog.behavior.test.tsx src/__tests__/batch-packing-form.behavior.test.tsx
DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-mixing.test.ts src/__tests__/integration/batch-packing.test.ts src/__tests__/integration/material-lots-flow.test.ts
bun run typecheck
```
Expected: PASS. If a behavior test now fails only because its picks or labels were price-based or skipped an older lot, update its fixture or expected label to the oldest-first form. Don't weaken what it checks.

- [ ] **Step 10: Commit**

```bash
git add src/lib/inventory src/server-functions/inventory/stock/get-material-lots-fn.ts src/server-functions/manufacturing src/components/inventory/lot-picker.tsx src/components/mixing/start-mixing-dialog.tsx src/components/packaging/batch-packing-form.tsx src/__tests__
git commit -m "feat(production): use oldest stock first in mixing and packing and hide lot prices from operators"
```

---

### Task 4: "Measured in KG" switch in material setup

**Files:**
- Modify: `src/lib/validators/validators.ts:120-145` (`addPackagingMaterialSchema`)
- Modify: `src/server-functions/inventory/add-packaging-material-fn.ts:96-160`
- Modify: `src/components/inventory/add-packaging-material-form.tsx` (primary section `:333-390`, quantity and cost fields)
- Modify: `src/server-functions/inventory/update-material-fn.ts`
- Modify: `src/components/inventory/edit-material-dialog.tsx`
- Test: `src/__tests__/integration/shopper-kg-setup.test.ts`
- Test: `src/__tests__/shopper-kg-setup.behavior.test.tsx`

**Interfaces:**
- Consumes: `packagingUnit` (Task 2).
- Produces: `addPackagingMaterialSchema.measuredInKg: z.boolean().default(false)`. `updateMaterialFn` data accepts `measuredInKg?: boolean` and `weightPerPack?: string`. Exported helper `kgSwitchLocked(tx, materialId): Promise<boolean>` from `src/server-functions/inventory/update-material-fn.ts`. Error text when locked: "Measured in KG can't change once this material has stock or has been used."

- [ ] **Step 1: Write the failing integration test**

Follow the mock header from `src/__tests__/integration/material-lot-mixing.test.ts` (mock `@tanstack/react-start`, `@/lib/middlewares` with `requireInventoryManageMiddleware: {}`, `@/lib/activity-logger.server`) and use `withRollback`.

```ts
// src/__tests__/integration/shopper-kg-setup.test.ts
// (mock header as in material-lot-mixing.test.ts)
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, warehouses, suppliers, packagingMaterials, purchaseRecords, materialLots } from "@/db";
import { addPackagingMaterialFn } from "@/server-functions/inventory/add-packaging-material-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { withRollback } from "./with-rollback";

const purchase = { notes: "", invoiceNumber: "", paymentMethod: "cash", walletId: "", paymentStatus: "unpaid" as const, amountPaid: "", transactionId: "", bankName: "" };

async function seed(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Store", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: id }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: ["inventory.manage"] } };
  return { id, floor, supplier, context };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("shoppers measured in KG", () => {
  it("buys shoppers as KG × price per KG and opens a per-KG lot", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    await addPackagingMaterialFn({ data: { ...purchase, name: `${id} 100g shopper`, warehouseId: floor.id, quantity: "50", costPerUnit: "1", minimumStockLevel: 10, type: "primary", capacity: "", capacityUnit: "", measuredInKg: true, weightPerPack: "1.0", pricePerKg: "520", associatedStickerId: "", stickerCost: "", supplierId: supplier.id }, context } as never);
    const [material] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.name, `${id} 100g shopper`));
    expect(material.measuredInKg).toBe(true);
    expect(material.costPerUnit).toBe("520.00");
    const [bought] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.packagingMaterialId, material.id));
    expect([bought.quantity, bought.unitCost, bought.cost]).toEqual(["50.000", "520.00", "26000.00"]);
    const [lot] = await tx.select().from(materialLots).where(eq(materialLots.packagingMaterialId, material.id));
    expect(lot.unitPrice).toBe("520.00");
  }));

  it("requires weight and price, and only allows it on primary packaging", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    const base = { ...purchase, warehouseId: floor.id, quantity: "0", costPerUnit: "0", minimumStockLevel: 0, capacity: "", capacityUnit: "", associatedStickerId: "", stickerCost: "", supplierId: supplier.id, measuredInKg: true };
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-a`, type: "primary", weightPerPack: "", pricePerKg: "520" }, context } as never)).rejects.toThrow("Weight of one shopper");
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-b`, type: "primary", weightPerPack: "1", pricePerKg: "" }, context } as never)).rejects.toThrow("Price per KG");
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-c`, type: "master", weightPerPack: "1", pricePerKg: "520" }, context } as never)).rejects.toThrow("Only primary packaging");
  }));

  it("locks the switch once the material has stock or history", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    const [empty] = await tx.insert(packagingMaterials).values({ name: `${id}-empty`, type: "primary", costPerUnit: "2" }).returning();
    const fields = { name: empty.name, costPerUnit: "520", minimumStockLevel: 0, materialType: "primary", measuredInKg: true, weightPerPack: "1.0" };
    await updateMaterialFn({ data: { id: empty.id, type: "packaging", data: fields }, context } as never);
    const [switched] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, empty.id));
    expect(switched.measuredInKg).toBe(true);

    await addPackagingMaterialFn({ data: { ...purchase, name: `${id}-stocked`, warehouseId: floor.id, quantity: "100", costPerUnit: "2", minimumStockLevel: 0, type: "primary", capacity: "", capacityUnit: "", measuredInKg: false, weightPerPack: "", pricePerKg: "", associatedStickerId: "", stickerCost: "", supplierId: supplier.id }, context } as never);
    const [stocked] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.name, `${id}-stocked`));
    await expect(updateMaterialFn({ data: { id: stocked.id, type: "packaging", data: { ...fields, name: stocked.name } }, context } as never))
      .rejects.toThrow("Measured in KG can't change once this material has stock or has been used.");
  }));
});
```

Check the `suppliers` insert against `src/db/schemas/supplier-schema.ts` and add any other required columns there.

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/shopper-kg-setup.test.ts`
Expected: FAIL. `measuredInKg` is stripped by the schema, so the material is saved in pieces.

- [ ] **Step 3: Validate and save the switch when adding**

In `addPackagingMaterialSchema` (`src/lib/validators/validators.ts`), add `measuredInKg: z.boolean().default(false),` after `pricePerKg`.

In `add-packaging-material-fn.ts`, before the `insert(packagingMaterials)`:

```ts
      // Shoppers in KG: the KG price is the unit price, and the shopper weight drives loss maths.
      if (data.measuredInKg) {
        if (data.type !== "primary") throw new Error("Only primary packaging can be measured in KG");
        if (!(Number(data.weightPerPack) > 0)) throw new Error("Weight of one shopper (grams) is required");
        if (!(Number(data.pricePerKg) > 0)) throw new Error("Price per KG is required");
      }
      const unitPrice = data.measuredInKg ? data.pricePerKg : data.costPerUnit;
```

Then use `unitPrice` instead of `data.costPerUnit` in three places: `costPerUnit: lotPrice(unitPrice)`, `findOrCreateLot(tx, ref, unitPrice)` and the `totalCost` line (`parseFloat(unitPrice) * parseFloat(data.quantity)`). Add `measuredInKg: data.measuredInKg,` to the insert values.

- [ ] **Step 4: Lock the switch when editing**

In `update-material-fn.ts`, extend `data` in the schema with `measuredInKg: z.boolean().optional(), weightPerPack: z.string().optional(),`. Add the imports (`gt`, `packagingMaterialsUsed` from `@/db/schemas/production-schema`, `type Tx` from `@/lib/inventory/material-lots.server`). Then add:

```ts
// Old quantities must never change meaning, so the unit is fixed once stock or history exists.
export async function kgSwitchLocked(tx: Tx, materialId: string) {
  const [lot] = await tx.select({ id: materialLots.id }).from(materialLots).where(eq(materialLots.packagingMaterialId, materialId)).limit(1);
  const [stock] = await tx.select({ id: materialStock.id }).from(materialStock)
    .where(and(eq(materialStock.packagingMaterialId, materialId), gt(materialStock.quantity, "0"))).limit(1);
  const [used] = await tx.select({ id: packagingMaterialsUsed.id }).from(packagingMaterialsUsed).where(eq(packagingMaterialsUsed.materialId, materialId)).limit(1);
  return !!(lot || stock || used);
}
```

In the packaging `else` branch, before the update, add:

```ts
          const [current] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, id)).for("update");
          if (!current) throw new Error("Packaging material not found");
          const measuredInKg = fields.measuredInKg ?? current.measuredInKg;
          const type = fields.materialType ?? current.type;
          if (measuredInKg !== current.measuredInKg && await kgSwitchLocked(tx, id))
            throw new Error("Measured in KG can't change once this material has stock or has been used.");
          if (measuredInKg && type !== "primary") throw new Error("Only primary packaging can be measured in KG");
          const weightPerPack = fields.weightPerPack ?? current.weightPerPack;
          if (measuredInKg && !(Number(weightPerPack) > 0)) throw new Error("Weight of one shopper (grams) is required");
```

Then add `measuredInKg`, `weightPerPack: weightPerPack || null`, and (when `measuredInKg`) `pricePerKg: fields.costPerUnit` to the `.set({...})`.

- [ ] **Step 5: Run the integration test**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/shopper-kg-setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing component test**

Render `AddPackagingMaterialForm` the way `src/__tests__/similar-material-warning.behavior.test.tsx` does (same mocks for server functions and hooks). Assert:

```tsx
it("asks for shopper weight and KG price when Measured in KG is on", async () => {
  // render the form with type "primary" selected
  fireEvent.click(screen.getByRole("switch", { name: "Measured in KG" }));
  expect(screen.getByLabelText("Weight of one shopper (grams)")).toBeTruthy();
  expect(screen.getByLabelText("Price per KG (PKR)")).toBeTruthy();
  expect(screen.getByLabelText("Initial stock (KG)")).toBeTruthy();
  expect(screen.queryByText("The Golden Formula")).toBeNull();
  expect(screen.queryByLabelText("Cost Per Unit (PKR)")).toBeNull();
});

it("shows the switch locked in the edit dialog once the item has stock", async () => {
  // render EditMaterialDialog with type "packaging" and item.quantity "10", item.packagingMaterial.type "primary"
  const toggle = screen.getByRole("switch", { name: "Measured in KG" });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Locked: this material already has stock or history.")).toBeTruthy();
});
```

Save as `src/__tests__/shopper-kg-setup.behavior.test.tsx`.

- [ ] **Step 7: Run it to verify it fails**

Run: `bun run test -- src/__tests__/shopper-kg-setup.behavior.test.tsx`
Expected: FAIL. There is no switch.

- [ ] **Step 8: Add the switch to the forms**

In `add-packaging-material-form.tsx`:
- Add `measuredInKg: false` to `defaultValues`.
- Inside the `activeType === "primary" && !isEditMode` block, above the weight and price grid, add a shadcn `Switch` (`@/components/ui/switch`; add it with `bunx shadcn@latest add switch` if missing) bound to `measuredInKg`, with a `<Label htmlFor=...>Measured in KG</Label>` and the description "Turn on for shoppers bought and used by weight."
- When the switch is on, change the labels: weight → "Weight of one shopper (grams)", price → "Price per KG (PKR)", quantity → "Initial stock (KG)". Hide the "Golden Formula" block and the "Cost Per Unit (PKR)" field. On submit, send `costPerUnit: values.pricePerKg`.
- When the type changes away from `primary`, set `measuredInKg` back to false.

In `edit-material-dialog.tsx`:
- Replace `const unit = type === "chemical" ? material?.unit || "kg" : "pcs";` with `const unit = type === "chemical" ? material?.unit || "kg" : packagingUnit(material);`.
- For packaging with type `primary`, show the same `Switch` (default `material.measuredInKg`). Lock it in the UI when `Number(item?.quantity) > 0 || lots.length > 0`, with the text "Locked: this material already has stock or history." The server makes the final decision.
- When the switch is on, show "Weight of one shopper (grams)" (default `material.weightPerPack`), and label cost as "Price per KG (PKR)".
- Send `measuredInKg` and `weightPerPack` in the `updateMaterial` payload.

- [ ] **Step 9: Run the tests and type check**

Run: `bun run test -- src/__tests__/shopper-kg-setup.behavior.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/validators/validators.ts src/server-functions/inventory/add-packaging-material-fn.ts src/server-functions/inventory/update-material-fn.ts src/components/inventory/add-packaging-material-form.tsx src/components/inventory/edit-material-dialog.tsx src/components/ui src/__tests__/integration/shopper-kg-setup.test.ts src/__tests__/shopper-kg-setup.behavior.test.tsx
git commit -m "feat(inventory): let primary packaging be measured in KG"
```

---

### Task 5: Shopper stock in KG everywhere, and KG purchases in Add stock

**Files:**
- Modify: `src/components/inventory/add-stock-dialog-form.tsx` (`CostCalculatorEffect` `:64-105`, restock reverse calc `:208-237`, primary grid `:443-490`, lot preview unit `:578-583`)
- Modify: `src/components/inventory/stock-table.tsx:200-203`
- Modify: `src/components/inventory/factory-floor-container.tsx:151`
- Modify: `src/components/inventory/inventory-details-dialog.tsx:144-146`, `:183`, `:249`
- Modify: `src/server-functions/inventory/stock/get-item-detail-paginated-fn.ts` (packaging branch: add `unit`)
- Modify: `src/server-functions/inventory/stock/transfer-stock-fn.ts:117`
- Modify: `src/server-functions/inventory/find-similar-materials-fn.ts:23`
- Modify: `src/server-functions/inventory/stock/get-low-stocks-alert-fn.ts:58`
- Modify: `src/server-functions/inventory/factory-floor/get-consumption-history-fn.ts:41` and `src/components/inventory/consumption-table.tsx:110-113`
- Modify: `src/components/inventory/transfer-stock-dialog.tsx:129` (check that `selectedMaterial.unit` now comes through for packaging)
- Test: `src/__tests__/shopper-kg-units.test.ts`

**Interfaces:**
- Consumes: `packagingUnit`, `packagingUnitSql` (Task 2), `packagingMaterials.measuredInKg` (Task 1).

- [ ] **Step 1: Write the failing source-inspection test**

```ts
// src/__tests__/shopper-kg-units.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("shopper stock is shown in KG", () => {
  it.each([
    "src/server-functions/inventory/stock/transfer-stock-fn.ts",
    "src/server-functions/inventory/find-similar-materials-fn.ts",
    "src/server-functions/inventory/stock/get-low-stocks-alert-fn.ts",
    "src/server-functions/inventory/factory-floor/get-consumption-history-fn.ts",
  ])("%s reads the packaging unit from the KG switch", (path) => {
    const source = read(path);
    expect(source).toContain("packagingUnitSql(packagingMaterials.measuredInKg)");
    expect(source).not.toContain("sql<string>`'pcs'`");
  });

  it.each([
    "src/components/inventory/stock-table.tsx",
    "src/components/inventory/factory-floor-container.tsx",
    "src/components/inventory/inventory-details-dialog.tsx",
    "src/components/inventory/edit-material-dialog.tsx",
    "src/components/inventory/add-stock-dialog-form.tsx",
  ])("%s uses packagingUnit for packaging", (path) => {
    expect(read(path)).toContain("packagingUnit(");
  });

  it("prices KG shoppers as KG × price per KG in Add stock", () => {
    const source = read("src/components/inventory/add-stock-dialog-form.tsx");
    expect(source).toContain("pkg.measuredInKg");
    expect(source).toContain("Formula: KG × Price/KG");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/__tests__/shopper-kg-units.test.ts`
Expected: FAIL.

- [ ] **Step 3: Server selects**

In each of the four server files, replace `sql<string>\`'pcs'\`` (or `packagingMaterials.capacityUnit` in the low-stock file, or `sql<string>\`'units'\`` in consumption history) with `packagingUnitSql(packagingMaterials.measuredInKg)`, imported from `@/lib/inventory/material-units.server`. In `find-similar-materials-fn.ts`, add `packagingMaterials.measuredInKg` to the `groupBy`. In `get-consumption-history-fn.ts`, keep the alias: `sql<string>\`${packagingUnitSql(packagingMaterials.measuredInKg)}\`.as("material_unit")`. Then in the returned `packagingMaterial`, pass `{ name: row.materialName, unit: row.materialUnit }`.

In `get-item-detail-paginated-fn.ts`, packaging branch, add `unit: packagingUnit(result),` to `item`.

- [ ] **Step 4: Client displays**

Replace each packaging fallback with `packagingUnit(material)` (import from `@/lib/inventory/material-units`):
- `stock-table.tsx`: `{(isChemical ? material?.unit || "kg" : packagingUnit(material)).toUpperCase()}`
- `factory-floor-container.tsx:151`: `unit: type === "chemical" ? material.unit || "kg" : packagingUnit(material),`
- `inventory-details-dialog.tsx` (three places): `type === "packaging" ? packagingUnit(material) : material.unit || "kg"` (keep the `isFinished` branches).
- `consumption-table.tsx`: `: row.original.packagingMaterial?.unit ?? "pcs"` (and add `unit?: string` to its `packagingMaterial` type).
- `add-stock-dialog-form.tsx:578-583`: `unit={materialType === "chemical" ? (activeMaterial as any)?.unit || "" : packagingUnit(activeMaterial as any)}`.

- [ ] **Step 5: KG purchase entry in Add stock**

In `CostCalculatorEffect`, inside `if (pkg.type === "primary")`, before the weight formula:

```ts
        if (pkg.measuredInKg) {
          // Shoppers are bought by weight: KG × price per KG.
          const price = parseFloat(pricePerKg || "0");
          if (price > 0) total = price * qty;
        } else {
          // existing weight formula unchanged
        }
```

In the restock reverse calc, when `activeMaterial.measuredInKg`, use `setPricePerKg((totalCost / qty).toFixed(2))`.

In the primary grid: when `activeMaterial.measuredInKg`, label quantity "Qty (KG)", hide the "Weight/Pack (g)" box, and set the formula line to `<span>Formula: KG × Price/KG</span>`. Non-KG primary keeps today's three boxes and formula.

`Math.round(total)` in `CostCalculatorEffect` stays as it is. The lot price is still cost ÷ quantity, which matches the KG price when the total is a whole number.

- [ ] **Step 6: Run the tests and type check**

Run: `bun run test -- src/__tests__/shopper-kg-units.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory src/server-functions/inventory src/__tests__/shopper-kg-units.test.ts
git commit -m "feat(inventory): show and buy shoppers in KG"
```

---

### Task 6: Mixing completion records real use

**Files:**
- Modify: `src/server-functions/manufacturing/mixing/complete-mixing-run-core.server.ts` (rewrite)
- Modify: `src/server-functions/manufacturing/mixing/complete-mixing-run-fn.ts`
- Modify: `src/server-functions/manufacturing/mixing/log-mixing-progress-fn.ts:13`, `:67-80` (remove auto-complete)
- Modify: `src/server-functions/manufacturing/mixing/get-mixing-run-fn.ts:37-41` (include `lot`)
- Modify: `src/lib/inventory/material-lots.server.ts:7` (add `"mixing_return"` to `LotSourceType`)
- Modify: `src/__tests__/integration/two-phase-production.test.ts:1022`, `:1028-1030`
- Test: `src/__tests__/integration/mixing-actual-use.test.ts`

**Interfaces:**
- Consumes: `MIXING_REASONS`, `reasonCodes`, `checkReason`, `mixingUseChange`, `groupFormulaUse` (Task 2). `takeLotPicks` with `oldestFirst` (Task 3). `lockMaterialStock`, `moveLotStock` (Part 1). `checkLotPicks`, `costLotPicks`, `lotPickSchema` (Part 1).
- Produces:
  - `mixingUseSchema` = `z.object({ chemicalId, used: string (≤3 decimals), picks: LotPick[] (default []), reason?: MIXING code, note?: string ≤500 })`, exported from the core file. `type MixingUseInput`.
  - `completeMixingRunCore(tx, mixingRunId, userId, userName, input: { shortfallReason?: string; shortfallNote?: string; uses?: MixingUseInput[] })`.
  - `completeMixingRunFn` input: `{ mixingRunId, shortfallReason?: MIXING code, shortfallNote?: string, uses: MixingUseInput[] (default []) }`.
  - `getMixingRunFn` returns `materialsUsed[].lot` (`{ id, unitPrice, firstPurchasedAt }`) and `materialsUsed[].useType`.
  - Logging output no longer completes the batch, even at target.

- [ ] **Step 1: Write the failing integration test**

Copy the mock header and `seed()` from `src/__tests__/integration/material-lot-mixing.test.ts`, with these changes: formula of two chemicals, **Soda Ash 50 kg** (lots Rs 115 × 100 kg and Rs 125 × 100 kg on the floor) and **Silicate 20 kg** (lot Rs 90 × 50 kg); batch target 400 kg. Mock `@/lib/middlewares` with `requireManufacturingRunManageMiddleware: {}, requireProductionWorkCompleteMiddleware: {}, requireProductionWorkLogMiddleware: {}`. The context needs `authContext.permissions: ["manufacturing.run.manage"]`. Start the batch with `startMixingRunFn`, picking Soda Ash 50 from Rs 115 and Silicate 20 from Rs 90 (formula cost 50×115 + 20×90 = Rs 7,550).

```ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("mixing completion with actual use", () => {
  it("takes extra from picked floor lots, returns leftover to the batch's lots and costs the batch at lot prices", () => withRollback(async (tx) => {
    const f = await seedStarted(tx); // started, formula cost 7550
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    const [stillOpen] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect(stillOpen.status).toBe("in_progress"); // reaching target no longer completes

    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.soda.id, used: "55", picks: [{ lotId: f.soda115.id, quantity: "5" }] }] }, context: f.context } as never))
      .rejects.toThrow("Pick a reason for extra");

    await completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [
      { chemicalId: f.soda.id, used: "55", picks: [{ lotId: f.soda115.id, quantity: "5" }], reason: "spill" },
      { chemicalId: f.silicate.id, used: "18", picks: [{ lotId: f.silicate90.id, quantity: "2" }] },
    ] }, context: f.context } as never);

    const [done] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect(done.status).toBe("completed");
    expect(done.totalChemicalCost).toBe("7945.00"); // 7550 + 5×115 − 2×90
    expect(done.chemicalCostPerUnit).toBe("19.8625"); // 7945 ÷ 400
    const use = await tx.select().from(mixingMaterialUse).where(eq(mixingMaterialUse.mixingRunId, f.run.id));
    expect(use.map((row) => [row.chemicalId, row.formulaQuantity, row.usedQuantity, row.extraQuantity, row.extraCost, row.reason]).sort()).toEqual([
      [f.soda.id, "50.000", "55.000", "5.000", "575.00", "spill"],
      [f.silicate.id, "20.000", "18.000", "-2.000", "-180.00", null],
    ].sort());
    const rows = await tx.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, f.run.id));
    expect(rows.filter((row) => row.useType === "returned").map((row) => [row.lotId, row.quantityUsed, row.totalCost])).toEqual([[f.silicate90.id, "-2.000", "-180.00"]]);
    const balances = await listLotBalances(tx, f.floor.id, { materialType: "chemical", materialId: f.silicate.id });
    expect(balances.find((row) => row.lotId === f.silicate90.id)?.quantity).toBe("32.000"); // 50 − 20 + 2
  }));

  it("returns leftover only to lots the batch took", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.soda.id, used: "48", picks: [{ lotId: f.soda125.id, quantity: "2" }] }] }, context: f.context } as never))
      .rejects.toThrow("one picked lot has no stock here");
  }));

  it("blocks extra the floor doesn't have", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 400 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, uses: [{ chemicalId: f.silicate.id, used: "60", picks: [{ lotId: f.silicate90.id, quantity: "40" }], reason: "leak" }] }, context: f.context } as never))
      .rejects.toThrow("has only 30");
  }));

  it("needs a listed shortfall reason below target and keeps the note", () => withRollback(async (tx) => {
    const f = await seedStarted(tx);
    await logMixingProgressFn({ data: { mixingRunId: f.run.id, quantityProduced: 380 }, context: f.context } as never);
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id }, context: f.context } as never)).rejects.toThrow("shortfall reason");
    await expect(completeMixingRunFn({ data: { mixingRunId: f.run.id, shortfallReason: "other" }, context: f.context } as never)).rejects.toThrow('Write a note for "Other"');
    await completeMixingRunFn({ data: { mixingRunId: f.run.id, shortfallReason: "moisture_loss", shortfallNote: "humid day" }, context: f.context } as never);
    const [done] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, f.run.id));
    expect([done.shortfallReasonCode, done.shortfallReason, done.shortfallQuantity]).toEqual(["moisture_loss", "humid day", "20.000"]);
    const use = await tx.select().from(mixingMaterialUse).where(eq(mixingMaterialUse.mixingRunId, f.run.id));
    expect(use.every((row) => row.formulaQuantity === row.usedQuantity)).toBe(true); // unchanged rows saved as used = formula
  }));
});
```

Extra is oldest-first (Task 3). After the start took 50 kg from Rs 115, that lot still has 50 kg and is the oldest, so 5 kg from it is valid. Leftover is not oldest-first: it goes back to any lot the batch took.

Note on the second test: Soda Ash 125 has stock on the floor, but the batch never took from it. Its "taken" balance is missing from `takenLots`, so `checkLotPicks` reports "one picked lot has no stock here". That is the expected refusal.

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/mixing-actual-use.test.ts`
Expected: FAIL. The batch auto-completes at 400.

- [ ] **Step 3: Remove auto-complete**

In `log-mixing-progress-fn.ts`, delete the `// Check for auto-complete` block (the `currentOutput` and `targetOutput` lines and the `if` that calls `completeMixingRunCore`), the `completeMixingRunCore` import, and the now-unused `.returning()` result (keep the update). The operator completes from the console, where they confirm real use.

- [ ] **Step 4: Rewrite the completion core**

```ts
// src/server-functions/manufacturing/mixing/complete-mixing-run-core.server.ts
import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chemicals, inventoryAuditLog, materialLots } from "@/db/schemas/inventory-schema";
import { mixingMaterialUse, mixingMaterialsUsed, mixingRuns } from "@/db/schemas/production-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { checkLotPicks, costLotPicks, lotPickSchema } from "@/lib/inventory/material-lots";
import { lockMaterialStock, moveLotStock, takeLotPicks, type Tx } from "@/lib/inventory/material-lots.server";
import { MIXING_REASONS, checkReason, groupFormulaUse, mixingUseChange, reasonCodes } from "@/lib/production/material-use";

export const mixingUseSchema = z.object({
  chemicalId: z.string().min(1),
  used: z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "Use a number with up to 3 decimals"),
  picks: z.array(lotPickSchema).max(50).default([]),
  reason: z.enum(reasonCodes(MIXING_REASONS)).optional(),
  note: z.string().trim().max(500).optional(),
});
export type MixingUseInput = z.infer<typeof mixingUseSchema>;

export async function completeMixingRunCore(
  tx: Tx,
  mixingRunId: string,
  userId: string,
  userName: string,
  input: { shortfallReason?: string; shortfallNote?: string; uses?: MixingUseInput[] } = {},
) {
  const [mixingRun] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, mixingRunId)).for("update");
  if (!mixingRun) throw new Error("Mixing batch not found");
  if (mixingRun.status !== "in_progress") throw new Error("Only mixing batches in progress can be completed");

  const output = new Big(mixingRun.actualBulkProduced ?? 0);
  const target = new Big(mixingRun.targetBulkQuantity);
  if (output.lte(0)) throw new Error("A mixing batch with zero output must be marked failed");
  if (output.gt(target)) throw new Error("Mixing output exceeds the target");
  const shortfall = target.minus(output);
  if (shortfall.gt(0)) {
    if (!input.shortfallReason) throw new Error("A shortfall reason is required before completing below target");
    const error = checkReason(MIXING_REASONS, input.shortfallReason, input.shortfallNote, "completing below target");
    if (error) throw new Error(error);
  }

  // What the batch took at start, per chemical, with the lots it came from.
  const formulaRows = await tx
    .select({ chemicalId: mixingMaterialsUsed.chemicalId, lotId: mixingMaterialsUsed.lotId, quantity: mixingMaterialsUsed.quantityUsed, unitPrice: mixingMaterialsUsed.costPerUnit, firstPurchasedAt: materialLots.firstPurchasedAt })
    .from(mixingMaterialsUsed)
    .innerJoin(materialLots, eq(materialLots.id, mixingMaterialsUsed.lotId))
    .where(and(eq(mixingMaterialsUsed.mixingRunId, mixingRun.id), eq(mixingMaterialsUsed.useType, "formula")))
    .orderBy(mixingMaterialsUsed.createdAt, mixingMaterialsUsed.id);
  const planned = groupFormulaUse(formulaRows.map((row) => ({ ...row, lotId: row.lotId! })));
  const uses = input.uses ?? [];
  if (uses.some((use) => !planned.has(use.chemicalId))) throw new Error("Actual use was entered for a chemical that is not in this batch");
  if (new Set(uses.map((use) => use.chemicalId)).size !== uses.length) throw new Error("Enter each chemical's use only once");
  const chemicalRows = planned.size
    ? await tx.select({ id: chemicals.id, name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(inArray(chemicals.id, [...planned.keys()]))
    : [];
  await lockMaterialStock(tx, [mixingRun.warehouseId], [...planned.keys()].map((materialId) => ({ materialType: "chemical" as const, materialId })));

  for (const [chemicalId, plan] of [...planned].sort(([a], [b]) => a.localeCompare(b))) {
    const chemical = chemicalRows.find((row) => row.id === chemicalId);
    if (!chemical) throw new Error("Chemical not found");
    const ref = { materialType: "chemical" as const, materialId: chemicalId };
    const use = uses.find((row) => row.chemicalId === chemicalId);
    const change = mixingUseChange(plan.formula, use?.used ?? plan.formula);
    let extraCost = new Big(0);
    if (change.kind === "extra") {
      const error = checkReason(MIXING_REASONS, use?.reason, use?.note, `extra ${chemical.name}`);
      if (error) throw new Error(error);
      const picked = await takeLotPicks(tx, { warehouseId: mixingRun.warehouseId, ref, name: chemical.name, unit: chemical.unit, required: change.quantity, picks: use!.picks, sourceType: "mixing", sourceId: mixingRun.id, oldestFirst: true });
      for (const row of picked) {
        extraCost = extraCost.plus(row.totalCost);
        await tx.insert(mixingMaterialsUsed).values({ mixingRunId: mixingRun.id, chemicalId, lotId: row.lotId, quantityUsed: row.quantity, costPerUnit: row.unitPrice, totalCost: row.totalCost, useType: "extra" });
        await tx.insert(inventoryAuditLog).values({ warehouseId: mixingRun.warehouseId, materialType: "chemical", materialId: chemicalId, lotId: row.lotId, type: "debit", amount: row.quantity, reason: `Mixing batch ${mixingRun.batchId} used more than formula`, performedById: userId, referenceId: mixingRun.id });
      }
    } else if (change.kind === "leftover") {
      const picks = use?.picks ?? [];
      const errors = checkLotPicks({ name: chemical.name, unit: chemical.unit, required: change.quantity, picks, balances: plan.takenLots });
      if (errors.length) throw new Error(errors.join("; "));
      for (const row of costLotPicks(picks, plan.takenLots)) {
        extraCost = extraCost.minus(row.totalCost);
        await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: mixingRun.warehouseId, delta: row.quantity, sourceType: "mixing_return", sourceId: mixingRun.id });
        await tx.insert(mixingMaterialsUsed).values({ mixingRunId: mixingRun.id, chemicalId, lotId: row.lotId, quantityUsed: `-${row.quantity}`, costPerUnit: row.unitPrice, totalCost: `-${row.totalCost}`, useType: "returned" });
        await tx.insert(inventoryAuditLog).values({ warehouseId: mixingRun.warehouseId, materialType: "chemical", materialId: chemicalId, lotId: row.lotId, type: "credit", amount: row.quantity, reason: `Mixing batch ${mixingRun.batchId} leftover returned`, performedById: userId, referenceId: mixingRun.id });
      }
    }
    const used = new Big(use?.used ?? plan.formula);
    await tx.insert(mixingMaterialUse).values({
      mixingRunId: mixingRun.id, chemicalId, formulaQuantity: plan.formula, usedQuantity: used.toFixed(3),
      extraQuantity: used.minus(plan.formula).toFixed(3), extraCost: extraCost.toFixed(2),
      reason: change.kind === "extra" ? use!.reason! : null, note: change.kind === "extra" ? use?.note || null : null,
    });
  }

  const [{ total }] = await tx.select({ total: sql<string>`coalesce(sum(${mixingMaterialsUsed.totalCost}), 0)` }).from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, mixingRun.id));
  const totalChemicalCost = new Big(total);
  const yieldPercentage = output.div(target).times(100);
  await tx.update(mixingRuns).set({
    status: "completed",
    actualCompletionDate: new Date(),
    closedBy: userId,
    yieldPercentage: yieldPercentage.toFixed(2),
    shortfallQuantity: shortfall.toFixed(3),
    shortfallReasonCode: shortfall.gt(0) ? input.shortfallReason! : null,
    shortfallReason: shortfall.gt(0) ? input.shortfallNote?.trim() || null : null,
    totalChemicalCost: totalChemicalCost.toFixed(2),
    chemicalCostPerUnit: totalChemicalCost.div(output).toFixed(4),
  }).where(eq(mixingRuns.id, mixingRunId));

  logActivityQuiet({
    module: "manufacturing",
    action: "updated",
    entityType: "mixing_run",
    entityLabel: mixingRun.batchId,
    actorId: userId,
    actorName: userName,
    description: `Completed mixing batch ${mixingRun.batchId}. Yield: ${yieldPercentage.toFixed(2)}%`,
  });
}
```

Add `"mixing_return"` to `LotSourceType` in `material-lots.server.ts`.

- [ ] **Step 5: Update the server function and read**

In `complete-mixing-run-fn.ts`, change the schema and the call:

```ts
const completeMixingRunSchema = z.object({
  mixingRunId: z.string().min(1, "Mixing batch ID is required"),
  shortfallReason: z.enum(reasonCodes(MIXING_REASONS)).optional(),
  shortfallNote: z.string().trim().max(500).optional(),
  uses: z.array(mixingUseSchema).max(100).default([]),
});
// ...
      await completeMixingRunCore(tx, data.mixingRunId, context.session.user.id, context.session.user.name, {
        shortfallReason: data.shortfallReason, shortfallNote: data.shortfallNote, uses: data.uses,
      });
```

In `get-mixing-run-fn.ts`, change `materialsUsed: { with: { chemical: true } }` to `materialsUsed: { with: { chemical: true, lot: true } }`.

- [ ] **Step 6: Update the older integration test**

In `src/__tests__/integration/two-phase-production.test.ts`:
- Line 1022: `shortfallReason: "No yield"` → `shortfallReason: "spill"` (the input is now a list code; the check still fails on zero output).
- After line 1028 (logging the final 6), add `await invoke(completeMixingRunFn, { mixingRunId: f.run.id }, f.actor.id);` before reading `mixed`, because logging no longer completes the batch.

- [ ] **Step 7: Run the tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/mixing-actual-use.test.ts src/__tests__/integration/two-phase-production.test.ts src/__tests__/integration/material-lot-mixing.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/manufacturing/mixing src/lib/inventory/material-lots.server.ts src/__tests__/integration/mixing-actual-use.test.ts src/__tests__/integration/two-phase-production.test.ts
git commit -m "feat(mixing): record real chemical use when completing a batch"
```

---

### Task 7: Chemicals-used section on the mixing screen

**Files:**
- Create: `src/components/operator/mixing-actual-use.tsx`
- Modify: `src/components/operator/mixing-console.tsx`
- Modify: `src/components/inventory/lot-picker.tsx` (optional `legend` and `whereLabel` props)
- Test: `src/__tests__/mixing-actual-use.behavior.test.tsx`
- Modify (if broken): `src/__tests__/manufacturing-screens.behavior.test.tsx`

**Interfaces:**
- Consumes: `getMixingRunFn` result with `materialsUsed[].lot` and `useType` (Task 6). `MIXING_REASONS`, `checkReason`, `mixingUseChange`, `groupFormulaUse` (Task 2). `LotPicker` with `oldestFirst`/`hidePrices` and `lotPicksValid(..., oldestFirst)` (Task 3). `useMaterialLots` (Part 1). `completeMixingRunFn` input (Task 6).
- Produces:
  - `type ChemicalUseDraft = { used: string; picks: LotPick[]; reason: string; note: string }`.
  - `MixingActualUse({ rows, floorLots, value, onChange })`, where `rows: { chemicalId; name; unit; formula; takenLots: LotBalance[] }[]`.
  - `chemicalUseRows(materialsUsed)` turns `getMixingRunFn().materialsUsed` into `rows`.
  - `chemicalUseValid(row, draft, floorLots)` returns a boolean.
  - LotPicker: `legend?: string` (replaces `"<name>: <required> <unit> needed"`) and `whereLabel?: string` (replaces `"here"`).

- [ ] **Step 1: Write the failing component test**

Render `MixingActualUse` directly with this state wrapper:

```tsx
// src/__tests__/mixing-actual-use.behavior.test.tsx
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MixingActualUse, chemicalUseValid, type ChemicalUseDraft } from "@/components/operator/mixing-actual-use";

const at = new Date("2026-10-01");
const rows = [
  { chemicalId: "soda", name: "Soda Ash", unit: "kg", formula: "50.000", takenLots: [{ lotId: "s115", quantity: "50.000", unitPrice: "115.00", firstPurchasedAt: at }] },
  { chemicalId: "silicate", name: "Silicate", unit: "kg", formula: "20.000", takenLots: [{ lotId: "si90", quantity: "20.000", unitPrice: "90.00", firstPurchasedAt: at }] },
];
const floorLots = { soda: [{ lotId: "s115", quantity: "70.000", unitPrice: "115.00", firstPurchasedAt: at }, { lotId: "s125", quantity: "100.000", unitPrice: "125.00", firstPurchasedAt: at }] };

function Harness({ onState }: { onState?: (value: Record<string, ChemicalUseDraft>) => void }) {
  const [value, setValue] = useState<Record<string, ChemicalUseDraft>>({});
  return <MixingActualUse rows={rows} floorLots={floorLots} value={value} onChange={(next) => { setValue(next); onState?.(next); }} />;
}

describe("chemicals used at completion", () => {
  it("pre-fills Used with the formula amount and asks nothing for unchanged rows", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Soda Ash used (kg)") as HTMLInputElement).value).toBe("50");
    expect(screen.queryByText(/extra from/)).toBeNull();
    expect(chemicalUseValid(rows[0], undefined, [])).toBe(true);
  });

  it("asks for lots and a reason when more than formula was used", () => {
    let state: Record<string, ChemicalUseDraft> = {};
    render(<Harness onState={(next) => (state = next)} />);
    fireEvent.change(screen.getByLabelText("Soda Ash used (kg)"), { target: { value: "55" } });
    expect(screen.getByText("Soda Ash: +5 kg extra from")).toBeTruthy();
    expect(screen.getByLabelText("Reason for extra Soda Ash")).toBeTruthy();
    expect(chemicalUseValid(rows[0], state.soda, floorLots.soda)).toBe(false);
    expect(screen.queryByText(/Rs/)).toBeNull(); // operators never see prices
    fireEvent.change(screen.getByLabelText("Lot 1 Oct, 70 kg here"), { target: { value: "5" } }); // oldest lot, already pre-filled
    fireEvent.change(screen.getByLabelText("Reason for extra Soda Ash"), { target: { value: "spill" } });
    expect(chemicalUseValid(rows[0], state.soda, floorLots.soda)).toBe(true);
  });

  it("asks which taken lot the leftover goes back to, with no reason", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Silicate used (kg)"), { target: { value: "18" } });
    expect(screen.getByText("Silicate: 2 kg back to")).toBeTruthy();
    expect(screen.queryByLabelText("Reason for extra Silicate")).toBeNull();
    expect(screen.getByLabelText("Lot 1 Oct, 20 kg taken by this batch")).toBeTruthy();
    expect(screen.queryByText(/Rs/)).toBeNull();
  });

  it("needs a note for Other", () => {
    const draft = { used: "55", picks: [{ lotId: "s115", quantity: "5" }], reason: "other", note: "" };
    expect(chemicalUseValid(rows[0], draft, floorLots.soda)).toBe(false);
    expect(chemicalUseValid(rows[0], { ...draft, note: "pump" }, floorLots.soda)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/__tests__/mixing-actual-use.behavior.test.tsx`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Add the LotPicker props**

In `lot-picker.tsx`, add `legend?: string; whereLabel?: string` to the props. Use `legend ?? \`${name}: ${Number(required)} ${unit} needed\`` for the `<legend>` and `` `${lotLabel(lot, unit)}, ${Number(lot.quantity)} ${unit} ${whereLabel ?? "here"}` `` for each label. Behaviour for existing callers is unchanged.

- [ ] **Step 4: Write the section**

```tsx
// src/components/operator/mixing-actual-use.tsx
import Big from "big.js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LotPicker, lotPicksValid } from "@/components/inventory/lot-picker";
import type { LotBalance, LotPick } from "@/lib/inventory/material-lots";
import { MIXING_REASONS, checkReason, groupFormulaUse, mixingUseChange } from "@/lib/production/material-use";

export type ChemicalUseDraft = { used: string; picks: LotPick[]; reason: string; note: string };
export type ChemicalUseRow = { chemicalId: string; name: string; unit: string; formula: string; takenLots: LotBalance[] };

type MaterialUsed = { chemicalId: string; lotId: string | null; quantityUsed: string; costPerUnit: string; useType: string; chemical?: { name: string; unit: string } | null; lot?: { firstPurchasedAt: Date | string } | null };

export function chemicalUseRows(materialsUsed: MaterialUsed[] = []): ChemicalUseRow[] {
  const formula = materialsUsed.filter((row) => row.useType === "formula" && row.lotId);
  const grouped = groupFormulaUse(formula.map((row) => ({ chemicalId: row.chemicalId, lotId: row.lotId!, quantity: row.quantityUsed, unitPrice: row.costPerUnit, firstPurchasedAt: row.lot?.firstPurchasedAt ?? new Date() })));
  return [...grouped].map(([chemicalId, plan]) => {
    const chemical = formula.find((row) => row.chemicalId === chemicalId)?.chemical;
    return { chemicalId, name: chemical?.name ?? "Chemical", unit: chemical?.unit ?? "kg", formula: plan.formula, ...plan };
  });
}

function changeFor(row: ChemicalUseRow, draft?: ChemicalUseDraft) {
  try { return mixingUseChange(row.formula, draft?.used ?? row.formula); } catch { return null; }
}

export function chemicalUseValid(row: ChemicalUseRow, draft: ChemicalUseDraft | undefined, floorLots: LotBalance[]) {
  const change = changeFor(row, draft);
  if (!change) return false;
  if (change.kind === "same") return true;
  if (change.kind === "leftover") return lotPicksValid(change.quantity, draft!.picks, row.takenLots, row.name, row.unit);
  return !checkReason(MIXING_REASONS, draft!.reason, draft!.note, `extra ${row.name}`) && lotPicksValid(change.quantity, draft!.picks, floorLots, row.name, row.unit, true);
}

export function MixingActualUse({ rows, floorLots, value, onChange }: { rows: ChemicalUseRow[]; floorLots: Record<string, LotBalance[]>; value: Record<string, ChemicalUseDraft>; onChange: (next: Record<string, ChemicalUseDraft>) => void }) {
  const set = (row: ChemicalUseRow, change: Partial<ChemicalUseDraft>) => {
    const current = value[row.chemicalId] ?? { used: new Big(row.formula).toString(), picks: [], reason: "", note: "" };
    // A new Used amount means new lots: the old picks were for a different quantity.
    const picks = change.used !== undefined && change.used !== current.used ? [] : current.picks;
    onChange({ ...value, [row.chemicalId]: { ...current, picks, ...change } });
  };
  return (
    <section className="flex flex-col gap-4" aria-label="Chemicals used">
      <h3 className="text-base font-semibold">Chemicals used</h3>
      {rows.map((row) => {
        const draft = value[row.chemicalId];
        const change = changeFor(row, draft);
        const id = `use-${row.chemicalId}`;
        return (
          <div key={row.chemicalId} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-32 font-medium">{row.name}</span>
              <span className="text-sm text-muted-foreground">{`Formula: ${new Big(row.formula).toString()} ${row.unit}`}</span>
              <Label htmlFor={id} className="sr-only">{`${row.name} used (${row.unit})`}</Label>
              <Input id={id} aria-label={`${row.name} used (${row.unit})`} inputMode="decimal" className="w-32"
                value={draft?.used ?? new Big(row.formula).toString()} onChange={(event) => set(row, { used: event.target.value })} />
              <span className="text-sm">{row.unit}</span>
            </div>
            {!change && <p className="text-sm text-destructive">Enter the amount used, zero or more, with up to 3 decimals.</p>}
            {change?.kind === "extra" && (
              <>
                <LotPicker oldestFirst name={row.name} unit={row.unit} required={change.quantity} lots={floorLots[row.chemicalId] ?? []}
                  legend={`${row.name}: +${new Big(change.quantity).toString()} ${row.unit} extra from`} value={draft!.picks} onChange={(picks) => set(row, { picks })} />
                <div className="flex flex-wrap gap-3">
                  <NativeSelect aria-label={`Reason for extra ${row.name}`} value={draft!.reason} onChange={(event) => set(row, { reason: event.target.value })}>
                    <NativeSelectOption value="">Pick a reason</NativeSelectOption>
                    {MIXING_REASONS.map((reason) => <NativeSelectOption key={reason.code} value={reason.code}>{reason.label}</NativeSelectOption>)}
                  </NativeSelect>
                  <Input aria-label={`Note for extra ${row.name}`} placeholder={draft!.reason === "other" ? "Note (required)" : "Note (optional)"} maxLength={500}
                    value={draft!.note} onChange={(event) => set(row, { note: event.target.value })} className="flex-1" />
                </div>
              </>
            )}
            {change?.kind === "leftover" && (
              <LotPicker hidePrices name={row.name} unit={row.unit} required={change.quantity} lots={row.takenLots} whereLabel="taken by this batch"
                legend={`${row.name}: ${new Big(change.quantity).toString()} ${row.unit} back to`} value={draft!.picks} onChange={(picks) => set(row, { picks })} />
            )}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 5: Wire it into the console**

In `mixing-console.tsx`:
- State: `const [uses, setUses] = useState<Record<string, ChemicalUseDraft>>({});`, `const [shortfallCode, setShortfallCode] = useState("");`, `const [shortfallNote, setShortfallNote] = useState("");`. Keep `shortfallReason` state, but only for the zero-output fail flow.
- `const rows = chemicalUseRows(run?.materialsUsed as never);`
- `const extraIds = rows.filter((row) => changeFor-equivalent says "extra").map((row) => row.chemicalId);`. Export `changeFor` from the section file as `chemicalUseChange` so the console can use it. Then `const floor = useMaterialLots(run?.warehouseId, "chemical", extraIds);`. It only queries while some row has extra.
- Inside the completion card, when `canComplete && produced > 0`, render `<MixingActualUse rows={rows} floorLots={floor.data ?? {}} value={uses} onChange={setUses} />` above the button.
- When `produced > 0 && produced < target`, replace the free-text shortfall `Input` with a `NativeSelect` labelled "Reason for completing below target" (options from `MIXING_REASONS`) and an `Input` labelled "Shortfall note" (placeholder "Note (required for Other)"). When `produced === 0` and `canFail`, keep today's free-text `Input` with the placeholder "Reason for completing below target", for the fail button only.
- Disable completion unless: `produced > 0`, every row passes `chemicalUseValid(row, uses[row.chemicalId], floor.data?.[row.chemicalId] ?? [])`, and (`produced >= target` or `!checkReason(MIXING_REASONS, shortfallCode, shortfallNote, "completing below target")`).
- `handleComplete` sends:
  ```ts
  completeRun.mutate({ data: {
    mixingRunId: runId,
    ...(produced < target ? { shortfallReason: shortfallCode as never, shortfallNote: shortfallNote.trim() || undefined } : {}),
    uses: rows.map((row) => {
      const draft = uses[row.chemicalId];
      return { chemicalId: row.chemicalId, used: draft?.used ?? row.formula, picks: (draft?.picks ?? []).filter((pick) => pick.quantity !== ""), ...(draft?.reason ? { reason: draft.reason as never } : {}), ...(draft?.note.trim() ? { note: draft.note.trim() } : {}) };
    }),
  } });
  ```

- [ ] **Step 6: Run the component tests**

Run: `bun run test -- src/__tests__/mixing-actual-use.behavior.test.tsx src/__tests__/manufacturing-screens.behavior.test.tsx src/__tests__/lot-picker.behavior.test.tsx`
Expected: PASS. If `manufacturing-screens` fails, it is because its mocked run has no `materialsUsed` or because `useMaterialLots` is not mocked. Add `materialsUsed: []` to `mocks.run` and mock `@/hooks/stock/use-material-lots` to return `{ data: {} }`. Don't change what the tests assert.

- [ ] **Step 7: Type check and commit**

```bash
bun run typecheck
git add src/components/operator src/components/inventory/lot-picker.tsx src/__tests__/mixing-actual-use.behavior.test.tsx src/__tests__/manufacturing-screens.behavior.test.tsx
git commit -m "feat(mixing): enter chemicals really used when completing a batch"
```

---

### Task 8: Packing takes what was really used

**Files:**
- Modify: `src/server-functions/manufacturing/packaging/batch-packing-core.server.ts`
- Modify: `src/server-functions/manufacturing/packaging/get-batch-packing-context-fn.ts:25`
- Modify: `src/__tests__/integration/batch-packing.test.ts:79`, `:96`, `:191` (loss reasons become list codes)
- Test: `src/__tests__/integration/packing-actual-use.test.ts`

**Interfaces:**
- Consumes: `PACKING_REASONS`, `POWDER_LOSS_REASONS`, `reasonCodes`, `checkReason`, `checkPiecesUse`, `shopperNumbers` (Task 2). `packagingUnit` (Task 2). `packingMaterialUse`, `batchPackingReceipts.lossReasonCode`, `packagingMaterials.measuredInKg` (Task 1).
- Produces:
  - `packingMaterialUseSchema` = `materialLotPicksSchema.extend({ used?: string (≤3 decimals), reason?: PACKING code, note?: string ≤500 })`, exported from the core file.
  - `batchPackingSchema.lotPicks: packingMaterialUseSchema[]`. `lossReason?: POWDER code`. `lossNote?: string ≤500`.
  - Rules: pieces `used` defaults to needed. KG materials require `used`. Lot picks must add up to `used`.
  - Context `materials[]` gains `measuredInKg: boolean` and `weightPerPack: string | null`.

- [ ] **Step 1: Write the failing integration test**

Reuse `seed()`, `fixture()` and `record()` from `src/__tests__/integration/batch-packing.test.ts`. Move them into `src/__tests__/integration/batch-packing-fixture.ts` and export them; import them in both files. In this test, change the primary pack to a KG shopper and add a cap as an extra:

```ts
// src/__tests__/integration/packing-actual-use.test.ts
describe.skipIf(!process.env.TEST_DATABASE_URL)("packing with actual use", () => {
  it("takes the typed shopper KG from picked lots and saves expected, actual and loss", () => fixture(async (tx, f) => {
    await tx.update(packagingMaterials).set({ measuredInKg: true, weightPerPack: "1.000", pricePerKg: "520", costPerUnit: "520" }).where(eq(packagingMaterials.id, f.primary.id));
    const shopperLot = await findOrCreateLot(tx, { materialType: "packaging", materialId: f.primary.id }, "520");
    await moveLotStock(tx, { ref: { materialType: "packaging", materialId: f.primary.id }, lotId: shopperLot.id, warehouseId: f.warehouse.id, delta: "5", sourceType: "purchase" });
    // 27 cartons × 40 = 1,080 packs of 250 g = 270 kg bulk
    const lines = [{ recipeId: f.formats[0].id, fullCartons: 27, partialPacks: 0, loosePacks: 0 }];
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [
      { materialId: f.primary.id, picks: [{ lotId: shopperLot.id, quantity: "1.2" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "27" }] },
    ] }, f.actor)).rejects.toThrow("enter the KG used");

    const result = await recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [
      { materialId: f.primary.id, used: "1.2", picks: [{ lotId: shopperLot.id, quantity: "1.2" }] },
      { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "27" }] },
    ] }, f.actor);
    const [shopper] = await tx.select().from(packingMaterialUse).where(and(eq(packingMaterialUse.receiptId, result.receiptId), eq(packingMaterialUse.materialId, f.primary.id)));
    expect([shopper.measuredInKg, shopper.neededQuantity, shopper.usedQuantity, shopper.totalCost, shopper.shopperWeightGrams, shopper.expectedShoppers, shopper.actualShoppers, shopper.lossShoppers, shopper.extraCost])
      .toEqual([true, "1080.000", "1.200", "624.00", "1.000", 1200, 1080, 120, "62.40"]);
    const [allocation] = await tx.select().from(packagingAllocations).where(eq(packagingAllocations.packingReceiptId, result.receiptId));
    expect(allocation.totalPackagingCost).toBe("759.00"); // 624 shopper + 27 × 5 carton
  }));

  it("takes extra pieces with a reason and blocks fewer than needed", () => fixture(async (tx, f) => {
    const lines = [{ recipeId: f.formats[0].id, fullCartons: 2, partialPacks: 0, loosePacks: 0 }]; // 80 packs, 2 cartons
    const base = { materialId: f.master.id, picks: [{ lotId: f.cartonLot.id, quantity: "2" }] };
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "79", picks: [{ lotId: f.packLot.id, quantity: "79" }] }, base] }, f.actor))
      .rejects.toThrow("used can't be less than needed (80). Check the pack count instead.");
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", picks: [{ lotId: f.packLot.id, quantity: "83" }] }, base] }, f.actor))
      .rejects.toThrow("Pick a reason for extra");
    await expect(recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", reason: "broken", picks: [{ lotId: f.packLot.id, quantity: "80" }] }, base] }, f.actor))
      .rejects.toThrow("but 83 pcs is needed");
    const result = await recordBatchPackingCore(tx, { ...f.input, lines, lotPicks: [{ materialId: f.primary.id, used: "83", reason: "broken", picks: [{ lotId: f.packLot.id, quantity: "83" }] }, base] }, f.actor);
    const [pack] = await tx.select().from(packingMaterialUse).where(and(eq(packingMaterialUse.receiptId, result.receiptId), eq(packingMaterialUse.materialId, f.primary.id)));
    expect([pack.neededQuantity, pack.usedQuantity, pack.extraQuantity, pack.extraCost, pack.reason]).toEqual(["80.000", "83.000", "3.000", "6.00", "broken"]);
  }));

  it("saves the powder loss reason code and its note", () => fixture(async (tx, f) => {
    await expect(record(tx, { ...f.input, lossBulk: "1" }, f.actor)).rejects.toThrow("Pick a reason for powder loss");
    const result = await record(tx, { ...f.input, lossBulk: "1", lossReason: "stuck_in_machine", lossNote: "hopper" }, f.actor);
    const [receipt] = await tx.select().from(batchPackingReceipts).where(eq(batchPackingReceipts.id, result.receiptId));
    expect([receipt.lossReasonCode, receipt.lossReason]).toEqual(["stuck_in_machine", "hopper"]);
  }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/packing-actual-use.test.ts`
Expected: FAIL. `used` is stripped and no `packing_material_use` rows exist.

- [ ] **Step 3: Change the schema and the loss check**

In `batch-packing-core.server.ts`:

```ts
export const packingMaterialUseSchema = materialLotPicksSchema.extend({
  used: z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "Use a number with up to 3 decimals").optional(),
  reason: z.enum(reasonCodes(PACKING_REASONS)).optional(),
  note: z.string().trim().max(500).optional(),
});
```

In `batchPackingSchema`, replace `lossReason: z.string().max(2000).optional(),` with `lossReason: z.enum(reasonCodes(POWDER_LOSS_REASONS)).optional(), lossNote: z.string().trim().max(500).optional(),`, and set `lotPicks: z.array(packingMaterialUseSchema).max(100),`.

Replace the line `if (new Big(lossBulk).gt(0) && !data.lossReason?.trim()) throw ...` with:

```ts
  if (new Big(lossBulk).gt(0)) {
    const error = checkReason(POWDER_LOSS_REASONS, data.lossReason, data.lossNote, "powder loss");
    if (error) throw new Error(error);
  }
```

- [ ] **Step 4: Take what was really used**

Replace the body of the `for (const [materialId, need] of ...)` loop, up to (not including) the `for (const lot of picked)` share loop, with:

```ts
    const material = materials.find(row => row.id === materialId);
    if (!material) throw new Error("Packaging material not found");
    const unit = packagingUnit(material);
    const chosen = data.lotPicks.find(row => row.materialId === materialId);
    if (!chosen) throw new Error(`Pick lots for ${material.name}`);
    const needed = packingBulk(need.total.toString(), "Packaging material quantity");
    let used: string;
    let shopper: ReturnType<typeof shopperNumbers> | null = null;
    if (material.measuredInKg) {
      // Shoppers are weighed: the operator always types the KG, never pre-filled.
      if (!chosen.used || new Big(chosen.used).lte(0)) throw new Error(`${material.name}: enter the KG used`);
      used = packingBulk(chosen.used, `${material.name} KG used`);
      shopper = shopperNumbers({ kgUsed: used, gramsPerShopper: material.weightPerPack ?? "0", actualPacks: need.total.toNumber() });
    } else {
      used = chosen.used ? packingBulk(chosen.used, `${material.name} used`) : needed;
      const errors = checkPiecesUse({ name: material.name, needed, used, reason: chosen.reason, note: chosen.note });
      if (errors.length) throw new Error(errors.join("; "));
    }
    const picked = await takeLotPicks(tx, { warehouseId: run.warehouseId, ref: { materialType: "packaging", materialId }, name: material.name, unit, required: used, picks: chosen.picks, sourceType: "packing", sourceId: data.requestId, oldestFirst: true });
    const totalCost = picked.reduce((sum, lot) => sum.plus(lot.totalCost), new Big(0));
    const extra = shopper ? new Big(0) : new Big(used).minus(needed);
    // Cost of what went beyond the need: extra pieces, or shoppers the weight should have given.
    const extraCost = shopper
      ? (shopper.loss > 0 ? totalCost.times(shopper.loss).div(shopper.expected).round(2) : new Big(0))
      : totalCost.times(extra).div(used).round(2);
    useRows.push({ materialId, measuredInKg: material.measuredInKg, neededQuantity: needed, usedQuantity: used, extraQuantity: extra.toFixed(3), extraCost: extraCost.toFixed(2), totalCost: totalCost.toFixed(2),
      reason: extra.gt(0) ? chosen.reason! : null, note: extra.gt(0) ? chosen.note || null : null,
      shopperWeightGrams: shopper ? new Big(material.weightPerPack!).toFixed(3) : null, expectedShoppers: shopper?.expected ?? null, actualShoppers: shopper?.actual ?? null, lossShoppers: shopper?.loss ?? null });
```

Declare `const useRows: (typeof packingMaterialUse.$inferInsert & { receiptId?: string })[] = [];` before the loop, typed without `receiptId` (use `Omit<typeof packingMaterialUse.$inferInsert, "receiptId">[]`). The existing share loop stays as it is. It splits each picked lot by `need.byFormat / need.total`, so a shared material is split by how much each format needed: packs for per-pack materials, cartons for cartons.

Right after the `batchPackingReceipts` insert, set `lossReasonCode: data.lossReason ?? null` and `lossReason: data.lossNote?.trim() || null` in its values (replacing `lossReason: data.lossReason?.trim()`), and insert the use rows:

```ts
  if (useRows.length) await tx.insert(packingMaterialUse).values(useRows.map(row => ({ ...row, receiptId: receipt.id })));
```

Imports to add: `packingMaterialUse` from production schema, `packagingUnit` from `@/lib/inventory/material-units`, and `PACKING_REASONS, POWDER_LOSS_REASONS, checkPiecesUse, checkReason, reasonCodes, shopperNumbers` from `@/lib/production/material-use`.

The `payload` JSON already sorts `lotPicks`, so replays with the same `used` still match.

- [ ] **Step 5: Expose the KG fields to the form**

In `get-batch-packing-context-fn.ts`, change the materials select to `{ id: packagingMaterials.id, name: packagingMaterials.name, measuredInKg: packagingMaterials.measuredInKg, weightPerPack: packagingMaterials.weightPerPack }`.

- [ ] **Step 6: Update the older packing tests**

In `src/__tests__/integration/batch-packing.test.ts`: line 79 `lossReason: "changed"` → `lossReason: "machine_fault"`; line 96 `lossReason: "Spillage"` → `lossReason: "spill"`; line 191 `lossReason: "Powder loss"` → `lossReason: "other", lossNote: "Powder loss"`. Move `seed`, `withLots`, `record` and `fixture` into `batch-packing-fixture.ts` as described in Step 1.

- [ ] **Step 7: Run the tests**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/packing-actual-use.test.ts src/__tests__/integration/batch-packing.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/manufacturing/packaging src/__tests__/integration/packing-actual-use.test.ts src/__tests__/integration/batch-packing.test.ts src/__tests__/integration/batch-packing-fixture.ts
git commit -m "feat(packing): take real material use and measure shopper loss by KG"
```

---

### Task 9: Materials-used section on the packing screen

**Files:**
- Create: `src/components/packaging/material-use-row.tsx`
- Modify: `src/components/packaging/packing-draft.ts`
- Modify: `src/components/packaging/batch-packing-form.tsx` (`needed` `:270-280`, submission `:290-310`, materials card `:603-632`, loss section `:670-720`)
- Modify: `src/__tests__/batch-packing-form.behavior.test.tsx` (context mock gets `measuredInKg`/`weightPerPack`; loss reason typed into a select)
- Test: `src/__tests__/packing-material-use.behavior.test.tsx`

**Interfaces:**
- Consumes: context `materials[].measuredInKg/weightPerPack` (Task 8). `PACKING_REASONS`, `POWDER_LOSS_REASONS`, `checkPiecesUse`, `checkReason`, `shopperNumbers`, `SHOPPER_OVER_WARNING` (Task 2). `packagingUnit`.
- Produces:
  - Draft fields `materialUse: Record<materialId, { used: string; reason: string; note: string }>` (default `{}`) and `lossNote: string` (default `""`). `lossReason` now holds a code.
  - `MaterialUseRow({ name, unit, measuredInKg, needed, gramsPerShopper, value, onChange, disabled })` renders the Used input, the live shopper line or the pieces error, and the reason select plus note.
  - `materialUseErrors({ name, measuredInKg, needed, gramsPerShopper, value })` returns `string[]`.
  - `usedFor({ measuredInKg, needed, value })` returns the quantity the lot picker must add up to (`""` when KG is blank).

- [ ] **Step 1: Write the failing component tests**

```tsx
// src/__tests__/packing-material-use.behavior.test.tsx
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialUseRow, materialUseErrors, usedFor } from "@/components/packaging/material-use-row";

function Row(props: { measuredInKg: boolean; needed: string; name: string }) {
  const [value, setValue] = useState<{ used: string; reason: string; note: string } | undefined>();
  return <MaterialUseRow {...props} unit={props.measuredInKg ? "kg" : "pcs"} gramsPerShopper="1.0" value={value} onChange={setValue} disabled={false} />;
}

describe("packing materials used", () => {
  it("leaves shopper KG blank and shows the live expected, actual and loss line", () => {
    render(<Row measuredInKg needed="1080" name="100g shopper" />);
    const input = screen.getByLabelText("100g shopper used (kg)") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(materialUseErrors({ name: "100g shopper", measuredInKg: true, needed: "1080", gramsPerShopper: "1.0", value: undefined })).toEqual(["100g shopper: enter the KG used"]);
    fireEvent.change(input, { target: { value: "1.20" } });
    expect(screen.getByText("Expected 1,200 · Actual 1,080 · Loss 120 (10.0%)")).toBeTruthy();
    expect(screen.queryByLabelText("Reason for extra 100g shopper")).toBeNull();
  });

  it("warns when packs are more than the weight should give", () => {
    render(<Row measuredInKg needed="1010" name="100g shopper" />);
    fireEvent.change(screen.getByLabelText("100g shopper used (kg)"), { target: { value: "1" } });
    expect(screen.getByText("More packs than this weight should give. Check the shopper weight in material setup.")).toBeTruthy();
  });

  it("pre-fills pieces with Needed, asks a reason only above it, and blocks below it", () => {
    render(<Row measuredInKg={false} needed="1080" name="Cap 38mm" />);
    const input = screen.getByLabelText("Cap 38mm used (pcs)") as HTMLInputElement;
    expect(input.value).toBe("1080");
    expect(screen.queryByLabelText("Reason for extra Cap 38mm")).toBeNull();
    fireEvent.change(input, { target: { value: "1110" } });
    expect(screen.getByLabelText("Reason for extra Cap 38mm")).toBeTruthy();
    fireEvent.change(input, { target: { value: "1000" } });
    expect(screen.getByText("Cap 38mm: used can't be less than needed (1080). Check the pack count instead.")).toBeTruthy();
  });

  it("makes lots add up to Used, not Needed", () => {
    expect(usedFor({ measuredInKg: false, needed: "1080", value: { used: "1110", reason: "broken", note: "" } })).toBe("1110");
    expect(usedFor({ measuredInKg: false, needed: "1080", value: undefined })).toBe("1080");
    expect(usedFor({ measuredInKg: true, needed: "1080", value: undefined })).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/__tests__/packing-material-use.behavior.test.tsx`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Write the row component**

```tsx
// src/components/packaging/material-use-row.tsx
import Big from "big.js";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PACKING_REASONS, SHOPPER_OVER_WARNING, checkPiecesUse, shopperNumbers } from "@/lib/production/material-use";

export type MaterialUseDraft = { used: string; reason: string; note: string };
type RowInput = { name: string; measuredInKg: boolean; needed: string; gramsPerShopper: string | null; value: MaterialUseDraft | undefined };

const count = (value: number) => value.toLocaleString("en-US");

export function usedFor({ measuredInKg, needed, value }: { measuredInKg: boolean; needed: string; value: MaterialUseDraft | undefined }) {
  if (measuredInKg) return value?.used ?? "";
  return value?.used || new Big(needed).toString();
}

export function materialUseErrors(input: RowInput) {
  if (input.measuredInKg) {
    if (!input.value?.used) return [`${input.name}: enter the KG used`];
    try { shopperNumbers({ kgUsed: input.value.used, gramsPerShopper: input.gramsPerShopper ?? "0", actualPacks: Number(input.needed) }); return []; }
    catch (caught) { return [`${input.name}: ${caught instanceof Error ? caught.message : "check the KG used"}`]; }
  }
  return checkPiecesUse({ name: input.name, needed: input.needed, used: usedFor(input), reason: input.value?.reason, note: input.value?.note });
}

export function MaterialUseRow({ name, unit, measuredInKg, needed, gramsPerShopper, value, onChange, disabled }: RowInput & { unit: string; onChange: (value: MaterialUseDraft) => void; disabled: boolean }) {
  const current = value ?? { used: measuredInKg ? "" : new Big(needed).toString(), reason: "", note: "" };
  const used = usedFor({ measuredInKg, needed, value });
  let shopper: ReturnType<typeof shopperNumbers> | null = null;
  if (measuredInKg && used) { try { shopper = shopperNumbers({ kgUsed: used, gramsPerShopper: gramsPerShopper ?? "0", actualPacks: Number(needed) }); } catch { shopper = null; } }
  const errors = materialUseErrors({ name, measuredInKg, needed, gramsPerShopper, value });
  let extra = false;
  try { extra = !measuredInKg && new Big(used).gt(needed); } catch { extra = false; }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-40 font-medium">{measuredInKg ? `${name} (KG)` : name}</span>
        <span className="text-sm text-muted-foreground">{`Needed ${count(Number(needed))}${measuredInKg ? " packs" : ""}`}</span>
        <Input aria-label={`${name} used (${unit})`} inputMode="decimal" className="w-32" disabled={disabled}
          placeholder={measuredInKg ? "Weigh and enter" : undefined} value={current.used}
          onChange={(event) => onChange({ ...current, used: event.target.value })} />
        <span className="text-sm">{unit}</span>
      </div>
      {shopper && (
        <p className="text-sm text-muted-foreground">{`Expected ${count(shopper.expected)} · Actual ${count(shopper.actual)} · Loss ${count(shopper.loss)} (${shopper.lossPercent}%)`}</p>
      )}
      {shopper?.moreThanExpected && <p className="text-sm text-amber-600">{SHOPPER_OVER_WARNING}</p>}
      {extra && (
        <div className="flex flex-wrap gap-3">
          <NativeSelect aria-label={`Reason for extra ${name}`} value={current.reason} disabled={disabled} onChange={(event) => onChange({ ...current, reason: event.target.value })}>
            <NativeSelectOption value="">Pick a reason</NativeSelectOption>
            {PACKING_REASONS.map((reason) => <NativeSelectOption key={reason.code} value={reason.code}>{reason.label}</NativeSelectOption>)}
          </NativeSelect>
          <Input aria-label={`Note for extra ${name}`} placeholder={current.reason === "other" ? "Note (required)" : "Note (optional)"} maxLength={500} disabled={disabled}
            value={current.note} onChange={(event) => onChange({ ...current, note: event.target.value })} className="flex-1" />
        </div>
      )}
      {errors.length > 0 && current.used !== "" && errors.map((error) => <p key={error} className="text-sm text-destructive">{error}</p>)}
    </div>
  );
}
```

- [ ] **Step 4: Draft and submission**

In `packing-draft.ts`:
- Add `materialUse: z.record(z.string(), z.object({ used: z.string(), reason: z.string(), note: z.string() })).default({}),` and `lossNote: z.string().default(""),` to `packingDraftSchema`. Add `materialUse: {}`, `lossNote: ""` to `newPackingDraft()`.
- In `packingSubmissionSchema`, change `lotPicks` to `z.array(materialLotPicksSchema.extend({ used: z.string().optional(), reason: z.string().optional(), note: z.string().optional() })).default([])` and add `lossNote: z.string().optional()`.

In `batch-packing-form.tsx`:
- Extend each `needed` item with `measuredInKg`, `gramsPerShopper` (from `data.materials`), `unit: packagingUnit(material)`, `use: draft.materialUse[materialId]`, and `used: usedFor({ measuredInKg, needed: need.total.toString(), value: use })`.
- `lotsValid` becomes: every item has `materialUseErrors(...)` empty, and `lotPicksValid(item.used, item.picks, item.lots, item.name, item.unit, true)`.
- In the "Materials used" card, render for each item a bordered block with `<MaterialUseRow ... />`, then the `LotPicker` with `oldestFirst`, `required={item.used}` and `unit={item.unit}`. When `item.used === ""`, show "Enter the KG used to pick lots" instead of the picker. Change the card description to "Enter what was really used and pick the price lot it came from."
- `setMaterialUse(materialId, value)` updates `draft.materialUse[materialId]`. When `used` changes, also clear `draft.lotPicks[materialId]`, so the picker pre-fills again for the new total.
- In the submission, set `lotPicks` to `needed.map((item) => ({ materialId: item.materialId, picks: ..., used: item.used, ...(item.use?.reason ? { reason: item.use.reason } : {}), ...(item.use?.note.trim() ? { note: item.use.note.trim() } : {}) }))`. Add `lossReason` only when set, and `lossNote: draft.lossNote.trim() || undefined`.
- Powder loss: replace the "Reason for loss" `Input` with a `NativeSelect` (id `loss-reason-${batch.id}`, label "Reason for loss", options from `POWDER_LOSS_REASONS`), and add an `Input` labelled "Loss note" bound to `lossNote`. `lossError` becomes `checkReason(POWDER_LOSS_REASONS, draft.lossReason, draft.lossNote, "powder loss") ?? ""` when `loss.gt(0)`.

- [ ] **Step 5: Run the component tests**

Run: `bun run test -- src/__tests__/packing-material-use.behavior.test.tsx src/__tests__/batch-packing-form.behavior.test.tsx`
Expected: PASS. In `batch-packing-form.behavior.test.tsx`, add `measuredInKg: false, weightPerPack: null` to each mocked material. Where a test types a loss reason, change it to `fireEvent.change(screen.getByLabelText("Reason for loss"), { target: { value: "spill" } })`. Keep the assertions on posted payloads, and add `used` to the expected `lotPicks` entries.

- [ ] **Step 6: Type check and commit**

```bash
bun run typecheck
git add src/components/packaging src/__tests__/packing-material-use.behavior.test.tsx src/__tests__/batch-packing-form.behavior.test.tsx
git commit -m "feat(packing): enter materials really used and weighed shopper KG"
```

---

### Task 10: Fixed reasons for stock adjustments

**Files:**
- Modify: `src/server-functions/inventory/stock/adjust-stock-fn.ts`
- Modify: `src/server-functions/inventory/update-material-fn.ts` (the stock-change block from commit `937b906`)
- Modify: `src/components/inventory/adjust-stock-dialog.tsx` (generic reason `:590-606`, submit `:285-300`, disabled rule `:312-313`)
- Modify: `src/hooks/stock/use-adjust-stock.ts` (if its input type is declared there)
- Modify: `src/__tests__/integration/material-lot-adjustments.test.ts` (pass list codes)
- Test: add cases to `src/__tests__/integration/material-lot-adjustments.test.ts`
- Test: `src/__tests__/adjust-stock-reasons.behavior.test.tsx`

**Interfaces:**
- Consumes: `ADJUSTMENT_REASONS`, `reasonCodes`, `checkAdjustmentReason`, `adjustmentReasonsFor`, `reasonLabel` (Task 2). `materialAdjustments` (Task 1).
- Produces: `adjustStockFn` input `{ materialType, materialId, lotId, adjustment, reason: ADJUSTMENT code, note?: string }`. Each adjustment writes one `material_adjustments` row (`source: "manual"`). Edit-material stock changes write one row with `reason: "count_short" | "count_over"` and `source: "material_edit"`.

- [ ] **Step 1: Write the failing integration cases**

Add to `material-lot-adjustments.test.ts`, reusing its seed (a factory floor item with a lot):

```ts
  it("saves each adjustment with its lot, price and fixed reason", () => withRollback(async (tx) => {
    const f = await seed(tx);
    await expect(adjustStockFn({ data: { materialType: "chemical", materialId: f.chemical.id, lotId: f.lot.id, adjustment: -2, reason: "count_over" }, context: f.context } as never))
      .rejects.toThrow("Count over can't be used when removing stock");
    await expect(adjustStockFn({ data: { materialType: "chemical", materialId: f.chemical.id, lotId: f.lot.id, adjustment: -2, reason: "other" }, context: f.context } as never))
      .rejects.toThrow('Write a note for "Other"');
    await adjustStockFn({ data: { materialType: "chemical", materialId: f.chemical.id, lotId: f.lot.id, adjustment: -2, reason: "spilled", note: "drum tipped" }, context: f.context } as never);
    const [row] = await tx.select().from(materialAdjustments).where(eq(materialAdjustments.lotId, f.lot.id));
    expect([row.delta, row.unitPrice, row.value, row.reason, row.note, row.source]).toEqual(["-2.000", f.lot.unitPrice, new Big(f.lot.unitPrice).times(-2).toFixed(2), "spilled", "drum tipped", "manual"]);
  }));

  it("saves an edit-form quantity change as Count short or Count over", () => withRollback(async (tx) => {
    // use the existing edit-form case's setup; set the quantity 3 below current, picking f.lot
    const [row] = await tx.select().from(materialAdjustments).where(eq(materialAdjustments.lotId, f.lot.id));
    expect([row.reason, row.source]).toEqual(["count_short", "material_edit"]);
  }));
```

Update the file's existing `adjustStockFn` calls that pass free text: use `reason: "damaged"` for removals and `reason: "count_over"` for additions.

- [ ] **Step 2: Run them to verify they fail**

Run: `DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-adjustments.test.ts`
Expected: FAIL. Free text is still accepted and no rows are written.

- [ ] **Step 3: Server**

In `adjust-stock-fn.ts`:
- Schema: `reason: z.enum(reasonCodes(ADJUSTMENT_REASONS)), note: z.string().trim().max(500).optional(),`.
- At the start of the handler: `const reasonError = checkAdjustmentReason(data.reason, data.note, data.adjustment > 0); if (reasonError) throw new Error(reasonError);`.
- After `moveLotStock`, insert the adjustment row:
  ```ts
      await tx.insert(materialAdjustments).values({
        warehouseId: factoryFloor.id, materialType: data.materialType,
        chemicalId: data.materialType === "chemical" ? data.materialId : null,
        packagingMaterialId: data.materialType === "packaging" ? data.materialId : null,
        lotId: lot.id, delta: adjustment, unitPrice: lot.unitPrice,
        value: new Big(adjustment).times(lot.unitPrice).round(2).toFixed(2),
        reason: data.reason, note: data.note || null, source: "manual", performedById: context.session.user.id,
      });
  ```
- Audit reason text: `` `[MANUAL ADJUSTMENT] ${reasonLabel(ADJUSTMENT_REASONS, data.reason)}${data.note ? ` (${data.note})` : ""} | Material: ${materialName}` ``.

In `update-material-fn.ts`, inside `if (!delta.eq(0))` after `moveLotStock`, insert the same row with `warehouseId: row.warehouseId`, `delta: delta.toFixed(3)`, `reason: delta.gt(0) ? "count_over" : "count_short"`, `note: null`, `source: "material_edit"`.

- [ ] **Step 4: Write the failing dialog test**

```tsx
// src/__tests__/adjust-stock-reasons.behavior.test.tsx
// Render AdjustStockDialog the way src/__tests__/lot-picker.behavior.test.tsx renders pickers: mock
// useAdjustStock (capture mutate), useMaterialLots ({ data: { m1: [one lot with 10 here] } }) and the recovery hooks.
it("offers only removal reasons when removing, and needs a note for Other", async () => {
  // open in remove mode for material m1, enter 2
  const select = screen.getByLabelText("Reason");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Pick a reason", "Damaged", "Spilled", "Expired", "Count short", "Other"]);
  fireEvent.change(select, { target: { value: "other" } });
  expect((screen.getByRole("button", { name: /Adjust|Confirm/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "lid cracked" } });
  fireEvent.click(screen.getByRole("button", { name: /Adjust|Confirm/ }));
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: "other", note: "lid cracked", adjustment: -2 }) }), expect.anything());
});
it("offers Count over and Other when adding", async () => {
  // switch to add mode
  expect([...screen.getByLabelText("Reason").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Pick a reason", "Count over", "Other"]);
});
```

Before writing the assertions, read `adjust-stock-dialog.tsx` to find the exact button label and the add/remove toggle. Use those labels in the test.

- [ ] **Step 5: Dialog**

In `adjust-stock-dialog.tsx`, only when `!isChemicalRecoveryFlow`: replace the reason `Textarea` with a `NativeSelect` labelled "Reason" (id-linked `Label`), whose options come from `adjustmentReasonsFor(mode === "add")`, plus a `Textarea` labelled "Note" (required text shown only for Other). Keep a separate `reasonCode` and `note` state. Reset `reasonCode` when `mode` changes. The disabled rule for the generic flow uses `!!checkAdjustmentReason(reasonCode, note, mode === "add")` instead of `!reason.trim()`. Submit sends `reason: reasonCode, ...(note.trim() ? { note: note.trim() } : {})`. The recovery flow keeps its free-text `reason` unchanged.

- [ ] **Step 6: Run the tests**

Run: `bun run test -- src/__tests__/adjust-stock-reasons.behavior.test.tsx && DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-adjustments.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-functions/inventory src/components/inventory/adjust-stock-dialog.tsx src/hooks/stock src/__tests__/adjust-stock-reasons.behavior.test.tsx src/__tests__/integration/material-lot-adjustments.test.ts
git commit -m "feat(inventory): use fixed reasons for stock adjustments"
```

---

### Task 11: Whole-flow check, full test run, graph update

**Files:**
- Test: `src/__tests__/integration/actual-use-flow.test.ts`
- Test: `src/__tests__/actual-use-transactions.test.ts`

- [ ] **Step 1: Write the whole-flow test**

One integration test that runs the spec's examples end to end in one `withRollback`:
1. Seed a floor, a formula of Soda Ash 50 kg + LABSA 30 kg + Silicate 20 kg, lots on the floor (Soda Ash Rs 115 × 100), and a product format of 100 g packs, 24 per carton. The format uses a KG shopper (1.0 g, Rs 520/kg, 5 kg in stock), a cap (Rs 2, 2,000 pcs) as an extra per pack, and a carton (Rs 40, 100 pcs).
2. Start the batch with picks. Log 400 kg. Complete with Soda Ash used 55 (5 extra from Rs 115, reason `spill`) and Silicate 18 (2 back). Assert `totalChemicalCost` = formula cost + 575 − 2 × Silicate price, and `chemicalCostPerUnit` = that ÷ 400.
3. Pack 45 full cartons (1,080 packs): shopper 1.20 kg, cap used 1,110 (`broken`), carton 45. Assert `packing_material_use` rows: shopper expected 1,200 / actual 1,080 / loss 120; cap extra 30 at Rs 60. Assert the allocation `actualCostPerPack` = (chemical cost share + 624 + 2,220 + 1,800) ÷ 1,080, to 4 decimals.
4. Adjust the shopper by −0.5 kg with `damaged`. Assert one `material_adjustments` row with value −260.00.
5. Add a newer Soda Ash lot (Rs 125). Start a second batch picking only the newer lot. Assert it is refused with "use the oldest stock first". Then start it oldest-first and assert it succeeds.

- [ ] **Step 2: Write the transaction source-inspection test**

```ts
// src/__tests__/actual-use-transactions.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("actual use writes happen in one transaction through lot stock", () => {
  it("mixing completion runs inside the caller's transaction", () => {
    expect(read("src/server-functions/manufacturing/mixing/complete-mixing-run-fn.ts")).toContain("db.transaction(");
    const core = read("src/server-functions/manufacturing/mixing/complete-mixing-run-core.server.ts");
    expect(core).toContain("takeLotPicks(tx");
    expect(core).toContain("oldestFirst: true");
    expect(core).toContain("moveLotStock(tx");
    expect(core).not.toContain("db.transaction(");
    expect(core).not.toMatch(/update\(materialStock\)/);
  });
  it("packing takes lot picks that add up to Used", () => {
    const core = read("src/server-functions/manufacturing/packaging/batch-packing-core.server.ts");
    expect(core).toContain("required: used");
    expect(core).toContain("oldestFirst: true");
    expect(core).not.toContain("required: packingBulk(need.total");
  });
  it("mixing start is oldest-first and transfers stay free", () => {
    expect(read("src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts")).toContain("oldestFirst: true");
    expect(read("src/server-functions/inventory/stock/transfer-stock-core.server.ts")).not.toContain("oldestFirst");
  });
  it("logging output no longer completes a batch", () => {
    expect(read("src/server-functions/manufacturing/mixing/log-mixing-progress-fn.ts")).not.toContain("completeMixingRunCore");
  });
  it("adjustments write a reasoned row", () => {
    expect(read("src/server-functions/inventory/stock/adjust-stock-fn.ts")).toContain("insert(materialAdjustments)");
    expect(read("src/server-functions/inventory/update-material-fn.ts")).toContain("insert(materialAdjustments)");
  });
});
```

- [ ] **Step 3: Run everything**

```bash
bun run test
DATABASE_URL=$TEST_DATABASE_URL bunx vitest run --config vitest.integration.config.ts
bun run typecheck
bun run build
```
Expected: all pass. `src/__tests__/material-stock-writers.test.ts` (Part 1's guard) must still pass. If it lists allowed `moveLotStock` callers, add `complete-mixing-run-core.server.ts`.

- [ ] **Step 4: Update the graph and commit**

```bash
graphify update .
git add src/__tests__/integration/actual-use-flow.test.ts src/__tests__/actual-use-transactions.test.ts src/__tests__/material-stock-writers.test.ts graphify-out
git commit -m "test(production): cover the full actual material use flow"
```

---

## Self-review notes (for the executor)

- User change after the spec (2026-10-30): mixing and packing must use the **oldest stock first**, blocked if skipped, and operators never see prices: Task 3. It changes Part 1's mixing start and packing. Transfers stay free.
- Spec §1 (KG switch, lock, weight and price, purchase as KG × price, stock in KG everywhere): Tasks 4, 5
- §2 (mixing Used pre-filled, extra with lots and reason, leftover back to taken lots, blocked when floor is short, cost ÷ actual output, shortfall reason list): Tasks 6, 7
- §3 (packing Used, shopper KG never pre-filled, live line, negative-loss warning, pieces below needed blocked, lots add up to Used, one KG figure per shared shopper, cost spread over good packs, shared material split, powder-loss list): Tasks 8, 9
- §4 (adjustment reasons, count reasons saved automatically, additions not losses): Task 10. There is still no separate material stock-count screen (the stock-count sessions are for cartons). The edit-form quantity change is the count, so it is saved as Count short or Count over.
- §5 (saved for Part 3, with weight and prices copied): Task 1 tables, filled in Tasks 6, 8, 10
- Out of scope respected: old packing-job flow untouched; no editing of saved use.
- Differences from the spec to tell the user about:
  - (a) Logging mixing output no longer completes the batch automatically at target. The operator presses Complete, so they can confirm what was really used.
  - (b) Adjustment reasons follow direction. Removing can't use Count over. Adding can use only Count over or Other.
  - (c) Shopper minimum stock is a whole number of KG.
  - (d) A shared packaging material's cost is split by each format's need. That is the pack count for shoppers and caps, and the carton count for cartons.
  - (e) With oldest-first, there is only one correct split for any amount, so the picker is effectively a confirmation that the system fills in.
