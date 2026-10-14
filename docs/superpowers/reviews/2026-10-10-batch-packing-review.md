# Batch packing independent review

Reviewed against `docs/superpowers/specs/2026-10-09-batch-packing-design.md` and `docs/superpowers/plans/2026-10-09-batch-packing.md` on 2026-10-10. Scope is the batch packing feature and its stock consumers, not the unrelated pre-existing workspace changes. This review inspected source and existing regression coverage. It did not rerun tests or apply migrations.

## Verdict

The independent reviewer identified the findings below and inspected the receipt transaction, arithmetic, authorization, retry identity, stock correction endpoint and cumulative chemical costing. Before reaching its usage limit, the reviewer confirmed the fixes for invoice creation ordering and receipt carton targets. The parent completed the remaining code inspection and regression verification, recorded separately below.

## Findings sent during review

1. **P1: no-carton invoice posting can debit the same physical quantity twice.** The revised `src/lib/cartons/outside-packs.server.ts` chooses `quantityContainers` as the legacy-compatible no-carton balance. `src/server-functions/sales/invoice-posting-service.ts` currently calls `adjustCartonStock` before `dispatchInvoiceCartons`, so that balance has already been reduced. Starting with 100 no-carton packs and selling 60 leaves 40 canonical packs before the outside movement attempts to debit 60, rejecting a valid sale. Selling 20 instead records an outside balance of 60 despite 80 remaining units. The no-carton compatibility fix must account for call ordering. Sent to the backend worker and parent with the concrete example.

2. **P1: invoice editing omits outside stock from availability.** The duplicate `buildFinishedGoodsAvailability` in `src/server-functions/sales/invoices-fn.ts:294` originally returned carton contents alone. Creation includes `quantityOutsidePacks`. Editing a valid sale funded by outside packs for a carton-enabled format therefore fails the sellable-stock check after reversing its original dispatch. Both invoice paths must use the same outside-inclusive availability.

3. **P1: no-carton invoice edits skip the new outside dispatch.** `src/server-functions/sales/invoices-fn.ts:1515` originally invokes `dispatchInvoiceCartons` only for `hasCartons`. Reversal restores a new receipt's no-carton outside movement, but the edited invoice never deducts that movement again. The canonical quantity and explicit outside balance diverge. The corrected dispatch path must include no-carton outside stock and retain compatibility with old balances initialized to zero.

4. **P2: batch carton targets still reinterpret outside packs as cartons.** `src/lib/cartons/carton.repository.ts:241` derives target cartons with `ceil(targetUnits / capacity)`, and `src/lib/cartons/carton.service.ts:590` uses the same conversion to permit supplementary records. A receipt containing one full carton, three packs in a partial carton and 101 outside packs at capacity 40 creates two real cartons, but these paths calculate a target of four and a shortfall of two. Receipt-backed allocations should use their saved full-carton count plus the presence of a partial carton. Legacy allocations retain the existing fallback. The normal add-carton UI is disabled, so the immediate user-facing defect is the incorrect KPI; the service guard also remains incorrect.

## Verified design and behavior

- `calculatePackingLine` validates integer counts, keeps outside packs independent of carton capacity, rejects unrepresentable bulk consumption, and requires a reason for actual-fill variance. Loss is a separate receipt amount.
- Receipt posting locks the mixing batch, checks the assigned operator and completion permission or manufacturing manager permission, recomputes format quantities from stored definitions, validates formula and product, and writes materials, allocations, physical cartons, stock, audits and cost history in one transaction.
- A unique batch/request index and the transaction's batch lock serialize both new requests and replays. Reusing a request with another payload or actor fails. Replay returns before stock changes.
- Availability keeps non-cancelled legacy allocations reserved and subtracts explicit receipt losses. The default UI does not create new legacy assignments.
- The draft is scoped to actor and batch. Confirmation persists the exact submission before calling the server. Failed responses retain it, and result checking keeps the request ID until a confirmed outcome. Stock-related queries are invalidated on success and recovered success.
- Both completed mixing entry points mount the shared form; operator lists include completed batches. The count and weight-helper UI preserves outside counts and explains fractional-pack remainder.
- The latest chemical-cost fix allocates the non-legacy cost pool cumulatively across receipts, then apportions each receipt cumulatively across lines. This removes the original repeated-rounding error while retaining legacy cost reservations.
- The new correction API uses authenticated `POST`, inventory-management permission, the shared stock lock, expected-current comparison, a required reason, outside movement audit, canonical inventory value adjustment and WAC history. It preserves receipt immutability.
- The finished-goods UI now derives legacy no-carton loose counts from canonical units. Carton-enabled formats use explicit outside balances, keeping partial-carton contents separate.
- Migration `0016_wet_guardian.sql` adds receipts, outside movements and allocation snapshots with request uniqueness. This review made no edits to generated migration files.

## Verification limits

Earlier reported results were 57 focused tests, six isolated PostgreSQL tests including concurrency, and a passing typecheck. Those results predate some changes under review and are not presented here as fresh verification. The parent/backend worker owns the latest test, build and graph refresh results. Final sign-off requires inspecting the fixes listed above and recording the current verification outcome in the implementation plan.

## Parent follow-up

- Findings 1 and 3: both creation and editing dispatch physical outside packs before aggregate stock debit. Editing now invokes the shared dispatch helper for no-carton formats too.
- Finding 2: invoice-edit availability includes explicit outside balances. New database regressions sell 60 of 100 outside packs, edit to 80 and then 20, and delete the sale, checking physical counts and value at each step for both carton-enabled and legacy no-carton stock. These cases passed the subsequent database run.
- Finding 4: receipt allocations use saved full-carton count plus the presence of a partial carton, with saved capacity. The database regression verifies two physical cartons for one full carton, three partial packs and 101 outside packs, and rejects an extra replacement carton.
- The availability reader now also reports historical no-carton packs from canonical units, consistent with the finished-goods screen and movement helpers.
- Fresh final verification totals and any limitations are recorded in the implementation plan. No additional independent sign-off is claimed after the reviewer's usage limit.
