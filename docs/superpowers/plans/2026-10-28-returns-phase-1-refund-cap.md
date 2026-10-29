# Returns Phase 1 — Refund Price Cap and Exact Money Math Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sales returns from refunding more per unit than the customer actually paid on the invoice line, unless a user with the override permission gives a reason, and compute every returns money total with exact decimal math.

**Architecture:** A new pure module computes the maximum refund per unit for an invoice line (line amount minus its share of the invoice-level discount, spread over the units the customer can return, rounded down to the paisa) and the line/total refund amounts with `big.js`. The create-return server function uses it to reject or record overrides; the approve step re-checks it so pending returns created before this change cannot slip through. The return dialog shows the capped price read-only and offers "Change price" only to users holding `sales.returns.override-price`.

**Tech Stack:** TanStack Start server functions, Drizzle ORM + PostgreSQL, `big.js`, React + shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-returns-and-expenses-spec.md` — Part A, Fix 1 (delivery phase 1).

## Global Constraints

- Server rejects any refund per unit above the net unit price charged on the invoice line, unless the user holds the override permission and supplies a reason. The override is recorded on the return and shown on the approval screen.
- All money calculations in the returns flow use exact decimal math (as the stock calculations already do). No floating-point totals.
- New permission key is exactly `sales.returns.override-price`.
- Schema changes only through `bun run db:generate`. Never hand-edit files under `src/db/migrations/`.
- Do not change the returns lifecycle, statuses, condition handling or stock movement in this phase (that is phase 3).

## Definitions used in this plan

- **Returnable units of a line** = `numberOfCartons × unitsPerCarton + quantity`, where `unitsPerCarton = packsPerCarton || actualPackSize || 1`. This is the same count the server already uses to cap return quantities. (The dialog currently uses `actualPackSize` only; this plan moves it to the shared helper so client and server agree.)
- **Line net amount** = `item.amount − invoiceDiscount × item.amount / itemsTotal`, where `itemsTotal` is the sum of all line amounts on the invoice. When `itemsTotal` is 0 the discount share is 0.
- **Max refund per unit** = `lineNet / returnableUnits`, rounded **down** to 2 decimals. Rounding down guarantees a full return never refunds more than the line net.
- **Line refund** = `refundPerUnit × units`, rounded half-up to 2 decimals.

Worked examples (used as tests):

| Line amount | Invoice discount | Items total | Returnable units | Max per unit |
|---|---|---|---|---|
| 1000 | 0 | 1000 | 3 | 333.33 |
| 1000 | 100 | 2000 | 10 | 95.00 |
| 0 | 0 | 0 | 5 | 0.00 |
| 500 | 0 | 500 | 0 | 0.00 |

## File map

- Create `src/lib/sales/returns/refund-pricing.ts` — pure money helpers for returns (no DB, safe to import in client and server).
- Create `src/lib/sales/returns/refund-pricing.test.ts` — unit tests for the helpers.
- Modify `src/db/schemas/sales-erp-schema.ts` — two columns on `sales_returns`.
- Generated `src/db/migrations/*` — via `bun run db:generate` only.
- Modify `src/lib/rbac.ts` — new permission key + definition.
- Modify `src/server-functions/sales/sales-returns-fn.ts` — create and approve use the helpers.
- Modify `src/lib/sales-workflows.test.ts` — source-inspection regression test.
- Modify `src/hooks/sales/use-sales-returns.ts` — mutation input type.
- Modify `src/components/sales/create-return-dialog.tsx` — read-only price, override flow, exact totals.
- Modify `src/routes/_protected/sales/invoices/$invoiceId/index.tsx` — pass invoice discount; show override warning on pending returns.

---

### Task 1: Refund pricing helpers

**Files:**
- Create: `src/lib/sales/returns/refund-pricing.ts`
- Test: `src/lib/sales/returns/refund-pricing.test.ts`

**Interfaces:**
- Produces:
  - `getReturnUnitsPerCarton(item: { packsPerCarton?: number | null; actualPackSize?: number | null }): number`
  - `getReturnableUnits(item: ReturnPricingLine): number`
  - `sumMoney(values: Array<string | number>): string`
  - `getMaxRefundPerUnit(item: ReturnPricingLine, invoice: { invoiceDiscount?: string | number | null; itemsTotal: string | number }): string`
  - `calculateReturnLineRefund(units: number, refundPerUnit: string | number): string`
  - `resolveRefundPerUnit(params: { requested?: string | number | null; max: string; canOverride: boolean; overrideReason?: string | null; label: string }): { refundPerUnit: string; overridden: boolean }`
  - `type ReturnPricingLine = { numberOfCartons: number; quantity: number; packsPerCarton?: number | null; actualPackSize?: number | null; amount: string | number }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sales/returns/refund-pricing.test.ts
import { describe, expect, it } from "vitest";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnableUnits,
  getReturnUnitsPerCarton,
  resolveRefundPerUnit,
  sumMoney,
} from "./refund-pricing";

const line = (overrides: Partial<Parameters<typeof getReturnableUnits>[0]> = {}) => ({
  numberOfCartons: 0,
  quantity: 0,
  packsPerCarton: 0,
  actualPackSize: 0,
  amount: "0",
  ...overrides,
});

describe("getReturnUnitsPerCarton", () => {
  it("prefers packsPerCarton, then actualPackSize, then 1", () => {
    expect(getReturnUnitsPerCarton({ packsPerCarton: 12, actualPackSize: 6 })).toBe(12);
    expect(getReturnUnitsPerCarton({ packsPerCarton: 0, actualPackSize: 6 })).toBe(6);
    expect(getReturnUnitsPerCarton({ packsPerCarton: null, actualPackSize: null })).toBe(1);
  });
});

describe("getReturnableUnits", () => {
  it("counts cartons times units per carton plus loose units", () => {
    expect(getReturnableUnits(line({ numberOfCartons: 2, quantity: 3, packsPerCarton: 12 }))).toBe(27);
  });
});

describe("getMaxRefundPerUnit", () => {
  it("spreads the line amount over returnable units and rounds down", () => {
    expect(getMaxRefundPerUnit(line({ quantity: 3, amount: "1000" }), { itemsTotal: "1000" })).toBe("333.33");
  });

  it("takes off the line's share of the invoice discount", () => {
    expect(
      getMaxRefundPerUnit(line({ quantity: 10, amount: "1000" }), { invoiceDiscount: "100", itemsTotal: "2000" }),
    ).toBe("95.00");
  });

  it("returns 0.00 for a zero-amount line", () => {
    expect(getMaxRefundPerUnit(line({ quantity: 5, amount: "0" }), { itemsTotal: "0" })).toBe("0.00");
  });

  it("returns 0.00 when the line has no returnable units", () => {
    expect(getMaxRefundPerUnit(line({ amount: "500" }), { itemsTotal: "500" })).toBe("0.00");
  });

  it("never lets a full return exceed the line net", () => {
    const item = line({ quantity: 7, amount: "100" });
    const max = getMaxRefundPerUnit(item, { itemsTotal: "100" });
    expect(Number(calculateReturnLineRefund(7, max))).toBeLessThanOrEqual(100);
  });
});

describe("calculateReturnLineRefund and sumMoney", () => {
  it("multiplies exactly and rounds half up", () => {
    expect(calculateReturnLineRefund(3, "0.10")).toBe("0.30");
    expect(calculateReturnLineRefund(1, "333.335")).toBe("333.34");
  });

  it("adds without float drift", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney([])).toBe("0.00");
  });
});

describe("resolveRefundPerUnit", () => {
  const base = { max: "95.00", canOverride: false, label: "1L Bottle" };

  it("defaults to the max when nothing is requested", () => {
    expect(resolveRefundPerUnit({ ...base })).toEqual({ refundPerUnit: "95.00", overridden: false });
  });

  it("accepts a price at or below the max", () => {
    expect(resolveRefundPerUnit({ ...base, requested: 80 })).toEqual({ refundPerUnit: "80.00", overridden: false });
    expect(resolveRefundPerUnit({ ...base, requested: "95" })).toEqual({ refundPerUnit: "95.00", overridden: false });
  });

  it("rejects a price above the max without the override permission", () => {
    expect(() => resolveRefundPerUnit({ ...base, requested: 100 })).toThrow(
      "Refund per unit for 1L Bottle (Rs 100.00) is above the invoice price (Rs 95.00).",
    );
  });

  it("requires a reason to override", () => {
    expect(() => resolveRefundPerUnit({ ...base, canOverride: true, requested: 100, overrideReason: "  " })).toThrow(
      "A reason is required to refund above the invoice price.",
    );
  });

  it("marks an override when permitted and reasoned", () => {
    expect(
      resolveRefundPerUnit({ ...base, canOverride: true, requested: 100, overrideReason: "Goodwill" }),
    ).toEqual({ refundPerUnit: "100.00", overridden: true });
  });

  it("rejects negative prices", () => {
    expect(() => resolveRefundPerUnit({ ...base, requested: -1 })).toThrow("Refund per unit cannot be negative.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/lib/sales/returns/refund-pricing.test.ts`
Expected: FAIL — cannot resolve `./refund-pricing`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/sales/returns/refund-pricing.ts
import Big, { type BigSource } from "big.js";

export type ReturnPricingLine = {
  numberOfCartons: number;
  quantity: number;
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
  amount: string | number;
};

const toBig = (value: BigSource | null | undefined) => new Big(value || 0);

export function getReturnUnitsPerCarton(item: {
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
}): number {
  return item.packsPerCarton || item.actualPackSize || 1;
}

export function getReturnableUnits(item: ReturnPricingLine): number {
  return (item.numberOfCartons || 0) * getReturnUnitsPerCarton(item) + (item.quantity || 0);
}

export function sumMoney(values: Array<string | number>): string {
  return values
    .reduce<Big>((total, value) => total.plus(toBig(value)), new Big(0))
    .round(2, Big.roundHalfUp)
    .toFixed(2);
}

export function getMaxRefundPerUnit(
  item: ReturnPricingLine,
  invoice: { invoiceDiscount?: string | number | null; itemsTotal: string | number },
): string {
  const units = getReturnableUnits(item);
  if (units <= 0) return "0.00";

  const lineAmount = toBig(item.amount);
  const itemsTotal = toBig(invoice.itemsTotal);
  const discountShare = itemsTotal.gt(0)
    ? toBig(invoice.invoiceDiscount).times(lineAmount).div(itemsTotal)
    : new Big(0);
  const lineNet = lineAmount.minus(discountShare);
  if (lineNet.lte(0)) return "0.00";

  // Round down so a full return can never refund more than the line net.
  return lineNet.div(units).round(2, Big.roundDown).toFixed(2);
}

export function calculateReturnLineRefund(units: number, refundPerUnit: string | number): string {
  return toBig(refundPerUnit).times(units).round(2, Big.roundHalfUp).toFixed(2);
}

export function resolveRefundPerUnit(params: {
  requested?: string | number | null;
  max: string;
  canOverride: boolean;
  overrideReason?: string | null;
  label: string;
}): { refundPerUnit: string; overridden: boolean } {
  if (params.requested == null || params.requested === "") {
    return { refundPerUnit: params.max, overridden: false };
  }

  const requested = new Big(params.requested).round(2, Big.roundHalfUp);
  if (requested.lt(0)) throw new Error("Refund per unit cannot be negative.");
  if (requested.lte(params.max)) {
    return { refundPerUnit: requested.toFixed(2), overridden: false };
  }

  if (!params.canOverride) {
    throw new Error(
      `Refund per unit for ${params.label} (Rs ${requested.toFixed(2)}) is above the invoice price (Rs ${params.max}).`,
    );
  }
  if (!params.overrideReason?.trim()) {
    throw new Error("A reason is required to refund above the invoice price.");
  }
  return { refundPerUnit: requested.toFixed(2), overridden: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/lib/sales/returns/refund-pricing.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/returns/
git commit -m "feat(sales): add exact refund pricing helpers for returns"
```

---

### Task 2: Override columns and permission

**Files:**
- Modify: `src/db/schemas/sales-erp-schema.ts` (the `salesReturns` table, around line 707)
- Modify: `src/lib/rbac.ts` (permission key list near line 67, definitions near line 377)
- Generated: `src/db/migrations/*` via `bun run db:generate`
- Test: `src/lib/rbac.test.ts` (existing, run only)

**Interfaces:**
- Produces: `salesReturns.priceOverride: boolean` (not null, default false), `salesReturns.priceOverrideReason: string | null`, permission key `"sales.returns.override-price"` in `PermissionKey`.

- [ ] **Step 1: Add the columns**

In `src/db/schemas/sales-erp-schema.ts`, inside `salesReturns`, after `notes: text("notes"),` add:

```ts
  priceOverride: boolean("price_override").notNull().default(false),
  priceOverrideReason: text("price_override_reason"),
```

`boolean` is already imported from `drizzle-orm/pg-core` in this file.

- [ ] **Step 2: Add the permission**

In `src/lib/rbac.ts`, in the permission key list, directly after `"sales.manage",` add:

```ts
  "sales.returns.override-price",
```

In `PERMISSION_DEFINITIONS`, directly after the `sales.manage` entry, add:

```ts
  {
    key: "sales.returns.override-price",
    moduleKey: "sales",
    label: "Override return refund price",
    description: "Refund a sales return above the price charged on the invoice, with a reason.",
    kind: "action",
  },
```

Do not add it to any role preset. Super admins get it through `*`; admins grant it per role. `ensureRbacSeeded()` upserts the new definition on next start.

- [ ] **Step 3: Generate the migration**

Run: `bun run db:generate`
Expected: one new SQL file adding `price_override` and `price_override_reason` to `sales_returns`, plus snapshot and journal updates written by the generator. Do not edit them.

- [ ] **Step 4: Typecheck and run RBAC tests**

Run: `bun run typecheck && bun run test src/lib/rbac.test.ts`
Expected: no type errors; RBAC tests PASS. If a test asserts an exact permission count or list, update that test's expected value to include `sales.returns.override-price`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schemas/sales-erp-schema.ts src/lib/rbac.ts src/lib/rbac.test.ts src/db/migrations
git commit -m "feat(sales): add return price override columns and permission"
```

---

### Task 3: Enforce the cap on create and approve

**Files:**
- Modify: `src/server-functions/sales/sales-returns-fn.ts`
- Test: `src/lib/sales-workflows.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `salesReturns.priceOverride`, `salesReturns.priceOverrideReason`; `hasPermission` from `@/lib/rbac`.
- Produces: `createSalesReturnFn` input gains `priceOverrideReason?: string`; `refundPerUnit` becomes optional (omitted = invoice price). Returns created with `priceOverride` / `priceOverrideReason` set.

- [ ] **Step 1: Write the failing source-inspection test**

Add inside the `describe("sales workflow regressions", ...)` block in `src/lib/sales-workflows.test.ts`:

```ts
  it("caps return refunds at the invoice price with exact math and a reasoned override", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "sales-returns-fn.ts"),
      "utf8",
    );

    expect(source).toContain("from \"@/lib/sales/returns/refund-pricing\"");
    expect(source).toContain("getMaxRefundPerUnit(");
    expect(source).toContain("resolveRefundPerUnit(");
    expect(source).toContain("\"sales.returns.override-price\"");
    expect(source).toContain("priceOverrideReason");
    expect(source).toContain("!salesReturn.priceOverride");
    expect(source).not.toContain("let totalAmount = 0");
    expect(source).not.toContain("totalUnitsReturned * refundPerUnit");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test src/lib/sales-workflows.test.ts -t "caps return refunds"`
Expected: FAIL on the first `toContain`.

- [ ] **Step 3: Update imports and helpers**

At the top of `sales-returns-fn.ts`, add:

```ts
import { hasPermission } from "@/lib/rbac";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnUnitsPerCarton,
  resolveRefundPerUnit,
  sumMoney,
} from "@/lib/sales/returns/refund-pricing";
```

Replace the local `getUnitsPerCarton` function body so the file has one source of truth:

```ts
function getUnitsPerCarton(item: {
  packsPerCarton?: number | null;
  actualPackSize?: number | null;
}) {
  return getReturnUnitsPerCarton(item);
}
```

- [ ] **Step 4: Update the create input schema**

In `createSalesReturnFn`'s `inputValidator`, change the item `refundPerUnit` line and add the reason field:

```ts
        priceOverrideReason: z.string().trim().max(500).optional(),
        items: z
          .array(
            z.object({
              invoiceItemId: z.string().min(1),
              cartonsReturned: z.number().int().min(0).default(0),
              quantityReturned: z.number().int().min(0).default(0),
              refundPerUnit: z.number().min(0).optional(),
            }),
          )
          .min(1, "At least one return item is required"),
```

(`priceOverrideReason` goes next to `notes`.)

- [ ] **Step 5: Replace the create pricing loop and insert**

In the create handler, replace everything from `let totalAmount = 0;` through the end of the `tx.insert(salesReturnItems).values(...)` call with:

```ts
      const canOverridePrice = hasPermission(
        context.authContext.permissions,
        "sales.returns.override-price",
      );
      const itemsTotal = sumMoney(invoice.items.map((item) => item.amount));
      const resolvedLines: Array<{
        invoiceItemId: string;
        recipeId: string | null;
        cartonsReturned: number;
        quantityReturned: number;
        refundPerUnit: string;
        totalRefund: string;
      }> = [];
      let anyPriceOverride = false;

      for (const item of data.items) {
        const invoiceItem = invoiceItemMap.get(item.invoiceItemId);
        if (!invoiceItem) throw new Error("Invoice item not found");

        const cartons = item.cartonsReturned ?? 0;
        const units = item.quantityReturned ?? 0;
        const cpp = getUnitsPerCarton(invoiceItem);
        const totalUnitsReturned = getTotalUnits(cartons, units, cpp);
        if (totalUnitsReturned <= 0) {
          throw new Error(
            `Return quantity must be greater than zero for ${invoiceItem.pack}`,
          );
        }
        const totalUnitsInvoiced = getTotalUnits(
          invoiceItem.numberOfCartons,
          invoiceItem.quantity,
          cpp,
        );
        requestUnitsByItem.set(
          item.invoiceItemId,
          (requestUnitsByItem.get(item.invoiceItemId) ?? 0) +
            totalUnitsReturned,
        );
        const alreadyReservedUnits =
          reservedUnitsByItem.get(item.invoiceItemId) ?? 0;
        const remainingReturnableUnits = Math.max(
          0,
          totalUnitsInvoiced - alreadyReservedUnits,
        );

        if (
          (requestUnitsByItem.get(item.invoiceItemId) ?? 0) >
          remainingReturnableUnits
        ) {
          throw new Error(
            `Return quantity exceeds remaining returnable quantity for ${invoiceItem.pack}`,
          );
        }

        const maxRefundPerUnit = getMaxRefundPerUnit(invoiceItem, {
          invoiceDiscount: invoice.invoiceDiscount,
          itemsTotal,
        });
        const { refundPerUnit, overridden } = resolveRefundPerUnit({
          requested: item.refundPerUnit,
          max: maxRefundPerUnit,
          canOverride: canOverridePrice,
          overrideReason: data.priceOverrideReason,
          label: invoiceItem.pack,
        });
        anyPriceOverride ||= overridden;

        resolvedLines.push({
          invoiceItemId: item.invoiceItemId,
          recipeId: invoiceItem.recipeId,
          cartonsReturned: cartons,
          quantityReturned: units,
          refundPerUnit,
          totalRefund: calculateReturnLineRefund(totalUnitsReturned, refundPerUnit),
        });
      }

      const totalAmount = sumMoney(resolvedLines.map((line) => line.totalRefund));
      const priceOverrideReason = anyPriceOverride
        ? data.priceOverrideReason!.trim()
        : null;

      const [salesReturn] = await tx
        .insert(salesReturns)
        .values({
          id: createId(),
          invoiceId: data.invoiceId,
          customerId: invoice.customerId,
          returnDate: data.returnDate ? new Date(data.returnDate) : new Date(),
          reason: data.reason,
          condition: data.condition,
          totalAmount,
          status: "pending",
          notes: data.notes ?? null,
          priceOverride: anyPriceOverride,
          priceOverrideReason,
        })
        .returning();

      await tx.insert(salesReturnItems).values(
        resolvedLines.map((line) => ({
          id: createId(),
          salesReturnId: salesReturn.id,
          ...line,
        })),
      );
```

- [ ] **Step 6: Update the create timeline event**

In the `recordInvoiceTimelineEvent` call right after, change `description` and `metadata` to:

```ts
          description: `Return of PKR ${totalAmount} recorded. Status: pending. Reason: ${data.reason}.${anyPriceOverride ? ` Refund price overridden: ${priceOverrideReason}.` : ""}`,
          metadata: {
            salesReturnId: salesReturn.id,
            returnNumber: salesReturn.returnNumber,
            totalAmount,
            reason: data.reason,
            condition: data.condition,
            priceOverride: anyPriceOverride,
            priceOverrideReason,
          },
```

- [ ] **Step 7: Re-check the cap on approve**

In `processSalesReturnFn`, inside `if (data.action === "approve" && salesReturn.invoice) {`, right after `const invoiceItemMap = new Map(...)` is built, add:

```ts
        if (!salesReturn.priceOverride) {
          const allInvoiceItems = await tx.query.invoiceItems.findMany({
            where: eq(invoiceItems.invoiceId, salesReturn.invoiceId),
            columns: { amount: true },
          });
          const itemsTotal = sumMoney(allInvoiceItems.map((item) => item.amount));
          for (const returnItem of salesReturn.items) {
            const invoiceItem = invoiceItemMap.get(returnItem.invoiceItemId);
            if (!invoiceItem) continue;
            const maxRefundPerUnit = getMaxRefundPerUnit(invoiceItem, {
              invoiceDiscount: salesReturn.invoice.invoiceDiscount,
              itemsTotal,
            });
            if (new Big(returnItem.refundPerUnit).gt(maxRefundPerUnit)) {
              throw new Error(
                `Return #${salesReturn.returnNumber} refunds ${invoiceItem.pack} at Rs ${returnItem.refundPerUnit} per unit, above the invoice price of Rs ${maxRefundPerUnit}. Reject it and record the return again.`,
              );
            }
          }
        }
```

This blocks pending returns created before this phase with a price above the invoice price. The fix for those is reject + re-request, which the message says.

- [ ] **Step 8: Run tests and typecheck**

Run: `bun run test src/lib/sales-workflows.test.ts src/lib/sales/returns && bun run typecheck`
Expected: PASS, no type errors. If `context.authContext` is not typed on this middleware chain, read the permission set the same way `createPermissionMiddleware` in `src/lib/middlewares.ts` passes it (`context.authContext.permissions`).

- [ ] **Step 9: Commit**

```bash
git add src/server-functions/sales/sales-returns-fn.ts src/lib/sales-workflows.test.ts
git commit -m "fix(sales): cap return refunds at the invoice price"
```

---

### Task 4: Return dialog and approval warning

**Files:**
- Modify: `src/hooks/sales/use-sales-returns.ts`
- Modify: `src/components/sales/create-return-dialog.tsx`
- Modify: `src/routes/_protected/sales/invoices/$invoiceId/index.tsx` (around lines 274 and 281–315)
- Test: `src/lib/sales-workflows.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 3 input shape (`refundPerUnit` optional, `priceOverrideReason`).
- Produces: `CreateReturnDialog` prop `invoiceDiscount: string | null`; `ReturnableItem` gains `amount: string` and `packsPerCarton: number`.

- [ ] **Step 1: Write the failing source-inspection test**

Add to `src/lib/sales-workflows.test.ts`:

```ts
  it("shows the capped refund price in the return dialog and flags overrides for approvers", () => {
    const dialog = readFileSync(resolve(SALES_COMPONENTS_DIR, "create-return-dialog.tsx"), "utf8");
    const invoicePage = readFileSync(
      resolve(process.cwd(), "src/routes/_protected/sales/invoices/$invoiceId/index.tsx"),
      "utf8",
    );

    expect(dialog).toContain("getMaxRefundPerUnit(");
    expect(dialog).toContain("\"sales.returns.override-price\"");
    expect(dialog).toContain("Change price");
    expect(dialog).toContain("priceOverrideReason");
    expect(dialog).not.toContain("item.retailPrice");
    expect(invoicePage).toContain("invoiceDiscount={invoice.invoiceDiscount}");
    expect(invoicePage).toContain("ret.priceOverride");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test src/lib/sales-workflows.test.ts -t "capped refund price"`
Expected: FAIL.

- [ ] **Step 3: Update the hook input type**

In `useCreateSalesReturn`'s `mutationFn` data type, add `priceOverrideReason?: string;` next to `notes?: string;`. `refundPerUnit?: number` stays optional as is.

- [ ] **Step 4: Rework the dialog pricing**

In `src/components/sales/create-return-dialog.tsx`:

1. Add imports:

```ts
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import {
  calculateReturnLineRefund,
  getMaxRefundPerUnit,
  getReturnUnitsPerCarton,
  sumMoney,
} from "@/lib/sales/returns/refund-pricing";
import Big from "big.js";
```

2. Replace the `ReturnableItem` interface's price fields and the props interface:

```ts
interface ReturnableItem {
  id: string;
  pack: string;
  numberOfCartons: number;
  quantity: number;
  packsPerCarton: number;
  actualPackSize: number;
  amount: string;
  recipe: { id: string; name: string } | null;
}

interface CreateReturnDialogProps {
  invoiceId: string;
  invoiceDiscount: string | null;
  items: ReturnableItem[];
  returns: ExistingReturn[];
  trigger?: React.ReactNode;
}
```

3. Replace `getUnitsPerCarton` and delete `getDefaultRefundPerUnit`:

```ts
function getUnitsPerCarton(item: ReturnableItem) {
  return getReturnUnitsPerCarton(item);
}
```

4. At the top of the component, take `invoiceDiscount` from props and add:

```ts
  const { data: viewerAccess } = useViewerAccess();
  const canOverridePrice =
    !!viewerAccess && hasPermission(viewerAccess.permissions, "sales.returns.override-price");
  const maxRefundByItem = React.useMemo(() => {
    const itemsTotal = sumMoney(items.map((item) => item.amount));
    return new Map(
      items.map((item) => [item.id, getMaxRefundPerUnit(item, { invoiceDiscount, itemsTotal })]),
    );
  }, [items, invoiceDiscount]);
  const [priceOverrideReason, setPriceOverrideReason] = React.useState("");
```

5. Change the line state shape so `refundPerUnit` is `""` unless the user overrides, and track which lines are being edited:

```ts
  const emptyLines = () =>
    items.map((item) => ({
      invoiceItemId: item.id,
      cartonsReturned: "",
      quantityReturned: "",
      refundPerUnit: "",
      editingPrice: false,
    }));
  const [lines, setLines] = React.useState(emptyLines);
```

Use `setLines(emptyLines())` in `resetForm`, and add `setPriceOverrideReason("");` there.

6. Add helpers below the state:

```ts
  const effectiveRefund = (line: (typeof lines)[number]) =>
    line.editingPrice && line.refundPerUnit !== ""
      ? line.refundPerUnit
      : maxRefundByItem.get(line.invoiceItemId) ?? "0.00";

  const isAboveInvoicePrice = (line: (typeof lines)[number]) =>
    line.editingPrice &&
    line.refundPerUnit !== "" &&
    new Big(line.refundPerUnit).gt(maxRefundByItem.get(line.invoiceItemId) ?? "0");

  const needsOverrideReason = lines.some(
    (line) =>
      (Number(line.cartonsReturned) > 0 || Number(line.quantityReturned) > 0) &&
      isAboveInvoicePrice(line),
  );
```

7. Replace `totalRefund` with exact math:

```ts
  const totalRefund = React.useMemo(() => {
    return sumMoney(
      lines.map((line) => {
        const sourceItem = items.find((item) => item.id === line.invoiceItemId);
        const unitsPerCarton = sourceItem ? getUnitsPerCarton(sourceItem) : 1;
        const units =
          (Number(line.cartonsReturned) || 0) * unitsPerCarton + (Number(line.quantityReturned) || 0);
        return calculateReturnLineRefund(units, effectiveRefund(line) || "0");
      }),
    );
  }, [items, lines, maxRefundByItem]);
```

and render it as `PKR {Number(totalRefund).toLocaleString("en-PK", { minimumFractionDigits: 2 })}`.

8. In `handleSubmit`, block when a reason is needed and send `refundPerUnit` only for edited lines:

```ts
    if (!reason.trim() || !hasAnyQuantity) return;
    if (needsOverrideReason && !priceOverrideReason.trim()) return;

    const returnItems = lines
      .map((line) => ({
        invoiceItemId: line.invoiceItemId,
        cartonsReturned: Number(line.cartonsReturned) || 0,
        quantityReturned: Number(line.quantityReturned) || 0,
        refundPerUnit:
          line.editingPrice && line.refundPerUnit !== "" ? Number(line.refundPerUnit) : undefined,
      }))
      .filter((line) => line.cartonsReturned > 0 || line.quantityReturned > 0);
```

and include `priceOverrideReason: needsOverrideReason ? priceOverrideReason.trim() : undefined,` in the mutate payload.

9. Replace the "Refund per Unit (PKR)" column block with a read-only price plus the override control:

```tsx
                        <div className="sm:col-span-4 space-y-1">
                          <Label className="text-xs">Refund per unit</Label>
                          {lines[idx].editingPrice ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={lines[idx].refundPerUnit}
                              placeholder={maxRefundByItem.get(item.id)}
                              onChange={(e) => {
                                const next = [...lines];
                                next[idx] = { ...next[idx], refundPerUnit: e.target.value };
                                setLines(next);
                              }}
                              disabled={remainingUnits === 0}
                            />
                          ) : (
                            <p className="h-9 flex items-center text-sm tabular-nums">
                              Rs {maxRefundByItem.get(item.id)}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Invoice price Rs {maxRefundByItem.get(item.id)} per unit
                          </p>
                          {canOverridePrice && !lines[idx].editingPrice && remainingUnits > 0 && (
                            <button
                              type="button"
                              className="text-xs text-primary underline-offset-2 hover:underline"
                              onClick={() => {
                                const next = [...lines];
                                next[idx] = { ...next[idx], editingPrice: true };
                                setLines(next);
                              }}
                            >
                              Change price
                            </button>
                          )}
                          {isAboveInvoicePrice(lines[idx]) && (
                            <p className="text-xs text-amber-600">Above invoice price</p>
                          )}
                        </div>
```

10. Under the items list (before the total box), add the reason field when needed:

```tsx
            {needsOverrideReason && (
              <div className="space-y-2">
                <Label htmlFor="price-override-reason">Why refund above the invoice price?</Label>
                <Textarea
                  id="price-override-reason"
                  value={priceOverrideReason}
                  onChange={(e) => setPriceOverrideReason(e.target.value)}
                  placeholder="Required. Shown to the approver."
                  rows={2}
                  required
                />
              </div>
            )}
```

11. Disable the submit button when `needsOverrideReason && !priceOverrideReason.trim()` as well.

- [ ] **Step 5: Pass the discount and show the override on the invoice page**

In `src/routes/_protected/sales/invoices/$invoiceId/index.tsx`, change the dialog usage:

```tsx
              <CreateReturnDialog
                invoiceId={invoice.id}
                invoiceDiscount={invoice.invoiceDiscount}
                items={invoice.items}
                returns={returns}
              />
```

In the returns list, directly under the `<p>` that shows `{PKR(Number(ret.totalAmount))}`, add:

```tsx
                      {ret.priceOverride && (
                        <p className="text-xs rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1">
                          Refund price set above the invoice price. Reason: {ret.priceOverrideReason}
                        </p>
                      )}
```

`getSalesReturnsByInvoiceFn` returns full return rows, so the new columns come through without changes.

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test src/lib/sales-workflows.test.ts && bun run typecheck`
Expected: PASS, no type errors. If `invoice.items` row type does not match `ReturnableItem` (for example `amount` typed as `string` vs `string | null`), widen `ReturnableItem` to match the row type rather than casting.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/sales/use-sales-returns.ts src/components/sales/create-return-dialog.tsx "src/routes/_protected/sales/invoices/\$invoiceId/index.tsx" src/lib/sales-workflows.test.ts
git commit -m "feat(sales): show capped refund price and override reason on returns"
```

---

### Task 5: Full verification

**Files:** none new.

- [ ] **Step 1: Full test suite and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Production build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 3: Manual check in the app** (`bun run dev`, port 3000, after `bun run db:migrate`)

1. As a user with `sales.manage` but without `sales.returns.override-price`: open an invoice, click Record Return. Each line shows "Invoice price Rs X per unit" and no "Change price" link. Return 1 unit; total equals X. Create succeeds.
2. On a retailer invoice with an invoice discount, confirm the shown price is lower than line amount ÷ units by the discount share.
3. As a super admin: click "Change price", enter a price above X. "Above invoice price" appears and the reason box is required. Submit with a reason; the pending return shows the amber override note with the reason.
4. Approve that return; it succeeds. Approve a return at or below the invoice price; it succeeds.
5. Calling `createSalesReturnFn` with a price above X as a non-override user returns "Refund per unit for … is above the invoice price …".

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 5: Commit any test-count fixes from verification**

```bash
git status --short
git add <only files changed in this task>
git commit -m "test(sales): align tests with return refund cap"
```

Skip if nothing changed.
