# Invoice Settlement Redesign

**Date:** 2026-08-10

**Status:** Approved design; implementation not started

**Scope:** Online invoice settlement foundation required by normal, booked-order, recovery, and future offline invoices

## 1. Purpose

Titan ERP currently models invoice settlement with one `cash` amount and one `credit` amount. The invoice form can deposit the paid amount into a cash or bank wallet, but the server records every initial payment as `invoice_cash`. Initial bank transfers, cheques, mixed payment methods, and pending payment instruments are therefore not represented accurately.

This redesign replaces that model with method-specific payment rows while keeping invoice totals easy for operators to understand:

- **Paid Amount:** total of confirmed payments
- **Outstanding Amount:** invoice total minus confirmed payments

The same settlement service will later be used by offline Excel invoice import. Offline code must not implement separate payment arithmetic.

## 2. Locked business decisions

- Replace user-facing `Cash` with `Paid Amount`.
- Replace user-facing `Credit` with `Outstanding Amount`.
- Replace user-facing `Credit Return Date` with `Payment Due Date`.
- Support cash, bank transfer, cheque, and pay-later settlement.
- Support multiple payment methods on one invoice.
- Cash confirms immediately.
- Bank transfer starts pending and requires finance confirmation.
- Cheque starts pending and requires clearance.
- A cheque the bank does not clear is displayed as **Cheque Returned**. Help text says, “Bank did not clear this cheque.”
- Pending payments remain included in Outstanding Amount until confirmed.
- Do not add mobile-wallet payments.
- No production/backward-compatibility layer is required. Implementation may cleanly rename or replace development-only schema and call sites.
- Existing distributor and retailer/general invoice print layouts must not change.
- Existing signature and stamp areas must remain exactly as they are. No signature area may be added where none currently exists.

## 3. Out of scope

- JazzCash, Easypaisa, or other mobile-wallet payments
- Payment-provider API integration or automatic bank verification
- FBR or tax-system integration
- Changes to product pricing, invoice item calculations, or print layout
- Long-lived backward-compatibility fields, aliases, or dual-write behavior for old settlement names
- Local factory server, backup internet, or browser/PWA offline mode

## 4. Terminology and equations

For every invoice:

```text
paidAmount = sum(confirmed payment amounts)
outstandingAmount = totalPrice - paidAmount
pendingAmount = sum(pending bank-transfer and cheque amounts)
payLaterAmount = outstandingAmount - pendingAmount
```

`pendingAmount` is a visible explanation of part of the outstanding balance. It is not subtracted twice.
`payLaterAmount` is the part for which no cash, bank transfer, or cheque has been recorded.

Example:

```text
Invoice Total:       PKR 100,000
Paid Amount:         PKR 50,000
Outstanding Amount:  PKR 50,000
Pending Cheque:      PKR 10,000
```

After the cheque clears:

```text
Paid Amount:         PKR 60,000
Outstanding Amount:  PKR 40,000
```

All money arithmetic uses one shared two-decimal rounding helper. Floating-point values must never be persisted without deterministic rounding.

## 5. Chosen architecture

### 5.1 Approaches considered

1. **Payment rows — chosen.** One row per method and amount. Best for mixed payments, audit history, method reports, and later offline import.
2. Separate `cash_amount`, `bank_amount`, and `cheque_amount` columns on invoices. Simpler initially, but every new method changes schema and report logic.
3. JSON payment data stored on invoices. Flexible, but weak for constraints, joins, filtering, wallet posting, and audit.

### 5.2 Invoice aggregate fields

Replace the settlement-facing invoice fields with:

- `paidAmount`: confirmed payment total, non-negative
- `outstandingAmount`: current amount not yet confirmed as paid, non-negative
- `paymentDueDate`: required when a true pay-later balance exists
- `paymentStatus`: `unpaid | partially_paid | paid`

The existing invoice lifecycle `status` remains responsible for invoice lifecycle such as saved or voided. Payment status must no longer be mixed with invoice lifecycle.

Required invariant:

```text
paidAmount + outstandingAmount = totalPrice
pendingAmount <= outstandingAmount
sum(confirmed and pending payment amounts) <= totalPrice
```

Pending payment presence is derived from payment rows and displayed as a badge/summary. It does not require another invoice lifecycle status.

### 5.3 Payment row fields

Extend the existing `payments` responsibility so every initial or later payment records:

- `id`
- `invoiceId`
- `customerId`
- `method`: `cash | bank_transfer | cheque | expense_offset`
- `status`: `pending | confirmed | returned | cancelled | reversed`
- `amount`
- `walletId`, required before cash, bank transfer, or cheque can be confirmed
- `reference`, required for bank transfer
- `chequeNumber`, `chequeBank`, and `chequeDate`, required for cheque
- `paymentDate`: business time when payment/instrument was received
- `effectiveDate`: nullable until confirmed; business date on which money/offset takes accounting effect
- `source`: `invoice_creation | recovery | offline_import | adjustment`
- `recordedById` and `createdAt`
- `confirmedById` and `confirmedAt` when confirmed
- `resolvedById`, `resolvedAt`, and `resolutionReason` for returned, cancelled, or reversed payments
- offline/import identity when the source is offline import

Cash rows are inserted as `confirmed`. Bank transfers and cheques are inserted as `pending`.

`expense_offset` remains an internal confirmed recovery method, not an option on invoice-creation form. It reduces amount owed but creates no wallet movement.

### 5.4 Wallet transactions

A wallet transaction is created only when cash, bank transfer, or cheque becomes confirmed:

- cash: during invoice/payment creation
- bank transfer: during finance confirmation
- cheque: when finance marks it cleared

Pending, returned, cancelled, or reversed payment instruments cannot increase wallet balance.

A reversal creates an opposite wallet transaction and an audit event. Confirmed payment rows are never silently rewritten.

### 5.5 Database constraints and numbering foundation

The invoice table also gains the fields needed to separate public identity from its internal serial:

- `invoiceNumber`: required and unique; this is the number shown to the customer
- `source`: `online | offline_import`
- `paidAmount`, `outstandingAmount`, `paymentDueDate`, and `paymentStatus` as defined above

An `invoice_number_counters` table owns separate `online` and `offline` counters. Allocation locks and increments only required counter inside transaction. Online direct invoices and online booked-order invoices both use `INV-...`; offline imports never consume online counter. A failed online transaction rolls back counter increment. Internal `sNo` remains an implementation detail and must not construct customer-facing numbers after this change.

Customer cached fields use clear names: `totalPaidAmount` for confirmed lifetime settlement and `outstandingAmount` for current amount owed after confirmed payments, posted returns, and authorized adjustments. Slip cached fields similarly expose invoice amount, Paid Amount, and Outstanding Amount. Payment rows and posted sales/return records remain source of truth; cached values are recalculated in same transaction.

Database checks enforce non-negative invoice/payment amounts, valid status/method values, and required uniqueness. Indexes cover invoice number, invoice source/date, payment invoice/status/date, cheque number/bank, and import identity. Application validation still supplies clearer messages, but the database remains the final safety boundary.

Implementation uses a generated Drizzle migration. No database reset is authorized. Existing development rows may be migrated to the new shape, but no long-lived compatibility fields or dual-write path are required.

## 6. Shared settlement service

Create a focused server-side settlement module. It owns all payment state changes and invoice aggregate recalculation.

Required operations:

- calculate and validate a proposed settlement
- create initial payment rows during invoice creation
- record later recovery payments
- confirm a pending bank transfer
- clear a pending cheque
- mark a cheque returned
- cancel an unconfirmed payment
- reverse a confirmed payment through an explicit reversal
- recompute invoice Paid Amount, Outstanding Amount, payment status, slip totals, customer totals, and wallet entries

No server function may directly mutate `paidAmount`, `outstandingAmount`, customer payment totals, slip recovered totals, or wallet balance outside this service.

Each operation runs in one PostgreSQL transaction and conditionally changes the current payment state. For example, a pending payment confirmation updates only a row still in `pending`. Two simultaneous confirmations cannot both succeed.

## 7. Invoice creation flow

### 7.1 Form contract

Replace the single Cash Received input with repeatable payment rows.

Each row contains:

- method
- amount
- destination account
- method-specific details

Method-specific requirements:

| Method | Starts as | Required fields |
|---|---|---|
| Cash | Confirmed | cash wallet/account |
| Bank transfer | Pending | bank wallet/account, transaction reference |
| Cheque | Pending | bank wallet/account, bank name, cheque number, cheque date |

The form displays live values for Invoice Total, Paid Amount, Pending Payments, and Outstanding Amount.

### 7.2 Validation

- Every payment amount must be greater than zero.
- Combined payment rows cannot exceed invoice total.
- Payment method and selected wallet type must agree.
- Required method details cannot be blank.
- Exact duplicate local rows are blocked before submit.
- Payment Due Date is required when an amount remains payable later beyond pending instruments.
- Confirmed plus pending payments cannot exceed invoice total. A new recovery cannot consume money already represented by a pending cheque or transfer.
- Submit is disabled during mutation to prevent double submission.
- Failed submissions retain all entered form data and focus the first invalid field.

### 7.3 Atomic posting

Invoice header, invoice items, stock deduction, order fulfillment, commission, payment rows, confirmed wallet movements, customer aggregates, slip/recovery data, and audit timeline commit together. Any failure rolls back the whole invoice.

Normal invoices and booked-order invoices use this same path. Booked-order linking and commission behavior remain unchanged except that payment arithmetic comes from the settlement service.

## 8. Payment lifecycle

### Cash

`confirmed` immediately. Wallet and Paid Amount update in the invoice transaction.
`effectiveDate` equals `paymentDate`.

### Bank transfer

`pending` after entry. Finance verifies bank receipt and verified bank-posting date, then changes it to `confirmed`. That posting date becomes `effectiveDate`. Confirmation credits chosen bank wallet and recalculates invoice/customer/slip totals. A transfer that cannot be verified becomes `cancelled` with a reason; Outstanding Amount does not change because pending money was never counted as paid.

If cancellation creates a true pay-later amount and invoice has no Payment Due Date, finance must provide one in same action.

### Cheque

`pending` after receipt. Finance can:

- mark it cleared with bank-cleared date, changing it to `confirmed`; or
- mark it **Cheque Returned**, changing it to `returned` with a reason.

Cheque Returned creates no wallet entry and does not increase Paid Amount. Recovery screens continue to show the amount as outstanding.
Bank-cleared date becomes `effectiveDate` for a cleared cheque.

If returning cheque creates a true pay-later amount and invoice has no Payment Due Date, finance must provide one in same action.

### Reversal

Confirmed payments cannot be edited or deleted. Authorized finance users create a reversal with a mandatory reason. The service creates the opposite wallet movement, adjusts invoice/customer/slip aggregates, and records timeline history.

## 9. Recovery and ledger behavior

- Distributor/customer running balance is based on invoice totals minus confirmed payments, posted returns, and authorized adjustments.
- Pending bank transfers and cheques are visible but do not reduce the accounting balance.
- Recovery views show `Paid Amount`, `Outstanding Amount`, pending instruments, due date, and last recovery action.
- Batch recovery may create several payment rows linked by one batch identity. Transaction-reference uniqueness must not incorrectly block one bank transfer intentionally allocated across several invoices.
- Overdue detection uses Outstanding Amount and Payment Due Date.
- A fully paid invoice cannot accept more payment.
- Before accepting replacement cash for a pending cheque/transfer, finance first returns or cancels pending instrument. This prevents two instruments from claiming same invoice amount.

## 10. Reports

- Sales revenue remains based on invoice totals and invoice business date.
- Paid and outstanding totals come from the renamed invoice aggregates.
- Collection reports group confirmed payments by cash, bank transfer, and cheque.
- Collection and wallet reports use `effectiveDate`; pending-instrument reports use `paymentDate`. `createdAt`, `confirmedAt`, and upload time remain audit times, not business-report dates.
- Pending bank-transfer and pending-cheque reports remain separate from confirmed collections.
- Cheque Returned appears in exception/recovery reporting.
- Wallet reports include only confirmed movements.
- Profit reports remain based on invoice revenue and stored COGS; settlement method does not change profit.
- All report labels use Paid Amount and Outstanding Amount.

## 11. Print preservation

The following files are outside modification scope for this redesign:

- `src/components/sales/distributor-invoice.tsx`
- `src/components/sales/retailer-invoice.tsx`

The distributor template currently has no signature section. None will be added. The retailer/general template currently contains Customer Signature and Account Signature areas; both remain. Existing stamp areas, headings, columns, spacing, colors, and printable HTML remain unchanged.

Payment-method detail belongs in the application invoice detail and ledger views, not in this print redesign.

## 12. Error handling and concurrency

- Reject zero, negative, non-finite, or over-total payments.
- Reject payment method/wallet mismatches.
- Reject invalid payment state transitions.
- Lock or conditionally update payment and invoice rows during confirmation/reversal.
- Use an idempotency identity for every offline or retried write.
- Never use free-text bank reference as the sole idempotency key because one transfer may cover several invoices.
- Invoice mutation remains blocked when dependent recovery activity exists until those entries are reversed.
- All errors use plain operator-facing wording and retain technical detail only in server logs/audit metadata.

## 13. Testing and acceptance

Automated coverage must include:

- settlement equation and two-decimal rounding property tests
- full cash, full outstanding, partial, and mixed payments
- pending bank transfer and confirmation
- bank transfer cancellation
- pending cheque, cheque clearance, and Cheque Returned
- duplicate/concurrent confirmation
- wallet credit exactly once
- reversal exactly once
- payment total above invoice total
- method-specific required fields
- invoice creation transaction composition
- booked-order invoice and commission behavior
- customer ledger and recovery totals
- sales, collection, wallet, and outstanding reports
- UI state retention and disabled double-submit
- print regression assertions preserving current template sections and signatures

Verification gate:

- focused tests pass
- full test suite passes
- typecheck passes
- production build passes
- `git diff` confirms print component files are unchanged
- manual online invoice drill covers cash, bank transfer, cheque, mixed payment, confirmation, return, recovery, and reporting

## 14. Implementation order

1. Schema and pure settlement math
2. Shared settlement service and payment state transitions
3. Create/update/delete invoice integration
4. Recovery, wallets, customer aggregates, and audit integration
5. Online form and invoice-detail UI
6. Report and terminology migration
7. Print regression guard
8. Full verification

Offline sales import must not begin until this foundation passes its acceptance gate.
