# Invoice Settlement Operations Runbook

Use this checklist before enabling the redesigned settlement flow for factory users. Test in staging with disposable invoices, wallets, orders, and returns.

## Before the drill

1. Apply migrations and confirm the app starts.
2. Create one cash wallet and one bank wallet.
3. Create a distributor, an order booker, a booked order, and enough stock for the normal cases.
4. Record starting wallet balances, customer Outstanding Amount, stock, and report totals.
5. Keep copies of the current distributor and retailer invoice prints for visual comparison.

## Invoice and payment drill

For every case, confirm the invoice total equals **Paid Amount + Returned Amount + Outstanding Amount**.

1. Full Paid Amount: create a cash invoice. Confirm cash is immediately paid and the cash wallet increases once.
2. Full pay later: create without a payment. Confirm a Payment Due Date is required and the full total remains outstanding.
3. Partial Paid Amount: pay part in cash and leave the rest for later. Confirm only the cash part reaches the wallet.
4. Mixed payment: use cash, bank transfer, cheque, and pay later on one invoice. Confirm cash is paid immediately; bank transfer and cheque show Pending Verification and remain outstanding.
5. Bank confirmation: finance confirms the transfer. Confirm its effective date, wallet increase, invoice Paid Amount, and customer Outstanding Amount all update once.
6. Bank cancellation: cancel a different pending transfer with a reason. Confirm no wallet or Paid Amount change.
7. Cheque clearance: mark a pending cheque Cheque Cleared. Confirm it behaves like a confirmed bank payment.
8. Cheque return: mark another pending cheque Cheque Returned. Confirm the help text says `Bank did not clear this cheque.` and no wallet money is added.
9. Replacement payment: after a returned cheque, record replacement cash. Confirm the invoice can close without counting the returned cheque.
10. Reversal: reverse a confirmed payment with a reason. Confirm a reversing wallet transaction is created and Outstanding Amount increases. Do not edit or delete the original payment.

## Connected workflow drill

1. Batch recovery: allocate payments across several invoices. Confirm each allocation is recorded exactly once and totals cannot exceed each invoice.
2. Booked order: convert an order to an invoice. Confirm its public number starts `INV-`, its stock moves once, its order closes once, and commission is created once.
3. Sales return: approve a partial return. Confirm Returned Amount increases, Outstanding Amount falls, stock follows the existing return rules, and the ledger shows a separate return credit.
4. Deletion protection: confirm invoices with payments or returns cannot be silently changed or deleted.

## Cross-checks

1. Wallet transaction totals equal confirmed payments minus reversals only.
2. Customer ledger balance equals invoice debits minus confirmed payments minus approved returns.
3. Sales, Collections, Outstanding, and Profit/Loss reports use the original business/effective dates.
4. Pending transfers and cheques appear in Collections but not as collected money.
5. Compare distributor and retailer prints with the saved copies. Text, layout, stamps, and existing signatures must be unchanged.

## Release and rollback

- Release only after automated tests, typecheck, build, and this drill pass.
- If a mismatch appears, stop new invoice entry, keep all audit rows, and record the affected invoice/payment IDs.
- Do not repair balances directly in PostgreSQL. Fix the application rule, test it, then use an explicit reversal or approved correction workflow.
