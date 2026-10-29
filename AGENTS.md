# AGENTS.md — Titan ERP (TanStack Start + Better Auth + Drizzle)

## Quick commands

```bash
bun run dev          # Start dev server on port 3000
bun run build        # Production build (needs extra heap — uses NODE_OPTIONS=--max-old-space-size=4096)
bun run test         # Vitest (jsdom, src/__tests__/setup.ts)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint (only CI — continue-on-error, non-blocking)
bun run format       # prettier (check only, no write currently)

# Database
bun run db:generate  # Generate Drizzle migrations from schema changes
bun run db:migrate   # Apply migrations (reads .env via tsx --env-file=.env)
bun run db:push      # Push schema directly (prototyping only, never production)
bun run db:seed:hr   # Seed HR demo data
bun run db:studio    # Drizzle Studio GUI

# Infrastructure
docker compose up -d                         # Start PostgreSQL on port 5433
./scripts/nuke-db.sh                         # Full DB reset (requires Docker, psql)
./scripts/super-admin-bootstrap.sh create    # Bootstrap first super admin
```

## Architecture

**Stack:** TanStack Start (React SSR via Nitro/node-server) → Better Auth → Drizzle ORM → PostgreSQL. Styled with Tailwind CSS v4 + shadcn/ui (radix-maia style, hugeicons).

**Route system is file-based and auto-generated.** Do NOT edit `src/routeTree.gen.ts` — it is regenerated on every build by `@tanstack/router-plugin`. Layout routes use underscore prefix (`_protected`, `_authLayout`) and wrap child routes without appearing in the URL.

**Two distinct auth layers coexist:**
1. Better Auth handles session tokens, sign-in/sign-up, 2FA, password reset. Tokens are stored in PostgreSQL.
2. A DB-backed RBAC system (`src/lib/rbac.ts` + `src/lib/authz.server.ts`) maps users → roles → permissions → route access. Better Auth's own `adminPlugin` uses a separate static permissions table for its admin UI.

**Server functions** (`src/server-functions/`) use TanStack Start's `createServerFn` — not REST API routes. They are called directly in `beforeLoad` or components. They chain middleware for auth checks: `authContextMiddleware` → `requireAuthMiddleware` → `createPermissionMiddleware(permission)`.

**Database schemas are domain-split** under `src/db/schemas/` (auth, inventory, sales, finance, hr, rbac, supplier, core-suppliers). All merged in `src/db/index.ts`. The HR schema is the most complex (~600 lines).

**API routes** are minimal: `/api/health` (Railway health check), `/api/auth/$` (Better Auth catch-all), `/api/internal/bootstrap-admin` (super admin bootstrapping).

## Generated migrations are immutable

- **Manual changes to generated migrations are strictly prohibited.** This includes generated SQL, snapshots, and `meta/_journal.json` under `src/db/migrations/`.
- Never manually edit, delete, rename, renumber, reorder, or replace these files. Never delete and regenerate an existing migration to change its contents, including migrations not yet applied.
- Make corrections in the schema source and run `bun run db:generate` to create a new forward migration. Only the migration generator may write generated SQL, snapshots, and journal entries.
- Never rewrite applied migrations or manually change database migration-history records to force migrations to run. Diagnose inconsistencies and report them before attempting database recovery.

## Package manager duality

- **Locally + CI:** Bun (`bun.lock`, `bun install --frozen-lockfile`)
- **Production/Docker:** npm (`npm install` without lockfile — Dockerfile falls through to this since there's no `package-lock.json`)
- **Warning:** Production builds do not use a lockfile. Adding `npm` dependencies means production may resolve different versions than local.

## Build

- Production build (`bun run build`) sets `NODE_OPTIONS=--max-old-space-size=4096` — the app is large and may OOM without this.
- Output goes to `.output/` (Nitro node-server preset). Entry point: `.output/server/index.mjs`.
- CI runs `bun run build` without DB env vars — the build must succeed with placeholder/undefined env. SSG/SSR pages that query DB at build time will fail.

## Testing

- Vitest with `jsdom` environment, `globals: true`. Setup: `src/__tests__/setup.ts` (stubs `window.matchMedia`).
- Tests use a mix of: direct unit tests, property-based tests (fast-check), and **source-code inspection** (reading `.ts` source files to assert patterns in server functions). This is valid — server functions that compose DB queries can't easily be mocked.
- No test DB is spun up. Tests either inspect source or test pure functions.

## Key config facts

- **PostgreSQL port: 5433** (docker-compose.yml), not default 5432.
- **Drizzle migrations** live at `src/db/migrations/`. Schema: `src/db/schemas/*`. Migration runner reads `.env` via `tsx --env-file=.env`.
- **`@/` alias** maps to `src/` (tsconfig paths + `vite-tsconfig-paths`).
- **Theme:** next-themes with `defaultTheme: "dark"`. Forced dark mode (no user toggle).
- **Sidebar navigation** is permission-aware — `getAccessibleNavigationItems()` filters `navigations` from `src/lib/constants.ts` based on the user's granted permissions.
- **Lint/formatter configs:** The package.json references `eslint` and `prettier` but the config files (`eslint.config.js`, `prettier.config.js`) do not exist at the time of writing. There is a `biome.json` with lint/formatter rules but no npm script runs biome. The `lint` and `format` scripts may be broken.
- **Generated files excluded from linting:** `src/routeTree.gen.ts`, `src/styles.css` (biome.json includes list).
- **`.cta.json`** is stale — says `pnpm` but actual package manager is `bun`.

## Deployment

- **Platform:** Railway (via `railway.toml` + `Dockerfile`).
- **Pre-deploy:** `npm run db:migrate` runs BEFORE the new container receives traffic.
- **Health check:** `GET /api/health` (checks PostgreSQL connectivity, returns 200 with status JSON).
- **Deploy branches:** `main` → production, `develop` → staging.
- **Super admin bootstrap:** Uses `ADMIN_BOOTSTRAP_SECRET` env var + `x-bootstrap-secret` header. Run the CLI script or hit `/api/internal/bootstrap-admin`.

## Conventions

- **Server functions** are organized by domain under `src/server-functions/<domain>/`. Each file exports `createServerFn` instances with middleware + input validation.
- **Hooks** under `src/hooks/` are thin wrappers around server functions for client-side data fetching via TanStack Query.
- **Components** follow: `shadcn/ui` in `src/components/ui/`, custom reusable in `src/components/custom/`, domain-specific in `src/components/<domain>/`.
- **Illustrations** in `src/components/illustrations/` are SVG React components used on auth pages and empty states.
- **Route protection** uses `beforeLoad` in layout routes. `_protected/route.tsx` checks `canAccessPath()`; server functions enforce via middleware.
- **Pakistan-specific logic** uses PKR formatting with Lac/Crore numbering (see `src/lib/currency-format.ts`).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
