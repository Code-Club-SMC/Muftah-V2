# Distributor Additive Scheme Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the additive scheme discount model for distributor invoicing so that entering $N$ cartons with $M$ promotional free cartons results in billing for $N$ cartons while shipping $(N + M)$ physical cartons, deducting $(N + M)$ units from inventory, and accurately presenting the transaction across invoice forms, posting services, and printed receipts.

**Architecture:** Update the canonical pricing engine (`invoice-line-pricing.ts`) to treat free cartons additively for distributor carton orders (`dispatched = N + free`, `charged = N`, `net = N * effectiveRate`). Align backend posting (`invoice-posting-service.ts`) to deduct $(N + M)$ cartons from factory stock and account for full COGS. Update print transformers (`invoice-print-dialog.tsx`) to show $(N + M)$ total shipped cartons with $M$ scheme discount.

**Tech Stack:** TypeScript, TanStack Start / React, TanStack Form / Query, Drizzle ORM, PostgreSQL, Vitest.

## Global Constraints
- Distributor invoicing uses `invoiceMode === "distributor"`.
- Free cartons are computed dynamically per distributor and recipe using `getApplicableDistributorFreeCartons`.
- Financial amounts must be rounded to 2 decimal places using `roundMoney`.
- Layout and hash tests in `src/components/sales/invoice-print-layout-regression.test.ts` must pass.
- All commands run via `bun run test` and `bun run typecheck`.

---

### Task 1: Pricing Engine — Update `calculateInvoiceLinePricing` for Additive Model

**Files:**
- Modify: `src/lib/sales/invoice-line-pricing.ts:90-153`
- Test: `src/lib/invoice-form-regressions.test.ts`

**Interfaces:**
- Consumes: `CanonicalInvoiceLinePricingInput` (`invoiceMode`, `unitType`, `numberOfCartons`, `autoFreeCartons`, `manualFreeCartons`, `baseCartonRate`, `containersPerCarton`, `defaultMarginPercent`, `unitCostPerPack`)
- Produces: `InvoiceLinePricingBreakdown` with `chargedCartons = N`, `dispatchedUnits = (N + F) * containersPerCarton`, `grossAmount = (N + F) * baseCartonRate`, `netAmount = N * effectiveCartonRate`, `cogs = dispatchedUnits * unitCostPerPack`

- [ ] **Step 1: Write the failing unit tests for the additive distributor scheme model**

In `src/lib/invoice-form-regressions.test.ts`, add:

```typescript
it("calculates additive distributor scheme pricing (N paid + M free = N+M dispatched)", () => {
  const pricing = calculateInvoiceLinePricing({
    invoiceMode: "distributor",
    unitType: "carton",
    numberOfCartons: 10,
    numberOfUnits: 0,
    manualFreeCartons: 0,
    autoFreeCartons: 1,
    baseCartonRate: 1000,
    containersPerCarton: 24,
    defaultMarginPercent: 8,
    unitCostPerPack: 30,
  });

  expect(pricing.chargedCartons).toBe(10);
  expect(pricing.effectiveCartonRate).toBe(920);
  expect(pricing.dispatchedUnits).toBe(11 * 24); // 264 packs
  expect(pricing.grossAmount).toBe(11000); // 11 * 1000
  expect(pricing.schemeDeduction).toBe(920); // 1 * 920
  expect(pricing.marginDeduction).toBe(880); // 11 * 80
  expect(pricing.netAmount).toBe(9200); // 10 * 920
  expect(pricing.costOfGoodsSold).toBe(7920); // 264 * 30
  expect(pricing.profit).toBe(1280); // 9200 - 7920
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/lib/invoice-form-regressions.test.ts`  
Expected: FAIL due to `chargedCartons` being `9` instead of `10` and `dispatchedUnits` being `240` instead of `264`.

- [ ] **Step 3: Update `calculateInvoiceLinePricing` in `src/lib/sales/invoice-line-pricing.ts`**

Update lines 99-131 of `src/lib/sales/invoice-line-pricing.ts`:

```typescript
  const chargedCartons =
    unitType === "carton"
      ? (invoiceMode === "distributor" ? orderedCartons : Math.max(0, orderedCartons - freeCartonsTotal))
      : 0;
  const chargedUnits =
    unitType === "carton" ? chargedCartons * containersPerCarton : orderedUnits;

  // Additive model for distributor cartons: N entered cartons means N billed cartons + F free cartons dispatched.
  // Warehouse ships (N + F) physical cartons. Customer pays for N cartons.
  const dispatchedCartons =
    unitType === "carton"
      ? (invoiceMode === "distributor" ? orderedCartons + freeCartonsTotal : orderedCartons)
      : 0;
  const dispatchedUnits =
    unitType === "carton"
      ? dispatchedCartons * containersPerCarton
      : orderedUnits;

  const grossCartonsForBilling =
    unitType === "carton"
      ? (invoiceMode === "distributor" ? dispatchedCartons : orderedCartons)
      : 0;

  const grossAmount =
    unitType === "carton"
      ? roundMoney(grossCartonsForBilling * baseCartonRate)
      : roundMoney(orderedUnits * baseUnitRate);
  const postMarginAmount =
    unitType === "carton"
      ? roundMoney(grossCartonsForBilling * effectiveCartonRate)
      : roundMoney(orderedUnits * effectiveUnitRate);
  const marginDeduction = roundMoney(Math.max(0, grossAmount - postMarginAmount));
  const schemeDeduction =
    unitType === "carton" ? roundMoney(freeCartonsTotal * effectiveCartonRate) : 0;
  const netAmount =
    unitType === "carton"
      ? roundMoney(chargedCartons * effectiveCartonRate)
      : roundMoney(orderedUnits * effectiveUnitRate);

  const unitCostPerPack = Math.max(0, Number(input.unitCostPerPack || 0));
  const costOfGoodsSold = roundMoney(dispatchedUnits * unitCostPerPack);
  const profit = roundMoney(netAmount - costOfGoodsSold);
```

- [ ] **Step 4: Update regression tests in `src/lib/invoice-form-regressions.test.ts`**

Update existing regression tests expecting the legacy subtractive model (e.g., lines 331-346) to assert the additive model:
- `calculateLineAmount` for 26 ordered cartons with 2 free cartons at Rs. 2031.36 will be $26 \times 2031.36 = 52815.36$ (charging for 26 cartons, shipping 28 cartons).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test src/lib/invoice-form-regressions.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/invoice-line-pricing.ts src/lib/invoice-form-regressions.test.ts
git commit -m "fix(sales): implement additive distributor scheme calculation in line pricing"
```

---

### Task 2: Backend Posting Service & Stock Deduction

**Files:**
- Modify: `src/server-functions/sales/invoice-posting-service.ts:450-522, 740-790`
- Test: `src/server-functions/sales/invoice-posting-service.test.ts`

**Interfaces:**
- Consumes: `PostInvoiceInput`, `resolveCanonicalInvoiceLine`
- Produces: Correct inventory deduction of $(N + F) \times \text{containersPerCarton}$, line records with `numberOfCartons: N`, `freeCartons: autoFreeCartons`, `discountCartons: manualFreeCartons`, and `cogsTotal = (N + F) * WAC`

- [ ] **Step 1: Verify inventory check and stock deduction in `invoice-posting-service.ts`**

In `resolveCanonicalInvoiceLine`:
Verify `dispatchedUnits` from `pricingBreakdown` (which is $(N + F) \times \text{containersPerCarton}$) is used for:
- `totalDispatchedUnits = pricingBreakdown.dispatchedUnits`
- `deductedUnits = pricingBreakdown.dispatchedUnits`
- `cogsTotal = roundMoney(pricingBreakdown.dispatchedUnits * cogsPerUnit)`

- [ ] **Step 2: Run posting service tests**

Run: `bun run test src/server-functions/sales/invoice-posting-service.test.ts`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server-functions/sales/invoice-posting-service.ts
git commit -m "fix(sales): ensure invoice posting deducts physical dispatched stock including additive scheme cartons"
```

---

### Task 3: Form Live Availability & Item Total Previews

**Files:**
- Modify: `src/components/sales/create-invoice-form/utils.tsx`
- Modify: `src/components/sales/create-invoice-form/invoice-items-section.tsx`
- Modify: `src/components/sales/create-invoice-form.tsx`

**Interfaces:**
- Consumes: `ItemFormValue`, `discountRuleMap`, `selectedCustomerDefaultMargin`
- Produces: Synchronized live reservation of $(N + \text{autoFree} + \text{manualFree})$ cartons and correct preview totals for $N$ billable cartons.

- [ ] **Step 1: Verify `getReservedCartonsForRecipe` in `invoice-items-section.tsx`**

Confirm that `(currentItem.numberOfCartons || 0) + autoFreeCartons + manualFreeCartons` is reserved across rows to ensure $(N + F)$ cartons are checked against physical stock.

- [ ] **Step 2: Verify `lineAmount` and `computeTotal` in `utils.tsx`**

Ensure `lineAmount` accurately calls `getLinePricingBreakdown` and returns $N \times \text{effectiveRate}$ for distributor invoices.

- [ ] **Step 3: Run regression tests**

Run: `bun run test src/lib/invoice-form-regressions.test.ts`  
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sales/create-invoice-form/
git commit -m "fix(sales): align invoice form preview with additive scheme calculations"
```

---

### Task 4: Invoice Print & Preview Data Transformation

**Files:**
- Modify: `src/components/sales/invoice-print-dialog.tsx:180-250`
- Check: `src/components/sales/distributor-invoice.tsx`
- Test: `src/components/sales/invoice-print-layout-regression.test.ts`

**Interfaces:**
- Consumes: `inv` (posted invoice with `items`, `customer`, `expenses`)
- Produces: `DistributorInvoiceData` with `cartonQty` representing total physical cartons ($N + F$), `schemeCarton` representing $F$, `grossAmount = (N + F) * perCartonPrice`, `discount = F * perCartonPrice`, `netAmount = N * perCartonPrice`

- [ ] **Step 1: Update `buildDistributorData` in `src/components/sales/invoice-print-dialog.tsx`**

```typescript
const buildDistributorData = (inv: any): DistributorInvoiceData => {
  const items = (inv.items ?? []).map((item: any, i: number) => {
    const billedCartons = Number(item.numberOfCartons) || 0;
    const discCartons = (Number(item.discountCartons) || 0) + (Number(item.freeCartons) || 0);
    const totalPhysicalCartons = billedCartons + discCartons;
    const packsPerCarton = Number(item.actualPackSize || item.packsPerCarton) || 0;

    const totalPacks = packsPerCarton > 0 ? totalPhysicalCartons * packsPerCarton : 0;
    const cartonQtyLabel = totalPacks > 0
      ? `${totalPhysicalCartons} Cartons (${totalPacks} Packs)`
      : fmtCartonQty(totalPhysicalCartons);

    const schemeTotal = packsPerCarton > 0 ? discCartons * packsPerCarton : 0;
    const schemeLabel = discCartons > 0
      ? (schemeTotal > 0 ? `${discCartons} Cartons (${schemeTotal} Packs)` : fmtCartonQty(discCartons))
      : "0 - 0";

    const grossAmount = totalPhysicalCartons * (Number(item.perCartonPrice) || 0);
    const discountAmount = discCartons * (Number(item.perCartonPrice) || 0);
    const marginPercent =
      Number(item.marginPercent) ||
      Number(inv.customer?.defaultMarginPercent) ||
      (Number(item.margin) < 50 ? Number(item.margin) : 0);
    const marginAmount =
      Number(item.marginDeduction) ||
      (marginPercent > 0 ? (grossAmount * marginPercent) / 100 : 0);

    return {
      serialNo: i + 1,
      itemCode: "",
      itemDescription: item.pack,
      cartonQty: cartonQtyLabel,
      schemeCarton: schemeLabel,
      cartonRate: Number(item.perCartonPrice) || 0,
      margin: marginPercent,
      marginAmount,
      grossAmount,
      discount: discountAmount,
      netAmount: Number(item.amount) || 0,
    };
  });
```

- [ ] **Step 2: Run print layout regression tests**

Run: `bun run test src/components/sales/invoice-print-layout-regression.test.ts`  
Expected: PASS (since `distributor-invoice.tsx` layout code is preserved).

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/invoice-print-dialog.tsx
git commit -m "fix(sales): map total shipped cartons and scheme deductions accurately in print dialog"
```

---

### Task 5: Full Suite Verification & Typecheck

**Files:**
- All modified files

- [ ] **Step 1: Run complete test suite**

Run: `bun run test`  
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`  
Expected: No TypeScript errors (`tsc --noEmit` exits with 0).

- [ ] **Step 3: Update knowledge graph**

Run: `bun run graphify update .` (or `graphify update .` if installed globally)
