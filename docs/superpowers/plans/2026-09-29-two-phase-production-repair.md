# Two phase production repair implementation plan

> **For agentic workers:** Execute tasks in order and use `docs/two-phase-production-audit.md` as the completion tracker. Keep each finding unchecked until its evidence requirement is met.

**Goal:** Make the revised two phase production flow build, enforce its stock and cost invariants, and work through connected modules.

**Architecture:** Keep formulas and mixing runs as chemical batch records. Packaging allocations produce finished goods for a single recipe. Carton and sales records refer to allocations through their dedicated columns. Server functions enforce transitions and stock changes inside transactions; UI calls match those functions.

**Tech Stack:** TanStack Start, Better Auth, Drizzle ORM, PostgreSQL, React Query, Zod, Bun.

**Spec:** `docs/Two-Phase Production System — Revised Design (v2).md`, with the owner's testing phase decision in `docs/two-phase-production-audit.md` overriding legacy data preservation.

**Completion — 2026-10-06:** All six tasks and findings A01–A11 are implemented and verified under the owner's scope and no-browser rulings. Further audit findings were specified in `docs/superpowers/specs/2026-10-02-two-phase-audit-completion.md` and repaired through reproduced regressions. Final gates: 86 PostgreSQL and 170 focused checks passed; clean migrations/relations, schema drift, build, typecheck, independent review and graph refresh passed. The evidence tracker records the unrelated full-repository test failures; the entire repository suite is not claimed green.

## Global constraints

- Keep the current uncommitted worktree and unrelated edits intact.
- Do not edit `src/routeTree.gen.ts` directly. Let the router build regenerate the tree for the current routes.
- Never mark a finding complete on implementation alone; record passing evidence in the tracker.
- Use `graphify update .` after code changes, per `AGENTS.md`.

## Tasks

1. **Build path (A01).** Trace deleted module imports through recipe card, recipe detail, and old operator hooks. Replace old production initiation actions with valid mixing/allocation navigation; remove unused callers. Run build, then typecheck. Keep A01 open until all compilation failures from the repair are resolved.
2. **Schema and migrations (A02).** Compare `src/db/schemas/{inventory,manufacturing,production}-schema.ts` to migrations. Remove mistaken duplicate properties and preserve required SQL column mappings. Add a corrective migration for missing foreign keys and recovery fields or regenerate the test database if a clean reset is selected for testing. Verify on a clean PostgreSQL database.
3. **Server lifecycle (A06, A07, A08, A09).** Repair formula and recipe linking, mixing transitions, allocation creation, progress, cancellation, completion, and cost calculations. For each transition, add a focused failing check, apply one fix, and verify it before the next transition.
4. **Operator and management screens (A04, A05).** Match request and response contracts for creation dialogs, list/detail screens, consoles, and permissions. Verify the Operator role and valid navigation.
5. **Connected modules (A03, A10, A11).** Update carton services, sales audit inserts, dashboard, reports, lab reports, and recovery to use the new references. Verify each boundary with focused checks and then run build and typecheck.
6. **Final verification.** Run clean migration and an end to end mixing, allocation, packaging, stock, carton, sales, QC, and recovery scenario. Review the tracker item by item and check only those supported by evidence.
