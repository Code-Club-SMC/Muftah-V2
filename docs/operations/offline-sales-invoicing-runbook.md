# Offline Sales Invoicing Operations Runbook

Offline sales needs no settings. It is on by default and signs its invoice numbers with a key derived from `BETTER_AUTH_SECRET`, which every deployment already has. To switch it off, set `OFFLINE_SALES_IMPORT_ENABLED=false`. Run the factory drill at the end of this document before relying on it in a real outage.

If `BETTER_AUTH_SECRET` is ever rotated, send every pending invoice first and then press **Refresh this computer**: invoice numbers issued under the old secret no longer verify. To avoid this, pin the keys by hand with `OFFLINE_SALES_SIGNING_KEYS` (optional, see `.env.example`).

## What this system does

The offline invoice desk is a page inside the web app that keeps working with no internet. Before an outage the factory computer saves the price list and a block of reserved invoice numbers. During an outage the operator makes and prints invoices on that computer. When internet returns the invoices are sent to the office, reviewed, and posted into normal Titan accounting.

Online invoices keep `INV-...` numbers. Offline invoices keep the `OFF-F01-YYYYMMDD-serial` number printed during the outage. Sending and posting never renumber them.

Use the latest Chrome or Edge, over https, on the one factory computer, in the one browser profile. Do not clear browsing data for the Titan site.

## Prepare once, while online

1. Sign in as any user who has the upload offline sales right. No office step is needed: if no invoice numbers have been issued yet, preparing the computer issues them automatically.
2. Open **Sales → Offline Invoices** and choose **Open the offline desk**. Bookmark `/offline-desk`.
3. Press **Prepare this computer**. Wait for the ticks: price list and invoice numbers saved, page works without internet, browser will not delete your invoices.
4. After that nothing needs doing. While the computer is online and has no invoice waiting to be sent, it brings its price list up to date by itself about once an hour (the invoice numbers stay the same). If an invoice is waiting to be sent, the prices stay exactly as printed until it is sent.
5. **Refresh this computer** does the same on demand. When all numbers of a set are used and the office has finished reviewing the last batch, it also issues a fresh set. It refuses to continue while invoices from the old set are still unsent.

The computer keeps prices, free-carton rules, distributors, retailers, booked orders, salesmen, payment accounts and the unused invoice numbers. It does not keep cost prices or credit limits. Customer balances are kept only so the printed invoice can show the previous balance, as the online one does.

A set holds 500 invoice numbers. The desk warns at 50 remaining. At zero, no new offline invoice can be made until the last batch is reviewed and a new set is issued.

## During an internet outage

1. Open the bookmark. The page loads from the computer itself.
2. Choose **Distributor**, **Retailer / walk-in** or **Booked order**, pick the customer, add products, add any freight and any money received, then **Save and print**.
   - A retailer pays the general rate with no free-carton scheme. A distributor pays the distributor rate and gets the saved free-carton scheme. A booked order uses the order's saved rates.
   - A walk-in who is not on the list is entered as a **New customer** (name, and ideally mobile, city, address). The customer is created when the office posts the invoice; the same mobile number is matched to an existing customer.
   - Any invoice (distributor, retailer or booked order) can have an invoice discount, up to the items total, the same as online.
   - Freight and expenses are added to what the customer owes.
   - Free cartons can be given by hand on a line, up to the cartons entered. A distributor is shipped them on top and billed for the cartons ordered. A retailer is billed for the cartons entered less the free ones. Booked orders have none.
   - **Change price** types a carton price over the list, as online. The line shows the original price. The office is asked to check every changed price before posting. Booked orders keep their saved rate.
   - **Salary paid by distributor** records that the distributor paid a salesman's salary instead of paying us. Choose the salesman; no account is used, and the office's posting marks the salary as paid in HR.
   - Payments can be cash, bank transfer, digital account or cheque. They ask for the same details as the online form. Tick **Instant verification** only when the money is already confirmed in the company account.
3. **Save and print** shows the same invoice layout the online system prints (distributor layout for distributors, general layout for everyone else). Opening it locks the invoice. Only an invoice that was never printed can be changed or deleted. A printed invoice that turns out wrong is **cancelled** with a reason: it keeps its number, is sent as cancelled, and never posts.
4. At the end of every shift open **Send & backup** and press **Download backup**. Keep the file on a USB drive or another computer.

The previous balance on a distributor invoice is the balance when the computer was prepared plus what earlier desk invoices to the same customer left unpaid.

Prices and free cartons from the list cannot be edited except through **Change price** and **Free cartons (by hand)**, which are checked by the office. The server recalculates every amount from its own signed price list when the invoices arrive, so a wrong screen can never change what is booked.

Credit-limit, credit-hold, and stock messages in review are warnings. They do not block an approved physical dispatch. Staff remain responsible for following factory approval policy.

## When the internet returns

1. While the desk page is open it checks the server every few seconds. After two good checks in a row a big green **INTERNET IS BACK** banner appears at the top, and the tab title changes. New offline invoices are paused from this moment until the waiting ones are sent.
2. Choose why the internet was down and press **Send N invoices to the office**. The outage start (a minute before the first waiting invoice) and end (when the internet came back) are filled in by the desk. If it says you are signed out, sign in and come back; nothing is lost. The manual form under **Send & backup** still works too.
3. The desk then shows what the office found: ready, warnings, problems. **Review and post** opens Sales → Offline Invoices → Review on that exact batch, where warnings are acknowledged, conflicts and wallets are fixed and the batch is posted. **Go to online invoicing** opens the normal new-invoice screen.
4. Sending the same invoices twice does nothing the second time.

Statuses in review mean:

- **Ready:** Valid and can post.
- **Warning:** Valid, but a reviewer must read and acknowledge the warning (for example a changed price, a stock shortage, or a printed total that differs from the system's total).
- **Duplicate:** Already received. Do not post again.
- **Invalid:** Something is wrong. Fix it on the desk and send again.
- **Needs Review:** A human decision is required, such as a retired set of numbers or an order conflict.
- **Excluded:** Not posted. This includes invoices cancelled on the desk.
- **Posted:** Final invoice and accounting effects were saved.

Reviewers may replace a missing or inactive destination account only with an active account of the same type. They cannot change customer, product, quantity, price, discount, payment method, or amount in the web review. Fix those on the desk before sending, or void the posted invoice in Sales → Invoices.

## If the browser data is lost

Upload the latest backup `.json` file in **Sales → Offline Invoices → Review → Upload a backup file**. Invoices that were already sent are recognised and skipped. Paper copies are the last record: enter any invoice missing from the backup through the normal invoice screens.

## Invoice numbers

There is nothing to issue or replace by hand. The first time the desk is prepared it gets 500 reserved numbers, and when they are all used (and the last batch is reviewed) pressing **Refresh this computer** gives it a new set. The office can see the current set under **Sales → Offline Invoices → Invoice numbers**.

### If the factory computer is lost or stolen

Use **Computer lost or stolen** on that tab and record a clear reason. All unused numbers are voided. Invoices sent later from that computer always become **Needs Review** and never post automatically. The next time the desk is prepared on a replacement computer it gets a new set.

## Order conflicts

If a booked order was already invoiced online or by another offline record, do not create a second delivery. Review the shown candidates and choose only the approved conflict action. A second physical dispatch must be recorded as such and must not deliver the original order or create its commission twice. Keep the reason in the audit trail.

## Stock shortages

Offline posting never makes live stock negative. It deducts available stock to zero and creates an open Stock Issue for the exact deficit.

Resolve the issue from **Stock Issues** using one of these paths:

- **Counted Adjustment:** Physical count confirms an adjustment. Enter the reference and reason.
- **Missing Production/Transfer Record:** Link the missing source record/reference and enter the reason.

Resolution never changes the customer invoice quantity.

## Payments after posting

- Cash is confirmed immediately and reaches the cash account once.
- Bank transfer and digital account payments remain **Pending Verification** until finance verifies them, unless **Instant verification** was ticked.
- Cheque remains **Pending Verification** until finance marks it **Cheque Cleared** or **Cheque Returned**.
- **Cheque Returned** means the bank did not clear the cheque. It adds no account money.
- Record replacement cash or another payment only after the old instrument is returned/cancelled. Never count both.
- A salary paid by the distributor settles the invoice amount and is recorded as a salary advance in HR.
- Outstanding Amount is invoice total minus confirmed paid amount and approved returns. Pending transfer/cheque remains outstanding until confirmed.

## Reports

Before posting, reports cannot include work that exists only on the desk. Report pages show: `Offline invoices are waiting to be posted. Current reports may be incomplete.`

After posting, regenerate reports and exports. Use source filter **All**, **Online**, or **Offline Import**. Sales, Outstanding, profit, and commission use the original outage sale/fulfilment date. Collections uses each confirmed payment's effective date. Send/review timestamps remain audit dates, not sale dates.

## Signing-key rotation (optional)

By default no key is configured. To pin keys by hand, set `OFFLINE_SALES_SIGNING_KEYS` and `OFFLINE_SALES_ACTIVE_SIGNING_VERSION`. Keys are server secrets. Never place them in source control, screenshots, or this runbook.

1. Generate a random 32-byte key and encode it as standard base64.
2. Add it under a new numeric version without removing keys used by active or not-yet-reviewed invoice numbers.
3. Set `OFFLINE_SALES_ACTIVE_SIGNING_VERSION` to the new version.
4. Deploy, then replace the invoice numbers.
5. Send and finish every old batch before removing its key.
6. Removing an old key too early makes its numbers unverifiable.

Example shape only: `{"1":"old-base64-key","2":"new-base64-key"}`.

## Failure and rollback

If posting or reconciliation gives an unexpected result:

1. Stop new offline posting. Set `OFFLINE_SALES_IMPORT_ENABLED=false`.
2. Do not delete batch, invoice, payment, stock-issue, or audit rows.
3. Record the batch ID, invoice numbers, payment IDs, and screenshots.
4. Do not directly edit balances in PostgreSQL.
5. Fix and test the application rule, then use an explicit retry, payment reversal, returned-cheque flow, or approved stock correction.
6. Posting is per invoice and idempotent: retrying a completed batch must not create another invoice, payment, stock deduction, order delivery, or commission.

## Required disconnected factory drill

Run in staging with disposable data and a hand-calculation sheet.

1. Prepare the factory computer as the operator and confirm all three ticks. Change a price in the system, wait for the desk to refresh (or press Refresh this computer), and confirm the new price shows on the desk.
2. Disconnect factory internet, or stop the server.
3. Reload the offline desk and confirm it opens.
4. Make a distributor invoice with cash, bank transfer, and pay later. Include a scheme free carton.
5. Make a retailer invoice with a discount and freight, a distributor invoice with a discount, and a new walk-in customer invoice.
6. Make a booked-order invoice with a cheque.
7. Make an invoice with a changed price, free cartons by hand, and a salary paid by a distributor.
8. Compare each printed invoice with the current online templates.
9. Cancel one printed invoice and delete one unprinted invoice. Confirm the numbers behave as described above.
10. Download a backup. Close and reopen the browser; confirm every invoice is still there.
11. Restore internet and send. Send the same invoices again and confirm the second send is recognised as already received.
12. Review the batch. Confirm the changed price shows as a warning, the cancelled invoice as excluded, and the new customer is shown.
13. Post the eligible invoices. Confirm the `OFF-...` numbers stay unchanged; cash account changes once; transfers and cheques stay pending; Outstanding Amount is correct; stock deficit is exact; order delivers once; commission is created once; the new customer exists; the salary advance appears in HR.
14. Confirm the bank transfer, clear one cheque, return another cheque, then record replacement cash only after the return.
15. Resolve a stock deficit through a Counted Adjustment test.
16. Compare invoice, stock, customer ledger, accounts, order, commission, Sales, Outstanding, Collections, Profit/Loss, and audit reports with hand calculations.
17. Regenerate report exports. Confirm dates follow business events, not send time.
18. Upload the backup file in Review and confirm every invoice is recognised as already received.

## Acceptance sign-off

Any failed line means the feature stays switched off (`OFFLINE_SALES_IMPORT_ENABLED=false`).

- Factory owner: ____________________  Pass date: __________  Result: ______
- Designated operator: ______________  Pass date: __________  Result: ______
- Finance reviewer: __________________  Pass date: __________  Result: ______
- Inventory reviewer: ________________  Pass date: __________  Result: ______
- Technical owner: ___________________  Pass date: __________  Result: ______
- Evidence/batch IDs: _____________________________________________________
- Open issues: _____________________________________________________________

Production enablement requires the factory owner, finance reviewer, inventory reviewer, and technical owner to approve the production date.
