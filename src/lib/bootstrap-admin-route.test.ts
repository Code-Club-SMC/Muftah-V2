import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bootstrap admin route", () => {
  it("creates the first bootstrap user through Better Auth createUser with a super-admin role", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/routes/api/internal/bootstrap-admin.ts"),
      "utf8",
    );

    expect(source).toContain("auth.api.createUser");
    expect(source).toContain('role: "super-admin"');
    expect(source).not.toContain("auth.api.signUpEmail");
    expect(source).toContain("accountId: userId");
    expect(source).not.toContain("accountId: email");
  });
});
