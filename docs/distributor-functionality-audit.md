# Distributor Functionality Audit

Date: 2026-06-26

## Scope

Audited distributor flow outside self-service modules:

- distributor master data
- distributor profile + credit settings
- distributor pricing
- distributor discount rules
- distributor invoice creation/update
- distributor ledger
- payment/reconciliation/recovery
- distributor invoice print path

## What Works

- Distributor entity exists as first-class customer type with dedicated list/profile/ledger routes.
- Invoice creation captures realized line COGS at dispatch time via `invoiceItems.costOfGoodsSold` and `costOfGoodsSoldPerUnit`, not estimated recipe cost. Good for later profit reporting.
- Credit hold and credit limit checks exist on create and update flows.
- Reconciliation path is much stronger than generic payment path: it updates slip, invoice, customer balance, wallet transaction, and invoice timeline together.
- Ledger running balance correctly ignores `invoice_cash` rows for outstanding-balance math.

## Findings

### 1. Critical: distributor negotiated pricing is client-driven, not server-authoritative

Distributor recipe rates are loaded only in UI and folded into `perCartonPrice` before submit. Server invoice logic does not load `entityRecipeRates`; it trusts submitted line price first, then falls back to global `recipePrices`.

Why this matters:

- stale client state can price invoice wrong
- forged client payload can bypass negotiated distributor rates
- server has no authoritative proof which configured distributor rate should apply

Refs:

- [create-invoice-form.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/create-invoice-form.tsx:419)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:95)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:491)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:1330)

### 2. High: discount-rule engine advertised richer than what invoice engine actually applies

Schema/server claim support for:

- `free_units`
- `discount_cartons`
- `percentage_off`
- `recipeId = null` global/all-items rules

Actual invoice create/update path only:

- groups rules by concrete `recipeId`
- skips global rules
- computes only `free_units` via `getApplicableRuleFreeCartons`
- ignores `discount_cartons` and `percentage_off`

Config UI also only creates `free_units` rules.

Refs:

- [discount-rules-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/discount-rules-fn.ts:18)
- [discount-rules-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/discount-rules-fn.ts:192)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:513)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:567)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:1351)
- [routes/_protected/sales/configurations/index.tsx](/home/abdul-rehman/Projects/titan-new/src/routes/_protected/sales/configurations/index.tsx:204)

### 3. High: inactive discount rules still apply during invoice creation/update

`getDiscountRulesFn` and `getApplicableDiscountFn` respect `isActive`. Invoice create/update queries do not check `isActive` at all. Any date-valid inactive distributor rule still affects billing.

Refs:

- [discount-rules-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/discount-rules-fn.ts:162)
- [discount-rules-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/discount-rules-fn.ts:204)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:492)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:1331)

### 4. High: generic payment flow for distributors is broken, and even if forced through it bypasses slip/invoice reconciliation

`RecordPaymentDialog` never collects `invoiceId`, but schema requires it. So submit path should fail validation. Worse: `createPaymentFn` only inserts payment, updates customer aggregate, updates wallet. It does not update invoice credit/cash, slip amount due, recovery state, or timeline.

Net: distributor payment source-of-truth is reconciliation, not generic payment dialog.

Refs:

- [record-payment-dialog.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/record-payment-dialog.tsx:39)
- [zod_schemas.ts](/home/abdul-rehman/Projects/titan-new/src/db/zod_schemas.ts:91)
- [payments-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/payments-fn.ts:16)
- [reconciliation-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/reconciliation-fn.ts:137)

### 5. Medium: distributor profile mixes computed profit with denormalized sales/payment/credit totals

Profile fetch returns raw customer row for `totalSale`, `payment`, `credit`, then separately computes `lifetimeProfit` from invoice items. If aggregate columns drift from transactional truth, profile and ledger can disagree.

Refs:

- [sales-config-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/sales-config-fn.ts:183)
- [routes/_protected/sales/people/distributors/$customerId/index.tsx](/home/abdul-rehman/Projects/titan-new/src/routes/_protected/sales/people/distributors/$customerId/index.tsx:29)

### 6. Medium: distributor invoice preview math can disagree with server when multiple rules exist for same recipe

UI caches one rule per recipe in a `Map`, overwriting earlier rules. Server keeps array per recipe and picks highest-threshold applicable rule. Result: preview totals, profit preview, free-carton display, and stock reservation hints can differ from saved invoice.

Refs:

- [create-invoice-form.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/create-invoice-form.tsx:508)
- [create-invoice-form.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/create-invoice-form.tsx:822)
- [invoice-items-section.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/create-invoice-form/invoice-items-section.tsx:44)
- [invoices-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoices-fn.ts:513)

### 7. Medium: invoice print preview path has response-shape bug, so distributor print template is not reliable

`getInvoiceDetailFn` returns `{ invoice, payments, slip, returns, timeline }`. Print dialog stores whole response as `invoice`, then reads `invoice.customer` and passes whole wrapper object into `buildDistributorData`. That shape does not match.

Refs:

- [invoice-print-dialog.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/invoice-print-dialog.tsx:61)
- [invoice-detail-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/invoice-detail-fn.ts:22)

### 8. Low: distributor master-data create/update path has weak normalization

Numeric/optional fields are accepted as plain strings and written directly. Empty-string or malformed numeric input handling is weak, especially on update where payload is passed straight into `.set(updates)`.

Refs:

- [create-distributor-dialog.tsx](/home/abdul-rehman/Projects/titan-new/src/components/sales/create-distributor-dialog.tsx:25)
- [customers-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/customers-fn.ts:21)
- [customers-fn.ts](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/customers-fn.ts:306)

## Functional Map

### Master data

- list: `/sales/people` distributor tab
- create: `CreateDistributorDialog`
- profile: `/sales/people/distributors/$customerId`
- fields: `defaultMargin`, `creditLimit`, `creditHold`

### Pricing stack today

- client overlay order:
  - distributor recipe rate
  - else global recipe price
- server order:
  - submitted `item.perCartonPrice`
  - else global recipe price
- default margin applied server-side after base carton rate resolution

### Sales + receivables stack

- invoice create/update writes:
  - invoice
  - slip record
  - `invoice_cash` payment row for upfront cash
  - customer aggregate totals
  - wallet transaction
  - invoice timeline
  - invoice item COGS snapshots
- recovery/reconciliation manages post-invoice collections
- ledger view reads invoices + payments + slips chronologically

## Recommended Fix Order

1. Make distributor pricing server-authoritative by resolving `entityRecipeRates` inside invoice create/update.
2. Remove or rework generic payment dialog; force distributor recoveries through slip reconciliation.
3. Unify discount-rule capability:
   - either truly support all rule types in invoice engine
   - or shrink schema/UI/docs to only supported behavior
4. Add `isActive = true` filter to invoice rule fetches.
5. Rebuild distributor profile KPIs from transactional truth or add reconciliation checks against aggregates.
6. Fix print-dialog response handling.
7. Normalize numeric customer fields on create/update.

## Bottom Line

Core distributor architecture is viable. Strongest pieces are WAC-backed invoice COGS capture, credit-limit enforcement, and reconciliation pipeline. Weakest pieces are server trust in client pricing, split payment source-of-truth, and discount-rule capability drift.
