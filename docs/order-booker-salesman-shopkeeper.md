# How It Works

---

## 1. Order Booking

Order bookers use a **dedicated order pad** to record each order. The system automatically assigns a **unique, sequential serial number (bill number)** to every order — no duplicates, no gaps.

Each order captures the following customer details:
- Shopkeeper's **name**
- Shopkeeper's **mobile number**
- Shopkeeper's **address**

---

## 2. Flexible Units & Quantities

Orders are **not** always placed in standard cartons. The system supports the following unit types per line item:

- Full cartons
- Half-cartons
- Individual packs
- Loose items in bags *(shoppers)*

The order booker selects the appropriate unit type per item on each order.

---

## 3. Dynamic Pricing (Per-Order Custom Rates)

Prices are **not globally fixed**. The same carton can be sold to different shopkeepers at different rates.

- The order booker can **manually set or adjust the rate** for any item on any order.
- There is no strict enforcement of a single global price.
- This means Shopkeeper A and Shopkeeper B can receive the exact same product at two completely different rates on two different orders.

---

## 4. Delivery & Payment Collection

When the **Supply Salesman** physically delivers the goods, a **separate receiving receipt** is generated. This receipt:

- Has its **own distinct serial number** (separate from the original order's bill number)
- Is **linked to the original order's serial number**
- Is created at the point of actual delivery — not at the time of booking

### Payment Breakdown on the Receiving Receipt

The receipt must explicitly show:

| Field | Description |
|---|---|
| **Cash Received** | Amount paid upfront at delivery |
| **Outstanding Credit** | Balance remaining (owed by the shopkeeper) |

Both figures are always visible — no ambiguity about what was paid vs. what is owed.

---

## 5. Three-Way Ledger Sync

Every delivery and payment is **simultaneously reflected** across three separate ledgers:

| # | Ledger | Belongs To | Tracks |
|---|---|---|---|
| 1 | Order Booker's Record | Order Booker | Orders placed, credit extended per shopkeeper |
| 2 | Supply Salesman's Record | Delivery Salesman | Items delivered, cash collected per run |
| 3 | Shopkeeper Account Ledger | Individual Shopkeeper | Running balance, payments made, credit owed |

All three ledgers stay in **perfect sync** — what was delivered, what was paid, and what is owed must match across all three at all times.

---

## 6. Handling Exceptions — Returns & Delays

If a delivery cannot be completed, the system logs it with a **status flag** so that accounting is never broken.

### Supported Exception Scenarios

| Scenario | Status Assigned |
|---|---|
| Shopkeeper is not present at delivery | **Pending** |
| Shopkeeper says "I can't receive this right now" | **Pending** |
| Items are brought back without delivery | **Returned** |

### Rules for Exceptions

- No financial entries (payments or credit) are posted until delivery is confirmed.
- The original order's serial number remains intact and traceable.
- The exception is logged against the Supply Salesman's record without affecting the Order Booker's ledger or the Shopkeeper's account balance.

---

## End-to-End Flow

```
[Order Booker] Creates order on dedicated pad
        → Unique sequential Bill # auto-assigned
        → Captures: name, mobile, address
        → Sets item units (carton / half / pack / shopper)
        → Applies custom rate per item
                ↓
[Supply Salesman] Delivers goods linked to original Bill #
        → Separate Receiving Receipt generated with own Serial #
        → Cash received + outstanding credit calculated & displayed
                ↓
[System] Syncs transaction across all 3 ledgers simultaneously
        → Order Booker's record updated
        → Supply Salesman's record updated
        → Shopkeeper's account ledger updated
                ↓
[Exception?]
        → Shopkeeper absent or refuses → Status: Pending / Returned
        → No accounting impact until delivery is confirmed
```