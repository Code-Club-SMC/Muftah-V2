import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authzSource = readFileSync(
  resolve(process.cwd(), "src/lib/authz.server.ts"),
  "utf8",
);

describe("rbac seed synchronization", () => {
  it("adds only missing system role grants instead of skipping roles with existing permissions", () => {
    expect(authzSource).not.toContain("existingPermissionCount");
    expect(authzSource).not.toContain("existingPermissionCount.length > 0");
    expect(authzSource).toContain("existingPermissionIds");
    expect(authzSource).toContain("missingPermissionIds");
    expect(authzSource).toContain(".onConflictDoNothing()");
  });
});
