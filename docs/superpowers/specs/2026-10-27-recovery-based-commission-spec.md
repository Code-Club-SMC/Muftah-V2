# Recovery-Based Order Booker Commission — Spec

Date: 2026-10-27
Status: Draft for review
Related: Sales Returns Overhaul spec (2026-10-27), which this replaces for commission handling (its Fix 6).

## Why

Today an order booker earns commission the moment their order is delivered, on the full delivered amount, in the month of delivery. Whether the customer ever pays, or sends goods back, makes no difference.

That causes three problems:
1. **Commission is paid on money never collected.** Bad debts still cost the company a commission.
2. **Returns need a clawback.** Commission was already paid on goods that came back, so the company has to claw it back later, possibly pushing a booker's month below zero.
3. **Bookers are rewarded for booking, not for healthy sales.** Nothing pushes them to sell to customers who pay.

## The new rule (one sentence)

**An order booker earns commission only when customer money for their order is actually received and confirmed, and only on that amount.**

### Example

Bilal's order is delivered on 5 October for Rs 5,00,000. His rate is 2%.

| Date | Event | Commission earned |
|---|---|---|
| 5 Oct | Delivered, Rs 5,00,000 invoice | Rs 0 (nothing collected yet) |
| 20 Oct | Customer pays Rs 2,00,000 cash | Rs 4,000 (October) |
| 2 Nov | Customer returns Rs 1,00,000 of goods | Rs 0 (no money came in) |
| 15 Nov | Customer pays the final Rs 2,00,000 | Rs 4,000 (November) |
| **Total** | Collected Rs 4,00,000 | **Rs 8,000** |

The returned Rs 1,00,000 was never paid, so it never earned commission. Nothing has to be clawed back.

## Detailed rules

### R1. Rate is decided at delivery, applied at recovery
- When the order is delivered, the system works out the booker's rate from their slabs (or flat rate) using the delivered amount, the same calculation as today.
- That **effective rate is locked** on the order and shown to the booker as "Commission rate for this order: 2%".
- Every confirmed recovery earns: *recovered amount × locked rate*.
- Changing a booker's slabs later affects only orders delivered after the change.

### R2. What counts as a recovery
| Money event | Earns commission? |
|---|---|
| Cash payment (confirmed) | Yes |
| Bank transfer (confirmed) | Yes |
| Digital Account: EasyPaisa / JazzCash / Raast (verified) | Yes, same as bank transfer |
| Cheque | Only when it clears (confirmed), not when received |
| Payment taken at invoice creation (advance / on-spot) | Yes, once confirmed |

Example: Bilal delivers Rs 1,00,000 and the customer pays Rs 40,000 cash on the spot. Bilal earns Rs 800 that day. The remaining Rs 60,000 earns Rs 1,200 whenever it is paid. A cheque given on the spot earns only when it clears.
| Salesman Salary Paid by Distributor (expense offset) | Yes, it clears real debt. Example: distributor pays Rs 70,000 cash plus our salesman's Rs 30,000 salary; the booker earns on the full Rs 1,00,000 |
| Sales return / credit note | No, no money came in |
| Customer credit applied from an earlier return | No, it is not new money |
| Manual adjustment or write-off | No |

### R3. Cap at what was really owed
Commission is earned on recoveries only up to the invoice's net amount (invoice total minus returns). If a customer overpays, the excess earns nothing.

### R4. Bounced cheques and reversed payments
When finance marks a confirmed payment as reversed or a cheque as bounced, the same dialog asks who bears the commission already earned on it:

```
Commission on this payment: Rs 4,000 (Bilal Ahmed)

Who bears it?
  (•) Deduct from booker
  ( ) Company bears the loss
```

- **Deduct from booker** (default): a negative commission entry for the earned amount is created, dated on the reversal date. If it makes the booker's month negative, that month pays Rs 0 and the rest carries to the next month(s) until recovered.
- **Company bears the loss:** no deduction. The booker keeps the commission; the choice and who made it are logged.
- The dialog only shows this question when commission was actually earned on that payment.

Example: Bilal earned Rs 4,000 on a cheque in October. It bounces in November, when he earns Rs 1,000.
- Deduct from booker: November pays Rs 0, Rs 3,000 carries to December. December earns Rs 10,000, pays Rs 7,000.
- Company bears the loss: November pays Rs 1,000, December pays Rs 10,000.

### R5. Month of earning
Commission belongs to the month the payment is confirmed (its effective date), not the delivery month. Payroll for a month sums all commission entries dated in that month.

### R6. Who earns
The booker on the original order always earns, even if a salesman or recovery officer collects the money. Commission for collectors is not covered here.

### R7. Suppressed orders
Orders currently posted with commission suppressed stay suppressed: their recoveries earn nothing.

## Switching over

From release onward, **nothing is ever earned on delivery**. Commission is earned only on recovered money, and never twice for the same rupee.

Old orders (delivered before release) are handled like this:

- **Old delivery commission not yet paid in a payslip:** cancelled. The order switches to recovery-based. Payments confirmed from release onward earn commission at the order's rate.
- **Old delivery commission already paid in a payslip:** stays as history (the money is already out). Later payments on that order earn nothing, so the booker is never paid twice.

Example:
- Order A, delivered 20 November, Rs 2,000 delivery commission still unpaid. At release that Rs 2,000 is cancelled. Customer pays Rs 1,00,000 in December, Bilal earns Rs 2,000 in December.
- Order B, delivered in October, Rs 2,000 delivery commission already paid in October's payslip. Customer pays in December, Bilal earns nothing more.
- Order C, delivered after release, earns only when its money comes in.

Bookers will see lower commission in the first month or two as pending recoveries build up. Communicate this before go-live.

## Screens

The order booker self-service portal is not in production use and is out of scope.

Existing screens updated:
1. **Commission tab**: Sales → People → Order Bookers tab → click a booker → Commission tab.
2. **Payslip**: HR → Payroll → click an employee → open a payslip (also reachable from HR → Employees → click an employee).

New section:
3. **Commission summary**: Sales → People → Order Bookers tab, above the existing list of bookers.

### Commission tab (manager, per booker)
Four headline numbers for the chosen month:
- **Delivered:** value of orders delivered this month.
- **Collected:** money confirmed this month against any of their orders.
- **Earned:** commission earned this month.
- **Waiting:** commission they will earn if all money still owed on their orders is paid.

Below: a list of invoices with delivered, returned, collected and still-owed amounts, locked rate, and commission earned so far. Clicking an invoice shows each payment and its commission line, including any bounced-cheque deductions.

### Payslip
The commission line reads "Commission on recoveries: Rs 12,400 (18 payments)" with a separate "Deductions (reversed payments): −Rs 600" line when applicable, and "carried forward" when a deduction exceeds the month's commission.

### Commission summary (new section on the Order Bookers tab)

```
Commission summary                                                   [ <  October 2026  > ]

┌────────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ Order Booker   │   Delivered │    Returned │   Collected │      Earned │  Still owed │     Waiting │
├────────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ Bilal Ahmed    │   12,40,000 │      60,000 │    9,80,000 │      19,600 │    5,20,000 │      10,400 │
│ Usman Tariq    │    8,50,000 │           0 │    7,90,000 │      11,850 │    1,10,000 │       1,650 │
│ Kamran Ali     │    4,20,000 │      35,000 │    2,10,000 │       2,100 │    3,60,000 │       3,600 │
├────────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ Total          │   25,10,000 │      95,000 │   19,80,000 │      33,550 │    9,90,000 │      15,650 │
└────────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

Columns (all amounts in Rs, month = the one picked at top right):
- **Delivered:** goods delivered this month on the booker's orders.
- **Returned:** goods returned this month on the booker's orders (completed returns).
- **Collected:** money confirmed this month on any of the booker's orders, old or new.
- **Earned:** commission for this month (Collected × each order's locked rate, minus reversals). This is what goes on the payslip.
- **Still owed:** money customers still owe on all the booker's orders, as of the end of the month.
- **Waiting:** commission the booker will earn if all of Still owed is paid.

Behaviour: month picker defaults to the current month; every column sorts; clicking a row opens that booker's Commission tab for the same month; Total row stays at the bottom.

## Data changes (conceptual)

- Order: locked commission rate.
- New **commission earnings ledger**: one row per confirmed payment (positive) or reversal (negative), linked to booker, order, invoice and payment, with amount, rate, date and the payslip it was paid in. Rows are never edited; corrections are new rows.
- Existing delivery-based commission records stay as history and continue to be read for older months.

Schema changes go through the normal generated-migration process only.

## Behaviour to test

1. Full payment in one go: earned = amount × rate, dated payment month.
2. Partial payments across two months: split correctly by month.
3. Return then payment of the rest: commission only on money paid.
4. Overpayment: commission capped at net invoice.
5. Cheque received but not cleared: no commission; cleared: commission on the clear date.
6. Cheque bounces after month paid, "Deduct from booker": negative entry in the bounce month; carry-forward when larger than that month's commission. "Company bears the loss": no entry, choice logged.
7. Customer credit applied to a new invoice: no commission.
8. Old order with delivery commission already in a payslip, paid after release: no new commission.
9. Old order with unpaid delivery commission: that commission is cancelled; payments after release earn at the order's rate.
10. Booker slabs changed after delivery: old orders keep their locked rate.
11. Suppressed order: no commission on any recovery.
12. Payment confirmed twice by retry/race: only one commission entry.

## Decisions

Resolved 2026-10-27:
- "Salesman Salary Paid by Distributor" (expense offset) earns commission like cash.
- No reduction for late payments: money collected at any time earns the full locked rate.
- No cutover date. Nothing is ever earned on delivery. Unpaid old delivery commission is cancelled and those orders switch to recovery; already-paid old delivery commission stays and those orders earn nothing more.
- Reversed payments: finance chooses per case between "Deduct from booker" (default, carried forward) and "Company bears the loss".
- A return never lowers the locked rate, even if it drops the order below a slab.

## Open decisions

None.
