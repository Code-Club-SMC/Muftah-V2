# Production improvements implementation plan

**Goal:** Validate stock before creating mixing batches, implement production QC CRUD, add date filtering and server pagination with KPIs, and repair batch action layout.

**Architecture:** Reuse productionRunLabReports and existing server middleware and table components. Share stock validation between creation and start. Compute filtered KPIs in SQL independently of the page slice. Preserve existing operator assignment checks.

**Tech stack:** TanStack Start, React Query, Drizzle/PostgreSQL, shadcn.

**Requirements:** The user's four production concerns in this session. No new dependencies or schema migrations are necessary. Preserve other working-tree changes. Do not edit generated migrations or routeTree.gen.ts. Date filters use Pakistan calendar days and explicitly label their date basis. Stock creation checks do not reserve or consume stock; start still checks atomically.

## Task 1: Stock validation and action layout

- [x] Add shared server chemical requirements/availability validation, aggregate duplicate ingredients, validate formula quantities, and return all shortages with names and units.
- [x] Check availability when formula/floor selection changes and authoritatively inside the creation transaction. Keep the dialog open on shortages; show required, available, and missing quantities. Update the mutation hook for rejected creation results.
- [x] Reuse requirements and shortage reporting at start with stock locks and guarded deductions.
- [x] Group mixing header actions and wrap responsively. Check stock behaviors and existing manufacturing UI tests.

## Task 2: Production QC

- [x] Add independent QC report read/manage permissions, route rules, seed definitions and Production navigation. Operators explicitly granted these permissions can access QC without manufacturing management rights.
- [x] Add selected batch lookup, report create/read/update/delete server functions using existing reports table. Validate inputs and report/batch identity on the server; mutation method is POST. Preserve assigned operator legacy read access on the batch tab.
- [x] Implement /manufacturing/qc batch search and selection, multiple editable analysis items, certification/date/reference/lot/notes, detailed certificate view, edit and confirmed delete. Reuse UI with MixingLabReports tab.
- [x] Add behavior tests for CRUD, permissions and multi-check form. Verify typecheck for owned files.

## Task 3: Date filters, pagination and KPIs

- [x] Extend mixing/formula reads with validated date/status filters, pagination bounds and aggregate KPIs using the same filter/access conditions as rows.
- [x] Implement a paginated jobs read without truncating existing detail and operator callers. Search batch/job/format and filter creation date and status server-side.
- [x] Add shared date/status filter and KPI display UI and wire the three containers. Use server pagination for jobs, reset page on filter changes, keep filters available when no results.
- [x] Add behavior tests for date boundaries, query access scoping, second-page offsets and KPIs beyond the current page.

## Completion

- [x] Review each deliverable for requirements and quality, resolve material findings.
- [x] Run focused tests, typecheck and production build. Refresh graph with graphify update .
- [x] Report outcomes and remaining limitations.

Validation so far: 110 focused behavior/permission tests passed with maxWorkers=2; 22 PostgreSQL stock/production regressions passed on isolated titan_production_checks_test; full typecheck passed. Independent stock, QC, list and integration reviews found no critical or important issues. Final production build passed; graphify refreshed 6,151 nodes and 17,558 edges successfully. No application database changes or generated migration changes.
