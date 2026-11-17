# By-Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purchases can be marked "By-product" with a container name and size. Empty containers are counted as stock is used. The Other Income page becomes a By-Products page that sells only those empties, capped at what is in hand.

**Architecture:** A pure counting module works out empties earned per (item, container name, container size) from the item's purchases and its current total stock. The newest purchases are treated as still in stock, which is the same as oldest-first use. A server module loads that data, takes an advisory lock and guards sales and purchase changes. The existing `other_income` table keeps its name and gains by-product key columns. The UI is renamed to By-Products.

**Tech Stack:** TanStack Start server functions, Drizzle ORM (PostgreSQL), zod, big.js, TanStack Form/Query, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-by-products-design.md`

## Global Constraints

- Never hand-edit files under `src/db/migrations/`. Change the schema source, then run `bun run db:generate`.
- Never edit `src/routeTree.gen.ts` by hand. It regenerates on `bun run dev` / `bun run build`.
- By-product key = material type + material id + container name + container size. "Soda – 100kg Drum" and "SLES – 100kg Drum" are different by-products.
- Container name is stored trimmed, with inner spaces collapsed, in title case ("drum " becomes "Drum").
- Container size is in the item's own stock unit (kg, liters, pcs or kg for shoppers). It is stored as `decimal(12,3)` and must be > 0.
- A tracked purchase's quantity must be a whole number of containers (1000kg / 100kg = 10 is OK, 950kg is refused).
- A container counts as empty only when fully used: `floor(used / size)`.
- Sales: whole-number quantity, capped at in hand, refused inside the DB transaction.
- A purchase edit or void that would leave sold > earned for any key is refused with: `"<sold> <label> already sold; this change would leave only <earned> earned"`.
- The advisory lock is always taken last, after any `lockMaterialStock` call: `pg_advisory_xact_lock(hashtext('by-product:' || <type> || ':' || <id>))`.
- Ledger `transactions.source` for sales: `"By-Products"`.
- Only the user-facing name changes from Other Income to By-Products. The table stays `other_income`.
- No production rows exist (project memory 2026-10-28). Old Other Income rows need no fix-up. If a local dev DB has `other_income` rows, the new check constraint will fail on migrate; reset with `./scripts/nuke-db.sh`.
- No per-task code review or browser walkthrough (project memory). Do both once after the last task.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory/by-products.ts` (new) | Pure: name normalizing, container count, purchase column builder, key/label helpers, `earnedEmpties` math |
| `src/lib/inventory/by-products.server.ts` (new) | DB: advisory lock, load earned/sold per item, `assertEarnedCoversSold`, `listByProducts` |
| `src/db/schemas/supplier-schema.ts` | `purchase_records` columns + check |
| `src/db/schemas/finance-schema.ts` | `other_income` key columns + checks |
| `src/lib/validators/validators.ts` | `byProductInputSchema` merged into the three purchase-creating schemas |
| `src/server-functions/inventory/stock/add-stock-fn.ts`, `src/server-functions/inventory/add-chemical-fn.ts`, `src/server-functions/inventory/add-packaging-material-fn.ts` | Save by-product columns on new purchases |
| `src/server-functions/suppliers/update-purchase-record-fn.ts`, `src/server-functions/suppliers/delete-purchase-record-fn.ts` | Save/check columns on edit; guard sold vs earned |
| `src/lib/finance/by-product-sales.ts` (replaces `other-income.ts`) | Sale amount math, ledger source |
| `src/server-functions/finance/by-products-fn.ts` (replaces `other-income-fn.ts`) | List, sell, void |
| `src/components/inventory/by-product-fields.tsx` (new) | Shared checkbox + container inputs for purchase forms |
| `src/components/finance/by-products-page.tsx` (replaces `other-income-page.tsx`) | Page UI |
| `src/hooks/finance/use-by-products.ts` (replaces `use-other-income.ts`) | Query/mutation hooks |
| `src/routes/_protected/finance/by-products/index.tsx` (new), `src/routes/_protected/finance/other-income/index.tsx` (becomes redirect) | Routes |
| `src/lib/constants.ts` | Sidebar entry |

---

### Task 1: Pure by-product math

**Files:**
- Create: `src/lib/inventory/by-products.ts`
- Test: `src/__tests__/by-products-math.test.ts`

**Interfaces:**
- Produces:
  - `normalizeContainerName(value: string): string`
  - `containerCount(quantity: string | number, size: string | number): number | null` (whole count or null)
  - `byProductColumns(input: ByProductInput, quantity: string): { byProductTracked: boolean; containerName: string | null; containerSize: string | null }` (throws on bad input)
  - `type ByProductInput = { byProductTracked?: boolean; containerName?: string; containerSize?: string }`
  - `containerKey(name: string, size: string | number): string` (`"Drum|100.000"`)
  - `type EmptiesPurchase = { quantity: string; byProductTracked: boolean; containerName: string | null; containerSize: string | null }`
  - `earnedEmpties(input: { inStock: string; purchases: EmptiesPurchase[] }): Map<string, { containerName: string; containerSize: string; earned: number }>`: purchases oldest first, map keyed by `containerKey`
  - `byProductLabel(itemName: string, unit: string, containerName: string, containerSize: string | number): string` (`"Soda – 100kg Drum"`)
  - `sizeFromPackagingText(text: string | null | undefined): string` (`"100kg"` gives `"100"`, garbage gives `""`)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/by-products-math.test.ts
import { describe, expect, it } from "vitest";
import {
  byProductColumns,
  byProductLabel,
  containerCount,
  containerKey,
  earnedEmpties,
  normalizeContainerName,
  sizeFromPackagingText,
  type EmptiesPurchase,
} from "@/lib/inventory/by-products";

const drum = (quantity: string, size = "100"): EmptiesPurchase => ({
  quantity, byProductTracked: true, containerName: "Drum", containerSize: size,
});
const plain = (quantity: string): EmptiesPurchase => ({
  quantity, byProductTracked: false, containerName: null, containerSize: null,
});
const earned = (map: ReturnType<typeof earnedEmpties>, key: string) => map.get(key)?.earned ?? 0;

describe("normalizeContainerName", () => {
  it("trims, collapses spaces and title-cases", () => {
    expect(normalizeContainerName("  plastic   DRUM ")).toBe("Plastic Drum");
    expect(normalizeContainerName("bag")).toBe("Bag");
  });
});

describe("containerCount", () => {
  it("returns whole counts only", () => {
    expect(containerCount("1000", "100")).toBe(10);
    expect(containerCount("950", "100")).toBeNull();
    expect(containerCount("10", "0")).toBeNull();
    expect(containerCount("37.5", "12.5")).toBe(3);
  });
});

describe("byProductColumns", () => {
  it("nulls the container when not tracked", () => {
    expect(byProductColumns({ byProductTracked: false, containerName: "Drum", containerSize: "100" }, "1000"))
      .toEqual({ byProductTracked: false, containerName: null, containerSize: null });
    expect(byProductColumns({}, "1000")).toEqual({ byProductTracked: false, containerName: null, containerSize: null });
  });
  it("normalizes a tracked container", () => {
    expect(byProductColumns({ byProductTracked: true, containerName: " drum", containerSize: "100" }, "1000"))
      .toEqual({ byProductTracked: true, containerName: "Drum", containerSize: "100.000" });
  });
  it("refuses missing name, bad size and partial containers", () => {
    expect(() => byProductColumns({ byProductTracked: true, containerName: " ", containerSize: "100" }, "1000")).toThrow("container name");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "0" }, "1000")).toThrow("Container size");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "abc" }, "1000")).toThrow("Container size");
    expect(() => byProductColumns({ byProductTracked: true, containerName: "Drum", containerSize: "100" }, "950")).toThrow("whole number of containers");
  });
});

describe("earnedEmpties", () => {
  it("counts fully used containers only", () => {
    // 10 drums bought, 650kg still in stock, so 350kg used: 3 empty, 4th half full.
    const map = earnedEmpties({ inStock: "650", purchases: [drum("1000")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(3);
  });

  it("uses older purchases first", () => {
    // Bags (old) then drums (new). 600 left in stock fills the newest drums first.
    const bags: EmptiesPurchase = { quantity: "500", byProductTracked: true, containerName: "Bag", containerSize: "50" };
    const map = earnedEmpties({ inStock: "600", purchases: [bags, drum("1000")] });
    expect(earned(map, containerKey("Bag", "50"))).toBe(10); // all 500kg of bags used
    expect(earned(map, containerKey("Drum", "100"))).toBe(4); // 400kg of drums used
  });

  it("treats stock beyond all purchases as unused purchases", () => {
    // 1200 in stock, only 1000 bought: nothing from the purchase is used yet.
    const map = earnedEmpties({ inStock: "1200", purchases: [drum("1000")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(0);
  });

  it("lets untracked purchases take their share without giving empties", () => {
    // Old tracked 500, newer untracked 500, 400 in stock: untracked keeps 400, tracked fully used.
    const map = earnedEmpties({ inStock: "400", purchases: [drum("500"), plain("500")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(5);
    expect(map.size).toBe(1);
  });

  it("keeps two sizes of the same container apart", () => {
    const map = earnedEmpties({ inStock: "0", purchases: [drum("200", "100"), drum("100", "50")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(2);
    expect(earned(map, containerKey("Drum", "50"))).toBe(2);
  });

  it("never goes negative with negative stock", () => {
    const map = earnedEmpties({ inStock: "-5", purchases: [drum("100")] });
    expect(earned(map, containerKey("Drum", "100"))).toBe(1);
  });
});

describe("labels", () => {
  it("formats the label and key", () => {
    expect(byProductLabel("Soda", "kg", "Drum", "100.000")).toBe("Soda – 100kg Drum");
    expect(containerKey("Drum", "100")).toBe("Drum|100.000");
  });
  it("reads a size out of saved packaging text", () => {
    expect(sizeFromPackagingText("100kg")).toBe("100");
    expect(sizeFromPackagingText(" 20 L")).toBe("20");
    expect(sizeFromPackagingText("big")).toBe("");
    expect(sizeFromPackagingText(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-products-math.test.ts`
Expected: FAIL, cannot resolve `@/lib/inventory/by-products`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/inventory/by-products.ts
import Big from "big.js";

export type ByProductInput = { byProductTracked?: boolean; containerName?: string; containerSize?: string };
export type EmptiesPurchase = {
  quantity: string;
  byProductTracked: boolean;
  containerName: string | null;
  containerSize: string | null;
};
export type EarnedEntry = { containerName: string; containerSize: string; earned: number };

/** "  plastic   DRUM " becomes "Plastic Drum", so one container is never saved under two spellings. */
export function normalizeContainerName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

function toBig(value: string | number): Big | null {
  try {
    return new Big(value);
  } catch {
    return null;
  }
}

/** Number of whole containers in a quantity, or null when it is not a whole number or size is not above zero. */
export function containerCount(quantity: string | number, size: string | number): number | null {
  const qty = toBig(quantity);
  const each = toBig(size);
  if (!qty || !each || !each.gt(0)) return null;
  const count = qty.div(each);
  return count.round(0, Big.roundDown).eq(count) ? Number(count.toFixed(0)) : null;
}

/** Columns saved on a purchase. Throws a user-facing message on bad input. */
export function byProductColumns(input: ByProductInput, quantity: string) {
  if (!input.byProductTracked) return { byProductTracked: false, containerName: null, containerSize: null };
  const containerName = normalizeContainerName(input.containerName ?? "");
  if (!containerName) throw new Error("Please enter the container name");
  if (containerName.length > 40) throw new Error("Container name is too long");
  const size = toBig((input.containerSize ?? "").trim() || "x");
  if (!size || !size.gt(0) || !size.round(3).eq(size) || size.gt("999999999.999")) {
    throw new Error("Container size must be above zero with at most 3 decimals");
  }
  if (containerCount(quantity, size.toString()) === null) {
    throw new Error(`Quantity must be a whole number of containers (${size.toString()} each)`);
  }
  return { byProductTracked: true, containerName, containerSize: size.toFixed(3) };
}

export function containerKey(name: string, size: string | number): string {
  return `${name}|${new Big(size).toFixed(3)}`;
}

/**
 * Empties earned per container for one stock item. Oldest stock is used first, so whatever is still
 * in stock belongs to the newest purchases. `purchases` must be oldest first.
 */
export function earnedEmpties(input: { inStock: string; purchases: EmptiesPurchase[] }): Map<string, EarnedEntry> {
  const result = new Map<string, EarnedEntry>();
  let left = new Big(input.inStock);
  if (left.lt(0)) left = new Big(0);
  for (let i = input.purchases.length - 1; i >= 0; i--) {
    const purchase = input.purchases[i];
    const quantity = new Big(purchase.quantity);
    const kept = left.gt(quantity) ? quantity : left;
    left = left.minus(kept);
    if (!purchase.byProductTracked || !purchase.containerName || !purchase.containerSize) continue;
    const used = quantity.minus(kept);
    const empties = Number(used.div(purchase.containerSize).round(0, Big.roundDown).toFixed(0));
    const key = containerKey(purchase.containerName, purchase.containerSize);
    const entry = result.get(key) ?? {
      containerName: purchase.containerName,
      containerSize: new Big(purchase.containerSize).toFixed(3),
      earned: 0,
    };
    entry.earned += empties;
    result.set(key, entry);
  }
  return result;
}

export function byProductLabel(itemName: string, unit: string, containerName: string, containerSize: string | number): string {
  return `${itemName} – ${Number(containerSize)}${unit} ${containerName}`;
}

/** Saved chemical pack size like "100kg" or "20 L" gives "100" / "20". Anything else gives "". */
export function sizeFromPackagingText(text: string | null | undefined): string {
  const match = (text ?? "").trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? match[1] : "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/by-products-math.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/by-products.ts src/__tests__/by-products-math.test.ts
git commit -m "feat(inventory): add by-product empties math"
```

---

### Task 2: Schema columns and migration

**Files:**
- Modify: `src/db/schemas/supplier-schema.ts` (`purchaseRecords` columns and table callback)
- Modify: `src/db/schemas/finance-schema.ts:290-324` (`otherIncome`)
- Generated: `src/db/migrations/00NN_*.sql`, snapshot, journal (by `bun run db:generate` only)
- Test: `src/__tests__/by-products-schema.test.ts`

**Interfaces:**
- Produces: `purchaseRecords.byProductTracked` (boolean, not null, default false), `purchaseRecords.containerName` (text | null), `purchaseRecords.containerSize` (decimal string | null). `otherIncome.chemicalId`, `otherIncome.packagingMaterialId`, `otherIncome.containerName`, `otherIncome.containerSize`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/by-products-schema.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("by-product schema", () => {
  it("adds container columns and a consistency check on purchases", () => {
    const source = readFileSync("src/db/schemas/supplier-schema.ts", "utf8");
    expect(source).toContain('boolean("by_product_tracked").notNull().default(false)');
    expect(source).toContain('text("container_name")');
    expect(source).toContain('decimal("container_size", { precision: 12, scale: 3 })');
    expect(source).toContain('"purchase_by_product_container"');
  });

  it("links each sale to one material and a whole container count", () => {
    const source = readFileSync("src/db/schemas/finance-schema.ts", "utf8");
    expect(source).toContain('"other_income_one_material"');
    expect(source).toContain('"other_income_whole_quantity"');
    expect(source).toContain('index("other_income_chemical_idx")');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-products-schema.test.ts`
Expected: FAIL on the first `toContain`.

- [ ] **Step 3: Edit `purchaseRecords` in `src/db/schemas/supplier-schema.ts`**

Make sure `boolean` is imported from `drizzle-orm/pg-core` (add it to the existing import list if it is missing). After the `notes: text("notes"),` column add:

```ts
    // By-product tracking: the containers this purchase came in become sellable empties once used.
    byProductTracked: boolean("by_product_tracked").notNull().default(false),
    containerName: text("container_name"),
    containerSize: decimal("container_size", { precision: 12, scale: 3 }),
```

In the table callback object, after `voidMetadata: check(...)`, add:

```ts
    byProductContainer: check("purchase_by_product_container", sql`(
      (${t.byProductTracked} = false AND ${t.containerName} IS NULL AND ${t.containerSize} IS NULL)
      OR
      (${t.byProductTracked} = true AND ${t.containerName} IS NOT NULL AND length(btrim(${t.containerName})) BETWEEN 1 AND 40
        AND ${t.containerSize} > 0 AND mod(${t.quantity}, ${t.containerSize}) = 0)
    )`),
```

- [ ] **Step 4: Edit `otherIncome` in `src/db/schemas/finance-schema.ts`**

Add `import { chemicals, packagingMaterials } from "./inventory-schema";` (inventory-schema does not import finance-schema, so there is no cycle). After `itemName: text("item_name").notNull(),` add:

```ts
    // By-product key of the sale: one material plus container name and size.
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(() => packagingMaterials.id),
    containerName: text("container_name").notNull(),
    containerSize: decimal("container_size", { precision: 12, scale: 3 }).notNull(),
```

Change the comment above the table to `// --- BY-PRODUCT SALES (empty containers sold; table name kept from "Other Income") ---`. Replace the table callback with:

```ts
  (table) => ({
    dateIdx: index("other_income_date_idx").on(table.incomeDate),
    chemicalIdx: index("other_income_chemical_idx").on(table.chemicalId),
    packagingIdx: index("other_income_packaging_idx").on(table.packagingMaterialId),
    positive: check(
      "other_income_positive",
      sql`${table.amount} > 0 and ${table.quantity} > 0 and ${table.unitPrice} > 0`,
    ),
    oneMaterial: check(
      "other_income_one_material",
      sql`(${table.chemicalId} IS NOT NULL) <> (${table.packagingMaterialId} IS NOT NULL)`,
    ),
    wholeQuantity: check("other_income_whole_quantity", sql`${table.quantity} = trunc(${table.quantity})`),
    containerSizePositive: check("other_income_container_size", sql`${table.containerSize} > 0`),
  }),
```

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file under `src/db/migrations/` that adds the three `purchase_records` columns with their check, plus the four `other_income` columns with their checks and indexes. Read the SQL and confirm. Do not edit it. If the generator asks interactive rename questions, answer "create column" for every new column.

Then run `bun run db:migrate` against the local DB. If it fails because of existing local `other_income` rows (NOT NULL `container_name`), run `./scripts/nuke-db.sh` and migrate again. Do not change the migration.

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test src/__tests__/by-products-schema.test.ts && bun run typecheck`
Expected: test PASS. Typecheck FAILS only in `src/server-functions/finance/other-income-fn.ts` (insert is missing `containerName`/`containerSize`). Task 5 replaces that file. Any other error must be fixed now.

- [ ] **Step 7: Commit**

```bash
git add src/db/schemas/supplier-schema.ts src/db/schemas/finance-schema.ts src/db/migrations src/__tests__/by-products-schema.test.ts
git commit -m "feat(db): add by-product container columns to purchases and sales"
```

---

### Task 3: Server loader, lock and guard

**Files:**
- Create: `src/lib/inventory/by-products.server.ts`
- Test: `src/__tests__/by-products-server.test.ts`

**Interfaces:**
- Consumes (Task 1): `earnedEmpties`, `containerKey`, `byProductLabel`, `EmptiesPurchase`. `Tx` from `@/lib/inventory/material-lots.server`, `MaterialRef` from `@/lib/inventory/material-lots` (`{ materialType: "chemical" | "packaging"; materialId: string }`), `packagingUnit` from `@/lib/inventory/material-units`.
- Produces:
  - `lockByProductMaterial(tx: Tx, ref: MaterialRef): Promise<void>`
  - `type ByProductSummary = { key: string; materialType: "chemical" | "packaging"; materialId: string; itemName: string; unit: string; containerName: string; containerSize: string; label: string; earned: number; sold: number; inHand: number }`
  - `loadItemByProducts(tx: Tx | typeof db, ref: MaterialRef): Promise<ByProductSummary[]>`
  - `assertEarnedCoversSold(tx: Tx, ref: MaterialRef): Promise<void>`
  - `listByProducts(): Promise<ByProductSummary[]>` (all items with any tracked purchase or any sale, zero rows hidden)

- [ ] **Step 1: Write the failing test (source inspection: no test DB)**

```ts
// src/__tests__/by-products-server.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync("src/lib/inventory/by-products.server.ts", "utf8");

describe("by-products server module", () => {
  it("locks per material with a transaction advisory lock", () => {
    expect(source()).toContain("pg_advisory_xact_lock(hashtext(");
    expect(source()).toContain("'by-product:'");
  });

  it("counts from current total stock and existing purchases oldest first", () => {
    const s = source();
    expect(s).toContain("sum(${materialStock.quantity})");
    expect(s).toContain("asc(purchaseRecords.purchaseDate), asc(purchaseRecords.createdAt)");
    expect(s).toContain("earnedEmpties(");
  });

  it("counts sold from non-voided sales only", () => {
    expect(source()).toContain("isNull(otherIncome.voidedAt)");
  });

  it("refuses changes that leave sold above earned", () => {
    expect(source()).toContain("already sold; this change would leave only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-products-server.test.ts`
Expected: FAIL, file not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/inventory/by-products.server.ts
import Big from "big.js";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { otherIncome } from "@/db/schemas/finance-schema";
import { chemicals, materialStock, packagingMaterials } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import type { MaterialRef } from "./material-lots";
import type { Tx } from "./material-lots.server";
import { packagingUnit } from "./material-units";
import { byProductLabel, containerKey, earnedEmpties } from "./by-products";

type Reader = Tx | typeof db;

export type ByProductSummary = {
  key: string;
  materialType: "chemical" | "packaging";
  materialId: string;
  itemName: string;
  unit: string;
  containerName: string;
  containerSize: string;
  label: string;
  earned: number;
  sold: number;
  inHand: number;
};

/** Serializes sales and purchase changes for one item. Always taken after any lockMaterialStock call. */
export async function lockByProductMaterial(tx: Tx, ref: MaterialRef) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('by-product:' || ${ref.materialType} || ':' || ${ref.materialId}))`,
  );
}

const purchaseColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? purchaseRecords.chemicalId : purchaseRecords.packagingMaterialId;
const stockColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? materialStock.chemicalId : materialStock.packagingMaterialId;
const saleColumn = (ref: MaterialRef) =>
  ref.materialType === "chemical" ? otherIncome.chemicalId : otherIncome.packagingMaterialId;

async function itemNameAndUnit(reader: Reader, ref: MaterialRef) {
  if (ref.materialType === "chemical") {
    const [row] = await reader.select({ name: chemicals.name, unit: chemicals.unit }).from(chemicals).where(eq(chemicals.id, ref.materialId));
    return { name: row?.name ?? "Unknown item", unit: row?.unit || "kg" };
  }
  const [row] = await reader
    .select({ name: packagingMaterials.name, measuredInKg: packagingMaterials.measuredInKg })
    .from(packagingMaterials)
    .where(eq(packagingMaterials.id, ref.materialId));
  return { name: row?.name ?? "Unknown item", unit: packagingUnit(row) };
}

export async function loadItemByProducts(reader: Reader, ref: MaterialRef): Promise<ByProductSummary[]> {
  const purchases = await reader
    .select({
      quantity: purchaseRecords.quantity,
      byProductTracked: purchaseRecords.byProductTracked,
      containerName: purchaseRecords.containerName,
      containerSize: purchaseRecords.containerSize,
    })
    .from(purchaseRecords)
    .where(and(eq(purchaseColumn(ref), ref.materialId), isNull(purchaseRecords.voidedAt)))
    .orderBy(asc(purchaseRecords.purchaseDate), asc(purchaseRecords.createdAt));

  const [stock] = await reader
    .select({ total: sql<string>`coalesce(sum(${materialStock.quantity}), 0)` })
    .from(materialStock)
    .where(eq(stockColumn(ref), ref.materialId));

  const sales = await reader
    .select({
      containerName: otherIncome.containerName,
      containerSize: otherIncome.containerSize,
      sold: sql<string>`sum(${otherIncome.quantity})`,
    })
    .from(otherIncome)
    .where(and(eq(saleColumn(ref), ref.materialId), isNull(otherIncome.voidedAt)))
    .groupBy(otherIncome.containerName, otherIncome.containerSize);

  const earned = earnedEmpties({ inStock: String(stock?.total ?? "0"), purchases });
  const { name, unit } = await itemNameAndUnit(reader, ref);

  const rows = new Map<string, ByProductSummary>();
  const row = (containerName: string, containerSize: string) => {
    const key = containerKey(containerName, containerSize);
    const existing = rows.get(key);
    if (existing) return existing;
    const created: ByProductSummary = {
      key: `${ref.materialType}:${ref.materialId}:${key}`,
      materialType: ref.materialType,
      materialId: ref.materialId,
      itemName: name,
      unit,
      containerName,
      containerSize: new Big(containerSize).toFixed(3),
      label: byProductLabel(name, unit, containerName, containerSize),
      earned: 0,
      sold: 0,
      inHand: 0,
    };
    rows.set(key, created);
    return created;
  };
  for (const entry of earned.values()) row(entry.containerName, entry.containerSize).earned = entry.earned;
  for (const sale of sales) row(sale.containerName, sale.containerSize).sold = Number(new Big(sale.sold).toFixed(0));
  for (const summary of rows.values()) summary.inHand = summary.earned - summary.sold;
  return [...rows.values()];
}

/** Run inside the transaction, after the change is written. */
export async function assertEarnedCoversSold(tx: Tx, ref: MaterialRef) {
  await lockByProductMaterial(tx, ref);
  for (const row of await loadItemByProducts(tx, ref)) {
    if (row.sold > row.earned) {
      throw new Error(`${row.sold} ${row.label} already sold; this change would leave only ${row.earned} earned`);
    }
  }
}

export async function listByProducts(): Promise<ByProductSummary[]> {
  const tracked = await db
    .selectDistinct({ chemicalId: purchaseRecords.chemicalId, packagingMaterialId: purchaseRecords.packagingMaterialId })
    .from(purchaseRecords)
    .where(and(eq(purchaseRecords.byProductTracked, true), isNull(purchaseRecords.voidedAt)));
  const sold = await db
    .selectDistinct({ chemicalId: otherIncome.chemicalId, packagingMaterialId: otherIncome.packagingMaterialId })
    .from(otherIncome)
    .where(or(isNotNull(otherIncome.chemicalId), isNotNull(otherIncome.packagingMaterialId)));

  const refs = new Map<string, MaterialRef>();
  for (const item of [...tracked, ...sold]) {
    const ref: MaterialRef = item.chemicalId
      ? { materialType: "chemical", materialId: item.chemicalId }
      : { materialType: "packaging", materialId: item.packagingMaterialId! };
    refs.set(`${ref.materialType}:${ref.materialId}`, ref);
  }

  const all = (await Promise.all([...refs.values()].map((ref) => loadItemByProducts(db, ref)))).flat();
  return all
    .filter((row) => row.earned !== 0 || row.sold !== 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test src/__tests__/by-products-server.test.ts && bun run typecheck`
Expected: test PASS. Typecheck errors only in `other-income-fn.ts` (fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/by-products.server.ts src/__tests__/by-products-server.test.ts
git commit -m "feat(inventory): load by-product earned, sold and in hand per item"
```

---

### Task 4: Save and guard by-product data on purchases

**Files:**
- Modify: `src/lib/validators/validators.ts` (`addChemicalSchema`, `addPackagingMaterialSchema`, `addStockSchema`)
- Modify: `src/server-functions/inventory/stock/add-stock-fn.ts` (purchase insert)
- Modify: `src/server-functions/inventory/add-chemical-fn.ts:135-151`
- Modify: `src/server-functions/inventory/add-packaging-material-fn.ts:149-165`
- Modify: `src/server-functions/suppliers/update-purchase-record-fn.ts`
- Modify: `src/server-functions/suppliers/delete-purchase-record-fn.ts`
- Test: `src/__tests__/by-products-purchases.test.ts`

**Interfaces:**
- Consumes: `byProductColumns`, `ByProductInput` (Task 1). `assertEarnedCoversSold` (Task 3).
- Produces: `byProductInputSchema` in validators (fields `byProductTracked: boolean`, `containerName: string`, `containerSize: string`, all with defaults). `updatePurchaseRecordFn` accepts optional `byProductTracked`, `containerName`, `containerSize`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/by-products-purchases.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addStockSchema } from "@/lib/validators/validators";

const read = (path: string) => readFileSync(path, "utf8");

describe("purchase by-product input", () => {
  it("defaults to not tracked so old callers keep working", () => {
    const parsed = addStockSchema.parse({
      warehouseId: "w", materialType: "chemical", materialId: "m", quantity: "100", supplierId: "s", cost: "10",
      notes: "", paymentMethod: "", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "",
    });
    expect(parsed.byProductTracked).toBe(false);
    expect(parsed.containerName).toBe("");
    expect(parsed.containerSize).toBe("");
  });

  it.each([
    "src/server-functions/inventory/stock/add-stock-fn.ts",
    "src/server-functions/inventory/add-chemical-fn.ts",
    "src/server-functions/inventory/add-packaging-material-fn.ts",
  ])("%s saves the by-product columns on the purchase", (path) => {
    expect(read(path)).toContain("...byProductColumns(data, ");
  });

  it("edit re-checks containers and guards sold vs earned", () => {
    const s = read("src/server-functions/suppliers/update-purchase-record-fn.ts");
    expect(s).toContain("byProductColumns(");
    expect(s).toContain("await assertEarnedCoversSold(tx, ref)");
  });

  it("void guards sold vs earned before material cleanup", () => {
    const s = read("src/server-functions/suppliers/delete-purchase-record-fn.ts");
    const guard = s.indexOf("await assertEarnedCoversSold(tx,");
    expect(guard).toBeGreaterThan(s.indexOf(".delete(purchaseRecords)"));
    expect(guard).toBeLessThan(s.indexOf("cleanupOrphanedMaterial(tx"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-products-purchases.test.ts`
Expected: FAIL (`byProductTracked` undefined).

- [ ] **Step 3: Add `byProductInputSchema` to validators**

In `src/lib/validators/validators.ts`, above `addChemicalSchema`:

```ts
/** By-product fields on any form that creates a purchase. Defaults keep older callers valid. */
export const byProductInputSchema = z.object({
  byProductTracked: z.boolean().default(false),
  containerName: z.string().max(40).default(""),
  containerSize: z.string().default(""),
});
```

Then add `...byProductInputSchema.shape,` as the last field inside the object literal of `addChemicalSchema`, `addPackagingMaterialSchema` and `addStockSchema`.

- [ ] **Step 4: Save columns on the three create paths**

In each file, import `import { byProductColumns } from "@/lib/inventory/by-products";` and add this line inside the `.values({ ... })` of `tx.insert(purchaseRecords)`, right after `quantity: data.quantity,`:

```ts
          ...byProductColumns(data, data.quantity),
```

The files are `src/server-functions/inventory/stock/add-stock-fn.ts`, `src/server-functions/inventory/add-chemical-fn.ts` and `src/server-functions/inventory/add-packaging-material-fn.ts`. Throwing inside the transaction rolls everything back, so no other change is needed. New purchases only add the newest stock, so they never lower earned and need no guard.

- [ ] **Step 5: Edit path**

In `src/server-functions/suppliers/update-purchase-record-fn.ts`:

1. Imports:

```ts
import { byProductColumns } from "@/lib/inventory/by-products";
import { assertEarnedCoversSold } from "@/lib/inventory/by-products.server";
```

2. Add to `updatePurchaseSchema`:

```ts
  byProductTracked: z.boolean().optional(),
  containerName: z.string().max(40).optional(),
  containerSize: z.string().optional(),
```

3. Right after `const newQuantity = ...; if (new Big(newQuantity).lte(0)) ...`, add:

```ts
      // By-product container: use the edit's values when sent, else keep the saved ones,
      // and re-check that the (maybe new) quantity is still a whole number of containers.
      const byProduct = byProductColumns(
        data.byProductTracked === undefined
          ? {
              byProductTracked: existingRecord.byProductTracked,
              containerName: existingRecord.containerName ?? "",
              containerSize: existingRecord.containerSize ?? "",
            }
          : { byProductTracked: data.byProductTracked, containerName: data.containerName, containerSize: data.containerSize },
        newQuantity,
      );
```

4. Add `...byProduct,` to the `updateData` object.

5. Right after `await tx.update(purchaseRecords).set(updateData).where(...)`, add:

```ts
      await assertEarnedCoversSold(tx, ref);
```

(`ref` is already defined above in the function.)

- [ ] **Step 6: Void path**

In `src/server-functions/suppliers/delete-purchase-record-fn.ts`, import `assertEarnedCoversSold` from `@/lib/inventory/by-products.server`. Right after

```ts
      await tx
        .delete(purchaseRecords)
        .where(eq(purchaseRecords.id, purchase.id));
```

add:

```ts
      // Removing this purchase can lower empties earned; refuse if some were already sold.
      await assertEarnedCoversSold(tx, purchase.materialType === "chemical"
        ? { materialType: "chemical", materialId: purchase.chemicalId! }
        : { materialType: "packaging", materialId: purchase.packagingMaterialId! });
```

It must come before the `cleanupOrphanedMaterial(tx` call in the same function.

- [ ] **Step 7: Run tests and typecheck**

Run: `bun run test src/__tests__/by-products-purchases.test.ts && bun run test && bun run typecheck`
Expected: new test PASS. The full suite passes except the existing `other-income.test.ts` checks, which Task 5 replaces. Typecheck errors are only in `other-income-fn.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validators/validators.ts src/server-functions/inventory src/server-functions/suppliers src/__tests__/by-products-purchases.test.ts
git commit -m "feat(suppliers): save by-product containers on purchases and guard sold empties"
```

---

### Task 5: By-product sale server functions

**Files:**
- Create: `src/lib/finance/by-product-sales.ts`
- Delete: `src/lib/finance/other-income.ts`
- Create: `src/server-functions/finance/by-products-fn.ts`
- Delete: `src/server-functions/finance/other-income-fn.ts`
- Delete: `src/__tests__/other-income.test.ts`
- Test: `src/__tests__/by-product-sales.test.ts`

**Interfaces:**
- Consumes: `lockByProductMaterial`, `loadItemByProducts`, `listByProducts`, `ByProductSummary` (Task 3). `containerKey`, `normalizeContainerName` (Task 1).
- Produces:
  - `BY_PRODUCT_TX_SOURCE = "By-Products"`, `MAX_SALE_AMOUNT`, `saleAmount(quantity, unitPrice): string`
  - `getByProductsFn({ data: { month } })` returns `{ byProducts: ByProductSummary[]; rows: SaleRow[]; total: string }`
  - `createByProductSaleFn({ data: { incomeDate, materialType, materialId, containerName, containerSize, quantity, unitPrice, walletId, note? } })`
  - `voidByProductSaleFn({ data: { id, reason } })`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/by-product-sales.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BY_PRODUCT_TX_SOURCE, MAX_SALE_AMOUNT, saleAmount } from "@/lib/finance/by-product-sales";

describe("by-product sale helpers", () => {
  it("multiplies whole quantity by price and rounds to paisa", () => {
    expect(saleAmount(3, 1500)).toBe("4500.00");
    expect(saleAmount("2", "33.335")).toBe("66.67");
  });
  it("refuses zero and too-large amounts", () => {
    expect(() => saleAmount(1, "0.001")).toThrow("at least Rs 0.01");
    expect(() => saleAmount(2, MAX_SALE_AMOUNT)).toThrow("too large");
  });
  it("uses a fixed ledger source", () => {
    expect(BY_PRODUCT_TX_SOURCE).toBe("By-Products");
  });
});

const fnSource = () => readFileSync("src/server-functions/finance/by-products-fn.ts", "utf8");

describe("by-product sale server functions", () => {
  it("guards writes with finance.manage and reads with finance.view", () => {
    const s = fnSource();
    expect(s.match(/requireFinanceManageMiddleware\]/g)?.length).toBe(2);
    expect(s.match(/requireFinanceViewMiddleware\]/g)?.length).toBe(1);
  });
  it("checks in hand inside the transaction after the lock", () => {
    const s = fnSource();
    const lock = s.indexOf("await lockByProductMaterial(tx, ref)");
    expect(lock).toBeGreaterThan(s.indexOf("db.transaction("));
    expect(s.indexOf("in hand")).toBeGreaterThan(lock);
  });
  it("only sells whole containers", () => {
    expect(fnSource()).toContain(".int(");
  });
  it("never deletes a sale and refuses double void", () => {
    const s = fnSource();
    expect(s).not.toContain("delete(otherIncome)");
    expect(s).toContain("already voided");
  });
  it("refuses a void that would take the account below zero", () => {
    expect(fnSource()).toContain("gte(wallets.balance, input.amount)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-product-sales.test.ts`
Expected: FAIL, cannot resolve `@/lib/finance/by-product-sales`.

- [ ] **Step 3: Create `src/lib/finance/by-product-sales.ts`**

```ts
import Big from "big.js";

/** Same ceiling as the amount column (numeric 12,2). */
export const MAX_SALE_AMOUNT = 9_999_999_999.99;

/** Ledger `transactions.source` for every by-product sale money move. */
export const BY_PRODUCT_TX_SOURCE = "By-Products";

/** Quantity × price each, rounded to paisa. Throws when not above zero or too large for the column. */
export function saleAmount(quantity: string | number, unitPrice: string | number): string {
  const amount = new Big(quantity).times(unitPrice).round(2);
  if (!amount.gt(0)) throw new Error("Amount must be at least Rs 0.01");
  if (amount.gt(MAX_SALE_AMOUNT)) throw new Error("Amount is too large");
  return amount.toFixed(2);
}
```

Delete `src/lib/finance/other-income.ts` and `src/__tests__/other-income.test.ts` (`git rm`).

- [ ] **Step 4: Create `src/server-functions/finance/by-products-fn.ts`**

Copy `src/server-functions/finance/other-income-fn.ts` to the new path with `git mv`, then make these changes:

1. Replace the `@/lib/finance/other-income` import with:

```ts
import { BY_PRODUCT_TX_SOURCE, MAX_SALE_AMOUNT, saleAmount } from "@/lib/finance/by-product-sales";
import { containerKey, normalizeContainerName } from "@/lib/inventory/by-products";
import { listByProducts, loadItemByProducts, lockByProductMaterial } from "@/lib/inventory/by-products.server";
```

2. In `moveWalletMoney`, change `source: OTHER_INCOME_TX_SOURCE` to `source: BY_PRODUCT_TX_SOURCE`.

3. Rename `getOtherIncomeFn` to `getByProductsFn` and change its return line to:

```ts
    return { byProducts: await listByProducts(), rows, total: total.toFixed(2) };
```

4. Delete `getOtherIncomeItemNamesFn` entirely.

5. Replace `createOtherIncomeFn` with:

```ts
export const createByProductSaleFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      incomeDate: z.string().min(1, "Please pick a date"),
      materialType: z.enum(["chemical", "packaging"]),
      materialId: z.string().min(1, "Please pick the by-product"),
      containerName: z.string().transform(normalizeContainerName).pipe(z.string().min(1).max(40)),
      containerSize: z.string().min(1),
      quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be above zero").max(999_999),
      unitPrice: z
        .number()
        .finite()
        .positive("Price must be above zero")
        .max(MAX_SALE_AMOUNT)
        .refine((value) => new Big(value).round(2).eq(value), "Price can have at most 2 decimals (paisa)"),
      walletId: z.string().min(1, "Please pick the account"),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const incomeDate = parseExpenseDate(data.incomeDate);
    const unitPrice = new Big(data.unitPrice);
    const amount = saleAmount(data.quantity, unitPrice.toFixed(2));
    const userId = context.session.user.id;
    const id = createId();
    const ref = { materialType: data.materialType, materialId: data.materialId } as const;
    const key = containerKey(data.containerName, data.containerSize);

    return await db.transaction(async (tx) => {
      await lockByProductMaterial(tx, ref);
      const byProduct = (await loadItemByProducts(tx, ref)).find(
        (row) => containerKey(row.containerName, row.containerSize) === key,
      );
      if (!byProduct) throw new Error("This by-product is not tracked");
      if (data.quantity > byProduct.inHand) {
        throw new Error(`Only ${Math.max(byProduct.inHand, 0)} ${byProduct.label} in hand`);
      }

      const transactionId = await moveWalletMoney(tx, {
        walletId: data.walletId,
        type: "credit",
        amount,
        referenceId: id,
        performedById: userId,
        description: `By-product sale: ${byProduct.label}`,
      });

      const [row] = await tx
        .insert(otherIncome)
        .values({
          id,
          incomeDate,
          itemName: byProduct.label,
          chemicalId: ref.materialType === "chemical" ? ref.materialId : null,
          packagingMaterialId: ref.materialType === "packaging" ? ref.materialId : null,
          containerName: byProduct.containerName,
          containerSize: byProduct.containerSize,
          quantity: data.quantity.toFixed(3),
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
        entityType: "by_product_sale",
        entityId: id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Sold ${data.quantity} ${byProduct.label} for ${amount}`,
      });

      return row;
    });
  });
```

6. Rename `voidOtherIncomeFn` to `voidByProductSaleFn`. Change its texts: `"Income entry not found"` becomes `"Sale not found"`, the description becomes ``Void of by-product sale: ${current.itemName}``, `entityType: "by_product_sale"`, and the activity description becomes ``Voided by-product sale of ${current.amount}: ${data.reason}``. Keep `"This entry is already voided"`.

7. Remove the now-unused imports (`asc`, `normalizeItemName`, `MAX_OTHER_INCOME_AMOUNT`, `otherIncomeAmount`, `OTHER_INCOME_TX_SOURCE`).

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run test src/__tests__/by-product-sales.test.ts src/__tests__/monthly-report.test.ts && bun run typecheck`
Expected: PASS. Typecheck now fails only in `src/hooks/finance/use-other-income.ts` (imports the deleted file), which Task 7 replaces. Any other error must be fixed now.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/finance src/server-functions/finance src/__tests__/by-product-sales.test.ts src/__tests__/other-income.test.ts
git commit -m "feat(finance): sell tracked by-products capped at in hand"
```

---

### Task 6: By-product fields on purchase forms

**Files:**
- Create: `src/components/inventory/by-product-fields.tsx`
- Modify: `src/components/inventory/add-stock-dialog-form.tsx` (defaultValues ~line 134, insert before notes field ~line 705)
- Modify: `src/components/inventory/add-raw-material-form.tsx` (defaultValues ~line 107, insert before notes field ~line 401)
- Modify: `src/components/inventory/add-packaging-material-form.tsx` (defaultValues, insert before notes field ~line 538)
- Modify: `src/components/suppliers/edit-purchase-dialog.tsx` (props type, defaultValues, submit, effect, insert before invoiceNumber field ~line 272)
- Test: `src/__tests__/by-product-fields.behavior.test.tsx`

**Interfaces:**
- Consumes: `containerCount` (Task 1); `sizeFromPackagingText` (Task 1); server inputs from Task 4.
- Produces: `ByProductFields` component:

```ts
type ByProductValue = { byProductTracked: boolean; containerName: string; containerSize: string };
function ByProductFields(props: {
  value: ByProductValue;
  onChange: (next: ByProductValue) => void;
  quantity: string;
  unit: string;
  disabled?: boolean;
}): JSX.Element
```

- [ ] **Step 1: Write the failing behavior test**

```tsx
// src/__tests__/by-product-fields.behavior.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ByProductFields } from "@/components/inventory/by-product-fields";

function Harness({ quantity }: { quantity: string }) {
  const [value, setValue] = useState({ byProductTracked: false, containerName: "Drum", containerSize: "100" });
  return <ByProductFields value={value} onChange={setValue} quantity={quantity} unit="kg" />;
}

describe("ByProductFields", () => {
  it("hides container inputs until ticked", () => {
    render(<Harness quantity="1000" />);
    expect(screen.queryByLabelText("Container size (kg)")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "By-product" }));
    expect(screen.getByLabelText("Container size (kg)")).toBeTruthy();
    expect(screen.getByText("10 Drums")).toBeTruthy();
  });

  it("warns when quantity is not whole containers", () => {
    render(<Harness quantity="950" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "By-product" }));
    expect(screen.getByText("Quantity must be a whole number of containers")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-product-fields.behavior.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Create the component**

```tsx
// src/components/inventory/by-product-fields.tsx
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { containerCount } from "@/lib/inventory/by-products";

export type ByProductValue = { byProductTracked: boolean; containerName: string; containerSize: string };

const CONTAINER_SUGGESTIONS = ["Drum", "Bag", "Can", "Jar"];

/** "By-product" tick on a purchase. When ticked, the containers become sellable empties once used. */
export function ByProductFields({
  value,
  onChange,
  quantity,
  unit,
  disabled,
}: {
  value: ByProductValue;
  onChange: (next: ByProductValue) => void;
  quantity: string;
  unit: string;
  disabled?: boolean;
}) {
  const id = useId();
  const count = value.containerSize ? containerCount(quantity || "0", value.containerSize) : null;
  const name = value.containerName.trim() || "container";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-tracked`}
          checked={value.byProductTracked}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...value, byProductTracked: checked === true })}
        />
        <label htmlFor={`${id}-tracked`} className="text-sm font-medium">
          By-product
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Tick when the empty containers are sold once used.</p>
      {value.byProductTracked && (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Container</FieldLabel>
            <Input
              id={`${id}-name`}
              list={`${id}-names`}
              maxLength={40}
              placeholder="e.g. Drum"
              value={value.containerName}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, containerName: e.target.value })}
            />
            <datalist id={`${id}-names`}>
              {CONTAINER_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-size`}>{`Container size (${unit})`}</FieldLabel>
            <Input
              id={`${id}-size`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={value.containerSize}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, containerSize: e.target.value })}
            />
          </Field>
          <FieldDescription className="col-span-2">
            {Number(quantity) > 0 && value.containerSize
              ? count === null
                ? <span className="text-destructive">Quantity must be a whole number of containers</span>
                : `${count} ${name}${count === 1 ? "" : "s"}`
              : null}
          </FieldDescription>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/by-product-fields.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `add-stock-dialog-form.tsx`**

1. Import `ByProductFields` from `./by-product-fields` and `sizeFromPackagingText` from `@/lib/inventory/by-products`.
2. In `useForm` `defaultValues` add:

```ts
      byProductTracked: false,
      containerName: (itemToRestock?.chemical as any)?.packagingType || "",
      containerSize: sizeFromPackagingText((itemToRestock?.chemical as any)?.packagingSize),
```

3. When the selected material changes, prefill from the chosen chemical. In the `materialId` field's `onValueChange` (inside `<form.Field name="materialId">`), after the existing `field.handleChange(val)`, add:

```ts
                      const chosen = (materials?.chemicals || []).find((c: any) => c.id === val) as any;
                      if (materialType === "chemical" && chosen) {
                        form.setFieldValue("containerName", chosen.packagingType || "");
                        form.setFieldValue("containerSize", sizeFromPackagingText(chosen.packagingSize));
                      }
```

(If that handler has a different shape, put the same code wherever the material id is set. Read lines 330-372 first.)

4. Directly above `{/* Notes */}`, add:

```tsx
        <form.Subscribe
          selector={(state) => [
            state.values.byProductTracked,
            state.values.containerName,
            state.values.containerSize,
            state.values.quantity,
          ] as const}
        >
          {([byProductTracked, containerName, containerSize, quantity]) => (
            <ByProductFields
              value={{ byProductTracked, containerName, containerSize }}
              quantity={quantity}
              unit={
                materialType === "chemical"
                  ? (activeMaterial as any)?.unit || "kg"
                  : packagingUnit(activeMaterial as any)
              }
              onChange={(next) => {
                form.setFieldValue("byProductTracked", next.byProductTracked);
                form.setFieldValue("containerName", next.containerName);
                form.setFieldValue("containerSize", next.containerSize);
              }}
            />
          )}
        </form.Subscribe>
```

- [ ] **Step 6: Wire into `add-raw-material-form.tsx`**

1. Import `ByProductFields` and `sizeFromPackagingText`.
2. `defaultValues` add `byProductTracked: false, containerName: "", containerSize: "",`.
3. Directly above `<form.Field name="notes">`, add:

```tsx
        <form.Subscribe
          selector={(state) => [
            state.values.byProductTracked,
            state.values.containerName,
            state.values.containerSize,
            state.values.quantity,
            state.values.unit,
          ] as const}
        >
          {([byProductTracked, containerName, containerSize, quantity, unit]) => (
            <ByProductFields
              value={{ byProductTracked, containerName, containerSize }}
              quantity={quantity}
              unit={unit || "kg"}
              onChange={(next) => {
                // First tick copies the item's own pack type and size when the person has not typed any.
                const firstTick = next.byProductTracked && !byProductTracked && !next.containerName && !next.containerSize;
                form.setFieldValue("byProductTracked", next.byProductTracked);
                form.setFieldValue("containerName", firstTick ? form.state.values.packagingType || "" : next.containerName);
                form.setFieldValue("containerSize", firstTick ? sizeFromPackagingText(form.state.values.packagingSize) : next.containerSize);
              }}
            />
          )}
        </form.Subscribe>
```

If the form has no `quantity` (initial stock optional), `ByProductFields` still renders. The server only saves the columns when a purchase is created (`quantity > 0`).

- [ ] **Step 7: Wire into `add-packaging-material-form.tsx`**

1. Import `ByProductFields` and `packagingUnit` (from `@/lib/inventory/material-units`, if it is not already imported).
2. `defaultValues` add `byProductTracked: false, containerName: "", containerSize: "",`.
3. Directly above `<form.Field name="notes">`, add:

```tsx
        <form.Subscribe
          selector={(state) => [
            state.values.byProductTracked,
            state.values.containerName,
            state.values.containerSize,
            state.values.quantity,
            state.values.measuredInKg,
          ] as const}
        >
          {([byProductTracked, containerName, containerSize, quantity, measuredInKg]) => (
            <ByProductFields
              value={{ byProductTracked, containerName, containerSize }}
              quantity={quantity}
              unit={packagingUnit({ measuredInKg })}
              onChange={(next) => {
                form.setFieldValue("byProductTracked", next.byProductTracked);
                form.setFieldValue("containerName", next.containerName);
                form.setFieldValue("containerSize", next.containerSize);
              }}
            />
          )}
        </form.Subscribe>
```

- [ ] **Step 8: Wire into `edit-purchase-dialog.tsx`**

1. Import `ByProductFields`.
2. Add to the `purchase` prop type: `byProductTracked?: boolean; containerName?: string | null; containerSize?: string | null;`. The purchase list loads every column with `db.query.purchaseRecords.findMany`, so the data is already there. Also add the same three optional fields to `PurchaseRecord` in `src/components/suppliers/purchase-history-table.tsx`.
3. `defaultValues` add:

```ts
      byProductTracked: purchase?.byProductTracked ?? false,
      containerName: purchase?.containerName ?? "",
      containerSize: plainNumber(purchase?.containerSize),
```

4. In `onSubmit`'s `data`, add `byProductTracked: value.byProductTracked, containerName: value.containerName, containerSize: value.containerSize,`.
5. In the `useEffect` that copies `purchase` into the form, add:

```ts
      form.setFieldValue("byProductTracked", purchase.byProductTracked ?? false);
      form.setFieldValue("containerName", purchase.containerName ?? "");
      form.setFieldValue("containerSize", plainNumber(purchase.containerSize));
```

6. Directly above `<form.Field name="invoiceNumber">`, add:

```tsx
        <form.Subscribe
          selector={(state) => [
            state.values.byProductTracked,
            state.values.containerName,
            state.values.containerSize,
            state.values.quantity,
          ] as const}
        >
          {([byProductTracked, containerName, containerSize, quantity]) => (
            <ByProductFields
              value={{ byProductTracked, containerName, containerSize }}
              quantity={quantity}
              unit={isChemical ? purchase.chemical?.unit || "kg" : "pcs"}
              onChange={(next) => {
                form.setFieldValue("byProductTracked", next.byProductTracked);
                form.setFieldValue("containerName", next.containerName);
                form.setFieldValue("containerSize", next.containerSize);
              }}
            />
          )}
        </form.Subscribe>
```

- [ ] **Step 9: Run tests and typecheck**

Run: `bun run test && bun run typecheck`
Expected: all tests pass, including the existing stock/packaging behavior tests. Typecheck errors only in `use-other-income.ts` (Task 7). If an existing behavior test breaks because it asserts the exact submitted payload, add the three default fields to that expected payload.

- [ ] **Step 10: Commit**

```bash
git add src/components/inventory src/components/suppliers src/__tests__/by-product-fields.behavior.test.tsx
git commit -m "feat(inventory): add by-product tick to purchase forms"
```

---

### Task 7: By-Products page, hooks, route and sidebar

**Files:**
- Create (via `git mv` + edit): `src/hooks/finance/use-by-products.ts` (from `use-other-income.ts`)
- Create (via `git mv` + edit): `src/components/finance/by-products-page.tsx` (from `other-income-page.tsx`)
- Create: `src/routes/_protected/finance/by-products/index.tsx`
- Modify: `src/routes/_protected/finance/other-income/index.tsx` (redirect only)
- Modify: `src/lib/constants.ts:193-194`
- Test: `src/__tests__/by-products-page.test.ts`

**Interfaces:**
- Consumes: `getByProductsFn`, `createByProductSaleFn`, `voidByProductSaleFn` (Task 5), `ByProductSummary` (Task 3).
- Produces: `useByProducts(month)`, `useCreateByProductSale()`, `useVoidByProductSale()`, `byProductKeys`, `ByProductsPage`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/by-products-page.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("by-products page wiring", () => {
  it("renames the sidebar entry", () => {
    const constants = read("src/lib/constants.ts");
    expect(constants).toContain('title: "By-Products"');
    expect(constants).toContain('url: "/finance/by-products"');
    expect(constants).not.toContain("/finance/other-income");
  });

  it("redirects the old address", () => {
    const old = read("src/routes/_protected/finance/other-income/index.tsx");
    expect(old).toContain('redirect({ to: "/finance/by-products"');
  });

  it("shows earned, sold and in hand, and caps the sale at in hand", () => {
    const page = read("src/components/finance/by-products-page.tsx");
    expect(page).toContain("In hand");
    expect(page).toContain("max={selected?.inHand");
    expect(page).toContain("row.inHand > 0");
    expect(page).toContain("formatRupees(wallet.balance)");
  });

  it("refreshes balances and reports after a money change", () => {
    expect(read("src/hooks/finance/use-by-products.ts")).toContain("invalidateFinanceQueries(queryClient)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/by-products-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Hooks**

`git mv src/hooks/finance/use-other-income.ts src/hooks/finance/use-by-products.ts`, then replace the whole file with:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateFinanceQueries } from "@/lib/finance/invalidate-finance";
import {
  createByProductSaleFn,
  getByProductsFn,
  voidByProductSaleFn,
} from "@/server-functions/finance/by-products-fn";

export const byProductKeys = {
  all: ["by-products"] as const,
  month: (month: string) => ["by-products", "month", month] as const,
};

export const useByProducts = (month: string) =>
  useQuery({
    queryKey: byProductKeys.month(month),
    queryFn: () => getByProductsFn({ data: { month } }),
  });

/** Sales move account balances and feed the monthly report, so refresh both. */
function useRefreshAfterSaleChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: byProductKeys.all }),
      invalidateFinanceQueries(queryClient),
    ]);
}

export const useCreateByProductSale = () => {
  const refresh = useRefreshAfterSaleChange();
  return useMutation({
    mutationFn: createByProductSaleFn,
    onSuccess: () => {
      void refresh();
      toast.success("Sale recorded");
    },
    onError: (err: Error) => toast.error("Failed to record sale", { description: err.message }),
  });
};

export const useVoidByProductSale = () => {
  const refresh = useRefreshAfterSaleChange();
  return useMutation({
    mutationFn: voidByProductSaleFn,
    onSuccess: () => {
      void refresh();
      toast.success("Sale voided");
    },
    onError: (err: Error) => toast.error("Failed to void sale", { description: err.message }),
  });
};
```

- [ ] **Step 4: Page**

`git mv src/components/finance/other-income-page.tsx src/components/finance/by-products-page.tsx`, then make these edits:

1. Hook imports become `useByProducts, useCreateByProductSale, useVoidByProductSale` from `@/hooks/finance/use-by-products`. Remove `useOtherIncomeItemNames` and `useId`.
2. Rename `IncomeRow` to `SaleRow` (type from `useByProducts`). Add `type ByProduct = NonNullable<ReturnType<typeof useByProducts>["data"]>["byProducts"][number];`.
3. Rename `OtherIncomePage` to `ByProductsPage`. It uses `useByProducts(month)`. The button text is `+ Record sale`, the empty-list text is `No by-product sales this month.` and the error text is `Could not load by-products.`.
4. Directly under the toolbar `div` (before the error/loading block), add the summary table:

```tsx
      {data && (
        data.byProducts.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            No by-products yet. Tick "By-product" on a purchase to start tracking its containers.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>By-product</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">In hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byProducts.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.earned}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.sold}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", row.inHand < 0 && "text-destructive")}>
                      {row.inHand}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
```

5. Pass the by-products to the sheet: `<RecordSaleSheet open={adding} onOpenChange={setAdding} byProducts={data?.byProducts ?? []} />`. Rename `VoidOtherIncomeDialog` to `VoidSaleDialog`.
6. Replace `AddOtherIncomeSheet` with `RecordSaleSheet`. Signature: `({ open, onOpenChange, byProducts }: { open: boolean; onOpenChange: (open: boolean) => void; byProducts: ByProduct[] })`. Changes from the old sheet:
   - Replace `itemName` state with `const [key, setKey] = useState("");` and `const selected = byProducts.find((row) => row.key === key);`.
   - Replace the Item `Input` + `datalist` block with:

```tsx
        <div className="space-y-2">
          <Label>By-product</Label>
          <Select value={key} onValueChange={setKey}>
            <SelectTrigger>
              <SelectValue placeholder="Pick by-product" />
            </SelectTrigger>
            <SelectContent>
              {byProducts.filter((row) => row.inHand > 0).map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label} · {row.inHand} in hand
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```

   - The quantity input becomes `step="1"`, `inputMode="numeric"`, `min="1"`, `max={selected?.inHand ?? undefined}`.
   - `isDirty` uses `key !== ""` in place of `itemName !== ""`. `reset` clears `key`.
   - The `save` checks become:

```ts
    if (!selected) return void toast.error("Please pick the by-product");
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return void toast.error("Quantity must be a whole number");
    if (qty > selected.inHand) return void toast.error(`Only ${selected.inHand} in hand`);
    if (!amount) return void toast.error("Price must be above zero");
    if (!walletId) return void toast.error("Please pick the account");
```

   - The mutate `data` becomes:

```ts
        data: {
          incomeDate: date,
          materialType: selected.materialType,
          materialId: selected.materialId,
          containerName: selected.containerName,
          containerSize: selected.containerSize,
          quantity: qty,
          unitPrice: Number(unitPrice),
          walletId,
          note: note.trim() || undefined,
        },
```

   - Sheet `title="Record by-product sale"`, `description="Empty containers sold. You can sell only what is in hand."`. Change the ids `income-*` to `sale-*`.
7. The void dialog uses `useVoidByProductSale()` and is titled `Void this sale?`. Keep the rest.

- [ ] **Step 5: Routes**

Create `src/routes/_protected/finance/by-products/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ByProductsPage } from "@/components/finance/by-products-page";

export const Route = createFileRoute("/_protected/finance/by-products/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col p-4 sm:p-8">
        <header className="border-b pb-8">
          <h1 className="text-3xl font-bold uppercase tracking-tighter">By-Products</h1>
          <p className="mt-2 text-muted-foreground">
            Empty containers from used stock, and what they were sold for.
          </p>
        </header>
        <div className="flex-1 py-8">
          <ByProductsPage />
        </div>
      </div>
    </main>
  );
}
```

Replace `src/routes/_protected/finance/other-income/index.tsx` with:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address of the By-Products page.
export const Route = createFileRoute("/_protected/finance/other-income/")({
  beforeLoad: () => {
    throw redirect({ to: "/finance/by-products", replace: true });
  },
});
```

- [ ] **Step 6: Sidebar**

In `src/lib/constants.ts`, change:

```ts
        title: "Other Income",
        url: "/finance/other-income",
```

to

```ts
        title: "By-Products",
        url: "/finance/by-products",
```

Then run `grep -rn "other-income\|finance/other" src/lib/rbac.ts src/lib/authz.server.ts`. If a route-permission map lists `/finance/other-income`, add `/finance/by-products` with the same permission (keep the old entry so the redirect is reachable).

- [ ] **Step 7: Regenerate routes, run tests and typecheck**

Run: `timeout 60 bun run dev` (stop it once "ready" is printed, which regenerates `src/routeTree.gen.ts`), then `bun run test && bun run typecheck`.
Expected: all tests PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A src/hooks/finance src/components/finance src/routes/_protected/finance src/lib/constants.ts src/routeTree.gen.ts src/__tests__/by-products-page.test.ts
git commit -m "feat(finance): rename Other Income to By-Products with in-hand counts"
```

---

### Task 8: Final checks and walkthrough

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `bun run test && bun run typecheck && bun run build`
Expected: all pass. The build needs no DB.

- [ ] **Step 2: Graph update**

Run: `graphify update .`

- [ ] **Step 3: Whole-feature review**

Use superpowers:requesting-code-review once over all commits since `41d3548`.

- [ ] **Step 4: Browser walkthrough (one pass)**

With `bun run dev` and the local DB:
1. Add stock of a chemical: 1000kg, tick By-product, Drum, 100. Hint shows "10 Drums". Save.
2. Try 950kg with the same tick and check it is refused.
3. Use 350kg in a mixing run (or a loss adjustment of 350kg). Open Finance → By-Products and check the row "<name> – 100kg Drum" shows earned 3, sold 0, in hand 3.
4. Record a sale of 2 at Rs 500 and check in hand drops to 1 and the account balance goes up by 1000.
5. Try a sale of 2 more and check the "Only 1 … in hand" error.
6. Void the sale and check in hand goes back to 3.
7. Open `/finance/other-income` and check it lands on `/finance/by-products`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(by-products): walkthrough fixes"
```

(Skip if nothing changed.)
