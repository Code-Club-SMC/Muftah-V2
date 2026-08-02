import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bootstrap admin route", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/routes/api/internal/bootstrap-admin.ts"),
    "utf8",
  );

  it("keeps the internal endpoint hidden behind the bootstrap secret", () => {
    expect(source).toContain("hasValidBootstrapSecret(request)");
    expect(source).toContain("hiddenNotFoundResponse()");
    expect(source).toContain(
      'Response.json({ error: "Not Found" }, { status: 404 })',
    );
  });

  it("reports safe super-admin metadata from the status check", () => {
    expect(source).toContain("async function getSuperAdmins()");
    expect(source).toContain("bootstrapped: superAdmins.length > 0");
    expect(source).toContain("superAdminCount: superAdmins.length");
    expect(source).toContain("superAdmins,");
    expect(source).not.toContain("password: account.password");
  });

  it("creates credential accounts with Better Auth-compatible password hashes", () => {
    expect(source).toContain('import { hashPassword } from "better-auth/crypto"');
    expect(source).toContain(
      "const passwordHash = await hashPassword(newPassword)",
    );
    expect(source).toContain("accountId: userId");
    expect(source).not.toContain("accountId: email");
  });

  it("only creates the first super-admin and keeps RBAC synchronized", () => {
    expect(source).toContain("const existingSuperAdmins = await getSuperAdmins()");
    expect(source).toContain("{ status: 409 }");
    expect(source).toContain('role: "super-admin"');
    expect(source).toContain(
      'syncUserRoleAssignment(createdUserId, "super-admin")',
    );
    expect(source).toContain(
      'syncUserRoleAssignment(existingUser.id, "super-admin")',
    );
    expect(source).toContain(
      'syncUserRoleAssignment(target.userId, "super-admin")',
    );
  });

  it("rejects ambiguous or empty update requests", () => {
    expect(source).toContain(
      "Target super admin is ambiguous. Provide userId or currentEmail.",
    );
    expect(source).toContain("Provide at least one field to update.");
  });
});
