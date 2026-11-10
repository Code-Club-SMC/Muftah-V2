# Inventory purchase audit and lab reports implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep factory-floor stock current, preserve supplier purchase/payment audit history, track independent chemical certificates per purchase, and make alerts, pagination, and packaging labels reliable.

**Architecture:** Extend the existing Drizzle tables and TanStack Start server functions rather than adding another persistence or cache system. Purchases become voidable retained records, chemical certificates gain optional purchase ownership for legacy compatibility, and existing forms drive the post-purchase report prompt. Shared stock invalidation and small pure status/label helpers keep the existing screens consistent.

**Tech Stack:** Bun, TypeScript, React, TanStack Start/Query/Table, Drizzle/PostgreSQL, Zod, big.js, existing shadcn components, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-inventory-purchase-audit-and-lab-reports-design.md`, approved by the user in chat.

## Global constraints

- "It does not authorize changes to unrelated work in the working tree."
- "Do not invent laboratory results, certification, or a pass status."
- "A price lot is not a delivery identifier and must not become the report owner."
- "Preserve the existing untouched-stock restriction."
- "Keep original supplier payment rows."
- "Never edit existing SQL migrations, snapshots, or the journal manually."
- "Preserve the pre-existing uncommitted migrations and all unrelated user work."
- "Do not run production database migrations, resets, or data recovery as part of local implementation."
- "Build must continue to work without live database environment variables."
- "After modifying code, run `graphify update .` as required by `AGENTS.md`."
- No new dependencies, generated route-tree edits, broad formatting, or staging with `git add .`.
- Existing uncommitted work includes sales files, `package.json`, migrations 0026 through 0028, snapshots, and the migration journal. Record their baseline before changes. Only the migration generator may append migration artifacts. Stage only this task's hunks when a file already contains user work.
- Read applicable skills before implementing: ponytail, systematic-debugging, TanStack Query/Start best practices; shadcn/frontend-design for UI work. Do not delegate until the user chooses that execution mode.
- The work is connected through purchase ownership, void status, and shared stock queries. Use one dependency-ordered plan, not parallel edits of schema, stock-table, or report files.

## File map and boundaries

| Area | Existing files | Small additions |
| --- | --- | --- |
| Pagination | `src/components/custom/data-table.tsx`, `src/components/inventory/stock-table.tsx` | Stock-table behavior regression test |
| Cache | Existing stock/material/purchase mutation callbacks | `src/lib/inventory/invalidate-stock.ts` and its test |
| Audit write | `src/db/schemas/supplier-schema.ts`, `src/server-functions/suppliers/{delete-purchase-record-fn,update-purchase-record-fn,add-payment-fn,get-purchase-edit-state-fn}.ts` | Retained void metadata and transaction tests |
| Audit reads | `src/lib/suppliers/purchase-rows.server.ts`, supplier totals/history queries, purchases report | Focused accounting/read tests |
| Audit UI | Supplier purchase/payment tables, detail dialogs, delete-purchase dialog | Voided status and reason/refund display |
| Report ownership | `src/db/schemas/inventory-schema.ts`, inventory lab-report functions/hooks | `src/lib/inventory/chemical-report-coverage.server.ts`, pending-purchases server function, shared report contract |
| Report workflow | Chemical/restock forms/dialogs, `LabReportsList`, stock/detail views | `src/components/inventory/lab-reports/purchase-report-prompt.tsx` |
| Alerts | Existing low-stock function/hook/component, material validators | `src/lib/inventory/stock-status.ts`, availability query helper if no reusable reader exists |
| Packaging | Packaging schema/forms, item detail query, stock table | `src/lib/inventory/packaging-kind.ts` and label tests |

## Test commands and baseline

- Unit/UI: `bun run test <exact-test-path>`.
- PostgreSQL integration: `bunx vitest run --config vitest.integration.config.ts <exact-test-path>`. That config requires `TEST_DATABASE_URL` with a database name ending in `_test`, and assigns it to `DATABASE_URL` before imports.
- Never run integration tests against `.env`'s application database. If an isolated test database is unavailable, report integration tests as not run, not passed. Do not create/reset a database without checking authorization.
- Capture `bun run typecheck` before implementation so existing errors can be separated from regressions. Do not repair unrelated sales errors.
- Migration generation requires `DATABASE_URL` to be defined because `drizzle.config.ts` validates it. A non-live local placeholder can satisfy generation; generation must not connect or apply changes. Do not print secrets.

---

### Task 1: Preserve stock-table pagination during refresh

**Files:**
- Modify: `src/components/inventory/stock-table.tsx` at its `DataTable` call.
- Modify: `src/components/custom/data-table.tsx` only for opt-out page clamping and explicit empty fallback.
- Create: `src/__tests__/stock-table-pagination.behavior.test.tsx`.

**Interfaces:**
- Consumes the existing `autoResetPageIndex?: boolean`, `pagination`, and `onPaginationChange` props.
- Produces the same props, with opt-out local pagination clamped only when its filtered page count shrinks. Manual server pagination must not be clamped using the current page's row count.

- [x] **Step 1: Add a failing behavior test.** Render the real DataTable and StockTable, mocking only unrelated dialogs, auth/navigation, and server boundaries. Use 25 material rows and page size 5. This core regression can also run directly against DataTable:

```tsx
const rows = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}` }));
const columns = [{ accessorKey: "name", header: "Material name" }];
const { rerender } = render(
  <DataTable columns={columns} data={rows} pageSize={5}
    searchKey="name" autoResetPageIndex={false} />,
);
for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
expect(screen.getByText("Item 16")).toBeTruthy();
rerender(<DataTable columns={columns} data={rows.map(r => ({ ...r }))}
  pageSize={5} searchKey="name" autoResetPageIndex={false} />);
await waitFor(() => expect(screen.getByText("Item 16")).toBeTruthy());
rerender(<DataTable columns={columns} data={rows.slice(0, 6)}
  pageSize={5} searchKey="name" autoResetPageIndex={false} />);
await waitFor(() => expect(screen.getByText("Item 6")).toBeTruthy());
```

Add separate assertions that StockTable actually opts out, name search returns to page 1, sorting preserves a valid page, and zero matches show an explanation. Existing tests demonstrate the project's Vitest mock and QueryClientProvider setup; use `src/__tests__/finished-stock-display.behavior.test.tsx` as the stock-component reference.

- [x] **Step 2: Run** `bun run test src/__tests__/stock-table-pagination.behavior.test.tsx`. Expect failure on stock refresh/reset or shrink clamping before fixing.
- [x] **Step 3: Opt out and clamp.** Pass `autoResetPageIndex={false}` from StockTable. In DataTable, observe filtered `totalPages` and clamp only local pagination after an opt-out:

```tsx
React.useEffect(() => {
  if (manualPagination || autoResetPageIndex) return;
  const last = Math.max(0, totalPages - 1);
  if (currentPage > last) table.setPageIndex(last);
}, [manualPagination, autoResetPageIndex, currentPage, totalPages, table]);
```

Keep the existing explicit search reset. Replace the currently blank default empty-state rendering with readable No matching records copy, retaining custom loading/empty components and an explicit loading fallback.

- [x] **Step 4: Rerun the test**, including the real StockTable rerender case. Confirm manually paginated supplier tables retain their supplied page.
- [x] **Step 5: Commit only these files** with `fix(inventory): preserve stock pagination on refresh`.

### Task 2: Refresh stock-related caches at all mutation entry points

**Files:**
- Create: `src/lib/inventory/invalidate-stock.ts`, `src/lib/inventory/invalidate-stock.test.ts`.
- Modify: `src/hooks/inventory/{use-add-raw-material,use-add-packaging-material,use-material-actions,use-delete-warehouse,use-toggle-warehouse-status}.ts`.
- Modify: `src/hooks/stock/{use-add-stock,use-adjust-stock,use-transfer-stock,use-recover-failed-production-chemical}.ts`.
- Modify: `src/components/inventory/{add-raw-material-form,add-packaging-material-form}.tsx`.
- Modify: `src/components/suppliers/{edit-purchase-dialog,delete-purchase-dialog}.tsx`.
- Modify: stock-affecting callbacks in `src/hooks/manufacturing/mixing/use-mixing-mutations.ts`, `src/hooks/manufacturing/packaging/{use-packaging-mutations,use-batch-packing}.ts`, and `src/features/manufacturing/cartons/hooks/use-carton-mutations.ts`.
- Check existing recipe-minimum mutation callbacks in `src/hooks/recipes/{create-recipe-hook,use-update-recipe-hook,use-delete-recipe}.ts` for alert invalidation.

**Interfaces:**
- Produce `invalidateStockQueries(queryClient: QueryClient): Promise<void>` with shared prefix keys only. Keep supplier/finance-specific invalidation in its existing callers.
- Prefixes: `inventory`, `factory-floor`, `item-detail`, `materials`, `packaging-materials`, `material-lots`, `purchase-edit-state`, `low-stock-alerts`. Task 6 adds report coverage when that key exists.

- [x] **Step 1: Add a failing QueryClient test**, seeding both parent and child cache entries with infinite stale time:

```ts
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
const keys = [["factory-floor"], ["low-stock-alerts"], ["item-detail", "chemical", "c", 4]];
for (const key of keys) qc.setQueryData(key, { quantity: "10" });
qc.setQueryData(["unrelated-settings"], {});
await invalidateStockQueries(qc);
for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
expect(qc.getQueryState(["unrelated-settings"])?.isInvalidated).toBe(false);
```

Add mutation-hook tests using mocked server functions and `renderHook`: invoke add, edit, void, threshold edit, and transfer; prove that an observed stock/alert query refetches and inactive item details become stale. Do not settle for testing only the helper.

- [x] **Step 2: Run** `bun run test src/lib/inventory/invalidate-stock.test.ts` and observe the missing helper/invalidation failure.
- [x] **Step 3: Implement the helper**, returning `Promise.all(prefixes.map(queryKey => queryClient.invalidateQueries({ queryKey }))).then(() => undefined)`. Await it in stock-affecting success callbacks while keeping domain-specific toasts and invalidations. Preserve business-failure checks such as `result.success === false`; do not announce successful creation or refresh on those paths. Do not invalidate for non-stock metadata-only mutations unless minimums or displayed stock metadata changed.
- [x] **Step 4: Run the helper/hook regressions** and existing `src/__tests__/delete-purchase-refund.behavior.test.tsx`. Inventory requests must not run for an unauthorized viewer as a side effect of enabling new queries. Record any live-sales dispatch callback gap for Task 9; do not overwrite the user's modified sales hooks.
- [x] **Step 5: Commit the explicit files/hunks** with `fix(inventory): invalidate stock and alert caches after mutations`.

### Task 3: Retain purchases and payments during atomic voiding

**Files:**
- Modify: `src/db/schemas/supplier-schema.ts`.
- Modify: `src/server-functions/suppliers/{delete-purchase-record-fn,update-purchase-record-fn,add-payment-fn,get-purchase-edit-state-fn}.ts`.
- Modify: `src/__tests__/integration/{purchase-delete-refund,material-lot-purchase-edits}.test.ts`.
- Generator creates a new SQL migration and snapshot and appends its journal entry. Never choose or rewrite an existing migration number.

**Interfaces:**
- Keep `deletePurchaseRecordFn` as the existing exported transport name to avoid breaking callers; its behavior becomes voiding.
- Input becomes `{ id: string; reason: string; refundWalletId?: string; refundAmount?: string }` with trimmed nonblank reason, max 1000 characters.
- Result remains `{ success: true }`; repeat void requests throw `Purchase is already voided` before financial or stock effects.
- Purchase fields: `voidedAt: Date | null`, `voidedById: string | null`, `voidReason: string | null`, `voidRefundAmount: string | null`, `voidRefundWalletId: string | null`, `voidSnapshot: { materialName: string; unit: string; supplierName: string } | null`.
- Add `voidedBy` and `voidRefundWallet` Drizzle relations with unambiguous relation names. Nullable legacy fields stay null.

- [x] **Step 1: Change the real integration assertions to the approved behavior.** In the existing private `fixture()` helper, make `remove(id, extra)` submit `reason: "Duplicate supplier entry"`. Replace assertions that expect row deletion:

```ts
await f.remove(purchase.id);
const [retained] = await db.select().from(purchaseRecords)
  .where(eq(purchaseRecords.id, purchase.id));
expect(retained).toMatchObject({ cost: "7000.00", voidReason: "Duplicate supplier entry",
  voidRefundAmount: "7000.00", voidRefundWalletId: f.cash.id });
expect(retained.voidedAt).not.toBeNull();
expect(await db.select().from(supplierPayments)
  .where(eq(supplierPayments.purchaseId, purchase.id))).toHaveLength(1);
await expect(f.remove(purchase.id)).rejects.toThrow("already voided");
expect(await f.balanceOf(f.cash.id)).toBe("20000.00");
expect(await f.refunds(f.cash.id)).toHaveLength(1);
```

Import `supplierPayments` in that test. Extend its partial/zero refund cases to assert retained original payment amounts and saved metadata. Add blank-reason validation, actor/snapshot checks, used-stock refusal, rollback on invalid refund, and concurrent void requests with `Promise.allSettled` proving one successful financial reversal.

- [x] **Step 2: Run** `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/purchase-delete-refund.test.ts src/__tests__/integration/material-lot-purchase-edits.test.ts`. Expect the retained-row assertions to fail against the current hard delete. If no isolated database is available, use mocked-handler unit tests as a runnable regression and record the unrun SQL tests.
- [x] **Step 3: Add schema fields and generate a forward migration.** Use `decimal(12,2)` for refund amount and nullable jsonb for the snapshot; use `user`/`wallets` foreign keys. Add checks that refund is nonnegative and at most original `paidAmount`, and void metadata is populated together for new voids. Keep legacy active rows valid. Use `isNull(purchaseRecords.voidedAt)` indexes where useful for active balance queries. Run `bun run db:generate`; inspect, never hand-edit, its output. Apply only to an explicitly isolated test DB for the test cycle.
- [x] **Step 4: Replace deletes with the retained update after the existing locked reversal.** Reuse the existing untouched-stock check and `planPurchaseRefund`; preserve stock source type `purchase_delete` for compatibility but use Void purchase in UI/audit text. Populate actor, reason, refund metadata, and snapshot in that transaction. Original payment and purchase rows must not be deleted.

```ts
if (purchase.voidedAt) throw new Error("Purchase is already voided");
// Existing stock lock, untouched check, refund validation and reversal run here.
await tx.update(purchaseRecords).set({
  voidedAt: new Date(), voidedById: context.session.user.id,
  voidReason: data.reason, voidRefundAmount: plan.refund.toFixed(2),
  voidRefundWalletId: plan.refund.gt(0) ? plan.refundWalletId : null,
  voidSnapshot: { materialName, unit: purchase.materialType === "chemical"
    ? purchase.chemical!.unit : packagingUnit(purchase.packagingMaterial), supplierName },
}).where(eq(purchaseRecords.id, purchase.id));
```

Read supplier name inside the transaction. The existing purchase row plus void snapshot and movement/refund rows are durable evidence; optional activity logging is supplementary. Add a `voidedAt` guard to purchase editing and edit-state response. In payment posting, lock the matching purchase before inserting payment, check supplier ownership and void state, then compute remaining balance under that lock. Report posting will use the same row lock in Task 5.

- [x] **Step 5: Rerun the integration cases** plus `bun run typecheck`. Only tests expecting physical deletion should change expectations; stock-used restrictions must remain unchanged.
- [x] **Step 6: Commit only this schema/task and newly generated migration artifacts** with `feat(suppliers): retain voided purchases and original payments`. Stage only generator-added journal changes, not the user's existing entries.

### Task 4: Keep void history visible without counting it as active stock or debt

**Files:**
- Modify: `src/server-functions/suppliers/{get-suppliers-fn,get-supplier-details-fn,get-supplier-paginated-purchases-fn,get-supplier-paginated-payments-fn,get-supplier-paginated-outstanding-fn}.ts`.
- Modify: `src/lib/suppliers/purchase-rows.server.ts`, `src/server-functions/reports/purchases-report-fn.ts`.
- Modify: `src/components/suppliers/{purchase-history-table,purchase-details-dialog,payment-records-table,payment-details-dialog,delete-purchase-dialog}.tsx`.
- Modify: existing `src/__tests__/delete-purchase-refund.behavior.test.tsx`.
- Create: `src/__tests__/integration/purchase-void-read-model.test.ts`, `src/__tests__/purchase-void-history.behavior.test.tsx`.

**Interfaces:**
- Consume Task 3 void metadata. Extend `PurchaseRecord` and `SupplierPayment.purchase` types with the actual metadata used by UI.
- `withStockLeft` returns zero for voided rows. Every window/sum used for stock attribution considers only active purchases, even when history includes voided rows.
- Supplier active totals continue returning `totalPurchases`, `totalPayments`, and `balance`, excluding voided purchases. Payment-history records remain historical, not a fresh source for active debt totals.

- [x] **Step 1: Add failing read and UI tests.** Use two purchases of the same material and price, then void the later one. Assert the active purchase's stock left is unchanged by the retained void row, the void row has zero stock left, supplier balance and purchases-report totals exclude it, and historical payments still include its original payment. Include legacy/no-lot allocation queries in regression coverage.

```tsx
render(<PaymentRecordsTable data={[paymentForVoidedPurchase]} />);
expect(screen.getByText("Voided")).toBeTruthy();
expect(screen.getByText(/7,000/)).toBeTruthy();
```

Define `paymentForVoidedPurchase` as a full `SupplierPayment`-compatible object in that test with original amount `7000`, a purchase void timestamp/reason, refund `6500`, and a cash-wallet label fixture. Open its details and assert that paid `7000`, refund `6500`, and not refunded `500` are distinct. Test the purchase action menu excludes edit/pay/void/restock when voided.

- [x] **Step 2: Run** the new UI test and isolated integration test. Expect active totals or empty history failures before changing readers. UI and mocked-reader regressions failed before the fix; the isolated integration config refused to start without `TEST_DATABASE_URL`.
- [x] **Step 3: Filter active accounting, not history.** Add `isNull(purchaseRecords.voidedAt)` to supplier detail sums, outstanding conditions, purchases report, and all lot/legacy purchase attribution sums and windows. In `getSuppliersFn`, filter `supplier.purchases` before summing. Purchase history and payment history retain voided records; hydrate actor/refund-wallet labels in their detail payloads. In `groupByMaterial`, keep voided rows accessible but exclude their quantities/costs/payments from active group totals.

```ts
const active = supplier.purchases.filter(p => p.voidedAt === null);
const totalPurchases = active.reduce((sum, p) => sum + Number(p.cost), 0);
const totalPayments = active.reduce((sum, p) => sum + Number(p.paidAmount), 0);
```

Update the dialog with required reason input, Void purchase title/button, accurate retained-history explanation, and disabled submission until edit-state/refund inputs are valid. Reset reason/refund state on closing and when switching purchases. Keep current exported component names if renaming would churn routes.

- [x] **Step 4: Run** `bun run test src/__tests__/purchase-void-history.behavior.test.tsx src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/supplier-purchases-paged-by-material.test.ts`, then the isolated read-model integration suite. Verify existing supplier material-group pagination remains intact. Focused and isolated SQL tests passed; see Task 9 follow-up verification.
- [x] **Step 5: Commit the explicit task files** with `feat(suppliers): show voided purchase and payment audit history`.

### Task 5: Add purchase ownership and batched certificate coverage

**Files:**
- Create: `src/lib/inventory/chemical-report-contract.ts`, `src/lib/inventory/chemical-report-coverage.server.ts`.
- Create: `src/server-functions/inventory/lab-reports/get-chemical-report-purchases-fn.ts`.
- Modify: `src/db/schemas/{inventory-schema,supplier-schema}.ts`.
- Modify: `src/server-functions/inventory/lab-reports/{create-lab-report-fn,get-lab-reports-fn,update-lab-report-fn,delete-lab-report-fn}.ts`.
- Modify: `src/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn.ts`, `src/server-functions/inventory/get-inventory-fn.ts`.
- Modify: `src/hooks/inventory/use-lab-reports.ts`.
- Create: `src/__tests__/integration/chemical-purchase-reports.test.ts`.

**Interfaces:**

```ts
// chemical-report-contract.ts, shared types only; no db imports in client code.
export type ChemicalPurchaseRef = {
  purchaseId: string; chemicalId: string; chemicalName: string;
};
export type ChemicalReportCoverage = {
  purchaseCount: number; missingPurchaseCount: number; reportCount: number;
};
export type ChemicalReportPurchase = ChemicalPurchaseRef & {
  supplierName: string; purchaseDate: Date | string; quantity: string; unit: string;
  reportCount: number; voidedAt: Date | string | null;
};
// chemical-report-coverage.server.ts
export async function chemicalReportCoverage(
  chemicalIds: string[], warehouseId?: string,
): Promise<Record<string, ChemicalReportCoverage>>;
```

The overview's `reportCount` counts all certificates for the chemical, including unassigned legacy certificates. Active purchase coverage counts only active purchases and their own saved certificates. When warehouseId is supplied, purchase counts are scoped to that warehouse; legacy certificate existence remains chemical-level. Return zero counts for requested chemicals with no data.

`getChemicalReportPurchasesFn` accepts `{ chemicalId: string }` and returns `ChemicalReportPurchase[]` newest first with a stable ID tie-break; includes voided rows for history with no creation action. Use inventory-view permission for this detail endpoint. Factory-floor summaries remain available under existing factory-floor-view middleware without calling an inventory-only endpoint.

- [x] **Step 1: Add real ownership/coverage regressions.** Build the fixture in the new test using existing DB inserts and the server-function transport mock from `src/__tests__/integration/material-lot-purchases.test.ts`. Buy the same chemical twice at the same price, create a certificate for the first purchase, and assert:

```ts
expect(first.lotId).toBe(second.lotId);
const coverage = await chemicalReportCoverage([chemical.id], floor.id);
expect(coverage[chemical.id]).toMatchObject({ purchaseCount: 2, missingPurchaseCount: 1 });
expect(await db.query.chemicalLabReports.findMany({
  where: eq(chemicalLabReports.purchaseId, second.id),
})).toHaveLength(0);
```

Test two saved certificates with distinct result values retain those values; legacy report doesn't cover either purchase; deletion of a final report restores pending status; mismatched chemical, missing purchase, voided purchase, and reassignment attempts are rejected.

- [x] **Step 2: Run** `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/chemical-purchase-reports.test.ts`, or report unavailable isolated DB and run mocked-handler regressions.
- [x] **Step 3: Extend schema and generate the next forward migration.** Add nullable `chemicalLabReports.purchaseId` referencing purchaseRecords with restrict/no-action deletion, index it, and add Drizzle relations `purchase` and `labReports`. Use `AnyPgColumn` return annotations on circular foreign-key callbacks if TypeScript inference requires them. Do not add a unique constraint on purchaseId because multiple certificates remain allowed. Existing reports stay null-owned.
- [x] **Step 4: Enforce ownership inside transactions.** Require purchaseId for new reports, lock the purchase before create, check chemical ID/type/void state, then insert. For report update/delete, read the report's ownership, lock its purchase first, re-read the report, reject voided ownership, and operate only on the original report. Legacy reports remain editable/deletable through existing permissions but cannot be reassigned by ordinary update. Keep purchase locks ahead of report writes to avoid deadlocks with voiding.

Coverage uses grouped purchase and report counts or `NOT EXISTS`, not a chemical-to-report join that multiplies purchase rows. Hydrate factory/inventory chemical rows with `reportCoverage` in a batch after fetching their chemical IDs. Report lists optionally accept `{ chemicalId, purchaseId? }`, require matching ownership when scoped, and hydrate purchase/supplier context for display. Preserve existing list shape as an array of report objects with added optional purchase metadata.

```ts
const missing = sql<number>`count(*) filter (where not exists (
  select 1 from ${chemicalLabReports}
  where ${chemicalLabReports.purchaseId} = ${purchaseRecords.id}
))::int`;
```

- [x] **Step 5: Update hooks.** Keep the list prefix `['lab-reports', chemicalId]`; append purchaseId or `all` as a scoped suffix. Add `useChemicalReportPurchases(chemicalId)` with `['chemical-report-purchases', chemicalId]`. Create/update/delete invalidate report lists, report detail, pending-purchase data, `factory-floor`, `inventory`, and item detail. Remove a deleted single-report cache entry. Extend Task 2's helper with `chemical-report-purchases` for purchase changes.
- [x] **Step 6: Run ownership/coverage tests**, existing factory-floor read tests, and typecheck; inspect query counts to confirm no per-row coverage requests. Commit the explicit source and new generated migration artifacts with `feat(inventory): associate chemical certificates with purchases`. Mocked-handler/SQL-shape/UI regressions passed; real PostgreSQL ownership/coverage tests remain unrun.

### Task 6: Offer Create report or Later and expose missing certificates

**Files:**
- Create: `src/components/inventory/lab-reports/purchase-report-prompt.tsx`.
- Modify: `src/server-functions/inventory/{add-chemical-fn,stock/add-stock-fn}.ts`.
- Modify: `src/components/inventory/{add-raw-material-form,add-raw-material-sheet,add-stock-dialog-form,add-stock-dialog,stock-table,inventory-details-dialog}.tsx`.
- Modify: `src/components/inventory/lab-reports/{create-lab-report-form,lab-reports-list}.tsx`.
- Modify: `src/components/suppliers/purchase-history-table.tsx`, supplier routes that mount purchase actions, and `src/routes/_protected/inventory/item/$itemType/$itemId/index.tsx`.
- Create: `src/__tests__/chemical-purchase-report-workflow.behavior.test.tsx`.

**Interfaces:**
- Add `purchase: ChemicalPurchaseRef | null` to the existing flat result returned by `addRawMaterialFn` and `addStockFn`. Preserve existing material/stock fields and IDs for current consumers. New chemical creation captures the purchase reference only for positive-quantity purchase creation.
- Change form completion callbacks to `onSuccess(purchase?: ChemicalPurchaseRef): void`. Existing no-argument callbacks remain valid; initial-stock and restock dialogs consume the reference.
- Produce `PurchaseReportPrompt({ purchase, onClose }: { purchase: ChemicalPurchaseRef | null; onClose(): void })`.
- Extend report-form props with required `purchaseId` for creation, keep saved ownership on edit. Add optional purchaseId to LabReportsList for a purchase-scoped view; chemical overview still works.

- [x] **Step 1: Add failing UI workflow tests.** Mock purchase responses and report mutations, not local prompt state. Cover successful purchase opens the prompt, Later closes it without creating a report, Create report opens a fresh purchase-scoped form, cancelling leaves coverage pending, report failure leaves the purchase intact, and repeated purchases don't copy previous results.

```tsx
render(<PurchaseReportPrompt purchase={{ purchaseId: "p2", chemicalId: "c", chemicalName: "Soda" }}
  onClose={onClose} />);
fireEvent.click(screen.getByRole("button", { name: "Later" }));
expect(onClose).toHaveBeenCalledOnce();
expect(createReport).not.toHaveBeenCalled();
```

Define `onClose` and `createReport` using `vi.fn()` and existing hook mocks in that test. Include tests of the actual dialogs so server return propagation isn't merely assumed.

- [x] **Step 2: Run** `bun run test src/__tests__/chemical-purchase-report-workflow.behavior.test.tsx` and observe missing prompt/pending behavior.
- [x] **Step 3: Propagate purchase identity without changing stock accounting.** Capture inserted purchase ID and chemical name in the two server functions. Store pending prompt state in the existing dialog owners as siblings of the purchase sheet, so closing the purchase sheet doesn't unmount the report prompt. For the similar-name switch to AddStockDialog, ensure only the dialog that completed the purchase owns the prompt. Do not prompt on purchase edits or packaging purchases.

```tsx
const [reportPurchase, setReportPurchase] = useState<ChemicalPurchaseRef | null>(null);
const complete = (purchase?: ChemicalPurchaseRef) => {
  onOpenChange(false);
  if (purchase) setReportPurchase(purchase);
};
// Render PurchaseReportPrompt outside the closing purchase sheet.
```

- [x] **Step 4: Implement pending visibility and permission-aware creation.** StockTable reads batched `chemical.reportCoverage`, displays Report missing with count, No lab reports when appropriate, and a Missing reports filter/summary. Selecting a row's report status opens purchase-specific pending rows with supplier/date/quantity/reference. Show existing certificates grouped/labeled by purchase and Legacy / purchase unassigned. Read-only users see status but no mutation controls. Provide creation from active supplier chemical-purchase actions. Reset form state on purchaseId, edit report, and new-open transitions; use `key={purchaseId}` where an owned form must be fresh. Never display passed results before a certificate is saved.

Filter on `missingPurchaseCount > 0 || reportCount === 0`. Reset pagination on that explicit filter change. Keep the no-purchase No lab reports state distinct from an actual pending delivery. Preserve the name search and show an explicit filtered empty state.

- [x] **Step 5: Run** workflow tests, Task 1 pagination tests, and existing stock/detail behavior tests. Verify voided purchase reports are viewable but read-only and the same chemical/price can have different saved analysis results. Commit with `feat(inventory): prompt for purchase certificates and show missing reports`.

### Task 7: Make threshold validation, alert quantities, and request states reliable

**Files:**
- Create: `src/lib/inventory/stock-status.ts`, `src/lib/inventory/stock-status.test.ts`.
- Create: `src/lib/inventory/finished-stock-availability.server.ts` if no existing read-only availability helper can be reused.
- Modify: `src/lib/validators/validators.ts`, `src/server-functions/inventory/update-material-fn.ts`, `src/server-functions/suppliers/update-purchase-record-fn.ts`.
- Modify: `src/server-functions/inventory/stock/get-low-stocks-alert-fn.ts`, `src/hooks/stock/use-low-stock-alert.ts`, `src/components/inventory/{low-stocks-alert,stock-table}.tsx`.
- Create: `src/__tests__/integration/low-stock-alerts.test.ts`, `src/__tests__/low-stock-alerts.behavior.test.tsx`.

**Interfaces:**
- `stockStatus(quantity: string | number, minimum: string | number | null): 'out' | 'low' | 'healthy'`, using Big for precise comparisons.
- Shared threshold schemas validate strings/numbers without parseFloat/parseInt truncation; chemical decimal max `99999999.99`, at most two decimal places; packaging integer max `2147483647`, including KG packaging because the current threshold column is integer.
- `finishedAvailableUnits(warehouseId: string): Promise<Map<string, number>>` returns recipe-to-pack-count from usable carton currentPacks plus outside packs, or loose aggregates for recipes without cartons. This is a read query, not a new stock writer.
- Existing low-stock endpoint continues returning an array; stable IDs use warehouse/type/material identity, `materialType` remains `raw`, `packaging`, or `finished` for existing consumers. Include `status: 'out' | 'low'`.

- [x] **Step 1: Add failing boundary/validation tests.**

```ts
it.each([
  ["0", null, "out"], ["0", "0", "out"], ["2", "0", "healthy"],
  ["4.99", "5", "low"], ["5", "5", "low"], ["5.01", "5", "healthy"],
])("classifies %s against %s", (quantity, minimum, expected) => {
  expect(stockStatus(quantity, minimum)).toBe(expected);
});
```

Test rejected threshold values `-1`, `NaN`, `Infinity`, `1junk`, values above limits, and fractional counted/threshold-integer packaging. Test valid 0 and chemical decimals. Add SQL fixtures with no stock row, two price lots for one chemical, KG packaging, active/inactive floors, and an active recipe with PARTIAL 3, COMPLETE 12, ON_HOLD 9, and outside 2 packs; available is 17, not a nominal-capacity count. A loose-only recipe uses quantityContainers.

- [x] **Step 2: Run** `bun run test src/lib/inventory/stock-status.test.ts` and the isolated low-stock suite. Confirm existing alert logic fails zero/missing-row or carton availability cases.
- [x] **Step 3: Implement shared status/validation.**

```ts
export function stockStatus(quantity: string | number, minimum: string | number | null) {
  const current = new Big(quantity);
  const min = new Big(minimum ?? 0);
  return current.lte(0) ? "out" : min.gt(0) && current.lte(min) ? "low" : "healthy";
}
```

Use validation in create-material and update-material boundaries and purchase-edit minimum fields. Add the currently missing chemical minimum update in purchase edits when an explicit minStock is supplied; retain the original value when absent. Empty/malformed input must not become zero. Keep packaging-kind/unit behavior independent.

- [x] **Step 4: Query the authoritative available quantities.** Reuse the allowed statuses from `src/lib/cartons/invoice-stock.server.ts`: COMPLETE, SEALED, PARTIAL; exclude ON_HOLD and dispatched/scrapped/archived cartons. Query material catalogs with left joins restricted to the selected active floor so absent stock becomes zero. Query active recipes likewise, with no-stock fallback. Include stable floor ordering in both factory-floor and alert selection if multiple active floors exist, so they choose the same one; preserve the screen's single-floor scope. Return no rows when no active floor exists. Sort out-of-stock first, then name/type/ID.
- [x] **Step 5: Make UI request states explicit and test them.** Loading shows Checking stock; successful empty response shows No stock alerts; failure shows Unable to check stock with Retry. When cached alerts exist during failure, keep them visible with the error indicator. Render current/minimum/unit and severity text. Test retry calls refetch, no alert request is shown as healthy on error, and the stock row status uses the same pure function. Run `bun run test src/__tests__/low-stock-alerts.behavior.test.tsx src/lib/inventory/stock-status.test.ts` and the isolated SQL suite.
- [x] **Step 6: Commit the exact task files** with `fix(inventory): use reliable stock thresholds and availability alerts`.

### Task 8: Store and display packaging kind without guessing from production role

**Files:**
- Create: `src/lib/inventory/packaging-kind.ts`, `src/lib/inventory/packaging-kind.test.ts`.
- Modify: `src/db/schemas/inventory-schema.ts`, `src/lib/validators/validators.ts`.
- Modify: `src/server-functions/inventory/{add-packaging-material-fn,update-material-fn,stock/get-item-detail-paginated-fn}.ts` and `src/server-functions/suppliers/update-purchase-record-fn.ts`.
- Modify: `src/components/inventory/{add-packaging-material-form,edit-material-dialog,stock-table}.tsx` and packaging-purchase initial values in supplier routes.
- Create: `src/__tests__/packaging-kind.behavior.test.tsx`.

**Interfaces:**

```ts
export const PACKAGING_KINDS = ["bottle", "jerry_can", "sachet", "pouch", "shopper",
  "carton", "bucket", "cap", "sticker", "other"] as const;
export type PackagingKind = typeof PACKAGING_KINDS[number];
export function packagingKindLabel(material: {
  packagingKind?: PackagingKind | null; type: string;
}): string;
```

Create/edit inputs accept optional nullable packagingKind. Unspecified means leave unchanged on updates; explicit null clears it. New legacy-compatible rows may leave it null. Database field is nullable text with a generated CHECK limiting nonnull values to the enumerated IDs. Do not change primary/master/sticker/extra values or unit/lot rules.

- [x] **Step 1: Add failing pure-label and actual-table tests.**

```ts
expect(packagingKindLabel({ type: "primary", packagingKind: "bottle" })).toBe("Bottle");
expect(packagingKindLabel({ type: "master", packagingKind: "bucket" })).toBe("Bucket");
expect(packagingKindLabel({ type: "primary", packagingKind: null })).toBe("Primary packaging");
expect(packagingKindLabel({ type: "master" })).toBe("Master packaging");
```

Render StockTable with specific and fallback labels, then save a packaging-kind edit and assert no stock adjustment payload is sent for metadata-only changes. Test create/update reject unknown kinds and retain original measuredInKg/type values.

- [x] **Step 2: Run** `bun run test src/lib/inventory/packaging-kind.test.ts src/__tests__/packaging-kind.behavior.test.tsx` and observe the missing-label failure.
- [x] **Step 3: Add schema and generate a forward migration** with `bun run db:generate`. Legacy rows stay unclassified. Add optional kind fields to create/edit schemas and Drizzle writes. Existing select-all readers automatically include the new field; explicitly map packagingKind in `getItemDetailPaginatedFn` and any typed projections. Populate purchase-edit initial values and preserve them on submit. Do not infer values from item names.
- [x] **Step 4: Add labeled selects and a compact stock-table kind badge/column.** Use the enum/label map in one module, include an Unspecified option mapped to null, and leave role selection and PCS/KG labels unchanged. The fallback role label must remain accurate for existing master buckets. Use text labels, not color alone; give icon-only controls accessible names when touched.
- [x] **Step 5: Rerun label/form tests**, `src/__tests__/shopper-kg-setup.behavior.test.tsx`, Task 1 pagination tests, and typecheck. Commit source/tests and only new generator artifacts with `feat(inventory): display explicit packaging kinds`.

### Task 9: Verify the full flow, audit cache callers, and refresh the graph

**Files:**
- Review all modified files and new migration artifacts.
- Update this plan's checkboxes and final verification notes.
- Touch an additional existing mutation callback only when the inventory/alert caller audit proves it misses a stock change. Preserve any user-modified sales code by editing only the necessary hunk.

**Interfaces:**
- Consumes all prior tasks. No new product behavior or abstraction is introduced here.

- [x] **Step 1: Audit every caller rather than only the named supplier page.** Use `functions.grep` for `deletePurchaseRecordFn`, `updatePurchaseRecordFn`, `addRawMaterialFn`, `addStockFn`, purchaseRecords/supplierPayments readers, and stock-affecting mutation callbacks. Confirm no unconverted hard delete or active accounting sum includes voided rows. Include sales dispatch/return and carton hold/release mutations because finished-stock alerts now measure available physical packs. Do not refactor unrelated sales logic.

Add a runnable mutation regression for any missing invalidation found in this audit, run it failing, then make the smallest callback change:

```ts
await act(async () => { await result.current.mutateAsync(validInput); });
expect(qc.getQueryState(["low-stock-alerts"])?.isInvalidated).toBe(true);
```

Define `validInput` using the existing mutation's actual input contract and fixture in that hook's test; seed the alert cache with staleTime Infinity so the assertion distinguishes invalidation from ordinary staleness.

- [x] **Step 2: Run focused UI and pure suites.**

```bash
bun run test src/__tests__/stock-table-pagination.behavior.test.tsx src/lib/inventory/invalidate-stock.test.ts src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/purchase-void-history.behavior.test.tsx src/__tests__/chemical-purchase-report-workflow.behavior.test.tsx src/lib/inventory/stock-status.test.ts src/__tests__/low-stock-alerts.behavior.test.tsx src/lib/inventory/packaging-kind.test.ts src/__tests__/packaging-kind.behavior.test.tsx
```

- [x] **Step 3: Run isolated PostgreSQL suites** only with a valid test database, after applying the generated forward migrations to that test database using the existing migration tooling. Run:

```bash
bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/purchase-delete-refund.test.ts src/__tests__/integration/material-lot-purchase-edits.test.ts src/__tests__/integration/material-lot-purchases.test.ts src/__tests__/integration/purchase-void-read-model.test.ts src/__tests__/integration/chemical-purchase-reports.test.ts src/__tests__/integration/low-stock-alerts.test.ts
```

Tests must verify database state and monetary/stock movements, not just returned messages. Distinguish skipped tests from passed assertions.

- [x] **Step 4: Run** `bun run typecheck`, `bun run test`, and `bun run build`. Compare failures with the saved baseline. Do not loosen tests, remove authorization, or require a live DB to make the build pass. Ensure no unrelated generated route-tree diff is staged. Inspect generated SQL for additive changes only and review journal changes against the pre-task state; never repair generated files by hand. The broader test run excluded PostgreSQL suites for safety and was not green; see exact counts below.
- [x] **Step 5: Exercise the approved workflow manually** with permitted test data. Purchase chemical A twice at one price, defer one report, save different results on each, confirm coverage clears independently, then void an untouched paid purchase with a reason and a partial refund. Verify purchase/payment history is retained, outstanding and stock totals exclude it, its certificate is read-only, and repeated voiding cannot change money. Navigate to stock page 4, trigger refresh, search, shrink results, and confirm the intended page behavior. Check Bottle/Carton/Bucket/legacy role labels and an alert error/retry state. Use the agent-browser skill before browser automation.
- [x] **Step 6: Review the diff and update the graph.** Run `git diff --check`, review only task-related hunks, then run `graphify update .`. Report a graph-update failure without claiming freshness. Use requesting-code-review before marking the task complete; delegate only if execution mode permits it.
- [x] **Step 7: Record exact outcomes** here: test commands and pass/fail/skip counts, integration availability, typecheck/build results, manual checks, graph-update result, and any unrelated baseline failures. Commit only task-owned final fixes/notes with `test(inventory): verify purchase audit and report workflows`.

## Self-review coverage

- Spec 1: Tasks 5 and 6 cover ownership, independent same-price purchases, Later, pending visibility, legacy records, multiple certificates, and permission checks.
- Spec 2: Tasks 3 and 4 cover transactional voiding, retained rows, refunds, reasons/snapshots, used-stock restrictions, active accounting, history display, and repeated/concurrent requests.
- Spec 3: Tasks 2, 5, and 9 cover cache prefixes, all mutation entry points, inactive cache staleness, report coverage, and polling fallback.
- Spec 4: Tasks 1 and 6 cover background refresh, page clamping, explicit filter resets, and empty results.
- Spec 5: Task 7 covers boundaries, units, missing stock, availability, active scope, deterministic alert order, and request states; Task 9 audits dispatch/hold/return callbacks.
- Spec 6: Task 8 covers explicit kinds, form persistence, truthful legacy fallback, and unchanged unit/production roles.
- Spec 7: Tasks 3, 5, and 8 generate additive forward migrations without rewriting existing artifacts. Task 9 verifies build and staging boundaries.
- Spec 8: Every task has a failing-check/implementation/passing-check cycle; Task 9 supplies full verification and graph refresh.

## Execution status

Tasks 1–9 are complete. The user authorized temporary isolated database creation for Task 9's follow-up. All six requested PostgreSQL suites and the browser workflow passed, including real stock/money and certificate-coverage checks. Final focused tests, typecheck, production build, review and graph refresh passed. The broader unit suite's unrelated failures remain recorded below; this plan does not claim a green whole-repository suite. Earlier blocked-verification notes are historical and superseded by the final follow-up section.

### Verification for Tasks 1–3

- Baseline `bun run typecheck`: passed. Final `bun run typecheck`: passed.
- Task 1 red test: 3 failed, 1 passed before the fix. Green test: 4 passed, including the real StockTable, sorting/search, shrinking/empty results, controlled manual pagination, and custom loading/empty content.
- Task 2 red tests: missing helper suite and 5 mutation failures. Green tests cover active stock/alert refetch, inactive detail staleness, add/edit/void/threshold/transfer entry points, business-failure handling, and disabled inventory observers.
- Task 3 red mocked-handler test: 9 failed, 4 passed before implementation. The final handler suite includes unpaid and packaging cases, retained original amounts, reason validation, repeated void guards, rollback, edit/payment refusal, ownership checks, and purchase-lock ordering.
- Focused verification: `bun run test src/__tests__/purchase-void-handler.test.ts src/__tests__/stock-table-pagination.behavior.test.tsx src/lib/inventory/invalidate-stock.test.ts src/__tests__/stock-cache-mutations.behavior.test.tsx src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/manufacturing-mutations.behavior.test.tsx src/lib/suppliers/purchase-refund.test.ts` passed, 7 files and 53 tests.
- PostgreSQL integration tests were not run. `TEST_DATABASE_URL` is unset and the integration config correctly refused to start. The two updated suites now include real concurrent void/payment cases and database constraint assertions; these still require an authorized isolated test database. Task 3 Step 5 stays unchecked for that reason.
- Generated `0029_unusual_puppet_master.sql` and its snapshot with a non-live connection placeholder. Inspected SQL: purchase audit columns, two foreign keys, one active-supplier index, and refund/metadata checks only. No migration was applied. Existing migrations and snapshots remained unchanged; the generator appended one journal entry.
- The mandatory reason input, retained-history explanation, reset behavior, and submit-state guard were pulled forward from Task 4 only to keep the existing dialog compatible with Task 3's required reason contract. Task 4's history labels, action visibility, active debt/report totals, and stock-attribution readers are not implemented. Do not deploy the retained-void workflow before those reader changes.
- Task 9 follow-up: `src/hooks/sales/use-invoices.ts` dispatch/post/delete callbacks and `src/hooks/sales/use-sales-returns.ts` return approval invalidate inventory but omit factory-floor/low-stock-alerts. Sales files, including pre-existing modified offline sales hooks, were not changed.
- Implementation commits: `ee0d3b4` for Task 1, `f45ff82` for Task 2, and `3dbfb49` for Task 3. Only generated journal entry 29 was committed; pre-existing entries 26–28 and their migration files remain unstaged.
- Reviewed the task diffs inline. `git diff --check` passed. `graphify update .` passed and rebuilt 9,097 nodes and 23,206 edges. HTML visualization was skipped because the graph exceeds its node limit; JSON and the report were updated.
- Production build passed with `env -u DATABASE_URL bun --no-env-file run build`. No live database environment variable or `.env` loading was needed.
- A server restart cancelled the first full-test/build attempts. The default `bun run test --maxWorkers=2` retry was stopped after discovering it also selects PostgreSQL integration suites. A subsequent broader run with a non-live database URL and explicit integration exclusions encountered unrelated failures and was stopped without claiming a complete-suite result.
- Reproduced the unrelated failures with `DATABASE_URL=<non-live-placeholder> bun run test src/lib/validators/hr-validators.test.ts src/lib/production-run-accounting.test.ts src/db/schemas/offline-sales-schema.test.ts`: 10 passed, 4 failed, and one suite could not load. The HR fixtures fail existing validation; the recipe source assertion no longer finds its expected field; the offline schema suite refers to missing `0011_smiling_puma.sql`, while the repository has `0011_heavy_skrulls.sql`. The tested modules/fixtures are unchanged by these tasks. No unrelated fixes were attempted.
- Browser/database workflow checks were not performed without an authorized isolated database. SQL concurrency, refund constraints, and integration outcomes remain unverified until that database is available.

### Verification for Tasks 4–5

- Baseline and final `bun run typecheck`: passed. No unrelated sales code was changed.
- Task 4 red cycle: all 9 new UI/mocked-reader tests failed before the reader/UI changes. Green cycle: 19 tests passed across history, reader, refund-dialog and material-pagination suites.
- Task 5 red cycle: the 10 new handler tests failed against the nontransactional writers and the coverage suite could not resolve the missing helper. Green coverage includes supplied independent certificate values, required ownership, mismatched/missing/packaging/voided purchase refusal, purchase-before-report lock ordering, legacy editing/deletion, and immutable ownership.
- Final focused verification: the following command passed, 13 files and 71 tests. The original combined run timed out under default worker concurrency and a server restart cancelled the first build attempt. The two-worker retry and subsequent build completed successfully.

```bash
bun run test --maxWorkers=2 src/__tests__/purchase-void-history.behavior.test.tsx src/__tests__/purchase-void-read-model.test.ts src/__tests__/chemical-purchase-report-handler.test.ts src/__tests__/chemical-report-coverage.test.ts src/__tests__/chemical-report-cache.behavior.test.tsx src/__tests__/chemical-report-form.behavior.test.tsx src/__tests__/factory-floor-mixed-bulk-read.behavior.test.ts src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/supplier-purchases-paged-by-material.test.ts src/lib/inventory/invalidate-stock.test.ts src/__tests__/stock-cache-mutations.behavior.test.tsx src/__tests__/purchase-void-handler.test.ts src/__tests__/stock-table-pagination.behavior.test.tsx
```

- Added real SQL suites `src/__tests__/integration/purchase-void-read-model.test.ts` and `src/__tests__/integration/chemical-purchase-reports.test.ts`. Attempted `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/purchase-void-read-model.test.ts src/__tests__/integration/chemical-purchase-reports.test.ts`; the config correctly refused to start because `TEST_DATABASE_URL` is unset. No SQL assertions passed or failed, no database was created/reset, and no migration was applied.
- Generated `0030_windy_iron_lad.sql` and its snapshot using a non-live connection placeholder. Inspected SQL: nullable report purchase ID, restrict-delete foreign key and nonunique index only. Before the restart, hash comparison verified all 60 existing generated SQL/snapshot artifacts were unchanged. The generator appended journal entry 30; pre-existing entries and untracked migrations 26–28 are preserved.
- Coverage uses two grouped queries per chemical batch, not one request per stock row. Factory-floor tests verify one floor-scoped helper call for multiple chemicals under the existing factory-floor-view permission. Inventory batches chemical IDs separately for each warehouse. Total certificate count remains chemical-level, including legacy certificates.
- Existing report-form compatibility required an explicit active-purchase selector because new certificate creation now requires ownership. Form tests verify no default pass/ISO certification, no voided purchase option, explicit supplied results, and reset on changing purchase/reopening. Task 6's post-purchase prompt, missing-report badges/filter and purchase-grouped report UI were not implemented.
- Mutation-hook regressions verify overview/purchase-specific cache separation, observed floor refetch, inactive report/purchase/item-detail invalidation, deleted report cache removal, and disabled requests for empty chemical IDs.
- `env -u DATABASE_URL bun --no-env-file run build`: passed. Existing bundle-size and dependency warnings remain non-blocking. A full unrelated-suite rerun and browser/database workflow checks were not performed for this scope.
- Reviewed the task-owned diffs inline using the requesting-code-review checklist; no delegation mode was selected. `git diff --check` passed. `graphify update .` passed: 9,113 nodes and 23,279 edges. HTML visualization was skipped at its node limit; JSON and the graph report were updated.

### Verification for Tasks 6–7

- Baseline `bun run typecheck` passed. A server restart cancelled the first production build and an intermediate typecheck; implementation files were preserved. Verification resumed without rewriting unrelated work.
- Task 6 red cycle: the workflow suite could not resolve the missing purchase-report prompt. Task 7 red cycle: the status helper was missing and all four alert request-state tests failed against the old silent loading/error behavior.
- Purchase handlers preserve their flat material/stock fields and now return the actual saved purchase reference, or null for zero-quantity material creation and packaging. Actual dialog/form tests cover initial purchases, restocks, the similar-name switch, Later, cancellation, report-save failure, and clean result fields for a later purchase. Report creation now requires a supplied purchase ID rather than a chemical-wide selection inside the certificate form.
- Missing-report filtering uses batched coverage and controlled local pagination. Tests cover explicit filter resets, retained name search, zero-result explanations, no-purchase/no-report labels, background refresh, and shared stock-status boundaries. The stock-table dialog owners stay mounted when the empty table becomes populated.
- Report lists show pending supplier/date/quantity/purchase references and group saved certificates by purchase, with a separate legacy/unassigned group. Read-only users see no report mutation controls; voided certificates remain viewable. A scope change clears unsaved form state, and refreshed void ownership closes editing controls. Supplier overview and history routes offer certificate creation only for active chemical purchases with inventory view/manage permissions.
- Threshold regressions cover malformed/empty/nonfinite/negative values, exact chemical decimal limits, packaging integer limits including KG materials, explicit zero, absent purchase-edit minimums, and rejection before stock writes. Shared schemas also protect create-material and update-material boundaries. Chemical purchase edits now save explicitly supplied minimums.
- The alert reader uses floor-scoped catalog left joins and stable warehouse selection shared with the floor screen. A read-only grouped query sums usable carton currentPacks plus outside packs and falls back to loose quantityContainers for recipes without cartons. SQL-shape tests verify the usable statuses, active recipe scope, no price-lot join multiplication, stable alert identities and ordering, and zero-stock fallback.
- Added `src/__tests__/integration/low-stock-alerts.test.ts` with rollback-only fixtures for two price lots, absent stock, KG packaging, multiple active/inactive floors, usable/held/dispatched/archived cartons, and loose-only recipes. `bunx vitest run --config vitest.integration.config.ts src/__tests__/integration/low-stock-alerts.test.ts` correctly refused to start without `TEST_DATABASE_URL`. No SQL assertions ran, no database was created/reset, and no migration was generated or applied. Task 7 Steps 2 and 5 retain unchecked SQL-verification portions.
- Full-suite and browser/database workflow checks are not claimed for this scope. The previously recorded unrelated test failures remain outside these tasks. Sales work, generated route-tree changes, and pre-existing migrations/journal entries were not edited or staged.
- Final focused verification passed, 22 files and 152 tests, with this command:

```bash
bun run test --maxWorkers=2 src/__tests__/chemical-purchase-return.test.ts src/__tests__/chemical-purchase-report-workflow.behavior.test.tsx src/__tests__/chemical-report-form.behavior.test.tsx src/__tests__/chemical-purchase-report-handler.test.ts src/__tests__/chemical-report-coverage.test.ts src/__tests__/chemical-report-cache.behavior.test.tsx src/__tests__/stock-table-pagination.behavior.test.tsx src/__tests__/finished-stock-display.behavior.test.tsx src/__tests__/finished-stock-detail-read.behavior.test.ts src/__tests__/factory-floor-mixed-bulk-read.behavior.test.ts src/__tests__/factory-floor-mixed-bulk-display.behavior.test.tsx src/__tests__/purchase-void-handler.test.ts src/__tests__/purchase-void-history.behavior.test.tsx src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/supplier-purchases-paged-by-material.test.ts src/__tests__/shopper-kg-setup.behavior.test.tsx src/__tests__/shopper-kg-units.test.ts src/__tests__/stock-cache-mutations.behavior.test.tsx src/lib/inventory/invalidate-stock.test.ts src/lib/inventory/stock-status.test.ts src/__tests__/low-stock-alerts.behavior.test.tsx src/__tests__/low-stock-alerts-reader.test.ts
```

- Final `bun run typecheck` and `env -u DATABASE_URL bun --no-env-file run build` passed. Existing chunk-size/dependency warnings remain non-blocking. An earlier default-concurrency workflow run timed out while build/typecheck were competing for resources; the final two-worker run completed without increasing test timeouts.
- Reviewed task-owned diffs inline using requesting-code-review, without delegation. `git diff --check` passed. `graphify update .` passed with 9,127 nodes and 23,401 edges; HTML was skipped at its node limit, and JSON/the graph report were updated.
- Task 6 source/tests were committed as `cb1fd14`. Task 7 source/tests and these verification notes use the planned `fix(inventory): use reliable stock thresholds and availability alerts` commit. Only task-owned files and hunks were staged.

### Verification for Tasks 8–9

- Task 8 is committed as `bbe9cca`, `feat(inventory): display explicit packaging kinds`. Creation, material editing and supplier purchase editing accept optional nullable kinds. Omission preserves the current value; explicit null clears it. The stock table labels specific kinds or the stored legacy role, without name-based classification or changes to PCS/KG, production roles or lot rules. Item details return the kind and display the production role separately.
- Task 8 red cycle: the label suite could not resolve the missing helper and all five actual-table/form tests failed. The initial green command passed 4 files and 23 tests: `bun run test --maxWorkers=2 src/lib/inventory/packaging-kind.test.ts src/__tests__/packaging-kind.behavior.test.tsx src/__tests__/shopper-kg-setup.behavior.test.tsx src/__tests__/stock-table-pagination.behavior.test.tsx`. Added handler and detail-reader tests also verify all write boundaries reject unknown kinds, omission/null semantics, unchanged role/units, metadata-only edits without stock movements, and the database CHECK definition.
- Generated `0031_lovely_bruce_banner.sql` and its snapshot using `DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/titan_placeholder bun --no-env-file run db:generate`. The generated SQL only adds nullable `packaging_kind` and its allowed-value CHECK. No database connection or migration application was performed. Before the restart, SHA-256 comparison confirmed all 62 existing SQL/snapshot artifacts were unchanged and the journal appended only entry 31. Only that new journal hunk was committed; the user's entries and artifacts 26–28 remain unstaged.
- Task 9 caller audit covered every reference to the purchase add/edit/void transports, purchase/payment readers, material/warehouse mutations, manufacturing consumption/receipt, recipe thresholds, physical-carton dispatch/return/hold/release, invoice create/edit/delete, offline posting and loose-pack corrections. Active accounting and lot/legacy stock attribution exclude voided purchases; purchase/payment history intentionally retains them. No application hard delete of purchase/payment rows remains. Supplier/material deletion cannot bypass retained foreign-key/history restrictions.
- Added cache regressions first. Invoice create/edit/delete and return approval initially produced 4 failures. Offline posting and warehouse create/update extended that red cycle to 7 failures. Loose-pack correction separately failed its new alert-cache assertion, and closing a batch failed because it can receive an in-progress allocation. Each missing callback now awaits the existing shared invalidation helper. Carton hold/release, dispatch and return callbacks were already correct and are covered without changes. Return rejection and failed invoice mutations do not refresh stock. Only the three required invalidation lines were staged in the pre-existing modified `src/hooks/sales/use-offline-sales.ts`.
- Final focused verification passed, **30 files and 214 tests**, with no failures or skips:

```bash
bun run test --maxWorkers=2 src/__tests__/stock-cache-sales.behavior.test.tsx src/__tests__/outside-packs-correction.behavior.test.tsx src/__tests__/packaging-kind-handler.test.ts src/lib/inventory/packaging-kind.test.ts src/__tests__/packaging-kind.behavior.test.tsx src/__tests__/shopper-kg-setup.behavior.test.tsx src/__tests__/stock-table-pagination.behavior.test.tsx src/lib/inventory/invalidate-stock.test.ts src/__tests__/stock-cache-mutations.behavior.test.tsx src/__tests__/delete-purchase-refund.behavior.test.tsx src/__tests__/purchase-void-handler.test.ts src/__tests__/purchase-void-history.behavior.test.tsx src/__tests__/purchase-void-read-model.test.ts src/__tests__/chemical-purchase-return.test.ts src/__tests__/chemical-purchase-report-workflow.behavior.test.tsx src/__tests__/chemical-report-form.behavior.test.tsx src/__tests__/chemical-purchase-report-handler.test.ts src/__tests__/chemical-report-coverage.test.ts src/__tests__/chemical-report-cache.behavior.test.tsx src/__tests__/finished-stock-display.behavior.test.tsx src/__tests__/finished-stock-detail-read.behavior.test.ts src/__tests__/factory-floor-mixed-bulk-read.behavior.test.ts src/__tests__/factory-floor-mixed-bulk-display.behavior.test.tsx src/__tests__/supplier-purchases-paged-by-material.test.ts src/__tests__/shopper-kg-units.test.ts src/lib/inventory/stock-status.test.ts src/__tests__/low-stock-alerts.behavior.test.tsx src/__tests__/low-stock-alerts-reader.test.ts src/__tests__/manufacturing-mutations.behavior.test.tsx src/lib/suppliers/purchase-refund.test.ts
```

- Broader unit verification completed with `DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/titan_placeholder bun --no-env-file run test --maxWorkers=2 --exclude '**/integration/**' --exclude '**/*.integration.test.ts'`. Result: **233 passed files, 6 failed files; 1,772 passed tests, 9 failed tests, no skipped tests**. One of the six failed files could not load, so it contributed no test assertions. The database suites were deliberately excluded, not counted as passed or skipped assertions. This is not a green full-suite result.
- The unrelated failures are in untouched tests: `src/lib/production-run-accounting.test.ts`, `src/lib/order-booker-trip-attendance-phase4.test.ts`, `src/lib/validators/hr-validators.test.ts`, `src/components/attendance/scan-terminal.test.ts`, and `src/components/hr/attendance/edit-attendance-form.behavior.test.tsx`. `src/db/schemas/offline-sales-schema.test.ts` could not load because it refers to missing `0011_smiling_puma.sql`. The production/HR/missing-migration failures were already recorded above. No unrelated fixes or test weakening were attempted.
- Attempted the exact six-suite PostgreSQL command from Task 9 Step 3. The integration config refused to start with `TEST_DATABASE_URL must target a database ending in _test`, because the variable is unset. **No SQL assertions ran**, no test database was created/reset, and no migrations were applied. Step 3 remains unchecked.
- Manual browser/database workflow checks were not run without permitted isolated test data. Step 5 remains unchecked. Automated behavior tests cover independent reports, deferral/cancellation, retained void/payment history, pagination, packaging labels, and alert error/retry states; these are not substitutes for the unrun PostgreSQL concurrency/constraint checks.
- Baseline `bun run typecheck` passed. Final `bun run typecheck` passed after fixing the new form's optional-schema typing and test coordinate types. A server restart interrupted a build and an intermediate typecheck; only those interrupted checks were restarted. Earlier temporary logs were lost during the restart, but their completed results are recorded here.
- Final `env -u DATABASE_URL bun --no-env-file run build` passed. The build did not load `.env` or require a live database. Existing chunk-size warnings remain non-blocking. The user's generated offline-desk route-tree diff remains unstaged; no generated routes were manually edited.
- Reviewed task-owned source, tests, SQL and staged hunks inline against the requesting-code-review checklist. No delegation mode was selected. `git diff --check` and `git diff --cached --check` passed. `graphify update .` passed and rebuilt **9,135 nodes and 23,447 edges** across 470 communities. `graph.json` and `GRAPH_REPORT.md` were updated; HTML visualization was skipped at its 5,000-node limit.
- The final Task 9 commit uses `test(inventory): verify purchase audit and report workflows`. It includes only the audited cache callbacks, their runnable regressions and these verification notes, not unrelated sales work or pre-existing migrations. Task 9 Steps 3 and 5 remain open for authorized isolated database and manual verification.

### Task 9 follow-up, completed 2026-11-07

- The user explicitly approved a temporary local PostgreSQL instance, migrations and disposable browser fixtures. Created a separate PostgreSQL 14.20 cluster under `/tmp/opencode/titan-task9/pgdata`, listening only on `127.0.0.1:55439`, with `titan_inventory_task9_test` for SQL suites and `titan_inventory_browser_test` for the app. Applied all **32 existing migrations** to each empty database using `bun --no-env-file run db:migrate:test` with an explicit test-only `DATABASE_URL`. No generated artifact or migration-history row was edited manually. The application database, `.env`, and the user's unrelated work were not changed.
- Initial SQL run: **20 passed, 3 failed**. The chemical-report test fixture omitted the `authContext` supplied by real middleware; added it consistently with the existing purchase fixtures. Next run: **22 passed, 1 failed**, exposing a real coverage-query bug. Drizzle removed column qualification inside the inline aggregate subquery, so a saved certificate could leave its purchase incorrectly marked missing. Replaced that inline fragment with Drizzle's `notExists` over a query-builder subquery, preserving correlation to the outer purchase ID. Replaced the hand-built coverage-query mock with Drizzle's real SQL compiler through `pg-proxy`; its new correlation assertion failed before the fix and passed after it. No ownership validation or test assertion was relaxed.
- Final isolated PostgreSQL verification: **6 files, 23 tests passed; 0 failed and 0 skipped**. This includes retained full/partial/zero refunds, concurrent/repeated void/payment guards, untouched-stock restrictions, lot purchase edits, active read-model totals, independent same-price certificates, immutable/voided report ownership, and physical-pack/absent-stock alerts. Command:

```bash
TEST_DATABASE_URL=postgresql://titan_task9@127.0.0.1:55439/titan_inventory_task9_test bun --no-env-file run test --config vitest.integration.config.ts src/__tests__/integration/purchase-delete-refund.test.ts src/__tests__/integration/material-lot-purchase-edits.test.ts src/__tests__/integration/material-lot-purchases.test.ts src/__tests__/integration/purchase-void-read-model.test.ts src/__tests__/integration/chemical-purchase-reports.test.ts src/__tests__/integration/low-stock-alerts.test.ts
```

- Exercised the actual app at `http://localhost:3109` through a dedicated agent-browser session and a temporary super-admin created through the existing bootstrap endpoint. Created chemical A through the supplier form with **100 kg at PKR 70/kg**, paid **7,000**, and chose Later. Bought it again at the same price through Buy Again/Restock and paid another **7,000**. Saved an explicitly synthetic, test-only certificate for the second purchase, observed **Report missing (1)** for the first, then saved a different synthetic result for the first and observed **2 certificates** with no missing purchase. Fresh forms had blank results and no preselected pass status. These records were confined to the disposable database and labeled as test fixtures, not real laboratory certificates.
- Voided the untouched second purchase through the UI with a reason and a **6,500 partial refund**. The purchase detail showed original paid **7,000**, refund **6,500**, not refunded **500**, actor, reason and wallet. Supplier active purchases/payments became **7,000/7,000**, outstanding remained **0**, and active stock became **100 kg**. Purchase and payment history retained both original rows, with the voided purchase labeled and exposing only View Details. Its saved certificate remained viewable without edit/delete/add actions, while the active purchase retained those controls. A repeated request through the authenticated browser RPC rejected with **Purchase is already voided**.
- Independently inspected the disposable database after the UI workflow: **2 retained purchases, 2 original payments totaling 14,000, 1 refund totaling 6,500, wallet balance 12,500, stock 100 kg, 1 shared price lot**, and two certificates retaining distinct `fixture-result-one`/`fixture-result-two` values. This confirms the repeated request caused no second financial reversal.
- Browser pagination checks passed: page **4 of 4** survived a real factory-floor query refresh; reducing the disposable stock fixtures to six rows clamped to **2 of 2**; a name search reset to **1 of 1**; an absent search displayed **No matching records**. Packaging rows displayed **Bottle, Carton, Bucket, Master packaging** without inferring a carton for the legacy master bucket.
- Browser alert checks passed with controlled network failure of only the alert RPC: **Unable to check stock** and **Retry** appeared while all **14 cached alerts** remained visible. Removed interception and clicked Retry; the query returned to **success** and the error indicator disappeared. Cached failure was never presented as a healthy/no-alert response.
- Re-ran the complete 30-file focused command recorded above after the SQL fix: **214 passed, 0 failed, 0 skipped**. Final `bun run typecheck` passed. `env -u DATABASE_URL bun --no-env-file run build` passed after the fix without a live database or `.env` loading. The previously completed broader run and its **9 unrelated failures plus one suite-load error** remain unchanged and are not relabeled as passing.
- Reviewed the three code/test changes inline using the requesting-code-review checklist, consistent with the selected inline execution mode. `git diff --check` passed. `graphify update .` passed after the changes and reported no code-graph topology changes; graph outputs remained current. No route-tree or pre-existing migration/journal changes are included in this follow-up.
- Closed the dedicated browser session and stopped the temporary Vite server and PostgreSQL instance. Logs and six screenshots remain under `/tmp/opencode/titan-task9/` as local, temporary evidence. No application service or database was stopped or reset. All remaining verification checkboxes are now complete.
