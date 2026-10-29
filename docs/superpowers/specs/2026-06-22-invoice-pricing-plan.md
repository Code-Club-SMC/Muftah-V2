# Invoice Pricing Redesign — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-22-invoice-pricing-design.md`
**Date:** 2026-06-22

Build order is calculation-first: lock the shared pricing engine and tests before touching forms or server persistence. Then wire rate resolution by invoice source, then align save/update logic, then update read/print surfaces, and finally tighten naming and regression coverage. The goal is to eliminate pricing drift without introducing a schema migration unless implementation proves it is necessary.

---

## Phase 1 — Canonical Pricing Engine

**Goal:** create one shared invoice-pricing engine that all invoice math depends on.

**Why first:** this is the highest-risk logic. If the engine is right, the UI/server/print work becomes mostly wiring.

### 1.1 Create or refactor shared pricing module

Primary target:

- `src/lib/sales/invoice-line-pricing.ts`

If needed, split supporting helpers into a new module nearby, for example:

- `src/lib/sales/invoice-pricing-engine.ts`

Implement a canonical calculation API that accepts:

- `invoiceMode: "distributor" | "general"`
- `unitType: "carton" | "units"`
- `numberOfCartons`
- `numberOfUnits`
- `containersPerCarton`
- `baseCartonRate`
- `defaultMarginPercent`
- `manualFreeCartons`
- `autoFreeCartons`
- `unitCostPerPack`

It returns:

- `baseCartonRate`
- `effectiveCartonRate`
- `baseUnitRate`
- `effectiveUnitRate`
- `grossAmount`
- `marginDeduction`
- `schemeDeduction`
- `netAmount`
- `freeCartonsTotal`
- `chargedCartons`
- `chargedUnits`
- `dispatchedUnits`
- `costOfGoodsSold`
- `profit`

### 1.2 Lock distributor formula

Implement the approved rules:

- `effective carton rate = base carton rate × (1 - margin%)`
- `gross amount = ordered cartons × base carton rate`
- `scheme deduction = free cartons × effective carton rate`
- `net amount = gross - margin deduction - scheme deduction`

The engine must also support the equivalent reduced calculation:

- `(ordered cartons - free cartons total) × effective carton rate`

### 1.3 Lock general-invoice formula

Implement:

- no customer-margin branch
- `effective carton rate = base carton rate`
- `gross amount = base-priced quantity`
- `net amount = gross amount - scheme deduction`

### 1.4 Preserve compatibility wrappers

Refactor existing exported helpers in:

- `src/lib/sales/invoice-line-pricing.ts`
- `src/components/sales/create-invoice-form/utils.tsx`

so they call the canonical engine instead of keeping independent formulas.

### 1.5 Tests for the engine

Primary test target:

- `src/lib/invoice-form-regressions.test.ts`

Add direct calculation tests for:

- distributor example: `2208`, `8%`, `26 cartons`, buy `12` get `1` => `48,752.64`
- gross, margin deduction, scheme deduction, and net reconciliation
- general invoice where `gross = net` when no free cartons apply
- loose-unit derivation from carton rates
- free-carton COGS and profit impact

### Verification gate (Phase 1)

```bash
bun run test src/lib/invoice-form-regressions.test.ts
bun run typecheck
```

---

## Phase 2 — Rate Source Resolution

**Goal:** ensure each invoice mode pulls the correct `base carton rate` before any calculation happens.

**Why second:** the pricing engine is only useful if the resolved source rate matches the approved business rules.

### 2.1 Distributor rate resolution

Wire distributor invoice rate priority in:

- `src/components/sales/create-invoice-form.tsx`
- `src/components/sales/create-invoice-form/invoice-items-section.tsx`
- `src/server-functions/sales/invoices-fn.ts`

Priority:

1. distributor entity recipe rate
2. global recipe base rate
3. manual entry

### 2.2 General invoice from order conversion

Wire order-conversion rate priority in:

- `src/routes/_protected/sales/new-invoice/index.tsx`
- `src/server-functions/sales/orders-fn.ts`
- `src/components/sales/create-invoice-form.tsx`

Priority:

1. order-booker entity recipe rate
2. existing order line rate
3. global recipe base rate
4. manual entry

### 2.3 Walk-in general invoice

Wire walk-in general invoice default pricing in:

- `src/components/sales/create-invoice-form.tsx`
- `src/components/sales/create-invoice-form/invoice-items-section.tsx`

Priority:

1. global recipe base rate
2. manual entry

### 2.4 Source fallback visibility

In the item grid:

- show which source populated the rate when it matters
- surface fallback from entity rate to global rate so operators know the line is not entity-priced

### 2.5 Regression tests

Extend:

- `src/lib/invoice-form-regressions.test.ts`

to cover:

- distributor entity rate preferred over global rate
- order-booker entity rate preferred for order conversion
- walk-in general invoice uses global recipe base rate

### Verification gate (Phase 2)

```bash
bun run test src/lib/invoice-form-regressions.test.ts
bun run typecheck
```

---

## Phase 3 — Invoice Form Alignment

**Goal:** make the create/edit invoice form display the correct fields and live totals from canonical math.

**Why third:** once rate resolution is correct, the form can become a thin preview of the shared engine.

### 3.1 Update item-grid columns

Edit:

- `src/components/sales/create-invoice-form/invoice-items-section.tsx`

Changes:

- remove `MRP (Ref)` from distributor rows
- align non-distributor rows to the new pricing meaning
- add `Gross Amount`
- rename displayed `Amount` to `Net Amount`

### 3.2 Keep carton rate semantics consistent

The editable field remains:

- `base carton rate`

For distributor lines:

- show derived post-margin effective rate as helper text only

### 3.3 Live totals from canonical engine

Refactor:

- `src/components/sales/create-invoice-form.tsx`
- `src/components/sales/create-invoice-form/utils.tsx`

so:

- line gross/net calculations come from the engine
- form subtotal uses summed net amount
- profit preview uses engine profit outputs, not local approximation

### 3.4 Maintain free-carton UX constraints

Preserve and revalidate current behavior:

- manual free cartons cannot exceed allowable cartons after auto scheme
- auto free cartons remain separate from manual free cartons

### 3.5 Edit-flow compatibility

Ensure existing invoice editing still works:

- old rows render with available stored values
- new rows use canonical semantics immediately

### Verification gate (Phase 3)

```bash
bun run test src/lib/invoice-form-regressions.test.ts
bun run typecheck
```

---

## Phase 4 — Create/Update Invoice Persistence

**Goal:** persist line values with the approved meaning and remove pricing drift from the server path.

**Why fourth:** once preview behavior is correct, the server must write the same numbers so saved invoices match what the operator saw.

### 4.1 Refactor create invoice flow

Edit:

- `src/server-functions/sales/invoices-fn.ts`

Within `createInvoiceFn`:

- resolve source rate using approved priority
- resolve manual and auto free cartons
- call canonical engine
- persist canonical outputs

### 4.2 Refactor update invoice flow

In the same file, repeat the exact same flow for update logic:

- no duplicate local formulas
- shared helper path for create and update where practical

### 4.3 Persist field semantics

Keep existing columns where possible:

- `perCartonPrice` = base carton rate
- `amount` = net amount
- `discountCartons` = manual free cartons
- `freeCartons` = auto free cartons
- `marginPercent` = distributor margin when applicable
- `costOfGoodsSold` = actual COGS of all dispatched units

### 4.4 Profit and ledger totals

Ensure invoice-level totals are based on:

- summed line `net amount`
- summed line `profit`

Maintain current invoice-level discount behavior unless explicitly required otherwise.

### 4.5 Audit/log compatibility

Review `priceChangeLog` writes in:

- `src/server-functions/sales/invoices-fn.ts`

so the logged `oldPrice/newPrice` semantics still make sense after `perCartonPrice` becomes explicitly the base rate.

### Verification gate (Phase 4)

```bash
bun run test src/lib/invoice-form-regressions.test.ts src/lib/sales-workflows.test.ts
bun run typecheck
```

---

## Phase 5 — Invoice Detail and Print Alignment

**Goal:** remove duplicated read/print math and make saved invoices display consistently everywhere.

**Why fifth:** these surfaces currently recompute values independently and are the most likely to drift.

### 5.1 Detail sheet profit and line values

Edit:

- `src/components/sales/invoice-detail-sheet.tsx`

Replace local profit and amount approximations with canonical read-time calculations using stored line fields plus canonical engine helpers.

### 5.2 Distributor print mapping

Edit:

- `src/components/sales/invoice-print-dialog.tsx`
- `src/components/sales/distributor-invoice.tsx`

Map print fields as:

- `Carton Rate` = base carton rate
- `Gross Amount` = quantity at base carton rate
- `Disc.` = margin deduction + scheme deduction
- `Net Amount` = final net amount

### 5.3 General invoice print mapping

Edit:

- `src/components/sales/invoice-print-dialog.tsx`
- `src/components/sales/retailer-invoice.tsx`

Keep the existing printed document identity, but update data mapping so:

- `Rate` = base carton rate
- `Gross Amount` = canonical gross amount
- `Net Ammount` = canonical net amount

### 5.4 Template fidelity to approved image

Use:

- `public/general-invoice.jpeg`

as the exact visual reference for the general-invoice print output. Adjust layout/styling only where needed to match the approved image more closely without changing the template identity.

### Verification gate (Phase 5)

```bash
bun run test src/lib/invoice-form-regressions.test.ts
bun run typecheck
```

---

## Phase 6 — App Wording and Flow Cleanup

**Goal:** rename app-level retailer-invoice wording to general-invoice wording without touching printed template identity.

**Why last:** this is low-risk and should follow the pricing-critical work.

### 6.1 Update app wording

Edit likely files:

- `src/components/sales/create-invoice-sheet.tsx`
- `src/components/sales/invoice-type-badge.tsx`
- `src/components/sales/invoice-print-dialog.tsx`
- `src/routes/_protected/sales/new-invoice/index.tsx`

Change app wording from `Retailer Invoice` to `General Invoice` where it refers to invoice mode, actions, and badges.

### 6.2 Preserve printed naming constraints

Do not rename:

- general-invoice printed heading/template identity
- distributor printed heading/template identity

### Verification gate (Phase 6)

```bash
bun run typecheck
```

---

## Phase 7 — Final Regression Sweep

**Goal:** prove the redesigned pricing flow is stable across form, persistence, and print surfaces.

### 7.1 Expand regression coverage

Primary targets:

- `src/lib/invoice-form-regressions.test.ts`
- `src/lib/sales-workflows.test.ts`

Add assertions for:

- base rate storage semantics
- order-conversion general invoice source priority
- walk-in general invoice source priority
- distributor scheme and margin discount reconciliation
- profit including free-carton COGS
- print-data field mapping for general and distributor sheets

### 7.2 Full verification

```bash
bun run test
bun run typecheck
```

If `bun run test` is too broad because of unrelated failures, run at minimum:

```bash
bun run test src/lib/invoice-form-regressions.test.ts src/lib/sales-workflows.test.ts
```

### 7.3 Graph refresh

After code changes are complete:

```bash
graphify update .
```

---

## File Summary

Expected primary implementation files:

- `src/lib/sales/invoice-line-pricing.ts`
- `src/components/sales/create-invoice-form.tsx`
- `src/components/sales/create-invoice-form/invoice-items-section.tsx`
- `src/components/sales/create-invoice-form/utils.tsx`
- `src/server-functions/sales/invoices-fn.ts`
- `src/server-functions/sales/orders-fn.ts`
- `src/components/sales/invoice-detail-sheet.tsx`
- `src/components/sales/invoice-print-dialog.tsx`
- `src/components/sales/distributor-invoice.tsx`
- `src/components/sales/retailer-invoice.tsx`
- `src/components/sales/create-invoice-sheet.tsx`
- `src/components/sales/invoice-type-badge.tsx`
- `src/routes/_protected/sales/new-invoice/index.tsx`
- `src/lib/invoice-form-regressions.test.ts`
- `src/lib/sales-workflows.test.ts`

---

## Risks to Watch During Implementation

- There are already uncommitted invoice-related changes in the working tree; reconcile carefully instead of overwriting assumptions.
- Existing saved invoices may need read-time fallback logic because earlier rows were persisted with weaker pricing semantics.
- The current code uses `retailer` as the non-distributor customer type in many places; app wording changes must not silently break business logic keyed to that stored enum.
