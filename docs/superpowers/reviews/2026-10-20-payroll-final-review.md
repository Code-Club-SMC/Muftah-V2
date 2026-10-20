# Final attendance payroll production review

Reviewed on 20 October 2026 against the approved attendance-to-payroll specification, P1–P4, policy implementation/review reports, and the current verification ledger. Scope is the new policy fixes, exact monetary accumulation, generic attendance invalidation and locks, payroll balance recalculation, SSR QueryClient isolation, and affected client invalidation. Pre-existing device-import work is context, not a request for unrelated refactoring.

Current assessment: the two review findings are resolved. No blocking finding remains in this scoped production review. The historical findings and their reproductions are retained below, with follow-up evidence at the end. This reviewer changed no application files or database records. At review time full browser/lifecycle acceptance remained pending; the coordinator runtime follow-up below records its later completion.

## Findings

### 1. P1: failed batch regeneration can delete an approved payroll's payslips

Location: `src/server-functions/hr/payroll/payroll-fn.ts:346-353`, combined with the per-slip finalized check at `src/server-functions/hr/payroll/core.ts:669`.

Start with two eligible employees, complete saved draft payslips, resolved attendance, and no outstanding invalidation. Run full regeneration. Each employee save independently takes and releases the payroll advisory lock. After employee A's replacement slip commits, a concurrent approval can take that lock and approve the still-complete payroll. Employee B's subsequent save correctly refuses the approved payroll. The batch catch then opens an unguarded transaction, reverses A's side effects, and deletes A's new payslip. The payroll remains approved with missing coverage; payment may also have occurred before this cleanup. P05/P07 require finalized payroll and financial inputs to remain unchanged.

The new core check makes refusal correct, but its caller's existing cleanup must obey the same finalized guard. Minimal fix: acquire the shared payroll lock in the cleanup transaction, reread payroll status, and never reverse/delete slips once it is approved or paid. Keep the original error. A deterministic lifecycle regression should pause batch generation after its first replacement commit, approve complete coverage, then resume the second save and assert unchanged finalized slips, advances, total and wallet. Serializing the entire batch is another valid fix if it can use one transaction without nested advisory-lock deadlock.

Executed a no-database reproduction against the actual handler body extracted with the TypeScript AST. Mocked dependencies model the legal approval boundary immediately before the second save refuses. Running `bun /tmp/payroll-final-review-repro.ts` produced:

```json
{
  "error": "Error: Only draft payrolls can save payslips.",
  "payrollStatus": "approved",
  "remainingSlips": [["old-b", "b"]],
  "cleanup": [
    {"action": "reverse", "status": "approved", "id": "new-a"},
    {"action": "delete", "status": "approved", "id": "new-a"}
  ]
}
```

This reproduction proves the production catch behavior. It does not establish the PostgreSQL interleaving; that requires the lifecycle regression described above. The temporary reproduction is a local review aid, not a checked-in test artifact.

### 2. P2: changed attendance hooks miss the live salary query keys

Representative locations: `src/hooks/hr/use-process-leave-approval.ts:21-23`, `src/hooks/hr/use-upsert-attendance.ts:16-18`. The same mismatch occurs in `use-bulk-mark-attendance.ts`, `use-process-overtime.ts`, and `use-convert-overtime.ts`.

These hooks invalidate `['payrolls']` and `['payroll']`. The actual dashboard query is `['payroll-dashboard', month, pageIndex]` at `src/components/hr/payroll/payroll-container.tsx:196`; the salary preview starts with `['payslip-preview']` at `src/hooks/hr/use-preview-payslip.ts:29-37`. TanStack Query matches array elements by prefix, so neither invalidation matches these keys.

Reproduce by opening an employee salary preview, closing it, changing that employee's attendance or approving/rejecting leave or overtime, then returning to the same preview within the configured 30-second freshness window. The preview can reuse the previous salary and deductions, and the dashboard can retain previous readiness flags. Saving recalculates on the server, so the persisted amount can differ from the amount HR just reviewed. Active queries also receive no automatic refetch from these mutations. The server invalidation guard still blocks stale payroll approval, so this finding does not claim a stale finalized salary by itself.

Minimal fix: invalidate the actual `['payslip-preview']` and `['payroll-dashboard']` prefixes in the affected mutation success paths. Employee balance consumers use `['employee', id]` and `['employee-payroll-history', id, ...]`; `['employees']` does not match either. Refresh those where a mutation changes a comp/annual balance. Employee history includes the employee object, although some consumers use `staleTime: 0` and therefore refetch on remount. Avoid treating every history omission as an independent financial defect.

Executed the installed QueryClient directly with fresh dashboard and preview entries, then both current payroll invalidations. Both entries retained `isInvalidated: false`:

```bash
bun -e 'import { QueryClient } from "@tanstack/react-query"; const q=new QueryClient({defaultOptions:{queries:{staleTime:30000}}}); const keys=[["payroll-dashboard","2026-10",0],["payslip-preview","e1","2026-10"]]; keys.forEach(k=>q.setQueryData(k,{net:42900})); await q.invalidateQueries({queryKey:["payrolls"]}); await q.invalidateQueries({queryKey:["payroll"]}); console.log(keys.map(k=>({key:k,invalidated:q.getQueryState(k)?.isInvalidated}))); q.clear();'
```

Device confirmation and manual-punch hook paths have related invalidation omissions, but those predate this policy review scope. A small shared invalidation function is reasonable if used to cover the same salary-affecting mutation paths consistently.

## Reviewed behavior and evidence limits

Exact common-denominator monetary accumulation and half-up remainder rounding address the earlier accumulated-half defect. Working/rest-day overtime uses the shared effective standard. Comp reservation deltas and repeated rejection refund behavior are consistent with P2/P3. The reviewed mutation paths acquire the common payroll lock before employee locks, and generic invalidation checks finalized dates even without device provenance. Revision-captured invalidation resolution preserves concurrent changes instead of clearing a newer revision. Router-created QueryClient instances remove the previous module-global SSR cache.

No additional correctness finding is raised for pre-existing client-supplied leave approval fields, converted-overtime correction semantics, or unrelated import refactors. This review does not expand those into new requirements.

The verification ledger reported 164 affected regression tests passing, a successful production build, and exactly 47 pre-existing report/P&L type errors. Those checks were not rerun by this reviewer and do not constitute a passing repository-wide typecheck. The previous failed browser run completed seven salary journeys; the next full browser run and lifecycle acceptance were still pending when review began. This report claims only the code inspection and the two no-database reproductions above, not a full browser or PostgreSQL acceptance pass.

## Follow-up resolution status

- Finding 2 resolved: the coordinator added `payroll-dashboard`, `payslip-preview`, and `employee-payroll-history` invalidation to all five affected hooks. This reviewer inspected those changes and the actual-hook QueryClient regression in `src/hooks/hr/payroll-invalidation.test.tsx`. The three prefixes now match the real consumers. The coordinator recorded all five cases failing before the fix. This reviewer inspected `.tmp/attendance-payroll-hook-invalidation-green.log`, which records all five passing after the fix.
- Finding 1 resolved: `generatePayslipsFn` cleanup now acquires `lockAttendancePayrollWrites`, rereads the payroll status under that lock, and returns without reversing side effects or deleting slips unless the payroll is still draft. The original generation error is preserved. This reviewer checked the exact guard and the deterministic PostgreSQL regression at `src/__tests__/integration/attendance-payroll.test.ts:617`. The test uses a test-only INSERT trigger and advisory scheduling barrier to queue actual approval between employee saves, then checks refusal of the remaining generation, two intact PKR 42,900 slips and an approved PKR 85,800 total. The coordinator reports that this real PostgreSQL test failed before the fix with coverage reduced from two slips to one, and passed after the fix with both slips retained. This reviewer did not access the database or rerun that test.

These targeted fixes satisfy the two findings. Those targeted reviews alone did not establish runtime acceptance; the later coordinator run is recorded below.

The reviewer subsequently inspected the PostgreSQL [red results](attendance-payroll/lifecycle-9fbe3dd93550d0c2/race-red-results.json) and [targeted green results](attendance-payroll/lifecycle-9fbe3dd93550d0c2/targeted-green-results.json). They directly record the missing approved slip before the cleanup fix and two intact slips with total 85,800 afterward.

## Mandatory subcase coverage audit

Source audit performed while the final full two-scenario run was in progress. Every mandatory L01–L16, A01–A14 and P01–P08 ID has a meaningful browser or PostgreSQL test body. Coarse case-ID coverage alone does not establish every subcase. The audit identified the following assertion gaps, which the coordinator then addressed:

- The composite fixture now separately asserts period Bradford score 27, the exact cycle dates, yearly score 27, and all three persisted snapshot values after approval. The reviewer inspected these new assertions.
- The real-file path now checks the specified aggregate 147 present working dates, five absent working dates, four approved leave dates and ten stored rest-day rows using the independent checked-in working-date list, before the lifecycle's first reset. The reviewer inspected this new comparison alongside the existing 166 attendance/138 raw claim and exact salary checks.

The approved leave path now checks one approved and zero unapproved dates for each of the four types, complementing its pending/rejected counts and the composite. A12 now has a separate historical September period outside the effective-date window, asserting that cycle-end selection uses the January salary revision/basic 26,000 despite the later October revision/basic 52,000. Its explicit ignore-unmarked flag is limited to revision-selection characterization and provides no evidence for full-payroll generation. These additions close the smaller assertion-completeness points.

The real-file browser now includes actual HR rejection of the seven automatically suggested rest-day overtime items, checks them against independent source intervals, and preserves source duty/raw claims. Its successful execution is still required. Captured lifecycle transport and supplied HR context are the specification's documented boundary; missing HTTP authentication for unexposed lifecycle actions is not an additional coverage defect. Final acceptance also requires successful final-source browser/lifecycle runs, cleanup, affected regressions, build, whitespace check and Graphify refresh.

No further mandatory subcase gap was found in this source audit. The added assertions still require a successful recorded runtime result; this review does not substitute source inspection for acceptance execution.

## Coordinator runtime follow-up

After this source review, full run `b14d5a9a941cc2d7` passed both browser scenarios and both 31-test PostgreSQL suites without skips, including the added literal status, Bradford and salary-revision assertions. All 40 mandatory case IDs have passing evidence. Both owned databases were removed. See the [final verification report](2026-10-19-attendance-payroll-e2e-verification.md). This follow-up records the coordinator's run and does not claim the reviewer reran it.
