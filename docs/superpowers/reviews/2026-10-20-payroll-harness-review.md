# Attendance/payroll acceptance runner review

Reviewed on 20 October 2026 against the approved design and implementation plan dated 19 October. Scope: `src/__tests__/e2e/attendance-payroll.*` and `src/__tests__/fixtures/attendance-payroll-original.json`. This is a source review with local, database-free checks. It does not establish a successful browser or lifecycle acceptance run.

## Re-review outcome

All six initial findings below are resolved in the inspected source. No unresolved source finding remains in this review's scope. Runtime acceptance remains pending. The fifth full run was still active during re-review and may have loaded the earlier correction helper; it cannot validate subsequently edited browser code.

| Finding | Resolution inspected |
| --- | --- |
| Local PostgreSQL guard | Admin and typed setup use the shared endpoint validator; browser has the equivalent restriction. Only local port 5433 and harmless allowed URL parameters are accepted. Query overrides are rejected. |
| Viewer authorization | Each actual request must return the `hr.manage` permission refusal or `FORBIDDEN`. Attendance, employees/balances, payslips, payrolls, wallets, transaction/import/claim counts must remain unchanged. |
| Trace privacy | Raw trace is staged under the private run directory, sanitized output is published separately, and a `finally` removes the raw archive. A failed sanitizer cannot publish the raw trace as the evidence archive. |
| Browser correction | The controlled six-hour fixture now has a real punch edit with a reason and screenshot, salary regeneration to 42,900, unchanged source reupload, restoration to six hours and regeneration back to 42,650. Raw claim and audit checks are present. |
| Displayed and printed net | Both assertions target the value cell next to the exact `Net Pay` label, preventing gross salary from satisfying the net assertion. |
| Actual review rows | The completed import's persisted `result_rows` must contain twelve `needs_review` rows, and the actual UI alert must report twelve rows. |

Re-review found and resolved one additional correction-helper defect. Production correction replaces the punch and reattaches its raw claim, so looking up the post-correction claim by the deleted original punch ID failed after a successful edit. The helper now captures stable `claim_id` before the action, queries by that ID afterward, requires a different replacement punch ID, retains the raw 15:00 timestamp and verifies the audit against the original punch ID. Both correction and restoration follow that lineage correctly in the inspected source.

The two shared production changes requested for this re-review also fit their callers. `getContext()` creates a fresh QueryClient for each router instance, and `getRouter()` supplies that same client to the React provider and SSR integration. This removes the module-level cache shared between requests. The calculator's `checkWaived()` now includes `isOccasionWaived()`, so explanation flags reflect the same global/occasion waiver rules already used for the monetary deduction; date exemptions remain supported and proration retains its existing exemption policy.

Database-free verification during re-review passed all 36 tests in the fixture, expanded safety, QueryClient isolation and approved payroll policy suites. A synthetic trace check verified network/resource-body exclusion and sensitive-key redaction, and a malformed trace failed without publishing the output archive. The scoped `git diff --check` completed successfully. No database was used and no browser/lifecycle pass is claimed.

## Follow-up review of original-file overtime decisions

The test-only browser step that rejects seven automatically suggested rest-day overtime rows fits the approved original-file scenario. It creates no overtime request, changes no source interval and authorizes no payout. Production recomputation already suggests all completed rest-day duty as pending overtime; resolving those suggestions through the actual rejection controls is necessary before the lifecycle approval guard can accept the fully resolved fixture.

The expected set is independently derived from checked-in workbook rows with complete intervals on Sundays. A database-free fixture check confirmed exactly seven positive entries, all on 4 or 11 October 2026. The browser compares their employee/date/hour set with every positive pending overtime row, uses employee plus exact displayed date to select each actual approval row, waits for its persisted rejected state, and requires unchanged duty and overtime quantities. The date text and confirmation controls match the existing overtime UI. Raw source timestamps and claims remain checked independently. Reupload preservation now also compares overtime status and hours.

No new source issue was found in this addition. Its A05 tag accurately contributes rejected-overtime coverage. Its P03 tag identifies prerequisite resolution; this step alone does not establish the pending-overtime refusal or complete payroll approval guarantees, which still require the separate lifecycle assertions. The later exact gross/net checks continue to require zero additions in the original-file salary scenario. Browser syntax checking passed after this change. The fresh full run was still underway when this follow-up was written; no full acceptance pass is claimed.

## Initial findings, retained as the review history

The following descriptions record the original snapshot. Their requested source fixes have been inspected and closed above; references to pending fixes below are historical.

1. **P1: PostgreSQL query parameters bypassed the local endpoint guard.** The original safety helper checked `URL.hostname` and `URL.port`, while the installed PostgreSQL URL parser gives `?host=` and `?port=` precedence. An offline reproduction with `postgresql://fixture:dummy@127.0.0.1:5433/titan_payroll_e2e_review_test?host=example.com&port=5432` produced effective host `example.com` and port `5432`. The admin connection had the same gap before database creation and local TLS disabling. This violates design section 3 isolation. The parent has now added a shared endpoint validator that rejects connection query overrides and applied it to the admin, browser and test URL checks. Verify its new regression cases before closing this finding.

2. **P2: Viewer rejection accepted unrelated server failures.** The reviewed browser runner's `Viewer is refused actual mutation requests` step accepted every HTTP status at or above 400. A mutation returning a validation error or HTTP 500 after an authorization regression would still be marked as access-control evidence. It also did not compare database state before and after those attempts. Require a decoded authorization rejection and unchanged attendance, leave/balance, draft and import state for each relevant mutation. This is required for P08, which specifies actual rejected requests, and section 9's accurate result reporting.

3. **P2: Trace sanitization failure retained authenticated traffic in the evidence directory.** The browser cleanup wrote raw `trace.zip` directly under evidence and then invoked `attendance-payroll.trace.py`. If the sanitizer throws while opening/reading the archive or decoding a trace line, the original archive remains at that published path with its `.network` data and cookies. Catching the error and marking the run failed does not remove that material. Stage the raw archive outside evidence, publish the sanitized archive only after successful conversion and remove the raw archive on failure. Reproduction can use a synthetic archive with a malformed `.trace` entry and a `.network` entry containing a dummy cookie. No genuine token is needed. Design sections 3 and 9 prohibit tokens in evidence, including failed runs.

4. **P2: Browser coverage omitted the required HR punch correction journey.** The reviewed browser file did not edit a six-hour imported punch day to eight hours, verify its correction reason/claim lineage, compare salary 42,650 to 42,900, or capture an HR correction screenshot. Handler integration coverage cannot establish this UI path. Add the actual editor correction and unchanged reupload assertions, using a separately identified fixture so the original workbook's completed intervals remain untouched. Design A09, browser coverage in section 3, and screenshot requirements in section 9 require this journey. The parent is addressing this gap.

5. **P2: Printed and displayed net assertions could match another amount.** `salary()` searched entire dialog/page text for the expected net. For the baseline employee, gross and net both equal 42,900, so changing only the displayed/printed Net Pay to zero leaves these assertions green because gross still contains 42,900. Assert the value adjacent to the explicit Net Pay label in the saved payslip display and print document. P01 requires printed net to match the persisted net. The parent is addressing this gap.

6. **P2: The initial twelve review rows were asserted against the expected fixture alone.** The original upload step counted `manifest.sourceRows.filter(row => row.needsReview)` rather than the application's persisted import report or review flags. That assertion would still pass if application review classification regressed for one or more rows. Compare the actual twelve source-row identities/dates and reasons from the completed import result with the fixture, as required by section 7. The parent is addressing this gap.

## Verified strengths and limits

- The Python XML oracle check passed against the original workbook without rewriting it. It verified its SHA-256, 52 source rows, 138 punches and 12 review rows against the checked-in JSON.
- The fixture and safety suites completed with 16 passing tests at the reviewed snapshot. The parent added further safety cases afterward; those new cases need their own recorded result.
- Expected salary arithmetic uses checked-in literals, Big.js and independent workbook XML extraction. It does not import the production salary calculator, calendar helpers or attendance recomputation code.
- The runner creates random disposable databases, tracks names after successful creation, runs generated migrations normally, uses separate real and controlled scenarios, reports browser and integration tiers separately, and checks exact component/occasion values before saving drafts.
- Original-source reuploads with zero new punches deliberately have a disabled confirmation control in the existing UI. Previewing the unchanged source and verifying preserved decisions is a supported application outcome under section 7. A forced browser confirmation is not required; lifecycle integration separately exercises actual handler confirmation after payment. The browser evidence should label these steps as unchanged reuploads and assert the disabled zero-new-punch state.
- The reviewed runner did not itself run the independent fixture/oracle checks before database setup. Record those checks separately, or invoke them from the acceptance command. A passing case-ID union is an index into recorded assertions, not proof that every subcase in a specification row was exercised.
- No database was opened or modified for this review. No production code, migration, commit or push was made. No complete acceptance pass is claimed.

## Reproduction commands used

```bash
python3 src/__tests__/e2e/attendance-payroll.source.py
bun run test src/__tests__/e2e/attendance-payroll.fixtures.test.ts src/__tests__/e2e/attendance-payroll.safety.test.ts
```

Acceptance remains pending successful recorded execution of all mandatory browser, lifecycle, regression and build gates against the final source. This review does not require another policy approval from the user.
