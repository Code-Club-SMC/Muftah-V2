# Batch packing record

Approved direction: user approved the batch-centred proposal and requested implementation through spec driven development on 2026-10-09. All operator copy is simple English. No further design approval is needed for ordinary implementation decisions.

## Outcome

An operator opens a completed mixing batch and records all the packaging already performed in one form. One confirmation posts all formats together to factory-floor finished goods. The default journey has no separate packing assignment, start button, or progress logging screen.

## Physical rules

- Only active formats linked to the batch formula and product are valid. Price labels identify a format; saved net fill and carton capacity drive conversions.
- Loose means sealed retail packs outside cartons. Unpacked powder remains bulk.
- Each line records full cartons, packs in one partial carton (optional), and packs outside cartons. Outside packs may exceed carton capacity and must never become physical cartons automatically.
- Total packs = full cartons * capacity + partial packs + outside packs. Partial packs must be less than capacity. A format without carton packaging permits outside packs only.
- Decimal strings and Big arithmetic are authoritative. Bulk is recorded to three decimal places; reject unrepresentable consumption rather than round away powder.
- Kg entry is a helper that proposes whole packs and a physical distribution; any fraction of a pack remains bulk. Counts remain authoritative for finished goods.
- Nominal content comes from configured fill. Optional actual bulk used and a reason record measured fill variance. It is not silently treated as loss. Positive powder loss is recorded separately with a reason. Loss cost is absorbed by the outputs of that receipt, explicitly documented in its audit.
- Produced bulk = posted actual consumption + posted losses + remaining bulk. Existing open allocations reserve stock; legacy completed allocations retain their recorded reservation until reconciled, rather than guessing historical losses.
- Partial recording is allowed. Remaining bulk stays available for a subsequent receipt.

## Posting and audit

One authenticated POST accepts the whole receipt. Server validates assigned operator plus completion permission, or manufacturing manager. Read-only permissions cannot post. The transaction locks batch, required materials and finished stock consistently, validates live availability, snapshots format details, deducts packaging materials, records receipt and completed per-format allocations, creates physical cartons only, credits finished stock, and writes audit/cost history. No raw chemicals are deducted a second time.

A client request ID persists with the draft; retries return the original result. Reusing it with different contents is rejected. All rows roll back together on failure. Store actor, packing time, entry time, quantities, reasons and format snapshots. Changing conversion settings while stock exists must not reinterpret stock. Historical results use snapshots.

Finished stock and its downstream dispatch, transfer, adjustment and return paths must preserve physical carton counts and distinguish outside packs from packs inside partial cartons. Never claim loose output is available if sales or transfer cannot consume it. Existing completed receipts remain immutable; existing audited stock adjustments remain the correction path, with no new destructive edit action.

## Operator interface

Industrial, restrained layout using current shadcn and semantic theme tokens. Clear batch identity, produced/available balance, full-width format rows/cards, large number fields, persistent summary, and a single review/confirm flow. Responsive at 360px and desktop; no horizontal form scrolling. Labels and units are always visible. Keyboard navigation, accessible names, error association, visible focus, and text status alongside color are required. Use simple English only.

Operator enters counts by default. A per-line weight helper derives whole counts with an explicit remaining-weight message. Secondary controls expose partial cartons, measured consumption and loss only when requested. Show errors beside the affected field and a server error summary. Never discard input after a failed submission. Persist drafts by actor and batch, restore after refresh, and clear only on confirmed success. Keep the request identity after uncertain network failure. Confirmation displays line counts and the remaining bulk. Successful posting refreshes batch, factory-floor finished stock, inventory, carton availability and related production queries.

Both completed operator batch pages and manufacturing batch pages mount the same packing module. Operator lists include completed batches so the action is discoverable. Old packing routes are explicitly legacy and remain available only for existing open jobs. No new default workflow creates a legacy job.

## Server / UI contract

`getBatchPackingContextFn({data:{mixingRunId}})` returns:
`{batch:{id,batchId,formulaName,bulkUnit,producedBulk,availableBulk,canRecord}, formats:Array<{id,name,fillAmount,fillUnit,containersPerCarton,usesCartons}>, receipts:Array<{id,recordedAt,totalPacks,bulkConsumed,lossBulk,lines:Array<{name,fullCartons,partialPacks,loosePacks,totalPacks,nominalBulk,actualBulk}>}>, legacyOpenJobs:number}`.

`recordBatchPackingFn({data:{mixingRunId,requestId,packedAt,lines:Array<{recipeId,fullCartons,partialPacks,loosePacks,actualBulk?:string,varianceReason?:string}>,lossBulk:string,lossReason?:string}})` returns `{success:true,receiptId,mixingRunId}`. Context quantities are decimal strings; counts are nonnegative integers. Context enforces read authorization.

`calculatePackingLine(line,format,bulkUnit)` exported from `src/lib/production/batch-packing.ts` returns `{totalPacks,physicalCartons,nominalBulk,actualBulk}` as integer counts and decimal strings. It throws human-readable validation errors; receipt posting recomputes independently from stored format settings. UI weight assistance can use the existing `getFillPerContainer` helper.

## Verification

The illustrative 500kg case uses 250g/40, 500g/20, 400g/25, 1kg/no carton formats and produces 20+10+10 cartons and 100 outside packs, 1,350 packs total. Tests must cover 100kg at 300g, outside packs greater than carton capacity, partial cartons, loss/variance, wrong formula, unauthorized operator, material shortages, duplicate requests, concurrent submissions and atomic rollback. Check downstream units/carton availability, dispatch/reversal and transfers. UI tests cover entry, errors, review, successful clearing, failed retention and simple-English accessible fields.

Run focused tests, isolated PostgreSQL regressions, typecheck and production build; inspect responsive browser rendering when browser tools are available. Never apply migrations to the application database as part of verification. Generated migrations are immutable; only `bun run db:generate` writes new SQL/snapshots/journal. Run `graphify update .` after code changes. Preserve all pre-existing workspace changes.
