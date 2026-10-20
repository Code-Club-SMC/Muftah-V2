import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertLocalPayrollPostgresUrl, assertPayrollTestUrl } from "./attendance-payroll.safety";
import { MANDATORY_CASES, CYCLE } from "./attendance-payroll.fixtures";

const runId = randomBytes(8).toString("hex");
const evidence = resolve("docs/superpowers/reviews/attendance-payroll", runId);
const privateRoot = resolve(".tmp/attendance-payroll", runId);
const retain = process.argv.includes("--retain-on-failure");
const prepareOnly = process.argv.includes("--prepare-only");
const reuseBuild = process.argv.includes("--reuse-build");
const scenarioOption = process.argv.find(value => value.startsWith("--scenario="))?.split("=")[1];
assert(!scenarioOption || ["controlled", "real"].includes(scenarioOption), "Scenario must be controlled or real");
const scenarios: ("controlled" | "real")[] = scenarioOption ? [scenarioOption as "controlled" | "real"] : ["controlled", "real"];
const baseUrl = "http://localhost:3101";
const report: Record<string, any> = {
  runId, startedAt: new Date().toISOString(), timezone: CYCLE.timezone,
  cycle: CYCLE, buildCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirtyBuild: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  status: "running", requestedScenarios: scenarios, limitedRun: Boolean(scenarioOption), scenarios: [], cleanup: [],
};
const adminUrl = assertLocalPayrollPostgresUrl(process.env.PAYROLL_E2E_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres");
assert.equal(adminUrl.pathname, "/postgres", "Admin URL must select postgres, never main");
adminUrl.searchParams.set("sslmode", "disable");
const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const owned: string[] = [];
let application: ChildProcess | undefined;
let applicationExit: Promise<void> | undefined;
const commonEnv = {
  ...process.env, TZ: CYCLE.timezone, NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3101",
  BETTER_AUTH_URL: baseUrl, BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
  ATTENDANCE_BROWSER_MODULE: process.env.ATTENDANCE_BROWSER_MODULE ?? resolve(".tmp/attendance-browser/node_modules/playwright"),
  ATTENDANCE_BROWSER_CHROME: process.env.ATTENDANCE_BROWSER_CHROME ?? "/usr/bin/google-chrome",
};
async function save() { await writeFile(resolve(evidence, "results.json"), JSON.stringify(report, null, 2)); }
async function fingerprint(files: string[]) {
  const hash = createHash("sha256");
  for (const file of files.sort()) { hash.update(file); hash.update(await readFile(file)); }
  return hash.digest("hex");
}
async function buildIdentity() {
  const sources = execFileSync("rg", ["--files", "src"], { encoding: "utf8" }).trim().split("\n").filter(file => !file.includes("/__tests__/") && !/\.test\.[^.]+$/.test(file));
  const outputs = execFileSync("rg", ["--files", "--hidden", "--no-ignore", ".output"], { encoding: "utf8" }).trim().split("\n");
  return { sourceSha256: await fingerprint([...sources, "package.json", "bun.lock", "vite.config.ts", "tsconfig.json"]), outputSha256: await fingerprint(outputs) };
}
async function command(label: string, executable: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`START ${label}`);
  const log = createWriteStream(resolve(evidence, `${label}.log`), { mode: 0o600 });
  const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  const code = await new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("exit", accept); });
  await new Promise<void>(accept => log.end(accept));
  assert.equal(code, 0, `${label} failed; see ${label}.log`);
  console.log(`PASS ${label}`);
}
async function stopApp() {
  if (!application) return;
  const child = application;
  if (child.exitCode === null) child.kill("SIGTERM");
  const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 8000);
  try { await applicationExit; } finally { clearTimeout(timer); application = undefined; }
}
async function startApp(env: NodeJS.ProcessEnv, scenario: string) {
  const log = createWriteStream(resolve(evidence, `${scenario}-application.log`), { mode: 0o600 });
  application = spawn("node", [".output/server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  application.stdout!.pipe(log); application.stderr!.pipe(log);
  applicationExit = new Promise<void>((accept, reject) => {
    application!.once("error", reject);
    application!.once("exit", () => log.end(accept));
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(application.exitCode, null, "Production application exited during startup");
    try { if ((await fetch(baseUrl + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* starting */ }
    await new Promise(accept => setTimeout(accept, 300));
  }
  throw new Error("Production application health check timed out");
}

await mkdir(evidence, { recursive: true });
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
try {
  assert(new Date().toISOString().slice(0, 10) > CYCLE.end, "Runtime must be after 15 October 2026");
  // Do not attach to an unrelated process on the chosen test port.
  let occupied = false;
  try { await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* unused */ }
  assert(!occupied, "Port 3101 is already occupied");
  for (const scenario of scenarios) {
    const name = `titan_payroll_${scenario === "real" ? "real" : "e2e"}_${runId}_test`;
    const url = new URL(adminUrl); url.pathname = "/" + name;
    assertPayrollTestUrl(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`); owned.push(name);
    const pool = new Pool({ connectionString: url.toString() });
    try { await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" }); } finally { await pool.end(); }
    const directory = resolve(privateRoot, scenario);
    const scenarioEvidence = resolve(evidence, scenario);
    await mkdir(scenarioEvidence, { recursive: true });
    const env = { ...commonEnv, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(), PAYROLL_E2E_SCENARIO: scenario, PAYROLL_E2E_DIRECTORY: directory, PAYROLL_E2E_EVIDENCE: scenarioEvidence, PAYROLL_E2E_URL: baseUrl };
    report.scenarios.push({ scenario, database: name }); await save();
    await command(`${scenario}-setup`, "bun", ["src/__tests__/e2e/attendance-payroll.setup.ts"], env);
    if (prepareOnly) continue;
    if (scenario === scenarios[0]) {
      const identityPath = resolve(".tmp/attendance-payroll/build.json");
      let reused = false;
      if (reuseBuild) {
        try {
          const prior = JSON.parse(await readFile(identityPath, "utf8"));
          const current = await buildIdentity();
          reused = prior.sourceSha256 === current.sourceSha256 && prior.outputSha256 === current.outputSha256;
          if (reused) report.buildIdentity = { ...current, reused: true, originalBuildRun: prior.runId };
        } catch { /* No matching verified build: compile normally. */ }
      }
      if (!reused) {
        await command("build", "bun", ["run", "build"], env);
        const identity = { ...await buildIdentity(), runId };
        await writeFile(identityPath, JSON.stringify(identity, null, 2));
        report.buildIdentity = { ...identity, reused: false };
      }
      await save();
    }
    await startApp(env, scenario);
    await command(`${scenario}-browser`, "node", ["src/__tests__/e2e/attendance-payroll.browser.cjs"], env);
    await stopApp();
    await command(`${scenario}-integration`, "bun", ["run", "test", "--config", "vitest.integration.config.ts", "src/__tests__/integration/attendance-payroll.test.ts"], { ...env, NODE_ENV: "test" });
  }
  report.status = prepareOnly ? "preparation-only" : scenarioOption ? "partial" : "passed";
  if (!prepareOnly) {
    for (const scenario of scenarios) {
      for (const tier of ["browser", "integration"]) {
        const result = JSON.parse(await readFile(resolve(evidence, scenario, `${tier}-results.json`), "utf8"));
        assert.equal(result.passed, true, `${scenario} ${tier} did not pass`);
      }
    }
    const checks: any[] = [];
    for (const scenario of scenarios) for (const tier of ["browser", "integration"]) {
      const result = JSON.parse(await readFile(resolve(evidence, scenario, `${tier}-results.json`), "utf8"));
      checks.push(...result.checks);
    }
    report.coverage = MANDATORY_CASES.map(id => ({ id, passed: checks.some(check => check.caseIds?.includes(id) && check.passed) }));
    if (!scenarioOption) assert(report.coverage.every((entry: any) => entry.passed), "Mandatory acceptance case coverage is incomplete");
  }
} catch (error) {
  report.status = "failed";
  // Errors in this orchestrator never include connection strings or credentials.
  report.error = error instanceof Error ? error.message.replaceAll(adminUrl.password, "[redacted]") : "Unknown failure";
  process.exitCode = 1;
} finally {
  try { await stopApp(); } catch { report.cleanup.push({ application: "failed" }); process.exitCode = 1; }
  for (const name of owned) {
    const url = new URL(adminUrl); url.pathname = "/" + name;
    const pool = new Pool({ connectionString: assertPayrollTestUrl(url.toString()).toString() });
    try {
      await pool.query("DELETE FROM session");
      await pool.query('UPDATE "user" SET banned=true');
    } catch { report.cleanup.push({ database: name, revokeSessions: "failed" }); process.exitCode = 1; }
    finally { await pool.end(); }
    if (retain && (report.status === "failed" || prepareOnly)) {
      report.cleanup.push({ database: name, retained: true });
    } else {
      try {
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
        await admin.query(`DROP DATABASE "${name}"`);
        report.cleanup.push({ database: name, dropped: true });
      } catch { report.cleanup.push({ database: name, dropped: false }); process.exitCode = 1; }
    }
  }
  for (const scenario of ["controlled", "real"]) {
    const path = resolve(privateRoot, scenario, "credentials.json");
    try { await access(path); await unlink(path); } catch (error: any) { if (error.code !== "ENOENT") process.exitCode = 1; }
  }
  await admin.end();
  if (process.exitCode && report.status === "passed") report.status = "failed-cleanup";
  report.finishedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ status: report.status, evidence, cleanup: report.cleanup }));
}
