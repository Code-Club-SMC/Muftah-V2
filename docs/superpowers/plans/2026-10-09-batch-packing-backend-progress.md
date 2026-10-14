# Batch packing backend progress

Updated 2026-10-10. See the main plan and independent review for the full feature scope.

## Implemented

- Decimal count/weight validation, atomic multi-format receipts, material debits, physical cartons, explicit outside-pack stock and immutable format snapshots.
- Operator assignment and permission checks, batch locking, request replay and changed-payload rejection.
- Cumulative chemical-cost allocation across receipts, including loss and existing legacy reservations. Small costs no longer duplicate rounding cents.
- Outside-pack dispatch, invoice reversal, returns, transfers and inventory correction. Invoice creation and editing dispatch physical packs before updating aggregate units.
- Audited correction API with inventory-management permission, reason, shared stock lock and expected-current check.
- Legacy no-carton balances derive from their total units. Receipts, movement operations, finished-stock display and availability preserve these old balances.
- Receipt carton targets use saved full and partial counts rather than dividing all packs by capacity.

## Verification

- Generated migration `0016_wet_guardian.sql` and all preceding migrations applied successfully to isolated PostgreSQL database `titan_batch_packing_finish_test` on port 5433. No application database migration was run.
- 61 focused UI/domain tests passed. Typecheck and production build passed before the final availability-reader change; final checks are in progress.
- Initial database run passed 75 of 80 tests. Remaining failures were an incorrect expected correction value, old availability-response expectations and global factory-floor selection in isolated test fixtures. These were corrected. Repeated-sale/edit/deletion regressions now cover both carton-enabled outside packs and historical no-carton stock.
- Final database verification passed all 80 distinct checks: 48 unchanged tests passed in the four-suite run, and all 32 tests passed in the two rechecked suites after correcting required invoice-number fixture values. Typecheck, production build and graph update passed. See the main plan for exact evidence and verification limits.

The backend worker and independent reviewer reached their usage limits during final verification. The parent continued from their saved code and findings. The independent review report remains separate from the parent's final verification notes.
