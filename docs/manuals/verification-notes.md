# Staff manual verification notes

Review date: 20 October 2026.

These notes are for the manual maintainer and system administrator. Staff should use the two operating manuals and desk checklists.

## Scope and limits

The instructions were checked against the current repository's navigation, form components, validation and server-side operations. The graph report was consulted for the relevant module structure. No graph wiki exists in this checkout.

This documentation task did not log in to the deployed application or perform live attendance imports, payroll changes, purchases, production or sales. The HTML documents were opened in headless Chrome to generate and check the PDFs. That is a document-rendering check, not an application workflow test.

The existing attendance/payroll acceptance report records a separate successful local run on 20 October 2026. It explicitly makes no deployment claim. Its evidence supports the distinction between browser-accessible draft preparation and separately exercised payroll lifecycle functions. See [attendance-to-payroll acceptance verification](../superpowers/reviews/2026-10-19-attendance-payroll-e2e-verification.md).

The manuals therefore state the source version and ask the administrator to check the deployed screens before staff training. No claim is made that every production configuration has been tested.

## Source checks

All source paths below are relative to the repository root.

| Instructions checked | Primary source |
| --- | --- |
| Navigation names and paths | [src/lib/constants.ts](../../src/lib/constants.ts) |
| Device import button, preview, matching, pagination, results and review editor | [device-import-sheet.tsx](../../src/components/hr/attendance/device-import-sheet.tsx), [attendance-container.tsx](../../src/components/hr/attendance/attendance-container.tsx) |
| Exact seven headers, quoted CSV, dates, times, file and row limits | [parser.server.ts](../../src/lib/attendance/device-import/parser.server.ts), [contracts.ts](../../src/lib/attendance/device-import/contracts.ts) |
| Person ID mapping, repeated uploads and locked dates | [service.server.ts](../../src/lib/attendance/device-import/service.server.ts), [timeline.ts](../../src/lib/attendance/device-import/timeline.ts), [payroll.server.ts](../../src/lib/attendance/device-import/payroll.server.ts) |
| Immediate punch saves, correction reasons, night checkout and daily decisions | [manual-punch-timeline.tsx](../../src/components/hr/attendance/manual-punch-timeline.tsx), [edit-attendance-form.tsx](../../src/components/hr/attendance/edit-attendance-form.tsx) |
| Leave/overtime approvals and early-leave meaning | [Approval Center](../../src/routes/_protected/hr/approvals/index.tsx), [overtime-approvals-container.tsx](../../src/components/hr/attendance/overtime-approvals-container.tsx), [edit-attendance-form.tsx](../../src/components/hr/attendance/edit-attendance-form.tsx) |
| 16th-to-15th payroll cycle and 25th payout date | [payroll-cycle.ts](../../src/lib/payroll-cycle.ts) |
| Process, Process Early, Revise, Save Draft Slip and missing-data bypass | [payroll-container.tsx](../../src/components/hr/payroll/payroll-container.tsx), [salary-calculator-form.tsx](../../src/components/hr/payroll/salary-calculator-form.tsx) |
| Saved history and Print / Save PDF | [hr-payroll-employee-container.tsx](../../src/components/hr/employees/hr-payroll-employee-container.tsx), [payslip-view.tsx](../../src/components/hr/payroll/payslip-view.tsx) |
| Draft invalidation, approval completeness, unresolved leave/overtime, wallet debit and finalized-period restrictions | [payroll-invalidation.server.ts](../../src/lib/attendance/offline/payroll-invalidation.server.ts), [payroll-fn.ts](../../src/server-functions/hr/payroll/payroll-fn.ts), [payroll.server.ts](../../src/lib/attendance/device-import/payroll.server.ts) |
| Retired scanner page | [attendance/scan.tsx](../../src/routes/attendance/scan.tsx) |
| Issued offline workbook, outage confirmation and distinct workflow actors | [workbook-panel.tsx](../../src/components/hr/attendance/offline/workbook-panel.tsx), [upload-panel.tsx](../../src/components/hr/attendance/offline/upload-panel.tsx), [workflow-actors.ts](../../src/lib/attendance/offline/workflow-actors.ts) |
| Factory-floor creation versus storage-only Add Warehouse | [factory-floor-container.tsx](../../src/components/inventory/factory-floor-container.tsx), [inventory-container.tsx](../../src/components/inventory/inventory-container.tsx), [add-warehouse-form.tsx](../../src/components/inventory/add-warehouse-form.tsx) |
| Supplier creation, purchases, Buy Again, Restock and purchase-specific payment | [add-supplier-form.tsx](../../src/components/suppliers/add-supplier-form.tsx), [supplier profile](../../src/routes/_protected/suppliers/$supplierId.tsx), [purchase-history-table.tsx](../../src/components/suppliers/purchase-history-table.tsx), [add-stock-dialog-form.tsx](../../src/components/inventory/add-stock-dialog-form.tsx) |
| Chemical and packaging quantity/cost units and paying-account selection | [add-raw-material-form.tsx](../../src/components/inventory/add-raw-material-form.tsx), [add-packaging-material-form.tsx](../../src/components/inventory/add-packaging-material-form.tsx), [payment-method-select.tsx](../../src/components/suppliers/payment-method-select.tsx) |
| Product creation and packaging format setup | [recipes-container.tsx](../../src/components/recipes/recipes-container.tsx), [products-table.tsx](../../src/components/recipes/products-table.tsx), [create-recipe-from.tsx](../../src/components/recipes/create-recipe-from.tsx) |
| Formula quantities and formula-derived batch target | [create-formula-dialog.tsx](../../src/components/formulas/create-formula-dialog.tsx), [create-mixing-run-fn.ts](../../src/server-functions/manufacturing/mixing/create-mixing-run-fn.ts) |
| Batch creation, start permissions and chemical deduction at start | [create-mixing-run-dialog.tsx](../../src/components/mixing/create-mixing-run-dialog.tsx), [start-mixing-run-fn.ts](../../src/server-functions/manufacturing/mixing/start-mixing-run-fn.ts) |
| Additive mixing output, shortfall reason and zero-output failure | [mixing-console.tsx](../../src/components/operator/mixing-console.tsx), [log-mixing-progress-fn.ts](../../src/server-functions/manufacturing/mixing/log-mixing-progress-fn.ts), [fail-mixing-run-fn.ts](../../src/server-functions/manufacturing/mixing/fail-mixing-run-fn.ts) |
| Current workstation, completed-batch packing, physical counts, loss and safe retry | [operator page](../../src/routes/_protected/operator/index.tsx), [batch-packing-form.tsx](../../src/components/packaging/batch-packing-form.tsx), [packing-format-row.tsx](../../src/components/packaging/packing-format-row.tsx) |
| Packaging deduction, bulk accounting, receipt and finished-stock creation | [batch-packing-core.server.ts](../../src/server-functions/manufacturing/packaging/batch-packing-core.server.ts) |
| Quality report fields and independence from carton holds | [production-qc-report-form.tsx](../../src/components/production-qc/production-qc-report-form.tsx), [lab-reports-fn.ts](../../src/server-functions/manufacturing/mixing/lab-reports-fn.ts), [qc-hold-fn.ts](../../src/server-functions/manufacturing/cartons/qc-hold-fn.ts) |
| Customer creation and per-carton price configuration | [Sales People](../../src/routes/_protected/sales/people/index.tsx), [create-distributor-dialog.tsx](../../src/components/sales/create-distributor-dialog.tsx), [sales configurations](../../src/routes/_protected/sales/configurations/index.tsx) |
| First invoice buttons, item quantities, payments, saved invoice and print | [new-invoice page](../../src/routes/_protected/sales/new-invoice/index.tsx), [create-invoice-form.tsx](../../src/components/sales/create-invoice-form.tsx), [settlement-section.tsx](../../src/components/sales/create-invoice-form/settlement-section.tsx), [payment-rows-field.tsx](../../src/components/sales/create-invoice-form/payment-rows-field.tsx) |
| Online stock source, full saleable cartons, held-stock exclusion and stock deduction | [invoice-posting-service.ts](../../src/server-functions/sales/invoice-posting-service.ts) |

## Application limits explicitly preserved

1. The payroll screen and salary calculator expose draft preparation. Searching production callers of the approval/payment hooks found no component exposing those final lifecycle actions. The manuals describe the handover and the separate financial effects without inventing buttons.
2. The online invoice form offers a Source Warehouse and says stock will be deducted there. The posting service resolves online stock to the active factory floor. The manual directs this first-sale workflow to that floor and calls out the mismatch. No storage-sale or multi-floor correctness claim is made.
3. Quality report creation does not automatically change carton hold state. The manual requires the separate factory release decision and applicable hold controls.
4. Existing packing allocations can reserve bulk. Operators are directed to the completed-batch packing form and told not to record the same output through both flows.

## Verification performed for this documentation task

The following eight existing suites passed, with **102 tests** in total:

```bash
bun run test \
  src/lib/attendance/device-import/parser.test.ts \
  src/lib/attendance/device-import/timeline.test.ts \
  src/lib/payroll-approved-policies.test.ts \
  src/lib/production/batch-packing.test.ts \
  src/lib/production/packaging-quantity.test.ts \
  src/__tests__/manufacturing-screens.behavior.test.tsx \
  src/__tests__/invoice-stock-availability.behavior.test.tsx \
  src/components/sales/create-invoice-form/payment-rows-field.test.tsx
```

The invocation also included a `src/lib/payroll-cycle.test.ts` filter. That file does not exist and contributed no suite. Payroll-cycle examples were checked separately against the existing cycle utility.

Additional document checks cover the CSV example's exact headers and seven fields, quoted punch cell, weekday and punch count; the purchase, packing and invoice arithmetic; local document links; and the generated HTML/PDF content. The packing example is 10 × 20 + 8 + 5 = 213 packs, 11 physical cartons and 5 outside packs. At 500 g per pack, the product quantity is 106.5 kg.

The October and November cycle examples passed direct assertions against `getCycleForPayoutMonth`. All Markdown links resolve locally. HTML checks found no broken contents anchors or empty table cells. Text extraction from all three PDFs retained every text token from the rendered HTML. The attendance manual has 11 A4 pages, manufacturing has 14, and the desk reference has exactly three pages, one per audience. The HR checklist, packing instructions and stores/sales checklist were also visually inspected for readability and clipping. The PDFs contain no JavaScript and include tagged text.

No new application tests were added. No application code, database contents or migrations were changed. The `.gitignore` exception keeps the staff manuals and printable copies visible to version control.

## Updating the manuals

Edit the Markdown source first, then refresh its HTML and PDF copy. Keep the printable checklists in agreement with the full instructions. Recheck labels and financial/stock effects when the application changes, especially if final payroll controls or warehouse source selection are added or fixed.
