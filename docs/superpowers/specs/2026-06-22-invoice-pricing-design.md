# Invoice Pricing Redesign — Design Spec

**Date:** 2026-06-22
**Status:** Approved (Sections 1–3)
**Context:** Existing live invoice flow with in-progress entity recipe-rate work already in the tree. This design constrains the implementation so pricing, profit, and print outputs all resolve from one shared calculation path.

---

## 1. Overview

The invoice side now has two pricing sources:

- `entity recipe rates` for distributors and order bookers
- existing global recipe pricing from sales config

The current issue is not missing data; it is inconsistent interpretation. Different parts of the app currently treat carton rate as cost, sell price, or post-margin price depending on where the calculation happens. That creates drift between:

- invoice form preview
- saved invoice item amounts
- profit calculation
- distributor/general print sheets

This redesign introduces one canonical invoice pricing engine and routes every invoice surface through it.

### Scope in

- Shared line-pricing engine for distributor and general invoices
- Distributor recipe-rate resolution
- Order-booker recipe-rate resolution for order conversion
- Walk-in general-invoice pricing from global recipe base rate
- Invoice form column changes and calculation changes
- Server-side create/update invoice math alignment
- Profit recalculation alignment
- General invoice print template parity with `public/general-invoice.jpeg`
- App-level rename from `Retailer Invoice` to `General Invoice` where approved

### Scope out

- No redesign of the printed distributor template heading
- No rename of the printed general-invoice document heading/template identity
- No unrelated customer-type refactor
- No schema migration unless implementation proves one is strictly required

---

## 2. Locked Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Use one shared pricing engine | Prevent UI/server/print/profit drift |
| D2 | `Recipe Rates` value is always the `base carton rate` | User-approved |
| D3 | Distributor invoices apply `defaultMargin %` to the base carton rate | User-approved |
| D4 | General invoices never apply retailer/customer margin | User-approved |
| D5 | Order-converted general invoices use `order booker` recipe rates as base carton rate | User-approved |
| D6 | Walk-in general invoices use the `global recipe base rate` from sales config | User-approved |
| D7 | General-invoice print template must match `public/general-invoice.jpeg` visually | User-approved |
| D8 | Do not rename the printed template/document heading | User-approved |
| D9 | Rename `Retailer Invoice` to `General Invoice` only in app flow wording | User-approved |

---

## 3. Pricing Model

### 3.1 Canonical terms

- `base carton rate`: pre-margin carton selling rate selected from recipe pricing configuration
- `effective carton rate`: rate actually charged per paid carton after distributor margin logic
- `gross amount`: quantity priced at base carton rate before margin reduction and before scheme deduction
- `scheme cartons`: free cartons coming from manual free cartons and/or auto discount rules
- `net amount`: final revenue after margin reduction and free-carton deduction
- `COGS`: actual cost of all dispatched units, including free cartons
- `profit`: `net amount - COGS`

### 3.2 Rate source priority

#### Distributor invoice

1. Distributor entity recipe rate (`entityType = distributor`)
2. Global recipe base rate from sales config
3. Manual entry only if neither source exists

#### General invoice from order conversion

1. Order-booker entity recipe rate (`entityType = order_booker`) for the order’s order booker
2. Existing order line rate
3. Global recipe base rate from sales config
4. Manual entry only if none exist

#### Walk-in general invoice

1. Global recipe base rate from sales config
2. Manual entry only if no global recipe base rate exists

### 3.3 Global recipe base rate definition

The existing global sales-config recipe price remains the default general-invoice base source:

- `global base carton rate = invoicePricePerPack × containersPerCarton`

This is the default for walk-in general invoices and the fallback for missing entity-specific rates.

### 3.4 Distributor formula

For distributor carton lines:

- `effective carton rate = round(base carton rate × (1 - defaultMargin / 100), 2)`
- `gross amount = round(ordered cartons × base carton rate, 2)`
- `scheme deduction = round((manual free cartons + auto free cartons) × effective carton rate, 2)`
- `margin deduction = round(ordered cartons × (base carton rate - effective carton rate), 2)`
- `net amount = round(gross amount - margin deduction - scheme deduction, 2)`

Equivalent reduced form:

- `net amount = round((ordered cartons - free cartons total) × effective carton rate, 2)`

Both forms must reconcile exactly.

#### Locked acceptance example

Given:

- base carton rate = `2208`
- default margin = `8%`
- ordered cartons = `26`
- discount rule = buy `12` get `1`

Then:

- effective carton rate = `2031.36`
- gross amount = `57,408.00`
- post-margin gross = `52,815.36`
- free cartons = `2`
- free-carton deduction = `4,062.72`
- net amount = `48,752.64`

The system must calculate this to 2-decimal precision. Any UI that displays rounded whole numbers must still be backed by these exact stored/calculated values.

### 3.5 General invoice formula

For general invoices:

- no customer-margin branch exists
- `effective carton rate = base carton rate`
- `gross amount = quantity priced at base carton rate`
- `net amount = gross amount - scheme deduction`

If no free-carton rule applies, `net amount = gross amount`.

### 3.6 Units / loose packs

Loose-unit lines still use carton-derived pricing:

- `base unit rate = base carton rate / containersPerCarton`
- distributor effective unit rate is derived from effective carton rate
- general-invoice unit rate is derived directly from base carton rate

Free-carton rules only affect carton-mode lines.

### 3.7 Manual overrides

If a user edits the carton rate manually:

- the edited value is still interpreted as the `base carton rate`
- distributor margin still applies on top of that base unless the implementation explicitly introduces a separate “final rate override” control, which is out of scope for this change
- `isPriceOverride` remains the indicator that the configured source rate was manually replaced

---

## 4. Shared Pricing Engine

Create one shared pricing module that accepts:

- invoice mode: `distributor | general`
- quantity mode: `carton | units`
- ordered cartons / ordered units
- containers per carton
- base carton rate
- distributor default margin percent
- manual free cartons
- auto free cartons
- actual unit cost for COGS

It returns:

- `baseCartonRate`
- `effectiveCartonRate`
- `baseUnitRate`
- `effectiveUnitRate`
- `grossAmount`
- `marginDeduction`
- `schemeDeduction`
- `netAmount`
- `chargedCartons`
- `chargedUnits`
- `dispatchedUnits`
- `freeCartonsTotal`
- `costOfGoodsSold`
- `profit`

### Non-negotiable rule

The following surfaces must all depend on this shared engine instead of redoing math locally:

- create invoice form
- edit invoice form
- create invoice server function
- update invoice server function
- invoice detail sheet totals
- distributor print data builder
- general print data builder

---

## 5. Form Behavior

### 5.1 Column changes

In `src/components/sales/create-invoice-form` and its item section:

- remove `MRP (Ref)` from distributor rows
- add `Gross Amount`
- rename existing `Amount` display to `Net Amount`

The visible pricing columns become:

- `Carton Rate`
- `Gross Amount`
- `Net Amount`

For general invoices, the column set should align to the same meaning even if the internal component stays shared.

### 5.2 Rate auto-population

- Distributor invoice lines auto-populate base carton rate from distributor recipe rates
- General invoice lines from order conversion auto-populate base carton rate from order-booker recipe rates
- Walk-in general invoice lines auto-populate base carton rate from global recipe pricing

### 5.3 UX notes

- Distributor rows should show a small helper note with the derived post-margin effective rate
- The editable rate field itself remains the base carton rate
- Missing configured rates should surface a visible fallback hint so operators know when the system fell back from entity pricing to global pricing

### 5.4 Walk-in flow

Walk-in factory customers use the normal general-invoice flow:

- operator may select an existing customer, or
- operator may create a new customer inline

Pricing for walk-ins does not depend on any order booker. It uses the global recipe base rate directly.

---

## 6. Server-Side Persistence Rules

The implementation should reuse existing invoice-item fields where possible.

### 6.1 Stored field semantics

- `perCartonPrice` stores the `base carton rate`
- `amount` stores the final `net amount`
- `discountCartons` stores manual free cartons
- `freeCartons` stores auto free cartons
- `marginPercent` stores the applied distributor margin percent, or `null/0` for general invoices
- `costOfGoodsSold` stores real dispatched-unit COGS including free cartons
- `costOfGoodsSoldPerUnit` stores the actual cost per dispatched unit

### 6.2 No local math forks

Both create and update invoice server functions must:

1. resolve source rate
2. resolve free-carton rule
3. call the shared pricing engine
4. persist values from that engine
5. use the same engine outputs for invoice totals and profit

### 6.3 Ledger-facing totals

- invoice-level revenue totals must be based on summed `net amount`
- invoice-level profit must be based on summed line `profit`
- free cartons reduce revenue but still consume stock and COGS

---

## 7. Profit Rules

### 7.1 Line profit

For every invoice type:

- `line profit = net amount - cost of goods sold`

### 7.2 COGS scope

COGS must include all dispatched units:

- paid cartons
- free cartons
- loose units

This is essential for distributor accuracy. Scheme cartons are free to the customer, not free to inventory.

### 7.3 Invoice profit

- `invoice profit = sum(line profit) - invoice-level discount`

The current retailer-only invoice discount rule remains intact unless separately changed later. This redesign does not add a new general-invoice-wide discount concept.

---

## 8. General Invoice Template Requirements

The general-invoice print output must visually match:

- `public/general-invoice.jpeg`

### 8.1 Locked layout

Keep the same visible structure:

- top yellow banner with company branding
- customer detail strip and fields
- item table
- right-side summary box
- amount-in-words row
- customer/account signature area
- footer banner

### 8.2 Locked columns

The printed general-invoice item table must use:

- `S. NO`
- `Product Name`
- `HSN Code`
- `GST Rate`
- `Rate`
- `Qty`
- `Gross Amount`
- `Net Ammount`

The spelling `Net Ammount` remains as shown in the approved template image unless the user later requests a template-text correction.

For general invoices:

- `Rate` shows the base carton rate
- because general invoices do not apply customer margin, this is also the effective charged carton rate
- `Gross Amount` and `Net Ammount` must come from canonical pricing math

### 8.3 Template naming constraint

- do not rename the printed template/document heading
- do not change the visual identity of the general-invoice document

Only the populated pricing values should change.

### 8.4 Precision vs. template fidelity

The layout must match the provided image exactly in structure and styling direction, but the underlying numbers must still come from the canonical engine at 2-decimal precision.

### 8.5 Distributor print mapping

The distributor print sheet keeps its current visible column structure, but its values must resolve as:

- `Carton Rate` = base carton rate
- `Gross Amount` = quantity at base carton rate
- `Disc.` = margin deduction + scheme deduction
- `Net Amount` = final net amount

---

## 9. App-Level Naming

In the application flow, non-distributor invoice wording should move from `Retailer Invoice` to `General Invoice` where that wording refers to the invoice mode/template selection, for example:

- create sheet title
- action buttons
- template selector wording
- invoice-mode badges where they currently expose `Retailer Invoice`

This does not require changing the printed template heading.

---

## 10. Testing and Verification

Implementation is not complete unless the following are covered by tests.

### 10.1 Pricing engine tests

- distributor example with `2208`, `8%`, `26 cartons`, `buy 12 get 1` returns `48,752.64`
- distributor gross, margin deduction, scheme deduction, and net reconcile exactly
- general invoice without free cartons yields `gross = net`
- loose-unit pricing derives correctly from carton rates

### 10.2 Source-resolution tests

- distributor invoice prefers distributor entity recipe rate
- order conversion general invoice prefers order-booker entity recipe rate
- walk-in general invoice uses global recipe base rate
- fallback order behaves correctly when higher-priority sources are missing

### 10.3 Persistence tests

- `perCartonPrice` persists base carton rate
- `amount` persists net amount
- `marginPercent` persists distributor margin only when applicable
- free-carton quantities persist correctly

### 10.4 Profit tests

- free cartons still increase COGS exposure and reduce profit
- invoice profit equals sum of line profit minus invoice-level discount

### 10.5 Print-data tests

- general invoice print data builder emits `grossAmount` and `netAmount` using canonical math
- distributor print data builder emits correct gross, scheme discount, and net values
- general invoice print output keeps the approved column set and layout mapping

---

## 11. Implementation Notes

- Prefer introducing the shared engine in `src/lib/sales/` near the existing invoice pricing helpers
- Existing helper functions may wrap the canonical engine, but must not keep independent formulas
- The implementation should preserve compatibility with existing invoice rows as far as possible by computing missing derived values from stored fields

---

## 12. Open Risks

- Existing in-progress invoice edits in the working tree may already partially change semantics of `perCartonPrice`; implementation must reconcile rather than overwrite blindly
- Legacy saved invoices may not have enough historical context to reproduce every derived intermediate value perfectly, so the implementation should keep fallback compatibility logic for read/print paths
- App-level rename to `General Invoice` must be limited carefully so it does not unintentionally alter customer-type vocabulary elsewhere in the sales module
