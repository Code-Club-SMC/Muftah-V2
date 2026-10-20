# Device attendance implementation verification — 15 October 2026

**19 October browser verification:** The local application database has since been migrated and six employees seeded. The original HR file was uploaded and confirmed through real headless Chrome: 138 punches/claims and 52 attendance records, with 12 review rows. Replay, audited HR corrections, independent saved-hour calculations and mobile scrolling passed. See [headless verification and evidence](../reviews/2026-10-19-attendance-headless-verification.md). The migration statements below describe the earlier implementation-only phase.

HR → Attendance → **Import device report** replaces barcode capture. HR uploads the native Total Punches file, previews employee matches and exceptions, then confirms safe punches. Recent uploads reopen for follow-up review. Review actions open the existing attendance editor on the logical attendance date, including overnight and corrected dates.

The source report, employee mapping and raw-event claims are durable. Repeated and concurrent confirmations do not duplicate events or restore HR corrections/deletions. Breaks remain excluded from duty time. Overnight checkouts retain the IN attendance date. Historical incomplete imported days require HR correction or an explicit daily-status decision before payroll. Missing report dates do not create absences.

Device changes and manual edits share payroll/employee locks. Both sides of a cross-date correction respect finalized payroll and invalidate affected drafts. Regeneration resolves only the invalidation revisions captured at its start. Bulk and single-day edits select their write behavior from ledger reads taken after locking.

## Verification

- 279 attendance/payroll/planner/parser/hook/UI regression tests passed across 40 files. Log: `/tmp/titan-device-verified-regression.log`.
- Five additional RPC permission/HTTP-method boundary tests passed. Log: `/tmp/titan-device-auth-tests.log`.
- Eight real PostgreSQL integration tests passed in 10.19 seconds. Log: `/tmp/titan-device-attendance-integration.log`.
- The exact supplied XLSX-with-CSV-extension fixture yielded 52 daily rows, six employee identities and 138 ledger punches/claims. Concurrent confirmation and repeat upload retained exactly 138.
- PostgreSQL tests applied the complete generated migration chain to a new random test database, verified schema/constraints, exercised actual recomputation and HR handlers, checked draft invalidation revisions, and queued concurrent import/bulk/single-day mutations under real advisory locks. The temporary database was removed.
- The final production build passed. Log: `/tmp/titan-device-build-verified.log`.
- Full typecheck still reports the same 47 pre-existing errors in P&L export tests and report-page table cells. No attendance, payroll, import UI or integration-test diagnostic appeared. Log: `/tmp/titan-device-typecheck-4.log`.
- A separate strict compilation of the final PostgreSQL integration and RPC-boundary tests, including their imported production modules, passed with zero errors. Log: `/tmp/titan-device-scoped-typecheck.log`.
- Parser review accepted the sparse XLSX-cell fix. Final independent review accepted the import, correction, mapping and concurrency fixes with no remaining important finding.
- Graphify refreshed after the final source edit: 7,028 nodes, 19,262 edges, 360 communities. Log: `/tmp/titan-device-graphify.log`.

The PostgreSQL suite stubs the transport/auth wrapper so it can call actual handlers; separate source-boundary and UI permission tests verify the HR-management guards. The invalidation revision test exercises the real read/change/resolve boundary, rather than generating a full payroll end to end.

## Migration and release

`src/db/migrations/0017_unique_tenebrous.sql` and its snapshot/journal entry were generated through Drizzle. No generated migration was manually edited. This adds three device-import tables and extends attendance payroll invalidation provenance/revisions.

Apply the generated migration before starting the updated application:

```bash
bun run db:migrate
```

Application databases were not migrated during implementation. No deployment, commit or push was performed. The existing Railway pre-deploy migration step can apply this forward migration during release.

## Implementation decisions

- Retained the current feature checkout and its unrelated work; added no runtime dependency.
- Kept native device import provenance separate from the existing signed offline-workbook workflow.
- A daytime unmatched IN does not absorb tomorrow's arrival. An IN at or after 20:00, or a configured overnight shift, permits the next morning's before-noon OUT on the IN's original attendance date, within 24 hours. Ambiguous sequences remain for HR.
- Raw identity survives HR correction while the claim follows the replacement punch and attendance date; this preserves replay suppression and payroll protection.
- Both automatic employee-code matches and explicit HR mappings persist with unique employee/device ownership across uploads.
- Ledger reads and dependent decisions run inside the shared locks. Generated migrations were executed only in a disposable local test database.

The detailed spec, implementation plan and review/verification reports remain available for review in `docs/superpowers/` and `.superpowers/sdd/2026-10-14-device-attendance-import/`.
