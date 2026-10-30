import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_DEFINITIONS, PERMISSION_KEYS, SYSTEM_ROLE_SEEDS, canAccessPath } from "@/lib/rbac";

describe("production loss access", () => {
  it("adds view and limits permissions under reports", () => {
    expect(PERMISSION_KEYS).toEqual(expect.arrayContaining(["reports.loss.view", "reports.loss.limits.manage"]));
    const view = PERMISSION_DEFINITIONS.find((p) => p.key === "reports.loss.view");
    const manage = PERMISSION_DEFINITIONS.find((p) => p.key === "reports.loss.limits.manage");
    expect([view?.moduleKey, view?.kind, view?.routePattern]).toEqual(["reports", "route", "/reports/production-loss"]);
    expect([manage?.moduleKey, manage?.kind]).toEqual(["reports", "action"]);
  });
  it("gives admin both permissions", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin");
    expect(admin?.permissionKeys).toEqual(expect.arrayContaining(["reports.loss.view", "reports.loss.limits.manage"]));
  });
  it("locks the page to the loss permission, not the general reports one", () => {
    expect(canAccessPath("/reports/production-loss", ["reports.view"])).toBe(false);
    expect(canAccessPath("/reports/production-loss", ["reports.loss.view"])).toBe(true);
    expect(canAccessPath("/reports/sales", ["reports.view"])).toBe(true);
  });
  it("has middleware for both permissions and a single-row limits table", () => {
    const middlewares = readFileSync("src/lib/middlewares.ts", "utf8");
    expect(middlewares).toMatch(/requireLossReportViewMiddleware = createPermissionMiddleware\(\s*"reports\.loss\.view"/);
    expect(middlewares).toMatch(/requireLossLimitsManageMiddleware = createPermissionMiddleware\(\s*"reports\.loss\.limits\.manage"/);
    const schema = readFileSync("src/db/schemas/production-schema.ts", "utf8");
    expect(schema).toContain('pgTable("production_loss_limits"');
    expect(schema).toContain('PRODUCTION_LOSS_LIMITS_ID = "default"');
  });
});
