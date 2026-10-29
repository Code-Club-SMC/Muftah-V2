# Titan ERP desk checklists

Checked against source on 20 October 2026. Use the full manuals for first-time setup and corrections. Examples are not live entries.

## Attendance staff and HR

| Step | What to do | Check before moving on |
| --- | --- | --- |
| 1. Get the file | Export the device's Total Punches report. Keep the original. | Correct dates. CSV or XLSX, up to 10 MB. |
| 2. Preview | HR & Payroll → Attendance → Daily Attendance → Import device report → Upload and preview. | Correct employee for every Person ID. Refresh preview after matching. |
| 3. Import | Read all pages, then click Import N new punches. | Import saved. Blocked rows stay unchanged. |
| 4. Review days | Use Review day. Confirm actual times and resolve missing punches or daily status. | Correct employee and date, duty hours and completed punch pairs. Review the whole cycle. |
| 5. Decisions | Approval Center → Leave Requests and Overtime. | Authorized decisions saved. Overtime suggestions are not approvals. |
| 6. Prepare pay | Payroll → correct payout month → Process or Revise → review → Save Draft Slip. | Attendance, salary, deductions and Net Pay checked for every eligible employee. |
| 7. Check and hand over | View Payroll History → open saved slip → Print / Save PDF. Give reviewed payroll to administrator and finance. | Latest saved and printed Net Pay match. Drafts are not payments. |

**Payroll dates:** October payroll covers 16 September to 15 October. November payroll covers 16 October to 15 November. The selected month is the payout month.

**Stop and check:** Never guess a missing time. Punch edits save immediately. Resolve Missing Attendance Data before paying. Final approval and payment controls are not exposed in the screens checked for this version.

Full instructions: [Attendance and payroll](attendance-and-payroll.md).

## Production operator

1. Open **Production Workstation → Batches**. Find the assigned batch and click **Open batch**.
2. Check the batch number, formula, unit and target. The manager must start the batch first.
3. Enter only new, measured output. Click **Record Bulk Output**. Check **Actual Yield** before entering more.
4. When mixing is finished, check the yield, give a reason for any shortfall and use **Mark Batch as Completed**.
5. On the completed batch, use **Open packing**. Add the exact format.
6. Enter full cartons, packs in a partial carton and loose packs separately. Record actual loss with a reason. Unused bulk stays available.
7. Use **Review packing**. Compare the screen with the physical goods.
8. Click **Confirm & add to finished goods** once. Wait for **Packing saved** and check the receipt.

**Stop and check:** A slow response is not proof that an entry failed. Check the saved result before adding output again. If packing confirmation is interrupted, keep the original draft and use **Retry confirmation** or **Check result before editing**.

## Stores and first sale

1. Set up the **Factory Floor**. Add the supplier under **Suppliers**.
2. In the supplier profile, use **Add Chemical** and **Add Packaging** for initial material registration and receipt. For later deliveries, use **Buy Again → Restock**.
3. Check received quantities, units, costs and actual payments against the supplier invoice.
4. The manager sets up the product, approved mixing formula and packaging format, then creates and starts the batch.
5. Check mixing, packing, the quality decision and physical finished stock.
6. Open **Sales → New Invoice**. Choose the general or distributor invoice and the real customer.
7. For this version's first-sale workflow, select the **active factory floor** as Source Warehouse. Check the format, selling unit, quantity, price and discounts.
8. Enter only actual received payments in the correct account, or use **Pay Later** for approved credit. Click **Generate Invoice** once.
9. Check the saved invoice, print it, and verify stock, outstanding balance and finance entries.

**Remember:** Starting mixing deducts chemicals. Confirming packing deducts packaging and adds finished goods. Generating an invoice deducts sold goods. Do not manually deduct those same goods again.

Full instructions: [Manufacturing through the first sale](manufacturing-to-first-sale.md).
