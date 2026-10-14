import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const resetScript = resolve("scripts/nuke-db.sh");

async function withDatabase(check: (pool: Pool, url: URL) => Promise<void>) {
  const url = new URL(testUrl!);
  const name = `titan_reset_${randomUUID().replaceAll("-", "")}_test`;
  url.pathname = `/${name}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await check(pool, url);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}

function runFunctions(url: URL, body: string) {
  // Replace only the Docker transport with local psql. SQL and the migration
  // command still execute against this test's freshly created database.
  return execFileSync("bash", ["-c", `
    source "$TITAN_RESET_SCRIPT"
    docker() {
      if [[ "$*" == *" down"* || "$*" == *" up -d"* ]]; then return 0; fi
      while [[ $# -gt 0 && "$1" != psql ]]; do shift; done
      if [[ $# -eq 0 ]]; then return 1; fi
      shift
      command psql -h "$PGHOST" -p "$PGPORT" "$@"
    }
    ${body}
  `], {
    cwd: resolve("."),
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TITAN_RESET_SCRIPT: resetScript,
      POSTGRES_DB: url.pathname.slice(1),
      POSTGRES_USER: decodeURIComponent(url.username),
      POSTGRES_PASSWORD: decodeURIComponent(url.password),
      POSTGRES_PORT: url.port || "5432",
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGPASSWORD: decodeURIComponent(url.password),
      // An inherited URL must never send the reset's migrations elsewhere.
      DATABASE_URL: "postgresql://invalid:invalid@localhost:1/wrong_database",
    },
  });
}

describe.skipIf(!testUrl)("database reset script", () => {
  it("reapplies migrations when only stale migration history remains", async () => {
    await withDatabase(async (pool, url) => {
      await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
      const expectedCount = (await pool.query("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).rows[0].count;
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      expect((await pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count).not.toBe("0");

      runFunctions(url, "nuke_detonation() { :; }; wait_for_db() { :; }; destroy_volumes; run_migrations");

      const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map(row => row.tablename);
      expect(tables).toEqual(expect.arrayContaining(["user", "warehouses", "formulas", "mixing_runs", "packaging_allocations"]));
      expect(tables).toHaveLength(Number(expectedCount));
    });
  });

  it("clears application objects and migration history together", async () => {
    await withDatabase(async (pool, url) => {
      await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
      await pool.query('CREATE TABLE public."Reset sentinel" (id integer); CREATE TYPE public.reset_enum AS ENUM (\'test\')');

      runFunctions(url, "drop_all_tables");

      expect((await pool.query("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public', 'drizzle')")).rows[0].count).toBe("0");
      expect((await pool.query("SELECT to_regtype('public.reset_enum') AS name")).rows[0].name).toBeNull();
      expect((await pool.query("SELECT count(*) FROM pg_namespace WHERE nspname='public'")).rows[0].count).toBe("1");
    });
  });

  it("rejects a successful migration command that creates no tables", async () => {
    await withDatabase(async (_pool, url) => {
      expect(() => runFunctions(url, "bun() { return 0; }; if run_migrations; then exit 0; else exit 1; fi")).toThrow();
    });
  });

  it("stops when the migration command fails", async () => {
    await withDatabase(async (_pool, url) => {
      expect(() => runFunctions(url, "bun() { return 7; }; run_migrations")).toThrow();
    });
  });
});
