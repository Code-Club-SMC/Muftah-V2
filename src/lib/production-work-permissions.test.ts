import { describe, expect, it, vi } from "vitest";
import { SYSTEM_ROLE_SEEDS } from "./rbac";

// Execute the real permission callbacks with role seed permissions. Session
// resolution is independent and is stubbed so these checks need no database.
vi.mock("@tanstack/react-start", () => ({ createMiddleware: () => {
  const builder = { middleware: () => builder, server: (handler: unknown) => handler };
  return builder;
} }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => undefined }));
vi.mock("./authz.server", () => ({ getAuthContext: vi.fn(), requirePermission: vi.fn() }));

import { requireProductionWorkReadMiddleware, requireProductionWorkLogMiddleware,
  requireProductionWorkCompleteMiddleware, requireProductionWorkFailMiddleware } from "./middlewares";

function invoke(middleware: unknown, permissions: string[] | null) {
  const context = { authContext: permissions ? { permissions: new Set(permissions), session: { user: { id: "operator" } } } : null };
  return (middleware as (input: unknown) => Promise<unknown>)({ context, next: async () => "allowed" });
}

describe("production work middleware", () => {
  const operator = SYSTEM_ROLE_SEEDS.find(role => role.slug === "operator")!;
  const checks = [requireProductionWorkReadMiddleware, requireProductionWorkLogMiddleware,
    requireProductionWorkCompleteMiddleware, requireProductionWorkFailMiddleware];
  it.each(checks.map((middleware, index) => ({ middleware, index })))("allows the Operator role for action $index", async ({ middleware }) => {
    await expect(invoke(middleware, operator.permissionKeys)).resolves.toBe("allowed");
  });
  it.each(checks.map((middleware, index) => ({ middleware, index })))("rejects missing permissions and unauthenticated context for action $index", async ({ middleware }) => {
    await expect(invoke(middleware, [])).rejects.toThrow();
    await expect(invoke(middleware, null)).rejects.toThrow();
    await expect(invoke(middleware, ["manufacturing.run.manage", "manufacturing.run.read"])).resolves.toBe("allowed");
  });
});
