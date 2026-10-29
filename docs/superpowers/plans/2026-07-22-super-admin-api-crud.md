# Super Admin API CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/internal/bootstrap-admin` the supported secured API surface for super-admin status, first-user creation, and update operations, with no package.json TypeScript bootstrap script.

**Architecture:** Keep the existing TanStack Start API route as the source of truth. Preserve direct server-side Better Auth-compatible user/account writes and DB-backed RBAC synchronization, while tightening the endpoint response and validation contract. Update source-inspection tests and curl documentation so future changes preserve this contract.

**Tech Stack:** TanStack Start file route, Better Auth credential hashing via `better-auth/crypto`, Drizzle ORM, PostgreSQL, Zod, Vitest source-inspection tests, Bun scripts.

## Global Constraints

- Do not add a package.json TypeScript bootstrap script.
- Every request to `/api/internal/bootstrap-admin` requires `x-bootstrap-secret`.
- Invalid or missing bootstrap secrets return `404 { "error": "Not Found" }`.
- `POST` creates or promotes the first super-admin only and returns `409` if any super-admin already exists.
- `PATCH` updates an existing super-admin and fails on ambiguous targets or empty updates.
- Delete and demotion are out of scope.
- Never return password hashes, account secrets, session tokens, or internal auth records.

---

## File Structure

- Modify `src/routes/api/internal/bootstrap-admin.ts`: return safe `superAdmins` metadata from `GET`; reject empty `PATCH` updates; keep existing creation/update helpers.
- Modify `src/lib/bootstrap-admin-route.test.ts`: replace stale expectations about `auth.api.createUser` with assertions for the actual direct Better Auth-compatible credential path and endpoint contract.
- Modify `docs/super-admin-curl-requests.md`: document the expanded `GET` response and the empty `PATCH` validation behavior.

---

### Task 1: Tighten Endpoint Contract

**Files:**
- Modify: `src/routes/api/internal/bootstrap-admin.ts`

**Interfaces:**
- Consumes: `getSuperAdmins(): Promise<Array<{ userId: string; email: string; name: string }>>`
- Produces: `GET` response with `bootstrapped`, `superAdminCount`, and `superAdmins`
- Produces: `PATCH` response `400 { "error": "Provide at least one field to update." }` when no update fields are supplied

- [ ] **Step 1: Update the `GET` response**

Replace the current successful `GET` response block:

```ts
return Response.json({
  bootstrapped: superAdmins.length > 0,
  superAdminCount: superAdmins.length,
});
```

with:

```ts
return Response.json({
  bootstrapped: superAdmins.length > 0,
  superAdminCount: superAdmins.length,
  superAdmins,
});
```

- [ ] **Step 2: Normalize the update email schema style**

Replace:

```ts
email: z.email().optional(),
```

with:

```ts
email: z.string().email().optional(),
```

- [ ] **Step 3: Reject empty `PATCH` update bodies**

After:

```ts
const data = parsed.data;
```

inside the `PATCH` handler, insert:

```ts
if (!data.name && !data.email && !data.password) {
  return invalidPayloadResponse("Provide at least one field to update.");
}
```

- [ ] **Step 4: Run focused test file**

Run:

```bash
bun run test src/lib/bootstrap-admin-route.test.ts
```

Expected before Task 2: FAIL, because the stale test still expects `auth.api.createUser`.

---

### Task 2: Update Source-Inspection Tests

**Files:**
- Modify: `src/lib/bootstrap-admin-route.test.ts`

**Interfaces:**
- Consumes: route source file at `src/routes/api/internal/bootstrap-admin.ts`
- Produces: Vitest assertions that enforce the secured endpoint contract

- [ ] **Step 1: Replace the stale test content**

Replace the file with:

```ts
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
    expect(source).toContain('Response.json({ error: "Not Found" }, { status: 404 })');
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
    expect(source).toContain("const passwordHash = await hashPassword(newPassword)");
    expect(source).toContain("accountId: userId");
    expect(source).not.toContain("accountId: email");
  });

  it("only creates the first super-admin and keeps RBAC synchronized", () => {
    expect(source).toContain("const existingSuperAdmins = await getSuperAdmins()");
    expect(source).toContain("{ status: 409 }");
    expect(source).toContain('role: "super-admin"');
    expect(source).toContain('syncUserRoleAssignment(createdUserId, "super-admin")');
    expect(source).toContain('syncUserRoleAssignment(existingUser.id, "super-admin")');
    expect(source).toContain('syncUserRoleAssignment(target.userId, "super-admin")');
  });

  it("rejects ambiguous or empty update requests", () => {
    expect(source).toContain("Target super admin is ambiguous. Provide userId or currentEmail.");
    expect(source).toContain("Provide at least one field to update.");
  });
});
```

- [ ] **Step 2: Run the focused test file**

Run:

```bash
bun run test src/lib/bootstrap-admin-route.test.ts
```

Expected: PASS.

---

### Task 3: Update Operator Documentation

**Files:**
- Modify: `docs/super-admin-curl-requests.md`

**Interfaces:**
- Consumes: endpoint contract from Task 1
- Produces: curl documentation matching current API behavior

- [ ] **Step 1: Update the successful `GET` response example**

Replace:

```json
{
  "bootstrapped": true,
  "superAdminCount": 1
}
```

with:

```json
{
  "bootstrapped": true,
  "superAdminCount": 1,
  "superAdmins": [
    {
      "userId": "ckx123...",
      "email": "abdul@example.com",
      "name": "Abdul Hassan"
    }
  ]
}
```

- [ ] **Step 2: Add a safe metadata note after the response example**

Add:

```md
The `superAdmins` list contains only safe operator metadata. Password hashes,
credential account data, sessions, and tokens are never returned.
```

- [ ] **Step 3: Add empty update validation to common `PATCH` responses**

Add this bullet to the `PATCH` common responses list:

```md
- `400` when no update fields are provided.
```

- [ ] **Step 4: Run source tests after doc update**

Run:

```bash
bun run test src/lib/bootstrap-admin-route.test.ts
```

Expected: PASS.

---

### Task 4: Verify and Refresh Graph

**Files:**
- Modify: `graphify-out/*` through `graphify update .`

**Interfaces:**
- Consumes: all modified source files
- Produces: passing checks and updated graph metadata

- [ ] **Step 1: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

Run:

```bash
bun run test src/lib/bootstrap-admin-route.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update graphify**

Run:

```bash
graphify update .
```

Expected: command completes successfully and updates graph files if needed.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff -- src/routes/api/internal/bootstrap-admin.ts src/lib/bootstrap-admin-route.test.ts docs/super-admin-curl-requests.md
```

Expected: diff only contains the endpoint contract, test, and docs changes described above.

---

## Self-Review

- Spec coverage: Tasks 1-3 cover secured API CRUD status/create/update, safe metadata, no package script, no delete/demotion, tests, and docs. Task 4 covers verification and graph refresh.
- Placeholder scan: The plan contains no TBD/TODO/placeholders and includes exact file paths, commands, and expected results.
- Type consistency: `superAdmins`, `getSuperAdmins`, `syncUserRoleAssignment`, and the validation message are named consistently across endpoint, tests, and docs.

