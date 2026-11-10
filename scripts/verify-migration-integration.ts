// Run with Bun's --no-env-file. Does not import the application or read .env.
// Usage: bun --no-env-file scripts/verify-migration-integration.ts BACKUP SHA256
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { NodePgSession } from "drizzle-orm/node-postgres/session";

export function validateLocalTestUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("An explicit local PostgreSQL test URL is required");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\d+$/.test(url.port) ||
    Number(url.port) < 1 ||
    Number(url.port) > 65535 ||
    !/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    // Never include the URL, which may contain credentials, in an error.
    throw new Error(
      "Require 127.0.0.1 or ::1, explicit port, _test database, no URL options",
    );
  }
  return url;
}

export async function withLocalClient<T>(
  raw: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const url = validateLocalTestUrl(raw);
  // Explicit fields prevent libpq URL options and ambient PG* variables redirecting us.
  const client = new Client({
    host: url.hostname === "[::1]" ? "::1" : url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query(
      "SET timezone = 'UTC'; SET datestyle = 'ISO, YMD'; SET extra_float_digits = 3",
    );
    return await work(client);
  } finally {
    await client.end();
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(root, "src/db/migrations");
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const emit = (phase: string, result: unknown) =>
  console.log(JSON.stringify({ phase, result }));
// No inherited DATABASE_URL, PG*, NODE_OPTIONS, Bun preload, or production credentials.
const environment = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp/opencode",
};
let dockerHost: string;

function command(
  program: string,
  args: string[],
  input?: Buffer,
  env = environment,
): string {
  const result = spawnSync(program, args, {
    cwd: root,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // A PostgreSQL error can include a personal row's values. Never echo tool output.
    throw new Error(
      `${program} failed, exit ${result.status}; suppressed output sha256=${sha(`${result.stdout ?? ""}${result.stderr ?? ""}`)}`,
    );
  }
  return result.stdout;
}
const docker = (...args: string[]) => {
  assert.ok(
    dockerHost?.startsWith("unix:///"),
    "Docker must use a local Unix socket",
  );
  return command("docker", ["--host", dockerHost, ...args]);
};

type Journal = { entries: { idx: number; tag: string; when: number }[] };
type Baseline = Journal & { sha256: Record<string, string> };
type Columns = Record<string, string[]>;
type Fingerprints = Record<string, { rows: number; sha256: string }>;

export function forwardConstraintNames(sql: string): string[] {
  return [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)]
    .map((match) => {
      // PostgreSQL truncates identifiers to 63 bytes; these generated names are ASCII.
      assert.match(match[1], /^[a-z0-9_]+$/);
      return match[1].slice(0, 63);
    })
    .sort();
}

async function ledger(
  client: Client,
  entries: Journal["entries"],
  baseline: Baseline,
) {
  const { rows } = await client.query(
    "SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
  );
  assert.equal(rows.length, entries.length, "migration ledger length");
  for (const [index, entry] of entries.entries()) {
    const hash = sha(
      readFileSync(resolve(migrationDirectory, `${entry.tag}.sql`)),
    );
    if (index < baseline.entries.length)
      assert.equal(
        hash,
        baseline.sha256[`${entry.tag}.sql`],
        `baseline SQL ${entry.tag}`,
      );
    assert.equal(rows[index].hash, hash, `ledger hash ${entry.tag}`);
    assert.equal(
      rows[index].created_at,
      String(entry.when),
      `ledger timestamp ${entry.tag}`,
    );
  }
  emit("ledger", {
    rows: rows.length,
    latest: entries.at(-1)?.tag,
    sha256: sha(JSON.stringify(rows)),
  });
  return rows;
}

async function originalColumns(client: Client): Promise<Columns> {
  const { rows } = await client.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE \"C\", ordinal_position",
  );
  const columns: Columns = {};
  for (const row of rows)
    (columns[row.table_name] ??= []).push(row.column_name);
  return columns;
}

async function fingerprints(
  client: Client,
  columns: Columns,
): Promise<Fingerprints> {
  const hashes: Fingerprints = {};
  // Values remain in memory. Server-side JSON text preserves numeric precision and
  // timestamp precision; C collation orders whole rows even for tables without PKs.
  for (const [table, names] of Object.entries(columns)) {
    const { rows } = await client.query(
      `SELECT row_to_json(original)::text AS row FROM (SELECT ${names.map(quote).join(",")} FROM public.${quote(table)}) original ORDER BY row_to_json(original)::text COLLATE "C"`,
    );
    const hash = createHash("sha256");
    for (const row of rows)
      hash.update(`${Buffer.byteLength(row.row)}:${row.row}\n`);
    hashes[table] = { rows: rows.length, sha256: hash.digest("hex") };
  }
  return hashes;
}

async function inspectLegacy(client: Client) {
  const statuses =
    await client.query(`SELECT status, condition, count(*)::int AS rows,
    count(approved_at)::int AS approved_timestamp, count(completed_at)::int AS completed_timestamp,
    count(approved_by_id)::int AS approval_actor FROM sales_returns GROUP BY status, condition ORDER BY status, condition`);
  // Do not print unrecognized free text, even if it occupies a status/condition column.
  const known = statuses.rows.every(
    (row) =>
      ["pending", "approved", "completed", "rejected"].includes(row.status) &&
      ["good", "damaged", "expired"].includes(row.condition),
  );
  if (!known)
    throw new Error(
      "Unknown legacy return status/condition; inspection stopped without printing free text",
    );
  emit("legacy_statuses", statuses.rows);
  const quantities = await client.query(`SELECT count(*)::int AS items,
    coalesce(sum(r.cartons_returned),0)::text AS cartons_returned, coalesce(sum(r.quantity_returned),0)::text AS loose_returned,
    count(*) FILTER (WHERE i.id IS NULL)::int AS missing_invoice_item,
    count(*) FILTER (WHERE i.packs_per_carton IS NULL OR i.packs_per_carton <= 0)::int AS missing_pack_snapshot,
    count(*) FILTER (WHERE r.cartons_returned < 0 OR r.quantity_returned < 0)::int AS negative_quantities,
    coalesce(sum(r.cartons_returned * i.packs_per_carton + r.quantity_returned),0)::text AS units_from_invoice_snapshot
    FROM sales_return_items r LEFT JOIN invoice_items i ON i.id = r.invoice_item_id`);
  emit("legacy_quantities", {
    provenance:
      "original cartons_returned + quantity_returned, multiplier from invoice_items.packs_per_carton; no new counters inferred",
    ...quantities.rows[0],
  });
  const traces = await client.query(
    "SELECT count(*)::int AS rows, coalesce(sum(total_units_moved),0)::text AS units_moved FROM sales_return_stock_traces",
  );
  emit("legacy_stock_traces", traces.rows[0]);
  const fk = await client.query(
    `SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.invoices'::regclass AND contype='f' AND pg_get_constraintdef(oid) LIKE '%offline_sales_slot_id%' ORDER BY conname`,
  );
  const orphans = await client.query(
    `SELECT count(*)::int AS linked, count(*) FILTER (WHERE s.id IS NULL)::int AS orphans FROM invoices i LEFT JOIN offline_sales_invoice_slots s ON s.id=i.offline_sales_slot_id WHERE i.offline_sales_slot_id IS NOT NULL`,
  );
  emit("legacy_invoice_slot", { foreignKeys: fk.rows, ...orphans.rows[0] });
  assert.equal(orphans.rows[0].orphans, 0, "pre-existing invoice-slot orphans");
  assert.equal(
    quantities.rows[0].missing_invoice_item,
    0,
    "legacy return item orphans",
  );
  assert.equal(
    quantities.rows[0].missing_pack_snapshot,
    0,
    "unknown legacy quantity provenance",
  );
  assert.equal(
    quantities.rows[0].negative_quantities,
    0,
    "negative legacy quantities",
  );
}

// Read schema only, never data, ownership, ACLs or sequence current values.
function schema(container: string, database: string, target: string): string {
  const url = validateLocalTestUrl(target);
  assert.equal(url.pathname.slice(1), database);
  return docker(
    "exec",
    container,
    "pg_dump",
    "-U",
    "runner",
    "-d",
    database,
    "--schema-only",
    "--no-owner",
    "--no-privileges",
  )
    .split("\n")
    .filter(
      (line) => !line.startsWith("--") && !line.startsWith("\\") && line.trim(),
    )
    .join("\n");
}

function equalSchema(expected: string, actual: string, phase: string) {
  if (expected !== actual) {
    const a = new Set(expected.split("\n"));
    const b = new Set(actual.split("\n"));
    emit(`${phase}_drift`, {
      expected_sha256: sha(expected),
      actual_sha256: sha(actual),
      missing: [...a].filter((line) => !b.has(line)),
      extra: [...b].filter((line) => !a.has(line)),
    });
    throw new Error(
      `${phase}: pre-existing or final schema drift; no reconciliation attempted`,
    );
  }
  emit(phase, { sha256: sha(actual), identical: true });
}

async function fixtureChecks(client: Client, forwardSql: string) {
  // Clones retain the actual migrated defaults/checks/indexes. Add the actual new
  // FK definitions unchanged. No personal data or application seeds are copied.
  const tables = [
    ...new Set(
      [...forwardSql.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  const snapshot = JSON.parse(
    readFileSync(
      resolve(migrationDirectory, "meta/0026_snapshot.json"),
      "utf8",
    ),
  );
  let checks = 0;
  await client.query("BEGIN");
  try {
    // PostgreSQL forbids temporary-table FKs to permanent tables. A transactional
    // schema in the separate synthetic database permits the unchanged public FKs.
    await client.query(
      "CREATE SCHEMA migration_fixture; SET LOCAL search_path = migration_fixture, public",
    );
    for (const table of tables) {
      const temp = `fixture_${table}`;
      await client.query(
        `CREATE TABLE migration_fixture.${quote(temp)} (LIKE public.${quote(table)} INCLUDING ALL)`,
      );
      const fks = await client.query(
        "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",
        [`public.${table}`],
      );
      const added = fks.rows.filter((row) =>
        forwardConstraintNames(forwardSql).includes(row.conname),
      );
      const columns = snapshot.tables[`public.${table}`].columns as Record<
        string,
        { type: string; notNull: boolean; default?: unknown }
      >;
      const values: Record<string, unknown> = {};
      for (const [name, column] of Object.entries(columns)) {
        if (!column.notNull || "default" in column || column.type === "serial")
          continue;
        values[name] =
          column.type === "jsonb"
            ? "{}"
            : column.type.includes("timestamp")
              ? "2026-01-01"
              : column.type.includes("numeric") || column.type === "integer"
                ? 1
                : "fixture";
      }
      async function insert(
        overrides: Record<string, unknown>,
        constraint?: string,
        code?: string,
      ) {
        await client.query("SAVEPOINT fixture_case");
        try {
          const row = { ...values, ...overrides };
          await client.query(
            `INSERT INTO ${quote(temp)} (${Object.keys(row).map(quote).join(",")}) VALUES (${Object.keys(
              row,
            )
              .map((_, i) => `$${i + 1}`)
              .join(",")})`,
            Object.values(row),
          );
          assert.equal(
            constraint,
            undefined,
            `expected rejection by ${constraint}`,
          );
        } catch (error) {
          if (!constraint) throw error;
          const pg = error as { code?: string; constraint?: string };
          assert.equal(pg.code, code, `fixture SQLSTATE ${constraint}`);
          assert.equal(pg.constraint, constraint, "fixture constraint");
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT fixture_case");
        }
        checks++;
      }
      await insert({});
      for (const fk of added) {
        // Test each FK independently, so another missing synthetic parent cannot
        // mask the named FK being checked. Checks/defaults stay enabled throughout.
        await client.query(
          `ALTER TABLE ${quote(temp)} ADD CONSTRAINT ${quote(fk.conname)} ${fk.definition}`,
        );
        const column = /FOREIGN KEY \(([^)]+)\)/
          .exec(fk.definition)?.[1]
          .replaceAll('"', "");
        assert.ok(column, "single-column new FK");
        const metadata =
          table === "purchase_records"
            ? {
                voided_at: "2026-01-01",
                voided_by_id: "missing_fixture_parent",
                void_reason: "fixture",
                void_refund_amount: 1,
                paid_amount: 1,
                void_refund_wallet_id: "missing_fixture_parent",
                void_snapshot: "{}",
              }
            : {};
        await insert(
          { ...metadata, [column]: "missing_fixture_parent" },
          fk.conname,
          "23503",
        );
        await client.query(
          `ALTER TABLE ${quote(temp)} DROP CONSTRAINT ${quote(fk.conname)}`,
        );
      }
      if (table === "packaging_materials")
        await insert(
          { packaging_kind: "invalid" },
          "packaging_materials_kind_check",
          "23514",
        );
      if (table === "offline_sales_staged_invoices") {
        await insert(
          { invoice_discount: -1 },
          "offline_sales_staged_extras_check",
          "23514",
        );
        await insert(
          { expenses: -1 },
          "offline_sales_staged_extras_check",
          "23514",
        );
      }
      if (table === "offline_sales_staged_items")
        await insert(
          { manual_free_cartons: -1 },
          "offline_sales_staged_items_manual_free_check",
          "23514",
        );
      if (table === "purchase_records") {
        await insert(
          {
            paid_amount: 5,
            void_refund_amount: 6,
            voided_at: "2026-01-01",
            voided_by_id: "fixture",
            void_reason: "fixture",
            void_refund_wallet_id: "fixture",
            void_snapshot: "{}",
          },
          "purchase_void_refund_bounds",
          "23514",
        );
        await insert(
          { void_reason: "incomplete" },
          "purchase_void_metadata",
          "23514",
        );
      }
    }
    await client.query(
      "INSERT INTO sales_return_reasons (id, name) VALUES ('fixture_reason', 'fixture_reason')",
    );
    await client.query("SAVEPOINT duplicate_reason");
    try {
      await client.query(
        "INSERT INTO sales_return_reasons (id, name) VALUES ('fixture_reason_2', 'fixture_reason')",
      );
      assert.fail("reason uniqueness must reject duplicates");
    } catch (error) {
      assert.equal((error as { code?: string }).code, "23505");
    }
    checks++;
    emit("fixture_checks", {
      passed: checks,
      scope:
        "migrated check/default/index clones and all new FK definitions, separate fixture database",
    });
  } catch (error) {
    // This function runs only on synthetic fixtures, never on the restored copy.
    emit("synthetic_fixture_failure", {
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    });
    throw error;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function main() {
  const [backup, expectedHash, ...extra] = process.argv.slice(2);
  assert.ok(
    backup && /^[a-f0-9]{64}$/.test(expectedHash ?? "") && !extra.length,
    "usage: BACKUP SHA256",
  );
  assert.equal(
    statSync(backup).mode & 0o777,
    0o600,
    "backup must be owner-only",
  );
  assert.equal(
    statSync(dirname(backup)).mode & 0o777,
    0o700,
    "backup directory must be owner-only",
  );
  const dump = readFileSync(backup);
  assert.equal(sha(dump), expectedHash, "backup SHA256");
  const baseline = JSON.parse(
    readFileSync(resolve(root, "src/db/migration-baseline.json"), "utf8"),
  ) as Baseline;
  const journal = JSON.parse(
    readFileSync(resolve(migrationDirectory, "meta/_journal.json"), "utf8"),
  ) as Journal;
  assert.equal(baseline.entries.length, 26);
  assert.equal(journal.entries.length, 27);
  assert.deepEqual(journal.entries.slice(0, 26), baseline.entries);
  for (const [file, hash] of Object.entries(baseline.sha256)) {
    if (file !== "meta/_journal.json")
      assert.equal(
        sha(readFileSync(resolve(migrationDirectory, file))),
        hash,
        `baseline artifact ${file}`,
      );
  }
  const image = "postgres:18.3-alpine3.23";
  dockerHost = command("docker", [
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]).trim();
  assert.ok(dockerHost.startsWith("unix:///"), "refuse remote Docker endpoint");
  docker("image", "inspect", image); // Fail instead of pulling.
  const suffix = randomBytes(8).toString("hex");
  const container = `titan-migration-${suffix}`;
  const network = `${container}-network`;
  const password = randomBytes(24).toString("hex");
  let ownsNetwork = false;
  let ownsContainer = false;
  try {
    // Docker Desktop exposes no published ports on an --internal network. Use a
    // run-owned bridge with no peers and an explicit loopback-only publication.
    docker("network", "create", "--driver", "bridge", network);
    ownsNetwork = true;
    docker(
      "create",
      "--pull=never",
      "--name",
      container,
      "--network",
      network,
      // PG18's entrypoint chowns PGDATA, not its parent. The parent must remain
      // traversable after it drops root; PGDATA itself is created mode 0700.
      "--publish",
      "127.0.0.1::5432",
      "--mount",
      "type=tmpfs,destination=/var/lib/postgresql,tmpfs-mode=0755",
      "--env",
      "POSTGRES_USER=runner",
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      "POSTGRES_DB=titan_admin_test",
      image,
    );
    ownsContainer = true;
    docker("start", container);
    const details = JSON.parse(docker("inspect", container))[0];
    emit("container_startup", {
      status: details.State.Status,
      exitCode: details.State.ExitCode,
      ports: details.NetworkSettings.Ports,
      mounts: details.Mounts.map(
        (mount: { Type: string; Destination: string }) => ({
          type: mount.Type,
          destination: mount.Destination,
        }),
      ),
    });
    assert.equal(
      details.HostConfig.PortBindings["5432/tcp"][0].HostIp,
      "127.0.0.1",
    );
    assert.ok(
      details.Mounts.every((mount: { Type: string }) => mount.Type === "tmpfs"),
      "no persistent volumes",
    );
    const bindings = details.NetworkSettings.Ports["5432/tcp"];
    assert.ok(
      bindings?.length === 1 && bindings[0].HostIp === "127.0.0.1",
      "require exactly one loopback published port",
    );
    const port = bindings[0].HostPort;
    const target = (database: string) => {
      const raw = `postgresql://runner:${password}@127.0.0.1:${port}/${database}`;
      validateLocalTestUrl(raw);
      return raw;
    };
    // pg_isready waits inside the run-owned container, not on an ambient database.
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      // The image's bootstrap server accepts Unix sockets before shutting down;
      // TCP readiness selects only the final server, not that temporary server.
      const probe = spawnSync(
        "docker",
        [
          "--host",
          dockerHost,
          "exec",
          container,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "runner",
          "-d",
          "titan_admin_test",
        ],
        { env: environment },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    if (!ready) {
      // This is strictly before restore, so startup logs cannot contain source rows.
      const startup = spawnSync(
        "docker",
        ["--host", dockerHost, "logs", container],
        { env: environment, encoding: "utf8" },
      );
      emit(
        "empty_container_startup_failure",
        `${startup.stdout}${startup.stderr}`.replaceAll(password, "[redacted]"),
      );
      assert.fail("local PostgreSQL startup timeout");
    }
    const databases = [
      "titan_upgrade_test",
      "titan_baseline_test",
      "titan_clean_test",
      "titan_fixture_test",
    ];
    await withLocalClient(target("titan_admin_test"), async (client) => {
      for (const database of databases) {
        validateLocalTestUrl(target(database));
        await client.query(
          `CREATE DATABASE ${quote(database)} TEMPLATE template0`,
        );
      }
    });
    emit("isolation", {
      container,
      network,
      image,
      loopback: true,
      tmpfs: true,
      databases,
    });
    validateLocalTestUrl(target("titan_upgrade_test"));
    command(
      "docker",
      [
        "--host",
        dockerHost,
        "exec",
        "-i",
        container,
        "pg_restore",
        "-U",
        "runner",
        "-d",
        "titan_upgrade_test",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
      ],
      dump,
    );
    emit("restore", { backup_sha256: expectedHash, owner_acl_free: true });
    const migrate = (database: string) => {
      const url = target(database);
      command("bun", ["--no-env-file", "run", "db:migrate:test"], undefined, {
        ...environment,
        DATABASE_URL: url,
      } as typeof environment);
    };
    await withLocalClient(target("titan_upgrade_test"), async (upgraded) => {
      await ledger(upgraded, baseline.entries, baseline);
      await inspectLegacy(upgraded);
      const columns = await originalColumns(upgraded);
      const before = await fingerprints(upgraded, columns);
      emit("original_data_before", before);
      // Independently replay baseline with Drizzle's own dialect/session, without
      // writing a truncated journal or manually inserting migration-history rows.
      await withLocalClient(target("titan_baseline_test"), async (clean) => {
        const dialect = new PgDialect();
        await dialect.migrate(
          readMigrationFiles({ migrationsFolder: migrationDirectory }).slice(
            0,
            26,
          ),
          new NodePgSession(clean, dialect, undefined),
          { migrationsFolder: migrationDirectory },
        );
        await ledger(clean, baseline.entries, baseline);
      });
      equalSchema(
        schema(container, "titan_baseline_test", target("titan_baseline_test")),
        schema(container, "titan_upgrade_test", target("titan_upgrade_test")),
        "baseline_schema",
      );
      migrate("titan_upgrade_test");
      const afterLedger = await ledger(upgraded, journal.entries, baseline);
      const after = await fingerprints(upgraded, columns);
      assert.deepEqual(
        after,
        before,
        "original-column data changed on upgrade",
      );
      emit("original_data_after", {
        tables: Object.keys(after).length,
        sha256: sha(JSON.stringify(after)),
        unchanged: true,
      });
      const upgradedSchema = schema(
        container,
        "titan_upgrade_test",
        target("titan_upgrade_test"),
      );
      const allColumns = await originalColumns(upgraded);
      const allAfter = await fingerprints(upgraded, allColumns);
      migrate("titan_upgrade_test");
      assert.deepEqual(
        await ledger(upgraded, journal.entries, baseline),
        afterLedger,
      );
      assert.deepEqual(await fingerprints(upgraded, columns), before);
      assert.deepEqual(await fingerprints(upgraded, allColumns), allAfter);
      assert.equal(
        schema(container, "titan_upgrade_test", target("titan_upgrade_test")),
        upgradedSchema,
      );
      emit("noop", { ledger: true, allData: true, schema: true });
      // Both are still empty: independent full-chain clean install and fixture DB.
      migrate("titan_clean_test");
      await withLocalClient(target("titan_clean_test"), async (clean) => {
        await ledger(clean, journal.entries, baseline);
        equalSchema(
          schema(container, "titan_clean_test", target("titan_clean_test")),
          upgradedSchema,
          "full_chain_schema",
        );
      });
      migrate("titan_fixture_test");
      await withLocalClient(target("titan_fixture_test"), async (fixture) => {
        await ledger(fixture, journal.entries, baseline);
        equalSchema(
          schema(container, "titan_fixture_test", target("titan_fixture_test")),
          upgradedSchema,
          "fixture_schema",
        );
        const forwardSql = readFileSync(
          resolve(migrationDirectory, `${journal.entries[26].tag}.sql`),
          "utf8",
        );
        const expectedConstraints = forwardConstraintNames(forwardSql);
        const constraints = await upgraded.query(
          "SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname=ANY($1::text[]) ORDER BY conname",
          [expectedConstraints],
        );
        assert.deepEqual(
          constraints.rows.map((row) => row.conname),
          expectedConstraints,
        );
        const expectedIndexes = [
          ...forwardSql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g),
        ]
          .map((match) => match[1])
          .sort();
        const indexes = await upgraded.query(
          "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indisvalid AND c.relname=ANY($1::text[]) ORDER BY c.relname",
          [expectedIndexes],
        );
        assert.deepEqual(
          indexes.rows.map((row) => row.relname),
          expectedIndexes,
        );
        const expectedColumns = [
          ...forwardSql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g),
        ];
        for (const [, table, column] of expectedColumns)
          assert.ok(
            allColumns[table].includes(column),
            `new column ${table}.${column}`,
          );
        emit("new_schema", {
          columns: expectedColumns.length,
          validatedConstraints: expectedConstraints.length,
          validIndexes: expectedIndexes.length,
        });
        await fixtureChecks(fixture, forwardSql);
      });
    });
    emit("verification", "passed");
  } finally {
    try {
      if (ownsContainer) {
        docker("rm", "--force", container);
        emit("cleanup_container", { removed: container });
      }
    } finally {
      if (ownsNetwork) {
        docker("network", "rm", network);
        emit("cleanup_network", { removed: network });
      }
      assert.equal(
        sha(readFileSync(backup)),
        expectedHash,
        "original backup changed",
      );
      emit("backup_unchanged", true);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    // Never print pg's detail, query values or connection strings.
    emit(
      "failure",
      error instanceof assert.AssertionError
        ? { message: error.message, code: error.code }
        : {
            message: (error as { code?: string }).code
              ? "PostgreSQL operation failed"
              : (error as Error).message,
            code: (error as { code?: string }).code,
          },
    );
    process.exitCode = 1;
  });
}
