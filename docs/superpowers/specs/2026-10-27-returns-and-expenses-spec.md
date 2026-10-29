# Sales Returns, Expense Entry and Digital Payments — Spec

Date: 2026-10-27
Status: Draft for review

## Why

Sales returns today are a two-click flow: someone creates a return against an invoice, a manager approves it, and in that single approval the system restocks goods, reduces the customer's balance and adjusts profit. That is fast, but it records the return when it is *promised*, not when the goods are *back and checked*. It also leaves money holes (no cap on refund price), overstates profit (damaged goods kept at full cost), strands customer credit on old invoices, and has no undo.

Expense entry works but operators find it hard. The record button is not on the Expenses page, the form asks questions in an order that does not match how people think, and a mistake cannot be corrected.

This spec covers both, in two parts. Part A is returns. Part B is expenses. Part B also gives Part A a place to book return write-offs and refunds.

## Design principles (apply to every screen below)

1. **One obvious next action.** Every screen shows one primary button that says exactly what happens next ("Mark as received", "Finish and credit Rs 4,500").
2. **Smart defaults, fewer questions.** Pre-fill everything the system already knows (today's date, last-used account, invoice quantities, "all good" condition). The operator only changes what is different.
3. **Show the money consequence before the click.** Before confirming, show in plain words what will happen: "Ahmed Traders' balance goes from Rs 12,000 to Rs 7,500."
4. **Mistakes are fixable.** Nothing is a one-way door without a void/reverse path.
5. **Work queues, not hunting.** Lists open on tabs that answer "what needs me?" (To approve, To receive, Done).
6. **Readable numbers.** Amounts formatted with Lac/Crore grouping as you type, with the amount in words under large values.

---

# Part A — Sales Returns

## A1. New lifecycle

```
Requested ──approve──▶ Approved ──receive & inspect──▶ Completed
    │                     │                                │
    └─reject─▶ Rejected   └─cancel─▶ Cancelled             └─void─▶ Voided
```

| Status | Meaning | Stock moves? | Money moves? |
|---|---|---|---|
| Requested | Customer wants to send goods back | No | No |
| Approved | Manager agreed to take them back | No | No |
| Completed | Goods arrived, counted and inspected; credit note issued | Yes | Yes |
| Rejected | Manager refused the request | No | No |
| Cancelled | Approved but goods never came / customer changed mind | No | No |
| Voided | A completed return was wrong and has been reversed | Reversed | Reversed |

Stock and money move at exactly one point: **Completed**. Voiding creates reversing entries dated on the void date; it never edits the original.

**Fast path.** When goods are physically at the counter (common for walk-in distributors), a user who holds both approve and receive rights sees "Approve and receive now", which goes straight to the inspection screen. Still one record, still the same audit trail, just no waiting.

## A2. Screens and flow

### Entry points
- **Invoice page:** "Return items" button (existing) opens the request form, pre-filled from the invoice.
- **Sales → Returns** (new list page): tabs **To approve · To receive · Done · All**, each with a count badge. Search by return number, invoice number or customer.

### Screen 1 — Request return (sheet)
- Lines show every invoice item with *sold*, *already returned* and *can return* quantities. Quantity steppers in cartons + loose units, clamped to "can return".
- Refund per unit pre-filled with the net price charged on the invoice line, shown read-only. A small "Change price" link appears only for users with the price-override permission and asks for a reason.
- Reason: pick from a short list of reason codes (see A6); "Other" opens a note.
- Footer shows live total and the consequence line: "If completed, Ahmed Traders' balance drops by Rs 4,500."
- Primary button: **Send for approval** (or **Approve and receive now** on the fast path).

### Screen 2 — Approve (from the To approve tab)
- Read-only summary of the request, the customer's current balance, and a warning when the refund price was overridden.
- Buttons: **Approve** · **Reject** (reason required).

### Screen 3 — Receive and inspect (from the To receive tab; warehouse user)
- One row per item. Each row has three quantity boxes: **Good**, **Damaged**, **Expired**, pre-filled as "all expected quantity = Good". In the common case the operator changes nothing and clicks finish.
- If the total received is less than approved, the row shows "3 short" in amber. The credit is calculated on what actually arrived.
- Damaged/expired rows show a "Salvage value" field defaulting to 0, with the write-off amount next to it ("Loss booked: Rs 1,800").
- Primary button: **Finish and credit Rs X**.

### Screen 4 — Settle the credit (shown immediately after finishing)
- Plain statement: "Credit note CN-0042 for Rs 4,500 issued. Rs 3,000 cleared Ahmed Traders' open balance on invoice #1187. Rs 1,500 is left over."
- Choices for the leftover: **Keep as customer credit** (default) · **Refund now** (pick cash/bank account; creates a wallet debit).
- If nothing is left over, this screen is just a confirmation with a "Print credit note" button.

### Return detail page
- Header with status pill and a horizontal progress bar (Requested → Approved → Completed).
- Timeline of every action with who and when.
- Actions available by status: Cancel (approved only), Void (completed only, reason required), Print credit note (completed).

## A3. Fixes, mapped to behaviour

### Fix 1 — Refund price cap and exact money math
- Server rejects any refund per unit above the net unit price charged on the invoice line, unless the user holds the override permission and supplies a reason. The override is recorded on the return and shown on the approval screen.
- All money calculations in the returns flow use exact decimal math (as the stock calculations already do). No floating-point totals.

### Fix 2 — Damaged/expired goods valued honestly
- At inspection, damaged/expired quantities go into returned stock at their **salvage value** (default 0), not full cost.
- The difference between original cost and salvage value is booked as a **Return write-off** loss in the completion period and appears as its own line in P&L.
- New action on returned stock: **Dispose** with three options — Scrap (value to 0, loss booked), Sell as seconds (moves to a sellable "seconds" item at chosen price), Return to supplier (feeds Fix 7). Every disposal is logged.

### Fix 3 — Customer credit that actually goes somewhere
- On completion a **credit note** with its own number series (CN-0001, CN-0002, …) is issued and is printable.
- The credit is first applied to the outstanding balance of the original invoice. Anything left over becomes **customer credit**, tracked per customer.
- When recording a payment against any invoice for that customer, the payment form shows "Available credit Rs 1,500 — Apply". Applying it creates a settlement entry, not a cash entry.
- Refund now / refund later: a cash or bank refund from customer credit debits the chosen wallet and appears in the customer ledger and the wallet's transactions.
- Customer ledger shows credit notes, credit applications and refunds as dated entries.

### Fix 4 — Separate approve from receive and inspect
- Implements the A1 lifecycle and Screens 2–4.
- Condition (good/damaged/expired) moves from the return header to each line, decided at inspection, and a single line can be split across conditions.
- Short receipts are allowed; the unreceived part is closed when the return is completed.

### Fix 5 — Void, approval rights and reason codes
- **Void:** completed returns can be voided with a reason. Voiding reverses stock (blocked with a clear message if the restocked goods have already been sold and stock is insufficient), reverses the credit note (and any credit application), and reverses the write-off. All reversals are dated on the void date.
- **Approval rights:** any super-admin or user holding the approve permission can approve a return, including one they created themselves. No second person is required. Users without the approve permission can only request.
- **Reason codes:** configurable list, seeded with: Damaged in transit, Leaking / defective pack, Expired or near expiry, Wrong item delivered, Customer over-ordered, Other (note required). Reports can group returns by reason.
- **No return window.** Returns are accepted at any time after the invoice; there is no day limit and no override.

### Fix 6 — Commission (moved)
- Replaced by the standalone Recovery-Based Order Booker Commission spec (2026-10-27). Commission will be earned only on money actually collected, so returns no longer need a clawback.

### Fix 7 — Supplier returns (debit notes)
- New flow mirroring sales returns, against a supplier purchase: Requested → Dispatched → Completed.
- Completion reduces raw material / packaging stock (or consumes damaged returned stock from Fix 2) and issues a **debit note** that reduces the amount owed to the supplier.
- Scoped as the last phase; detailed screens to be designed after Fixes 1–6 ship.

## A4. Permissions

| Permission | Allows |
|---|---|
| sales.returns.create | Request a return |
| sales.returns.approve | Approve, reject, cancel, void |
| sales.returns.override-price | Refund above invoice price |
| inventory.returns.receive | Receive and inspect returned goods |
| finance.refunds.issue | Refund customer credit in cash/bank |

Existing users with sales manage rights get create + approve on migration so nobody loses access on day one. Admins then split roles as needed.

## A5. Data changes (conceptual)

- Return header: new statuses; created-by; received-by/at; voided-by/at/reason; credit note number; reason code; price-override flag and reason.
- Return line: received quantities split into good/damaged/expired; salvage value; write-off amount.
- New: customer credit balance and a credit movement log (issued, applied, refunded, reversed).
- New: reason code list.
- New: disposal log for returned stock.

Schema changes go through the normal generated-migration process only.

**Existing data:** returns currently "approved" already moved stock and money, so they are migrated to **Completed** with credit note numbers assigned in date order. Returns currently "pending" become **Requested**. Existing returned damaged/expired stock is written down to zero at go-live of Fix 2, as a one-time loss booked in that month and shown as its own P&L line ("Write-down of existing damaged stock").

## A6. Out of scope
- Customer self-service returns portal.
- Tax/GST credit note formats (add when tax module exists).
- Automatic replacement orders (exchange instead of credit).

---

# Part B — Expense Entry Redesign

## B1. What makes it hard today

1. **The button is in the wrong place.** The Expenses page shows the list but has no "Record expense" button. Operators must go to the Finance accounts page to add one.
2. **Questions in the wrong order.** The form starts with "Pay from which account?" The operator is thinking "what did I pay for, and how much?"
3. **Three free-text boxes.** Description (required), Remarks, and Slip number, plus category custom fields tucked at the very bottom. Operators do not know what goes where.
4. **Hard block on low balance.** If the cash account shows less than the amount, the expense cannot be saved, even though the money was really spent. Operators either give up or invent a deposit.
5. **No edit or undo.** A typo is permanent, so operators hesitate or avoid entering.
6. **No "paid to".** The first thing an auditor asks is missing.
7. **No repeats.** Rent, electricity and fuel are re-typed every month.
8. **Jargon and density.** "Expense Schema", small uppercase labels, and a tutorial button needed to explain a form.
9. **Category filter does not scale.** A row of buttons, one per category, overflows once there are many categories.

## B2. New experience

### "Record expense" everywhere it is needed
- Primary button at the top of the Expenses page, plus the existing one on the accounts page.
- Keyboard shortcut **N** on the Expenses page.

### Quick-add form (one short screen)
In this order:
1. **Amount**: large input, Lac/Crore grouping as you type, amount in words underneath.
2. **What for**: category picker showing the 6 most-used categories as big tiles, with search for the rest.
3. **Paid to**: autocomplete of previous payees (e.g. LESCO, Shell Pump Ravi Road); new names saved automatically.
4. **Paid from**: defaults to the account this user last used, balance shown next to it.
5. **Date**: defaults to today.
6. **Note**: one optional field (replaces Description + Remarks).
7. **More details** (collapsed): slip/reference number and the category's custom fields. Required custom fields auto-expand this section.

Buttons: **Save** and **Save & add another** (keeps account and date, clears the rest). Enter key saves.

Description is no longer required. The list shows "Category · Paid to" when no note is given.

### Low balance becomes a warning, not a wall
- If the amount exceeds the account balance, show: "Cash in Hand will go to −Rs 2,000. Usually means a deposit wasn't recorded." with an inline **Record deposit** link.
- Users with finance manage rights can save anyway after a confirm dialog that states the account, its current balance, and the negative balance it will have after saving ("Cash in Hand will be −Rs 2,000 after this expense. Save anyway?"). The account is then flagged as overdrawn on the accounts page. Others must record the deposit first. Nobody loses the expense they were typing.
- Receipt photos are explicitly out of scope.

### Fix mistakes
- Expenses are **editable at any time** by their creator and by users with finance manage rights. Every edit is logged with old and new values, who and when. If the amount or account changes, the wallet is corrected with an adjusting transaction so balances and history stay consistent.
- **Void** (reason required) removes an expense entirely: it creates a reversing wallet transaction dated today, and the original stays visible, struck through.

### Repeats
- "Save as template" on any expense. Templates appear as one-tap chips at the top of the quick-add form ("Shop rent — Rs 85,000").
- Optional monthly reminders for templates (shows on the Expenses page as "Due this week"), never auto-posted.

### List page
- Top: this month's total, change vs last month, top 3 categories.
- Filters: category (searchable dropdown, multi-select), account, paid to, date range.
- Rows: date, category, paid to, amount, account. Click opens a detail drawer with everything and the edit/void history.
- Rename "Expense Schema" to **Expense Categories**. Remove the tutorial buttons once the new form ships.

## B3. Links to Part A
- Return write-offs (Fix 2) and disposals appear in P&L under their own line, not as wallet expenses, because no cash moved.
- Customer refunds (Fix 3) appear in the wallet's transaction list as "Customer refund", not under Expenses.

## B4. Data changes (conceptual)
- Expense: payee, voided-by/at/reason, void transaction link.
- New: payee list, expense templates, expense edit log.
- Description becomes optional.

---

# Part C — Digital Account Payments (EasyPaisa / JazzCash / Raast)

## C1. What happens today
- "Digital Account (EasyPaisa / JazzCash / Raast)" appears on two screens: the payment rows of the new invoice form, and Sales → Slip Reconciliation.
- The operator picks a provider, types the sender's mobile number, optional account title, and the transaction ID.
- Behind the scenes it is saved as a **Bank Transfer**. Provider, mobile number and title are packed into the notes as text, e.g. "[JazzCash] From: 0300-1234567".
- When an invoice is reopened, the form reads the notes back with a text pattern to guess whether it was a digital payment.
- Batch recovery (Sales → Orders) offers only Cash and Bank Transfer.

Problems:
1. Reports cannot separate digital payments from bank transfers. "How much came in through EasyPaisa this month?" has no answer.
2. If someone edits the notes, the payment silently turns back into a plain bank transfer.
3. Batch recovery cannot record digital payments at all.

## C2. Fix
- **Digital Account** becomes a real payment method of its own, stored as such.
- Provider (EasyPaisa, JazzCash, Raast, Other), sender mobile/account number, account title and transaction ID become proper fields, not notes.
- Available on every payment screen: new invoice, Slip Reconciliation and batch recovery.
- Verification works like a bank transfer: the payment counts as received once finance verifies it (instant verify option kept).
- Filters and reports can group by method and by provider.
- Commission: earns exactly like a bank transfer, once verified.
- A duplicate check warns when the same provider + transaction ID is entered twice.

## C3. Existing data
Bank transfers whose notes match the digital pattern are converted to Digital Account with their provider and sender number moved into the new fields. Anything that does not match cleanly stays a bank transfer and is listed for finance to review.

Schema changes go through the normal generated-migration process only.

# Delivery phases

| Phase | Contents | Why this order |
|---|---|---|
| 1 | Fix 1 (refund cap, exact math) | Small change that closes an open money leak |
| 2 | Part B quick-add form, button placement, low-balance warning, edit/void | Biggest daily operator pain; independent of returns |
| 3 | Fix 4 + Fix 5 (lifecycle, inspection screen, void, approval rights, reasons) | Core returns rework |
| 4 | Fix 3 (credit notes, customer credit, refunds) | Depends on the Completed step from phase 3 |
| 5 | Fix 2 (salvage value, write-offs, disposal) | Plugs into the inspection screen |
| 6 | Recovery-based commission (separate spec) | Independent; replaces the clawback |
| 7 | Part B extras (payees, templates, list redesign) and Fix 7 (supplier returns) | Nice-to-have and new module |
| 8 | Part C (Digital Account as a real payment method) | Independent; small; can be pulled earlier if reports need it |

Each phase ships independently and is tested before the next starts.

# Decisions

Resolved 2026-10-27:
- No receipt photo upload.
- Super-admins and users with the approve permission approve on their own; no second person.
- Finance managers may overdraw an account after a confirm dialog.
- Expenses are editable at any time (logged, wallet corrected).
- Commission switches to recovery-based (separate spec).
- No return window.
- Existing damaged/expired stock is written down to zero at go-live.

Still open:
None.
