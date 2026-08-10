# Offline Sales Excel Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one factory operator record, calculate, and print direct-distributor or booked-order invoices in Excel during an internet outage, then safely import those physical sales into normal Titan ERP accounting.

**Architecture:** Server issues one signed, macro-free workbook containing immutable reference snapshot and 500 reserved offline invoice identities. Upload parses bytes only in memory, stores normalized staging records, classifies each invoice, and posts approved invoices independently through shared invoice/settlement service. Final invoices, payments, stock, order, commission, customer, wallet, slip, ledger, and report tables remain accounting source of truth.

**Tech Stack:** TanStack Start server functions and file routes, React 19, TanStack Query, Zod 4, Drizzle ORM, PostgreSQL, @zip.js/zip.js 2.8.34, saxes 6.0.0, Node crypto HMAC-SHA-256, Vitest, Testing Library.

## Global Constraints

- Invoice settlement redesign plan must pass its acceptance gate before this plan starts.
- One factory code: `F01`.
- One active official offline sales workbook and one designated operator at a time.
- Attendance and sales workbooks remain separate.
- Workbook capacity: 500 invoice headers, 10,000 items, 2,000 payments, 200 items per invoice, and 10 MB uploaded bytes.
- Accept only `.xlsx`; reject `.xlsm`, macros, encryption, external links/data, unsafe ZIP structure, unexpected sheets/columns, formulas in editable cells, and unsupported template/signing versions.
- Required sheets are exactly `Invoices`, `Items`, `Payments`, `Reference Data`, and `Print Invoice`.
- Parse bytes in memory. Never store workbook bytes, OOXML fragments, rendered files, embedded media, or uploaded documents in PostgreSQL, filesystem, object storage, logs, or backups.
- Normalized staging records and SHA-256 file hash may be retained.
- Direct offline sales may select existing distributors only.
- Booked-order rows must match existing order by order-booker code plus bill number.
- Unknown or already-invoiced orders never silently become direct sales.
- Prices cannot be edited. Direct sales use signed snapshot distributor price and saved discount/free-carton rules. Booked orders use saved order rate.
- Manual extra discounts, price overrides, and free cartons are forbidden.
- Credit hold/limit and stock shortage are warning-only for completed physical dispatch.
- Insufficient live stock posts available quantity down to zero and creates exact deficit reconciliation issue; malformed negative carton/container values are forbidden.
- No signatures are required by workflow. Offline print mirrors current matching layout: no distributor signatures; existing general/retailer signatures and stamps remain.
- Do not modify `src/components/sales/distributor-invoice.tsx` or `src/components/sales/retailer-invoice.tsx`.
- Cash confirms on import. Bank transfer and cheque remain pending until finance action.
- Payment terms and states come from invoice settlement redesign; no mobile-wallet support.
- Offline public number is `OFF-F01-YYYYMMDD-<serial>`. Reserved serial is global, never reused, padded to at least three digits, and may exceed 999.
- Import never renumbers printed `OFF-...` invoice.
- Reports use original business event dates. Upload/review/confirmation timestamps remain separate audit dates.
- Feature ships behind `OFFLINE_SALES_IMPORT_ENABLED=false` and remains disabled until factory drill passes.
- No local server, local database, backup internet, browser/PWA offline entry, FBR, or tax integration.
- Do not edit `src/routeTree.gen.ts`; build regenerates it.
- After code changes, run `graphify update .`.
- Approved design: `docs/superpowers/specs/2026-08-10-offline-sales-excel-invoicing-design.md`.

## File Structure

### Shared safe XLSX boundary

- Create `src/lib/offline-xlsx/contracts.ts`: generic OOXML limits.
- Create `src/lib/offline-xlsx/ooxml-guard.server.ts`: extracted strict ZIP/XML safety guard.
- Create `src/lib/offline-xlsx/ooxml-guard.test.ts`: generic package attack fixtures.
- Modify `src/lib/attendance/offline/ooxml-guard.server.ts`: attendance-configured wrapper over shared guard.
- Modify `src/lib/attendance/offline/ooxml-guard.test.ts`: regression coverage after extraction.

### Offline sales domain

- Create `src/lib/sales/offline/constants.ts`: template, row, file, ZIP, batch, and lease limits.
- Create `src/lib/sales/offline/contracts.ts`: manifest, snapshot, parsed, classification, and API types.
- Create `src/lib/sales/offline/feature-flag.server.ts`: runtime feature guard.
- Create `src/lib/sales/offline/signing.server.ts`: manifest/snapshot/slot signing and content hashing.
- Create `src/lib/sales/offline/signing.test.ts`: deterministic and tamper tests.
- Create `src/lib/sales/offline/reference-snapshot.server.ts`: immutable database snapshot builder.
- Create `src/lib/sales/offline/reference-snapshot.test.ts`: snapshot normalization/source tests.
- Create `src/lib/sales/offline/workbook-template.server.ts`: exact five-sheet OOXML generator.
- Create `src/lib/sales/offline/workbook-template.test.ts`: sheets, protection, formulas, capacities, and print contract.
- Create `src/lib/sales/offline/workbook-parser.server.ts`: literal input and signed reference parser.
- Create `src/lib/sales/offline/workbook-parser.test.ts`: valid/invalid workbook fixtures.
- Create `src/lib/sales/offline/classification.server.ts`: live-data matching and classification.
- Create `src/lib/sales/offline/classification.test.ts`: Ready/Warning/Duplicate/Invalid/Needs Review rules.
- Create `src/lib/sales/offline/posting.server.ts`: per-invoice locks, revalidation, and shared posting call.
- Create `src/lib/sales/offline/posting.test.ts`: posting source contracts.

### Database and permissions

- Create `src/db/schemas/offline-sales-schema.ts`: workbook, slot, import batch, staged invoice/item/payment, and stock issue tables.
- Modify `src/db/schemas/sales-schema.ts`: final offline slot link and source indexes.
- Modify `src/db/schemas/sales-erp-schema.ts`: commission earned date and offline payment identity link.
- Modify `src/db/index.ts`: export offline sales schema.
- Create `src/db/migrations/0010_offline_sales_invoicing.sql` and Drizzle metadata.
- Create `src/db/schemas/offline-sales-schema.test.ts`: constraints and indexes.
- Modify `src/lib/rbac.ts`, `src/lib/middlewares.ts`, and `src/lib/constants.ts`: offline sales permissions/navigation.

### Server functions and UI

- Create `src/server-functions/sales/offline-workbooks-fn.ts`: issue, list, download, close/replace, and force-retire.
- Create `src/server-functions/sales/offline-upload-fn.ts`: in-memory upload and immutable staging.
- Create `src/server-functions/sales/offline-review-fn.ts`: queues, preview refresh, acknowledgments, wallet correction, and order conflict resolution.
- Create `src/server-functions/sales/offline-post-fn.ts`: bounded post/resume.
- Create `src/server-functions/sales/offline-stock-reconciliation-fn.ts`: list and resolve stock deficits.
- Create `src/hooks/sales/use-offline-sales.ts`: query keys and mutations.
- Create `src/routes/_protected/sales/offline.tsx`: protected route and prefetch.
- Create `src/components/sales/offline/offline-sales-page.tsx`: page shell and tabs.
- Create `src/components/sales/offline/workbook-panel.tsx`: lifecycle controls.
- Create `src/components/sales/offline/upload-panel.tsx`: file/outage metadata.
- Create `src/components/sales/offline/review-panel.tsx`: grouped invoice review/posting.
- Create `src/components/sales/offline/import-history.tsx`: audit and duplicate outcomes.
- Create `src/components/sales/offline/stock-reconciliation-panel.tsx`: deficit resolution.

### Reports, tests, and operations

- Modify `src/server-functions/reports/sales-report-fn.ts`, `src/server-functions/reports/collections-report-fn.ts`, `src/server-functions/reports/outstanding-report-fn.ts`, `src/server-functions/reports/profit-loss/company-reporting-core.ts`, `src/server-functions/reports/profit-loss/reporting-core.ts`, and `src/server-functions/reports/profit-loss/export-csv-fn.ts`: source/date filtering and pending-import context.
- Modify `src/server-functions/hr/payroll/sales-performance-fn.ts`: original order fulfillment/commission business date.
- Create `src/__tests__/integration/offline-sales-import.integration.test.ts`: concurrent idempotency and full accounting effects.
- Create `docs/operations/offline-sales-invoicing-runbook.md`: issue, outage, upload, review, reconciliation, recovery, key rotation, and drill.
- Modify `.env.example`, `vitest.integration.config.ts`, and `.github/workflows/ci.yml`. Reuse the existing PostgreSQL test service unchanged.

---

### Task 1: Shared OOXML Safety Boundary and Sales Feature Guard

**Files:**
- Create: `src/lib/offline-xlsx/contracts.ts`
- Create: `src/lib/offline-xlsx/ooxml-guard.server.ts`
- Create: `src/lib/offline-xlsx/ooxml-guard.test.ts`
- Modify: `src/lib/attendance/offline/ooxml-guard.server.ts`
- Modify: `src/lib/attendance/offline/ooxml-guard.test.ts`
- Create: `src/lib/sales/offline/constants.ts`
- Create: `src/lib/sales/offline/feature-flag.server.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces `inspectSafeXlsxPackage(bytes, limits): Promise<void>`.
- Attendance wrapper preserves `inspectXlsxPackage(bytes): Promise<void>`.
- Produces `requireOfflineSalesEnabled(): void`.

- [ ] **Step 1: Write failing generic guard tests**

Reuse existing ZIP fixtures and cover empty/oversized file, encrypted entry, duplicate/path traversal, Zip64, entry/expanded-size limit, VBA, external links, connections, query tables, embeddings, ActiveX, control properties, missing core parts, external relationships, invalid UTF-8, and XML doctype.

- [ ] **Step 2: Extract configurable guard without changing attendance API**

```ts
export type SafeXlsxLimits = {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};
```

Move current guard implementation into shared module and replace imported attendance constants with `limits`. Attendance wrapper becomes:

```ts
import { inspectSafeXlsxPackage } from "@/lib/offline-xlsx/ooxml-guard.server";
import { OFFLINE_WORKBOOK_MAX_BYTES, OFFLINE_ZIP_MAX_ENTRIES, OFFLINE_ZIP_MAX_ENTRY_BYTES, OFFLINE_ZIP_MAX_TOTAL_BYTES } from "./constants";

export function inspectXlsxPackage(bytes: Uint8Array) {
  return inspectSafeXlsxPackage(bytes, {
    maxBytes: OFFLINE_WORKBOOK_MAX_BYTES,
    maxEntries: OFFLINE_ZIP_MAX_ENTRIES,
    maxEntryBytes: OFFLINE_ZIP_MAX_ENTRY_BYTES,
    maxTotalBytes: OFFLINE_ZIP_MAX_TOTAL_BYTES,
  });
}
```

- [ ] **Step 3: Add sales constants and runtime guard**

```ts
export const OFFLINE_SALES_TEMPLATE_VERSION = 1;
export const OFFLINE_SALES_FACTORY_CODE = "F01";
export const OFFLINE_SALES_INVOICE_CAPACITY = 500;
export const OFFLINE_SALES_ITEM_CAPACITY = 10_000;
export const OFFLINE_SALES_PAYMENT_CAPACITY = 2_000;
export const OFFLINE_SALES_MAX_ITEMS_PER_INVOICE = 200;
export const OFFLINE_SALES_MAX_BYTES = 10 * 1024 * 1024;
export const OFFLINE_SALES_ZIP_MAX_ENTRIES = 512;
export const OFFLINE_SALES_ZIP_MAX_ENTRY_BYTES = 25 * 1024 * 1024;
export const OFFLINE_SALES_ZIP_MAX_TOTAL_BYTES = 75 * 1024 * 1024;
export const OFFLINE_SALES_POST_LIMIT = 20;
export const OFFLINE_SALES_POST_LEASE_MS = 2 * 60_000;
```

```ts
export function requireOfflineSalesEnabled() {
  if (process.env.OFFLINE_SALES_IMPORT_ENABLED !== "true") {
    throw new Error("Offline sales import is disabled");
  }
}
```

Add disabled feature/key environment entries:

```dotenv
OFFLINE_SALES_IMPORT_ENABLED=false
OFFLINE_SALES_SIGNING_KEYS={"1":"replace-with-base64-32-byte-key"}
OFFLINE_SALES_ACTIVE_SIGNING_VERSION=1
```

- [ ] **Step 4: Run shared and attendance regression tests**

Run: `bunx vitest run src/lib/offline-xlsx/ooxml-guard.test.ts src/lib/attendance/offline/ooxml-guard.test.ts src/lib/attendance/offline/workbook-parser.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline-xlsx src/lib/attendance/offline/ooxml-guard.server.ts src/lib/attendance/offline/ooxml-guard.test.ts src/lib/sales/offline/constants.ts src/lib/sales/offline/feature-flag.server.ts .env.example
git commit -m "refactor: share safe xlsx package inspection"
```

---

### Task 2: Offline Sales Data Model, Migration, and RBAC

**Files:**
- Create: `src/db/schemas/offline-sales-schema.ts`
- Modify: `src/db/schemas/sales-schema.ts`
- Modify: `src/db/schemas/sales-erp-schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/schemas/offline-sales-schema.test.ts`
- Create: `src/db/migrations/0010_offline_sales_invoicing.sql`
- Create: `src/db/migrations/meta/0010_snapshot.json`
- Modify: `src/db/migrations/meta/_journal.json`
- Modify: `src/lib/rbac.ts`
- Modify: `src/lib/middlewares.ts`
- Modify: `src/lib/rbac.test.ts`

**Interfaces:**
- Produces `offlineSalesWorkbooks`, `offlineSalesInvoiceSlots`, `offlineSalesImportBatches`, `offlineSalesStagedInvoices`, `offlineSalesStagedItems`, `offlineSalesStagedPayments`, and `stockReconciliationIssues`.
- Produces permissions `sales.offline.view`, `sales.offline.workbooks.manage`, `sales.offline.upload`, `sales.offline.review`, `sales.offline.post`, and `inventory.stock-reconciliation.manage`.

- [ ] **Step 1: Write failing schema and RBAC tests**

Assert one active workbook for `F01`, unique slot token/serial/workbook-slot, unique batch/file lookup, unique staged workbook/token identity, exact child foreign keys, immutable posted link, stock deficit greater than zero, and required permission grants for admin. Finance manager receives view/review/post but not workbook issuance unless explicitly granted through role editor.

- [ ] **Step 2: Define exact workflow states**

```ts
export type OfflineSalesWorkbookStatus = "active" | "closed" | "force_retired";
export type OfflineSalesSlotStatus = "unused" | "staged" | "posted" | "voided" | "conflict";
export type OfflineSalesBatchStatus = "uploaded" | "preview_ready" | "posting" | "completed" | "completed_with_issues" | "rejected";
export type OfflineSalesInvoiceStatus = "ready" | "warning" | "duplicate" | "invalid" | "needs_review" | "posted" | "excluded";
export type StockReconciliationStatus = "open" | "resolved";
```

Workbook row stores factory/operator/issuer, status, capacities, template/signing versions, canonical reference snapshot JSON, snapshot SHA-256, issue/close/retire actors/times/reasons, and replacement link. Slot row stores workbook, slot number, reserved serial, token, status, staged content hash, staged invoice, posted invoice, and consumed time.

Batch stores file hash/size, outage start/end/reason, uploader/reviewer, counts, lease, error, and audit times. Staging children store normalized business values plus exact sheet/row/column source locations. Stock issue stores invoice/item/recipe/warehouse, requested/available/deficit units, snapshot/live values, resolution actor/reason/time.

- [ ] **Step 3: Add final-record links**

Add nullable unique `offlineSalesSlotId` to invoices with `onDelete: restrict`. Populate the settlement plan's existing payment `sourceRecordId` with the staged payment ID; do not add a second offline-only payment link. Add `earnedAt` timezone timestamp to commission records and use it for business reporting.

- [ ] **Step 4: Generate and review migration**

Run: `bun run db:generate`

Migration must create tables/indexes/checks, add final links, backfill existing commission `earnedAt` from `createdAt`, then make it required. It must not reset, truncate, or drop business tables.

- [ ] **Step 5: Add permission middleware**

```ts
export const requireOfflineSalesViewMiddleware = createPermissionMiddleware("sales.offline.view");
export const requireOfflineSalesWorkbookManageMiddleware = createPermissionMiddleware("sales.offline.workbooks.manage");
export const requireOfflineSalesUploadMiddleware = createPermissionMiddleware("sales.offline.upload");
export const requireOfflineSalesReviewMiddleware = createPermissionMiddleware("sales.offline.review");
export const requireOfflineSalesPostMiddleware = createPermissionMiddleware("sales.offline.post");
export const requireStockReconciliationManageMiddleware = createPermissionMiddleware("inventory.stock-reconciliation.manage");
```

- [ ] **Step 6: Run schema/RBAC tests**

Run: `bunx vitest run src/db/schemas/offline-sales-schema.test.ts src/lib/rbac.test.ts src/lib/authz-seeding.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schemas/offline-sales-schema.ts src/db/schemas/sales-schema.ts src/db/schemas/sales-erp-schema.ts src/db/index.ts src/db/schemas/offline-sales-schema.test.ts src/db/migrations src/lib/rbac.ts src/lib/middlewares.ts src/lib/rbac.test.ts
git commit -m "feat: add offline sales import data model"
```

---

### Task 3: Signed Reference Snapshot and Workbook Lifecycle

**Files:**
- Create: `src/lib/sales/offline/contracts.ts`
- Create: `src/lib/sales/offline/signing.server.ts`
- Create: `src/lib/sales/offline/signing.test.ts`
- Create: `src/lib/sales/offline/reference-snapshot.server.ts`
- Create: `src/lib/sales/offline/reference-snapshot.test.ts`
- Create: `src/server-functions/sales/offline-workbooks-fn.ts`
- Create: `src/server-functions/sales/offline-workbooks-fn.test.ts`

**Interfaces:**
- Produces `buildOfflineSalesReferenceSnapshot(tx): Promise<OfflineSalesReferenceSnapshot>`.
- Produces `signOfflineSalesManifest`, `signOfflineSalesSnapshot`, `createOfflineSalesSlotToken`, `verifyOfflineSalesSlotToken`, and `hashOfflineSalesInvoice`.
- Produces issue/list/download/close-replace/force-retire server functions.

- [ ] **Step 1: Write failing signing/snapshot tests**

Cover stable key ordering, deterministic signature, wrong workbook/operator/version rejection, timing-safe token comparison, snapshot change rejection, serial/slot binding, missing key while enabled, and no build-time key requirement while feature disabled.

- [ ] **Step 2: Define manifest and normalized snapshot**

```ts
export type OfflineSalesManifest = {
  format: "titan-offline-sales";
  workbookId: string;
  factoryCode: "F01";
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  invoiceCapacity: 500;
  itemCapacity: 10000;
  paymentCapacity: 2000;
  issuedAt: string;
  snapshotSha256: string;
};

export type OfflineSalesReferenceSnapshot = {
  distributors: Array<{ id: string; code: string; name: string; outstandingAmount: string; creditLimit: string; creditHold: boolean }>;
  products: Array<{ recipeId: string; code: string; name: string; packsPerCarton: number; distributorCartonPrice: string; wacPerPack: string; stockUnits: number }>;
  discountRules: Array<{ id: string; customerId: string; recipeId: string; quantityThreshold: number; freeCartons: number; effectiveFrom: string; effectiveTo: string | null }>;
  orders: Array<{ id: string; orderBookerId: string; orderBookerCode: string; billNumber: number; shopkeeperName: string; shopkeeperMobile: string | null; shopkeeperAddress: string | null; items: Array<{ recipeId: string; productCode: string; quantity: number; rate: string }> }>;
  wallets: Array<{ id: string; code: string; name: string; type: "cash" | "bank" }>;
};

export type OfflineSalesUploadResult = {
  batchId: string;
  fileSha256: string;
  status: "preview_ready" | "rejected";
  counts: { ready: number; warning: number; duplicate: number; invalid: number; needsReview: number };
};

export type OfflineSalesBatchDetail = {
  batchId: string;
  status: OfflineSalesBatchStatus;
  counts: OfflineSalesUploadResult["counts"];
  invoices: Array<{ stagedInvoiceId: string; invoiceNumber: string; status: OfflineSalesInvoiceStatus; issueCodes: string[] }>;
};

export type PostBatchResult = {
  batchId: string;
  status: OfflineSalesBatchStatus;
  posted: number;
  failed: number;
  remaining: number;
  hasMore: boolean;
};
```

Distributor code is `D-<customer.sNo>`; its signed ID remains `customer.id`. Product and order-booker codes use their signed IDs because those current tables have no separate business code. Dropdowns show the friendly name beside each code, so operators do not need to type IDs. Orders include only pending/confirmed and not already invoiced.

- [ ] **Step 3: Build canonical signing**

Use recursive key-sorted JSON for snapshot hash. HMAC keyring comes only from `OFFLINE_SALES_SIGNING_KEYS`. Domain strings are distinct:

```text
titan-offline-sales-manifest-v1
titan-offline-sales-snapshot-v1
titan-offline-sales-slot-v1
```

Slot token binds workbook, operator, template/signing versions, slot number, and reserved serial.

- [ ] **Step 4: Implement issuance transaction**

Issue flow:

1. Require feature enabled and designated operator user.
2. Reject existing active `F01` workbook.
3. Build normalized reference snapshot in same transaction.
4. Reserve exactly 500 offline serials with `reserveOfflineInvoiceSerials`.
5. Insert workbook and 500 immutable slot rows/tokens.
6. Commit, then generate download bytes from committed data.

Normal replacement requires checkbox `usedRowsUploaded: true`, no unresolved batch, closes old workbook, voids unused slots, and issues replacement in one transaction. Force retirement requires reason 5–500 characters and separate permission; all unused slots become voided. Later upload from force-retired workbook is always Needs Review.

- [ ] **Step 5: Run tests**

Run: `bunx vitest run src/lib/sales/offline/signing.test.ts src/lib/sales/offline/reference-snapshot.test.ts src/server-functions/sales/offline-workbooks-fn.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/offline/contracts.ts src/lib/sales/offline/signing.server.ts src/lib/sales/offline/signing.test.ts src/lib/sales/offline/reference-snapshot.server.ts src/lib/sales/offline/reference-snapshot.test.ts src/server-functions/sales/offline-workbooks-fn.ts src/server-functions/sales/offline-workbooks-fn.test.ts
git commit -m "feat: issue signed offline sales workbooks"
```

---

### Task 4: Five-Sheet Workbook Generator and Offline Print

**Files:**
- Create: `src/lib/sales/offline/workbook-template.server.ts`
- Create: `src/lib/sales/offline/workbook-template.test.ts`
- Modify: `src/server-functions/sales/offline-workbooks-fn.ts`

**Interfaces:**
- Produces `buildOfflineSalesWorkbook(input): Promise<Uint8Array>`.
- Produces exact header arrays for Invoices, Items, Payments, and Reference Data.
- Produces download response headers with `no-store` and `.xlsx` filename.

- [ ] **Step 1: Write failing workbook contract tests**

Inspect generated ZIP/XML and assert:

- exactly five approved sheets, in approved order
- no macros/external links/connections
- 500 signed invoice slots, 10,000 item rows, and 2,000 payment rows
- editable cells unlocked and immutable cells locked/hidden
- list validations for sale type, distributors, orders, products, methods, and wallets
- workbook formulas never determine server truth
- public number formula uses dispatch date plus reserved serial
- price/discount/WAC/reference values protected
- physical confirmation field exists
- Print Invoice selection and multi-page print area exist
- distributor print contains no signature labels
- booked-order/general print contains Customer Signature and Account Signature labels

- [ ] **Step 2: Build exact sheet contracts**

Invoices editable columns: sale date, sale time, sale type, distributor code, order-booker code, bill number, Payment Due Date, remarks. Hidden protected columns: slot, serial, token, computed public number.

Items editable columns: invoice number, product code, carton quantity, loose quantity, physical stock confirmed. Protected columns: price, carton size, rule ID/result, charged units, dispatched units, WAC, and total.

Payments editable columns: invoice number, method, amount, wallet code, transfer reference, cheque bank/number/date. Pay later is absence of payment rows.

Reference Data contains signed normalized snapshot and hidden manifest/signature fields. Print Invoice contains one selected invoice number and formula-driven header/items/totals.

- [ ] **Step 3: Implement compatible print formulas**

Use `INDEX`, `MATCH`, `COUNTIF`, and `AGGREGATE`; do not require macros or dynamic-array functions. Reserve 200 protected item display rows. Named print area ends at last non-empty item row plus matching footer. More than 200 items for one invoice is blocked by workbook validation and server parser.

Signature labels use formulas so they are blank for direct distributor and visible for booked-order/general:

```excel
=IF(selected_sale_type="booked_order","Customer Signature","")
=IF(selected_sale_type="booked_order","Account Signature","")
```

Use conditional formatting to hide corresponding signature borders for direct distributor.

- [ ] **Step 4: Generate safe response**

```ts
return new Response(bytes, {
  headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="offline-sales-F01-${workbook.id}.xlsx"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});
```

- [ ] **Step 5: Run workbook and safety tests**

Run: `bunx vitest run src/lib/sales/offline/workbook-template.test.ts src/lib/offline-xlsx/ooxml-guard.test.ts --maxWorkers=1`

Expected: PASS and generated bytes stay below 10 MB.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/offline/workbook-template.server.ts src/lib/sales/offline/workbook-template.test.ts src/server-functions/sales/offline-workbooks-fn.ts
git commit -m "feat: generate printable offline sales workbook"
```

---

### Task 5: Strict Workbook Parser and Normalized Invoice Hashing

**Files:**
- Create: `src/lib/sales/offline/workbook-parser.server.ts`
- Create: `src/lib/sales/offline/workbook-parser.test.ts`

**Interfaces:**
- Produces `parseOfflineSalesWorkbook(bytes: Uint8Array): Promise<ParsedOfflineSalesWorkbook>`.
- Parsed output contains manifest, snapshot hash, file SHA-256, invoices, items, payments, source locations, and issues; never cached bytes.

- [ ] **Step 1: Write failing parser tests**

Create fixture by generating workbook then rewriting literal cells in memory. Cover valid direct invoice, valid booked order, mixed payments, numeric/text Excel dates/times, partially filled rows, orphan items/payments, duplicate slot/invoice links, formulas in editable cells, altered token/serial/snapshot/price/rule/formula, unknown sheet/column, more than 200 items per invoice, row/file limits, and unsafe OOXML.

- [ ] **Step 2: Implement exact sheet and cell parsing**

Call shared OOXML guard first. Parse workbook relationships with `saxes`; resolve exact five sheet targets; reject shared formulas/array formulas in editable input cells; accept only inline/shared string, numeric, boolean, and supported date cells. Verify manifest/snapshot signatures and every used slot token.

Normalize Asia/Karachi sale timestamp from date and time. Reject future dispatch beyond five-minute clock tolerance and any timestamp outside declared outage during upload classification.

- [ ] **Step 3: Recalculate immutable business values**

For direct distributor, calculate price/discount/free cartons from signed snapshot using existing invoice pricing helpers. For booked order, calculate from saved order rate in snapshot. Compare protected Excel display values only to detect tampering; never import Excel totals.

Hash each invoice from canonical normalized header, sorted items, and sorted payments. Include method details, quantities, due date, public number, slot token, and business timestamp.

- [ ] **Step 4: Run parser tests**

Run: `bunx vitest run src/lib/sales/offline/workbook-parser.test.ts src/lib/sales/offline/signing.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/offline/workbook-parser.server.ts src/lib/sales/offline/workbook-parser.test.ts
git commit -m "feat: parse offline sales workbooks safely"
```

---

### Task 6: Upload, Staging, Live Classification, and Review Resolution

**Files:**
- Create: `src/lib/sales/offline/classification.server.ts`
- Create: `src/lib/sales/offline/classification.test.ts`
- Create: `src/server-functions/sales/offline-upload-fn.ts`
- Create: `src/server-functions/sales/offline-upload-fn.test.ts`
- Create: `src/server-functions/sales/offline-review-fn.ts`
- Create: `src/server-functions/sales/offline-review-fn.test.ts`

**Interfaces:**
- Produces `stageOfflineSalesUpload(input): Promise<OfflineSalesUploadResult>`.
- Produces `refreshOfflineSalesPreview(batchId): Promise<OfflineSalesBatchDetail>`.
- Produces review mutations for warning acknowledgment, same-type wallet replacement, exclusion, and exact order conflict resolution.

- [ ] **Step 1: Write failing classification table tests**

Use these exact outcomes:

```ts
type OfflineInvoiceClassification = "ready" | "warning" | "duplicate" | "invalid" | "needs_review";
```

- Ready: signed references/totals match and live references are usable.
- Warning: valid physical sale with stock deficit, credit hold/limit difference, stale snapshot context, or force-retired workbook.
- Duplicate: same slot/token and identical content already posted.
- Invalid: malformed required input or altered signed/locked price/rule/token/template value.
- Needs Review: same identity changed, direct distributor/product deleted, wallet unavailable, order unknown/already invoiced, or a signed customer/product/order/wallet record is now inactive.

- [ ] **Step 2: Implement FormData upload boundary**

Require `.xlsx`, size 1–10 MB, outage start before end, end not future, reason 5–500 characters. Read one `Uint8Array`, parse, calculate hash, persist normalized rows in one transaction, and release byte reference before response. Rejected unsafe file stores only filename, size, hash when calculable, uploader, status, and safe error code.

- [ ] **Step 3: Make upload incremental and idempotent**

Re-upload of workbook with new used slots stages only new identities. Existing identical slot content becomes duplicate. Existing changed slot content becomes Needs Review and never overwrites staged/posted rows. Batch hash is audit/dedup aid; slot token plus content hash is authoritative.

- [ ] **Step 4: Implement live preview**

Load current distributor/product/order/wallet/stock/credit data in bounded queries. Store warning codes as structured strings:

```text
stock_shortage
credit_limit_exceeded
credit_hold_active
wallet_unavailable
order_not_found
order_already_invoiced
identity_content_changed
force_retired_workbook
```

Reviewer can acknowledge warnings, replace only deleted/inactive wallet with same wallet type, or exclude invoice with reason. Quantities, prices, discounts, methods, payment amounts, distributor, and product cannot be edited in web preview.

- [ ] **Step 5: Add explicit order conflict resolutions**

- `same_dispatch_duplicate`: exclude offline row and link audit to existing invoice.
- `replace_incorrect_online`: require incorrect online invoice already reversed/voided, then allow normal offline order posting.
- `second_physical_dispatch`: post separate general invoice, link conflict audit, and suppress second order commission.
- Unknown order must be created/matched by authorized order workflow before refresh; reviewer cannot invent it inside staging record.

- [ ] **Step 6: Run tests**

Run: `bunx vitest run src/lib/sales/offline/classification.test.ts src/server-functions/sales/offline-upload-fn.test.ts src/server-functions/sales/offline-review-fn.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sales/offline/classification.server.ts src/lib/sales/offline/classification.test.ts src/server-functions/sales/offline-upload-fn.ts src/server-functions/sales/offline-upload-fn.test.ts src/server-functions/sales/offline-review-fn.ts src/server-functions/sales/offline-review-fn.test.ts
git commit -m "feat: stage and classify offline sales uploads"
```

---

### Task 7: Atomic Offline Posting, Order Conversion, and Stock Deficits

**Files:**
- Create: `src/lib/sales/offline/posting.server.ts`
- Create: `src/lib/sales/offline/posting.test.ts`
- Create: `src/server-functions/sales/offline-post-fn.ts`
- Create: `src/server-functions/sales/offline-post-fn.test.ts`
- Create: `src/server-functions/sales/offline-stock-reconciliation-fn.ts`
- Create: `src/server-functions/sales/offline-stock-reconciliation-fn.test.ts`
- Modify: `src/server-functions/sales/invoice-posting-service.ts`
- Modify: `src/server-functions/sales/order-booker-commission-calc.ts`
- Modify: `src/server-functions/sales/sales-returns-fn.ts`

**Interfaces:**
- Extends `postInvoice` with `stockPolicy: "strict" | "offline_reconcile"`, `creditPolicy: "block" | "warn"`, and `pricingPolicy: "live" | "signed_snapshot"`.
- Produces `postOfflineSalesBatch(input): Promise<PostBatchResult>` with bounded resume.
- Produces stock issue list/resolve server functions.

- [ ] **Step 1: Write failing posting and concurrency tests**

Cover direct distributor, booked order, inline shopkeeper customer creation from order only, fixed price/rule, confirmed cash, pending bank/cheque, pay later, order delivered once, commission once from actual fulfilled amount, original business dates, live stock deficit, credit warning bypass, duplicate concurrent post, partial batch success, and transaction rollback per invoice.

- [ ] **Step 2: Acquire deterministic locks and revalidate**

For each invoice, open separate DB transaction and lock in order: slot, staged invoice, linked order, invoice counter row only when required, product stock rows sorted by recipe ID, then customer. Re-run classification under locks. Post only Ready or acknowledged Warning.

- [ ] **Step 3: Resolve customer and pricing**

Direct sale loads exact signed distributor ID; deleted distributor stays Needs Review. Booked order matches unique `(orderBookerId, billNumber)`, then customer match by mobile and name exactly like online conversion. If absent, create from order's stored shopkeeper fields; workbook text cannot supply identity.

Pass signed snapshot price/rule/carton/WAC data to posting service. Live price changes are recorded in audit context and never change printed invoice amount.

- [ ] **Step 4: Post stock shortage without negative carton state**

For each recipe:

```ts
const deductedUnits = Math.min(liveAvailableUnits, dispatchedUnits);
const deficitUnits = dispatchedUnits - deductedUnits;
```

Store remaining live stock as normalized non-negative cartons/containers after deducting `deductedUnits`. When `deficitUnits > 0`, insert one open reconciliation issue linked to final invoice item. COGS uses signed WAC snapshot. Resolution requires counted adjustment or missing production/transfer record ID plus reason; never edits invoice quantity.

- [ ] **Step 5: Post settlement and order effects**

Use printed `OFF-...` number and outage timestamp. Cash payment is confirmed with payment/effective date at outage receipt time and credits cash wallet once. Transfer/cheque stay pending with outage receipt date and no wallet movement. Recalculate invoice/slip/customer aggregates via settlement service.

Booked order marks delivered and sets fulfillment/commission `earnedAt` to outage business time. `second_physical_dispatch` creates no second commission and does not mutate original order delivery.

- [ ] **Step 6: Make posting resumable**

Claim batch lease, process at most 20 invoices per call, release/renew lease, and return counts. One invoice failure records safe reason and does not roll back other invoices. Unique slot/final invoice/order/payment identities make retries idempotent.

- [ ] **Step 7: Run focused and integration tests**

Run: `bunx vitest run src/lib/sales/offline/posting.test.ts src/server-functions/sales/offline-post-fn.test.ts src/server-functions/sales/offline-stock-reconciliation-fn.test.ts --maxWorkers=1`

With test PostgreSQL, run offline sales integration file using `vitest.integration.config.ts` and `--maxWorkers=1`.

Expected: PASS with final accounting effects exactly once.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sales/offline/posting.server.ts src/lib/sales/offline/posting.test.ts src/server-functions/sales/offline-post-fn.ts src/server-functions/sales/offline-post-fn.test.ts src/server-functions/sales/offline-stock-reconciliation-fn.ts src/server-functions/sales/offline-stock-reconciliation-fn.test.ts src/server-functions/sales/invoice-posting-service.ts src/server-functions/sales/order-booker-commission-calc.ts src/server-functions/sales/sales-returns-fn.ts
git commit -m "feat: post offline sales through shared accounting"
```

---

### Task 8: Offline Sales Page, Review UX, and Navigation

**Files:**
- Create: `src/hooks/sales/use-offline-sales.ts`
- Create: `src/hooks/sales/use-offline-sales.test.ts`
- Create: `src/routes/_protected/sales/offline.tsx`
- Create: `src/components/sales/offline/offline-sales-page.tsx`
- Create: `src/components/sales/offline/workbook-panel.tsx`
- Create: `src/components/sales/offline/upload-panel.tsx`
- Create: `src/components/sales/offline/review-panel.tsx`
- Create: `src/components/sales/offline/import-history.tsx`
- Create: `src/components/sales/offline/stock-reconciliation-panel.tsx`
- Create: `src/components/sales/offline/offline-sales-page.test.tsx`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/rbac.ts`

**Interfaces:**
- Query namespace `offlineSalesKeys` scopes workbooks, queue, batch detail, history, and stock issues.
- Route `/sales/offline` requires `sales.offline.view`.

- [ ] **Step 1: Write failing hook/page behavior tests**

Cover permission-aware tabs, download filename, normal replacement attestation, forced-retirement warning/reason, FormData upload, grouped invoice preview, exact source-cell errors, warning acknowledgment, restricted wallet correction, conflict resolution, posting resume, duplicate status, stock issue resolution, disabled duplicate submit, and retained values after recoverable error.

- [ ] **Step 2: Build page structure**

Tabs are `Workbook`, `Upload & Review`, `Import History`, and `Stock Issues`. First card explains three plain steps: keep workbook on factory computer, use it only when web app is unavailable, upload after internet returns.

Workbook panel shows operator, issued time, snapshot age, used/remaining invoice slots, status, Download, Replace, and Force Retire. Warn at 50 remaining slots and block at zero.

- [ ] **Step 3: Build upload and review**

Upload requests file, outage start/end, and reason. Review groups each invoice with items/payments. Status badges use Ready, Warning, Duplicate, Invalid, Needs Review, Posted. Error text contains sheet, row, column, bad value, and correction. Post button handles bounded resume until server returns no remaining eligible rows.

- [ ] **Step 4: Build reconciliation UX**

Stock issue card shows invoice, product, dispatched, available, deficit, outage date, and age. Resolution requires one of `Counted Adjustment` or `Missing Production/Transfer Record`, related record/reference, and reason. No signature field appears anywhere.

- [ ] **Step 5: Add navigation and route permissions**

Add Sales child `Offline Invoices` at `/sales/offline`. Add route matcher before generic `/sales` rule so users need `sales.offline.view`.

- [ ] **Step 6: Run UI/RBAC tests**

Run: `bunx vitest run src/hooks/sales/use-offline-sales.test.ts src/components/sales/offline/offline-sales-page.test.tsx src/lib/rbac.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/sales/use-offline-sales.ts src/hooks/sales/use-offline-sales.test.ts src/routes/_protected/sales/offline.tsx src/components/sales/offline src/lib/constants.ts src/lib/rbac.ts
git commit -m "feat: add offline sales import workspace"
```

---

### Task 9: Report Dates, Audit Visibility, Integration CI, and Runbook

**Files:**
- Modify: `src/server-functions/reports/sales-report-fn.ts`
- Modify: `src/server-functions/reports/collections-report-fn.ts`
- Modify: `src/server-functions/reports/outstanding-report-fn.ts`
- Modify: `src/server-functions/reports/profit-loss/company-reporting-core.ts`
- Modify: `src/server-functions/reports/profit-loss/reporting-core.ts`
- Modify: `src/server-functions/reports/profit-loss/export-csv-fn.ts`
- Modify: `src/server-functions/hr/payroll/sales-performance-fn.ts`
- Modify: `src/routes/_protected/reports/index.tsx`
- Modify: `src/routes/_protected/reports/sales/index.tsx`
- Modify: `src/routes/_protected/reports/collections/index.tsx`
- Modify: `src/routes/_protected/reports/outstanding/index.tsx`
- Modify: `src/routes/_protected/reports/profit-loss/index.tsx`
- Create: `src/lib/offline-sales-reporting.test.ts`
- Create: `src/__tests__/integration/offline-sales-import.integration.test.ts`
- Modify: `vitest.integration.config.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/operations/offline-sales-invoicing-runbook.md`

**Interfaces:**
- All sales/profit/commission reports use invoice/fulfillment business time.
- All collection/wallet reports use payment `effectiveDate`.
- All audit/history screens use created/uploaded/reviewed/confirmed timestamps.

- [ ] **Step 1: Write failing report date/source tests**

Fixture: sale dispatched 2026-08-10, imported 2026-08-11, bank transfer verified 2026-08-12 with bank posting date 2026-08-10, cheque cleared 2026-08-15. Assert sale/profit/commission appear 10th, bank collection/wallet appears 10th, cheque collection/wallet appears 15th, and audit shows actual later action times. Assert offline source filter never duplicates invoice.

- [ ] **Step 2: Update report queries and UI**

Add source filter `all | online | offline_import` to Sales, Outstanding, Collections, and Profit & Loss reports. Sales and Outstanding reports use invoice date. Collections uses confirmed payment effective date. Pending instruments use payment receipt date. Profit uses stored invoice-item COGS snapshot. Sales performance uses invoice date and commission `earnedAt`, not `createdAt`/`calculatedAt`.

Show banner when active workbook has staged/unposted invoices: `Offline invoices are waiting to be posted. Current reports may be incomplete.` Banner disappears only when eligible staging is posted or resolved.

- [ ] **Step 3: Add guarded integration job**

Use existing PostgreSQL test service. CI command:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bun run db:migrate:test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/titan_offline_test bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/settlement-service.integration.test.ts src/__tests__/integration/invoice-number.integration.test.ts src/__tests__/integration/offline-sales-import.integration.test.ts --maxWorkers=1
```

Integration test queries `information_schema.columns` and asserts no bytea/file/blob/document column exists in offline sales tables.

- [ ] **Step 4: Write operations runbook**

Include issuance, single-writer rule, save-after-each-invoice, outage entry, direct and booked-order printing, slot warning, recovery after file damage, normal replacement, force retirement, upload, classification meanings, order conflicts, stock deficit, pending bank/cheque, key rotation, report regeneration, rollback, and exact factory drill.

- [ ] **Step 5: Run reporting/integration tests**

Run: `bunx vitest run src/lib/offline-sales-reporting.test.ts src/lib/pnl-reporting.test.ts --maxWorkers=1`

With test PostgreSQL, run integration command above.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server-functions/reports src/server-functions/hr/payroll/sales-performance-fn.ts src/routes/_protected/reports src/lib/offline-sales-reporting.test.ts src/__tests__/integration/offline-sales-import.integration.test.ts vitest.integration.config.ts .github/workflows/ci.yml docs/operations/offline-sales-invoicing-runbook.md
git commit -m "test: verify offline sales accounting and reports"
```

---

### Task 10: Full Verification and Factory Acceptance Drill

**Files:**
- Modify only files needed to fix failures introduced by Tasks 1–9.
- Do not modify current React invoice print template files.

**Interfaces:**
- Produces release evidence. Feature flag remains false until every gate passes.

- [ ] **Step 1: Run focused and full automated gates**

```bash
bunx vitest run src/lib/offline-xlsx src/lib/sales/offline src/server-functions/sales/offline-workbooks-fn.test.ts src/server-functions/sales/offline-upload-fn.test.ts src/server-functions/sales/offline-review-fn.test.ts src/server-functions/sales/offline-post-fn.test.ts src/components/sales/offline src/lib/offline-sales-reporting.test.ts --maxWorkers=1
bunx vitest run --maxWorkers=2
bun run typecheck
bun run build
sha256sum src/components/sales/distributor-invoice.tsx src/components/sales/retailer-invoice.tsx
graphify update .
git diff --check
```

Expected: commands exit 0; print hashes match settlement plan. Existing global typecheck debt blocks production claim until separately resolved.

- [ ] **Step 2: Execute disconnected factory drill**

1. Issue fresh workbook to designated operator.
2. Confirm workbook is locally available, opens, calculates, and prints before disconnecting.
3. Disconnect factory internet.
4. Create direct distributor invoice with cash plus bank transfer plus pay later.
5. Create booked-order invoice with cheque.
6. Trigger credit hold/limit warning and stock warning; confirm neither blocks print/dispatch.
7. Confirm distributor print has no signatures and booked-order/general print preserves current signatures/stamps.
8. Save workbook after each invoice; close/reopen Excel and recheck records.
9. Restore internet and upload same workbook twice.
10. Confirm first upload stages records and second produces duplicates.
11. Review/post eligible invoices; resolve order conflict fixture.
12. Verify cash wallet once, transfer/cheque pending, customer Outstanding Amount, stock deficit issue, order delivered once, commission once, and `OFF-...` number unchanged.
13. Confirm bank transfer, clear one cheque, return another cheque, then record replacement cash only after return.
14. Resolve stock deficit through counted adjustment fixture.
15. Compare invoice, stock, customer ledger, wallet, order, commission, sales, outstanding, collections, profit, and audit reports against signed hand calculation.
16. Re-run report exports after posting and compare dates to business events.

- [ ] **Step 3: Confirm no document storage**

Inspect database schema/data, application storage directories, logs, and backups configuration. Only normalized records and SHA-256 hash may remain. Delete any test upload from local browser download folder manually; application never owns that file.

- [ ] **Step 4: Enable only after signed acceptance**

Set `OFFLINE_SALES_IMPORT_ENABLED=true` in staging first. Repeat drill. Production enablement requires factory owner, finance reviewer, inventory reviewer, and technical owner to record pass date in runbook. Any failed gate keeps flag false.

- [ ] **Step 5: Commit final evidence**

```bash
git add docs/operations/offline-sales-invoicing-runbook.md graphify-out
git commit -m "docs: record offline sales acceptance drill"
```
