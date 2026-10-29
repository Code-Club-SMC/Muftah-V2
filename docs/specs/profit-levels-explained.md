# Profit Levels Explained

Date: 2026-06-26

## Three Profit Levels

### 1. Gross Profit

Gross Profit answers:
"After product cost only, did this sale make money?"

Formula:

`Gross Profit = Collected Revenue - Total COGS`

Use it when:
- You want to know if sold goods were priced above their actual sold cost.
- You want first profit layer before payroll, commissions, TA/DA, and other business overhead.

Example:
- Collected Revenue = PKR 1,000,000
- Total COGS = PKR 650,000
- Gross Profit = PKR 350,000

### 2. Direct Profit

Direct Profit answers:
"Did this specific product or recipe make money on its own?"

Formula in product/recipe reports:

`Direct Profit = Collected Revenue - Total COGS`

Why name differs:
- In product and recipe reports, shared company overhead is not allocated down.
- So this number shows profit directly tied to that product or recipe only.

Use it when:
- You compare one product vs another.
- You compare one recipe vs another.
- You want to spot weak items before mixing in company-wide overhead.

### 3. Net Profit

Net Profit answers:
"After all operating costs, is company actually in profit or loss?"

Formula:

`Net Profit = Gross Profit - Operating Expenses`

Operating Expenses include:
- Invoice Expenses
- Payroll
- Commissions
- TA/DA
- General Expenses

General Expenses can also include non-cash failed-batch chemical losses when part of a failed run was not recovered back into stock.

Use it when:
- You want final company answer.
- You want to know if business made money after normal operating costs.

## Margin Terms

### Gross Margin

Gross Margin shows Gross Profit as percentage of Collected Revenue.

Formula:

`Gross Margin = (Gross Profit / Collected Revenue) x 100`

Meaning:
- Higher gross margin usually means stronger pricing or lower sold cost.

### Direct Margin

Direct Margin shows Direct Profit as percentage of Collected Revenue for one product or one recipe.

Formula:

`Direct Margin = (Direct Profit / Collected Revenue) x 100`

Meaning:
- Good for comparing products and recipes fairly.

### Failed Batch Loss

Failed Batch Loss means chemical cost lost on a batch that failed before any sellable output was logged.

Important:
- This should not be pushed into WAC of good stock.
- There were no finished units to absorb that cost.
- So it stays visible as waste / loss.

### Net Impact

Net Impact answers:
"After direct profit and failed-batch waste, did this product or recipe still help or hurt?"

Formula:

`Net Impact = Direct Profit - Failed Batch Loss`

Use it when:
- You want real product/recipe impact without corrupting inventory WAC.
- You want to see if manufacturing waste erased otherwise healthy sales profit.

### Impact Margin

Impact Margin shows Net Impact as percentage of Collected Revenue.

Formula:

`Impact Margin = (Net Impact / Collected Revenue) x 100`

### Net Margin

Net Margin shows Net Profit as percentage of Collected Revenue.

Formula:

`Net Margin = (Net Profit / Collected Revenue) x 100`

Meaning:
- This is bottom-line efficiency.
- If net margin is low, overhead is eating profit.
- If net margin is negative, business is in loss for that period.

## Status Terms

### Profit

The final profit number is above zero.

### Loss

The final profit number is below zero.

### Break-even

The final profit number is almost zero, so the business neither meaningfully earned nor lost money in that period.

### No Activity

There were no meaningful sales or expense movements in the selected period.

## Core Report Terms

### Collected Revenue

Money actually realized from invoices in selected period.

Important:
- Pending or draft invoices do not count.
- Partial invoices count only for paid portion.

### Total COGS

Actual cost of goods sold.

Important:
- Uses saved invoice-line sold cost.
- Not current estimated recipe cost.
- Not current stock price guess.

### Invoice Expenses

Extra invoice-linked costs recognized only in line with the collected part of each invoice.

### Operating Expenses

Business costs outside sold product cost.

In these reports, this means:
- Invoice Expenses
- Payroll
- Commissions
- TA/DA
- General Expenses

### Payroll

Salary and wages paid for selected period.

### Commissions

Sales payouts earned by staff.

### TA/DA

Travel allowance and daily allowance paid or reimbursed for business work.

### General Expenses

Other approved business spending recorded in finance, plus failed-batch chemical write-offs.

Examples:
- utilities
- maintenance
- admin costs

### Reconciliation

Explanation bridge between profit report and wallet/account movement.

Why needed:
- Profit is not always same as cash movement in same period.
- Inventory purchases, advances, manual adjustments, and timing differences can change wallet balance without changing operating profit in same way.

## How To Read Reports Fast

1. Start with status.
   Profit = positive result.
   Loss = negative result.
   Break-even = almost zero result.

2. Check Gross Profit or Direct Profit.
   This shows if sold goods themselves are healthy.

3. Check Net Profit.
   This shows if company stayed profitable after operating expenses.

4. Check margins.
   Margin tells how much profit remains from each rupee collected.

5. Check reconciliation if cash movement feels different from profit.

## Simple Mental Model

- Gross Profit = product made money before overhead.
- Direct Profit = this product or recipe made money before shared overhead.
- Net Profit = company made money after overhead.

## Quick Example

- Collected Revenue = PKR 500,000
- Total COGS = PKR 320,000
- Gross Profit = PKR 180,000
- Operating Expenses = PKR 140,000
- Net Profit = PKR 40,000

Margins:
- Gross Margin = 36%
- Net Margin = 8%

Meaning:
- Product selling is healthy.
- Company still profitable.
- But overhead is taking large share of gross profit.
