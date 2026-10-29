# Distributor Ledger — Complete Guide & Audit

**Titan ERP — Al-Madina Distributors**
**Period:** 01 Jun 2026 – 30 Jun 2026

---

## What Is This Report?

This ledger is a **statement of account** for Al-Madina Distributors. It works like a mobile phone bill:

- It shows what you **already owed** from last month
- It shows what you **bought** this month
- It shows what you **paid back** this month
- It shows what you **still owe** at the end

Everything is in Pakistani Rupees (PKR).

---

## The Summary Cards — One by One

At the top of the ledger, there are **5 summary cards** that give you a quick snapshot.

---

### 1. Opening Balance → PKR 1,450,000

> *"How much did Al-Madina owe us before this month started?"*

This is the **brought-forward debt** from all previous months. It's what was unpaid when June began.

- **Red color** = they owe us money (normal)
- **Green color** = account is settled

---

### 2. Period Sales → PKR 500,000

> *"How much did we sell to Al-Madina this month — in total?"*

This is the **total value of all invoices** raised during June. It includes everything — both what they paid in cash at delivery and what they took on credit.

In the sample: One invoice (#SLIP-1005) worth PKR 500,000 total.

---

### 3. Period Payments → PKR 0.00

> *"How much did Al-Madina pay us back this month — through bank transfer, cheque, etc.?"*

This counts only **separate repayments** against their outstanding debt — like a bank transfer or cheque. It does NOT count cash collected at the time of delivery.

**Why it shows PKR 0 in the sample:** Al-Madina made a cash payment of PKR 200,000 at delivery. But since that cash was the "pay now" part of the invoice itself, the system doesn't count it here. It's treated as already settled. Only post-delivery repayments (like a bank transfer next week) would show up on this card.

---

### 4. Closing Balance → PKR 1,750,000

> *"How much does Al-Madina owe us right now?"*

This is the **most important number** on the whole report. It's the bottom line.

**How it's worked out:**
```
What they owed at the start:          1,450,000
Plus what they took on credit:       +  300,000
Minus what they paid back:           −        0
                                     ──────────
What they owe now:                    1,750,000
```

- The **cash portion** (PKR 200,000) was paid at delivery, so it doesn't add to the debt
- The **credit portion** (PKR 300,000) was not paid yet, so it gets added to the balance
- No separate repayments were received, so nothing is subtracted

---

### 5. Entries → 2

> *"How many transactions are showing on this page?"*

A simple count. In the sample: 1 invoice + 1 cash payment = 2 entries. If you search or filter, this number updates to show only matching entries.

---

## The Quick Stats Panel (Right Side)

Below the aging chart, there's a small panel with extra detail:

| Stat | Value | What It Means |
|---|---|---|
| **Total Cash** | PKR 200,000 | Cash collected at the time of delivery across all invoices |
| **Total Credit** | PKR 300,000 | Amount sold on credit — to be collected later |
| **Invoices** | 1 | Number of invoices raised this month |
| **Payments** | 0 | Number of separate (non-cash) repayments received |
| **Overdue** | PKR 1,750,000 | Total amount considered past due |

**Quick check you can do:** Total Cash + Total Credit should always equal Period Sales.
In the sample: 200,000 + 300,000 = 500,000 ✓

---

## The Transaction Table (Main Table)

This is the detailed list of every transaction in date order. Each row is either an **Invoice** (goods sold) or a **Payment** (money received).

### The Columns

| Column | What It Tells You |
|---|---|
| **Date** | When it happened |
| **Description** | Invoice number, warehouse name, or payment details |
| **Debit** | For invoices: the amount **added** to what they owe |
| **Credit** | For payments: the amount **subtracted** from what they owe |
| **Balance** | What they owe **after** this transaction |

### Reading the Sample Table

**Row 1 — Invoice #SLIP-1005 (05 Jun 2026)**
```
Debit:    PKR 300,000  ← credit portion (what they didn't pay for immediately)
Credit:   —
Balance:  PKR 1,750,000  ← opening balance + credit portion
```
This means: "We sold them PKR 500,000 worth of goods. They paid PKR 200,000 in cash right away. The remaining PKR 300,000 was added to their debt."

**Row 2 — Cash Payment (05 Jun 2026)**
```
Debit:    —
Credit:   PKR 200,000
Balance:  PKR 1,750,000  ← unchanged (cash doesn't affect the running balance)
```
This row is shown for **transparency** — so you can see the cash was collected. But since this cash was the "pay now" part of the invoice, it doesn't change the balance. The balance already excluded it.

---

## Invoice Line Items (Expandable)

When you click on an invoice row, it expands to show exactly what was sold:

| Column | Meaning |
|---|---|
| **Product** | What was sold (e.g., "Dishwash Liquid 1L") |
| **Cartons** | How many cartons |
| **Free** | Free cartons given as promotion |
| **Disc.** | Discounted cartons |
| **Price/Carton** | Rate per carton |
| **Amount** | Total for that product |

Below the product table you'll also see: invoice status, cash amount, credit amount, credit due date, and any remarks.

---

## Aging Analysis (Right Side)

This breaks down the total outstanding by **how late** each amount is:

| Bucket | Meaning |
|---|---|
| **Current** | Not yet overdue — payment date hasn't passed |
| **1–30 Days** | 1 to 30 days late |
| **31–60 Days** | 1 to 2 months late |
| **61–90 Days** | 2 to 3 months late |
| **90+ Days** | More than 3 months late — highest risk |

**In the sample:** The opening balance (PKR 1,450,000) goes into the 90+ Days bucket since it's from before this month. The new credit (PKR 300,000) is also flagged based on how many days have passed since the invoice date.

**What to look for:** The sum of all aging buckets should equal the Closing Balance. If they don't match, there's a problem.

---

## How the Balance Flows — Step by Step

Think of it as a running total:

```
1. Month starts → they owe PKR 1,450,000 from before

2. Invoice #SLIP-1005 arrives:
   Total bill: PKR 500,000
   Paid in cash: PKR 200,000 (settled immediately, doesn't affect debt)
   Taken on credit: PKR 300,000 (added to debt)
   → New balance: 1,450,000 + 300,000 = PKR 1,750,000

3. Cash payment of PKR 200,000 recorded:
   This is the same cash from step 2, shown separately for transparency
   → Balance stays: PKR 1,750,000 (no change)

4. Month ends → Closing Balance: PKR 1,750,000
```

---

## Audit Findings — Things to Be Aware Of

### Issue 1: On-Screen vs. Printed Debit Column Show Different Numbers 🔴

**What you'll see:** On your computer screen, the Debit column for Invoice #SLIP-1005 shows **PKR 500,000** (the full invoice). But if you print or export to PDF, the same column shows **PKR 300,000** (only the credit portion).

**What this means:** The screen and the printed statement disagree. If you show the screen to the distributor and then hand them a printout, they'll see different numbers for the same invoice.

**What should happen:** Both should show the same number. Since the running balance only changes by the credit portion, showing the credit portion in the Debit column would be more consistent.

---

### Issue 2: Cash Payment Row Looks Like It's Ignored 🟡

**What you'll see:** A row says "Payment (cash) — PKR 200,000" appears in the table, but the balance doesn't change.

**What the distributor might think:** "I paid PKR 200,000 but they didn't credit it to my account!"

**What's actually happening:** The cash was the "pay now" part of the invoice. It was never added to the debt in the first place, so there's nothing to subtract. The row is there for visibility only.

**What should happen:** The cash payment row should have a clear label like "Cash at delivery — does not reduce balance" so nobody is confused.

---

### Issue 3: Product Line Items Don't Add Up to Invoice Total 🟡

**What you'll see:**
```
Dishwash Liquid 1L:  277 cartons × PKR 1,800 = PKR 498,600
Bleach 1L:             2 cartons × PKR   800 = PKR   1,600
                                              ─────────────
Sum of line items:                           = PKR 500,200
Invoice total:                               = PKR 500,000
Difference:                                  = PKR     200
```

**What this means:** The individual products don't add up to the invoice total. There's a PKR 200 gap. This could be a rounding issue, a discount not shown, or a data entry error.

**What should happen:** The system should check at invoice creation time that all line items sum to the invoice total, and warn if they don't.

---

### Issue 4: Overdue Amount Is Always the Same as Closing Balance 🟡

**What you'll see:** The Overdue Amount card shows PKR 1,750,000 — exactly the same as the Closing Balance.

**What this means:** The system treats ALL unpaid credit as overdue, even if the distributor's payment deadline hasn't passed yet. For example, if an invoice says "pay by 30 Jul" and it's only 10 Jun, that amount shouldn't be overdue yet.

**What should happen:** Only amounts past their agreed payment deadline should count as overdue. Invoices with a future due date should appear as "Current" in the aging analysis.

---

### Issue 5: Aging Buckets Don't Reflect Payments 🔴

**What you'll see:** If the distributor makes a big repayment, the aging buckets still show the full original amounts. The payments don't reduce any specific bucket.

**What this means:** The aging analysis can show a higher risk than reality. For example, if they owed PKR 1,000,000 from 90+ days ago and paid back PKR 800,000, the 90+ Days bucket should show PKR 200,000. Instead, it still shows PKR 1,000,000.

**What should happen:** When a payment is received, it should reduce the oldest outstanding amount first. This is the standard way aging works in accounting.

---

### Issue 6: Email Feature Doesn't Actually Send Emails ℹ️

**What you'll see:** The Export menu has an "Email Ledger" option that appears to work (shows a success message).

**What's actually happening:** No email is sent. This is a placeholder that hasn't been connected to an email service yet.

**What should happen:** Either build the email feature or hide the button until it's ready, so nobody relies on it.

---

## Summary of Issues

| # | Issue | Impact | Priority |
|---|---|---|---|
| 1 | Screen and print show different debit numbers | Distributor gets conflicting information | Fix first |
| 2 | Cash payment row looks like it's ignored | Distributor thinks payment wasn't credited | Fix soon |
| 3 | Product totals don't match invoice total | Charges can't be verified | Fix soon |
| 4 | Overdue amount is always the full balance | Distributor looks worse than they are | Fix soon |
| 5 | Aging doesn't subtract payments | Credit risk is overstated | Fix first |
| 6 | Email button doesn't work | Users think ledger was sent when it wasn't | Fix when possible |

---

## What's Working Well

- The **Opening Balance → Closing Balance** arithmetic is correct and consistent
- **Period Sales** correctly decomposes into Cash + Credit
- The **running balance** in the transaction table follows the balance forward properly
- **Sorting, searching, filtering, and pagination** all work correctly
- The **print/PDF layout** is professional and includes all necessary details (company info, NTN/STRN, watermark, page numbers)
- **Audit logging** records who viewed the ledger and when
- **CSV export** includes full detail with line items and summary section

---

*This guide was prepared to help understand how the distributor ledger works, what each number means, and where improvements are needed. All findings are based on a review of the actual system code and the sample ledger for Al-Madina Distributors.*
