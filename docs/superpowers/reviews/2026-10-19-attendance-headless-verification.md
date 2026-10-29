# Attendance headless browser verification, 19 October 2026

Real headless Google Chrome 144.0.7559.132 exercised the compiled application on `http://localhost:3100` against the project's PostgreSQL database at `localhost:5433/main`. Authentication, RPCs, parsing, mutations and queries used the application and database directly. No browser network responses or authentication handlers were mocked.

## Source and database preparation

The uploaded file was the original `docs/Total Punches(20261001-20261014).csv`, not the test fixture copy. SHA-256 was `5c96e6912b261a4def094be00b46de516930b6fe085c1cdb75b71684d8779591`. Its bytes contain an XLSX workbook despite its `.csv` extension. It contains 52 employee/date rows and 138 punches for six employees between 1 and 14 October 2026.

After verifying existing migration history against generated migrations, `bun run db:migrate` applied the pending generated migration `0017_unique_tenebrous.sql` to this local application database. No generated migration or migration-history record was manually changed.

`src/__tests__/e2e/device-attendance.setup.ts` seeded the six source identities with matching employee codes, eight standard duty hours and a synthetic zero salary. It inserted no punches. A dedicated test account received only the custom HR view/manage permissions. Generated credentials were written to an ignored file with mode 0600. The setup rejects nonlocal databases and employee-name conflicts.

## Browser results

The initial import run started with zero punches, claims and attendance records. It uploaded the original file, previewed 50 rows plus the remaining two rows, confirmed through the UI, and verified PostgreSQL contained exactly 138 punches, 138 durable claims and 52 attendance records. It passed the saved-upload, replay and correction checks, then exposed the mobile layout defects described below. Evidence: [initial import results](attendance-browser/2026-10-19T10-30-53-978Z/results.json).

After fixing those defects, the complete rerun passed all seven stages. Evidence: [final results](attendance-browser/2026-10-19T10-36-03-933Z/results.json), [desktop preview](attendance-browser/2026-10-19T10-36-03-933Z/02-real-file-preview.png), [HR editor](attendance-browser/2026-10-19T10-36-03-933Z/06-existing-hr-editor.png), [mobile preview](attendance-browser/2026-10-19T10-36-03-933Z/08-mobile-import.png), [Playwright trace](attendance-browser/2026-10-19T10-36-03-933Z/trace.zip).

| Check | Observed result |
| --- | --- |
| Actual Better Auth login and HR page | Passed; credential controls also disabled in JavaScript-free SSR HTML, with POST form method |
| Original file upload and paginated preview | 52 rows, six matched identities; preview inserted no punches |
| Initial browser confirmation | 138 punches, 138 claims, 52 attendance records, zero fabricated absences or leave records |
| Independent hours verification | Every logical punch day has an attendance row; all saved hours equal the rounded sum of completed IN/OUT timestamp intervals |
| Historical inconsistencies | 12 review rows remain for HR; no checkout was invented |
| Saved-upload reopening and new uploads of the same source | Zero new punches; each upload created a new source-report record |
| Existing HR editor | Imported-origin correction required a reason and changed the actual stored punch |
| Upload after HR correction | Raw claim remained linked to the corrected punch; original timestamp was not restored |
| Second HR correction | Required another reason; restored the supplied timestamp; exactly two new audit events matched this run's reasons and punch lineage |
| Mobile at 390 × 844 | Document width 390; pagination and returning to the file input worked within the drawer |
| Uncaught browser exceptions and failed app requests | Zero |

Final database state remains six seeded employees, 138 punches/claims and 52 attendance records. All 138 timestamps match the original source after test corrections were restored. Four correction audit records remain from the initial and final runs. The dedicated test account was banned and its sessions deleted after the successful run. Seeded employees and attendance remain available for inspection.

The real file produced no merged overnight attendance date. Overnight behavior is covered by the separate planner/PostgreSQL regression suites, not claimed as an overnight example in this browser run. No full payroll generation was performed by this browser test.

## Defects found and fixed

- The login form could submit credentials with a native GET before hydration. It now uses POST and disables credential inputs/submission until hydration. Two behavioral tests cover both states; the browser also verified the server-only HTML and actual login.
- A local `.env` with `NODE_ENV=development` caused a build to combine development JSX transforms with React's production runtime, producing `jsxDEV is not a function` on SSR. The build script now explicitly selects `NODE_ENV=production`. The successful browser run used the resulting production transform/runtime combination.
- The desktop import width lost to the base sheet's side-qualified `max-w-sm` rule. Matching side-qualified width/max-width classes now render the desktop import at 1152 px in the 1440 px viewport.
- The mobile import body overflowed the drawer vertically. An optional `bodyClassName` on `ResponsiveSheet` lets this import constrain and scroll its body without changing other callers.
- The existing attendance category tabs widened the mobile document to 586 px. Their container now scrolls horizontally; the final browser measured 390 px document width at 390 px viewport width.

The browser checker was strengthened during review to wait for each new upload RPC and persisted import ID, reject application-error alerts, detect missing attendance rows, and verify only audit events newly created by the current correction cycle.

## Final code checks

- `bun run build` passed with the final package script, without an external `NODE_ENV` assignment. Log: `.tmp/attendance-browser/build-final.log`.
- The 13 focused login/import UI/hook tests passed. The two login tests passed again after correcting unsupported Testing Library option types. Logs: `.tmp/attendance-browser/ui-tests.log` and `login-tests.log`.
- `bun run typecheck` reports the same 47 existing errors in P&L export tests and report-page cells. It reports no attendance, import, login, browser setup or shared sheet errors. Log: `.tmp/attendance-browser/typecheck-final.log`.
- `node --check src/__tests__/e2e/device-attendance.browser.cjs` and `git diff --check` passed.
- Independent review accepted the final layout, upload synchronization, attendance completeness and audit-lineage checks without an important finding.

The earlier 284 focused feature tests and eight real PostgreSQL integration tests are recorded in the [implementation verification](../plans/2026-10-14-device-attendance-import-verification.md). They were not counted as browser tests or rerun as part of this final browser verification.

## Environment and remaining findings

The production server was launched with a test-only connection-string override `sslmode=disable`, guarded to `localhost:5433/main`, because local PostgreSQL does not provide TLS. No application database/authentication configuration or `.env` was changed for that override. Port 3000 belonged to another application and was left alone.

The final console retained one existing login illustration error, `<ellipse> attribute rx: Expected length, "undefined"`. It caused no uncaught exception or failed acceptance stage. This result does not claim an empty browser console.

An earlier Vite development-server run returned HTTP 500 resolving the upload handler before payload parsing. [Source investigation](2026-10-19-attendance-rpc-review.md) identified a possible framework circular-import/cold-loader mechanism but did not confirm that branch at runtime. The compiled production server resolved the handlers and passed the upload/correction workflow. No dependency source or global middleware was patched to mask the development-loader failure.

No deployment, commit or push was performed.
