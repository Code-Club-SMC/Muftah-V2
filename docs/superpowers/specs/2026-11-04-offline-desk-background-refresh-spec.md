# Offline Desk Background Refresh — Spec

Date: 2026-11-04
Status: Design approved in chat, awaiting written-spec review

## Why

The offline desk works from a saved copy of the price list, customers and booked orders. Today that copy is refreshed only when the desk page itself is open and the copy is more than an hour old. If the internet fails while nobody had the desk page open for a while, the desk starts the outage with data that may be hours or days old. Example: a distributor's discount changes at 10:00, the desk page was last open at 09:00, the internet fails at 11:00, and the desk prints invoices at the old discount.

The desk also never shows stock on hand, so an operator can enter 110 bottles of Dishwash 200ml when 100 exist, and the only sign is a stock-shortage warning at the office after upload.

Goal: whenever the factory computer is online and a Titan tab is open, the saved copy is at most about 5 minutes old, and the operator can see how old it is.

## Decisions

| Topic | Decision |
|---|---|
| Where the refresh runs | In the app-wide layout, so any open Titan tab does it, not only the desk page. |
| How often | Every 5 minutes, and immediately when a tab opens, when a tab regains focus, and when internet returns. |
| Who polls | Only computers that were already prepared (they have a saved pack). Other computers never call the server. |
| Fully closed browser | Not covered. A browser that is not running cannot run code. Installed-app background sync was considered and rejected: the browser, not Titan, picks the timing (usually hours). |
| Replaces | The old rule "refresh only when the copy is over 1 hour old". |
| Unsent printed invoices | Refresh pauses. A printed invoice must keep matching what the office books. |
| Stock on hand | Sent to the desk with every refresh and shown in the item picker. A soft warning, never a block. |
| Last refreshed | Shown on the readiness card and as a small badge at the top of the desk page. |

## 1. The refresher

- Runs on a 5-minute timer and on three triggers: tab opened, tab focused, internet restored.
- Skips a run when any of these is true: no saved pack on this computer, the computer is offline, an earlier refresh is still running, or printed invoices are waiting to be sent.
- Two tabs open at once: a browser lock lets one tab fetch; the other skips that round. The result lands in shared browser storage, and every tab reads from it.
- On failure (internet blip, logged out, server error) it stays silent and tries again on the next round. The "last refreshed" time does not move, so the age label tells the truth.
- The standalone desk page sits outside the signed-in layout, so the refresher is mounted at the root of the app and covers both.

## 2. What a refresh brings

A refresh fetches the same pack the "Prepare this computer" button fetches:

- All sellable products with carton prices, pack sizes, retail price, and per-distributor prices.
- Discount rules.
- All customer types: distributors, retailers, shopkeepers, wholesalers, with each customer's previous balance.
- Booked orders that are pending or confirmed.
- Wallets and salesmen.
- **New:** stock on hand per product at the factory floor, in packs.

The reserved invoice numbers stay as they are. A refresh never changes them.

The server already reuses a price list built less than 5 minutes ago. That window drops to 4 minutes, so a 5-minute tick never lands just inside the reuse window and returns the same old copy.

## 3. Stock on hand at the desk

- The server already records stock in its signed copy, and records it on every posted line as the stock seen at the desk. Only the step that trims the pack for the browser dropped it. That step now keeps it.
- The item picker shows "in stock: 100" next to each product.
- Entering more than the shown stock gives a warning on the line: "Only 100 in stock as of 14:35." The invoice can still be saved and printed. The goods may have been made since, and the office already handles shortages with a warning and a reconciliation issue.
- Stock already allocated to other unsent desk invoices is subtracted, so ten invoices of 11 bottles show the shortage on the tenth, not only at the office.

## 4. Last refreshed

- Readiness card: "Updated 2 min ago · 14:35" (Pakistan time).
- Desk page header: a small badge with the same text.
- Online and older than 15 minutes: the badge turns amber. Typical cause: refresh keeps failing.
- Offline: "Updated 14:35 · before internet went off".
- Paused: "Updates paused: 3 invoices waiting to be sent."

## 5. Not changing

- Pricing at the office still comes from the signed copy the invoices were priced against.
- Printed invoices never change after printing.
- "Prepare this computer" and "Refresh this computer" buttons stay, and still work on demand.
- Credit limits and cost prices stay on the server.

## 6. Testing

- Pure timing logic gets unit tests: when a round fires, which conditions skip it, the pause rule, and the age label for each state above.
- The stock-allocation rule (stock minus unsent desk invoices) gets unit tests with the ten-invoices example.
- The root-layout mount and the 4-minute server window get source-inspection tests, as elsewhere in this area.

## Out of scope

- Refreshing with every browser window closed.
- Blocking an invoice because of stock.
- Splitting a refresh so that stock and customers update while prices are held back.
