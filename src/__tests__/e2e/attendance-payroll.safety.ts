import assert from "node:assert/strict";

export function assertLocalPayrollPostgresUrl(value: string) {
  const url = new URL(value);
  assert(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  assert(["localhost", "127.0.0.1"].includes(url.hostname), "Payroll E2E requires local PostgreSQL");
  assert.equal(url.port, "5433", "Payroll E2E requires port 5433");
  for (const [key, entry] of url.searchParams) {
    assert(["sslmode", "application_name"].includes(key), "Connection query overrides are forbidden");
    if (key === "sslmode") assert.equal(entry, "disable", "Local test TLS override must be disable");
  }
  return url;
}

export function assertPayrollTestUrl(value: string) {
  const url = assertLocalPayrollPostgresUrl(value);
  assert(/^\/titan_payroll_(e2e|real)_[a-z0-9]+_test$/.test(url.pathname), "Payroll E2E requires a run-owned _test database; main is forbidden");
  return url;
}
