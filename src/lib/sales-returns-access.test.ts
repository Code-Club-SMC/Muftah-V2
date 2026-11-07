import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_BACKFILLS, PERMISSION_DEFINITIONS, PERMISSION_KEYS, SYSTEM_ROLE_SEEDS } from "@/lib/rbac";

const KEYS = ["sales.returns.create", "sales.returns.approve", "inventory.returns.receive"] as const;

describe("sales return permissions", () => {
  it("defines create, approve and receive as actions", () => {
    expect(PERMISSION_KEYS).toEqual(expect.arrayContaining([...KEYS]));
    for (const key of KEYS) {
      const definition = PERMISSION_DEFINITIONS.find((permission) => permission.key === key);
      expect(definition?.kind).toBe("action");
    }
    expect(PERMISSION_DEFINITIONS.find((p) => p.key === "inventory.returns.receive")?.moduleKey).toBe("inventory");
  });

  it("gives admin all three and finance manager create and approve", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin")!;
    const finance = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "finance-manager")!;
    expect(admin.permissionKeys).toEqual(expect.arrayContaining([...KEYS]));
    expect(finance.permissionKeys).toEqual(expect.arrayContaining(["sales.returns.create", "sales.returns.approve"]));
    expect(finance.permissionKeys).not.toContain("inventory.returns.receive");
  });

  it("backfills existing roles once from the rights they already hold", () => {
    expect(PERMISSION_BACKFILLS).toEqual({
      "sales.returns.create": "sales.manage",
      "sales.returns.approve": "sales.manage",
      "inventory.returns.receive": "inventory.manage",
    });
    const authz = readFileSync(resolve(process.cwd(), "src/lib/authz.server.ts"), "utf8");
    expect(authz).toContain("PERMISSION_BACKFILLS");
    expect(authz).toContain("existingPermissionKeys.has(newKey)");
  });

  it("exposes one middleware per right", () => {
    const middlewares = readFileSync(resolve(process.cwd(), "src/lib/middlewares.ts"), "utf8");
    expect(middlewares).toContain('requireSalesReturnsCreateMiddleware = createPermissionMiddleware(\n  "sales.returns.create",');
    expect(middlewares).toContain('requireSalesReturnsApproveMiddleware = createPermissionMiddleware(\n  "sales.returns.approve",');
    expect(middlewares).toContain('requireReturnsReceiveMiddleware = createPermissionMiddleware(\n  "inventory.returns.receive",');
  });
});
