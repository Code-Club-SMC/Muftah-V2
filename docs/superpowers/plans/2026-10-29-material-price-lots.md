# Material Price Lots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chemical and packaging material keeps its stock in price lots (one lot per price, per item), and a person picks lots on every transfer, mixing start and packing entry, so batch costs use exact purchase prices.

**Architecture:** Three new tables: `material_lots` (one row per item and price), `material_lot_stock` (quantity of a lot in a store), and `material_lot_movements` (append-only ledger of every lot change). The existing `material_stock` table stays as the per-item, per-store total, so every read screen (stock pages, low-stock, dashboard, factory floor) keeps working unchanged. One server module, `src/lib/inventory/material-lots.server.ts`, is the only code allowed to change material stock. It updates lot stock, the `material_stock` total and the movement ledger together, inside the caller's transaction. Stock that exists from before lots is turned into a lot lazily: the first time the module locks an item in a store, it creates the missing lot at the item's current price. No data migration file is needed.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (PostgreSQL), big.js, zod, React + TanStack Form/Query, shadcn/ui, Vitest (jsdom unit tests, real-DB integration tests via `vitest.integration.config.ts`), fast-check.

**Spec:** `docs/superpowers/specs/2026-10-29-material-price-lots-spec.md`

## Global Constraints

- Lot = one price of one item. Same price bought again joins the existing lot. Different price creates a new lot inside the same item. No more "-1" items.
- Prices match when equal to the paisa (two decimals): `lotPrice()` rounds half-up to 2 decimals.
- Always a person picks lots: storekeeper on transfers, operator in mixing and packing. No auto-pick, no oldest-first. The only pre-fill: when exactly one lot has stock in the store and it covers the whole need.
- Applies to all materials: chemicals and all packaging (primary, master/carton, sticker, extra).
- Lot picks must add up exactly to the needed quantity, and each pick must not exceed that lot's stock in that store. Quantities use up to 3 decimals.
- A lot whose quantity is zero everywhere stays on record but is hidden from pickers.
- Lot label shown to people: `Rs <price>/<unit> (first <d MMM>)`, e.g. `Rs 115/kg (first 1 Oct)`.
- Purchase edits: if nothing from the purchase was used or moved, quantity and price edits and delete work. Otherwise they're blocked with the exact message: "Some of this stock has already been used or moved, so the quantity and price can't change. Old batch costs would become wrong." Money fields (amount owed, payment status, invoice number, notes) stay editable.
- Existing stock becomes one lot per item and store, at the item's current `costPerUnit`. Existing "-1" items are not merged.
- Never hand-edit files under `src/db/migrations/`. Always run `bun run db:generate`.
- Do not edit `src/routeTree.gen.ts`.
- Amounts in UI use the existing PKR formatting helpers (`src/lib/currency-format.ts`).

## How to run tests

- Unit and component tests: `bun run test -- <path>`
- Integration tests (real PostgreSQL): you need a database whose name ends in `_test`. With docker compose running (`docker compose up -d`):
  ```bash
  export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/titan_test
  DATABASE_URL=$TEST_DATABASE_URL bun run db:migrate:test
  bunx vitest run --config vitest.integration.config.ts <path>
  ```
  If `TEST_DATABASE_URL` is not set, the integration suites skip themselves. Before marking any task with integration tests done, run them with the database.
- Type check: `bun run typecheck`

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schemas/inventory-schema.ts` (modify) | New tables `materialLots`, `materialLotStock`, `materialLotMovements` and their relations. New nullable `lotId` on `inventoryAuditLog`, `stockTransfers`, `productionMaterialsUsed` (left alone) |
| `src/db/schemas/supplier-schema.ts` (modify) | New nullable `lotId` on `purchaseRecords` |
| `src/db/schemas/production-schema.ts` (modify) | New nullable `lotId` on `mixingMaterialsUsed` and `packagingMaterialsUsed` |
| `src/lib/inventory/material-lots.ts` (create) | Pure rules: price normalising, pick validation, pick costing, untouched-purchase check, similar-name check, label, zod schemas. No DB. Safe for client import |
| `src/lib/inventory/material-lots.server.ts` (create) | The only writer of material stock: lock, lazy opening lots, find-or-create lot, move lot stock, take picks, list balances, relocate all |
| `src/server-functions/inventory/stock/get-material-lots-fn.ts` (create) | Read lots with stock for a store and a list of items |
| `src/server-functions/inventory/find-similar-materials-fn.ts` (create) | Typo guard lookup |
| `src/hooks/stock/use-material-lots.ts` (create) | Query hook for lots |
| `src/components/inventory/lot-picker.tsx` (create) | Reusable picker UI |
| Purchase, transfer, warehouse close, mixing start, packing, recovery, adjustment, purchase edit and delete server functions (modify) | Route every stock change through `material-lots.server.ts` |
| Matching dialogs and forms (modify) | Show the lot picker or lot preview |

---

### Task 1: Lot tables and lot columns

**Files:**
- Modify: `src/db/schemas/inventory-schema.ts`
- Modify: `src/db/schemas/supplier-schema.ts:43-84`
- Modify: `src/db/schemas/production-schema.ts:198-225` and `:357-390`
- Create (generated): new migration under `src/db/migrations/`
- Test: `src/__tests__/material-lots-schema.test.ts`

**Interfaces:**
- Produces: `materialLots`, `materialLotStock`, `materialLotMovements` exported from `@/db`. `src/db/index.ts` spreads the schema into `db` automatically, but its named exports are an explicit list (`export const { warehouses, chemicals, ... } = inventorySchema;`), so add the three names to that list. `lotId` columns: `purchaseRecords.lotId`, `inventoryAuditLog.lotId`, `stockTransfers.lotId`, `mixingMaterialsUsed.lotId`, `packagingMaterialsUsed.lotId`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/material-lots-schema.test.ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { materialLots, materialLotStock, materialLotMovements, inventoryAuditLog, stockTransfers } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { mixingMaterialsUsed, packagingMaterialsUsed } from "@/db/schemas/production-schema";

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((column) => column.name);

describe("material lot schema", () => {
  it("stores one lot per item and price", () => {
    expect(columns(materialLots)).toEqual(expect.arrayContaining(["id", "chemical_id", "packaging_material_id", "unit_price", "first_purchased_at"]));
    const indexes = getTableConfig(materialLots).indexes.map((index) => index.config.name);
    expect(indexes).toEqual(expect.arrayContaining(["material_lots_chemical_price_unique_idx", "material_lots_packaging_price_unique_idx"]));
  });

  it("stores lot quantity per store and an append-only movement ledger", () => {
    expect(columns(materialLotStock)).toEqual(expect.arrayContaining(["lot_id", "warehouse_id", "quantity"]));
    expect(columns(materialLotMovements)).toEqual(expect.arrayContaining(["lot_id", "warehouse_id", "delta", "source_type", "source_id", "created_at"]));
  });

  it("links usage and history rows to the lot", () => {
    for (const table of [purchaseRecords, inventoryAuditLog, stockTransfers, mixingMaterialsUsed, packagingMaterialsUsed]) {
      expect(columns(table)).toContain("lot_id");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/__tests__/material-lots-schema.test.ts`
Expected: FAIL with an import error ("materialLots" is not exported).

- [ ] **Step 3: Add the tables**

In `src/db/schemas/inventory-schema.ts`, directly after the `materialStock` table, add:

```ts
// --- MATERIAL PRICE LOTS ---
// One lot per item and price. Stock per store lives in material_lot_stock;
// material_stock keeps the per-item total and is only changed by
// src/lib/inventory/material-lots.server.ts.
export const materialLots = pgTable(
  "material_lots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(
      () => packagingMaterials.id,
    ),
    unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
    firstPurchasedAt: timestamp("first_purchased_at").defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    oneMaterial: check(
      "material_lots_one_material_ck",
      sql`(${t.chemicalId} IS NOT NULL) <> (${t.packagingMaterialId} IS NOT NULL)`,
    ),
    priceNotNegative: check("material_lots_price_ck", sql`${t.unitPrice} >= 0`),
    chemicalPriceUnique: uniqueIndex("material_lots_chemical_price_unique_idx")
      .on(t.chemicalId, t.unitPrice)
      .where(sql`${t.chemicalId} IS NOT NULL`),
    packagingPriceUnique: uniqueIndex("material_lots_packaging_price_unique_idx")
      .on(t.packagingMaterialId, t.unitPrice)
      .where(sql`${t.packagingMaterialId} IS NOT NULL`),
  }),
);

export const materialLotStock = pgTable(
  "material_lot_stock",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    lotId: text("lot_id")
      .notNull()
      .references(() => materialLots.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: decimal("quantity", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    ...timestamps,
  },
  (t) => ({
    lotWarehouseUnique: uniqueIndex("material_lot_stock_lot_warehouse_unique_idx").on(t.lotId, t.warehouseId),
    warehouseIdx: index("material_lot_stock_warehouse_idx").on(t.warehouseId),
    quantityNotNegative: check("material_lot_stock_quantity_ck", sql`${t.quantity} >= 0`),
  }),
);

// Append-only. Every lot quantity change writes one row here.
export const materialLotMovements = pgTable(
  "material_lot_movements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    lotId: text("lot_id")
      .notNull()
      .references(() => materialLots.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    delta: decimal("delta", { precision: 12, scale: 3 }).notNull(),
    // "opening" | "purchase" | "purchase_edit" | "purchase_delete" | "transfer_out" | "transfer_in"
    // | "mixing" | "packing" | "recovery" | "adjustment" | "warehouse_close"
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    lotWarehouseIdx: index("material_lot_movements_lot_warehouse_idx").on(t.lotId, t.warehouseId, t.createdAt),
    sourceIdx: index("material_lot_movements_source_idx").on(t.sourceType, t.sourceId),
  }),
);
```

Add to the same file's relations section (next to the other `relations(...)` calls):

```ts
export const materialLotsRelations = relations(materialLots, ({ one, many }) => ({
  chemical: one(chemicals, { fields: [materialLots.chemicalId], references: [chemicals.id] }),
  packagingMaterial: one(packagingMaterials, { fields: [materialLots.packagingMaterialId], references: [packagingMaterials.id] }),
  stock: many(materialLotStock),
}));

export const materialLotStockRelations = relations(materialLotStock, ({ one }) => ({
  lot: one(materialLots, { fields: [materialLotStock.lotId], references: [materialLots.id] }),
  warehouse: one(warehouses, { fields: [materialLotStock.warehouseId], references: [warehouses.id] }),
}));
```

- [ ] **Step 4: Add the `lotId` columns**

`inventoryAuditLog` (same file): add after `referenceId`:
```ts
    lotId: text("lot_id").references(() => materialLots.id),
```
`stockTransfers` (same file): add after `quantity`:
```ts
  lotId: text("lot_id").references(() => materialLots.id),
```
`purchaseRecords` in `src/db/schemas/supplier-schema.ts`: add after `packagingMaterialId` (import `materialLots` from `./inventory-schema` next to the existing `chemicals` and `packagingMaterials` import):
```ts
    lotId: text("lot_id").references(() => materialLots.id),
```
`mixingMaterialsUsed` and `packagingMaterialsUsed` in `src/db/schemas/production-schema.ts`: add after `chemicalId` / `materialId` (add `materialLots` to the existing `./inventory-schema` import):
```ts
    lotId: text("lot_id").references(() => materialLots.id),
```

In `src/db/index.ts`, add `materialLots, materialLotStock, materialLotMovements,` to the `export const { ... } = inventorySchema;` list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test -- src/__tests__/material-lots-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file and snapshot under `src/db/migrations/`, creating three tables and adding five `lot_id` columns. Don't edit them. If the generator prompts about renames, answer "create column" or "create table" (nothing is being renamed).

Apply locally: `bun run db:migrate`. Expected: success.

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck`. Expected: no new errors.

```bash
git add src/db/schemas src/db/migrations src/__tests__/material-lots-schema.test.ts
git commit -m "feat(inventory): add material price lot tables"
```

---

### Task 2: Pure lot rules

**Files:**
- Create: `src/lib/inventory/material-lots.ts`
- Test: `src/lib/inventory/material-lots.test.ts`

**Interfaces:**
- Produces (all exported from `@/lib/inventory/material-lots`):
  - `type MaterialType = "chemical" | "packaging"`
  - `type MaterialRef = { materialType: MaterialType; materialId: string }`
  - `type LotPick = { lotId: string; quantity: string }`
  - `type LotBalance = { lotId: string; unitPrice: string; quantity: string; firstPurchasedAt: Date | string }`
  - `type PickedLot = { lotId: string; quantity: string; unitPrice: string; totalCost: string }`
  - `lotPrice(value: string | number | Big): string`. 2-decimal string, half-up. Throws on negative.
  - `lotQuantity(value: string, label?: string): string`. 3-decimal string, throws if not a nonnegative number with at most 3 decimals.
  - `checkLotPicks(input: { name: string; unit: string; required: string; picks: LotPick[]; balances: LotBalance[] }): string[]`. An empty array means valid.
  - `costLotPicks(picks: LotPick[], balances: LotBalance[]): PickedLot[]`
  - `defaultLotPicks(required: string, balances: LotBalance[]): LotPick[]`
  - `purchaseUntouched(input: { balanceNow: string; movements: { delta: string; sourceType: string }[] }): boolean`
  - `normalizeMaterialName(name: string): string`
  - `isSimilarMaterialName(a: string, b: string): boolean`
  - `lotLabel(lot: { unitPrice: string; firstPurchasedAt: Date | string }, unit: string): string`
  - `lotPickSchema`, `materialLotPicksSchema` (zod), `type MaterialLotPicks = z.infer<typeof materialLotPicksSchema>` = `{ materialId: string; picks: LotPick[] }`
  - `PURCHASE_LOCKED_MESSAGE` (string constant, the exact message from Global Constraints)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/inventory/material-lots.test.ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Big from "big.js";
import {
  checkLotPicks, costLotPicks, defaultLotPicks, isSimilarMaterialName, lotLabel,
  lotPrice, lotQuantity, normalizeMaterialName, purchaseUntouched,
} from "./material-lots";

const balances = [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
];

describe("lotPrice", () => {
  it("rounds to the paisa, half up", () => {
    expect(lotPrice("115")).toBe("115.00");
    expect(lotPrice("115.005")).toBe("115.01");
    expect(lotPrice(new Big("114.994"))).toBe("114.99");
  });
  it("rejects negative prices", () => expect(() => lotPrice("-1")).toThrow());
});

describe("lotQuantity", () => {
  it("accepts up to three decimals", () => expect(lotQuantity("1.25")).toBe("1.250"));
  it("rejects more decimals and text", () => {
    expect(() => lotQuantity("1.2345")).toThrow();
    expect(() => lotQuantity("abc")).toThrow();
  });
});

describe("checkLotPicks", () => {
  const base = { name: "Soda Ash", unit: "kg", required: "200", balances };
  it("accepts picks that add up exactly", () => {
    expect(checkLotPicks({ ...base, picks: [{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }] })).toEqual([]);
  });
  it("reports a total that does not match", () => {
    expect(checkLotPicks({ ...base, picks: [{ lotId: "a", quantity: "100" }] })).toEqual([
      "Soda Ash: lots add up to 100 kg, but 200 kg is needed",
    ]);
  });
  it("reports a pick above lot stock", () => {
    expect(checkLotPicks({ ...base, required: "130", picks: [{ lotId: "a", quantity: "130" }] })).toContain(
      "Soda Ash: lot Rs 115.00 has only 120 kg here",
    );
  });
  it("reports unknown and repeated lots", () => {
    expect(checkLotPicks({ ...base, required: "10", picks: [{ lotId: "x", quantity: "10" }] })).toContain(
      "Soda Ash: one picked lot has no stock here",
    );
    expect(checkLotPicks({ ...base, required: "20", picks: [{ lotId: "a", quantity: "10" }, { lotId: "a", quantity: "10" }] })).toContain(
      "Soda Ash: pick each lot only once",
    );
  });
  it("rejects zero picks", () => {
    expect(checkLotPicks({ ...base, required: "10", picks: [{ lotId: "a", quantity: "0" }, { lotId: "b", quantity: "10" }] })).toContain(
      "Soda Ash: each picked quantity must be more than zero",
    );
  });
  it("never accepts picks whose sum differs from the requirement (property)", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 120_000 }), fc.integer({ min: 1, max: 80_000 }), fc.integer({ min: 1, max: 200_000 }), (a, b, need) => {
      const picks = [{ lotId: "a", quantity: new Big(a).div(1000).toFixed(3) }, { lotId: "b", quantity: new Big(b).div(1000).toFixed(3) }];
      const errors = checkLotPicks({ ...base, required: new Big(need).div(1000).toFixed(3), picks });
      expect(errors.length === 0).toBe(a + b === need);
    }));
  });
});

describe("costLotPicks", () => {
  it("costs each pick at its lot price", () => {
    expect(costLotPicks([{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }], balances)).toEqual([
      { lotId: "a", quantity: "120.000", unitPrice: "115.00", totalCost: "13800.00" },
      { lotId: "b", quantity: "80.000", unitPrice: "125.00", totalCost: "10000.00" },
    ]);
  });
});

describe("defaultLotPicks", () => {
  it("pre-fills only when exactly one lot has stock and it covers the need", () => {
    expect(defaultLotPicks("50", [balances[0]])).toEqual([{ lotId: "a", quantity: "50.000" }]);
    expect(defaultLotPicks("50", balances)).toEqual([]);
    expect(defaultLotPicks("500", [balances[0]])).toEqual([]);
  });
});

describe("purchaseUntouched", () => {
  it("is true while the lot still holds everything bought since this purchase", () => {
    // Before: 40. Purchase +100 (balance 140). Another purchase +60 (200). Use -40 (160).
    expect(purchaseUntouched({ balanceNow: "160", movements: [
      { delta: "100", sourceType: "purchase" }, { delta: "60", sourceType: "purchase" }, { delta: "-40", sourceType: "mixing" },
    ] })).toBe(true);
  });
  it("is false once the balance dipped below the purchased quantity", () => {
    // Before: 0. Purchase +100. Use -60 (40). Transfer back +60 (100).
    expect(purchaseUntouched({ balanceNow: "100", movements: [
      { delta: "100", sourceType: "purchase" }, { delta: "-60", sourceType: "mixing" }, { delta: "60", sourceType: "transfer_in" },
    ] })).toBe(false);
  });
});

describe("similar names", () => {
  it("normalises case, spaces, dashes and dots", () => {
    expect(normalizeMaterialName(" Soda-Ash. ")).toBe("sodaash");
  });
  it("flags one-letter differences and formatting variants", () => {
    for (const name of ["Soda Ashh", "Soda-Ash", "soda  ash", "Sodo Ash"]) expect(isSimilarMaterialName("Soda Ash", name)).toBe(true);
    expect(isSimilarMaterialName("Soda Ash", "Caustic Soda")).toBe(false);
  });
});

describe("lotLabel", () => {
  it("shows price, unit and first purchase date", () => {
    expect(lotLabel(balances[0], "kg")).toBe("Rs 115/kg (first 1 Oct)");
    expect(lotLabel({ unitPrice: "2.50", firstPurchasedAt: "2026-10-20T05:00:00Z" }, "pcs")).toBe("Rs 2.50/pcs (first 20 Oct)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/lib/inventory/material-lots.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/lib/inventory/material-lots.ts
import Big from "big.js";
import { format } from "date-fns";
import { z } from "zod";

export type MaterialType = "chemical" | "packaging";
export type MaterialRef = { materialType: MaterialType; materialId: string };
export type LotPick = { lotId: string; quantity: string };
export type LotBalance = { lotId: string; unitPrice: string; quantity: string; firstPurchasedAt: Date | string };
export type PickedLot = { lotId: string; quantity: string; unitPrice: string; totalCost: string };

export const PURCHASE_LOCKED_MESSAGE =
  "Some of this stock has already been used or moved, so the quantity and price can't change. Old batch costs would become wrong.";

export const lotPickSchema = z.object({
  lotId: z.string().min(1),
  quantity: z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "Use a number with up to 3 decimals"),
});
export const materialLotPicksSchema = z.object({
  materialId: z.string().min(1),
  picks: z.array(lotPickSchema).min(1).max(50),
});
export type MaterialLotPicks = z.infer<typeof materialLotPicksSchema>;

export function lotPrice(value: string | number | Big) {
  const price = new Big(value);
  if (price.lt(0)) throw new Error("Price cannot be negative");
  return price.round(2, Big.roundHalfUp).toFixed(2);
}

export function lotQuantity(value: string, label = "Quantity") {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error(`${label} must be a nonnegative number`);
  const quantity = new Big(value.trim());
  if (!quantity.round(3).eq(quantity) || quantity.gt("999999999.999")) throw new Error(`${label} must use at most 3 decimals`);
  return quantity.toFixed(3);
}

const plain = (value: Big | string) => new Big(value).toString();

export function checkLotPicks(input: { name: string; unit: string; required: string; picks: LotPick[]; balances: LotBalance[] }) {
  const { name, unit } = input;
  const errors: string[] = [];
  const seen = new Set<string>();
  let total = new Big(0);
  for (const pick of input.picks) {
    let quantity: Big;
    try { quantity = new Big(lotQuantity(pick.quantity)); } catch { errors.push(`${name}: enter each lot quantity as a number with up to 3 decimals`); continue; }
    if (quantity.lte(0)) { errors.push(`${name}: each picked quantity must be more than zero`); continue; }
    if (seen.has(pick.lotId)) { errors.push(`${name}: pick each lot only once`); continue; }
    seen.add(pick.lotId);
    const balance = input.balances.find((row) => row.lotId === pick.lotId);
    if (!balance || new Big(balance.quantity).lte(0)) { errors.push(`${name}: one picked lot has no stock here`); continue; }
    if (quantity.gt(balance.quantity)) errors.push(`${name}: lot Rs ${balance.unitPrice} has only ${plain(balance.quantity)} ${unit} here`);
    total = total.plus(quantity);
  }
  if (!errors.length && !total.eq(input.required))
    errors.push(`${name}: lots add up to ${plain(total)} ${unit}, but ${plain(input.required)} ${unit} is needed`);
  return [...new Set(errors)];
}

export function costLotPicks(picks: LotPick[], balances: LotBalance[]): PickedLot[] {
  return picks.map((pick) => {
    const balance = balances.find((row) => row.lotId === pick.lotId);
    if (!balance) throw new Error("Picked lot not found");
    const quantity = lotQuantity(pick.quantity);
    return { lotId: pick.lotId, quantity, unitPrice: lotPrice(balance.unitPrice), totalCost: new Big(quantity).times(balance.unitPrice).round(2, Big.roundHalfUp).toFixed(2) };
  });
}

export function defaultLotPicks(required: string, balances: LotBalance[]): LotPick[] {
  const stocked = balances.filter((row) => new Big(row.quantity).gt(0));
  if (stocked.length !== 1 || new Big(stocked[0].quantity).lt(required) || new Big(required).lte(0)) return [];
  return [{ lotId: stocked[0].lotId, quantity: new Big(required).toFixed(3) }];
}

const PURCHASE_SOURCES = new Set(["purchase", "purchase_edit", "purchase_delete"]);

// movements: every lot movement in the purchase's store, starting with the purchase's own
// movement, oldest first. Newest purchases are treated as used last, so the purchase is
// untouched while the balance never dipped below the stock purchases brought in since it.
export function purchaseUntouched(input: { balanceNow: string; movements: { delta: string; sourceType: string }[] }) {
  let balance = input.movements.reduce((sum, row) => sum.minus(row.delta), new Big(input.balanceNow));
  let purchased = new Big(0);
  for (const movement of input.movements) {
    balance = balance.plus(movement.delta);
    if (PURCHASE_SOURCES.has(movement.sourceType)) purchased = purchased.plus(movement.delta);
    if (balance.lt(purchased)) return false;
  }
  return true;
}

export function normalizeMaterialName(name: string) {
  return name.toLowerCase().replace(/[\s\-._]+/g, "");
}

function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function isSimilarMaterialName(a: string, b: string) {
  const left = normalizeMaterialName(a);
  const right = normalizeMaterialName(b);
  return !!left && !!right && withinOneEdit(left, right);
}

export function lotLabel(lot: { unitPrice: string; firstPurchasedAt: Date | string }, unit: string) {
  const price = new Big(lot.unitPrice);
  const shown = price.round(0).eq(price) ? price.toFixed(0) : price.toFixed(2);
  return `Rs ${shown}/${unit} (first ${format(new Date(lot.firstPurchasedAt), "d MMM")})`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/lib/inventory/material-lots.test.ts`
Expected: PASS (the property test runs 100 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/material-lots.ts src/lib/inventory/material-lots.test.ts
git commit -m "feat(inventory): add pure price lot rules"
```

---

### Task 3: The lot stock module (only writer of material stock)

**Files:**
- Create: `src/lib/inventory/material-lots.server.ts`
- Test: `src/__tests__/integration/material-lots.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 rules.
- Produces (exported from `@/lib/inventory/material-lots.server`):
  - `type LotSourceType = "opening" | "purchase" | "purchase_edit" | "purchase_delete" | "transfer_out" | "transfer_in" | "mixing" | "packing" | "recovery" | "adjustment" | "warehouse_close"`
  - `lockMaterialStock(tx: Tx, warehouseIds: string[], refs: MaterialRef[]): Promise<void>`. Locks `material_stock` rows in (warehouseId, materialId) order, then creates any missing opening lot. Every caller must lock before reading balances or moving stock.
  - `findOrCreateLot(tx: Tx, ref: MaterialRef, unitPrice: string): Promise<{ id: string; unitPrice: string; created: boolean }>`
  - `moveLotStock(tx: Tx, input: { ref: MaterialRef; lotId: string; warehouseId: string; delta: string; sourceType: LotSourceType; sourceId?: string | null }): Promise<void>`. Throws `"Not enough stock in this lot"` when a debit exceeds lot stock.
  - `listLotBalances(tx: Tx, warehouseId: string, ref: MaterialRef): Promise<LotBalance[]>`. Lots with quantity > 0, oldest first.
  - `takeLotPicks(tx: Tx, input: { warehouseId: string; ref: MaterialRef; name: string; unit: string; required: string; picks: LotPick[]; sourceType: LotSourceType; sourceId?: string | null }): Promise<PickedLot[]>`. Validates with `checkLotPicks` (throws the joined messages) and debits each pick.
  - `relocateAllLots(tx: Tx, input: { fromWarehouseId: string; toWarehouseId: string; ref: MaterialRef; sourceId: string }): Promise<PickedLot[]>`
  - `type Tx` re-exported as `Parameters<Parameters<typeof db.transaction>[0]>[0]`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/__tests__/integration/material-lots.test.ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, user, warehouses, chemicals, materialStock, materialLotStock, materialLotMovements } from "@/db";
import { findOrCreateLot, listLotBalances, lockMaterialStock, moveLotStock, relocateAllLots, takeLotPicks, type Tx } from "@/lib/inventory/material-lots.server";

const rollback = new Error("Rollback material lot fixture");
const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Lot actor", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [other] = await tx.insert(warehouses).values({ ...warehouseValues, name: `${id}-b` }).returning();
  const [soda] = await tx.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
  return { actor, floor, other, ref: { materialType: "chemical" as const, materialId: soda.id } };
}

async function inFixture(check: (tx: Tx, fixture: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Use isolated TEST_DATABASE_URL");
  try { await db.transaction(async (tx) => { await check(tx, await seed(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}

async function total(tx: Tx, warehouseId: string, chemicalId: string) {
  const [row] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, warehouseId), eq(materialStock.chemicalId, chemicalId)));
  return row?.quantity;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("material lot stock", () => {
  it("joins the same price, splits a new price, and keeps the item total in step", () => inFixture(async (tx, { floor, ref }) => {
    await lockMaterialStock(tx, [floor.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const again = await findOrCreateLot(tx, ref, "115.00");
    const b = await findOrCreateLot(tx, ref, "125");
    expect(again.id).toBe(a.id);
    expect(b.id).not.toBe(a.id);
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "300", sourceType: "purchase", sourceId: "p1" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: floor.id, delta: "500", sourceType: "purchase", sourceId: "p2" });
    expect(await total(tx, floor.id, ref.materialId)).toBe("800.000");
    expect((await listLotBalances(tx, floor.id, ref)).map((row) => [row.unitPrice, row.quantity])).toEqual([["115.00", "300.000"], ["125.00", "500.000"]]);
  }));

  it("takes exactly the picked lots and refuses overdrawing", () => inFixture(async (tx, { floor, ref }) => {
    await lockMaterialStock(tx, [floor.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    const b = await findOrCreateLot(tx, ref, "125");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "120", sourceType: "purchase" });
    await moveLotStock(tx, { ref, lotId: b.id, warehouseId: floor.id, delta: "80", sourceType: "purchase" });
    const picked = await takeLotPicks(tx, { warehouseId: floor.id, ref, name: "Soda", unit: "kg", required: "200", sourceType: "mixing", sourceId: "run", picks: [{ lotId: a.id, quantity: "120" }, { lotId: b.id, quantity: "80" }] });
    expect(picked.map((row) => row.totalCost)).toEqual(["13800.00", "10000.00"]);
    expect(await total(tx, floor.id, ref.materialId)).toBe("0.000");
    await expect(takeLotPicks(tx, { warehouseId: floor.id, ref, name: "Soda", unit: "kg", required: "1", sourceType: "mixing", picks: [{ lotId: a.id, quantity: "1" }] }))
      .rejects.toThrow("Soda: one picked lot has no stock here");
  }));

  it("turns stock from before lots into an opening lot at the item price", () => inFixture(async (tx, { floor, ref }) => {
    await tx.insert(materialStock).values({ warehouseId: floor.id, chemicalId: ref.materialId, quantity: "40" });
    await lockMaterialStock(tx, [floor.id], [ref]);
    const balances = await listLotBalances(tx, floor.id, ref);
    expect(balances.map((row) => [row.unitPrice, row.quantity])).toEqual([["115.00", "40.000"]]);
    const movements = await tx.select().from(materialLotMovements).where(eq(materialLotMovements.lotId, balances[0].lotId));
    expect(movements.map((row) => row.sourceType)).toEqual(["opening"]);
    expect(await total(tx, floor.id, ref.materialId)).toBe("40.000");
  }));

  it("relocates every lot when a store closes", () => inFixture(async (tx, { floor, other, ref }) => {
    await lockMaterialStock(tx, [floor.id, other.id], [ref]);
    const a = await findOrCreateLot(tx, ref, "115");
    await moveLotStock(tx, { ref, lotId: a.id, warehouseId: floor.id, delta: "10", sourceType: "purchase" });
    await relocateAllLots(tx, { fromWarehouseId: floor.id, toWarehouseId: other.id, ref, sourceId: floor.id });
    expect(await total(tx, floor.id, ref.materialId)).toBe("0.000");
    expect(await total(tx, other.id, ref.materialId)).toBe("10.000");
    const [moved] = await tx.select().from(materialLotStock).where(and(eq(materialLotStock.lotId, a.id), eq(materialLotStock.warehouseId, other.id)));
    expect(moved.quantity).toBe("10.000");
  }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lots.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/lib/inventory/material-lots.server.ts
import Big from "big.js";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { chemicals, materialLotMovements, materialLots, materialLotStock, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { checkLotPicks, costLotPicks, lotPrice, lotQuantity, type LotBalance, type LotPick, type MaterialRef, type PickedLot } from "./material-lots";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LotSourceType = "opening" | "purchase" | "purchase_edit" | "purchase_delete" | "transfer_out" | "transfer_in" | "mixing" | "packing" | "recovery" | "adjustment" | "warehouse_close";

const stockColumn = (ref: MaterialRef) => (ref.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId);
const lotColumn = (ref: MaterialRef) => (ref.materialType === "chemical" ? materialLots.chemicalId : materialLots.packagingMaterialId);
const refValues = (ref: MaterialRef) => ({ chemicalId: ref.materialType === "chemical" ? ref.materialId : null, packagingMaterialId: ref.materialType === "packaging" ? ref.materialId : null });

// Lock order: warehouse id, then material type, then material id. Every writer uses this order.
export async function lockMaterialStock(tx: Tx, warehouseIds: string[], refs: MaterialRef[]) {
  const stores = [...new Set(warehouseIds)].sort();
  const items = [...new Map(refs.map((ref) => [`${ref.materialType}:${ref.materialId}`, ref])).values()]
    .sort((a, b) => `${a.materialType}:${a.materialId}`.localeCompare(`${b.materialType}:${b.materialId}`));
  for (const warehouseId of stores) {
    for (const ref of items) {
      const [row] = await tx.select().from(materialStock)
        .where(and(eq(materialStock.warehouseId, warehouseId), eq(stockColumn(ref), ref.materialId)))
        .for("update");
      if (row) await reconcileOpeningLot(tx, warehouseId, ref, row.quantity);
    }
  }
}

async function lotSum(tx: Tx, warehouseId: string, ref: MaterialRef) {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${materialLotStock.quantity}), 0)` })
    .from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .where(and(eq(materialLotStock.warehouseId, warehouseId), eq(lotColumn(ref), ref.materialId)));
  return new Big(row?.total ?? 0);
}

// Stock recorded before lots existed becomes one lot at the item's current price.
async function reconcileOpeningLot(tx: Tx, warehouseId: string, ref: MaterialRef, itemTotal: string) {
  const missing = new Big(itemTotal).minus(await lotSum(tx, warehouseId, ref));
  if (missing.eq(0)) return;
  if (missing.lt(0)) throw new Error("Lot stock disagrees with item stock. Contact support before moving this item.");
  const table = ref.materialType === "chemical" ? chemicals : packagingMaterials;
  const [item] = await tx.select({ price: table.costPerUnit }).from(table).where(eq(table.id, ref.materialId));
  const lot = await findOrCreateLot(tx, ref, item?.price ?? "0");
  await addLotQuantity(tx, lot.id, warehouseId, missing.toFixed(3));
  await tx.insert(materialLotMovements).values({ lotId: lot.id, warehouseId, delta: missing.toFixed(3), sourceType: "opening" });
}

export async function findOrCreateLot(tx: Tx, ref: MaterialRef, unitPrice: string) {
  const price = lotPrice(unitPrice);
  const [inserted] = await tx.insert(materialLots).values({ ...refValues(ref), unitPrice: price })
    .onConflictDoNothing().returning({ id: materialLots.id, unitPrice: materialLots.unitPrice });
  if (inserted) return { ...inserted, created: true };
  const [existing] = await tx.select({ id: materialLots.id, unitPrice: materialLots.unitPrice }).from(materialLots)
    .where(and(eq(lotColumn(ref), ref.materialId), eq(materialLots.unitPrice, price)));
  if (!existing) throw new Error("Price lot could not be created");
  return { ...existing, created: false };
}

async function addLotQuantity(tx: Tx, lotId: string, warehouseId: string, quantity: string) {
  await tx.insert(materialLotStock).values({ lotId, warehouseId, quantity })
    .onConflictDoUpdate({ target: [materialLotStock.lotId, materialLotStock.warehouseId], set: { quantity: sql`${materialLotStock.quantity} + ${quantity}`, updatedAt: new Date() } });
}

export async function moveLotStock(tx: Tx, input: { ref: MaterialRef; lotId: string; warehouseId: string; delta: string; sourceType: LotSourceType; sourceId?: string | null }) {
  const delta = new Big(input.delta);
  if (delta.eq(0)) return;
  const amount = lotQuantity(delta.abs().toString());
  const column = stockColumn(input.ref);
  if (delta.gt(0)) {
    await addLotQuantity(tx, input.lotId, input.warehouseId, amount);
    await tx.insert(materialStock).values({ warehouseId: input.warehouseId, ...refValues(input.ref), quantity: amount })
      .onConflictDoUpdate({ target: [materialStock.warehouseId, column], targetWhere: sql`${column} IS NOT NULL`, set: { quantity: sql`${materialStock.quantity} + ${amount}`, updatedAt: new Date() } });
  } else {
    const [debited] = await tx.update(materialLotStock)
      .set({ quantity: sql`${materialLotStock.quantity} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(materialLotStock.lotId, input.lotId), eq(materialLotStock.warehouseId, input.warehouseId), gte(materialLotStock.quantity, amount)))
      .returning({ id: materialLotStock.id });
    if (!debited) throw new Error("Not enough stock in this lot");
    const [total] = await tx.update(materialStock)
      .set({ quantity: sql`${materialStock.quantity} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(materialStock.warehouseId, input.warehouseId), eq(column, input.ref.materialId), gte(materialStock.quantity, amount)))
      .returning({ id: materialStock.id });
    if (!total) throw new Error("Lot stock disagrees with item stock. Contact support before moving this item.");
  }
  await tx.insert(materialLotMovements).values({ lotId: input.lotId, warehouseId: input.warehouseId, delta: delta.toFixed(3), sourceType: input.sourceType, sourceId: input.sourceId ?? null });
}

export async function listLotBalances(tx: Tx, warehouseId: string, ref: MaterialRef): Promise<LotBalance[]> {
  const rows = await tx.select({ lotId: materialLots.id, unitPrice: materialLots.unitPrice, quantity: materialLotStock.quantity, firstPurchasedAt: materialLots.firstPurchasedAt })
    .from(materialLotStock).innerJoin(materialLots, eq(materialLots.id, materialLotStock.lotId))
    .where(and(eq(materialLotStock.warehouseId, warehouseId), eq(lotColumn(ref), ref.materialId), sql`${materialLotStock.quantity} > 0`))
    .orderBy(asc(materialLots.firstPurchasedAt), asc(materialLots.id));
  return rows;
}

export async function takeLotPicks(tx: Tx, input: { warehouseId: string; ref: MaterialRef; name: string; unit: string; required: string; picks: LotPick[]; sourceType: LotSourceType; sourceId?: string | null }): Promise<PickedLot[]> {
  const balances = await listLotBalances(tx, input.warehouseId, input.ref);
  const errors = checkLotPicks({ name: input.name, unit: input.unit, required: input.required, picks: input.picks, balances });
  if (errors.length) throw new Error(errors.join("; "));
  const picked = costLotPicks(input.picks, balances);
  for (const row of picked) await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.warehouseId, delta: new Big(row.quantity).times(-1).toString(), sourceType: input.sourceType, sourceId: input.sourceId });
  return picked;
}

export async function relocateAllLots(tx: Tx, input: { fromWarehouseId: string; toWarehouseId: string; ref: MaterialRef; sourceId: string }) {
  const balances = await listLotBalances(tx, input.fromWarehouseId, input.ref);
  const picked = costLotPicks(balances.map((row) => ({ lotId: row.lotId, quantity: row.quantity })), balances);
  for (const row of picked) {
    await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.fromWarehouseId, delta: `-${row.quantity}`, sourceType: "warehouse_close", sourceId: input.sourceId });
    await moveLotStock(tx, { ref: input.ref, lotId: row.lotId, warehouseId: input.toWarehouseId, delta: row.quantity, sourceType: "warehouse_close", sourceId: input.sourceId });
  }
  return picked;
}
```

`desc` and `inArray` are used by `purchaseIsUntouched` (added in Task 12). Until then, leave them out of the import and add them in Task 12, so the file has no unused imports.

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lots.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/material-lots.server.ts src/__tests__/integration/material-lots.test.ts
git commit -m "feat(inventory): add lot stock module as the single stock writer"
```

---

### Task 4: Purchases go into lots, no more "-1" items

**Files:**
- Modify: `src/server-functions/inventory/stock/add-stock-fn.ts:90-140`
- Modify: `src/server-functions/inventory/add-chemical-fn.ts:85-215`
- Modify: `src/server-functions/inventory/add-packaging-material-fn.ts` (the same two blocks: duplicate-name handling, then stock initialisation)
- Modify: `src/lib/validators/validators.ts` (`addChemicalSchema`, the packaging add schema). Add `confirmSimilarName: z.boolean().optional()`
- Test: `src/__tests__/integration/material-lot-purchases.test.ts`

**Interfaces:**
- Consumes: `lockMaterialStock`, `findOrCreateLot`, `moveLotStock` (Task 3), `lotPrice`, `isSimilarMaterialName` (Task 2).
- Produces: `purchaseRecords.lotId` is always set for new purchases. New error text from the add-material functions: `Similar item already exists: "<name>"`, used by Task 5.

- [ ] **Step 1: Write the failing integration test**

Use the server-function harness from `src/__tests__/integration/two-phase-raw-stock.test.ts:1-22` (mocking `@tanstack/react-start`, `@/lib/middlewares`, `@/lib/activity-logger.server`). Copy those mock lines verbatim to the top of the new file. Then:

```ts
// src/__tests__/integration/material-lot-purchases.test.ts (after the copied mocks)
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, user, warehouses, chemicals, suppliers, purchaseRecords, materialLots } from "@/db";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { addRawMaterialFn } from "@/server-functions/inventory/add-chemical-fn";

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

async function fixture() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await db.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
  const [supplier] = await db.insert(suppliers).values({ name: `${id}-supplier` }).returning();
  const [soda] = await db.insert(chemicals).values({ name: `${id} Soda Ash`, unit: "kg", costPerUnit: "115" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const purchase = (cost: string, quantity: string) => addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: soda.id, quantity, supplierId: supplier.id, cost, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" }, context } as never);
  return { id, floor, supplier, soda, context, purchase };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("purchases into lots", () => {
  it("joins the lot of the same price and opens a new lot for a new price", async () => {
    const { soda, purchase } = await fixture();
    await purchase("34500", "300");   // Rs 115
    await purchase("57500", "500");   // Rs 115 again
    await purchase("62500", "500");   // Rs 125
    const lots = await db.select().from(materialLots).where(eq(materialLots.chemicalId, soda.id));
    expect(lots.map((lot) => lot.unitPrice).sort()).toEqual(["115.00", "125.00"]);
    const records = await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, soda.id));
    expect(records.every((record) => !!record.lotId)).toBe(true);
  });

  it("refuses a similar new material name unless confirmed, and never creates -1 items", async () => {
    const { id, floor, supplier, context } = await fixture();
    const base = { name: `${id} Soda Ashh`, unit: "kg", costPerUnit: "125", quantity: "0", minimumStockLevel: "0", supplierId: supplier.id, warehouseId: floor.id, notes: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "", packagingType: "", packagingSize: "" };
    await expect(addRawMaterialFn({ data: base, context } as never)).rejects.toThrow(`Similar item already exists: "${id} Soda Ash"`);
    await addRawMaterialFn({ data: { ...base, confirmSimilarName: true }, context } as never);
    const created = await db.select().from(chemicals).where(eq(chemicals.name, `${id} Soda Ashh`));
    expect(created).toHaveLength(1);
    const dashOne = await db.select().from(chemicals).where(eq(chemicals.name, `${id} Soda Ash-1`));
    expect(dashOne).toHaveLength(0);
  });
});
```

Check the real field names of `addChemicalSchema` in `src/lib/validators/validators.ts` before running, and match the `base` object to them exactly (the list above mirrors the add-chemical form). Do the same for any fields `suppliers` requires.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-purchases.test.ts`
Expected: FAIL. Lots aren't created, and the similar name is accepted.

- [ ] **Step 3: Route `addStockFn` through lots**

In `add-stock-fn.ts`, replace the whole `materialStock` upsert block (from `const materialColumn = ...` to the closing `.returning();` of that insert) with:

```ts
			const ref = { materialType: data.materialType, materialId: data.materialId } as const;
			await lockMaterialStock(tx, [targetWarehouseId], [ref]);
			const unitCost = new Big(data.cost).div(data.quantity);
			const lot = await findOrCreateLot(tx, ref, unitCost.toString());
```

In the `purchaseRecords` insert, set `unitCost: lot.unitPrice` and add `lotId: lot.id`. After the purchase insert (`.returning()` gives `purchase`), add:

```ts
			await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: targetWarehouseId, delta: data.quantity, sourceType: "purchase", sourceId: purchase.id });
```

In the audit log insert at the end, add `lotId: lot.id`. The function used to return the `material_stock` row as `result`. Replace `return result;` with:

```ts
			const [result] = await tx.select().from(materialStock).where(and(eq(materialStock.warehouseId, targetWarehouseId), eq(data.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId, data.materialId)));
			return result;
```

Imports to add: `and` from `drizzle-orm`; `findOrCreateLot, lockMaterialStock, moveLotStock` from `@/lib/inventory/material-lots.server`.

- [ ] **Step 4: Add-material functions: similar-name guard, no "-1", stock through lots**

In `add-chemical-fn.ts`, replace the duplicate check and the whole `if (existing) { ... } else { ... }` block with:

```ts
      const candidates = await tx.select({ id: chemicals.id, name: chemicals.name }).from(chemicals);
      const exact = candidates.find((row) => normalizeMaterialName(row.name) === normalizeMaterialName(data.name));
      if (exact) throw new Error(`Similar item already exists: "${exact.name}". Use Add stock to buy more of it.`);
      const similar = candidates.find((row) => isSimilarMaterialName(row.name, data.name));
      if (similar && !data.confirmSimilarName) throw new Error(`Similar item already exists: "${similar.name}"`);

      const [finalMaterial] = await tx
        .insert(chemicals)
        .values({
          name: data.name.trim(),
          unit: data.unit,
          costPerUnit: lotPrice(data.costPerUnit),
          minimumStockLevel: data.minimumStockLevel,
          packagingType: data.packagingType,
          packagingSize: data.packagingSize,
          lastSupplierId: data.supplierId,
        })
        .returning();
```

Replace the "2. Initialize or Update stock" block's `materialStock` find/update/insert with:

```ts
        const ref = { materialType: "chemical", materialId } as const;
        await lockMaterialStock(tx, [targetWarehouseId], [ref]);
        const lot = await findOrCreateLot(tx, ref, data.costPerUnit);
```

Then add `lotId: lot.id` and `unitCost: lot.unitPrice` to the purchase insert, and right after it:

```ts
        await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: targetWarehouseId, delta: data.quantity, sourceType: "purchase", sourceId: purchase.id });
```

Apply the same three changes to `add-packaging-material-fn.ts`, using `packagingMaterials` and `materialType: "packaging"`. Keep that function's existing extra fields (type, capacity, weightPerPack, pricePerKg, associatedStickerId and the rest) in its insert.

Add `confirmSimilarName: z.boolean().optional()` to both add schemas in `validators.ts`.

Imports: `isSimilarMaterialName, lotPrice, normalizeMaterialName` from `@/lib/inventory/material-lots`; `findOrCreateLot, lockMaterialStock, moveLotStock` from `@/lib/inventory/material-lots.server`. Remove any import that's now unused (`materialStock` if unused).

- [ ] **Step 5: Run tests**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-purchases.test.ts src/__tests__/integration/two-phase-raw-stock.test.ts`
Expected: the new test PASSES. If an older raw-stock test asserted `material_stock` changed directly by `addStockFn`, it still passes, because totals are still updated. If one asserted "-1" naming, delete that assertion and note it in the commit message.

Run: `bun run typecheck`. Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/inventory src/lib/validators/validators.ts src/__tests__/integration/material-lot-purchases.test.ts
git commit -m "feat(inventory): put purchases into price lots and guard similar names"
```

---

### Task 5: Similar-name warning and lot preview in the purchase forms

**Files:**
- Create: `src/server-functions/inventory/find-similar-materials-fn.ts`
- Modify: `src/components/inventory/add-raw-material-form.tsx`
- Modify: `src/components/inventory/add-packaging-material-form.tsx`
- Modify: `src/components/inventory/add-stock-dialog-form.tsx` (add the preview line under the cost field)
- Create: `src/components/inventory/similar-material-warning.tsx`
- Test: `src/__tests__/similar-material-warning.behavior.test.tsx`

**Interfaces:**
- Consumes: `isSimilarMaterialName`, `normalizeMaterialName`, `lotPrice`, `lotLabel` (Task 2); `getMaterialLotsFn` (Task 6). Build Task 6 before the preview step, or do the preview step at the end of Task 6.
- Produces: `findSimilarMaterialsFn({ data: { materialType, name } }) => Promise<{ id: string; name: string; exact: boolean; stock: string; unit: string }[]>`; `<SimilarMaterialWarning matches onAddStock onConfirmNew />`.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/__tests__/similar-material-warning.behavior.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimilarMaterialWarning } from "@/components/inventory/similar-material-warning";

describe("SimilarMaterialWarning", () => {
  it("offers Add stock and New item for a similar name", async () => {
    const onAddStock = vi.fn();
    const onConfirmNew = vi.fn();
    render(<SimilarMaterialWarning matches={[{ id: "s", name: "Soda Ash", exact: false, stock: "620", unit: "kg" }]} onAddStock={onAddStock} onConfirmNew={onConfirmNew} />);
    expect(screen.getByText('Similar item already exists: "Soda Ash" (620 kg in stock)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add stock to Soda Ash instead" }));
    expect(onAddStock).toHaveBeenCalledWith("s");
    await userEvent.click(screen.getByRole("button", { name: "No, this is a new item" }));
    expect(onConfirmNew).toHaveBeenCalled();
  });

  it("offers only Add stock when the name is the same apart from capitals, spaces or dashes", () => {
    render(<SimilarMaterialWarning matches={[{ id: "s", name: "Soda Ash", exact: true, stock: "0", unit: "kg" }]} onAddStock={vi.fn()} onConfirmNew={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "No, this is a new item" })).not.toBeInTheDocument();
  });
});
```

Check that `@testing-library/user-event` is in `package.json`. If not, use `fireEvent.click` from `@testing-library/react` instead (look at `src/__tests__/production-qc-ui.behavior.test.tsx` for the project's usual style).

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/__tests__/similar-material-warning.behavior.test.tsx`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement the warning and the lookup**

```tsx
// src/components/inventory/similar-material-warning.tsx
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type SimilarMaterial = { id: string; name: string; exact: boolean; stock: string; unit: string };

export function SimilarMaterialWarning({ matches, onAddStock, onConfirmNew }: { matches: SimilarMaterial[]; onAddStock: (id: string) => void; onConfirmNew: () => void }) {
  if (!matches.length) return null;
  const anyExact = matches.some((match) => match.exact);
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3">
        {matches.map((match) => (
          <div key={match.id} className="flex flex-col gap-2">
            <p>{`Similar item already exists: "${match.name}" (${Number(match.stock)} ${match.unit} in stock)`}</p>
            <Button type="button" variant="secondary" onClick={() => onAddStock(match.id)}>{`Add stock to ${match.name} instead`}</Button>
          </div>
        ))}
        {!anyExact && <Button type="button" variant="outline" onClick={onConfirmNew}>No, this is a new item</Button>}
      </AlertDescription>
    </Alert>
  );
}
```

```ts
// src/server-functions/inventory/find-similar-materials-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chemicals, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { isSimilarMaterialName, normalizeMaterialName } from "@/lib/inventory/material-lots";
import { requireInventoryManageMiddleware } from "@/lib/middlewares";

export const findSimilarMaterialsFn = createServerFn()
  .middleware([requireInventoryManageMiddleware])
  .inputValidator(z.object({ materialType: z.enum(["chemical", "packaging"]), name: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }) => {
    const table = data.materialType === "chemical" ? chemicals : packagingMaterials;
    const column = data.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId;
    const rows = await db.select({ id: table.id, name: table.name, stock: sql<string>`coalesce(sum(${materialStock.quantity}), 0)` })
      .from(table).leftJoin(materialStock, eq(column, table.id)).groupBy(table.id, table.name);
    const unitOf = async (id: string) => {
      if (data.materialType === "packaging") return "pcs";
      const [row] = await db.select({ unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, id));
      return row?.unit ?? "kg";
    };
    const matches = rows.filter((row) => isSimilarMaterialName(row.name, data.name)).slice(0, 5);
    return Promise.all(matches.map(async (row) => ({ id: row.id, name: row.name, exact: normalizeMaterialName(row.name) === normalizeMaterialName(data.name), stock: row.stock, unit: await unitOf(row.id) })));
  });
```

- [ ] **Step 4: Use it in both add-material forms**

In `add-raw-material-form.tsx` and `add-packaging-material-form.tsx`:
1. Add state `const [similar, setSimilar] = useState<SimilarMaterial[]>([]);` and `const [confirmedNew, setConfirmedNew] = useState(false);`.
2. At the start of the form's `onSubmit`, if `!confirmedNew`: call `findSimilarMaterialsFn({ data: { materialType, name: value.name } })`. If it returns matches, `setSimilar(matches)` and `return` without saving.
3. Pass `confirmSimilarName: confirmedNew` in the mutation payload.
4. Render `<SimilarMaterialWarning matches={similar} onAddStock={...} onConfirmNew={() => { setConfirmedNew(true); setSimilar([]); form.handleSubmit(); }} />` directly above the submit button.
5. `onAddStock(id)`: close this form, then open the Add stock dialog for that item with the typed quantity and price. Find how the inventory page opens `AddStockDialogForm` (search for `AddStockDialogForm` usages). It already takes an item to restock (`itemToRestock`). Lift an `onSwitchToAddStock(id, quantity, price)` prop from each add-material form to the page that renders both, and have the page open the Add stock dialog with those values.
6. Clear `similar` and `confirmedNew` whenever the name field changes.

- [ ] **Step 5: Lot preview line in Add stock**

In `add-stock-dialog-form.tsx`, under the cost field, use `useMaterialLots` (Task 6) for the selected item in the selected warehouse. Compute `const price = quantity > 0 && cost > 0 ? lotPrice(new Big(cost).div(quantity)) : null;`, find a lot with `unitPrice === price`, and render one line:
- Match: `Joins lot ${lotLabel(lot, unit)} (${Number(lot.quantity)} ${unit} in this store)`
- No match: `Creates new lot Rs ${price}/${unit}`

- [ ] **Step 6: Run tests**

Run: `bun run test -- src/__tests__/similar-material-warning.behavior.test.tsx`
Expected: PASS. Then run `bun run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory src/server-functions/inventory/find-similar-materials-fn.ts src/__tests__/similar-material-warning.behavior.test.tsx
git commit -m "feat(inventory): warn about similar material names and preview the purchase lot"
```

---

### Task 6: Lot read function, hook and LotPicker component

**Files:**
- Create: `src/server-functions/inventory/stock/get-material-lots-fn.ts`
- Create: `src/hooks/stock/use-material-lots.ts`
- Create: `src/components/inventory/lot-picker.tsx`
- Test: `src/__tests__/lot-picker.behavior.test.tsx`

**Interfaces:**
- Consumes: `lockMaterialStock`, `listLotBalances` (Task 3); `checkLotPicks`, `defaultLotPicks`, `lotLabel` (Task 2).
- Produces:
  - `getMaterialLotsFn({ data: { warehouseId: string; materialType: MaterialType; materialIds: string[] } }) => Promise<Record<string, LotBalance[]>>`
  - `useMaterialLots(warehouseId: string | undefined, materialType: MaterialType, materialIds: string[])`. A TanStack `useQuery` with key `["material-lots", warehouseId, materialType, [...materialIds].sort()]`, enabled when `warehouseId` and the ids are present.
  - `<LotPicker name unit required lots value onChange />` with props `{ name: string; unit: string; required: string; lots: LotBalance[]; value: LotPick[]; onChange: (picks: LotPick[]) => void }`
  - `lotPicksValid(required: string, picks: LotPick[], lots: LotBalance[], name: string, unit: string): boolean` exported from `lot-picker.tsx` for callers' submit checks.
- Every mutation that changes material stock must also invalidate `["material-lots"]`. Each later task lists the hook to update.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/__tests__/lot-picker.behavior.test.tsx
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LotPicker } from "@/components/inventory/lot-picker";
import type { LotPick } from "@/lib/inventory/material-lots";

const lots = [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
];

function Harness({ required, initial = [] as LotPick[], only }: { required: string; initial?: LotPick[]; only?: typeof lots }) {
  const [value, setValue] = useState<LotPick[]>(initial);
  return <LotPicker name="Soda Ash" unit="kg" required={required} lots={only ?? lots} value={value} onChange={setValue} />;
}

describe("LotPicker", () => {
  it("lists each lot with its stock and shows a running total", () => {
    render(<Harness required="200" />);
    fireEvent.change(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Rs 125/kg (first 20 Oct), 80 kg here"), { target: { value: "80" } });
    expect(screen.getByText("Total 200 of 200 kg ✓")).toBeInTheDocument();
  });

  it("explains a total that is short or a lot that is overdrawn", () => {
    render(<Harness required="200" />);
    fireEvent.change(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here"), { target: { value: "130" } });
    expect(screen.getByText("Soda Ash: lot Rs 115.00 has only 120 kg here")).toBeInTheDocument();
  });

  it("pre-fills only when one lot holds stock and covers the need", () => {
    render(<Harness required="50" only={[lots[0]]} />);
    expect(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here")).toHaveValue(50);
  });

  it("does not pre-fill when there is a choice", () => {
    render(<Harness required="50" />);
    expect(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here")).toHaveValue(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/__tests__/lot-picker.behavior.test.tsx`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement**

```tsx
// src/components/inventory/lot-picker.tsx
import Big from "big.js";
import { useEffect, useId } from "react";
import { Input } from "@/components/ui/input";
import { checkLotPicks, defaultLotPicks, lotLabel, type LotBalance, type LotPick } from "@/lib/inventory/material-lots";

export function lotPicksValid(required: string, picks: LotPick[], lots: LotBalance[], name: string, unit: string) {
  return checkLotPicks({ name, unit, required, picks: picks.filter((pick) => pick.quantity !== ""), balances: lots }).length === 0;
}

export function LotPicker({ name, unit, required, lots, value, onChange }: { name: string; unit: string; required: string; lots: LotBalance[]; value: LotPick[]; onChange: (picks: LotPick[]) => void }) {
  const id = useId();
  useEffect(() => {
    if (value.length === 0) {
      const preset = defaultLotPicks(required, lots);
      if (preset.length) onChange(preset);
    }
    // Pre-fill once per requirement or lot list change, never over the operator's input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, lots]);

  const filled = value.filter((pick) => pick.quantity !== "");
  const errors = checkLotPicks({ name, unit, required, picks: filled, balances: lots });
  let total = new Big(0);
  for (const pick of filled) { try { total = total.plus(pick.quantity); } catch { /* shown as an error */ } }

  function setQuantity(lotId: string, quantity: string) {
    const others = value.filter((pick) => pick.lotId !== lotId);
    onChange(quantity === "" ? others : [...others, { lotId, quantity }]);
  }

  if (!lots.length) return <p className="text-sm text-destructive">{`${name}: no stock in this store`}</p>;
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{`${name}: ${Number(required)} ${unit} needed`}</legend>
      {lots.map((lot) => {
        const label = `${lotLabel(lot, unit)}, ${Number(lot.quantity)} ${unit} here`;
        return (
          <div key={lot.lotId} className="flex items-center justify-between gap-3">
            <label htmlFor={`${id}-${lot.lotId}`} className="min-w-0 text-sm">{label}</label>
            <Input id={`${id}-${lot.lotId}`} aria-label={label} type="number" inputMode="decimal" step="0.001" min="0" className="w-32"
              value={value.find((pick) => pick.lotId === lot.lotId)?.quantity ?? ""} onChange={(event) => setQuantity(lot.lotId, event.target.value)} />
          </div>
        );
      })}
      {errors.length === 0
        ? <p className="text-sm text-muted-foreground">{`Total ${total.toString()} of ${Number(required)} ${unit} ✓`}</p>
        : errors.map((error) => <p key={error} className="text-sm text-destructive">{error}</p>)}
    </fieldset>
  );
}
```

```ts
// src/server-functions/inventory/stock/get-material-lots-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { listLotBalances, lockMaterialStock } from "@/lib/inventory/material-lots.server";
import type { LotBalance } from "@/lib/inventory/material-lots";
import { requireFactoryFloorViewMiddleware } from "@/lib/middlewares";

export const getMaterialLotsFn = createServerFn()
  .middleware([requireFactoryFloorViewMiddleware])
  .inputValidator(z.object({ warehouseId: z.string().min(1), materialType: z.enum(["chemical", "packaging"]), materialIds: z.array(z.string().min(1)).min(1).max(100) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const refs = data.materialIds.map((materialId) => ({ materialType: data.materialType, materialId }));
    // Locking also turns stock from before lots into opening lots, so the picker shows it.
    await lockMaterialStock(tx, [data.warehouseId], refs);
    const result: Record<string, LotBalance[]> = {};
    for (const ref of refs) result[ref.materialId] = await listLotBalances(tx, data.warehouseId, ref);
    return result;
  }));
```

```ts
// src/hooks/stock/use-material-lots.ts
import { useQuery } from "@tanstack/react-query";
import { getMaterialLotsFn } from "@/server-functions/inventory/stock/get-material-lots-fn";
import type { MaterialType } from "@/lib/inventory/material-lots";

export function useMaterialLots(warehouseId: string | undefined, materialType: MaterialType, materialIds: string[]) {
  const ids = [...new Set(materialIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["material-lots", warehouseId, materialType, ids],
    queryFn: () => getMaterialLotsFn({ data: { warehouseId: warehouseId!, materialType, materialIds: ids } }),
    enabled: !!warehouseId && ids.length > 0,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test -- src/__tests__/lot-picker.behavior.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/lot-picker.tsx src/server-functions/inventory/stock/get-material-lots-fn.ts src/hooks/stock/use-material-lots.ts src/__tests__/lot-picker.behavior.test.tsx
git commit -m "feat(inventory): add lot picker and lot balance read"
```

(If you postponed Task 5 Step 5, do it now and commit it separately.)

---

### Task 7: Transfers and store closing move lots

**Files:**
- Modify: `src/server-functions/inventory/stock/transfer-stock-core.server.ts:288-346` (`transferMaterialStock`)
- Modify: `src/server-functions/inventory/stock/transfer-stock-fn.ts:14-140`
- Modify: `src/server-functions/inventory/toggle-warehouse-status-fn.ts:80-120`
- Modify: `src/lib/validators/validators.ts` (`transferStockSchema`): add `lotPicks: z.array(lotPickSchema).max(50).optional()`
- Modify: `src/components/inventory/transfer-stock-dialog.tsx`
- Modify: `src/hooks/stock/use-transfer-stock.ts` (invalidate `["material-lots"]`)
- Test: `src/__tests__/integration/material-lot-transfers.test.ts`

**Interfaces:**
- Consumes: `lockMaterialStock`, `takeLotPicks`, `moveLotStock`, `relocateAllLots` (Task 3); `LotPicker`, `lotPicksValid`, `useMaterialLots` (Task 6).
- Produces: new signature `transferMaterialStock(tx, input: { fromWarehouseId; toWarehouseId; materialType: MaterialType; materialId; quantity: string; picks: LotPick[]; name: string; unit: string; referenceId: string }): Promise<PickedLot[]>`.

- [ ] **Step 1: Write the failing integration test**

Copy the server-function mocks from `two-phase-stock-transfers.test.ts` (top of the file, the `vi.mock(...)` calls) into the new file. Then:

```ts
// src/__tests__/integration/material-lot-transfers.test.ts (after mocks)
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, user, warehouses, chemicals, materialLotStock, stockTransfers } from "@/db";
import { findOrCreateLot, lockMaterialStock, moveLotStock } from "@/lib/inventory/material-lots.server";
import { transferStockFn } from "@/server-functions/inventory/stock/transfer-stock-fn";

const warehouseValues = { address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" };

describe.skipIf(!process.env.TEST_DATABASE_URL)("lot transfers", () => {
  it("moves the picked lots and records one transfer row per lot", async () => {
    const id = randomUUID();
    const [actor] = await db.insert(user).values({ id, name: "Store", email: `${id}@test.invalid` }).returning();
    const [from] = await db.insert(warehouses).values({ ...warehouseValues, name: id }).returning();
    const [to] = await db.insert(warehouses).values({ ...warehouseValues, name: `${id}-to` }).returning();
    const [soda] = await db.insert(chemicals).values({ name: `${id}-soda`, unit: "kg", costPerUnit: "115" }).returning();
    const ref = { materialType: "chemical" as const, materialId: soda.id };
    const [a, b] = await db.transaction(async (tx) => {
      await lockMaterialStock(tx, [from.id], [ref]);
      const a = await findOrCreateLot(tx, ref, "115");
      const b = await findOrCreateLot(tx, ref, "125");
      await moveLotStock(tx, { ref, lotId: a.id, warehouseId: from.id, delta: "100", sourceType: "purchase" });
      await moveLotStock(tx, { ref, lotId: b.id, warehouseId: from.id, delta: "420", sourceType: "purchase" });
      return [a, b];
    });
    const context = { session: { user: actor }, authContext: { session: { user: actor } } };
    const base = { fromWarehouseId: from.id, toWarehouseId: to.id, materialType: "chemical", materialId: soda.id, quantity: "150", looseUnits: "0", notes: "" };
    await expect(transferStockFn({ data: { ...base, lotPicks: [{ lotId: a.id, quantity: "100" }] }, context } as never)).rejects.toThrow("lots add up to 100");
    await transferStockFn({ data: { ...base, lotPicks: [{ lotId: a.id, quantity: "100" }, { lotId: b.id, quantity: "50" }] }, context } as never);
    const arrived = await db.select().from(materialLotStock).where(eq(materialLotStock.warehouseId, to.id));
    expect(arrived.map((row) => row.quantity).sort()).toEqual(["100.000", "50.000"]);
    const rows = await db.select().from(stockTransfers).where(and(eq(stockTransfers.fromWarehouseId, from.id), eq(stockTransfers.materialId, soda.id)));
    expect(rows.map((row) => [row.lotId, row.quantity]).sort()).toEqual([[a.id, "100.000"], [b.id, "50.000"]].sort());
  });
});
```

Match `base` to the real `transferStockSchema` fields (see `validators.ts:188`).

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-transfers.test.ts`
Expected: FAIL. `lotPicks` is ignored.

- [ ] **Step 3: Replace `transferMaterialStock`**

```ts
export async function transferMaterialStock(
  tx: Tx,
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    materialType: "chemical" | "packaging";
    materialId: string;
    quantity: string;
    picks: LotPick[];
    name: string;
    unit: string;
    referenceId: string;
  },
) {
  const ref = { materialType: input.materialType, materialId: input.materialId };
  await lockMaterialStock(tx, [input.fromWarehouseId, input.toWarehouseId], [ref]);
  const picked = await takeLotPicks(tx, {
    warehouseId: input.fromWarehouseId, ref, name: input.name, unit: input.unit,
    required: new Big(input.quantity).toFixed(3), picks: input.picks,
    sourceType: "transfer_out", sourceId: input.referenceId,
  });
  for (const row of picked)
    await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: input.toWarehouseId, delta: row.quantity, sourceType: "transfer_in", sourceId: input.referenceId });
  return picked;
}
```

Imports: `lockMaterialStock, moveLotStock, takeLotPicks` from `@/lib/inventory/material-lots.server` and `type LotPick` from `@/lib/inventory/material-lots`. Remove `materialStock`, `gte` and `inArray` from imports if they're now unused in that file.

- [ ] **Step 4: Update `transferStockFn`**

In the non-finished branch:
1. Require picks: `if (!data.lotPicks?.length) throw new Error("Pick the lots to move");`
2. Load the name and unit: for chemicals `select name, unit from chemicals`; for packaging, use `name` and the unit `"pcs"`.
3. `const picked = await transferMaterialStock(tx, { ...data, materialType: data.materialType, picks: data.lotPicks, name, unit, referenceId: id });`
4. Replace the two audit rows with two rows per picked lot (same fields as before, plus `amount: row.quantity` and `lotId: row.lotId`).
5. Replace the single `stockTransfers` insert for raw materials with one insert per picked lot, each with its own `id`. The first row uses `id` so the return value keeps working; the others use `createId()`. Each row gets `lotId: row.lotId, quantity: row.quantity`. Keep the finished-goods branch inserting exactly as before.

- [ ] **Step 5: Store closing**

In `toggle-warehouse-status-fn.ts`, replace the `transferMaterialStock(...)` call inside the loop with:

```ts
            const ref = { materialType: item.chemicalId ? "chemical" : "packaging", materialId: item.chemicalId ?? item.packagingMaterialId! } as const;
            await lockMaterialStock(tx, [warehouseId, transferToWarehouseId], [ref]);
            const moved = await relocateAllLots(tx, { fromWarehouseId: warehouseId, toWarehouseId: transferToWarehouseId, ref, sourceId: warehouseId });
```

Then write the audit rows per `moved` lot (`amount: row.quantity`, `lotId: row.lotId`) instead of the single pair. Locking `material_stock` rows here comes after the earlier `select ... for update` on the same rows, which is the same row lock, so it's safe.

- [ ] **Step 6: Transfer dialog**

In `transfer-stock-dialog.tsx`:
1. `const [lotPicks, setLotPicks] = useState<LotPick[]>([]);` Reset it to `[]` whenever the source warehouse, material type, material or quantity changes.
2. `const lots = useMaterialLots(fromWarehouseId, materialType === "finished" ? "chemical" : materialType, materialType === "finished" ? [] : [materialId]);`
3. Below the quantity field, when the material type isn't `"finished"`, the material is chosen and the quantity is > 0, render:
   ```tsx
   <LotPicker name={selectedMaterial.name} unit={selectedMaterial.unit ?? "pcs"} required={quantity} lots={lots.data?.[materialId] ?? []} value={lotPicks} onChange={setLotPicks} />
   ```
4. Disable submit unless `lotPicksValid(quantity, lotPicks, lots.data?.[materialId] ?? [], name, unit)` for raw materials.
5. Send `lotPicks` in the mutation payload.

In `use-transfer-stock.ts`, add `queryClient.invalidateQueries({ queryKey: ["material-lots"] });` to `onSuccess`.

- [ ] **Step 7: Run tests**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-transfers.test.ts src/__tests__/integration/two-phase-stock-transfers.test.ts`
Expected: the new test PASSES. Older raw-material transfer tests that call `transferStockFn` without `lotPicks` now fail with "Pick the lots to move". Update those calls to pass picks: seed a lot with `findOrCreateLot` + `moveLotStock` instead of inserting `material_stock` directly, then pass `lotPicks`. Finished-goods transfer tests must pass unchanged.
Run: `bun run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/inventory src/lib/validators/validators.ts src/components/inventory/transfer-stock-dialog.tsx src/hooks/stock/use-transfer-stock.ts src/__tests__/integration
git commit -m "feat(inventory): pick lots when transferring raw materials"
```

---

### Task 8: Mixing start takes picked lots

**Files:**
- Modify: `src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts`
- Modify: `src/lib/production/mixing-stock.server.ts` (stock check uses the locked totals, unchanged; drop `costPerUnit` from requirements' cost use)
- Create: `src/components/mixing/start-mixing-dialog.tsx`
- Modify: `src/components/mixing/mixing-run-details-container.tsx:41-50` (the button opens the dialog)
- Modify: `src/hooks/manufacturing/mixing/use-mixing-mutations.ts` (`useStartMixingRun` invalidates `["material-lots"]`)
- Test: `src/__tests__/integration/material-lot-mixing.test.ts`, `src/__tests__/start-mixing-dialog.behavior.test.tsx`

**Interfaces:**
- Consumes: Task 3 module, Task 6 picker and hook, `loadMixingStockRequirements` (existing; returns `materials: { chemicalId, name, unit, quantity }[]` and `shortages`).
- Produces: `startMixingRunFn` input is now `{ mixingRunId: string; lotPicks: MaterialLotPicks[] }`. `mixingMaterialsUsed` gets one row per chemical per picked lot, with `lotId`, `costPerUnit` = lot price and `totalCost` = quantity × lot price. Task 10 relies on these rows.
- Produces: `getMixingRunFn` result already includes the formula. The dialog needs the formula's chemical list with quantities. Reuse an existing read if one returns ingredients for a formula (search `formulaIngredients` in `src/server-functions/manufacturing`). Otherwise add `getMixingStartRequirementsFn({ data: { mixingRunId } }) => Promise<{ warehouseId: string; materials: { chemicalId; name; unit; quantity }[] }>`, implemented by calling `loadMixingStockRequirements` inside a read transaction with `requireManufacturingRunManageMiddleware`.

- [ ] **Step 1: Write the failing integration test**

Seed: user, factory floor, product, chemical A (two lots: 120 at Rs 115 and 80 at Rs 125), a formula with one ingredient A × 200 and `batchSize` 200, and a scheduled mixing run on that floor. Copy the run and formula insert values from `src/__tests__/integration/mixing-stock-creation.test.ts`, which already builds a valid scheduled run. Then:

```ts
it("costs the batch at the picked lot prices and records one usage row per lot", async () => {
  // ...seed as described, giving { context, run, chemical, lotA, lotB }
  await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }] }] }, context } as never))
    .rejects.toThrow("lots add up to 120");
  await startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [{ materialId: chemical.id, picks: [{ lotId: lotA.id, quantity: "120" }, { lotId: lotB.id, quantity: "80" }] }] }, context } as never);
  const [started] = await db.select().from(mixingRuns).where(eq(mixingRuns.id, run.id));
  expect(started.totalChemicalCost).toBe("23800.00");
  const used = await db.select().from(mixingMaterialsUsed).where(eq(mixingMaterialsUsed.mixingRunId, run.id));
  expect(used.map((row) => [row.lotId, row.quantityUsed, row.costPerUnit, row.totalCost]).sort()).toEqual([
    [lotA.id, "120.000", "115.00", "13800.00"], [lotB.id, "80.000", "125.00", "10000.00"],
  ].sort());
});

it("refuses a start without picks for every formula chemical", async () => {
  // ...seed
  await expect(startMixingRunFn({ data: { mixingRunId: run.id, lotPicks: [] }, context } as never)).rejects.toThrow("Pick lots for");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-mixing.test.ts`
Expected: FAIL

- [ ] **Step 3: Server change**

Schema: `z.object({ mixingRunId: z.string().min(1), lotPicks: z.array(materialLotPicksSchema).max(100) })`.

After `loadMixingStockRequirements` (keep the shortage check as it is: it gives the clearer "transfer more" message), replace the deduction loop and the usage loop with:

```ts
      const refs = materials.map((item) => ({ materialType: "chemical" as const, materialId: item.chemicalId }));
      await lockMaterialStock(tx, [factoryFloor.id], refs);
      let totalChemicalCost = new Big(0);
      for (const item of materials) {
        const chosen = data.lotPicks.find((row) => row.materialId === item.chemicalId);
        if (!chosen) throw new Error(`Pick lots for ${item.name}`);
        const picked = await takeLotPicks(tx, {
          warehouseId: factoryFloor.id, ref: { materialType: "chemical", materialId: item.chemicalId },
          name: item.name, unit: item.unit, required: item.quantity, picks: chosen.picks,
          sourceType: "mixing", sourceId: mixingRun.id,
        });
        for (const row of picked) {
          totalChemicalCost = totalChemicalCost.plus(row.totalCost);
          await tx.insert(mixingMaterialsUsed).values({ mixingRunId: mixingRun.id, chemicalId: item.chemicalId, lotId: row.lotId, quantityUsed: row.quantity, costPerUnit: row.unitPrice, totalCost: row.totalCost });
          await tx.insert(inventoryAuditLog).values({ warehouseId: factoryFloor.id, materialType: "chemical", materialId: item.chemicalId, lotId: row.lotId, type: "debit", amount: row.quantity, reason: `Mixing batch ${mixingRun.batchId} started`, performedById: context.session.user.id, referenceId: mixingRun.id });
        }
      }
      const extra = data.lotPicks.find((row) => !materials.some((item) => item.chemicalId === row.materialId));
      if (extra) throw new Error("Lots were picked for a chemical that is not in this formula");
```

`loadMixingStockRequirements` locks `material_stock` rows `for update` in chemical order. `lockMaterialStock` then re-locks the same rows (a no-op for the lock) and creates opening lots. Order stays consistent. Remove now-unused imports (`materialStock`, `gte`, `sql`) from the start function.

- [ ] **Step 4: Run the integration test**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-mixing.test.ts src/__tests__/integration/two-phase-production.test.ts`
Expected: the new tests PASS. Older tests that start a run without `lotPicks` need the same picks fix as in Task 7 Step 7.

- [ ] **Step 5: Write the failing dialog test**

```tsx
// src/__tests__/start-mixing-dialog.behavior.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StartMixingDialogBody } from "@/components/mixing/start-mixing-dialog";

const lots = { soda: [
  { lotId: "a", unitPrice: "115.00", quantity: "120.000", firstPurchasedAt: "2026-10-01T05:00:00Z" },
  { lotId: "b", unitPrice: "125.00", quantity: "80.000", firstPurchasedAt: "2026-10-20T05:00:00Z" },
] };

describe("StartMixingDialogBody", () => {
  it("enables Start only when every chemical's lots add up", () => {
    const onStart = vi.fn();
    render(<StartMixingDialogBody materials={[{ chemicalId: "soda", name: "Soda Ash", unit: "kg", quantity: "200.000" }]} lots={lots} pending={false} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Start Mixing Batch" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Rs 115/kg (first 1 Oct), 120 kg here"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Rs 125/kg (first 20 Oct), 80 kg here"), { target: { value: "80" } });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith([{ materialId: "soda", picks: expect.arrayContaining([{ lotId: "a", quantity: "120" }, { lotId: "b", quantity: "80" }]) }]);
  });
});
```

- [ ] **Step 6: Implement the dialog**

```tsx
// src/components/mixing/start-mixing-dialog.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { LotPicker, lotPicksValid } from "@/components/inventory/lot-picker";
import { useMaterialLots } from "@/hooks/stock/use-material-lots";
import type { LotBalance, LotPick, MaterialLotPicks } from "@/lib/inventory/material-lots";
import { getMixingStartRequirementsFn } from "@/server-functions/manufacturing/mixing/get-mixing-start-requirements-fn";

type Requirement = { chemicalId: string; name: string; unit: string; quantity: string };

export function StartMixingDialogBody({ materials, lots, pending, onStart }: { materials: Requirement[]; lots: Record<string, LotBalance[]>; pending: boolean; onStart: (picks: MaterialLotPicks[]) => void }) {
  const [picks, setPicks] = useState<Record<string, LotPick[]>>({});
  const ready = materials.every((item) => lotPicksValid(item.quantity, picks[item.chemicalId] ?? [], lots[item.chemicalId] ?? [], item.name, item.unit));
  return (
    <div className="flex flex-col gap-4">
      {materials.map((item) => (
        <LotPicker key={item.chemicalId} name={item.name} unit={item.unit} required={item.quantity} lots={lots[item.chemicalId] ?? []}
          value={picks[item.chemicalId] ?? []} onChange={(next) => setPicks((current) => ({ ...current, [item.chemicalId]: next }))} />
      ))}
      <Button disabled={!ready || pending} onClick={() => onStart(materials.map((item) => ({ materialId: item.chemicalId, picks: picks[item.chemicalId] ?? [] })))}>
        {pending ? "Starting..." : "Start Mixing Batch"}
      </Button>
    </div>
  );
}

export function StartMixingDialog({ runId, open, onOpenChange, pending, onStart }: { runId: string; open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; onStart: (picks: MaterialLotPicks[]) => void }) {
  const requirements = useQuery({ queryKey: ["mixing-start-requirements", runId], queryFn: () => getMixingStartRequirementsFn({ data: { mixingRunId: runId } }), enabled: open });
  const lots = useMaterialLots(requirements.data?.warehouseId, "chemical", requirements.data?.materials.map((item) => item.chemicalId) ?? []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick lots to start</DialogTitle>
          <DialogDescription>Choose which price lot each chemical comes from. Lots must add up to the formula amount.</DialogDescription>
        </DialogHeader>
        {requirements.error || lots.error
          ? <p className="text-sm text-destructive">{(requirements.error ?? lots.error)!.message}</p>
          : !requirements.data || !lots.data
            ? <Skeleton className="h-40 w-full" />
            : <StartMixingDialogBody materials={requirements.data.materials} lots={lots.data} pending={pending} onStart={onStart} />}
      </DialogContent>
    </Dialog>
  );
}
```

Add `src/server-functions/manufacturing/mixing/get-mixing-start-requirements-fn.ts` as described in Interfaces:

```ts
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mixingRuns } from "@/db/schemas/production-schema";
import { requireManufacturingRunManageMiddleware } from "@/lib/middlewares";
import { loadMixingStockRequirements } from "@/lib/production/mixing-stock.server";

export const getMixingStartRequirementsFn = createServerFn()
  .middleware([requireManufacturingRunManageMiddleware])
  .inputValidator(z.object({ mixingRunId: z.string().min(1) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const [run] = await tx.select().from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId));
    if (!run) throw new Error("Mixing batch not found");
    const { materials } = await loadMixingStockRequirements(tx, run.formulaId, run.warehouseId);
    return { warehouseId: run.warehouseId, materials: materials.map(({ chemicalId, name, unit, quantity }) => ({ chemicalId, name, unit, quantity })) };
  }));
```

In `mixing-run-details-container.tsx`, the "Start Mixing Batch" button now sets `startOpen` to true. Render:

```tsx
<StartMixingDialog runId={runId} open={startOpen} onOpenChange={setStartOpen} pending={startRun.isPending}
  onStart={(lotPicks) => startRun.mutate({ data: { mixingRunId: runId, lotPicks } }, { onSuccess: () => setStartOpen(false) })} />
```

In `useStartMixingRun.onSuccess`, add `queryClient.invalidateQueries({ queryKey: ["material-lots"] });`.

- [ ] **Step 7: Run tests**

Run: `bun run test -- src/__tests__/start-mixing-dialog.behavior.test.tsx src/__tests__/manufacturing-screens.behavior.test.tsx src/__tests__/manufacturing-mutations.behavior.test.tsx`
Expected: PASS. If an existing screen test clicked "Start Mixing Batch" and expected the mutation right away, update it to expect the dialog to open.
Run: `bun run typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/server-functions/manufacturing/mixing src/lib/production/mixing-stock.server.ts src/components/mixing src/hooks/manufacturing/mixing src/__tests__
git commit -m "feat(mixing): pick chemical lots when starting a batch"
```

---

### Task 9: Packing takes picked lots

**Files:**
- Modify: `src/lib/production/batch-packing.ts` (add the pure `packingMaterialNeeds`)
- Modify: `src/server-functions/manufacturing/packaging/batch-packing-core.server.ts:14-112`
- Modify: `src/server-functions/manufacturing/packaging/get-batch-packing-context-fn.ts:25-30` (also return the material plan inputs)
- Modify: `src/components/packaging/batch-packing-form.tsx` and `src/components/packaging/packing-draft.ts` (draft gets `lotPicks`)
- Modify: `src/hooks/manufacturing/packaging/use-batch-packing.ts` (invalidate `["material-lots"]` after recording)
- Test: `src/lib/production/batch-packing.test.ts` (create, or append if it exists), `src/__tests__/integration/batch-packing.test.ts` (extend), `src/__tests__/batch-packing-form.behavior.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 3 module, Task 6 picker and hook.
- Produces:
  - `packingMaterialNeeds(items: { formatId: string; containerPackagingId: string | null; cartonPackagingId: string | null; totalPacks: number; physicalCartons: number }[], extras: { recipeId: string; packagingMaterialId: string; quantityPerContainer: string; usageBasis: string | null }[]): Map<string, { total: Big; byFormat: Map<string, Big> }>`. Throws "A retail pack material is required" when `containerPackagingId` is null.
  - `batchPackingSchema` gains `lotPicks: z.array(materialLotPicksSchema).max(100)`.
  - Context result gains `formatMaterials: { formatId; containerPackagingId; cartonPackagingId }[]`, `extras: { recipeId; packagingMaterialId; quantityPerContainer; usageBasis }[]`, `materials: { id; name }[]` and `warehouseId`.
  - `packagingMaterialsUsed` gets one row per format per material per lot, with `lotId`.

- [ ] **Step 1: Write the failing pure test**

```ts
// src/lib/production/batch-packing.test.ts (add)
import Big from "big.js";
import { describe, expect, it } from "vitest";
import { packingMaterialNeeds } from "./batch-packing";

describe("packingMaterialNeeds", () => {
  it("adds retail packs, cartons and extras, and keeps each format's share", () => {
    const needs = packingMaterialNeeds(
      [
        { formatId: "f100", containerPackagingId: "bag", cartonPackagingId: "box", totalPacks: 1080, physicalCartons: 45 },
        { formatId: "f50", containerPackagingId: "bag", cartonPackagingId: "box", totalPacks: 240, physicalCartons: 5 },
      ],
      [
        { recipeId: "f100", packagingMaterialId: "cap", quantityPerContainer: "1", usageBasis: "per_unit" },
        { recipeId: "f100", packagingMaterialId: "sticker", quantityPerContainer: "1", usageBasis: "per_carton" },
      ],
    );
    expect(needs.get("bag")!.total.toString()).toBe("1320");
    expect(needs.get("bag")!.byFormat.get("f50")!.toString()).toBe("240");
    expect(needs.get("box")!.total.toString()).toBe("50");
    expect(needs.get("cap")!.total.toString()).toBe("1080");
    expect(needs.get("sticker")!.total.toString()).toBe("45");
  });
  it("requires a retail pack", () => {
    expect(() => packingMaterialNeeds([{ formatId: "f", containerPackagingId: null, cartonPackagingId: null, totalPacks: 1, physicalCartons: 0 }], [])).toThrow("A retail pack material is required");
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `bun run test -- src/lib/production/batch-packing.test.ts`. Expected: FAIL.

Append to `src/lib/production/batch-packing.ts`:

```ts
import { normalizePackagingUsageBasis } from "@/lib/recipe-packaging";

export function packingMaterialNeeds(
  items: { formatId: string; containerPackagingId: string | null; cartonPackagingId: string | null; totalPacks: number; physicalCartons: number }[],
  extras: { recipeId: string; packagingMaterialId: string; quantityPerContainer: string; usageBasis: string | null }[],
) {
  const needs = new Map<string, { total: Big; byFormat: Map<string, Big> }>();
  const add = (materialId: string | null, formatId: string, count: Big) => {
    if (!materialId || count.eq(0)) return;
    const entry = needs.get(materialId) ?? { total: new Big(0), byFormat: new Map<string, Big>() };
    entry.total = entry.total.plus(count);
    entry.byFormat.set(formatId, (entry.byFormat.get(formatId) ?? new Big(0)).plus(count));
    needs.set(materialId, entry);
  };
  for (const item of items) {
    if (!item.containerPackagingId) throw new Error("A retail pack material is required");
    add(item.containerPackagingId, item.formatId, new Big(item.totalPacks));
    add(item.cartonPackagingId, item.formatId, new Big(item.physicalCartons));
    for (const extra of extras.filter((row) => row.recipeId === item.formatId))
      add(extra.packagingMaterialId, item.formatId, new Big(extra.quantityPerContainer).times(normalizePackagingUsageBasis(extra.usageBasis) === "per_carton" ? item.physicalCartons : item.totalPacks));
  }
  return needs;
}
```

Move the `import` to the top of the file with the others. Check `normalizePackagingUsageBasis` accepts `string | null`; if it takes `string`, pass `extra.usageBasis ?? "per_unit"`. Run the test again. Expected: PASS.

- [ ] **Step 3: Extend the packing integration test (failing)**

In `src/__tests__/integration/batch-packing.test.ts`, find where the seed gives packaging stock with a direct `materialStock` insert. Replace it with lots: `lockMaterialStock` + `findOrCreateLot(tx, ref, costPerUnit)` + `moveLotStock(..., sourceType: "purchase")`, keeping the same quantities and prices. Make the seed return the lot ids. Every `recordBatchPackingCore` call gets `lotPicks` covering each material's total need. Then add:

```ts
it("costs packaging at the picked lot prices", () => inFixture(async (tx, fixture) => {
  // carton needs 2 for this line; give the carton two lots: 1 at Rs 5 and 5 at Rs 6
  // ... record with lotPicks: carton [{ lotA, "1" }, { lotB, "1" }], retail pack [{ packLot, "<total packs>" }]
  // assert packagingMaterialsUsed rows for the carton: [lotA, "1.000", "5.00", "5.00"] and [lotB, "1.000", "6.00", "6.00"]
  // assert allocation.totalPackagingCost === packs × 2 (retail Rs 2) + 11.00
}));

it("refuses packing when picks do not cover a material", () => inFixture(async (tx, fixture) => {
  // omit the carton picks
  await expect(recordBatchPackingCore(tx, input, fixture.actor)).rejects.toThrow("Pick lots for");
}));
```

Fill in the comments with the fixture's real ids and numbers. The existing seed already creates `primary` (Rs 2) and `master` (Rs 5) packaging and a format linking them. Read the existing seed and reuse its values.

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/batch-packing.test.ts`. Expected: FAIL.

- [ ] **Step 4: Server change**

In `batchPackingSchema`, add `lotPicks: z.array(materialLotPicksSchema).max(100)`. Include `lotPicks` in the idempotency `payload` (it's part of `data`, so it already is; keep the sort for lines, and sort `lotPicks` by `materialId` the same way).

Replace the requirement-building and debit section (from `const requirements = new Map` to the end of the `for (const [id, required] ...)` debit loop) with:

```ts
  const needs = packingMaterialNeeds(prepared.map(({ format, quantity }) => ({ formatId: format.id, containerPackagingId: format.containerPackagingId, cartonPackagingId: format.cartonPackagingId, totalPacks: quantity.totalPacks, physicalCartons: quantity.physicalCartons })), extras);
  const refs = [...needs.keys()].map((materialId) => ({ materialType: "packaging" as const, materialId }));
  await lockMaterialStock(tx, [run.warehouseId], refs);
  const pickedByMaterial = new Map<string, PickedLot[]>();
  for (const [materialId, need] of [...needs].sort(([a], [b]) => a.localeCompare(b))) {
    const material = materials.find((row) => row.id === materialId);
    if (!material) throw new Error("Packaging material not found");
    const chosen = data.lotPicks.find((row) => row.materialId === materialId);
    if (!chosen) throw new Error(`Pick lots for ${material.name}`);
    pickedByMaterial.set(materialId, await takeLotPicks(tx, {
      warehouseId: run.warehouseId, ref: { materialType: "packaging", materialId }, name: material.name, unit: "pcs",
      required: packingBulk(need.total.toString(), "Packaging material quantity"), picks: chosen.picks, sourceType: "packing", sourceId: data.requestId,
    }));
  }
  if (data.lotPicks.some((row) => !needs.has(row.materialId))) throw new Error("Lots were picked for a material this packing does not use");
```

Inside the per-format loop, replace `materialRows` and `packagingCost` with a cost split by format share. Each format pays its share of each lot in proportion to how many of the material it used, and rounding is assigned cumulatively so the cents add up:

```ts
    const usage = [...needs].filter(([, need]) => need.byFormat.has(format.id)).flatMap(([materialId, need]) => {
      const share = need.byFormat.get(format.id)!;
      return pickedByMaterial.get(materialId)!.map((lot) => {
        const quantity = new Big(lot.quantity).times(share).div(need.total);
        return { materialId, lotId: lot.lotId, unitPrice: lot.unitPrice, quantity, totalCost: quantity.times(lot.unitPrice) };
      });
    });
    const packagingCost = usage.reduce((sum, row) => sum.plus(row.totalCost), new Big(0)).round(2);
```

Then replace the `for (const row of materialRows)` insert loop with:

```ts
    for (const row of usage) {
      const amount = row.quantity.round(3).toFixed(3);
      await tx.insert(packagingMaterialsUsed).values({ packagingAllocationId: allocation.id, materialId: row.materialId, lotId: row.lotId, quantityUsed: amount, costPerUnit: row.unitPrice, totalCost: row.totalCost.round(2).toFixed(2) });
      await tx.insert(inventoryAuditLog).values({ warehouseId: run.warehouseId, materialType: "packaging", materialId: row.materialId, lotId: row.lotId, type: "debit", amount, reason: `Batch packing receipt ${receipt.id}`, performedById: actor.id, referenceId: receipt.id });
    }
```

Add the comment above `usage`: `// A material shared by two formats is split by how many each used; lots split the same way.`

Remove the old `materialStock` debit and `requirements` code. Remove unused imports (`materialStock`, `gte`, `normalizePackagingUsageBasis`). Add imports: `packingMaterialNeeds` from `@/lib/production/batch-packing`; `lockMaterialStock, takeLotPicks` from `@/lib/inventory/material-lots.server`; `materialLotPicksSchema, type PickedLot` from `@/lib/inventory/material-lots`.

The receipt is inserted after the debits, so `sourceId` uses `data.requestId`. That's unique per batch receipt and stored on the receipt row, so it links back.

Run the integration test. Expected: PASS.

- [ ] **Step 5: Context read**

In `get-batch-packing-context-fn.ts`, also return:

```ts
      warehouseId: run.warehouseId,
      formatMaterials: formats.map((format) => ({ formatId: format.id, containerPackagingId: format.containerPackagingId, cartonPackagingId: format.cartonPackagingId })),
      extras: (await tx.select().from(recipePackaging).where(inArray(recipePackaging.recipeId, formats.map((format) => format.id)))).map((row) => ({ recipeId: row.recipeId, packagingMaterialId: row.packagingMaterialId, quantityPerContainer: row.quantityPerContainer, usageBasis: row.usageBasis })),
      materials: (await tx.select({ id: packagingMaterials.id, name: packagingMaterials.name }).from(packagingMaterials)),
```

Guard `inArray` against an empty `formats` list: use `[]` when there are no formats.

- [ ] **Step 6: Packing form (failing test first)**

Extend `src/__tests__/batch-packing-form.behavior.test.tsx`. Find the fixture context object the test passes in, add the new context fields with one carton material and two lots, and mock `useMaterialLots` (`vi.mock("@/hooks/stock/use-material-lots", ...)`) to return those lots. Then:

```tsx
it("asks for carton lots and blocks review until they add up", async () => {
  // render the editor with one line: 2 full cartons of 24
  // expect a LotPicker legend "Carton: 2 pcs needed"
  // expect the review/confirm button disabled
  // fill lot inputs to 2
  // expect it enabled, and the submitted payload to include lotPicks for the carton
});
```

Write the steps for real using the file's existing helpers for filling lines and clicking review.

Implementation in `batch-packing-form.tsx`:
1. Add `lotPicks: Record<string, LotPick[]>` to `PackingDraft` in `packing-draft.ts`, default `{}` in `newPackingDraft()`. Old drafts in localStorage won't have it, so read it as `draft.lotPicks ?? {}`.
2. Compute `needs` with `packingMaterialNeeds` from the `calculated` rows (only rows with a `result`) and the context's `formatMaterials` and `extras`. Catch its error and show it like other line errors.
3. `const lots = useMaterialLots(batch.warehouseId, "packaging", [...needs.keys()]);`
4. Render a "Materials used" section after the lines, with one `LotPicker` per material (name from `context.materials`, unit `"pcs"`, `required={need.total.toString()}`), bound to `draft.lotPicks[materialId]`.
5. Add to `valid`: every material's picks pass `lotPicksValid`.
6. Add `lotPicks: [...needs.keys()].map((materialId) => ({ materialId, picks: draft.lotPicks[materialId] ?? [] }))` to the submission. When lines change, drop picks for materials no longer needed.

In `use-batch-packing.ts` (the record mutation's `onSuccess`), add `queryClient.invalidateQueries({ queryKey: ["material-lots"] });`.

Run: `bun run test -- src/__tests__/batch-packing-form.behavior.test.tsx src/lib/production/batch-packing.test.ts`. Expected: PASS.

- [ ] **Step 7: Type check and commit**

Run: `bun run typecheck`

```bash
git add src/lib/production src/server-functions/manufacturing/packaging src/components/packaging src/hooks/manufacturing/packaging src/__tests__
git commit -m "feat(packing): pick packaging lots when recording packing"
```

---

### Task 10: Failed batch recovery returns to the original lots

**Files:**
- Modify: `src/server-functions/inventory/stock/recover-failed-production-chemical-fn.ts`
- Modify: `src/server-functions/inventory/stock/failed-production-recovery-core.ts` (return lot usage rows)
- Modify: `src/server-functions/inventory/stock/get-failed-production-chemical-recovery-context-fn.ts` (return lots for the dialog)
- Modify: `src/components/inventory/adjust-stock-dialog.tsx` (recovery part: show the lot split)
- Modify: `src/hooks/stock/use-recover-failed-production-chemical.ts` (invalidate `["material-lots"]`)
- Test: `src/lib/inventory/recovery-split.test.ts`, `src/__tests__/integration/material-lot-recovery.test.ts`

**Interfaces:**
- Produces: pure `splitRecoveryAcrossLots(recovered: string, usages: { lotId: string; quantity: string; unitPrice: string }[]): LotPick[]` in `src/lib/inventory/material-lots.ts`. It fills lots in usage order, never more than each lot gave.
- Produces: recovery input gains an optional `lotReturns: LotPick[]`. When absent, the default split is used. When present, it must add up to `recoveredQuantity`, and each lot must have given at least that much to this batch.

- [ ] **Step 1: Failing pure test**

```ts
// src/lib/inventory/recovery-split.test.ts
import { describe, expect, it } from "vitest";
import { splitRecoveryAcrossLots } from "./material-lots";

describe("splitRecoveryAcrossLots", () => {
  const usages = [{ lotId: "a", quantity: "120.000", unitPrice: "115.00" }, { lotId: "b", quantity: "80.000", unitPrice: "125.00" }];
  it("refills lots in the order the batch took them", () => {
    expect(splitRecoveryAcrossLots("150", usages)).toEqual([{ lotId: "a", quantity: "120.000" }, { lotId: "b", quantity: "30.000" }]);
    expect(splitRecoveryAcrossLots("50", usages)).toEqual([{ lotId: "a", quantity: "50.000" }]);
  });
  it("never returns more than the batch took", () => {
    expect(() => splitRecoveryAcrossLots("201", usages)).toThrow("Recovered quantity is more than this batch took");
  });
});
```

- [ ] **Step 2: Implement (append to `material-lots.ts`)**

```ts
export function splitRecoveryAcrossLots(recovered: string, usages: { lotId: string; quantity: string; unitPrice: string }[]): LotPick[] {
  let left = new Big(recovered);
  const taken = usages.reduce((sum, row) => sum.plus(row.quantity), new Big(0));
  if (left.gt(taken)) throw new Error("Recovered quantity is more than this batch took");
  const picks: LotPick[] = [];
  for (const usage of usages) {
    if (left.lte(0)) break;
    const amount = new Big(usage.quantity).lt(left) ? new Big(usage.quantity) : left;
    picks.push({ lotId: usage.lotId, quantity: amount.toFixed(3) });
    left = left.minus(amount);
  }
  return picks;
}
```

Run: `bun run test -- src/lib/inventory/recovery-split.test.ts`. Expected: PASS.

- [ ] **Step 3: Failing integration test**

Seed a failed run whose `mixingMaterialsUsed` has two rows for the chemical (lot A 120 at 115, lot B 80 at 125), with lots existing but holding 0 on the floor. Copy run setup from `mixing-stock-creation.test.ts` and set `status: "failed"`. Call `recoverFailedProductionChemicalFn` with `recoveredQuantity: 150`, then assert lot A on the floor = 120.000 and lot B = 30.000, `material_stock` total = 150.000, and two `material_lot_movements` rows with `sourceType "recovery"` and `sourceId` = run id. Then a second case with `lotReturns: [{ lotId: B, quantity: "80" }, { lotId: A, quantity: "70" }]` asserting that split. Then a case returning 90 to B, which is rejected with "Lot returns can't be more than this batch took from that lot".

Mock the middlewares and react-start as in Task 4.

- [ ] **Step 4: Server change**

In `recover-failed-production-chemical-fn.ts`:
1. Schema: add `lotReturns: z.array(lotPickSchema).max(50).optional()`.
2. Replace the whole `if (data.recoveredQuantity > 0) { ... }` stock block with:

```ts
      if (data.recoveredQuantity > 0) {
        const ref = { materialType: "chemical", materialId: recovery.chemical.id } as const;
        await lockMaterialStock(tx, [recovery.factoryFloor.id], [ref]);
        const usages = recovery.lotUsages;
        if (usages.some((row) => !row.lotId)) throw new Error("This batch was started before price lots. Contact support to recover it.");
        const recovered = new Big(data.recoveredQuantity).toFixed(3);
        const returns = data.lotReturns ?? splitRecoveryAcrossLots(recovered, usages.map((row) => ({ lotId: row.lotId!, quantity: row.quantityUsed, unitPrice: row.costPerUnit })));
        const returned = returns.reduce((sum, row) => sum.plus(row.quantity), new Big(0));
        if (!returned.eq(recovered)) throw new Error("Lot returns must add up to the recovered quantity");
        for (const row of returns) {
          const gave = usages.filter((usage) => usage.lotId === row.lotId).reduce((sum, usage) => sum.plus(usage.quantityUsed), new Big(0));
          if (new Big(row.quantity).gt(gave)) throw new Error("Lot returns can't be more than this batch took from that lot");
          await moveLotStock(tx, { ref, lotId: row.lotId, warehouseId: recovery.factoryFloor.id, delta: row.quantity, sourceType: "recovery", sourceId: recovery.run.id });
          await tx.insert(inventoryAuditLog).values({ warehouseId: recovery.factoryFloor.id, materialType: "chemical", materialId: recovery.chemical.id, lotId: row.lotId, type: "credit", amount: row.quantity,
            reason: `[FAILED BATCH RECOVERY] Batch ${recovery.run.batchId} returned ${row.quantity} ${recovery.chemical.unit} of ${recovery.chemical.name}. ${data.reason.trim()}`,
            performedById: context.session.user.id, referenceId: recovery.run.id });
        }
        const [total] = await tx.select({ quantity: materialStock.quantity }).from(materialStock).where(and(eq(materialStock.warehouseId, recovery.factoryFloor.id), eq(materialStock.chemicalId, recovery.chemical.id)));
        newQty = Number(total?.quantity ?? 0);
      }
```

3. In `failed-production-recovery-core.ts`, add `lotUsages: usages` (the rows already filtered for this chemical, in insert order; add `.orderBy` on `createdAt` if `materialsUsed` isn't ordered, or sort by `createdAt` in code) to the returned object.

Recovery keeps one `failedProductionChemicalRecoveries` row per chemical, as today. Loss cost stays `totalCost ÷ expectedQuantity` (the batch's average lot cost), which matches what the batch paid.

- [ ] **Step 5: Dialog**

In `get-failed-production-chemical-recovery-context-fn.ts`, return `lotUsages: { lotId, quantity, unitPrice, firstPurchasedAt }[]` (join `materialLots` for `firstPurchasedAt`). In `adjust-stock-dialog.tsx`, in recovery mode: once a recovered amount is typed, show the default split from `splitRecoveryAcrossLots` as editable inputs, one per lot, labelled with `lotLabel(...)` and "batch took X". If the operator edits the inputs, send them as `lotReturns`. Disable confirm unless they add up to the recovered amount.

- [ ] **Step 6: Run tests, commit**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-recovery.test.ts` and `bun run test -- src/lib/inventory`. Expected: PASS. Run `bun run typecheck`.

```bash
git add src/lib/inventory src/server-functions/inventory/stock src/components/inventory/adjust-stock-dialog.tsx src/hooks/stock src/__tests__/integration/material-lot-recovery.test.ts
git commit -m "feat(inventory): return recovered chemicals to their original lots"
```

---

### Task 11: Adjustments per lot, and close every other stock write path

**Files:**
- Modify: `src/server-functions/inventory/stock/adjust-stock-fn.ts`
- Modify: `src/components/inventory/adjust-stock-dialog.tsx` (manual adjustment part: pick a lot)
- Modify: `src/hooks/stock/use-adjust-stock.ts` (invalidate `["material-lots"]`)
- Modify: `src/server-functions/inventory/stock/update-stock-fn.ts` (delete `updateStockFn`, keep `updateOutsidePackStockFn`)
- Modify: `src/server-functions/inventory/update-material-fn.ts` (stop editing quantity)
- Modify: the edit-material form that sends `stockId` and `quantity` (find it by searching `updateMaterialFn`): remove the quantity field
- Modify: `src/server-functions/manufacturing/packaging/log-packaging-progress-fn.ts:180-205` (retire material deduction)
- Modify: `src/server-functions/inventory/delete-material-fn.ts`, `src/server-functions/inventory/delete-warehouse-fn.ts` (clean up lots)
- Test: `src/__tests__/integration/material-lot-adjustments.test.ts`, `src/__tests__/material-stock-writers.test.ts`

**Interfaces:**
- Produces: `adjustStockFn` input `{ materialType, materialId, lotId: string, adjustment: number, reason }`. Adding stock must target an existing lot.

- [ ] **Step 1: Failing source-inspection test (the guard)**

Every file that writes `materialStock` or `materialLotStock` must go through the lot module. This test fails while any other writer exists:

```ts
// src/__tests__/material-stock-writers.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const ALLOWED = new Set([
  "src/lib/inventory/material-lots.server.ts",
  // Removed from this list in Task 12, once purchase edit and delete use lots.
  "src/server-functions/suppliers/update-purchase-record-fn.ts",
  "src/server-functions/suppliers/delete-purchase-record-fn.ts",
]);
const WRITE = /\.(insert|update|delete)\(\s*(materialStock|materialLotStock|materialLotMovements)\b/;

describe("material stock writers", () => {
  it("only the lot module changes material stock", () => {
    const offenders = [...files("src/server-functions"), ...files("src/lib")]
      .filter((path) => !path.includes("__tests__") && !path.endsWith(".test.ts"))
      .filter((path) => !ALLOWED.has(path.replaceAll("\\", "/")) && WRITE.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

Run: `bun run test -- src/__tests__/material-stock-writers.test.ts`
Expected: FAIL, listing the remaining writers (`adjust-stock-fn.ts`, `update-stock-fn.ts`, `update-material-fn.ts`, `log-packaging-progress-fn.ts`, `delete-material-fn.ts`, `delete-warehouse-fn.ts`). The two purchase files are temporarily allowed and are fixed in Task 12.

- [ ] **Step 2: Adjustment test (failing)**

Integration test: seed a floor with lot A 120 at 115. `adjustStockFn({ lotId: A, adjustment: -2, reason: "Count short" })` gives lot A 118 and total 118. `adjustment: -200` is rejected with "Not enough stock in this lot". `adjustment: +5` on lot A gives 123. `lotId` of another item's lot is rejected with "This lot belongs to another item". Mock as in Task 4.

- [ ] **Step 3: Rewrite `adjustStockFn`**

Schema: add `lotId: z.string().min(1)`. Body (replacing the find/compute/update of `existingStock`):

```ts
      const ref = { materialType: data.materialType, materialId: data.materialId } as const;
      await lockMaterialStock(tx, [factoryFloor.id], [ref]);
      const [lot] = await tx.select().from(materialLots).where(eq(materialLots.id, data.lotId));
      if (!lot || (data.materialType === "chemical" ? lot.chemicalId : lot.packagingMaterialId) !== data.materialId)
        throw new Error("This lot belongs to another item");
      const adjustment = new Big(data.adjustment).toFixed(3);
      const [before] = await tx.select({ quantity: materialStock.quantity }).from(materialStock)
        .where(and(eq(materialStock.warehouseId, factoryFloor.id), data.materialType === "chemical" ? eq(materialStock.chemicalId, data.materialId) : eq(materialStock.packagingMaterialId, data.materialId)));
      await moveLotStock(tx, { ref, lotId: lot.id, warehouseId: factoryFloor.id, delta: adjustment, sourceType: "adjustment", sourceId: null });
      const currentQty = Number(before?.quantity ?? 0);
      const newQty = new Big(currentQty).plus(adjustment).toNumber();
```

Add `lotId: lot.id` to the audit insert. Keep the rest (name lookup, activity log, return shape).

In `adjust-stock-dialog.tsx` manual mode: load lots with `useMaterialLots(factoryFloorId, materialType, [materialId])`. Show a required "Lot" select listing `lotLabel(lot, unit)` with the quantity on the floor, and send `lotId`. Lots with zero stock aren't listed (Task 3 hides them), so "add" mode can only target lots that still hold stock. If an item has no lots with stock, show: "No lot to add to. Use Add stock to buy at a price." This matches spec section 7: adding stock picks an existing lot.

Add `["material-lots"]` invalidation to `use-adjust-stock.ts`.

- [ ] **Step 4: Remove the other writers**

1. `update-stock-fn.ts`: delete `updateStockFn` and its now-unused imports. Keep `updateOutsidePackStockFn`. Remove its uses in `src/__tests__/integration/two-phase-raw-stock.test.ts` and `two-phase-stock-transfers.test.ts`. Where those tests used it to set up stock, use `findOrCreateLot` + `moveLotStock`. Delete assertions that only tested `updateStockFn` itself. Delete `updateStockSchema` from `validators.ts` if nothing else imports it.
2. `update-material-fn.ts`: delete the `if (stockId && fields.quantity !== undefined) { ... }` block, and remove `stockId` and `quantity` from its schema. Stop sending them from the edit form, and remove the quantity input there. Changing quantity is done with an adjustment now.
3. `log-packaging-progress-fn.ts`: at the top of the handler, throw `new Error("This packing flow is retired. Record packing from the mixing batch page.")`. Delete the material deduction code below it, and any imports that become unused. The batch packing entry (Task 9) is the only packing path.
4. `delete-material-fn.ts`: before deleting `materialStock` rows, refuse when the item has any lot movement other than `opening`, or any lot stock above 0:
   ```ts
   const [used] = await tx.select({ id: materialLotMovements.id }).from(materialLotMovements).innerJoin(materialLots, eq(materialLots.id, materialLotMovements.lotId)).where(and(eq(column, data.id), ne(materialLotMovements.sourceType, "opening"))).limit(1);
   if (used) throw new Error("This item has stock history and can't be deleted.");
   ```
   Then delete in this order: movements, lot stock, lots (for that item), then the `materialStock` rows as today. Do these deletes in the lot module: add `deleteItemLots(tx, ref)` there (it's the only allowed writer), and call it.
5. `delete-warehouse-fn.ts`: it deletes `materialStock` for the warehouse. Add `deleteWarehouseLotStock(tx, warehouseId)` to the lot module, which refuses when any lot stock there is above 0 and otherwise deletes lot stock and movements for that warehouse. Call it before the existing `materialStock` delete, and move that delete into the same module function.

- [ ] **Step 5: Run tests**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-adjustments.test.ts src/__tests__/integration/two-phase-raw-stock.test.ts src/__tests__/integration/two-phase-stock-transfers.test.ts`
Expected: PASS
Run: `bun run test -- src/__tests__/material-stock-writers.test.ts`
Expected: PASS
Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/server-functions src/lib src/components/inventory src/hooks/stock src/__tests__
git commit -m "feat(inventory): adjust stock per lot and route every stock write through lots"
```

---

### Task 12: Purchase edit and delete follow the "untouched" rule

**Files:**
- Modify: `src/server-functions/suppliers/update-purchase-record-fn.ts:80-170`
- Modify: `src/server-functions/suppliers/delete-purchase-record-fn.ts`
- Create: `src/server-functions/suppliers/get-purchase-edit-state-fn.ts`
- Modify: `src/components/suppliers/edit-purchase-dialog.tsx`
- Modify: the lot module: add `purchaseIsUntouched(tx, purchase): Promise<boolean>`
- Test: `src/__tests__/integration/material-lot-purchase-edits.test.ts`, extend `src/__tests__/material-stock-writers.test.ts` (it now passes fully)

**Interfaces:**
- Consumes: `purchaseUntouched` (Task 2), `PURCHASE_LOCKED_MESSAGE`.
- Produces: `purchaseIsUntouched(tx: Tx, purchase: { id: string; lotId: string | null; warehouseId: string }): Promise<boolean>` in `material-lots.server.ts`. False when `lotId` is null (purchases from before lots).
- Produces: `getPurchaseEditStateFn({ data: { id } }) => Promise<{ stockLocked: boolean }>`

- [ ] **Step 1: Failing integration test**

Using `addStockFn` from Task 4 (mocks as in Task 4):
1. Buy 100 kg at Rs 115 (purchase P1). Edit P1 to 90 kg / Rs 10,350: allowed, lot Rs 115 = 90.
2. Edit P1's price to Rs 112 (cost 10,080, 90 kg): allowed, lot Rs 115 = 0, lot Rs 112 = 90, P1.lotId = the Rs 112 lot.
3. Take 60 kg from the Rs 112 lot with `takeLotPicks` (`sourceType: "mixing"`). Editing P1's quantity now fails with `PURCHASE_LOCKED_MESSAGE`, and so does deleting it. Editing only `cost` to 10,000 at the same quantity succeeds: the purchase cost changes, the lot price stays 112.00, and lot stock stays 30.
4. Buy P2: 50 kg at Rs 112 (same lot, total 80). P2 is still editable (the balance 80 ≥ 50 bought since P2). Deleting P2 succeeds, leaving lot = 30.

- [ ] **Step 2: Implement `purchaseIsUntouched` in the lot module**

```ts
export async function purchaseIsUntouched(tx: Tx, purchase: { id: string; lotId: string | null; warehouseId: string }) {
  if (!purchase.lotId) return false;
  // The purchase's own credit on its current lot: the original purchase, or the latest
  // purchase_edit credit if a price edit moved it to this lot.
  const [own] = await tx.select({ createdAt: materialLotMovements.createdAt, id: materialLotMovements.id }).from(materialLotMovements)
    .where(and(eq(materialLotMovements.lotId, purchase.lotId), eq(materialLotMovements.warehouseId, purchase.warehouseId), inArray(materialLotMovements.sourceType, ["purchase", "purchase_edit"]), eq(materialLotMovements.sourceId, purchase.id), sql`${materialLotMovements.delta} > 0`))
    .orderBy(desc(materialLotMovements.createdAt)).limit(1);
  if (!own) return false;
  const movements = await tx.select({ delta: materialLotMovements.delta, sourceType: materialLotMovements.sourceType }).from(materialLotMovements)
    .where(and(eq(materialLotMovements.lotId, purchase.lotId), eq(materialLotMovements.warehouseId, purchase.warehouseId), gte(materialLotMovements.createdAt, own.createdAt)))
    .orderBy(asc(materialLotMovements.createdAt), asc(materialLotMovements.id));
  const [stock] = await tx.select({ quantity: materialLotStock.quantity }).from(materialLotStock)
    .where(and(eq(materialLotStock.lotId, purchase.lotId), eq(materialLotStock.warehouseId, purchase.warehouseId)));
  return purchaseUntouched({ balanceNow: stock?.quantity ?? "0", movements });
}
```

Add `desc` and `inArray` to the module's `drizzle-orm` import now.

`createdAt` is `defaultNow()`, which is the transaction start time in PostgreSQL. Movements written in the same transaction share a timestamp, so they're ordered by `id` second. cuid2 ids aren't time-ordered, so within one transaction the order between rows isn't guaranteed. That's fine here: a purchase or price edit writes only one credit for its lot and store per transaction.

- [ ] **Step 3: Update and delete**

`update-purchase-record-fn.ts`, replacing step "2. Update Stock if quantity changed":

```ts
      const ref = existingRecord.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: existingRecord.chemicalId! }
        : { materialType: "packaging" as const, materialId: existingRecord.packagingMaterialId! };
      const newQuantity = data.quantity ? lotQuantity(data.quantity) : new Big(existingRecord.quantity).toFixed(3);
      const newCost = data.cost ?? existingRecord.cost;
      const newPrice = lotPrice(new Big(newCost).div(newQuantity));
      const quantityChanged = !new Big(newQuantity).eq(existingRecord.quantity);
      const priceChanged = !existingRecord.lotId || newPrice !== lotPrice(existingRecord.unitCost);
      let lotId = existingRecord.lotId;
      if (quantityChanged || (priceChanged && existingRecord.lotId)) {
        await lockMaterialStock(tx, [existingRecord.warehouseId], [ref]);
        const untouched = await purchaseIsUntouched(tx, existingRecord);
        if (quantityChanged && !untouched) throw new Error(PURCHASE_LOCKED_MESSAGE);
        if (untouched) {
          const target = await findOrCreateLot(tx, ref, newPrice);
          await moveLotStock(tx, { ref, lotId: existingRecord.lotId!, warehouseId: existingRecord.warehouseId, delta: `-${new Big(existingRecord.quantity).toFixed(3)}`, sourceType: "purchase_edit", sourceId: existingRecord.id });
          await moveLotStock(tx, { ref, lotId: target.id, warehouseId: existingRecord.warehouseId, delta: newQuantity, sourceType: "purchase_edit", sourceId: existingRecord.id });
          lotId = target.id;
        }
        // Not untouched and only the price changed: the bill changes, the lot price does not.
      }
```

For step 4 (the purchase record update), replace the `if (data.quantity && data.cost)` block with:

```ts
      updateData.quantity = newQuantity;
      updateData.cost = new Big(newCost).toFixed(2);
      updateData.unitCost = new Big(newCost).div(newQuantity).toFixed(4);
      updateData.lotId = lotId;
```

After a price move, the purchase's own movement on its new lot is the `"purchase_edit"` credit. `purchaseIsUntouched` (Step 2) already looks for that.

`delete-purchase-record-fn.ts`: move the reads into the transaction. Before step 1:

```ts
      const ref = purchase.materialType === "chemical"
        ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
        : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
      await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
      if (!(await purchaseIsUntouched(tx, purchase))) throw new Error(PURCHASE_LOCKED_MESSAGE);
```

Replace step "3. Revert stock" with:

```ts
      await moveLotStock(tx, { ref, lotId: purchase.lotId!, warehouseId: purchase.warehouseId, delta: `-${new Big(purchase.quantity).toFixed(3)}`, sourceType: "purchase_delete", sourceId: purchase.id });
```

Re-read the purchase inside the transaction so the check and the delete see the same row.

- [ ] **Step 4: Edit state read and dialog**

```ts
// src/server-functions/suppliers/get-purchase-edit-state-fn.ts
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, purchaseRecords } from "@/db";
import { lockMaterialStock, purchaseIsUntouched } from "@/lib/inventory/material-lots.server";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";

export const getPurchaseEditStateFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(({ data }) => db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.id, data.id));
    if (!purchase) throw new Error("Purchase record not found");
    const ref = purchase.materialType === "chemical"
      ? { materialType: "chemical" as const, materialId: purchase.chemicalId! }
      : { materialType: "packaging" as const, materialId: purchase.packagingMaterialId! };
    await lockMaterialStock(tx, [purchase.warehouseId], [ref]);
    return { stockLocked: !(await purchaseIsUntouched(tx, purchase)) };
  }));
```

In `edit-purchase-dialog.tsx`: query `getPurchaseEditStateFn` when the dialog opens. When `stockLocked`:
- Disable the quantity and unit-price inputs, and show the `PURCHASE_LOCKED_MESSAGE` text above them.
- Add a "Bill total (Rs)" input bound to `cost`. Today `cost` is a hidden field derived from quantity × unit cost (around line 230); when locked, show it as an editable input instead, so the amount owed can be corrected.
- Find the delete action for purchases (search `deletePurchaseRecordFn` usages) and disable it with the same message in a tooltip or helper text.

- [ ] **Step 5: Run tests**

Run: `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/material-lot-purchase-edits.test.ts`
Expected: PASS
Run: `bun run test -- src/__tests__/material-stock-writers.test.ts`
Expected: PASS, with no offenders left.
Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/suppliers src/lib/inventory src/components/suppliers src/__tests__
git commit -m "feat(suppliers): lock purchase quantity and price once its stock is used"
```

---

### Task 13: Whole-flow check, full test run, graph update

**Files:**
- Test: `src/__tests__/integration/material-lots-flow.test.ts`

- [ ] **Step 1: Write the end-to-end integration test**

One test that walks the spec's example with the real server functions (mocks as in Task 4):
1. Buy Soda Ash 300 kg at Rs 115 and 500 kg at Rs 125 (two lots; total 800).
2. Transfer 100 kg from the Rs 115 lot and 50 kg from the Rs 125 lot to a second factory floor.
3. Start a 200 kg formula batch on the first floor with picks 120 kg (Rs 115 lot, which has 200 left there) and 80 kg (Rs 125 lot). Expect batch cost Rs 23,800.
4. Adjust the Rs 115 lot by −2 kg ("Count short").
5. Assert, for each floor and item: `material_stock.quantity` equals the sum of that item's `material_lot_stock` rows; every lot's stock equals the sum of its `material_lot_movements` deltas in that store; and no lot stock is negative.

The assertions in step 5 go in a helper, `assertLotLedger(tx, warehouseIds, ref)`. Write it in this test file.

- [ ] **Step 2: Run everything**

```bash
bun run test
bunx vitest run --config vitest.integration.config.ts
bun run typecheck
bun run build
```

Expected: all pass. Fix any older test that still seeds raw-material stock straight into `material_stock` and then calls a server function that now needs picks. Use lots in the seed and pass picks, as described in Task 7 Step 7.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/material-lots-flow.test.ts graphify-out
git commit -m "test(inventory): cover the full price lot flow"
```

---

## Self-review notes (for the executor)

- Spec §1 (lots, per-store, totals, hidden empty lots): Tasks 1, 3, 6
- §2 (purchases, typo guard, lot preview): Tasks 4, 5
- §3 (transfers): Task 7. Store closing moves all lots: Task 7 Step 5
- §4 (mixing): Task 8
- §5 (packing, shared materials split): Task 9
- §6 (recovery to the same lots, editable split): Task 10
- §7 (adjustments per lot, add only to an existing lot): Task 11. Material stock counts don't exist as a separate feature (the existing stock-count sessions are for cartons only), so adjustments cover counting.
- §8 (purchase edit and delete rule, money side editable): Task 12
- §9 (existing stock becomes lots at current price): Task 3 (`reconcileOpeningLot`). It's lazy, so no migration data file is needed.
- Deviations to tell the user about: (a) a new name that equals an existing one apart from capitals, spaces, dashes or dots is refused outright with only "Add stock" offered; one-letter differences get both buttons. (b) The retired packing-job progress screen now refuses to log progress. (c) Editing a material no longer changes its quantity; quantity changes go through adjustments.
