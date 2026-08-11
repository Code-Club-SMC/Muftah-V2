# Offline Sales Invoicing Operations Runbook

Keep `OFFLINE_SALES_IMPORT_ENABLED=false` until the full factory drill and sign-off at the end of this document pass.

## What this system does

One official Excel workbook stays on the factory computer before any outage. During an outage, one designated operator records and prints invoices from that workbook. When internet returns, an authorized user uploads it. Titan reads the business rows into PostgreSQL, then discards the uploaded bytes. It stores the filename, size, SHA-256 fingerprint, normalized invoice data, and audit history. It does not store the Excel document.

Online invoices keep `INV-...` numbers. Offline invoices keep the `OFF-F01-YYYYMMDD-serial` number printed during the outage. Import never renumbers them.

## Prepare while online

1. Open **Sales → Offline Invoices → Workbook**.
2. Confirm the correct designated operator. Only this person may edit the official file.
3. Issue the workbook and download it to a known local folder on the factory computer.
4. Open it in Microsoft Excel. Confirm dropdowns, formulas, and the `Print Invoice` sheet work.
5. Keep only one working copy. A backup copy may be kept for recovery, but nobody may enter sales in both copies.
6. Refresh the workbook at the start of a shift when practical. A fresh file has newer distributors, booked orders, prices, stock, limits, and wallet/account choices.

The workbook contains 500 invoice slots, 10,000 item rows, and 2,000 payment rows. The app warns at 50 remaining invoice slots. At zero, no new official offline invoice can be created. Upload all used rows and replace the workbook before another outage.

## During an internet outage

Use only the official workbook. Save after every invoice.

### Direct distributor invoice

1. In `Invoices`, use the next empty row.
2. Enter Sale Date, Sale Time, and choose `direct_distributor`.
3. Choose an existing Distributor Code. Do not type a new distributor.
4. Leave Order Booker Code and Bill Number empty.
5. Enter Payment Due Date when any amount will remain outstanding.
6. In `Items`, choose the generated offline invoice number, product, carton quantity, and loose-unit quantity.
7. If Excel warns that workbook stock is short but staff physically confirm goods exist, choose `YES` under Physical Stock Confirmed. This allows dispatch but creates a stock issue after import.
8. Do not change prices or protected cells. Prices and free-carton rules come from the signed snapshot.
9. In `Payments`, add zero or more rows:
   - Cash: choose `cash`, amount, cash wallet, and Payment Date.
   - Bank transfer: choose `bank_transfer`, amount, bank account, Transfer Reference, and Payment Date.
   - Cheque: choose `cheque`, amount, bank account, cheque bank/number/date, and Payment Date.
   - Pay later: add no payment row for that part. It becomes Outstanding Amount.
10. In `Print Invoice`, select the offline invoice number and print it.
11. Save the workbook before goods leave.

Credit-limit, credit-hold, and stock messages are warnings. They do not block an approved physical dispatch. Staff remain responsible for following factory approval policy.

### Booked-order invoice

1. In `Invoices`, choose `booked_order`.
2. Choose Order Booker Code and enter the matching Bill Number.
3. Leave Distributor Code empty.
4. In `Items`, enter exactly the products and quantities from the booked order. Workbook uses the order's saved prices.
5. Enter payment rows as above, or leave the unpaid part outstanding.
6. Select the invoice in `Print Invoice`, print, and save the workbook.

The print sheet shows existing signature/stamp areas only where the matching current invoice style already has them. It adds no new signature process. Online React invoice print files stay unchanged.

## If the workbook is damaged or lost

### Damaged but readable

1. Stop entering new sales.
2. Make a copy of the damaged file. Never experiment on the only copy.
3. Try Excel's **Open and Repair** on the copy.
4. If it opens, compare every used invoice, item, payment, and print against the last paper invoice.
5. Upload the repaired copy. The server will still verify protected structure, signatures, tokens, values, and formulas.
6. If verification fails, keep the paper invoices and damaged file for technical review. Do not rebuild the official workbook by hand.

### Normal replacement

Use normal replacement only after every used row from the old workbook has been uploaded and no batch remains unfinished. Check the attestation in the app. The old workbook closes, unused slots are voided, and a fresh official workbook is issued in one database transaction.

### Force retirement

Use force retirement only when the file is lost, unsafe, or cannot be recovered. An authorized user must record a clear reason. All unused slots are voided. A later upload from that retired file always becomes **Needs Review** and never posts automatically.

## Upload when internet returns

1. Save and close Excel so the latest rows are on disk.
2. Open **Sales → Offline Invoices → Upload & Review**.
3. Select the `.xlsx` file and enter outage start, outage end, and a clear reason.
4. Upload once. A second upload of the same file or same invoice is recognized as a duplicate; it is not another sale.
5. Review each grouped invoice, its items, payments, source cells, and any warning.

Statuses mean:

- **Ready:** Valid and can post.
- **Warning:** Valid, but a reviewer must read and acknowledge the warning.
- **Duplicate:** Already staged or posted. Do not post again.
- **Invalid:** Workbook data must be corrected and uploaded again.
- **Needs Review:** A human decision is required, such as retired workbook or order conflict.
- **Posted:** Final invoice and accounting effects were saved.

Reviewers may replace a missing or inactive destination wallet only with an active wallet of the same type. They cannot change distributor, product, quantity, price, discount, payment method, or amount in the web review. Correct those values in the official workbook and upload again.

## Order conflicts

If a booked order was already invoiced online or by another offline record, do not create a second delivery. Review the shown candidates and choose only the approved conflict action. A second physical dispatch must be recorded as such and must not deliver the original order or create its commission twice. Keep the reason in the audit trail.

## Stock shortages

Offline posting never makes live stock negative. It deducts available stock to zero and creates an open Stock Issue for the exact deficit.

Resolve the issue from **Stock Issues** using one of these paths:

- **Counted Adjustment:** Physical count confirms an adjustment. Enter the reference and reason.
- **Missing Production/Transfer Record:** Link the missing source record/reference and enter the reason.

Resolution never changes the customer invoice quantity.

## Payments after import

- Cash is confirmed immediately and reaches the cash wallet once.
- Bank transfer remains **Pending Verification** until finance verifies it.
- Cheque remains **Pending Verification** until finance marks it **Cheque Cleared** or **Cheque Returned**.
- **Cheque Returned** means the bank did not clear the cheque. It adds no wallet money.
- Record replacement cash or another payment only after the old instrument is returned/cancelled. Never count both.
- Outstanding Amount is invoice total minus confirmed paid amount and approved returns. Pending transfer/cheque remains outstanding until confirmed.

## Reports

Before import, reports cannot include work that exists only in Excel. Report pages show: `Offline invoices are waiting to be posted. Current reports may be incomplete.`

After posting, regenerate reports and exports. Use source filter **All**, **Online**, or **Offline Import**. Sales, Outstanding, profit, and commission use the original outage sale/fulfilment date. Collections uses each confirmed payment's effective date. Upload/review timestamps remain audit dates, not sale dates.

## Signing-key rotation

Signing keys are server secrets. Never place them in Excel, source control, screenshots, or this runbook.

1. Generate a random 32-byte key and encode it as standard base64.
2. Add it under a new numeric version in `OFFLINE_SALES_SIGNING_KEYS` without removing keys used by active or not-yet-imported workbooks.
3. Set `OFFLINE_SALES_ACTIVE_SIGNING_VERSION` to the new version.
4. Deploy, then issue a fresh workbook.
5. Upload and finish every old workbook before removing its verification key.
6. Removing an old key too early makes its workbook unverifiable.

Example shape only: `{"1":"old-base64-key","2":"new-base64-key"}`.

## Failure and rollback

If posting or reconciliation gives an unexpected result:

1. Stop new offline posting. Keep the feature flag false or turn it false.
2. Do not delete import, invoice, payment, stock-issue, or audit rows.
3. Record workbook fingerprint, batch ID, invoice numbers, payment IDs, and screenshots.
4. Do not directly edit balances in PostgreSQL.
5. Fix and test the application rule, then use an explicit retry, payment reversal, returned-cheque flow, or approved stock correction.
6. Posting is per invoice and idempotent: retrying a completed batch must not create another invoice, payment, stock deduction, order delivery, or commission.

## Required disconnected factory drill

Run in staging with disposable data and a hand-calculation sheet.

1. Issue a fresh workbook to the designated operator.
2. Confirm it is local, opens, calculates, and prints before disconnecting.
3. Disconnect factory internet.
4. Create a direct distributor invoice with cash, bank transfer, and pay later.
5. Create a booked-order invoice with a cheque.
6. Trigger credit and stock warnings. Confirm they do not block approved print/dispatch.
7. Compare direct and booked-order prints with current templates. Confirm existing signatures/stamps are preserved and no new signature appears.
8. Save after each invoice. Close and reopen Excel; recheck every record.
9. Restore internet and upload the same workbook twice.
10. Confirm first upload stages records and second is duplicate.
11. Review and post eligible invoices. Exercise an order-conflict test record.
12. Confirm the `OFF-...` number stays unchanged; cash wallet changes once; transfer/cheque stay pending; Outstanding Amount is correct; stock deficit is exact; order delivers once; commission is created once.
13. Confirm the bank transfer, clear one cheque, return another cheque, then record replacement cash only after return.
14. Resolve the stock deficit through a Counted Adjustment test.
15. Compare invoice, stock, customer ledger, wallets, order, commission, Sales, Outstanding, Collections, Profit/Loss, and audit reports with hand calculations.
16. Regenerate report exports. Confirm dates follow business events, not upload time.
17. Inspect database schema and app storage. Confirm only normalized rows plus filename/size/SHA-256 metadata remain, with no workbook/document bytes.
18. Delete local test downloads manually after evidence is recorded. The app does not own those files.

## Acceptance sign-off

Any failed line keeps `OFFLINE_SALES_IMPORT_ENABLED=false`.

- Factory owner: ____________________  Pass date: __________  Result: ______
- Designated operator: ______________  Pass date: __________  Result: ______
- Finance reviewer: __________________  Pass date: __________  Result: ______
- Inventory reviewer: ________________  Pass date: __________  Result: ______
- Technical owner: ___________________  Pass date: __________  Result: ______
- Evidence/batch IDs: _____________________________________________________
- Open issues: _____________________________________________________________

After every signer records Pass, enable `OFFLINE_SALES_IMPORT_ENABLED=true` in staging and repeat the drill. Production enablement requires the factory owner, finance reviewer, inventory reviewer, and technical owner to approve the production date.
