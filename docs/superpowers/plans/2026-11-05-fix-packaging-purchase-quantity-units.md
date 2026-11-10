# Fix Packaging Purchase Quantity Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Total Purchase Quantity displays accurate counted unit labels ("pcs", or "kg" for weight-measured shoppers) instead of the container's liquid volume/capacity ("L", "ml").

**Architecture:** Decouple packaging container fill capacity (`capacityUnit`) from inventory counting units. Adopt the canonical `packagingUnit()` and `packagingUnitSql()` helpers across purchase history grouping, purchase details dialog, audit logs, and purchase report queries so packaging quantities are consistently formatted as counted pieces (`pcs`) or weight (`kg`).

**Tech Stack:** React 19, TypeScript, TanStack Start, Drizzle ORM, Vitest, Testing Library.

**Spec:** The Total Purchase Quantity column in the supplier purchase table and associated detail views erroneously falls back to `packagingMaterial.capacityUnit` (e.g. `L` or `ml`). For packaging items (such as bottles, caps, and cartons), the purchase quantity represents the number of physical containers/units, not their liquid volume.

## Global Constraints

- Never use `packagingMaterial.capacityUnit` as the unit of measure for purchased quantity or stock counts.
- Shoppers with `measuredInKg: true` must display as `"kg"`.
- All other packaging materials must display as `"pcs"`.
- Chemical raw materials must continue to use their registered `chemical.unit` (`"kg"` or `"liters"`).
- Preserve existing database schema and migrations (no Drizzle schema changes needed).

---

### Task 1: Fix Packaging Unit Resolution in Purchase History Table & Dialogs

**Files:**
- Modify: `src/components/suppliers/purchase-history-table.tsx`
- Modify: `src/components/suppliers/purchase-details-dialog.tsx`
- Test: `src/__tests__/purchase-history-grouping.test.tsx`

**Interfaces:**
- Consumes: `packagingUnit` from `@/lib/inventory/material-units`
- Produces: Correct `unit` and `recUnit` strings (`"pcs"` / `"kg"`) in grouped and individual purchase rows.

- [ ] **Step 1: Write the failing unit tests for `groupByMaterial` and packaging units**

Edit `src/__tests__/purchase-history-grouping.test.tsx` to add assertions verifying that packaging materials with `capacityUnit: "L"` display as `"pcs"` rather than `"L"`, and shoppers with `measuredInKg: true` display as `"kg"`.

```tsx
  it("resolves packaging unit to pcs regardless of container capacityUnit", () => {
    const recordsWithLiterBottle: PurchaseRecord[] = [
      {
        id: "p-liter-1",
        createdAt: "2026-11-05T10:00:00Z",
        purchaseDate: "2026-11-05T10:00:00Z",
        quantity: "5000",
        cost: "150000",
        paidAmount: "150000",
        unitCost: "30",
        materialType: "packaging",
        stockLeft: 5000,
        packagingMaterial: {
          id: "pkg-liter-bottle",
          name: "1L Bottle",
          type: "primary",
          capacity: "1",
          capacityUnit: "L",
          minimumStockLevel: 500,
          measuredInKg: false,
        },
      },
      {
        id: "p-shopper-1",
        createdAt: "2026-11-04T10:00:00Z",
        purchaseDate: "2026-11-04T10:00:00Z",
        quantity: "250",
        cost: "130000",
        paidAmount: "130000",
        unitCost: "520",
        materialType: "packaging",
        stockLeft: 250,
        packagingMaterial: {
          id: "pkg-shopper-kg",
          name: "100g Shopper Bag",
          type: "primary",
          capacity: null,
          capacityUnit: null,
          minimumStockLevel: 50,
          measuredInKg: true,
        },
      },
    ];

    const groups = groupByMaterial(recordsWithLiterBottle);
    const bottleGroup = groups.find((g) => g.materialName === "1L Bottle");
    const shopperGroup = groups.find((g) => g.materialName === "100g Shopper Bag");

    expect(bottleGroup?.unit).toBe("pcs");
    expect(shopperGroup?.unit).toBe("kg");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/purchase-history-grouping.test.tsx`
Expected: FAIL because `bottleGroup?.unit` evaluates to `"L"` instead of `"pcs"`.

- [ ] **Step 3: Update `purchase-history-table.tsx` and `purchase-details-dialog.tsx`**

In `src/components/suppliers/purchase-history-table.tsx`:
1. Import `packagingUnit` from `@/lib/inventory/material-units`:
```tsx
import { packagingUnit } from "@/lib/inventory/material-units";
```
2. Update `PurchaseRecord` type:
```tsx
  packagingMaterial?: {
    id: string;
    name: string;
    type: string;
    capacity: string | null;
    capacityUnit: string | null;
    minimumStockLevel: number | null;
    measuredInKg?: boolean | null;
  } | null;
```
3. Update `groupByMaterial` unit calculation:
```tsx
      const unit =
        r.chemical?.unit ??
        (materialType === "packaging" || r.packagingMaterial
          ? packagingUnit(r.packagingMaterial)
          : "units");
```
4. Update sub-row `recUnit`:
```tsx
      const recUnit =
        record.chemical?.unit ||
        (record.materialType === "packaging" || record.packagingMaterial
          ? packagingUnit(record.packagingMaterial)
          : group.unit);
```

In `src/components/suppliers/purchase-details-dialog.tsx`:
1. Import `packagingUnit` from `@/lib/inventory/material-units`:
```tsx
import { packagingUnit } from "@/lib/inventory/material-units";
```
2. Update `Props.purchase.packagingMaterial` type to include `measuredInKg?: boolean | null;`.
3. Update `unit` derivation:
```tsx
  const unit =
    purchase.chemical?.unit ||
    (purchase.packagingMaterial
      ? packagingUnit(purchase.packagingMaterial)
      : "units");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/purchase-history-grouping.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/suppliers/purchase-history-table.tsx src/components/suppliers/purchase-details-dialog.tsx src/__tests__/purchase-history-grouping.test.tsx
git commit -m "fix(suppliers): display packaging purchase quantity in pcs or kg instead of capacityUnit"
```

---

### Task 2: Fix Server Functions and Reports Using `capacityUnit` as Material Unit

**Files:**
- Modify: `src/server-functions/reports/purchases-report-fn.ts`
- Modify: `src/server-functions/inventory/add-packaging-material-fn.ts`
- Modify: `src/server-functions/inventory/stock/add-stock-fn.ts`
- Test: `src/__tests__/shopper-kg-units.test.ts`

**Interfaces:**
- Consumes: `packagingUnit` from `@/lib/inventory/material-units`, `packagingUnitSql` from `@/lib/inventory/material-units.server`
- Produces: Correct unit in purchase reports and activity log descriptions.

- [ ] **Step 1: Add regression tests in `shopper-kg-units.test.ts`**

Update `src/__tests__/shopper-kg-units.test.ts` to include `src/server-functions/reports/purchases-report-fn.ts` in the list of server functions verified to use `packagingUnitSql`:

```ts
  it.each([
    "src/server-functions/inventory/stock/transfer-stock-fn.ts",
    "src/server-functions/inventory/find-similar-materials-fn.ts",
    "src/server-functions/inventory/stock/get-low-stocks-alert-fn.ts",
    "src/server-functions/inventory/factory-floor/get-consumption-history-fn.ts",
    "src/server-functions/reports/purchases-report-fn.ts",
  ])("%s reads the packaging unit from the KG switch", (path) => {
    const source = read(path);
    expect(source).toContain("packagingUnitSql(packagingMaterials.measuredInKg)");
    expect(source).not.toContain("packagingMaterials.capacityUnit");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/shopper-kg-units.test.ts`
Expected: FAIL because `purchases-report-fn.ts` currently references `packagingMaterials.capacityUnit`.

- [ ] **Step 3: Update `purchases-report-fn.ts`, `add-packaging-material-fn.ts`, and `add-stock-fn.ts`**

In `src/server-functions/reports/purchases-report-fn.ts`:
1. Import `packagingUnitSql`:
```ts
import { packagingUnitSql } from "@/lib/inventory/material-units.server";
```
2. Replace:
```ts
packagingUnit: packagingMaterials.capacityUnit,
```
with:
```ts
packagingUnit: packagingUnitSql(packagingMaterials.measuredInKg),
```

In `src/server-functions/inventory/add-packaging-material-fn.ts`:
1. Import `packagingUnit`:
```ts
import { packagingUnit } from "@/lib/inventory/material-units";
```
2. On line 255, replace:
```ts
const unitStr = data.measuredInKg ? "kg" : data.capacityUnit || "units";
```
with:
```ts
const unitStr = packagingUnit(data);
```

In `src/server-functions/inventory/stock/add-stock-fn.ts`:
1. Import `packagingUnit`:
```ts
import { packagingUnit } from "@/lib/inventory/material-units";
```
2. On line 289, replace:
```ts
materialUnit = pkg.measuredInKg ? "kg" : pkg.capacityUnit || "units";
```
with:
```ts
materialUnit = packagingUnit(pkg);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/shopper-kg-units.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-functions/reports/purchases-report-fn.ts src/server-functions/inventory/add-packaging-material-fn.ts src/server-functions/inventory/stock/add-stock-fn.ts src/__tests__/shopper-kg-units.test.ts
git commit -m "fix(inventory): use packagingUnit in purchases report and stock addition logs"
```

---

### Task 3: End-to-End Typecheck and Test Suite Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run full TypeScript typecheck**

Run: `bun run typecheck`
Expected: Exit code 0, no diagnostics.

- [ ] **Step 2: Run affected tests**

Run: `bun run test src/__tests__/purchase-history-grouping.test.tsx src/__tests__/shopper-kg-units.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Update graphify knowledge graph**

Run: `graphify update .`
Expected: Graph updated with latest AST changes.
