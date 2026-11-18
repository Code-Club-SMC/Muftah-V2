import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_BACKFILLS,
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLE_SEEDS,
} from "@/lib/rbac";

describe("credit notes & refund RBAC contract", () => {
  it("defines finance.refunds.issue as a finance action permission", () => {
    expect(PERMISSION_KEYS).toContain("finance.refunds.issue");
    const def = PERMISSION_DEFINITIONS.find((p) => p.key === "finance.refunds.issue");
    expect(def).toMatchObject({
      key: "finance.refunds.issue",
      moduleKey: "finance",
      kind: "action",
      label: "Issue customer refunds",
    });
  });

  it("seeds finance.refunds.issue on admin and finance-manager roles", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((r) => r.slug === "admin")!;
    const financeManager = SYSTEM_ROLE_SEEDS.find((r) => r.slug === "finance-manager")!;
    expect(admin.permissionKeys).toContain("finance.refunds.issue");
    expect(financeManager.permissionKeys).toContain("finance.refunds.issue");
  });

  it("configures multi-source backfill for finance.refunds.issue and supports array sources in authz.server.ts", () => {
    expect(PERMISSION_BACKFILLS["finance.refunds.issue"]).toEqual([
      "finance.manage",
      "inventory.returns.receive",
    ]);
    const authz = readFileSync(resolve(process.cwd(), "src/lib/authz.server.ts"), "utf8");
    expect(authz).toContain("Array.isArray(sourceKey)");
    expect(authz).toContain("inArray(appRolePermissions.permissionId");
  });

  it("exposes requireFinanceRefundsIssueMiddleware and requireFinancePaymentReversalOrManageMiddleware", () => {
    const middlewares = readFileSync(resolve(process.cwd(), "src/lib/middlewares.ts"), "utf8");
    expect(middlewares).toContain('requireFinanceRefundsIssueMiddleware = createPermissionMiddleware(\n  "finance.refunds.issue",');
    expect(middlewares).toContain("requireFinancePaymentReversalOrManageMiddleware");
    expect(middlewares).toContain('"finance.payments.reverse"');
    expect(middlewares).toContain('"finance.manage"');
  });
});
