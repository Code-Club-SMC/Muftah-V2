# Actual Material Use, Shoppers by KG and Loss Reasons — Spec (Part 2 of 3)

Date: 2026-10-29
Status: Draft for review

Part of a three-part project:

1. **Price lots** (`2026-10-29-material-price-lots-spec.md`, approved). Builds first.
2. **Actual use** (this spec). Needs Part 1's lots.
3. **Loss Report**. Reads the data this spec records.

## Why

Today mixing and packing take away exactly what the formula or packing format says. Real use is different:

- The formula says 50 KG Soda Ash; the operator spilled some and used 55 KG. The system takes away 50 KG, so the 5 KG loss is invisible and floor stock comes up short later.
- 1,000 packs need 1,000 caps; 30 cracked, so 1,030 were used. The system takes away 1,000.
- Shoppers are bought and used by weight. 1 KG of 1-gram shoppers should give 1,000 shoppers, but often gives 900 because of wastage. Today shoppers are counted in pieces, so this loss can't be seen.
- Store and floor adjustments take a free-text reason. One person writes "spill", another "leak", so losses can't be grouped.

The client wants every material's real use recorded, its cost included in the batch, and every loss traceable with a reason.

## Decisions

| Topic | Decision |
|---|---|
| Shoppers | A "Measured in KG" switch on primary packaging materials. On = bought, stocked, moved and used in KG. Only shoppers use it. |
| Shopper KG entry | Typed by the operator with every packing entry, for each shopper used. Never pre-filled. |
| Other materials | Planned amount pre-filled; the operator changes it only if real use differs. |
| Loss cost | Included in batch cost. It is spread over the good output (pack cost and per-KG bulk cost), not booked separately. |
| Reasons | A fixed list per place, plus "Other" with a required note. |
| Old shopper stock | None. No conversion needed. |

## 1. Shoppers measured in KG

### Setup
- Primary packaging materials get a switch: **Measured in KG**. Off by default. Bottles, sachets and every other material stay in pieces.
- When the switch is on, two fields are required:
  - **Weight of one shopper (grams)**, e.g. 1.0
  - **Price per KG**, used as the price of the first purchase lot
- The switch can only be changed while the material has no stock in any store and has never been used. Otherwise it is locked, so old quantities never change meaning.

### Purchase
- Entered as **KG × price per KG**. Example: 50 KG × Rs 520 = Rs 26,000.
- The stock goes into a lot like any other item (Part 1). The lot's price is per KG.

### Stock everywhere
Stock pages, transfers, counts, adjustments and low-stock alerts show shoppers in KG. The minimum stock level is in KG too.

## 2. Actual use in mixing

### When
At **batch completion**, on the same screen where the operator enters the output and the shortfall reason. Lots for the formula amounts were already picked when the batch started (Part 1).

### Screen

```
Chemicals used
Soda Ash   Formula: 50 KG   Used: [55] KG
           +5 KG extra from: [Lot Rs 115 ▾]   Reason: [Spill ▾]
LABSA      Formula: 30 KG   Used: [30] KG
Silicate   Formula: 20 KG   Used: [18] KG
           2 KG back to:      [Lot Rs 90 ▾]
```

- **Used** is pre-filled with the formula amount. Unchanged rows need no action.
- **More than formula:** the extra comes off factory floor stock. The operator picks lots for the extra, using Part 1 rules. A reason is required.
- **Less than formula:** the leftover goes back to the factory floor. The operator picks which of the lots the batch took it goes back to. No reason needed: nothing was lost.
- If the floor doesn't have enough for the extra, completion is blocked with the usual "not enough stock" message.

### Cost
- Batch chemical cost = everything really used, at exact lot prices.
- Cost per KG of bulk = batch chemical cost ÷ actual output. Both extra chemical and batch shortfall raise the cost per KG automatically.
- Example: formula cost Rs 150,000. Extra 5 KG Soda Ash at Rs 115 adds Rs 575, so the total is Rs 150,575. Output is 400 KG, so cost is Rs 376.44 per KG.

### Batch shortfall reason
The existing free-text shortfall reason (output below target) becomes a fixed list, so Part 3 can group it. A free note stays available.

### Mixing reasons
Spill · Leak · Measuring error · Machine fault · Moisture loss · Other (note required)

## 3. Actual use in packing

### Screen
In the packing entry, below cartons and packs, a **Materials used** section lists every packaging material the entry needs:

```
Materials used                    Needed    Used          Lot              Reason
100g shopper (KG)                 1,080 packs [1.20] KG   [Lot Rs 520 ▾]
  Expected 1,200 · Actual 1,080 · Loss 120 (10.0%)
Cap 38mm                          1,080     [1,110]       [Lot Rs 2 ▾]     [Broken ▾]
Carton 24×100g                    45        [45]          [Lot Rs 40 ▾]
Sticker                           45        [47]          [Lot Rs 1.5 ▾]   [Misprint ▾]
```

- **Pieces materials:** Used is pre-filled with Needed, and the operator changes it when more were used. More than needed requires a reason. Less than needed is not allowed (packs can't be made with fewer caps than packs). The message says to check the pack count instead.
- **Shoppers (KG):** Used is blank and must be typed. The worker weighs the roll or bag before and after. The live line under it shows expected, actual and loss as the number is typed.
- **Lots:** the lot picker (Part 1) must add up to **Used**, not Needed.

### Shopper numbers
- Expected shoppers = KG used × 1,000 ÷ weight of one shopper (g). 1.20 KG × 1,000 ÷ 1.0 g = 1,200.
- Actual shoppers = packs made with that shopper in this entry: full cartons × packs per carton, plus partial and loose packs. Here 1,080.
- Loss = expected − actual = 120. Loss % = loss ÷ expected = 10.0%.
- **Actual above expected** (negative loss) is allowed and shown as a warning: "More packs than this weight should give. Check the shopper weight in material setup." It's saved as recorded.
- If two formats in one entry use the same shopper, the operator enters one KG figure for that shopper. Actual = packs from both formats together.

### Cost
- Every material is costed at what was really used, at exact lot prices.
- Pack cost = (bulk cost + all packaging really used) ÷ good packs. Loss is built in.
- Shopper example: 1.20 KG × Rs 520 = Rs 624, spread over 1,080 packs = Rs 0.578 per pack (instead of Rs 0.52 with no wastage).
- Carton cost = pack cost × packs per carton.
- When two formats share a material, its cost is split by the number of packs each made.

### Packing reasons
Broken · Torn · Misprint · Machine fault · Other (note required)
Shopper loss needs no reason: it's measured, not declared.

### Powder loss
The existing powder-loss field in packing keeps working. Its free-text reason becomes a fixed list (Spill · Machine fault · Stuck in machine · Other) with an optional note.

## 4. Store and floor adjustments

- Manual adjustments (Part 1: per lot) require a reason from a fixed list:
  **Damaged · Spilled · Expired · Count short · Count over · Other** (note required for Other).
- Stock count differences are saved with "Count short" or "Count over" automatically.
- Count over and corrections that add stock are recorded but don't count as loss in Part 3.

## 5. What gets saved (for Part 3)

For every batch and packing entry, per material: planned amount, used amount, lots and lot prices, extra and its cost, reason and note. For shoppers, also KG used, weight per shopper at the time, expected, actual and loss. For adjustments: lot, quantity, reason and note. The weight and prices are copied at save time, so later setup changes don't rewrite old losses.

## Out of scope

- The Loss Report screens and print (Part 3).
- Changing the older packing-job flow that's still in the code. Only the current packing entry gets these changes.
- Editing a saved batch's actual use. Corrections go through adjustments.

## Testing

- Pure rules get unit and property tests: expected-shopper math, loss and loss %, extra and leftover splitting, lot totals matching Used, cost spreading over good packs, and splitting shared materials by packs.
- Server flows (mixing completion, packing entry, adjustments) get source-inspection tests confirming real-use quantities are what's taken from lot stock, costs use lot prices, reasons are required where stated, and all of it happens in one database transaction.
- Component tests: shopper KG required and never pre-filled, live expected/loss line, reason required only when Used exceeds planned, "less than needed" blocked for pieces materials.
