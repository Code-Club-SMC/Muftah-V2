# Offline Sales Excel Invoicing

**Date:** 2026-08-10

**Status:** Approved design; implementation not started

**Scope:** One factory location, offline direct distributor invoices and offline conversion of existing booked orders

**Dependency:** `2026-08-10-invoice-settlement-redesign-design.md`

## 1. Purpose

Factory dispatch and invoicing must continue when factory internet fails. Client will not install a local server and will not purchase backup internet.

One authorized operator will record sales in an official Excel workbook already stored on the factory computer. The workbook can print a customer invoice during the outage. After connectivity returns, Titan ERP validates and imports the workbook through the same invoice, settlement, stock, order, commission, ledger, and reporting services used online.

The Excel workbook is transport only. Uploaded file bytes are never stored in application storage, object storage, or PostgreSQL.

## 2. Honest limitation

During an outage, Excel cannot read live database state. Web reports, database stock, distributor balances, order status, and wallet balances remain temporarily stale until import finishes.

The workbook uses server-issued snapshots and maintains its own running outage totals. Warnings do not prove current server state. After internet returns, the system revalidates every invoice against live data.

Single-writer rule is operationally essential. If people copy workbook and use same slot in parallel, application can detect conflict during import but cannot stop duplicate physical dispatch during outage. Designated operator must use one official file.

## 3. Locked business decisions

- One active offline sales workbook exists for the factory at a time.
- One designated operator records all offline invoices in that workbook.
- Attendance and sales use separate workbooks.
- One workbook may contain many invoices.
- Direct offline sales may select existing distributors only.
- A booked-order offline invoice must link to an existing booked order. The booked order is authoritative even when its shopkeeper has not yet become a customer record.
- Offline prices cannot be changed.
- Only saved discount/free-carton rules apply. Operator cannot manually add extra discount or free cartons.
- Credit-limit and credit-hold differences produce warnings but never block dispatch.
- Stock differences produce warnings but never block dispatch.
- No signatures are required by the offline workflow.
- Existing print signatures and stamp areas remain where the current matching print template already has them. None are removed, and none are added where absent.
- Payments support cash, bank transfer, cheque, and pay later.
- Cash confirms immediately after import. Bank transfer and cheque remain pending after import until finance verifies/clears them.
- No mobile-wallet payments.
- Raw Excel bytes are discarded after parsing.
- No FBR integration is in scope.

## 4. Invoice numbering

Online and offline public invoice numbers use independent series:

- Online: `INV-<online sequence>`
- Offline: `OFF-F01-YYYYMMDD-<offline serial>`

Internal database IDs and serials are not customer-facing invoice numbers. Importing an offline invoice must not create a visible gap in the online `INV-...` sequence.

Each prepared invoice slot receives an immutable server-issued record token and serial reserved from offline counter. Serial is padded to at least three digits, never resets, and expands beyond `999`; this prevents collisions when workbook is replaced on same day. Excel combines actual dispatch date and reserved serial into visible number. Human-readable offline number, workbook ID, serial, date, and token are all validated at upload. Re-uploading same invoice is duplicate, not new sale.

Online direct and booked-order invoices both use `INV-...`. Offline direct and booked-order invoices both keep `OFF-...` number printed during outage; import never renumbers them.

Unused reserved slots create gaps only in `OFF-...` serials. They never create gaps in normal `INV-...` numbers.

## 5. Workbook lifecycle

### Issuing

An authorized sales/admin user issues the single active workbook while online. Operator keeps it on the factory computer at all times; outage prediction is unnecessary.

Workbook should be refreshed at start of shift when practical so customer, order, price, discount, stock, credit, and cost snapshots stay recent. Replacing a workbook retires the previous one for new entries but keeps it recognizable for pending import and audit.

Only one workbook may have `active` status. Database uniqueness enforces this rule.

Normal replacement follows this safe sequence: upload and stage any used rows from old workbook, close it, then issue replacement. An authorized admin may force-retire a lost or damaged workbook with a required reason. Force-retirement invalidates unused slots; any later upload from that workbook becomes Needs Review and can never post automatically.

### Capacity

Initial template capacity:

- 500 prepared invoice headers
- 10,000 item rows
- 2,000 payment rows
- maximum file size 10 MB

System warns before prepared capacity is exhausted. Retired or replaced workbooks cannot supply new invoice records.

Capacity is a hard safety limit because no server is available during outage. After all 500 tokens are used, Excel cannot create another official offline invoice. Production drill must confirm 500 exceeds worst credible outage volume; otherwise capacity must be raised before release while keeping parser/file safety limits.

### Format

- `.xlsx` only
- no macros or `.xlsm`
- no encryption/password protection
- no external links or data connections
- no added, renamed, or removed required sheets
- input cells must contain literal values, not formulas
- protected template formulas may exist only in server-defined calculation/print cells

Excel protection prevents accidents only. Server verifies metadata, tokens, snapshots, literal inputs, and calculations independently.

### Trust boundary

Server signs canonical workbook manifest, immutable reference snapshot, slot tokens/serials, and protected-template hashes using HMAC-SHA-256 and server-only secret. Workbook stores signature plus key version, never secret. Editable invoice/item/payment cells are intentionally outside signature. Upload verifies signature before trusting immutable values, then recalculates all editable business data server-side. Secret rotation keeps explicit verification keys only for supported workbook versions.

## 6. Workbook sheets

### `Invoices`

One row per invoice:

- offline invoice number and immutable token
- actual sale/dispatch date and time in `Asia/Karachi`
- sale type: `direct_distributor | booked_order`
- distributor code for direct distributor sale
- order-booker code and bill number for booked-order sale
- Payment Due Date when an amount remains payable later
- remarks

### `Items`

One or more rows linked by offline invoice number:

- product/recipe code
- carton quantity
- loose-unit quantity
- protected snapshot base price
- protected saved discount/free-carton result
- calculated charged and dispatched quantities
- calculated line total
- physical-stock-confirmed boolean, required only when workbook running stock is insufficient

Operator can edit only invoice link, product selection, and physical quantities. Price, discount, free-carton, carton-size, and cost-snapshot values are not editable.

Server never trusts cached Excel totals. It recalculates amounts from signed reference snapshot and literal quantities.

### `Payments`

Zero or more rows linked by offline invoice number:

- method: cash, bank transfer, or cheque
- amount
- destination wallet/account code
- bank transaction reference when bank transfer
- cheque bank, number, and date when cheque

Pay later is not a payment row. It is the remaining Outstanding Amount.

### `Reference Data`

Server-generated snapshot containing:

- existing distributors and codes
- distributor balance, credit limit, and hold status at issue time
- products/recipes and carton sizes
- fixed distributor prices
- saved discount/free-carton rules
- pending/eligible booked orders with order-booker code and bill number
- last-known sellable stock
- WAC/COGS snapshot required for outage profit calculations
- available cash and bank wallet/account codes
- snapshot/version metadata

Direct-sale dropdown lists existing distributors only. Arbitrary distributor names cannot be entered.

For a booked order, import resolves customer exactly like current online conversion: match order's shopkeeper by mobile, then by name. If no customer exists, create one from booked order's saved shopkeeper details inside invoice transaction. Workbook text cannot create or rename that customer.

### `Print Invoice`

Operator chooses an offline invoice number and prints its customer invoice.

- Distributor invoice follows current distributor visible layout.
- Booked-order/general invoice follows current matching visible layout.
- Existing signature and stamp areas from the matching current template remain.
- No new signature requirement is added.
- Public number is the offline `OFF-...` number.
- Online React print component files remain unchanged.

## 7. Outage workflow

### Direct distributor example

1. Internet fails.
2. Operator opens active workbook.
3. Operator selects existing distributor.
4. Operator selects products and enters actual quantities.
5. Workbook uses fixed snapshot prices and saved discount rules.
6. Operator enters cash, bank-transfer, cheque, or mixed payment rows.
7. Workbook calculates Paid Amount, pending instruments, and Outstanding Amount.
8. Credit/stock snapshot differences show warnings but do not prevent printing or dispatch.
9. Operator prints current-style customer invoice with `OFF-...` number.
10. Goods leave and workbook is saved locally.

### Booked-order example

1. Operator chooses `booked_order`.
2. Operator selects or enters order-booker code and bill number from the existing order/paper order reference.
3. Workbook loads snapshot order items when available.
4. Operator records actual dispatched quantities; these become invoice truth.
5. Import later resolves exact existing order, links invoice, marks order delivered, and calculates commission from actual fulfilled amount.

An unknown or already-invoiced order never silently becomes a direct sale.

An unknown order stays Needs Review until an authorized user creates or selects exact order. For an already-invoiced order, reviewer must explicitly choose one audited resolution: mark offline row as same dispatch and therefore duplicate; void/reverse incorrect online invoice before posting offline invoice; or, when evidence proves a second physical dispatch, post a separate general invoice without second order commission. No conflict is resolved automatically.

## 8. Warning-only business controls

### Credit

Workbook shows last-known balance, limit, and projected balance. Over-limit or credit-hold state is a warning only. Dispatch remains allowed. On upload, current state is shown to reviewer and full physical sale still must be recorded.

### Stock

Workbook starts with last-known stock and subtracts its own offline invoices in sequence. When requested quantity exceeds workbook balance, operator records physical-stock confirmation with a boolean field. No signature is used.

Upload compares live database stock. A shortage becomes a stock-reconciliation issue. It cannot cause completed physical sale to disappear.

When live stock is insufficient at posting, system deducts available stock down to zero and records remaining deficit units in a reconciliation issue linked to invoice and product. It does not create malformed negative carton/container values. Inventory staff must resolve issue through a counted adjustment or missing production/transfer record; resolution keeps full audit history.

### Prices and discounts

Any altered price, carton size, discount, free-carton rule, protected formula contract, or signed reference value is rejected. These controls are not warning-only.

Direct distributor lines use signed distributor price and saved discount/free-carton rules from workbook snapshot. Booked-order lines use rate already saved on matched order. Import preserves price printed during outage; a later online price change produces audit context, not a new invoice price.

## 9. Upload and staging flow

1. Authorized user uploads workbook and states outage start, outage end, and reason.
2. Server enforces file, ZIP-expansion, macro, link, row-count, and template limits.
3. Server verifies workbook identity, active/replaced state, template/signing versions, invoice tokens, and reference snapshot.
4. Server calculates SHA-256 file hash for audit, then discards raw bytes after parsing.
5. Literal rows are normalized into immutable staging records.
6. Server classifies every invoice as Ready, Warning, Duplicate, Invalid, or Needs Review.
7. Reviewer sees header, items, payments, totals, warnings, live matches, and predicted effects.
8. Reviewer confirms eligible invoices.
9. Server revalidates live state and posts each invoice through shared invoice/settlement service.
10. Result shows posted, duplicate, failed, and unresolved invoices.

Staging data is normalized database data, not document storage.

## 10. Stored data model

Names may follow project naming conventions, but responsibilities and constraints are fixed:

- `offline_sales_workbooks`: factory, operator, status, issue/close/retire times, template/snapshot/signing versions, and forced-retirement reason. A partial unique index allows one active workbook for `F01`.
- `offline_sales_invoice_slots`: workbook, immutable token, reserved offline serial, slot number, state, staged content hash, posted invoice, and consumed time. Token, serial, and `(workbook, slot)` are unique.
- `offline_sales_import_batches`: workbook, SHA-256 file hash, outage window/reason, uploader, reviewer, status, and counts. Repeated file hash is recognized without storing file bytes.
- staging invoice, item, and payment tables: normalized literal input, calculated server values, classification, row/column source location, warning codes, and review resolution. Posted staging rows are immutable.
- `stock_reconciliation_issues`: invoice/item/product, warehouse, deficit units, snapshot/live values, status, resolver, reason, and timestamps.
- final `invoices`, `invoice_items`, `payments`, order, commission, slip, customer, wallet, and audit records remain accounting source of truth after posting.

Staging records may be retained for audit and safe retry. They contain business fields only, never workbook file, OOXML fragments, rendered document, or embedded media.

## 11. Validation and classification

### Whole-file rejection

- unsupported extension or unsafe OOXML/ZIP structure
- macro, encryption, external link, or data connection
- missing/renamed required sheet or column
- invalid workbook signature or unsupported version
- file/row/capacity limit exceeded

### Invoice classification

- **Ready:** all references and calculations match; no warning exists.
- **Warning:** invoice is structurally valid but current stock, credit, payment, or snapshot state needs acknowledgment/reconciliation.
- **Duplicate:** immutable invoice identity already posted with identical content.
- **Invalid:** required value or signed/locked business value is unusable or altered.
- **Needs Review:** readable sale has order/customer/product/payment conflict that requires resolution.
- **Posted:** invoice and all dependent records committed.

One bad invoice does not roll back unrelated valid invoices. One invoice and all its item/payment/order/stock/ledger effects remain all-or-nothing.

## 12. Idempotency and concurrency

- Unique database constraint on workbook ID plus invoice record token.
- Unique public offline invoice number.
- Database-level unique rule preventing two invoices for one booked order.
- Payment rows carry immutable offline row identities.
- Re-uploaded matching content becomes Duplicate.
- Same identity with changed content becomes Needs Review and never overwrites posted data.
- Confirmation rechecks live database because online work may have happened after preview.
- Pending bank/cheque confirmation uses conditional state transitions and can credit wallet once only.

## 13. Posting effects

Confirmed offline posting uses original outage business time for:

- invoice date
- slip issue date
- cash payment date
- order fulfillment date
- commission earned date

Database creation/import time remains separate audit time.

Pending transfer/cheque retains outage receipt date, but receives accounting `effectiveDate` only when finance verifies bank posting or cheque clearance. This prevents upload time from pretending to be sale/payment time while keeping pending money out of confirmed collections.

Posting performs:

- invoice and item creation
- stock deduction to zero plus a tracked deficit issue when live stock is insufficient
- distributor/customer sales and outstanding balance update
- confirmed cash wallet transaction
- pending bank-transfer and cheque rows without wallet credit
- slip/recovery creation
- booked-order delivery and commission when linked
- pricing and timeline audit
- report visibility

## 14. Report behavior

Before import, web reports necessarily omit offline workbook activity. Reconciliation UI must show that outage work is pending, and users must regenerate/export reports after import.

After posting:

- sales appear once on original sale date
- Paid Amount includes confirmed cash and later confirmed instruments
- Outstanding Amount includes pending instruments and true pay-later balance
- collection reports separate cash, bank transfer, and cheque
- wallets include only confirmed payments
- customer ledger uses same `OFF-...` invoice number given to customer
- booked order appears delivered once
- order-booker commission uses actual invoice amount and original fulfillment period
- offline source is available as report filter/audit field

## 15. Cost and stock limitation

Current finished-goods stock stores current weighted average cost, not a complete historical movement ledger. Offline sales therefore use the signed WAC/COGS snapshot issued with workbook for stock known at snapshot time.

Goods produced during the same outage cannot receive exact chronological WAC treatment until offline production/stock events exist. Initial offline-sales scope must flag such cases for stock reconciliation and must not silently use upload-time cost as if it were outage-time cost.

## 16. Permissions and audit

Separate RBAC permissions cover:

- issue/replace/retire active sales workbook
- upload workbook
- review staged invoices
- confirm/post eligible invoices
- confirm bank transfer
- clear or return cheque
- reverse confirmed payment
- resolve stock reconciliation warning

Audit stores workbook, file hash, uploader, reviewer, operator assignment, outage window, invoice/payment row identities, warnings, resolutions, confirmation actors, and timestamps. Raw workbook bytes are not stored.

## 17. UX requirements

- Plain wording: Paid Amount, Outstanding Amount, Pending Verification, Cheque Cleared, Cheque Returned.
- No unexplained accounting language.
- Workbook instructions fit on first visible sheet.
- Input cells are visually distinct from protected cells.
- Dropdowns prevent misspelled distributor/product/payment values.
- Preview groups one invoice header with its items and payments.
- Error points to exact sheet, row, column, value, and correction.
- Reviewer may replace a deleted/inactive destination wallet only with another wallet of same type. Distributor and product identities cannot be remapped. Order conflicts follow audited resolution in section 7. Reviewer cannot change quantities, prices, discounts, payment methods, or payment amounts; those require correcting and re-uploading workbook.
- Upload/review keeps staged work after recoverable server failure.
- Submit/confirm buttons lock during request.
- No signature prompts.
- Existing online print layout, signatures, and stamps remain unchanged.

## 18. Testing and acceptance

Automated coverage must include:

- workbook generation and fixed capacities
- workbook manifest/signature verification
- OOXML safety, macros, links, encryption, ZIP limits, and formulas in input cells
- existing-distributor-only direct sale
- fixed prices, discount rules, and altered-value rejection
- direct and booked-order invoice parsing
- mixed payments and method-specific requirements
- pending bank transfer and cheque
- credit and stock warning-only behavior
- physical-stock confirmation field
- duplicate workbook, invoice, item, payment, and booked-order identity
- same-day workbook replacement without invoice-number collision
- safe normal replacement and forced retirement
- booked-order customer match/create behavior
- already-invoiced order resolution without duplicate commission
- original sale time versus upload time in `Asia/Karachi`
- atomic per-invoice posting
- insufficient live stock deducted to zero with exact deficit issue
- report totals and offline-source filtering
- raw bytes absent after parsing
- print-format regression preserving current signatures/stamps

Manual factory drill:

1. Issue fresh workbook.
2. Disconnect factory internet.
3. Create direct distributor invoice with mixed payment.
4. Create booked-order invoice.
5. Trigger credit and stock warnings without blocking dispatch.
6. Print both invoices and compare with current templates.
7. Restore internet and upload same workbook twice.
8. Review/post first upload; verify second is duplicate.
9. Confirm bank transfer, clear one cheque, return another cheque.
10. Reconcile stock warning.
11. Compare stock, customer ledger, wallets, order status, commission, sales, outstanding, collection, and profit reports against hand calculations.

## 19. Implementation order

1. Complete and verify invoice settlement redesign dependency.
2. Offline sales schema, permissions, and migration.
3. Workbook signing, reference snapshots, numbering, and generation.
4. OOXML parser and safety validation.
5. Staging, classification, preview, and review services.
6. Shared invoice-posting integration for direct distributor sale.
7. Booked-order resolution, delivery, and commission integration.
8. Stock/credit warnings and reconciliation path.
9. Offline sales UI, hooks, navigation, and RBAC.
10. Reports, audit, and terminology updates.
11. Print regression checks and factory drill.

Offline invoicing is production-candidate only after the complete manual factory drill passes.
