# Main merge readiness, 20 October 2026

User requested merging `feat/batch-packing-record` into `main`. Remote main at verification was `8c842f6`; incoming commits were `e5408b1` and `745b73a`. Main is an ancestor, so the merge requires no conflict resolution. The earlier manufacturing/report commit is included alongside attendance/payroll.

## Reviewed fixes before merge

Independent review reproduced new-payment over-allocation after the previous settlement cap was removed. The calculator now rejects over-allocation by default; only recalculation of existing receipts permits credit balances caused by approved returns. Initial invoice and proposed payment validation retain the cap. Focused checks reject both 110 cash and 80 confirmed plus 30 pending against a 100 invoice, while retaining a 100 receipt against return-reduced receivables of 80 and zero.

Empty report cells now have optional children in their type, matching existing rendered footer usage. P&L test inputs use the supported `offline_import` source. These changes resolve the 47 previously recorded type diagnostics without altering report output.

## Verification

- Typecheck passed, exit 0.
- Production build passed, exit 0.
- Focused settlement/report checks passed, 22 tests across three matched files.
- All 18 migrations applied to a new run-owned local PostgreSQL database. Settlement service, batch packing and mixing stock checks passed, 13 tests across three files. Database `titan_merge_4dda4bb39f603ff6_test` was then dropped.
- Independent review found no remaining blocker in the payment/report fixes or the appended migration chain. Existing migrations 0000–0006 and journal entries remain unchanged; 0007–0017 append normally.
- Graphify refreshed successfully; whitespace check passed.

## Full-suite limitation

The pre-fix default suite was **not green**: 1,163 passed, 23 failed, 134 skipped, plus one failed suite. This is recorded separately from the successful focused/database checks. The reproduced payment-cap failure is fixed and covered by focused tests.

Other failures were classified rather than silently treated as passing. Employee fixture tests omit `isDriver`, which main already requires; overtime-form tests and relevant implementation are unchanged from main; the offline-schema test already references an absent historical migration on main; the phase-four source assertion already omits the driver exclusion present on main. Incoming manufacturing assertions still expect former prefetch keys/statuses and removed recipe-form syntax; source inspection verified the current operator keys match, completed runs are intentionally included for packing, and the single formula selector remains present. The scanner route assertion expects the retired scanner, contrary to the approved import design. Database tests collected by the default configuration lacked isolated test database configuration; their manufacturing cases were rerun successfully against PostgreSQL as stated above.

No passing full-suite or CI result is claimed. GitHub CLI is unavailable in this environment. Pushing main triggers the repository's production deployment workflow; successful deployment or live-data migration compatibility has not yet been verified. No production database was inspected or modified by these checks.
