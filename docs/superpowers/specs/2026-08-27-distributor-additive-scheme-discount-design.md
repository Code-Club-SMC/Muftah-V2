# Design Document: Distributor Additive Scheme Discount Model

**Date:** 2026-08-27  
**Status:** Approved  
**Topic:** Distributor Invoicing Scheme & Free Carton Calculation Model

---

## 1. Problem & Context

In the previous implementation, when a distributor qualified for a promotional discount rule (e.g. "Buy 10 cartons, get 1 free"), the system used a **subtractive billing discount model**:
- Entering `10` cartons caused the system to bill for `9` cartons and ship `10` physical cartons ($10 - 1 = 9$ charged, $10$ dispatched).

In distributor trade (FMCG distribution in Pakistan), the expected industry behavior is the **additive scheme model**:
- Entering `N` cartons means the distributor is purchasing `N` billed cartons and receives `M` promotional bonus cartons for free ($N$ paid $+ M$ free $= N + M$ dispatched).

---

## 2. Business Rules & Mathematical Specification

### 2.1. Dynamic Scheme Rule Resolution
For any specific product (recipe) and distributor, the active discount rule defines:
- `quantityThreshold` ($T$): Minimum cartons required to trigger the rule.
- `freeUnits` ($U$): Number of free bonus cartons awarded per threshold interval.

$$\text{Auto Free Cartons } (M) = \left\lfloor \frac{\text{Entered Cartons } (N)}{T} \right\rfloor \times U$$

Total Free Cartons ($F$) includes any manual free cartons ($M_{\text{manual}}$):
$$F = M + M_{\text{manual}}$$

### 2.2. Quantities & Inventory Dispatch
* **Billed / Charged Cartons**: $N$ (the quantity entered by the sales operator).
* **Dispatched Physical Cartons**: $N + F$.
* **Dispatched Units (Packs)**: $(N + F) \times \text{Packs Per Carton}$.
* **Charged Units (Packs)**: $N \times \text{Packs Per Carton}$.

### 2.3. Rates & Financials
* **Base Carton Rate** ($R_{\text{base}}$): Configured carton trade rate.
* **Margin Factor**: $1 - \frac{\text{Margin \%}}{100}$.
* **Effective Carton Rate** ($R_{\text{eff}}$): $\text{roundMoney}(R_{\text{base}} \times \text{Margin Factor})$.
* **Gross Amount**: $(N + F) \times R_{\text{base}}$.
* **Margin Deduction**: $\text{Gross Amount} - ((N + F) \times R_{\text{eff}})$.
* **Scheme Discount Deduction**: $F \times R_{\text{eff}}$.
* **Net Payable Amount**: $N \times R_{\text{eff}}$.
* **Cost of Goods Sold (COGS)**: $(N + F) \times \text{Packs Per Carton} \times \text{WAC per Pack}$.
* **Invoice Profit**: $\text{Net Payable Amount} - \text{COGS}$.

---

## 3. Concrete Example Walkthrough

### Scenario:
* **Distributor Rule**: Buy 10, Get 1 Free ($T = 10, U = 1$).
* **Distributor Margin**: 8%.
* **Base Carton Rate**: Rs. 1,000.
* **Effective Carton Rate**: Rs. 920 ($1,000 \times 0.92$).
* **Packs Per Carton**: 24.
* **Unit Cost per Pack (WAC)**: Rs. 30 (Carton cost = Rs. 720).
* **Entered Quantity**: 20 Cartons.

### Results:
1. **Free Cartons**: $\lfloor 20 / 10 \rfloor \times 1 = 2\text{ free cartons}$.
2. **Quantities**:
   * Total Shipped: $20 + 2 = 22\text{ cartons}$ ($528\text{ packs}$).
   * Billed: $20\text{ cartons}$ ($480\text{ packs}$).
3. **Financials**:
   * Gross Amount: $22 \times \text{Rs. } 1,000 = \text{Rs. } 22,000$.
   * Margin Deduction: $22 \times \text{Rs. } 80 = \text{Rs. } 1,760$.
   * Scheme Discount: $2 \times \text{Rs. } 920 = \text{Rs. } 1,840$.
   * Net Payable: $20 \times \text{Rs. } 920 = \text{Rs. } 18,400$.
   * COGS: $22 \times \text{Rs. } 720 = \text{Rs. } 15,840$.
   * Profit: $\text{Rs. } 18,400 - \text{Rs. } 15,840 = \text{Rs. } 2,560$.
4. **Invoice Printout**:
   * Carton Qty: `22 Cartons (528 Packs)`
   * Scheme Carton: `2 Cartons (48 Packs)`
   * Total Order Cartons: `22 - 0`
   * Total Scheme Cartons: `2 - 0`
   * Net Cartons: `20 - 0`
   * Net Amount: Rs. 18,400.00

---

## 4. Architectural Components & Changes

### 4.1. Calculation Engine: `src/lib/sales/invoice-line-pricing.ts`
* Update `calculateInvoiceLinePricing` for `invoiceMode === "distributor"`:
  * `orderedCartons`: Entered count $N$.
  * `chargedCartons`: $N$.
  * `dispatchedCartons`: $N + \text{freeCartonsTotal}$.
  * `dispatchedUnits`: $(N + \text{freeCartonsTotal}) \times \text{containersPerCarton}$.
  * `grossAmount`: $(N + \text{freeCartonsTotal}) \times \text{baseCartonRate}$.
  * `schemeDeduction`: $\text{freeCartonsTotal} \times \text{effectiveCartonRate}$.
  * `netAmount`: $N \times \text{effectiveCartonRate}$.
  * `costOfGoodsSold`: $\text{dispatchedUnits} \times \text{unitCostPerPack}$.

### 4.2. Posting & Stock Validation: `src/server-functions/sales/invoice-posting-service.ts`
* Update stock check and deduction:
  * Ensure physical stock availability checks $\ge (N + F)$ cartons.
  * Deduct $(N + F) \times \text{containersPerCarton}$ from finished goods inventory.
  * Record `numberOfCartons = N`, `freeCartons = M`, `discountCartons = M_manual`, and `amount = Net`.

### 4.3. Form & Live Availability: `src/components/sales/create-invoice-form/`
* `invoice-items-section.tsx` & `utils.tsx`:
  * Ensure live stock reservation includes $N + \text{autoFree} + \text{manualFree}$.
  * Ensure line total preview accurately displays the Net for $N$ cartons while showing the $+M\text{ scheme}$ bonus indicator.

### 4.4. Print & Export Transformation: `src/components/sales/invoice-print-dialog.tsx` & `distributor-invoice.tsx`
* Update `buildDistributorData`:
  * Map `cartonQty` to $(N + F)\text{ Cartons}$ (Total physical shipped).
  * Map `schemeCarton` to $F\text{ Cartons}$.
  * `grossAmount`: $(N + F) \times \text{perCartonPrice}$.
  * `discount`: $F \times \text{perCartonPrice}$.
  * `netAmount`: $N \times \text{perCartonPrice (post-margin)}$.
* In `distributor-invoice.tsx`:
  * Bottom summary: `Total Order Cartons: (N+F) - 0`, `Total Scheme Cartons: F - 0`, `Net Cartons: N - 0`.

---

## 5. Verification Plan

1. **Automated Unit & Regression Tests**:
   * Update regression assertions in `src/lib/invoice-form-regressions.test.ts` to assert the additive model ($N$ paid $+ M$ free $= N + M$ dispatched, net $= N \times \text{rate}$).
   * Run `bun test` across the test suite.
2. **Typecheck & Integrity Checks**:
   * Run `bun run typecheck` to verify no type mismatches.
   * Verify print hash regression test in `src/components/sales/invoice-print-layout-regression.test.ts` (update hash if `distributor-invoice.tsx` markup is touched).
