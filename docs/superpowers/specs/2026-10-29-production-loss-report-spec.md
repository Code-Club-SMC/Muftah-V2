# Production Loss Report — Spec (Part 3 of 3)

Date: 2026-10-29
Status: Draft for review

Part of a three-part project:

1. **Price lots** (`2026-10-29-material-price-lots-spec.md`, approved)
2. **Actual use** (`2026-10-29-actual-material-use-spec.md`, approved)
3. **Loss Report** (this spec). Reads only what Parts 1 and 2 record. It adds no new data entry.

## Why

The client wants to see every kind of production loss in one place: how much was lost, what it cost, and why. They also want it printed. Today the batch shortfall and powder loss are saved but no screen shows them. The other losses only become visible after Part 2.

## Where

- A new **Production Loss** card on the Reports page, next to Sales, Purchases and the others.
- Access needs a new **view loss report** permission. Changing loss limits needs a separate **manage loss limits** permission.
- The report is separate from Production QC. QC certificates are about product quality and may be shown to customers. Loss is internal cost.

## Layout

```
PRODUCTION LOSS
Every loss in mixing, packing and the stores, with its cost and reason.
──────────────────────────────────────────────────────────────────────
[Date: 1 Oct – 29 Oct ▾]                    [Loss limits]  [Print report]

Loss this period
┌ Batch ────┐ ┌ Chemical ─┐ ┌ Powder ───┐ ┌ Packing ──┐ ┌ Store/floor ┐ ┌ Total ─────┐
│ Rs 108,000│ │ Rs 4,215  │ │ Rs 6,020  │ │ Rs 3,567  │ │ Rs 2,300    │ │ Rs 124,102 │
└───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────────┘ └────────────┘

[Batch loss] [Chemical loss] [Powder loss] [Packing material loss] [Store & floor loss]
```

- The date range applies to the whole page. It defaults to the current month.
- The summary strip always shows all five loss types and the total for the date range, whichever tab is open. Clicking a box opens its tab.
- Each tab has its own extra filters, summary boxes, table and paging (25 rows per page, newest first).
- Rows above the tab's loss limit show red. Red rows can be shown on their own with an **Only over limit** switch.
- Clicking a row opens the batch's mixing or packing details. Store and floor rows open the item's stock history.
- Money uses PKR formatting with Lac and Crore grouping, as everywhere else.

## Tab 1: Batch loss (mixing output below target)

Filters: product, formula, reason.

Summary: Target · Actual · Loss (KG/L and %) · Loss cost

| Date | Batch | Product | Target | Actual | Loss | Loss % | Loss Rs | Reason |
|---|---|---|---|---|---|---|---|---|
| 12 Oct | A0104 | Surf Powder | 500 KG | 400 KG | 100 KG | 20.0% | 30,115 | Spill · "mixer seal" |

- Loss = target − actual. Loss % = loss ÷ target.
- Loss Rs = loss × (batch chemical cost ÷ target). Example: Rs 150,575 ÷ 500 KG = Rs 301.15 per KG, × 100 KG = Rs 30,115.
- Batch cost includes any extra chemical from Part 2.
- Only completed batches. Failed batches are left out, because their chemical is recovered or written off separately.
- KG and litre batches are listed together. Summary quantity boxes show KG and L as separate figures. Rupees add up normally.

## Tab 2: Chemical loss (more used than the formula)

Filters: chemical, product, reason.

Summary: Extra used (per unit) · Loss cost · Most-lost chemical

| Date | Batch | Chemical | Formula | Used | Extra | Extra % | Loss Rs | Reason |
|---|---|---|---|---|---|---|---|---|
| 12 Oct | A0104 | Soda Ash | 50 KG | 55 KG | 5 KG | 10.0% | 575 | Spill |

- Extra % = extra ÷ formula amount. Loss Rs = extra at the exact prices of the lots it came from.
- One row per chemical per batch. Rows where used is less than or equal to the formula amount don't appear.

## Tab 3: Powder loss (lost during packing)

Filters: product, reason.

Summary: Given to packing · Lost · Loss % · Loss cost

| Date | Batch | Product | Given to packing | Lost | Loss % | Loss Rs | Reason |
|---|---|---|---|---|---|---|---|
| 14 Oct | A0104 | Surf Powder | 400 KG | 5 KG | 1.3% | 1,506 | Stuck in machine |

- Given to packing = bulk packed + bulk lost in that packing entry. Loss % = lost ÷ given to packing.
- Loss Rs = lost × the batch's chemical cost per KG of output.
- One row per packing entry that recorded powder loss.

## Tab 4: Packing material loss

Filters: material, product, reason.

Summary: Loss cost · Shopper loss % (weighted across all shopper rows) · Most-lost material

| Date | Batch | Material | Needed / expected | Used / actual | Loss | Loss % | Loss Rs | Reason |
|---|---|---|---|---|---|---|---|---|
| 14 Oct | A0104 | 100g shopper (1.20 KG) | 1,200 expected | 1,080 made | 120 | 10.0% | 62 | measured |
| 14 Oct | A0104 | Cap 38mm | 1,080 | 1,110 | 30 | 2.8% | 60 | Broken |

- **Shoppers:** expected = KG × 1,000 ÷ weight of one shopper (g), actual = packs made, loss = expected − actual, loss % = loss ÷ expected. Loss Rs = KG cost × loss ÷ expected. Example: Rs 624 × 120 ÷ 1,200 = Rs 62. The KG used shows next to the name. Negative loss (more packs than expected) is listed with a "check weight" warning, adds nothing to loss totals, and is never red.
- **Pieces materials (caps, cartons, stickers, extras):** loss = used − needed, loss % = loss ÷ needed. Loss Rs = extra at exact lot prices.
- One row per material per packing entry. Pieces rows with no extra don't appear. Shopper rows always appear, because measured loss is the point of tracking shoppers.

## Tab 5: Store & floor loss

Filters: store, material, reason.

Summary: Loss cost · By reason (Damaged / Spilled / Expired / Count short / Other)

| Date | Store | Material | Lot | Quantity | Loss Rs | Reason | By |
|---|---|---|---|---|---|---|---|
| 18 Oct | Factory floor | Soda Ash | Rs 115/KG | 2 KG | 230 | Count short | Ali |

- Only adjustments that reduce stock with a loss reason (Damaged, Spilled, Expired, Count short, Other). "Count over" and stock-adding corrections are left out.
- Loss Rs = quantity × the lot's price.
- No loss %, and so no limit or red rows, because there is no planned amount to compare against.

## Loss limits (setting)

- **Loss limits** opens a small form, available only with the manage permission:

  ```
  Batch loss             [10] %
  Chemical loss          [10] %
  Powder loss            [10] %
  Shopper loss           [10] %
  Other packing material [10] %
  ```

- Every limit starts at **10%**. Allowed range 0–100, up to one decimal place.
- A row is red when its loss % is **above** the limit (10.0% at a 10% limit is not red).
- Changing a limit only changes highlighting. It never changes saved data. The form shows who last changed the limits and when.

## Print

- **Print report** prints the open tab with the current date range and filters: every matching row, not just the current page.
- **A4 landscape**, matching the Production QC print style: company logo and name on the left, "Production Loss Report · <tab name>" and the date range on the right. Then the filters used, the summary table, the detail table with a **Total** row at the bottom, and signature lines (Prepared by · Approved by (name and signature) · Date). The footer has the print date and time and page numbers.
- Over-limit rows print in bold red, with a "▲" before the loss % so they still stand out on black-and-white printers.
- Table header rows repeat on every printed page. Rows never split across pages.
- More than 2,000 matching rows: printing is blocked with "Too many rows to print. Narrow the date range or filters."

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [logo] Muftah Chemical Pvt Ltd.          Production Loss Report · Batch loss │
│                                                        1 Oct – 29 Oct 2026   │
│══════════════════════════════════════════════════════════════════════════════│
│ Filters: Product All · Formula All · Reason All                              │
│ Target 4,500 KG │ Actual 4,140 KG │ Loss 360 KG (8.0%) │ Loss cost Rs 108,000│
│                                                                              │
│ Date  │Batch│Product    │Target│Actual│Loss  │Loss % │Loss Rs│Reason         │
│ 12 Oct│A0104│Surf Powder│500 KG│400 KG│100 KG│▲20.0% │ 30,115│Spill          │
│ 13 Oct│A0105│Surf Powder│500 KG│490 KG│ 10 KG│  2.0% │  3,000│Moisture loss  │
│ ...                                                                          │
│ Total │     │           │4,500 │4,140 │360   │  8.0% │108,000│               │
│                                                                              │
│ ____________          ________________________          ________             │
│ Prepared by           Approved by (name & signature)    Date                 │
│──────────────────────────────────────────────────────────────────────────────│
│ Printed 29 Oct 2026, 3:40 PM                                       Page 1 / 1│
└──────────────────────────────────────────────────────────────────────────────┘
```

## Out of scope

- Charts and trends over time
- Export to Excel or PDF files (browser "Save as PDF" from the print dialog works)
- Alerts or notifications when a limit is crossed
- Loss on the Production QC certificate

## Testing

- Pure calculation rules get unit and property tests: loss, loss %, and loss Rs for each tab, the weighted shopper loss %, the limit check (strictly above), totals rows, and negative shopper loss excluded from totals.
- Query server functions get source-inspection tests: permission middleware, date-range filtering, failed batches excluded from tab 1, only stock-reducing loss reasons in tab 5.
- Print HTML gets tests in the style of the QC print tests: escaping, total row, ▲ marker on over-limit rows, landscape page size, and the row-cap message.
- Component tests: tab switching keeps the date range, "Only over limit" filter, and the limits form hidden without the manage permission.
