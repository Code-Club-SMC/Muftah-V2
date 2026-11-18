# Sales returns phase 4, credit notes, customer store credit, and refunds design

Date: 2026-11-11
Parent spec: [2026-10-27-returns-and-expenses-spec.md](./2026-10-27-returns-and-expenses-spec.md)
Phase: 4 of 8 (`Fix 3`, `A2` Screen 4, `A4` `finance.refunds.issue`, `A5` backfill, `B3` refund separation)

## 1. Scope and locked product decisions

Phase 4 completes the financial loop when a sales return is completed. Every completed return issues a sequential printable credit note, clears open balance on the original invoice down to Rs 0 without letting any invoice go negative, and transfers any leftover amount into a pooled store credit balance per customer. Staff can apply available store credit toward other back-office invoices or issue cash and bank refunds.

Locked product decisions from brainstorming:

- **Order booker personal portal out of scope.** Only back-office production Sales routes (`src/routes/_protected/sales/*`) and Finance routes receive Phase 4 changes. The non-production Order Booker Portal (`src/routes/_protected/order-booker/*`, `order-booker-self-service-fn.ts`, `use-order-booker-self-service.ts`, `components/order-booker/*`) must not be touched.
- **Return voiding rules.**
  - **Applied store credit (`Situation 1 -> Option A`).** If leftover store credit from a completed return was applied to newer invoices, voiding that return automatically reverses those credit applications so the affected invoices reopen as unpaid, while any still-unused remainder from that return is removed from customer store credit.
  - **Refunded store credit (`Situation 2 -> Option B`).** If any cash or bank refund has been issued against that return's credit and remains active, voiding is blocked with a clear message and a direct link to the customer's page so Finance can reverse that refund first.
- **Where refunds live.** `"Refund now"` appears immediately after completing inspection on Screen 4 for leftover credit. All `"Refund later"` payouts and `"Reverse refund"` actions live on the back-office customer pages (`Customers`, `Distributors`, `Shopkeepers`), not as standalone payout forms on individual return detail pages.
- **Day-one permissions and reversal safety.** `finance.refunds.issue` is granted once on rollout to roles holding `finance.manage` or `inventory.returns.receive` (and seeded on `admin` and `finance-manager`), so Finance, Admins, and warehouse/counter receivers can issue refunds on day one while Admins can tighten warehouse roles later. Reversing an already-recorded cash or bank refund requires `finance.payments.reverse` or `finance.manage`.
- **Database migration and existing data.** Live production has no existing completed returns and no negative invoice balances. All schema changes come exclusively from Drizzle schema sources via `bun run db:generate` without editing past SQL migrations, snapshots, journals, or hand-writing custom migration files. A safe idempotent in-app initializer covers any unnumbered `completed`/`voided` returns present in staging or local databases.

## 2. Accounting invariants and conservation laws

### 2.1 Invoice and slip settlement without negative balances

Previously, completing a return against a paid invoice allowed `invoices.outstandingAmount` and `slip_records.outstandingAmount` to go negative. Under Phase 4:

- When a return completes for `totalAmount`, the system calculates the original invoice's uncovered open balance before this return (`preReturnInvoiceOutstanding = max(0, totalPrice - priorAppliedReturns - confirmedPaidAmount + priorExcessCreditedAmount)`):
  - `appliedToInvoiceAmount = min(totalAmount, preReturnInvoiceOutstanding)`
  - `customerCreditAmount = totalAmount - appliedToInvoiceAmount`
- Note on `recalculateInvoiceSettlement`: remove the artificial `netReceivable = totalPrice - returnedAmount < 0` check blockage for Price Override returns; capping `appliedToInvoiceAmount <= preReturnInvoiceOutstanding` guarantees `returnedAmount <= totalPrice` unless a pending payment later clears above net receivable.
- On `invoices` and `slip_records`:
  - `paidAmount` = sum of `confirmed` payments (including `customer_credit` settlements on this invoice).
  - `returnedAmount` = sum of `appliedToInvoiceAmount` across `completed` returns for this invoice.
  - `excessCreditedAmount` (default `0`) = cumulative confirmed overpayment moved to customer store credit when a pending cheque or bank transfer verified after a return had already lowered net receivable.
  - `outstandingAmount` = `totalPrice - paidAmount - returnedAmount + excessCreditedAmount`, which is always `>= 0`.
  - Check invariant on both tables: `paidAmount >= 0 AND returnedAmount >= 0 AND excessCreditedAmount >= 0 AND paidAmount + returnedAmount - excessCreditedAmount + outstandingAmount = totalPrice`.
- Pending unverified cheques/bank transfers follow `calculateSettlement`: if an invoice had a pending cheque when a return completed and that cheque clears later so confirmed money exceeds `totalPrice - returnedAmount`, the overflow (`excess`) increments `excessCreditedAmount` and creates a `payment_overage` store credit lot for the customer instead of allowing `outstandingAmount < 0`.
- Reversing a confirmed cash/bank payment (`reversePayment`) on an invoice with returns or overage credit first checks whether that invoice produced unconsumed customer credit that must be pulled back, or blocks payment reversal with an actionable error if the resulting store credit was already applied or refunded.

### 2.2 Credit notes, credit lots, and FIFO attribution

- Credit note numbers follow a sequential atomic counter (`CN-0001`, `CN-0002`, ..., expanding beyond 4 digits without truncation when `>= 10000`). Allocation locks the `credit_note_counters` row (`FOR UPDATE`) inside the return-completion transaction so concurrent completions never skip or duplicate numbers.
- Voided returns retain their `creditNoteNumber` permanently for audit history and never return numbers to the pool.
- Every positive store credit addition (`customerCreditAmount > 0` from a completed return, or verified-overage transfer from a cleared payment) creates one `customer_credit_lots` record with:
  - `originalAmount = remainingAmount > 0`, `appliedAmount = 0`, `refundedAmount = 0`, `voidedAt = null`.
  - Conservation invariant while active (`voidedAt IS NULL`): `remainingAmount + appliedAmount + refundedAmount = originalAmount`.
- Spending store credit on an invoice (`customer_credit` payment) or paying a cash/bank refund consumes active credit lots in deterministic FIFO order (`createdAt ASC, id ASC`), creating explicit rows in `customer_credit_payment_allocations` or `customer_refund_allocations`.
- Because every applied rupee and refunded rupee is mapped to its originating credit lot, multi-return partial credit applications, partial refunds, refund reversals, and single-return voids stay exact even when multiple returns contributed to one payment or one pooled refund.

### 2.3 Customer summary, chronological ledger, daily closing, and P&L

- **Customer summary (`customers`).** `customers.outstandingAmount` (`>= 0`) stores total open invoice balances across active invoices. `customers.creditBalance` (`>= 0`) stores total `remainingAmount` across active `customer_credit_lots`. Customer profiles, ledgers, and customer lists display **Amount Owed** and **Available Store Credit** separately without netting one silently into the other.
- **Customer ledger (`ledger-fn.ts` and `/sales/customers/$customerId`).**
  - Invoice rows add `+totalPrice` to `runningBalance`.
  - Confirmed real-money and `expense_offset` payment rows subtract `-amount` from `runningBalance`.
  - Completed returns subtract `-totalAmount` (`creditNoteNumber` shown) and voided returns add `+totalAmount` on the void date. This full subtraction automatically moves `runningBalance` negative by exact `customerCreditAmount` whenever the return exceeded unpaid invoice balance.
  - `customer_credit` payment rows appear visibly on the chronological ledger (`"Applied store credit to INV-..."`) with **`runningBalanceDelta = 0`** and are excluded from `periodPayments` cash totals. Subtracting them from `runningBalance` would double-count the return.
  - Active `Customer Refund` payouts add `+amount` to `runningBalance` (`Cash/Bank refunded to customer`, bringing net balance back toward `0`), and `Customer Refund Reversal` entries subtract `-amount`.
  - Equation check across full history: `runningBalance = totalInvoices - totalRealAndOffsetPayments - netCompletedReturns + activeCustomerRefunds = customer.outstandingAmount - customer.creditBalance`.
- **Daily Closing Summary (`getDailyClosingSummaryFn`).** Counts `cash`, `bank_transfer`, `cheque`, and `expense_offset` as today; excludes `customer_credit` from collected cash, bank, and cheque totals and exposes `totalCreditApplied` separately as non-cash settlement.
- **P&L and Finance Ledger (`company-reporting-core.ts`, `finance-fn.ts`, `ledger-container.tsx`).**
  - Cash/bank refunds create wallet `transactions` with `type: "debit"` and `source: "Customer Refund"`, referencing the `customer_refunds` row. Refund reversals create `type: "credit"` and `source: "Customer Refund Reversal"`.
  - Neither source is included in `FINANCE_EXPENSE_SOURCES`, so customer refunds never appear as business operating expenses in P&L.
  - `buildFinanceReconciliation` tracks `FINANCE_REFUND_SOURCES` (`Customer Refund`, `Customer Refund Reversal`) explicitly as its own bridge category (`customerRefundMovements`) rather than falling into generic `Manual / Opening Balance Adjustments`.
  - Finance account transaction source filters include `Customer Refund` and `Customer Refund Reversal`.

## 3. Database schema changes

All schema additions live in Drizzle schema files under `src/db/schemas/` and are applied solely through one newly generated migration from `bun run db:generate`:

1. **`credit_note_counters`** (`sales-erp-schema.ts`):
   - `id` (`text` PK, e.g. `"credit_note"`), `lastNumber` (`integer`, not null, default `0`), `updatedAt`.
2. **`sales_returns`** (`sales-erp-schema.ts`):
   - Add `creditNoteNumber` (`text`, nullable, unique index when not null `uq_sales_returns_credit_note_number`), `creditNoteIssuedAt` (`timestamp`), `appliedToInvoiceAmount` (`numeric(12, 2)`, default `'0'`, not null), `customerCreditAmount` (`numeric(12, 2)`, default `'0'`, not null).
   - Check constraints: `appliedToInvoiceAmount >= 0`, `customerCreditAmount >= 0`, and when `status IN ('completed', 'voided')`, `creditNoteNumber IS NOT NULL AND appliedToInvoiceAmount + customerCreditAmount = totalAmount`.
3. **`invoices` & `slip_records`** (`sales-schema.ts`, `sales-erp-schema.ts`):
   - Add `excessCreditedAmount` (`numeric(12, 2)`, default `'0'`, not null) and `excess_credited_amount >= 0`.
   - Update settlement check constraints to `paidAmount >= 0 AND returnedAmount >= 0 AND excessCreditedAmount >= 0 AND paidAmount + returnedAmount - excessCreditedAmount + outstandingAmount = totalPrice` (and `invoiceAmount` on `slip_records`).
4. **`payments`** (`sales-erp-schema.ts`):
   - Add `'customer_credit'` to `payments_method_check` (`'cash', 'bank_transfer', 'cheque', 'expense_offset', 'customer_credit'`).
   - Update `payments_wallet_required_check` to `method IN ('expense_offset', 'customer_credit') OR walletId IS NOT NULL`.
5. **`customers`** (`sales-schema.ts`):
   - Add `creditBalance` (`numeric(12, 2)`, default `'0'`, not null) with CHECK `creditBalance >= 0`.
6. **`customer_credit_lots`** (`sales-erp-schema.ts`):
   - `id`, `customerId` (`customers.id`, restrict), `sourceType` (`'sales_return' | 'payment_overage'`), `sourceReturnId` (nullable FK -> `sales_returns.id`), `sourceInvoiceId` (`invoices.id`), `sourcePaymentId` (nullable FK -> `payments.id`), `creditNoteNumber` (nullable `text`), `originalAmount`, `remainingAmount`, `appliedAmount`, `refundedAmount`, `createdAt`, `voidedAt` (nullable).
   - Indexes on `(customerId, createdAt)` and `(sourceReturnId)`.
   - CHECK constraints enforcing non-negative amounts and lot conservation.
7. **`customer_credit_payment_allocations`** (`sales-erp-schema.ts`):
   - `id`, `paymentId` (FK -> `payments.id`), `creditLotId` (FK -> `customer_credit_lots.id`), `amount` (`> 0`), `status` (`'active' | 'reversed'`), `createdAt`, `reversedAt`.
8. **`customer_refunds`** (`sales-erp-schema.ts`):
   - `id`, `customerId` (FK -> `customers.id`), `salesReturnId` (nullable FK -> `sales_returns.id`), `creditNoteNumber` (nullable `text`), `walletId` (FK -> `wallets.id`), `walletTransactionId` (FK -> `transactions.id`), `amount` (`> 0`), `refundDate`, `notes`, `status` (`'active' | 'reversed'`), `issuedById` (FK -> `user.id`), `createdAt`, `reversedById` (nullable), `reversedAt` (nullable), `reverseReason` (nullable), `reversalTransactionId` (nullable FK -> `transactions.id`).
   - Status metadata CHECK mirroring purchase/expense void metadata completeness.
9. **`customer_refund_allocations`** (`sales-erp-schema.ts`):
   - `id`, `refundId` (FK -> `customer_refunds.id`), `creditLotId` (FK -> `customer_credit_lots.id`), `amount` (`> 0`), `status` (`'active' | 'reversed'`), `createdAt`, `reversedAt`.
10. **`customer_credit_movements`** (`sales-erp-schema.ts`):
    - Immutable chronological log per customer: `id`, `customerId`, `creditLotId` (nullable), `type` (`'issued' | 'applied' | 'refunded' | 'refund_reversed' | 'void_reclaimed' | 'void_unapplied'`), `amount` (`> 0`), `signedDelta`, `balanceAfter`, `salesReturnId`, `creditNoteNumber`, `invoiceId`, `paymentId`, `refundId`, `walletId`, `notes`, `performedById`, `createdAt`.
    - Index on `(customerId, createdAt)`.

## 4. Transactional service layer and edge-case rules

A focused service module (`src/server-functions/sales/customer-credit-service.ts`, working closely alongside `settlement-service.ts` and `sales-returns-fn.ts`) owns all mutations of `customers.creditBalance`, `customer_credit_lots`, `customer_refunds`, allocations, and movement logs under row locks.

### 4.1 Return completion (`completeSalesReturnFn`)

Inside the existing transaction (`lockReturn`, `lockCartonReturnOrder`, `lockInvoice`, `lockCustomer`):
1. Compute `totalAmount` from inspected received units and validated refund prices.
2. Allocate next `creditNoteNumber` (`CN-XXXX`) atomically via `credit_note_counters`.
3. Calculate `appliedToInvoiceAmount` and `customerCreditAmount` using current invoice open balance after confirmed payments and prior applied returns.
4. Persist `salesReturns` with `status: "completed"`, `completedAt`, `creditNoteNumber`, `creditNoteIssuedAt`, `appliedToInvoiceAmount`, and `customerCreditAmount`.
5. Call `recalculateInvoiceSettlement(tx, salesReturn.invoiceId)` so `invoices`, `slip_records`, and `customers.outstandingAmount` stay consistent.
6. If `customerCreditAmount > 0`: create active `customer_credit_lots` row, increment `customers.creditBalance`, and insert `'issued'` row in `customer_credit_movements`.
7. Write timeline event on invoice mentioning `creditNoteNumber`, `appliedToInvoiceAmount`, and `customerCreditAmount`.
8. Return structured completion payload `{ returnRecord, creditNoteNumber, totalAmount, appliedToInvoiceAmount, customerCreditAmount, leftoverCreditBalance }` so Screen 4 renders immediately with exact figures.

### 4.2 Applying store credit (`customer_credit` payments)

Supported across `postInvoiceFn` (`create-invoice-form`), `recordSlipPaymentFn`, and `batchReconcileSlipsFn`:
- Validation: locks `customers` row `FOR UPDATE`, rejects if requested `amount <= 0`, if sum of credit applied across payment rows/batch items for that customer exceeds `customers.creditBalance`, or if total invoice allocation exceeds `remainingOutstanding`.
- Creates confirmed `payments` row (`method: 'customer_credit'`, `status: 'confirmed'`, `walletId: null`, `effectiveDate = paymentDate`), writes zero wallet `transactions`.
- Consumes active `customer_credit_lots` FIFO, writes active `customer_credit_payment_allocations`, decrements `customers.creditBalance`, writes `'applied'` row in `customer_credit_movements`, and calls `recalculateInvoiceSettlement`.

### 4.3 Issuing a refund (`issueCustomerRefundFn`)

Gated by `requireFinanceRefundsIssueMiddleware` (`finance.refunds.issue`):
- Inputs: `customerId`, `amount`, `walletId`, `refundDate` (defaults today), `notes` (optional), optional `salesReturnId` (passed only from Screen 4 `"Refund now"` so the credit note record/print displays the immediate payout), `allowOverdraw` (boolean, defaults `false`).
- Inside transaction: locks `customers` row `FOR UPDATE`, active credit lots `FOR UPDATE`, and selected `wallets` row `FOR UPDATE`.
- Checks `amount > 0` and `amount <= customers.creditBalance`. When `salesReturnId` is supplied on Screen 4, also validates `amount <= that return's remaining lot balance`.
- Overdraw check matching `createExpenseFn`: if `wallet.balance < amount`:
  - User holding `finance.manage` receives structured overdraw warning if `allowOverdraw !== true`, and succeeds once confirmed with `allowOverdraw: true`.
  - User without `finance.manage` is rejected with a clear error asking to choose a funded account or ask Finance to record a deposit first.
- Deducts `wallets.balance`, inserts `transactions` (`type: "debit"`, `source: "Customer Refund"`, `referenceId: refund.id`, `description` naming customer & CN/notes), consumes lots FIFO, writes `customer_refund_allocations`, decrements `customers.creditBalance`, and writes `'refunded'` row in `customer_credit_movements`.

### 4.4 Reversing an accidental refund (`reverseCustomerRefundFn`)

Gated by `requireFinancePaymentReversalOrManageMiddleware` (`finance.payments.reverse` OR `finance.manage`):
- Inputs: `refundId`, `reason` (`min 3 chars`).
- Inside transaction: locks `customer_refunds`, `customers`, referenced `customer_credit_lots`, and `wallets` row `FOR UPDATE`.
- Fails cleanly if already `'reversed'`. Also blocks if a linked `salesReturn` is already somehow voided (invariant prevents this, defensive check kept).
- Marks `customer_refunds` `status: "reversed"`, sets `reversedById`, `reversedAt`, `reverseReason`, `reversalTransactionId`.
- Credits `wallets.balance` back `+amount` and inserts `transactions` (`type: "credit"`, `source: "Customer Refund Reversal"`, `referenceId: refund.id`).
- Marks linked `customer_refund_allocations` `'reversed'`, restores `lot.refundedAmount -= chunk`, `lot.remainingAmount += chunk`, increments `customers.creditBalance += amount`, and inserts `'refund_reversed'` movement row.

### 4.5 Voiding a completed return (`voidSalesReturnFn`)

Inside transaction (`lockReturn`, `lockCartonReturnOrder`, `lockInvoice`, `lockCustomer`, lock credit lot & any downstream invoices/payments):
1. Reverse stock via existing `reverseReturnStock` (fails clearly if goods were already sold/short).
2. Load `customer_credit_lots` for `sourceReturnId`:
   - If `lot.refundedAmount > 0`: throw structured error (`VOID_BLOCKED_BY_REFUND`) naming the refunded amount and customer (`"Rs X of this return's credit was already refunded. Reverse the refund on <Customer>'s page before voiding."`) with `customerId` and `customerType` metadata so the UI shows a direct link to the customer's page (`Situation 2 -> Option B`). Stock and everything roll back atomically.
   - If `lot.appliedAmount > 0` (`Situation 1 -> Option A`): load active `customer_credit_payment_allocations` for `lot.id`:
     - Lock affected destination invoices (`order by invoiceId` consistently to prevent deadlocks).
     - For each affected `payment`:
       - Mark original `payment` `status: 'reversed'`, `resolvedById: userId`, `resolvedAt: now`, `resolutionReason: "Credit note voided: " + reason`.
       - Inspect all active allocations on that `payment`: mark this lot's allocation `'reversed'`; if OTHER active credit lots (from different returns) also co-funded part of that same `payment`, create a fresh confirmed `customer_credit` replacement payment row for the remaining portion (`otherLotsSum`), move those other lots' allocations onto the replacement payment (preserving their exact `appliedAmount` untouched!), and write `'void_unapplied'` movement row on the voided lot.
       - Call `recalculateInvoiceSettlement(tx, destinationInvoiceId)` so destination invoice(s) reopen automatically with unpaid balances (`paidAmount`, `outstandingAmount`, `paymentStatus`, slips, timeline event explaining credit from voided CN was removed).
   - Remove unused `lot.remainingAmount` from `customers.creditBalance`, write `'void_reclaimed'` movement if `remainingAmount > 0`, set `lot.remainingAmount = 0`, `lot.appliedAmount = 0`, `lot.voidedAt = now`.
3. Also check whether the original invoice holds any `payment_overage` credit lots created after prior pending payments cleared below the previous return ceiling (`excessCreditedAmount > 0`). If removing this return uncovers positive receivable needed by that invoice (`newExcess < previousExcess`), reclaim that delta from the invoice's `payment_overage` lot(s) using the exact same block-on-refunded / auto-unapply-on-applied / reclaim-unused rule, and decrement `invoices.excessCreditedAmount` accordingly.
4. Update `salesReturns` (`status: 'voided'`, `voidedById`, `voidedAt`, `voidReason`), call `recalculateInvoiceSettlement(tx, salesReturn.invoiceId)` (restoring original invoice balance cleanly), and record invoice timeline event.

### 4.6 One-time idempotent startup/backfill helper

`ensureCreditNotesBackfilled(db)`: runs idempotently inside a transaction (checking first if any `sales_returns` with `status IN ('completed', 'voided')` has `creditNoteNumber IS NULL` — returning immediately with zero writes when none exist, as in live production). If any test/staging completed or voided returns lack credit note numbers, numbers them sequentially in `(completedAt ASC, createdAt ASC, id ASC)` order, allocates `appliedToInvoiceAmount` / `customerCreditAmount` / active lots, reconciles any existing negative `invoices.outstandingAmount` cleanly into store credit, and advances `credit_note_counters`. Invoked safely inside return completion / credit queries with an in-process completion flag after checking count = 0.

## 5. Permissions (`rbac.ts`)

- Add `"finance.refunds.issue"` to `PERMISSION_KEYS`, `PERMISSION_DEFINITIONS` (`moduleKey: "finance"`, `label: "Issue customer refunds"`, `description: "Pay out customer store credit in cash or bank transfer."`, `kind: "action"`), and `SYSTEM_ROLE_SLUGS` seeds (`admin`, `finance-manager`).
- Update `PERMISSION_BACKFILLS` in `rbac.ts` / `authz.server.ts` so a permission backfill entry may specify one or multiple source permissions (`PermissionKey | readonly PermissionKey[]`):
  - `"finance.refunds.issue": ["finance.manage", "inventory.returns.receive"]`
  - Existing roles holding either permission inherit `finance.refunds.issue` once when the permission key is first seeded. Removing it from a warehouse role later via role management is respected permanently.
- Add `requireFinanceRefundsIssueMiddleware` and `requireFinancePaymentReversalOrManageMiddleware` in `src/lib/middlewares.ts`.

## 6. User interface design (back-office Sales & Finance)

### 6.1 Screen 4 ("Settle the credit") after inspection

- Hosted inside `ReturnLifecycleActions` / post-inspection sheet flow on `/sales/returns/$returnId` (supporting both standard Receive & Inspect on `"Approved"` and `"Approve and receive now"` fast path).
- **Zero leftover (`customerCreditAmount === 0`):** Displays confirmation statement (`"Credit note CN-0001 for Rs 3,000 issued. Rs 3,000 cleared Ahmed Traders' open balance on Invoice #1187. Nothing left over."`), **Print credit note**, and **Done**.
- **Leftover store credit (`customerCreditAmount > 0`):**
  - Displays plain statement (`"Credit note CN-0042 for Rs 4,500 issued. Rs 3,000 cleared Ahmed Traders' open balance on Invoice #1187. Rs 1,500 is left over."`).
  - Choice A (default selected): **Keep as customer credit** — shows current store credit total, **Print credit note**, and **Done**.
  - Choice B (visible when user holds `finance.refunds.issue`): **Refund now** — lets operator pick funded cash or bank wallet (`useWallets`), date (today), optional note, shows overdraw warning/confirm when applicable, submits `issueCustomerRefundFn` for the leftover credit, updates confirmation state to `"Rs 1,500 refunded from Cash in Hand"`, and keeps **Print credit note** ready. Users without `finance.refunds.issue` see **Keep as customer credit** plus a brief note that Finance can refund later from the customer's page.

### 6.2 Printable credit note dialog

- New reusable `CreditNotePrintDialog` styled consistently with existing A4/receipt invoice print dialogs (`invoice-print-dialog.tsx`):
  - Company header, **CREDIT NOTE** heading, large `CN-XXXX` number, **VOIDED** banner when `status === 'voided'`.
  - Metadata: Credit note date, Customer name/city/phone, Original Invoice #, Return #, Reason & note.
  - Line-item table: Product/pack, Condition summary (Good / Damaged / Expired packs), Returned qty (cartons + loose), Unit refund rate, Line total.
  - Totals & settlement breakdown: Total credit note amount, Applied to Invoice #X, Transferred to Store Credit (and immediate Refund payout details if refunded on Screen 4, or Void metadata if voided).
- Accessible from Screen 4 and `/sales/returns/$returnId` (`Print credit note` button on any `completed` or `voided` return).

### 6.3 Applying store credit on back-office payment flows

- Query `getCustomerCreditSummaryFn(customerId)` returning `{ creditBalance, recentMovements }`.
- **Create / Edit Invoice (`SettlementSection` + `PaymentRowsField`):**
  - When a customer is chosen and `creditBalance > 0` (`!isEditing` or when viewing customer balance), display a clear banner above payment rows: `"Available credit Rs X — Apply"` (`one-click Apply` adds or updates a `customer_credit` payment row capped at `min(creditBalance, remainingPayable)` without forcing a wallet selection).
  - `"Apply"` handles mixed payments cleanly (e.g. apply Rs 1,500 store credit + Paid in Cash for remaining Rs 2,000), updates `calculatePaymentBreakdown` immediately, and rejects duplicate/over-credit submissions.
- **Slip Reconciliation (`/sales/reconciliation`):**
  - Single-slip payment dialog displays customer's `Available credit Rs X` banner with `Apply` button and `Store Credit` payment method option (auto-clamped to `min(creditBalance, slip.outstandingAmount)`, hiding wallet selection).
  - `BatchRecoveriesDialog`: Shows each slip's customer `Available credit` badge when `> 0`. Selecting `"Store Credit"` as batch method hides the wallet dropdown, disables or skips slips for customers with `creditBalance = 0`, and clamps each selected slip's recovery amount cumulatively against that customer's remaining available `creditBalance` in row order.
- **Invoice Detail (`/sales/invoices/$invoiceId`):** Shows `"Credit Note"` link badges in Returns/Timeline and `customer_credit` badge cleanly in payment list.
- **Daily Closing Card (`/sales/reconciliation`):** Keeps Cash/Bank/Cheque recovery totals clean and displays non-cash Store Credit Applied separately if > 0.

### 6.4 Customer profile & ledger updates

- **Customer summary KPIs & list views:** Add **Available Credit** KPI/column alongside **Amount Owed** (`customers-table.tsx`, `/sales/customers/$customerId`, `/sales/people/distributors/$customerId`, `/sales/people/shopkeepers/$customerId`) without subtracting one from the other in owed KPIs.
- **Reusable `CustomerCreditSection` mounted on customer pages (`/sales/customers/$customerId`, `/sales/people/distributors/$customerId`, `/sales/people/shopkeepers/$customerId`):**
  - Card header: `Available Store Credit: Rs X` + **Issue Refund** button (enabled when `creditBalance > 0` and user holds `finance.refunds.issue`).
  - **Issue Refund dialog:** Amount (Lac/Crore formatted, defaults to available credit, editable up to `creditBalance`), Pay from cash/bank wallet (`useWallets` with live balance), Date (defaults today), Notes, low-balance warning + Finance manager overdraw confirmation dialog when needed.
  - **Credit & Refund History table:** Shows dated movements (`Credit Note CN-...`, `Applied to INV-...`, `Refunded Rs ...`, `Refund Reversed`, `Voided`), status badge, wallet used for payouts, printable CN link, and **Reverse refund** button (gated on `finance.payments.reverse` or `finance.manage`, prompting for reason >= 3 chars).
- **Chronological Customer Ledgers (`distributors/$customerId/ledger`, `shopkeepers/$customerId/ledger`, `salesmen/$salesmanId/shops/$customerId`) and Customer Detail Ledger (`/sales/customers/$customerId`):** Chronological ledgers render `CN-XXXX` on return rows, `Store Credit Applied (Settled)` rows (zero net balance delta so no double-count), `Customer Refund (+)` rows, and `Refund Reversal (-)` rows with accurate running balance and print/export compatibility. `getCustomerLedgerFn` also returns `creditBalance` and renders the reusable `CustomerCreditSection` on `/sales/customers/$customerId`.
- **Return Detail Void Dialog (`/sales/returns/$returnId`):** If `voidSalesReturnFn` throws `VOID_BLOCKED_BY_REFUND`, catch and show clear inline alert inside the dialog with a one-click link to that customer's page so Finance can reverse the blocking refund directly.
- **Branch base note:** Once `fix/returns-phase-3-loose-ends` merges to `main`, Screen 4 wires cleanly into both standard inspection completion (`ReturnLifecycleActions`) and the `Approve and receive now` fast path.

### 6.5 Cache invalidation consistency

All Phase 4 mutations (`completeSalesReturn`, `applyCustomerCredit`, `issueCustomerRefund`, `reverseCustomerRefund`, `voidSalesReturn`, `postInvoice`, `recordSlipPayment`, `batchReconcileSlips`, `confirm/reversePayment`) invalidate:
- `salesReturns` detail/list queries
- `customerCredit` queries (`[customerId]`)
- `customers` list, `customers` ledger, `distributor-profile`, `shopkeeper-profile`, `distributor-ledger`, `shopkeeper-ledger`, `salesman-ledger`
- `invoices`, `open-slips-for-recovery`, `overdue-slips`, `daily-closing`
- Finance `wallets`, `transactions` ledger, `company-report` / P&L queries when cash/bank moves.

## 7. Verification plan

1. **Schema & math unit tests (`vitest`):**
   - Return completion split (`total = appliedToInvoice + customerCredit`), `outstandingAmount >= 0`, `excessCreditedAmount` handling on delayed pending cheque verification.
   - Sequential gap-free `CN-XXXX` allocation and retention after void.
   - FIFO lot allocation and conservation invariant (`original = remaining + applied + refunded`) across multiple returns, partial credit application, partial refund, refund reversal, split-lot payment reversal when one source return voids, and void blocking when `refundedAmount > 0`.
2. **Accounting & reporting regression tests:**
   - Customer ledger chronological running balance verification proving zero double-counting when store credit is applied to a new invoice, and accurate `+refund` / `-refund_reversal` balance recovery.
   - `getDailyClosingSummaryFn` confirming `customer_credit` is excluded from daily cash/bank/cheque totals.
   - `company-reporting-core.ts` confirming `"Customer Refund"` / `"Customer Refund Reversal"` never enters operating expenses and reconciles inside `buildFinanceReconciliation`.
3. **RBAC & source-guard tests:**
   - Verify `finance.refunds.issue` exists, seeds on `admin` and `finance-manager`, and `PERMISSION_BACKFILLS` supports multi-source backfill from `finance.manage` and `inventory.returns.receive`.
   - Verify refund reversal requires `finance.payments.reverse` or `finance.manage`.
   - Verify non-production `/order-booker/*` portal files remain completely unmodified.
4. **UI behavior tests:**
   - Screen 4 showing exact statement, default `Keep as customer credit`, `Refund now`, zero-leftover summary, and Print Credit Note button.
   - Available credit banner + one-click Apply on invoice form and slip reconciliation.
   - Customer page `Issue Refund`, low-balance overdraw warning, `Reverse refund`, and void dialog customer link when blocked by active refund.
5. **Final checks & browser E2E verification:**
   - Run `bun run typecheck`, `bun run test`, `bun run build`, `bun run db:generate` (inspect generated SQL cleanly), apply generated migration to local test DB (`bun run db:migrate`), start dev server, and test complete real workflow in Chrome DevTools / Playwright.
   - Run `graphify update .` after code changes in implementation phase.

## 8. Out of scope

- Non-production personal Order Booker Portal (`/order-booker/*`).
- GST/tax-registered credit note format changes (deferred per parent spec A6).
- Salvage value, write-offs, and damaged stock disposal (Phase 5).
- Recovery-based commission changes (Phase 6) and supplier debit notes (Phase 7).
- Separate Digital Account payment method migration (Phase 8).
