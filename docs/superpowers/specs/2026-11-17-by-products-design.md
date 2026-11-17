# By-Products — Design

Date: 2026-11-17
Status: Approved in chat, pending spec review

## Problem

Stock such as Soda arrives in containers (for example 100kg drums). Once the stock inside is used, the empty container is a by-product the business sells. Today the Other Income page lets staff type any item name and amount, with no link to what was bought or used. Nothing tells managers how many empty drums they should have on hand.

## Goals

1. Every purchase has a "By-product" checkbox. When it is ticked, the purchase records its container name and container size.
2. The Other Income page is renamed "By-Products". It shows each tracked by-product with how many empties were earned, how many were sold, and how many are in hand.
3. As stock is used, the empties-earned count goes up on its own. By-products are unique per stock item plus container: "Soda – 100kg Drum" and "SLES – 100kg Drum" are separate lines.

## Non-goals

- Free-typed income items (scrap and so on). The sale form only offers tracked by-products.
- Tracking which physical container came from which purchase. Stock is pooled by item and price, so the count is worked out oldest purchase first.
- Fixing up old Other Income rows. There is no production data yet (see project memory, 2026-10-28).

## Decisions made in brainstorming

| Question | Decision |
| --- | --- |
| Container size fixed per item or per purchase? | Per purchase. Each purchase enters its own container name and size. |
| Which stock-outs empty containers? | All stock leaving the store: mixing, packing, loss adjustments and so on, minus stock returned to the store. Transfers between stores and purchase edits/voids are not use. |
| Can sales go beyond what is in hand? | No. Only tracked by-products, capped at the in-hand count. |
| Stored counter or worked out live? | Worked out live from purchases and lot movements, so edits and voids can never leave it out of step. |

## Data model

### `purchase_records` — new columns

- `by_product_tracked boolean not null default false`
- `container_name text null`: for example "Drum", "Bag", "Can". Trimmed, inner spaces collapsed, stored in title case so "drum " and "Drum" match.
- `container_size decimal(12,3) null`: in the item's own stock unit (kg, liters or units).
- Check: when tracked, both fields are set, size > 0, and `quantity / container_size` is a whole number. When not tracked, both are null.

### By-product identity

A by-product is the key `(material_type, chemical_id | packaging_material_id, container_name, container_size)`. It is not a table of its own. It is the set of distinct keys across non-voided tracked purchases. Display label: `"<item name> – <size><unit> <container name>"`, for example "Soda – 100kg Drum".

### `other_income` — changes

The table keeps its name, so ledger rows and the monthly report keep working. Changes:

- Add `chemical_id`, `packaging_material_id` (exactly one set), `container_name`, `container_size`: the by-product key of the sale.
- `quantity` must be a whole number (number of containers sold).
- `item_name` stays as a saved display label written when the sale is recorded, for the history list and monthly report drill-down.

The schema is changed in source and the migration is generated with `bun run db:generate`. Migration files are never hand-edited.

## Counting empties (pure function)

New module `src/lib/inventory/by-products.ts`, kept pure so it can be unit tested.

Input for one stock item:

- `openingQty`: the item's stock that came from `opening` lot movements (stock that existed before purchases were recorded).
- `purchases`: non-voided purchases of the item, oldest first by `purchase_date`, then `created_at`. Each has `quantity`, `tracked`, `containerName`, `containerSize`.
- `usedQty`: total stock used, which is the sum of `-delta` over all lot movements of the item except types `opening`, `purchase`, `purchase_edit`, `purchase_delete`, `transfer_out`, `transfer_in` and `warehouse_close`. Returns such as `mixing_return` and `recovery` are positive deltas, so they lower the total on their own. Never below 0.

Steps:

1. Take used stock out of `openingQty` first.
2. Take what is left from each purchase in order, up to that purchase's quantity. Untracked purchases use up their share but give no empties.
3. For a tracked purchase, empties = `floor(usedFromPurchase / containerSize)`.
4. Add up empties per by-product key.

Example: 10 Soda drums of 100kg bought, tracked. 350kg used. 3 empties earned. The 4th drum is half full and does not count.

**In hand** = earned − sum of quantity on non-voided sales for that key.

## Server functions

- `getByProductsFn` (finance view): per key it returns label, unit, earned, sold and in hand. It also returns the sales history for the month (the same shape as today's list).
- `createByProductSaleFn` (finance manage): input is the by-product key, a whole-number quantity, price, account, date and note. Inside the transaction it re-works the in-hand count for that key and refuses with "Only N in hand" if the quantity is above it. Then it credits the account and writes the ledger row as today.
- `voidByProductSaleFn`: unchanged behaviour (reverses the money). Voiding adds the empties back to in hand on its own.
- Purchase add, edit and void: when the change would bring a key's earned count below what has been sold, refuse with "N <label> already sold; this change would leave only M earned". Edits that change tracking, container or quantity are checked the same way.

To avoid races, sale creation and purchase edit/void take a transaction-level advisory lock on the stock item (`pg_advisory_xact_lock` on a hash of the material id) before counting.

## UI

### Purchase forms

All places that create or edit a purchase: the add stock dialog, the add raw material form, the add packaging material form and the edit purchase dialog.

- "By-product" checkbox, off by default.
- When ticked: container name (text with suggestions Drum, Bag, Can, Jar) and container size, in the item's unit. For chemicals, both are filled in from the item's saved `packagingType` / `packagingSize` when those parse cleanly, and stay editable.
- Live hint: "10 Drums". Shows an inline error when quantity is not a whole number of containers.

### By-Products page

- Route `/finance/by-products`. The old `/finance/other-income` redirects to it. Sidebar title "By-Products". Same permissions as today.
- Top table: by-product, earned, sold, in hand. Lines with all three at zero are hidden.
- "Record sale" form: pick a by-product (only those with in hand > 0), quantity (whole number, max = in hand), price each, account, date, note. The total is shown live.
- The month history list and void action stay as they are, with the item column showing the by-product label.

### Monthly report

The income line label changes from "Other income" to "By-products". Numbers, drill-down and CSV columns stay the same, apart from the label text.

## Errors

- Quantity not a whole number of containers: refused on client and server.
- Sale above in hand: refused on the server inside the transaction. The client also caps the input.
- Purchase edit/void that would leave sold > earned: refused with a clear message, and nothing changes.

## Testing

- Unit tests for the counting function: oldest-first order, partial containers, opening stock used first, untracked purchases in between, voided purchases left out, returns lowering use, transfers ignored, two items with the same container kept apart, the same item with two container sizes kept apart.
- Source-inspection tests: the sale function checks in hand inside the transaction with the advisory lock, and purchase edit/void call the sold-vs-earned guard.
- Existing other-income and monthly-report tests updated for the rename and the new required by-product fields.
