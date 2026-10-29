# Per-Order-Booker Bill Number Design

Date: 2026-06-29

## Goal

Make `orders.billNumber` lifetime-sequential per order booker, not global.

Target behavior:
- Order booker A orders: `1, 2, 3, ...`
- Order booker B orders: `1, 2, 3, ...`
- Same `billNumber` may exist across different order bookers
- Within one order booker, `billNumber` must stay unique

## Current State

- `orders.billNumber` is `serial`, so numbering is global across all order bookers
- UI, conversion flow, invoice detail, print, self-service flows already use `billNumber` as booked-order reference
- No production environment exists, so hard switch + historical backfill is acceptable

## Approved Design

Hard switch current `billNumber` semantics:
- `billNumber` becomes per-order-booker lifetime sequence
- Remove dependence on global DB `serial` behavior for order numbering
- Enforce DB uniqueness on `(orderBookerId, billNumber)`

## Data Model Changes

Change `orders.billNumber` from global auto-serial semantics to application-assigned integer semantics.

Constraints:
- `billNumber` remains required
- Add unique constraint on `(orderBookerId, billNumber)`
- Keep `id` as primary immutable technical key

No second "legacy bill number" column will be introduced.

## Number Allocation

New order creation will allocate next number inside order creation transaction:
- Find max `billNumber` for selected `orderBookerId`
- Next value = `max + 1`, fallback `1`
- Insert order with that value in same transaction

Race safety:
- DB unique constraint on `(orderBookerId, billNumber)` is final guard
- Server function should retry allocation on unique-conflict collision a small bounded number of times

Reason:
- No production env
- No extra counter table needed unless contention later proves real
- Keeps design smaller

## Historical Backfill

Migration will backfill all existing orders:
- Partition by `orderBookerId`
- Sort by `createdAt`, then `id`
- Rewrite `billNumber` to `row_number()` within each order booker partition

Effect:
- Existing historical orders become sequential per booker
- References by `order.id` remain stable
- Any UI/report using booked-order reference will now show normalized per-booker values

## UI / UX Rules

User-facing booked-order reference must use new per-booker `billNumber` everywhere:
- Orders list
- Order booker detail pages
- Convert-to-invoice preview
- Invoice detail where booked order shown
- Invoice print field `bookedOrderNo`
- Order-booker self-service screens

Aggregate screens that can contain many order bookers should avoid ambiguous naked numbers:
- Prefer `Order Booker Name + #billNumber`
- Search may still match raw `billNumber`

## Non-Goals

Not included in this change:
- Physical paper-pad serial field
- Reset-by-day/month/trip/pad numbering
- Dedicated order-booker ledger

## Failure Handling

If allocation collides:
- Re-read current max for same order booker
- Retry insert
- After bounded retries, return explicit error

If migration encounters null/invalid order booker linkage:
- Fail migration loudly
- Do not partially apply silent fallback numbering

## Testing

Add regression coverage for:
- Per-booker numbering starts at `1`
- Different order bookers can both have `billNumber = 1`
- Same order booker cannot get duplicate `billNumber`
- UI source still references `billNumber` in order/invoice conversion and print paths
- Historical backfill migration shape is present

## Risks

Main risk:
- Existing users may remember old global numbers

Mitigation:
- No production env
- Internal technical IDs stay unchanged
- Order conversion uses `order.id`, not `billNumber`, so relational integrity stays safe

## Implementation Summary

1. Change schema + migration for per-booker uniqueness
2. Backfill historical orders per order booker
3. Update `createOrderFn` to allocate per-booker next number transactionally
4. Verify all booked-order displays still use `billNumber`
5. Add regression tests
