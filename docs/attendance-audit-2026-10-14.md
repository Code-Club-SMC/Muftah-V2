# Attendance implementation audit

Audit date: 2026-10-14. Reviewed the current working tree at HEAD `8c842f6`, including existing uncommitted attendance changes. This is an implementation audit against the repository's attendance specifications, not a review of a branch diff.

Reviewed QR/manual punch recording, PKT date attribution, recomputation, overtime, compensatory leave, bulk marking, activity-driven attendance, offline workbook ingestion, and attendance/payroll boundaries. No application source, generated migrations, or database records were changed.

P1 means a defect that can corrupt attendance or monetary/leave calculations, bypass a financial decision, or block a supported core workflow. P2 means a functional defect with a narrower trigger or an available operational workaround. Findings are separated by review axis. There are 8 standards/integrity findings and 9 specification/behavior findings. 11 are P1; 6 are P2.

## Standards and transaction integrity

### S1. P1: recomputation repeatedly refunds the same compensatory leave

Location: [recompute-server.ts:183](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/recompute-server.ts:183).

In the default `preserve` mode, `updateData` has no `leaveType` or `compensatoryHoursUsed`. The balance adjustment consequently calculates new usage as zero and refunds the previous usage. The upsert retains both persisted leave fields, so every subsequent recomputation refunds the same hours again.

Executed the actual `recomputeAttendanceRow` against an in-memory transaction adapter. Starting with an 8-hour compensatory leave record and balance 0, three identical recomputations produced balances **8, 16, 24**, while `leaveType=compensatory` and `compensatoryHoursUsed=8` remained stored. This breaks idempotence even without concurrency. Adding/correcting punches can reach this path through the HR endpoints.

### S2. P1: concurrent comp-off conversions credit the same overtime twice

Location: [convert-overtime-fn.ts:46](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/convert-overtime-fn.ts:46), especially the unconditional update at line 79 and balance increment at line 88.

Two requests can both read a record whose compensation method is `payout`. Both pass the validation, both update it to `comp_off`, and both increment the employee balance. Database row locking during UPDATE does not repair the earlier eligibility decision because the UPDATE predicate checks IDs only. An 8-hour record can credit 16 hours.

Evidence is a source-traced transaction interleaving, not a PostgreSQL concurrency test. The ordinary approvals UI invokes this endpoint.

### S3. P1: manual punch changes bypass payroll freshness and period protection

Location: [manual-punches-fn.ts:224](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/manual-punches-fn.ts:224), [manual-punches-fn.ts:358](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/manual-punches-fn.ts:358).

Add, delete, and correct endpoints recompute attendance without invalidating stored draft payslips or checking approved/paid payroll periods. The invalidation helper is called by offline confirmation, but not these endpoints.

Sequence: import offline punches, generate payslips to resolve the import invalidation, correct an imported checkout, then approve payroll. The stored salary reflects the old checkout, while approval sees no new invalidation. The same mutation endpoints also accept corrections after approval/payment. Browser query-cache invalidation does not invalidate database payslip snapshots.

### S4. P1: payroll generation resolves changes it never incorporated

Location: [payroll-fn.ts:298](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/payroll/payroll-fn.ts:298), [payroll-fn.ts:328](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/payroll/payroll-fn.ts:328), and [payroll-invalidation.server.ts:92](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/payroll-invalidation.server.ts:92).

Payslips generate individually. A later, separate transaction resolves every outstanding attendance invalidation for the payroll. If an offline import commits after an employee's attendance was read but before this resolution, the new invalidation is cleared even though the generated payslip excludes that import. Approval can accept the stale result. There is no captured generation boundary or shared payroll lock. Evidence is a source-traced interleaving.

### S5. P1: offline confirmation races with payroll approval

Location: [confirmation.server.ts:524](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/confirmation.server.ts:524), [payroll-fn.ts:428](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/payroll/payroll-fn.ts:428), and [payroll-invalidation.server.ts:26](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/payroll-invalidation.server.ts:26).

Import can read payroll status `draft` while approval reads no outstanding invalidation. Approval can commit before import recomputes attendance. Import's invalidation helper then selects only draft payrolls and misses the newly approved payroll. The attendance changes after approval with no freshness marker. Import's employee punch advisory lock does not serialize payroll approval. Evidence is a source-traced interleaving.

### S6. P2: preview refresh permanently skips review and blocked rows

Location: [preview.server.ts:495](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/preview.server.ts:495), reached through [offline-review-fn.ts:230](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/offline-review-fn.ts:230).

Preview classification only accepts rows currently `pending` or `ready`. Once a row is classified `needs_review` or `blocked`, refresh does not classify it again. Resolving the conflicting live attendance or payroll state therefore cannot make that row importable in its existing batch. Exclusion and a new upload are needed. Imported/excluded rows should remain terminal, but review/blocked states are not reliably recoverable here.

### S7. P2: supported workbook sizes exceed the PostgreSQL bind limit

Location: [offline-upload-fn.ts:205](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/offline-upload-fn.ts:205). Workbook capacity is [constants.ts:2](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/constants.ts:2).

The upload stages every parsed row in one INSERT. The workbook supports 20,000 rows. Query generation with the installed Drizzle version measured **15 parameters per valid row**, so 5,000 rows require **75,000 parameters**. The installed PostgreSQL protocol serializer writes the bind counts using 16 bits. This exceeds the 65,535-parameter capacity and fails the entire staging transaction. The measured row shape exceeds that capacity above 4,369 rows. Query generation was reproduced without executing SQL.

### S8. P1: bulk presence writes are outside the shared punch lock

Location: [bulk-mark-attendance-range-fn.ts:133](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts:133), [bulk-mark-attendance-range-fn.ts:295](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts:295).

Existing attendance and punches are read before the write transaction. The subsequent transaction inserts the generated punches without `lockEmployeePunchWrites` or rechecking eligibility. Two bulk requests can both observe an empty day and insert matching IN/OUT pairs. There is no uniqueness constraint for ordinary manual punch timestamps. Recompute can then sum both intervals, e.g. two 08:00–16:00 pairs become 16 duty hours. A concurrent QR/manual write can also invalidate the bulk snapshot. Evidence is a source-traced interleaving.

## Specification and functional behavior

### B1. P1: overnight scans rewrite the previous day, including on rejection

Location: [back-attribute.ts:59](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/back-attribute.ts:59), [scan-attendance-fn.ts:214](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/scan-attendance-fn.ts:214).

The approved QR specification requires the morning OUT to retain the open IN's previous attendance date. The resolver instead returns today's date plus `migratedFromDate`, and the scan handler updates existing ledger records to today. A 22:00 IN on October 1 followed by 06:00 OUT on October 2 moves the shift off October 1. This changes attendance, rest-day treatment, and potentially payroll-cycle attribution.

The move and previous-day recomputation happen before leave/holiday/absence rejection. Those rejections return normally from the transaction, so the earlier mutations commit. Executed the actual scan handler with mocked framework/database boundaries: a holiday rejection moved the IN to October 2 and deleted October 1's present summary, while returning `rejected/on_holiday` and inserting no OUT.

The existing `back-attribute.test.ts` behavior assertion and scan-ledger immutability assertion both fail. Basis: QR design §7.2 and the scan ledger immutability rule.

### B2. P1: overtime read, save, and approval disagree on standard hours

Location: [process-overtime-fn.ts:34](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/process-overtime-fn.ts:34), [upsert-attendance-fn.ts:85](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/upsert-attendance-fn.ts:85), compared with [get-overtime-approvals-fn.ts:53](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/get-overtime-approvals-fn.ts:53).

Recompute and approval reads use configured shift hours, with zero standard hours on rest days. Save and approval writes use `employee.standardDutyHours` instead. An 8-hour rest-day request is shown as valid against zero standard hours but rejected as stale against eight. A configured 6-hour shift with 8 worked hours similarly displays 2 eligible hours that the write can reject.

Executed the actual overtime helper with those read/write inputs: `valid` versus `stale`. This prevents supported overtime from being saved or approved and makes the displayed eligibility unreliable.

### B3. P1: activity-driven salesman and driver rows fail the edit validator

Location: [hr-validators.ts:172](/home/abdul-rehman/Projects/titan-new/src/lib/validators/hr-validators.ts:172), [edit-attendance-form.tsx:1367](/home/abdul-rehman/Projects/titan-new/src/components/hr/attendance/edit-attendance-form.tsx:1367), [edit-attendance-form.tsx:1413](/home/abdul-rehman/Projects/titan-new/src/components/hr/attendance/edit-attendance-form.tsx:1413).

The form retains persisted `entrySource`, but the shared validator excludes `salesman_activity` and `driver_trip`. Submitting an existing automatic row fails before the mutation runs, including a notes-only edit. Executed the actual validator: `manual` passes; both automatic sources fail. This blocks HR correction of those rows. Basis: salesman attendance design §2.4–5.

### B4. P1: comp-off conversion bypasses stale overtime approval checks

Location: [convert-overtime-fn.ts:54](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/convert-overtime-fn.ts:54), [convert-overtime-fn.ts:82](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/convert-overtime-fn.ts:82).

Conversion checks employee ownership, prior conversion, positive requested hours, and the minimum total. It never checks current duty-based overtime eligibility or rejection. It then forces `overtimeStatus=approved` and credits the bank. A stale request that `processOvertimeFn` would reject can therefore become paid compensatory entitlement through this endpoint. Disabling the stale UI button does not enforce the server rule. This is independent of the duplicate-credit race in S2. Basis: overtime request design, server-side stale approval prohibition.

### B5. P2: an ordinary multi-day outage workbook cannot import

Location: [preview.server.ts:296](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/preview.server.ts:296), [preview.server.ts:516](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/preview.server.ts:516), [timeline.ts:610](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/offline/timeline.ts:610).

Preview groups by employee code and sends every date for that employee to a classifier requiring exactly one attendance date. Complete IN/OUT pairs for October 1 and October 2 consequently become `needs_review/multiple_attendance_dates`. The employee/day grouping helper exists but is not used to split the first classification pass. Reproduced with the actual public classifier. Basis: offline design's employee/day import units and multi-day outage workflow.

### B6. P1: bulk Present records only the first configured shift

Location: [bulk-mark-attendance-range-fn.ts:210](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/bulk-mark-attendance-range-fn.ts:210).

The handler creates exactly one IN/OUT pair using `emp.shifts[0]`. For shifts 08:00–12:00 and 13:00–17:00, bulk Present records 4 hours and recompute flags the second shift as missing, late, and early. Payroll's standard duty uses the full configured shift total, so the operation can introduce undertime deductions for a day marked fully present. Executed the actual recompute engine using the handler's generated first-shift pair: `dutyHours=4.00`, `isLate=true`, early departure pending.

### B7. P2: shift violations assign punches by ordinal position

Location: [recompute.ts:173](/home/abdul-rehman/Projects/titan-new/src/lib/attendance/recompute.ts:173).

Each shift takes `inPunches[i]` and `outPunches[i]`; it does not associate intervals with the scheduled window. With one 08:00–16:00 shift and punches 08:00 IN, 12:00 OUT, 13:00 IN, 17:00 OUT, total duty is 8 hours and final checkout is 17:00, yet the engine treats noon as the shift checkout and creates an early-departure decision. Intermediate breaks also shift the ordinal mapping of later configured shifts. Reproduced with the actual engine.

### B8. P2: saving an order-booker override silently restores automatic ownership

Location: [upsert-attendance-fn.ts:173](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/upsert-attendance-fn.ts:173), [order-booker-trip-sync.ts:42](/home/abdul-rehman/Projects/titan-new/src/server-functions/sales/order-booker-trip-sync.ts:42).

Sequence: mark a day manually Present, add a trip, then edit attendance notes and save. Because a trip now exists, save changes `entrySource` to `order_booker_trip`. Deleting the last trip subsequently deletes the attendance row and loses HR's original manual decision. The approved order-booker design explicitly preserves manual ownership until HR selects `Return to Trip-Driven Status`. The current save path bypasses that explicit reset.

### B9. P2: historical attendance hides employees who subsequently left

Location: [get-daily-attendance-fn.ts:22](/home/abdul-rehman/Projects/titan-new/src/server-functions/hr/attendance/get-daily-attendance-fn.ts:22).

The daily query filters current status to `active` or `on_leave`, regardless of the selected historical date. A terminated/resigned employee therefore disappears from dates during their employment. The June 30 policy specification explicitly requires these employees to appear when viewing historical dates where they were employed.

## Verification and limits

- Ran 52 attendance, activity-sync, and payroll-related test files: **291 tests, 276 passed, 15 failed**.
- The 15 failures comprise two relevant behavior/contract failures for overnight attribution and ledger mutation, four other source-pattern/migration assertions, three employee-validator fixtures missing required `isDriver`, three overtime UI tests querying the former single decimal input, and three manual-timeline tests missing a QueryClient provider. The four other source/migration assertions are one migration-name check, one field-worker-filter check, and two recompute-pattern checks. Test failures alone are not counted as additional application defects.
- `bun run typecheck` exits 2 with 47 diagnostics. None are in the attendance, HR validator/schema, or payroll files. The repository is not typecheck-clean, and this audit did not repair unrelated files.
- Executable checks used the real resolver, recompute functions, validator, offline classifier, and Drizzle query builder. The rejected-scan reproduction invoked the actual server handler with mocked framework and database boundaries. The repeat-refund reproduction used an in-memory transaction adapter.
- Concurrency findings establish feasible code-level transaction interleavings. They were not exercised against a running PostgreSQL instance. No claim is made about the production database's current records or incidence of these defects.
- Existing uncommitted application changes were preserved. No migration files were written or modified by this audit.

Local evidence files:

- `/tmp/titan-attendance-audit-vitest.json` and `/tmp/titan-attendance-audit-payroll-vitest.json`
- `/tmp/titan-attendance-audit-typecheck.log`
- `/tmp/titan-attendance-audit-reproduce.ts` and `/tmp/titan-attendance-audit-reproductions.jsonl`
- `/tmp/titan-attendance-audit-scan.ts` and `/tmp/titan-attendance-audit-scan.jsonl`
