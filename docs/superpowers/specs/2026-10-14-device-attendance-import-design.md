# Replace barcode attendance capture with device report uploads

The user authorized implementation on 2026-10-14. Scope: replace barcode acquisition with HR upload of ZKBio Zlink Total Punches reports. Keep existing punch ledger, attendance editor, employee logs, leave, overtime and payroll calculations. No new attendance policy or automatic absence marking.

## Binding behavior

- Accept actual UTF-8 CSV and XLSX by content. The supplied `docs/Total Punches(20261001-20261014).csv` is XLSX, with title row 1, headers row 2, Excel date serials and mixed numeric/text punch cells. Its fixture contains 52 daily rows, 6 people and 138 punches.
- Columns: Person ID, Person Name, Department, Date, Weekday, No. of Punch(s), Punch Records. IDs remain strings. Device times are PKT, at minute precision. Reject unsafe/malformed workbook packages, formula input cells, invalid dates/times, duplicate employee/date rows and inconsistent counts. Bound files to 10 MiB and 20,000 data rows.
- Working time sums completed IN/OUT intervals and excludes breaks. Today's final IN remains open. Historical unmatched INs remain visible for HR correction and block payroll finalization until corrected or HR explicitly changes the daily status. Missing employee/day rows are never automatically marked absent.
- Preserve overnight shifts: next-calendar-day morning checkout closes the previous night's IN on its original attendance date. Do not move historical punches to the checkout date. A daytime unmatched IN must not absorb the next morning's arrival.
- Every upload has durable parsed source rows and outcomes. Device Person IDs map to existing employee codes by default; HR may explicitly link an unknown ID to an employee. A persisted mapping is unique on both device Person ID and employee ID.
- Preview resolves identities and shows new/unchanged/review/blocked rows. Confirm recalculates against live data under the shared employee punch lock, so preview is never authority to overwrite newer data.
- Durable per-employee/raw-timestamp claims survive punch corrections/deletions. Re-upload must not restore a punch HR corrected or removed. Existing punches are never rewritten by import. Conflicting sequence changes and manual absent/leave/holiday/present-without-punch overrides remain for HR resolution. Imports can apply safe rows and report exceptions.
- Imports append to the existing ledger with source `device_import`; existing HR editor supports and audits manual correction of these punches. Existing offline signed-workbook infrastructure remains separate.
- Serialize device attendance changes with payroll approval; reject direct changes to approved/paid periods. Mark affected draft payrolls stale using the existing invalidation mechanism. Payroll regeneration must not resolve invalidations committed after the run began.
- Replace the scanner route with a permission-checked redirect to HR attendance and disable the old scan mutation. Keep historical QR punches and system role identifiers for compatibility; no new terminal capture remains available.
- UI uses existing shadcn components, existing dark ERP styling, HR-manage permissions, preview/confirm, employee mapping and links into the existing editor. No additional supervisors or outage declarations.

## Structure

`src/lib/attendance/device-import/contracts.ts` owns serializable parser and UI contracts. `parser.server.ts` owns native CSV/XLSX reading. `timeline.ts` owns deterministic interpretation and conflict checks. `service.server.ts` owns staging, mappings, locks, claims, confirmation and audit outcomes. `payroll.server.ts` owns imported-attendance payroll guards. New schema stores upload snapshots, device-person links and durable punch claims. Existing attendance tables remain the downstream read model.

## Verification

Use the exact client file as an in-memory parser fixture; exercise actual CSV quoting, numeric dates/times, malformed records and resource bounds. Test paired breaks, today's open IN, multi-day and cross-upload overnight, day-shift missed checkout, duplicate/repeated/overlapping uploads, late inserted punches, HR correction tombstones, status overrides, payroll locks and authorization. Use executable server mocks and integration checks where available. Generate only forward migrations; do not apply to a live database. Run relevant Vitest, typecheck, build and graphify update. Preserve pre-existing unrelated changes and document baseline failures.
