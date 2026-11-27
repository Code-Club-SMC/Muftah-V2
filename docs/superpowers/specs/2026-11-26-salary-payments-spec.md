# Salary Payments — Spec

Date: 2026-11-26
Status: Approved (Option A, 2026-11-26)

## Problem

Payslips can be generated and revised on the Payroll Register, but salaries are never paid from an account inside the app.

- The register only offers **Process** and **Revise**. A slip shows **GENERATED** forever.
- A pay-the-whole-payroll action exists in the server code but no screen calls it. Approve has no screen either.
- So no salary money ever leaves a finance account, nothing reaches Finance → Ledger, and nobody can answer "which account paid this salary?".
- Because no payroll is ever approved, the P&L and Monthly report show PKR 0 for salaries (they count only approved or paid payrolls), and the Salaries report is empty (it filters by a payroll paid date that is never set).
- The Ledger's **Payroll** source filter matches the exact text `Payroll`, while payroll entries would be written as `Payroll - Nov 2026`, so the filter would find nothing even if entries existed.

## Goals

1. Pay salaries from a chosen account, for all slips or only some.
2. Show **Paid from** on the register and on each payslip.
3. Change the paying account after the fact without losing history.
4. Allow a paid slip to be revised, with the difference tracked as balance due or overpaid.
5. Undo a payment made by mistake.
6. Every money movement is a Ledger line. Nothing is silently edited or deleted.

## Non-goals

- Bank file exports or online transfers.
- Paying one slip in several part-payments on purpose (a revision can create a second payment, but the normal flow is one payment per slip).
- Changes to how payslip amounts are calculated.
- The order booker self-service portal.

## Core rule

Money already paid is never edited. Corrections are recorded as new entries next to the original: a reversal line, then a new line. The Ledger always matches what really happened.

## Concepts

**Salary payment** — one record per slip payment: which employee, which payroll month, which account, how much, when, by whom, and the Ledger line it created. A slip can have several payments over time (for example, the original payment plus a top-up after a revision).

**Paid amount** for a slip = sum of its active payments.

**Slip payment status**, worked out from net salary and paid amount:

| Status | When |
|---|---|
| Generated (unpaid) | Paid amount is 0 |
| Paid | Paid amount equals net salary |
| Balance due | Paid amount is more than 0 but less than net salary |
| Overpaid | Paid amount is more than net salary |

Payments link to the **payroll + employee**, not to the payslip row. Revise currently deletes the slip and inserts a new one with a new id, so a link to the slip row would break on every revision.

## User flows

### 1. Pay selected slips

- The register gets a checkbox on each row and a "select all" in the header. Only slips with an amount still due can be ticked.
- A **Pay selected** button appears at the top right, beside search, showing the count and total: `Pay 3 salaries · PKR 1,54,474`.
- With nothing ticked, the button reads **Pay all unpaid · PKR X**. It covers every slip with an amount due, across all pages.
- Clicking opens a dialog: the account to pay from, the payment date (defaults to today; from the payroll month's first day to today, see Decisions), a list of who is being paid and how much, and the account's balance before and after.
- If the account doesn't have enough money, the payment is blocked and the dialog shows the shortfall (see Decisions).
- Confirm creates one salary payment and one Ledger debit line per slip, all or nothing.

Example: pay Shahab Gul (100,000) and Anees Ur Rahman (28,424) from Cash today. Cash drops by 1,28,424. The other five stay unpaid, and they're paid from Bank next week.

### 2. Paid from on screen

- The register badge becomes **PAID** with `from Cash in Hand` under it. **BALANCE DUE** and **OVERPAID** badges show the difference.
- A summary strip above the table: `Paid 2 of 7 · PKR 1,28,424 paid · PKR 1,21,430 remaining`.
- The payslip view gets a **Payments** section listing each payment: date, account, amount, who recorded it, and any reversal.
- The payslip print/export shows **Paid from** (or "Not paid yet").

### 3. Change account

- On a paid slip: **Change account**, pick the new account, confirm.
- The original debit is reversed on the old account (a credit line linked to the original). A new debit is made on the new account. The salary payment record moves to the new account, and the old one is kept as reversed.
- Example: Shahab was marked paid from Cash but the bank actually paid. The Ledger shows Cash +100,000 (reversal) and Bank −100,000.
- Changing several slips at once uses the same checkboxes and a **Change account** bulk action.

### 4. Revise a paid slip

- Revise stays available on paid slips, with a warning that the slip is already paid and that any difference will show as balance due or overpaid.
- After saving:
  - **Higher net:** the slip shows `Balance due PKR 2,000`. The difference is paid through the normal pay flow, as a second payment.
  - **Lower net:** the slip shows `Overpaid PKR 3,000` with two choices:
    - **Recover from next month:** the overpaid amount is carried as a deduction into the employee's next payslip, using the existing carry-forward deduction mechanism.
    - **Refund received:** the employee hands back the money into a chosen account, recorded as a credit Ledger line.
- Example: Rafi Ullah was paid 26,200 and 2,000 of overtime is added. His slip becomes 28,200 with 2,000 due.

### 5. Undo payment

- On a paid slip: **Undo payment**, with a reason.
- Each active payment on the slip is reversed (a credit line back to its account), and the slip returns to Generated.
- Allowed only by users with HR manage plus finance manage permission.

### 6. Ledger filter

- The **Payroll** source filter matches every payroll entry (`Payroll - <month>`), including reversals and refunds.
- The Ledger shows, sorts and filters lines by their effective date (the payment date), so a back-dated salary payment appears on the day it was really paid.
- Each payroll Ledger line names the employee and month in its description, for example `Salary — Shahab Gul — Nov 2026`.

## Payroll month status (Option A: no Approve step)

- The client chose to work without an Approve step. A payroll stays in draft, and slips can be generated, revised and paid at any time.
- The register's summary strip shows how much of the month is paid. It is display only and blocks nothing.
- The old Approve / Mark-as-paid server actions stay in the code untouched (an automated payroll test suite uses them), but no screen calls them and the new flow never reads the payroll's status.
- Attendance for a month is not locked by payroll. A revised slip picks up attendance changes, and the difference shows as balance due or overpaid.

## Reports

- **Monthly report:** salaries count every generated slip by payroll month, whatever the payroll status. November slips show in November.
- **Salaries report:** selects slips by payroll month (instead of a payroll paid date that is never set), and gets **Paid from**, **Paid** and **Due** columns.
- **P&L:** salaries count when actually paid. A slip's gross salary falls on the date of its first salary payment. Example: November salaries paid on 2 Dec show in December's P&L. A slip with no payment is not in the P&L yet.

## Permissions

- Paying, changing account, refund and undo need HR manage plus finance manage, because money leaves a finance account.
- Viewing Paid from and payment history needs HR view.

## Data and migration

- New table for salary payments (payroll, employee, account, amount, payment date, entered-at time, the Ledger line, status active/reversed, reversal reason, who and when).
- Existing rows: production has one generated payroll (Nov 2026) with no payments. Its slips start as **Generated (unpaid)**. No Ledger lines are created automatically.
- The old per-payroll account and paid-at fields and the per-slip payment source text stay in place but are no longer written. They can be dropped in a later cleanup.
- Migrations are generated from the schema, never hand-edited.

## Edge cases

| Case | Behaviour |
|---|---|
| Employee deleted or left after being paid | Payment and Ledger lines stay. The slip stays visible in history. |
| Account deleted or archived | Past payments keep their account. It can't be picked for new payments. |
| Two people pay the same slip at the same time | Only one succeeds. The second gets "already paid, refresh". |
| Slip net is 0 or negative (deficit carried forward) | Can't be selected. Shows "Nothing to pay". |
| Advance deduction on a paid slip that's later revised | Advance installments follow the existing revise logic. The payment side only sees the new net. |
| Salesman salary paid by a distributor (offline sales desk) | Shown on the slip as "Paid by distributor"; already deducted from net. See Decisions. |
| Undo after the employee's next month is already generated | Allowed. The next month is unaffected. |

## Decisions

1. **Past salaries:** the current month (Nov 2026) is the first payroll ever generated. Nothing has been paid through the app or recorded as a manual debit, so there is nothing to clean up. All existing slips start as Generated (unpaid). The client asked for this feature directly: they want to choose which of their Finance accounts pays the salaries.
2. **Overdraw: blocked.** A payment fails if the account holds less than the total being paid. The dialog shows the shortfall: `Cash in Hand has PKR 80,000. Needed PKR 1,28,424. Short by PKR 48,424.` This applies to paying, changing account (on the new account) and paying a balance due. Unlike Expenses, there is no override.
3. **Salesman salaries paid by a distributor:** the sales desk already records these as a salary advance, and the advance is deducted on the salesman's next payslip. So the payslip shows a line `Paid by distributor: PKR X`, and only the remaining net is paid from an account. If the distributor paid the whole salary, the net is 0 and the slip shows "Nothing to pay". No finance account is debited for the distributor's part. A mistake there is corrected on the sales desk, not on the payslip.

4. **Payment date: back-dating allowed.** The pay dialog has a payment date that defaults to today. Allowed range: from the first day of the payroll month to today. Future dates are blocked. The Ledger line is dated on the chosen payment date, so account balances on past dates match reality. The record also keeps when it was entered and by whom.
   - Example: salaries are handed out in cash on 30 Nov but entered on 3 Dec. The accountant picks 30 Nov. The Ledger shows the debit on 30 Nov, and the payment history says "Paid 30 Nov · entered 3 Dec by Ali".
   - For the Nov 2026 payroll, any date from 1 Nov 2026 to today is allowed.
   - The same rule applies to a balance-due payment, a refund received, and the new debit when changing account. Reversal lines (change account, undo) are dated on the day the correction is made.

## Testing

- Pure tests for slip payment status (unpaid / paid / balance due / overpaid) and for the totals strip.
- Source-inspection tests that the pay, change-account, refund and undo actions run in one transaction, write a Ledger line for every money movement, and use reversal links instead of deletes.
- Ledger filter test: the Payroll source matches `Payroll - Nov 2026`.
