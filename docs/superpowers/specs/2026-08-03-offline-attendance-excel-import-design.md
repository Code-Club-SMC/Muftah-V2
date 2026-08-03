# Offline Attendance Excel Import Design

**Date:** 2026-08-03

**Status:** Approved design; implementation not started

**Scope:** Attendance only, one factory location

## 1. Purpose

Factory attendance recording must continue when the factory loses internet access. The client will not install a local server and will not buy backup internet.

During an outage, each attendance operator will record punches in an assigned Microsoft Excel workbook. After connectivity returns, the workbook will be uploaded to Titan ERP. The system will validate every row, require human review, import safe punches, and use the existing attendance engine to rebuild daily attendance.

The workbook is transport only. Titan ERP will never retain the uploaded Excel document as a file or blob.

## 2. Important limitation

This solution keeps attendance **recording** available during an outage. Titan ERP itself remains unavailable or stale until internet service returns and the workbook is imported.

Excel also cannot prove when an operator typed a value. The system can prove which assigned workbook supplied a row, who uploaded it, who approved the outage window, and who confirmed the import. Supervisor and HR approval provide accountability for the remaining human-trust gap.

## 3. Existing system behavior to preserve

Titan ERP currently:

- stores individual events in `attendance_punches`;
- derives one daily row in `attendance` per employee and attendance date;
- enforces alternating `IN` and `OUT` timelines;
- serializes punch changes per employee with a PostgreSQL advisory transaction lock;
- rejects rapid duplicate terminal scans;
- handles overnight checkout attribution;
- calculates check-in, checkout, duty hours, lateness, early departure, night shift, and overtime from punches;
- rejects terminal scans that conflict with leave, holiday, or absence records; and
- locks payroll editing after payroll becomes `approved` or `paid`.

Offline import must enter the system through the punch ledger. It must not write Excel totals directly into daily attendance or payroll.

## 4. Approved business decisions

- Attendance is the first and only offline module in this design.
- Operators manually enter employee code, date, time, and `IN`/`OUT`.
- Workbooks are normal `.xlsx` files. Macros are not allowed.
- Each operator receives a separate, permanent workbook.
- An operator keeps adding rows to the same workbook. Old rows stay in it.
- A supervisor confirms the outage start and end time.
- An authorized HR/admin user reviews the preview and confirms import.
- The operator, supervisor, and final HR reviewer are separate roles. The operator cannot approve their own workbook.
- Safe employee/day groups may import even if unrelated groups contain errors.
- Uploaded Excel bytes are discarded after parsing.
- Imported data and audit evidence remain in PostgreSQL for the same retention period as attendance records.

## 5. Out of scope

- Offline leave, absence, holiday, overtime approval, payroll, employee maintenance, or shift configuration
- Local factory server or local database
- Backup internet
- Browser/PWA offline entry
- Automatic proof of the time a value was typed into Excel
- Importing arbitrary spreadsheets with user-defined columns
- Saving Excel documents in application storage, object storage, backups, or PostgreSQL

## 6. Workbook lifecycle

### 6.1 Issuing a workbook

An authorized HR/admin user issues one workbook to one attendance operator. The operator stores it on the attendance computer before any outage occurs. This is routine preparation; operators do not need to predict an outage.

The workbook has 20,000 prepared data rows. Each prepared row has a server-issued opaque record token. The application warns when fewer than 1,000 unused rows remain so HR can issue a replacement while online.

The workbook registry records whether a workbook is `active`, `retired`, or `replaced`. A replaced or retired workbook remains recognizable for audit, but new rows from it cannot import. HR must import or exclude all pending rows before retiring a workbook.

### 6.2 Reusing the workbook

The operator always writes into the next empty row. Imported rows are not deleted or reused. Re-uploading the workbook is normal: previously imported records appear as duplicates and are ignored safely.

The operator must not insert, delete, reorder, or sort prepared rows. Workbook protection disables those actions, and the server rejects row tokens found outside their issued positions.

If the file is copied, both copies contain the same workbook and row identities. Identical imported rows remain harmless duplicates. Different content using an already imported identity is blocked. If an unimported invalid row is corrected, the new attempt may proceed while the earlier attempt remains in audit history. Two pending batches with different content for the same identity both require review until HR excludes one.

### 6.3 Workbook replacement

A workbook is replaced when it is nearly full, damaged, lost, assigned to a different operator, or uses an unsupported template. Replacement creates a new workbook identity and new row tokens. The old workbook is retired, not erased from the registry.

Template versions are retired only after all assigned workbooks using that version have been replaced and acknowledged.

## 7. Workbook contract

### 7.1 Operator columns

| Column | Required | Rule |
|---|---:|---|
| Employee Code | Yes | Exact code printed on employee card |
| Date | Yes | Displayed as `YYYY-MM-DD` |
| Time | Yes | 24-hour time displayed as `HH:mm` |
| Direction | Yes | Dropdown containing only `IN` and `OUT` |
| Note | No | Plain text, maximum 500 characters |

The date and time are the actual local event time in `Asia/Karachi`, not the later upload time and not a calculated attendance date.

### 7.2 Protected workbook fields

- Workbook ID
- Assigned operator/user ID
- Template version
- Workbook signature/version
- Source row number
- Opaque record token for each prepared row

Excel sheet protection is only an accident-prevention feature. It is not treated as security. The server validates workbook metadata and every row token independently.

### 7.3 Forbidden workbook content

- Formulas in any attendance input cell
- Macros or `.xlsm` files
- Encrypted or password-protected workbooks
- External links or external data connections
- Added, renamed, or missing required sheets/columns
- More than 20,000 attendance rows
- File size above 10 MB

The workbook contains instructions but no employee master list. Employee codes and employment status are checked against current server data during upload, so the workbook does not become stale when employees change.

## 8. User workflow

### During outage

1. Operator opens their permanent workbook.
2. For each attendance event, operator enters employee code, actual date, actual time, and `IN` or `OUT`.
3. Operator may add a short note when needed.
4. Operator saves the workbook locally.

### After internet returns

1. Operator or permitted intake user uploads the workbook.
2. Uploader states the outage start, outage end, and reason.
3. Supervisor reviews and confirms the outage window.
4. Titan ERP creates an import preview from current database state.
5. HR/admin reviews employee names, online punches, offline punches, warnings, and rejected rows.
6. HR/admin confirms ready groups.
7. Titan ERP revalidates against the live database and imports groups that are still safe.
8. Result page shows imported, duplicate, pending-review, invalid, and blocked rows.

One import batch represents one outage window. The permanent workbook may contain rows from earlier outages; exact previously imported rows are classified as duplicates before outage-window checks. New rows outside the selected window remain unimported and may be submitted later with their correct outage window.

## 9. Import states

### Batch states

`uploaded` → `awaiting_supervisor` → `preview_ready` → `importing` → `completed` or `completed_with_issues`

Supervisor rejection produces `cancelled`. A structurally unsafe upload produces `rejected`. A recoverable server interruption remains `importing`, records the last error, and resumes only unprocessed groups.

### Row states

- **Ready:** row and combined punch timeline are safe to import.
- **Duplicate:** same event was already imported; no database change.
- **Needs Review:** values are readable, but importing could change conflicting attendance.
- **Invalid:** values or identity are not usable.
- **Blocked:** policy forbids import, such as an approved/paid payroll period.
- **Imported:** punch was committed successfully.
- **Excluded:** HR intentionally left the row out with a reason.

## 10. Validation order

Validation follows this order so results stay predictable.

### 10.1 File validation

1. Confirm `.xlsx` format, size, row count, and safe ZIP expansion limits.
2. Reject encrypted files, macros, external links, and unsupported workbook structures.
3. Verify workbook ID, signature, template version, active assignment, and assigned operator.
4. Calculate a SHA-256 file hash for audit without storing file bytes.

Failure here rejects the whole upload and creates no punch changes.

### 10.2 Record identity validation

For each non-empty prepared row:

- Verify the opaque row token belongs to that workbook and row.
- Calculate a content hash from normalized employee code, date, time, direction, and note.
- Classify an already imported matching identity and content as `Duplicate`.
- Classify an already imported identity with different content as `Needs Review` and never overwrite it.
- Classify competing unimported content for the same identity as `Needs Review` until HR excludes one attempt.
- Preserve every upload attempt as audit data, including invalid attempts.

Unimported rows may be corrected in Excel and uploaded again. Earlier attempts remain visible to HR.

### 10.3 Value and policy validation

A new row must:

- contain a real employee code that maps to exactly one active employee;
- contain a valid literal date and 24-hour time;
- contain exactly `IN` or `OUT`;
- create a timestamp inside the supervisor-confirmed outage window;
- not be in the future at confirmation time;
- not fall within an `approved` or `paid` payroll period; and
- not contain a formula or unsupported value type.

Rows conflicting with existing leave, holiday, or absence are `Needs Review`. Rest-day punches follow current terminal behavior: they may be ready but show a clear warning and receive the existing rest-day note.

### 10.4 Timeline validation

The importer resolves business attendance dates and sorts all affected events by actual timestamp. It combines:

- existing online terminal punches;
- existing manual punches;
- previously imported offline punches; and
- new rows from the current batch.

The combined employee timeline must alternate `IN`, `OUT`, `IN`, `OUT`. An exact or near duplicate within the existing 30-second duplicate window does not import automatically. Conflicting sequences such as `IN → IN` or `OUT → OUT` become `Needs Review`.

For an `OUT` after midnight, the existing overnight rule assigns it to the previous attendance date only when a valid previous-day `IN` exists and the checkout is before the configured noon cutoff. Otherwise the group requires review.

Rows are grouped after date resolution by employee and attendance date. A group is all-or-nothing: either its complete timeline imports or none of that group does.

## 11. Preview and review

The preview shows, for each affected employee/day:

- employee code and server-resolved employee name;
- confirmed outage window;
- existing punches and their sources;
- proposed offline punches;
- resulting chronological timeline;
- row classification and plain-English reason;
- predicted attendance summary for ready groups; and
- any payroll, leave, holiday, absence, rest-day, duplicate, or night-shift warning.

Excel-provided employee names, attendance totals, formulas, and calculated hours are never used.

`Needs Review` rows cannot be forced through the normal bulk confirmation. HR must exclude them or resolve the conflict through the existing manual punch/correction workflow with a reason. Invalid rows are corrected in the workbook and uploaded again.

## 12. Confirmation and database writes

Preview is advisory. Confirmation always repeats identity, employee, payroll, timeline, and duplicate checks because online scans may have arrived after preview.

For each employee:

1. Start a PostgreSQL transaction.
2. Take the existing employee punch advisory lock.
3. Reload relevant live punches and attendance state.
4. Re-resolve attendance dates and validate the complete candidate timeline.
5. Claim each workbook/record identity using a database uniqueness constraint.
6. Insert all safe punches for one employee/attendance-date group.
7. Reuse `recomputeAttendanceRow` to rebuild the daily attendance row.
8. Commit imported rows, audit links, and group outcome together.

The imported punch source is `offline_excel`. The punch retains links to its import row and assigned workbook operator. Batch audit stores uploader, supervisor, and final reviewer separately.

Independent employee/day groups use separate transactions. One bad group cannot roll back unrelated safe groups. Database uniqueness and the existing per-employee lock prevent duplicates and timeline races during simultaneous uploads.

If a draft payroll covers changed attendance, the draft is marked as needing regeneration and cannot be approved until affected payslips are regenerated. Approved and paid payroll periods reject offline import completely.

## 13. Conceptual data model

The implementation may adapt these SQL names to existing Drizzle naming conventions. The table boundaries and responsibilities are required.

### `attendance_offline_workbooks`

- workbook identity and signature version
- assigned operator/user
- template version and row capacity
- active, retired, or replaced status
- issued, replaced, and retired audit fields

### `attendance_outage_windows`

- start and end timestamps in `Asia/Karachi`
- reason
- declared-by user
- supervisor confirmer and confirmation time
- terminal heartbeat evidence when available

### `attendance_import_batches`

- workbook and outage-window links
- uploader and upload time
- original filename and SHA-256 hash, but no file bytes
- state, counts, reviewer, confirmation time, and failure summary

### `attendance_import_rows`

- batch, worksheet row number, and opaque record identity
- immutable raw entered values
- normalized employee, timestamp, direction, and content hash
- validation state and reason
- resulting punch link when imported

Each upload attempt creates its own immutable row audit. Final punch identity is protected by a unique database constraint on workbook ID plus record token.

### `attendance_punches` additions

- support `offline_excel` source
- required import-row link for every `offline_excel` punch
- database uniqueness for final offline record identity

### `payroll_attendance_invalidations`

- draft payroll and import-batch links
- affected employee/date summary
- creation time
- resolution time and actor after payslip regeneration

Payroll approval is blocked while any related invalidation remains unresolved.

### Correction audit

Changing or deleting an imported punch requires the existing HR manual correction permission plus a reason. The system records original values, replacement/deletion values, actor, time, and original import-row link. Editing the Excel row after import can never update the punch.

## 14. Permissions and separation of duties

Separate RBAC permissions cover:

- issuing, replacing, and retiring workbooks;
- uploading a workbook;
- confirming an outage window;
- reviewing and confirming an import; and
- viewing import and correction audit history.

The workbook operator, outage supervisor, and final HR reviewer must be three distinct user accounts. Server functions enforce this rule; UI hiding is not enough.

## 15. Terminal heartbeat evidence

While the online attendance terminal is open, it sends a small heartbeat every 60 seconds. Import review displays the last heartbeat before the outage and the first heartbeat after recovery when those records exist.

Heartbeat gaps are supporting evidence only. A missing heartbeat can also mean browser closure, computer shutdown, or power loss. Supervisor confirmation remains required even when heartbeat evidence exists. Missing heartbeat evidence does not prevent a legitimate import when the supervisor supplies a reason.

## 16. File handling and retention

The upload handler parses workbook bytes in memory with strict size and expansion limits. Writing uploaded workbook bytes to application storage, object storage, PostgreSQL, or temporary disk is forbidden.

After parsing, retained information is limited to:

- normalized and raw row values;
- workbook, row, batch, and actor identities;
- original filename, byte size, and SHA-256 hash;
- validation and import outcomes; and
- correction/audit records.

Backups therefore contain attendance and audit rows, not Excel documents.

## 17. Failure and recovery behavior

- **Upload interrupted before parsing completes:** create no batch and no attendance change. User uploads again.
- **Unsafe file structure:** create a `rejected` batch containing file hash, size, uploader, time, and error only; create no punch changes and retain no workbook bytes.
- **Parsed row validation failure:** retain immutable row audit and reasons; create no punch for failed rows.
- **Internet lost during preview:** batch stays available after reconnect.
- **Internet lost during confirmation:** client asks server for batch state. It never assumes failure and never starts a new blind import.
- **Server stops during confirmation:** already committed employee/day groups remain imported; unprocessed groups resume using the same batch.
- **Same workbook uploaded repeatedly:** exact imported identities remain duplicates.
- **Two confirmations run together:** unique record claims and employee locks permit each row once.
- **Database changes after preview:** confirmation revalidation may move a row from `Ready` to `Needs Review`; it is not imported.
- **Partial batch:** result clearly separates committed groups from unresolved groups. No row has an unknown outcome.

## 18. Required product surfaces

- Workbook issue/replacement screen for HR/admin
- Offline workbook download action
- Workbook upload screen
- Outage-window declaration and supervisor confirmation screen
- HR preview grouped by employee/day
- Confirmation progress and recoverable batch-status screen
- Import history with row-level reasons and actor audit
- Link from imported punches to their batch and workbook record
- Low-capacity and retired-template warnings

## 19. Testing strategy

### Unit tests

- workbook signature and row-token verification
- date/time normalization in `Asia/Karachi`
- formula and unsafe-file rejection
- content hashing and identity classification
- outage-window and payroll-period rules
- online/offline timeline merge
- duplicate-window behavior
- overnight checkout attribution
- group classification and state transitions

### Property-based tests

- repeating any upload produces at most one punch per workbook record
- sorting input rows never changes the final valid timeline
- every accepted timeline alternates `IN` and `OUT`
- no imported timestamp falls outside confirmed outage windows

### PostgreSQL integration tests

Current source-inspection and pure unit tests cannot prove concurrency behavior. This feature requires targeted tests against PostgreSQL for:

- simultaneous confirmation of the same batch;
- simultaneous uploads containing the same workbook record;
- collision between online scan and offline confirmation;
- employee advisory-lock behavior;
- transaction rollback within one employee/day group;
- resume after partial completion; and
- unique-constraint enforcement.

### End-to-end tests

- issue workbook, enter rows, upload, confirm outage, preview, approve, and verify attendance;
- re-upload the same workbook;
- correct an unimported invalid row and re-upload;
- attempt to change an already imported row;
- import an overnight shift;
- handle mixed ready, duplicate, review, invalid, and blocked rows;
- lose connection during upload and confirmation; and
- verify no Excel blob or file remains after processing.

## 20. Acceptance criteria

The feature is ready only when all conditions hold:

1. Operators can record attendance in their assigned workbook without internet.
2. Arbitrary or altered workbook structure cannot import.
3. Upload never stores the Excel document permanently.
4. Each row has a clear, recoverable outcome.
5. Repeated and simultaneous uploads cannot create duplicate punches.
6. Online and offline punches are combined before validation.
7. Conflicting timelines never import silently.
8. Approved and paid payroll periods remain unchanged.
9. Draft payroll cannot be approved after an import until affected payslips are regenerated.
10. Attendance totals come only from existing server calculations.
11. Operator, outage supervisor, and HR reviewer identities remain auditable.
12. An interrupted confirmation can resume without guessing what committed.
13. Existing online terminal scanning continues to work unchanged.

## 21. Rollout approach

1. Build behind a disabled feature flag.
2. Test workbook parsing and import against a copy of production-shaped data.
3. Run a dry import where preview works but confirmation is disabled.
4. Pilot with one attendance operator, one supervisor, and one HR reviewer.
5. Simulate outage, night shift, duplicate upload, and interrupted confirmation.
6. Train operator, supervisor, and HR reviewer using a one-page procedure.
7. Enable for all attendance operators only after pilot audit shows no unexplained rows.

This rollout changes no current attendance workflow until offline import is explicitly enabled.
