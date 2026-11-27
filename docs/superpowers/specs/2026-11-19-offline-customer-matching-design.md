# Offline Invoicing Customer Matching — Design

Date: 2026-11-19
Status: Approved in chat, pending spec review

## Problem

When an offline invoice posts, the system picks its customer silently, at the moment of posting. Nobody sees the choice before it happens.

1. **Duplicate customers.** A new walk-in customer is matched to existing customers only by the mobile number exactly as typed. "0300-1234567" and "03001234567" become two customers. A walk-in with no mobile becomes a new customer on every invoice.
2. **Wrong shop on a booked order.** If the shopkeeper's mobile on the booked order does not match any customer, the first customer with exactly the same name is used. Two shops called "Madina Store" means one of them may get the other's invoice.
3. **Review screen hides it.** A walk-in shows "New customer (created when posted)" even when posting will attach it to an existing customer. A booked order shows no customer at all.

Online invoicing from a booked order uses the same weak matching (exact mobile text, then first customer with the same name). There the user sees the result on screen, but a wrong silent pick is still easy to miss.

## Goals

1. Mobile numbers match regardless of spaces, dashes, brackets, or a +92 / 92 country prefix.
2. The customer of every offline walk-in and booked-order invoice is decided when the invoices arrive, saved on the invoice, shown on the review screen, and changeable by the reviewer.
3. Posting uses exactly the saved customer. It never guesses again.
4. A name is used to match only when exactly one customer has it. Otherwise a person picks.
5. Online invoicing from a booked order uses the same mobile cleanup and the same name rule.

## Non-goals

- Cleaning or rewriting mobile numbers already stored on customers. Cleanup happens only during comparison.
- Merging duplicate customers that already exist.
- Changing distributor invoices, or walk-in invoices where the desk already picked an existing customer. Those keep their current behaviour.
- Changing the customer type given to customers created from offline booked orders.
- The order booker self-service portal (not in production use).

## Decisions made in brainstorming

| Question | Decision |
| --- | --- |
| Mobile does not match, but exactly one customer has the shop name? | Use that customer automatically. The reviewer still sees it and can change it. |
| Mobile does not match, two or more customers share the name? | The invoice waits for the reviewer to pick. |
| Apply mobile cleanup to online invoicing too? | Yes, online and offline. |
| Decide the customer at arrival or at posting? | At arrival, saved on the invoice, used as-is by posting. |

## Mobile number cleanup

One shared rule turns any mobile into a comparison key:

1. Keep digits only (drop spaces, dashes, brackets, plus sign, dots).
2. If the result starts with `92` and has 12 digits, replace the leading `92` with `0`.
3. If the result has 10 digits and starts with `3`, put a `0` in front.
4. If nothing is left, or fewer than 7 digits remain, the number is treated as missing and never matches anything.

Examples, all giving `03001234567`: `0300-1234567`, `+92 300 1234567`, `92-300-1234567`, `(0300) 123 4567`, `3001234567`.

The same rule runs on the stored customer mobile inside the database query, so customers saved with messy numbers still match. Customers marked as distributors are never matched by this flow, as today.

## Matching rules

Used for offline walk-in invoices with new-customer details, offline booked-order invoices, and online invoices made from a booked order. The input is a name and an optional mobile.

1. Mobile present and it matches exactly one customer: use that customer. Reason: **mobile**.
2. Mobile present and it matches two or more customers: no automatic pick. Reason: **needs choice** (several customers share this mobile).
3. No mobile match, and exactly one customer of the allowed types has exactly that name: use them. Reason: **name**.
4. No mobile match, and two or more customers share the name: no automatic pick. Reason: **needs choice** (several customers share this name).
5. Nothing matches: new customer. Reason: **new**.

Allowed types for the name match stay as today: shopkeeper and retailer for offline, and shopkeeper, retailer, distributor and wholesaler for online.

## Offline flow

### When invoices arrive (staging)

For each walk-in invoice with new-customer details, and each booked-order invoice whose order was found, run the matching rules:

- For walk-ins, use the new-customer name and mobile typed at the desk.
- For booked orders, use the shopkeeper name and mobile on the order. If the result is **new**, the shopkeeper name, mobile and address from the order are saved as the new-customer details.

The result is saved on the staged invoice:

- **mobile** or **name**: the chosen customer is saved. The new-customer details are kept as typed, for the record.
- **new**: no customer is saved. The new-customer details are saved.
- **needs choice**: no customer is saved. The invoice gets status "needs review" with the issue "Several customers named Madina Store. Pick one." (or the mobile version).

Booked-order invoices approved as a second physical dispatch keep using the customer of the existing invoice, as today. They skip matching.

### Data model

Staged offline invoices get one new nullable field, the **customer match reason**, with one of: `desk` (picked at the desk), `mobile`, `name`, `reviewer`, `new`, `needs_choice`. It exists only to label the review screen and to block posting while a choice is pending.

The migration only adds the nullable field. Existing rows keep a null value (see "Invoices already in review").

### Review screen

Each walk-in and booked-order invoice shows a customer line:

- "Customer: Madina Store, 03001234567 (matched by mobile)"
- "Customer: Madina Store (matched by name)"
- "Customer: Madina Store (picked by reviewer)"
- "New customer: Ali, 03001234567 (created when posted)"
- "Pick a customer: several customers named Madina Store"

A **Change customer** button opens a search over non-distributor customers by name or mobile. The search uses the cleaned mobile, so any format finds the customer. The reviewer can:

- pick an existing customer: the customer is saved, reason becomes `reviewer`, and the "needs choice" issue is cleared, or
- choose **Create new**: the customer is cleared, reason becomes `new`, the issue is cleared. This is only offered when new-customer details exist (always true for walk-ins and booked orders).

After a change the invoice is classified again, exactly as the existing "replace wallet" fix does. Only users with the offline sales review permission can change the customer. It is allowed only while the invoice has not posted and is not excluded.

### Posting

- Walk-in and booked-order invoices use the saved customer. If the saved customer no longer exists or is now a distributor, posting fails for that invoice, which goes back to "needs review" as today.
- An invoice whose reason is `needs_choice` is never posted.
- **New** customers: before creating, posting looks for a customer with the same cleaned mobile that was created by an earlier invoice in the same batch. If found, it is reused. Example: Ali buys twice during an outage and only one "Ali" is created. With no mobile, a new customer is created every time, as there is nothing reliable to match on.
- A booked order's link to the order, and the "replace incorrect online invoice" handling, stay as today.

### Invoices already in review

Staged invoices that are not posted or excluded and have a null match reason (uploaded before this change) are matched with the new rules the next time the batch's review is refreshed. Posted and excluded invoices are never touched.

## Online flow (invoice from a booked order)

When a booked order is opened to make an invoice, its customer is found with the same matching rules:

- **mobile** or **name**: the invoice form opens with that customer selected, as today.
- **new**: the form opens in new-customer mode, filled with the shopkeeper details, as today.
- **needs choice**: the form opens in new-customer mode with the shopkeeper details filled in, plus a notice: "Several customers named Madina Store. Pick the right one or create a new customer." It never silently picks the first one.

Nothing else on the online invoice changes.

## Error handling

- A mobile that is blank or too short after cleanup counts as missing. It never matches and never blocks.
- Search and matching ignore distributors where they do today.
- Changing the customer on an invoice that has posted in the meantime is refused with "This invoice has already posted."

## Testing

- Mobile cleanup: the formats listed above, blank, too short, letters mixed in, 12-digit 92 prefix, 10-digit starting with 3.
- Matching rules: one mobile match, several mobile matches, one name match, several name matches, no match, distributors ignored.
- Staging: walk-in and booked-order invoices save the right customer, reason and status for each rule.
- Review: change customer to existing, to create new, refused after posting, refused without permission, issue cleared and invoice reclassified.
- Posting: uses the saved customer, refuses `needs_choice`, reuses a customer created earlier in the same batch with the same cleaned mobile, fails cleanly when the saved customer became a distributor.
- Existing review rows with no reason get matched on refresh. Posted rows are untouched.
- Online: booked-order conversion returns selected, new, or needs-choice with the notice.
