# Packaging formats simplification

> Use subagent-driven-development for the independent server task and final review. Preserve the existing dirty workspace; no commits or application database changes.

**Goal:** Make saved packaging formats easy to recognize and set up, and safe to use in batch packing.
**Architecture:** Keep the existing recipe endpoints/data model. Replace the oversized editor with explicit product/formula, pack definition, optional extras and review. Use the existing decimal helpers and server validator; do not infer pack weight or carton capacity from batch totals.
**Stack:** React, TanStack Query/Start, existing shadcn components, Big.js, Vitest.

## Specification

- Simple English only. Clear operator-facing summary: pack name, product, net content per pack and packs per carton or loose packs only.
- Product/formula settings are maintained by users with manufacturing.manage. Operators choose saved formats on completed batches. Read-only viewers do not see management actions.
- Keep existing routes, product-management access and server protections. Product sales KPIs and batch-production counts are removed from the default format screen.
- Three visible numbered setup sections followed by a review confirmation. Formula determines batch size and unit internally. Users explicitly enter pack weight and carton capacity. Material selection never overwrites saved values.
- Extra materials and stock alert threshold stay optional. Prevent duplicates and per-carton extras without cartons. Failure retains fields and gives an inline message. Pending submissions cannot be repeated or dismissed through editor controls.
- Reuse getPackagingTarget/getFillPerContainer and calculatePackingLine validation. Reject incompatible units, sub-gram precision not representable in bulk, malformed decimal values and invalid carton configurations before submission. Server remains authoritative.
- Display archive/removal accurately; no force-delete promise. Retain existing history protections. New format changes invalidate batch-packing context.
- No database schema change or live-data mutation for verification. Browser route currently redirects to login; use a real-component preview if no authenticated session is available.

## Tasks

- [x] Server task: review create/update input guards, POST methods and shared validation. Add focused tests for malformed fill, carton pairing, incompatible bulk units and invalid extra materials. Preserve endpoint interfaces and existing stock/history locks.
- [x] Editor task: replace create-recipe-from.tsx with explicit fields, optional extras, exact conversion preview and review/save; preserve both existing create/edit props and mutation hooks.
- [x] List task: simplify recipes-container.tsx and recipe-card.tsx, add meaningful search-empty state, permissions, plain physical pack summaries, accurate archive copy, responsive route padding and batch-context invalidation.
- [x] Verify: behavioral editor/list tests including saved-value preservation, no-carton save, product/formula reset, fractional remainder, failed-save retention and read-only actions; existing formula-options regression; typecheck/build; 360px/desktop preview; independent review; graphify update.

## Execution ledger

Ruling: user explicitly requests production-ready UI improvements as the next part of the approved packaging work. Proceed with the scoped redesign and record results; no additional design approval is required.

Initial findings: 1,112-line editor mixes stock status, batch-size editing, cost charts and packaging setup. Effects overwrite stored fill from packaging material capacity and derive packs-per-carton from total cartons. List cards truncate decimal fill with parseInt and show theoretical batch output as carton counts. List actions are not permission-aware; force-delete dialog contradicts server archival behavior.


### Progress 2026-10-11

Implemented the three-section editor with explicit saved fill and carton capacity, review/confirm, pending-state controls, inline errors and optional extra materials. Removed automatic material-capacity overrides, editable batch size/output targets, warehouse availability charts and cost panels from setup. Shared decimal helpers provide reference whole-pack counts and remaining bulk.

Rebuilt the list/card/detail views around the physical pack definition. Search includes product and size; empty search has a clear-filter action. Management actions require manufacturing.manage. Product management remains a secondary action for inventory managers. Archive/removal copy now matches actual server behavior; force-delete wording is gone. Create, update and remove use POST. Format mutations refresh batch packing context.

Added a focused manufacturing-authorized product/material options read that avoids fetching chemicals and warehouse balances. Detail reads include the linked formula name. Existing stock/history edit restrictions remain in place.

Validation results: **110 tests passed across six files**. These cover shared input/handler guards, saved-value preservation, same-product formula selection, 100kg/300g remainder, loose-only payloads, failed-save retention, pending controls, permissions, archival wording, the 101st formula, and existing batch-packing behavior.

Independent review approved after fixing extra-material precision: preserve numeric(10,6) values including 0.04175; reject tiny positive values that would round to zero. Bulk precision remains three decimals. Source report: `docs/superpowers/reviews/2026-10-10-packaging-formats-review.md`.

Chrome inspected real list/editor components with mocked responses at 360px and 1440px, including expanded extra-material fields. No horizontal overflow or runtime exceptions. The authenticated localhost route redirects to login, so this was not a signed-in application journey. Preview artifacts are under `.tmp/packaging-formats-preview/`; check logs live beside this plan and remain ignored.

Final `bun run typecheck` and `bun run build` passed. Scoped `git diff --check` passed. `graphify update .` completed after rerunning outside the sandbox because worker processes were blocked: 6,245 nodes and 17,937 edges; graph JSON and report refreshed. HTML visualization was skipped by graphify's 5,000-node limit. Logs are `packaging-formats-typecheck.log`, `packaging-formats-build.log` and `packaging-formats-graphify.log` beside this plan.

All scoped implementation and verification tasks are complete. Signed-in application testing remains a limitation of this verification, as described above. No migration, live-data mutation, deployment or commit was performed.

### User-requested data cleanup 2026-10-12

After implementation, the user explicitly requested removal of all current formulas, packaging records, mixing batches, packaging formats and QC reports. Executed a separate scoped data cleanup on `localhost:5433/main`: removed 2 formulas, 2 mixing batches, 2 packaging allocations, 1 packing receipt, 1 packaging format and 1 production QC report, together with dependent ingredients, progress/material-use rows, 8 cartons, 1 finished-stock row and 2 cost-history rows. No sales or orders were present. Existing inventory/system audit history was retained.

Dry run rolled back successfully. The actual transaction verified row counts and whole-table content fingerprints for all 95 unrelated public tables; all remained unchanged, including users, products, suppliers, purchases and material balances. Consumed materials were not restored. Foreign keys stayed enabled; no migrations or schema edits occurred.

Created and validated a PostgreSQL 18 custom-format backup before deletion at `.tmp/production-reset-2026-10-12/2026-10-12T08-12-47.489Z/before-reset.dump`. The same directory contains `before-fingerprints.json` and `COMMITTED.json`. The first execution attempt stopped before deletion because the host pg_dump was version 14; the successful attempt used the matching tool inside Docker.
