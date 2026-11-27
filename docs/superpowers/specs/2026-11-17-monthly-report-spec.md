# Monthly Report and Other Income — Spec

Date: 2026-11-17
Source: client's Excel workbook `docs/Monthly Report.xlsx` (sheet "Total 26-27" plus one sheet per month).

## Goal

Give the client their one-page July–June financial summary inside Titan, built from data the system already records, plus a small new "Other Income" entry for by-product sales (empty drums, cans, cartons sold for cash).

## Part 1 — Other Income (Finance)

**Where:** Finance → Other Income, new sidebar item under Expenses.

**Entry form (side sheet):**

| Field | Rule |
|---|---|
| Date | Required. Defaults to today. |
| Item | Required, free text, max 120 chars. Suggests item names used before (non-voided entries). Spaces are trimmed and collapsed. |
| Quantity | Required, above zero, up to 3 decimals. |
| Price each | Required, above zero, rupees with paisa. |
| Amount | Read-only. Quantity × price, rounded to paisa. Must be at least Rs 0.01. |
| Received in | Required. Lists every account from Finance → Accounts with its current balance. |
| Note | Optional, max 500 chars. |

**On save:** one database transaction adds the amount to the chosen account, writes a ledger transaction with source `Other Income` (type credit), and stores the entry.

**Void (no delete):** needs a reason (3–500 chars). Takes the amount back out of the same account, writes a debit ledger transaction with source `Other Income`, keeps the entry visible struck-through with the reason. Refused if the account balance is lower than the amount (message names the account and its balance). A voided entry cannot be voided again.

**List:** month picker (defaults to this month), total of non-voided entries for the month, table of entries: date, item, quantity, price, amount, account, recorded by, void action.

**Permissions:** view needs `finance.view`; record and void need `finance.manage`. Same as Expenses.

## Part 2 — Monthly Report (Reports)

**Where:** Reports hub → new card "Monthly Report" at `/reports/monthly`. Needs `reports.view`.

**Year:** July–June financial year. Picker shows the current year and the 4 before it, labelled `2026-27`. Opens on the current year.

**Columns:** Jul … Jun, Total, Share. Amounts shown in lac (Rs ÷ 100,000, 2 decimals). Current month header marked `*`. A month after the current month shows `–` when it has no value.

**Rows and rules** (month = Pakistan calendar month of the stated date):

| Section | Row | Rule |
|---|---|---|
| Sale | Cash received | Sum of paid amount of non-voided invoices dated in the month. |
| Sale | Credit (unpaid) | Sum of outstanding amount of the same invoices, as of today (choice A: shrinks when credit is recovered later). |
| Sale | By-product | Non-voided Other Income entries dated in the month. |
| Sale | Total sale | Cash + Credit + By-product. Returns are already excluded because paid + returned + outstanding = invoice total. |
| Consumption | Raw material | Chemical cost of mixing batches completed in the month (leftover put back is already negative), plus chemical losses of failed batches settled in the month. |
| Consumption | Packing | Packaging cost of packing jobs completed in the month. |
| Consumption | Salaries | Gross salary on payslips of the payroll for that month, once the payroll is approved or paid. |
| Consumption | One row per expense category | Exactly the categories the client created under Finance → Expense Categories. No category names are hard-coded. Ordered as in category settings. Active, non-archived categories always show; an inactive or archived category shows only when it has spending in the year. The system-made "Supplier Purchase" category (slug `supplier-purchase`) is left out because supplier money is shown under Purchases. Non-voided expenses only, by expense date. |
| Consumption | Total consumption | Sum of the rows above. |
| Result | Difference | Total sale − Total consumption. |
| Result | Without credit | Difference − Credit. |
| Purchases | Raw material / Packing | Non-voided supplier purchases dated in the month, split by material type. Reference only, not added to consumption. |
| Weight sold (ton) | Weight sold | Weight on non-voided invoices dated in the month ÷ 1000. Returned weight is not subtracted. |
| Share column | — | Each consumption row's yearly total ÷ yearly total consumption, whole percent. |

**Summary cards:** Total sale, Total consumption, Difference, Without credit, Weight sold (ton) — yearly totals.

**Click a number:** a side panel lists the records behind it (date, reference, description, amount) with their total. Total, Difference and Without credit rows are not clickable.

**Print:** one A4 landscape page with the standard report header.

**Excel:** downloads a CSV (UTF-8 with BOM, opens in Excel) of the same table, values in rupees, with spreadsheet-formula protection on text cells.

**Phone:** row names stay fixed on the left while months scroll sideways.

## Out of scope

- AKLN line from the client's sheet.
- Stock tracking of by-products.
- The "Standard" price reference tables on the right of the client's sheet.
