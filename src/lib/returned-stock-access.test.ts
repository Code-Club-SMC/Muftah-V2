import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_BACKFILLS, PERMISSION_DEFINITIONS, PERMISSION_KEYS, SYSTEM_ROLE_SEEDS } from "@/lib/rbac";

describe("returned stock disposal permission", () => {
  it("defines dispose as an inventory action", () => {
    expect(PERMISSION_KEYS).toContain("inventory.returns.dispose");
    const definition = PERMISSION_DEFINITIONS.find((permission) => permission.key === "inventory.returns.dispose");
    expect(definition).toMatchObject({ moduleKey: "inventory", kind: "action", label: "Dispose returned stock" });
  });

  it("gives it to admin and once to everyone who can receive returns", () => {
    const admin = SYSTEM_ROLE_SEEDS.find((role) => role.slug === "admin")!;
    expect(admin.permissionKeys).toContain("inventory.returns.dispose");
    expect(PERMISSION_BACKFILLS["inventory.returns.dispose"]).toBe("inventory.returns.receive");
  });

  it("exposes a middleware for it", () => {
    const middlewares = readFileSync(resolve(process.cwd(), "src/lib/middlewares.ts"), "utf8");
    expect(middlewares).toContain('requireReturnsDisposeMiddleware = createPermissionMiddleware(\n  "inventory.returns.dispose",');
  });
});
