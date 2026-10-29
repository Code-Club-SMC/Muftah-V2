# Material Price Lots — Spec (Part 1 of 3)

Date: 2026-10-29
Status: Draft for review

This is Part 1 of a three-part project agreed with the client:

1. **Price lots** (this spec): one item, many prices; the operator picks the lot.
2. **Actual use**: shoppers measured in KG, actual-use entry in mixing and packing, fixed adjustment reasons.
3. **Loss Report**: five loss tabs, loss-limit settings, A4 print.

Parts 2 and 3 get their own specs. Each depends on the one before it.

## Why

When a material already in stock is bought again at a different price, the system has no correct way to cost it:

- **"Add stock" on an existing item** adds the quantity but keeps the item's old price. Mixing and packing keep using it. Example: Soda Ash is set at Rs 115/KG; 500 KG bought at Rs 125 is still costed at Rs 115 in every batch.
- **"Add new material" with an existing name at a new price** creates a second item ("Soda Ash-1"). Mixing formulas and packing formats point at the original item, so the new stock is never used by batches and the operator never gets a choice.

The client's rule: **when the same item is bought at a different price, the operator picks which price lot to use.** The system never picks automatically.

## Decisions

| Topic | Decision |
|---|---|
| Lot | One price of one item. An item has one or more lots. |
| Same price bought again | Added to the existing lot for that price. |
| Different price | New lot inside the same item. No more "-1" items. |
| Who picks | Always a person: storekeeper on transfers, operator in mixing and packing. No auto-pick, no oldest-first. |
| Applies to | All materials: chemicals and all packaging (primary packs, cartons, stickers, caps, extras). |
| Editing a purchase after its stock was used | Stock-side edits blocked. |
| Existing stock | Becomes one lot per item and store, at the item's current price. |

## 1. What a lot is

- A lot belongs to one item and has one price per unit (Rs per KG, per litre or per piece, following the item's unit).
- Each store (main store, factory floor) holds its own quantity of each lot. Example: the main store holds 500 KG of the Soda Ash Rs 125 lot; the factory floor holds 80 KG of the same lot.
- An item's total stock in a store is the sum of its lots there. Stock pages, low-stock alerts and the dashboard use this total, so they behave as today.
- A lot whose quantity reaches zero in every store stays on record (old batches point to it) but is hidden from pickers.

Example:

```
Soda Ash                         Main store   Factory floor
  Lot Rs 115/KG (first 1 Oct)       0 KG        120 KG
  Lot Rs 125/KG (first 20 Oct)    420 KG         80 KG
  Total                           420 KG        200 KG
```

The lot is shown by its price and the date it was first bought. Price is what tells two lots apart.

## 2. Purchases

- **"Add stock"** (buying an item you already have): pick the item from the list, enter quantity and price. The stock goes into the lot with that exact price, or a new lot if none matches. Prices match when equal to the paisa (two decimals).
- **"Add new material"** is for brand-new items only. It no longer creates "-1" items.
- **Typo guard.** Before saving a new material, the system looks for existing items with a similar name: same letters ignoring capitals, spaces, dashes and dots, or one letter different. If it finds one:

  ```
  ⚠ Similar item already exists: "Soda Ash" (620 KG in stock)
     [Add stock to Soda Ash instead]   [No, this is a new item]
  ```

  "Add stock to Soda Ash instead" opens the Add stock form with that item and the typed quantity and price filled in. "Soda Ashh", "Soda-Ash" and "soda  ash" all trigger the warning.
- The purchase record remembers which lot it went into.
- The purchase form shows which lot the stock will join before saving: "Joins lot Rs 125/KG (420 KG in main store)" or "Creates new lot Rs 130/KG".

## 3. Transfers (store to factory floor, and back)

- For each item being moved, the storekeeper picks one or more lots and a quantity for each.

  ```
  Soda Ash            Move: 150 KG
    Lot Rs 115/KG   (main store has 100 KG)   [100]
    Lot Rs 125/KG   (main store has 420 KG)   [ 50]
                                       Total   150 ✓
  ```

- Lot quantities must add up to the move quantity, and each cannot exceed what that lot has in the sending store. Otherwise the transfer is blocked with a plain message.
- The same lots appear in the receiving store with the moved quantities.

## 4. Mixing

- When a batch starts, the system takes each chemical's formula amount from the factory floor (as today). For each chemical the operator picks lots that add up to exactly the formula amount.

  ```
  Soda Ash   Formula: 200 KG
    Lot Rs 115/KG  (floor has 120 KG)   [120]
    Lot Rs 125/KG  (floor has  80 KG)   [ 80]
                                Total    200 ✓
  ```

- If the floor has only one lot of a chemical with enough stock, it is pre-selected with the full amount. The operator still sees it and can change it. This is a convenience, not an automatic choice between lots.
- Batch chemical cost uses exact lot prices: 120 × 115 + 80 × 125 = Rs 23,800.
- The batch records which lots and quantities it used.
- The batch cannot start until every chemical's lots add up exactly and each lot has enough floor stock.

## 5. Packing

- When packing is recorded, every packaging material the batch uses (retail pack or shopper, carton, stickers, caps, extras) has a lot picker, using the same rules as mixing.

  ```
  Carton 24×100g   Needed: 50
    Lot Rs 40   (floor has 30)   [30]
    Lot Rs 42   (floor has 90)   [20]
                         Total    50 ✓
  ```

- Packaging cost per pack and per carton uses exact lot prices.
- If two packing formats in the same entry use the same material, the operator picks lots once for the combined need. Cost is split between the formats by how many of the material each one used.

## 6. Failed batch recovery

Chemicals recovered from a failed batch go back into the same lots they were taken from, at the same price. If the recovery is less than what the batch took, the lots are refilled in the order the batch recorded them, and the operator can change the split before confirming.

## 7. Stock counts and manual adjustments

- Counts and adjustments are done per lot. Example: "Soda Ash, Rs 115 lot, factory floor: system 120 KG, counted 118 KG, 2 KG short."
- An adjustment that adds stock picks an existing lot. To add stock at a new price, use Add stock instead.
- (Part 2 adds a fixed reason list to adjustments.)

## 8. Editing or deleting a purchase

- **Nothing from the purchase used or moved yet:** edit and delete work as today. The lot's quantity follows the edit. If the price changes, the stock moves to the lot for the new price.
- **Some of it already used or moved:** quantity and price edits and delete are blocked:

  > Some of this stock has already been used or moved, so the quantity and price can't change. Old batch costs would become wrong.

  The bill's money side stays editable: amount owed to the supplier, payment status, invoice number, notes. Example: 100 KG bought at Rs 115 and 60 KG already used, then the supplier's real rate turns out to be Rs 112. The bill is corrected to Rs 11,200 so the supplier balance is right. The lot stays at Rs 115, so batch costs don't change.
- "Used or moved" means any of the purchase's lot quantity has left the store it was bought into: a transfer, mixing, packing or adjustment that went below the quantity this purchase brought in. When a lot holds stock from several purchases, the system treats the newest purchase as the one used last. So a newer purchase stays editable as long as the lot still holds at least its quantity.

## 9. Existing stock

- Each item's current quantity in each store becomes one lot at the item's current price. No one has to enter anything.
- Items already split as "Soda Ash" and "Soda Ash-1" stay as separate items. They are not merged automatically.

## Out of scope for Part 1

- Shoppers measured in KG, actual-use entry and loss reasons (Part 2).
- Loss Report (Part 3).
- Average or automatic pricing of any kind (rejected by the client).
- Merging existing "-1" items.

## Testing

- Pure rules (lot matching by price, pick totals adding up, a pick not exceeding lot stock, "used or moved" check, similar-name check) get unit and property tests.
- Server flows (purchase, transfer, mixing start, packing, recovery, adjustment, purchase edit and delete) get source-inspection tests, as elsewhere in the project, confirming every stock change goes through lots and is checked against lot stock inside the same database transaction.
- Every screen with a lot picker gets a component test: totals must match before saving, and the over-stock message shows.
