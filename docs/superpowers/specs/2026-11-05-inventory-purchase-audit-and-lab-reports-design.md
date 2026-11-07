# Inventory purchases, lab reports, alerts, and audit history

Date: 2026-11-05

## Scope and approval

The user approved the following behavior in chat: refresh stock caches after supplier changes; prompt for a separate chemical lab report after every purchase with a Later option; identify purchases missing reports; fix background-refresh pagination resets; harden minimum-stock alerts; retain voided purchases and their payments for audit. The user also requested visible packaging kinds such as bottle and carton in `src/components/inventory/stock-table.tsx`.

This document records that design for review before implementation. It does not authorize changes to unrelated work in the working tree.

## Confirmed causes

- Supplier purchase edit and delete callbacks invalidate `inventory` but omit `factory-floor`. Several stock mutations also omit `low-stock-alerts`.
- `chemical_lab_reports` has a chemical reference but no purchase reference. Chemical-level report lists cannot distinguish separate deliveries.
- Price lots deliberately group purchases by chemical and price. A price lot is not a delivery identifier and must not become the report owner.
- The factory-floor query refreshes every 50 seconds. Its component constructs new stock arrays. `DataTable` defaults `autoResetPageIndex` to true, so refreshed arrays reset the page.
- `deletePurchaseRecordFn` explicitly deletes supplier payment rows and the purchase. Stock movements and some finance records remain, but the supplier's purchase and payment views lose the original records.
- Low-stock alert queries consider only existing stock rows and configured positive minimums. Finished-goods alerts use the older aggregate carton calculation rather than the physical carton ledger. The alert component hides request failures as though no alerts existed.
- Packaging `type` currently records primary, master, sticker, or extra. It does not reliably distinguish bottles, sachets, buckets, and cartons. The existing master form explicitly supports buckets, so master must not automatically mean carton.

## 1. Purchase-specific chemical reports

### Purchase and prompt

After a successful chemical purchase, including initial stock and restocking through any existing entry point, offer Create report and Later for the returned purchase ID. The purchase remains saved even if report entry is deferred, cancelled, or fails. Zero-quantity material creation without a purchase must not prompt.

Create report opens a fresh form scoped to that purchase. Later closes the prompt without creating an empty certificate or marking the purchase complete. Closing the report form without saving has the same pending effect. Keep unsaved analysis results from leaking between purchases.

Do not invent laboratory results, certification, or a pass status. A saved certificate must satisfy the existing required result and certifier validation.

### Ownership and queries

Add a nullable purchase reference to chemical reports for compatibility with existing records. New certificates require a valid, non-voided chemical purchase whose chemical matches the submitted chemical ID. Resolve and validate ownership on the server, not just in the UI. A report's purchase ownership cannot change through report editing.

Each purchase may retain multiple independently created certificates, preserving the existing multiple-report capability. A purchase is missing its report when it has no saved purchase-linked certificate. Deleting its final certificate makes it pending again. This status describes presence, not whether laboratory results passed.

Existing reports without purchase references remain visible as Legacy / purchase unassigned. Never automatically attach them to every purchase or guess an association from chemical name, date, price, or lot number.

Keep the chemical-level report view as an overview, grouped or labeled by purchase. Provide a purchase-scoped view and creation action from supplier purchase history and from each pending purchase in the chemical overview. Show supplier, purchase date, quantity and unit, and purchase reference so identical chemicals remain distinguishable.

### Visibility

Add a report-status column or badge to chemical stock rows with the count of non-voided purchases missing certificates. Provide an obvious Missing reports filter and a visible pending summary. A chemical with no reports must be visibly distinguishable even when there is no purchase association to evaluate; label this No lab reports rather than manufacturing a pending purchase. A chemical with legacy reports and unreported purchases remains flagged for those purchases.

Fetch report coverage in batched server queries or grouped aggregates. Do not issue one report request for every stock row. The pending filter must preserve the existing material-name search.

Users without inventory management permission may see report status where their view permissions permit, but may not create, edit, or delete reports. Server functions continue enforcing permission middleware. Viewing audit certificates for voided purchases remains allowed; changing or creating certificates for a voided purchase is rejected.

## 2. Voided purchases and retained payment history

### Chosen approach

Retain the original purchase and payment rows and mark the purchase voided. This is preferable to copying rows to an archive and deleting originals because references from payments and certificates remain valid and supplier history can use the existing query paths. A separate archive is not needed.

Add nullable void timestamp, actor reference, reason, refunded amount, and refund wallet reference to the purchase. Store the purchase's material name, unit, and supplier name at void time as an audit snapshot so later renaming does not rewrite the explanation of the reversal. Original quantity, cost, purchase date, and payment amounts remain intact.

Replace the user-facing Delete purchase language with Void purchase. Require a nonblank reason. Explain that stock and any selected refund will be reversed while the original records stay available. Preserve the current full, partial, and zero-refund choices and their handling of retained expenses.

### Atomicity and restrictions

Lock the purchase row in the existing transaction before checking void state and before stock or money changes. Preserve the existing untouched-stock restriction. Used or moved stock must not become voidable as a side effect of this change.

Perform stock reversal, current expense/refund handling, void metadata persistence, and the required audit write in the same transaction. Keep original supplier payment rows. Do not let the optional activity logger be the only durable evidence of the void.

A second void request must not reverse stock or refund money again. Return a clear already-voided response without financial side effects. Reject purchase edits and new payments for voided purchases. Payment posting and purchase editing must acquire the same purchase row lock used by voiding to prevent races. Verify a supplied purchase belongs to the supplied supplier.

Certificates belonging to the purchase remain available and show the purchase is voided. The voided purchase no longer contributes to missing-report reminders.

### Reading and accounting

Purchase history includes voided rows with a clear Voided status. Hide restock, edit, payment, and void actions on these historical rows; the material can still be restocked through its normal active-material flow. Details show actor, date, reason, original payment, refund amount and destination, and any amount not refunded.

Payment history retains original payment rows and labels their associated purchase Voided. Show the associated refund details without presenting the original payment as an active settlement or counting it twice. Partial and zero refunds must remain understandable.

Exclude voided purchases from active purchase totals, supplier balances, outstanding queries, stock-left attribution, and operational purchase-report totals. Audit views may include them, explicitly labeled. Review every purchase and payment reader, including supplier list totals, detail totals, report queries, legacy-stock allocation, and lot-stock allocation. Historical purchase rows show no stock left after voiding and must not claim stock from another purchase in the same price lot.

Do not hard-delete referenced materials or suppliers to bypass retained audit records. Existing history restrictions remain in force. This scope does not add general material or supplier archival.

Previously hard-deleted purchase/payment rows cannot be reliably recreated from this change. Recovery would be a separate backup or evidence-based task.

## 3. Cache consistency

Use the existing TanStack Query cache and query keys. Consolidate the relevant inventory invalidation list in a small shared helper if needed by the existing purchase and material mutation callbacks; do not introduce a separate caching layer.

Successful stock-affecting purchases, edits, voids, adjustments, transfers, recoveries, and production consumption/output must invalidate the affected factory-floor, inventory/detail, material/lot, and low-stock queries. Minimum-stock edits also invalidate alerts. Supplier and finance mutations retain their existing supplier, wallet, expense, and relevant report invalidations.

Report create, edit, and delete callbacks invalidate report lists, single-report details as appropriate, and report-coverage summaries. Await refresh promises where callbacks close a workflow or expose a successful completion state that depends on refreshed data. Inactive queries must be marked stale for the next visit.

Background polling remains a fallback for changes made in another session. Immediate refresh after a mutation applies to its current client; this design does not introduce cross-browser push notifications.

## 4. Stable stock-table pagination

Opt the stock table out of page resets caused by data-array replacement. Do not change every table's default behavior without a demonstrated need.

Keep the current page on a background refresh, sorting, and ordinary edits while that page still exists. Reset to the first page when the user changes a search or missing-report filter. If the filtered record count shrinks below the current page, clamp to the last valid page. Empty results display Page 1 of 1 and an explanatory empty state, not a blank table.

Test this using replacement arrays and actual table pagination rather than only checking for an `autoResetPageIndex` prop in source code.

## 5. Minimum-stock alerts

### Threshold semantics

Use the same status rules in stock rows and alerts. Positive stock at or below a configured positive minimum is Low stock. Stock at zero is Out of stock and must remain visible even when no positive minimum is configured. A zero or null minimum disables the positive-stock threshold, not the out-of-stock status. Positive stock above the applicable minimum is healthy.

Validate minimums at server input boundaries: finite, nonnegative, within database precision/range. Chemical thresholds use the chemical's stock unit and supported decimal precision. Counted packaging thresholds are whole pieces; KG-measured packaging uses the database's existing integer threshold precision for this scope, with KG clearly labeled. Do not silently truncate invalid input. Existing recipe minimums remain pack/unit thresholds, not carton thresholds.

### Stock source and scope

Use active factory-floor stock consistently with the factory-floor screen. Include configured tracked materials and active recipes with no stock row as zero stock rather than silently omitting them. The screen currently selects one active factory floor; alerts must use that same scope rather than reporting unrelated storage warehouses.

Chemical and packaging alerts read their per-item warehouse totals, not one alert per price lot. Packaging quantities use `packagingUnit`, never container capacity units such as ml.

For carton-managed finished goods, calculate available units from actual packs in usable physical cartons plus outside packs, not carton count multiplied by nominal carton capacity. Exclude dispatched, scrapped, and held/unavailable cartons from available stock. For loose-only goods, use the corresponding loose aggregate. Do not double-count packs through both carton and aggregate records. Reuse an existing authoritative availability query/helper if one exists.

Use stable alert identifiers, deterministic ordering with out-of-stock items first, and show current quantity, minimum, unit, and material/warehouse names. Preserve the existing view authorization.

### Request states

Show loading, success with no alerts, alerts present, and failure distinctly. A failed refresh with cached alerts must not erase them or claim everything is healthy. Provide a retry action and a readable error indication. Keep polling and refetch-on-focus behavior, in addition to mutation invalidation.

## 6. Packaging-kind indication

Add a compact Packaging kind badge or column in `stock-table.tsx`. Keep it separate from stock units and from the production role represented by primary/master/sticker/extra.

Because the current schema does not encode bottle versus sachet versus bucket, add an optional validated `packagingKind` field. Choices are Bottle, Jerry can, Sachet, Pouch, Shopper, Carton, Bucket, Cap, Sticker, and Other. Expose it in existing packaging creation and editing forms and return it from stock/detail queries. This is descriptive metadata and must not change production allocation rules or stock-unit locks.

For older rows without a kind, display the stored role accurately as Primary packaging, Master packaging, Sticker, or Extra packaging. Do not infer Bottle from primary or Carton from master, and do not silently classify historical names. Users can assign a specific kind through editing without changing stock quantities. Keep the role visible in details so the distinction remains understandable.

## 7. Schema and deployment

Make schema changes only in source schemas and generate a new forward migration with `bun run db:generate`. Never edit existing SQL migrations, snapshots, or the journal manually. Preserve the pre-existing uncommitted migrations and all unrelated user work.

The migration adds purchase void/audit metadata, report purchase ownership and its query index, and optional packaging kind. Existing purchases remain active, legacy reports retain null purchase ownership, and legacy packaging kinds remain unassigned. Enforce foreign keys and appropriate nonnegative/refund bounds where supported, and retain report references during purchase voiding.

Do not run production database migrations, resets, or data recovery as part of local implementation. Build must continue to work without live database environment variables.

## 8. Verification

- Behavior tests: page 4 survives repeated data replacements, filters reset intentionally, and row removal clamps the page correctly.
- Report tests: two purchases of the same chemical at the same price have independent coverage and independent saved results; Later leaves the purchase pending; legacy reports do not satisfy new purchases; deleting the last certificate restores the missing indication; invalid or voided purchase associations are rejected.
- Audit tests: full, partial, and zero refunds preserve original purchase and payment rows; balances and stock reverse once; duplicate/concurrent void attempts cannot double-refund; edits/payments against voided purchases fail; retained historical rows do not affect active totals or stock attribution.
- Alert tests: below/equal/above threshold, zero stock, disabled positive threshold, missing stock rows, invalid minimums, inactive scope, KG versus pieces, partial cartons, outside packs, and unavailable cartons.
- UI tests: prompt Create report/Later, missing-report badges/filter, void metadata/payment history, alert loading/error/retry/empty states, and specific/fallback packaging labels.
- Cache tests: relevant mutation callbacks mark cached factory-floor, stock/detail, report coverage, and alerts stale/refetch as appropriate.
- Run focused tests, typecheck, broader applicable suites, and a production build. Report pre-existing failures separately and state explicitly if PostgreSQL integration tests cannot run.
- After modifying code, run `graphify update .` as required by `AGENTS.md`.

## Out of scope

No fabricated lab certificates, automatic legacy-report assignments, purchase history reconstruction, general archival subsystem, notification service, cross-session real-time transport, or unrelated sales/auth changes. No automatic stock quarantine or manufacturing block based on missing/failed certificates is introduced.
