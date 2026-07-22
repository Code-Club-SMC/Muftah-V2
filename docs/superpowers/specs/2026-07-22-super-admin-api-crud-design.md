# Super Admin API CRUD — Design Spec

**Date:** 2026-07-22
**Status:** Approved
**Scope:** Secured internal API operations for managing super-admin accounts. Package.json bootstrap scripts are explicitly out of scope.

---

## 1. Overview

Super-admin lifecycle operations are handled through the existing secured internal API endpoint instead of a TypeScript package script.

The endpoint already exists at:

`/api/internal/bootstrap-admin`

This design keeps that endpoint as the single operational surface for bootstrap and maintenance tasks:

- check whether a super-admin exists
- create the first super-admin
- update an existing super-admin
- list safe super-admin metadata

The server remains the only place that writes Better Auth user/account rows and DB-backed RBAC assignments.

---

## 2. Current State

The current endpoint already supports:

- `GET` status check
- `POST` first super-admin creation
- `PATCH` super-admin updates
- `ADMIN_BOOTSTRAP_SECRET` validation through `x-bootstrap-secret`
- hidden `404` responses for invalid or missing bootstrap secrets
- Better Auth-compatible credential account creation
- DB-backed RBAC role synchronization through `syncUserRoleAssignment`

The project also has shell scripts that call this endpoint. Those scripts remain operator helpers, but new functionality does not add a package.json TypeScript bootstrap script.

---

## 3. API Contract

### 3.1 Authentication

Every request requires:

`x-bootstrap-secret: <ADMIN_BOOTSTRAP_SECRET>`

If the secret is missing, empty, or invalid, the endpoint returns:

`404 { "error": "Not Found" }`

The endpoint must not expose whether the route exists to unauthenticated callers.

### 3.2 `GET /api/internal/bootstrap-admin`

Purpose:

- report whether the app is bootstrapped
- report the number of super-admin accounts
- return safe metadata needed by operators

Response:

```json
{
  "bootstrapped": true,
  "superAdminCount": 1,
  "superAdmins": [
    {
      "userId": "ck...",
      "email": "admin@example.com",
      "name": "Super Admin"
    }
  ]
}
```

No password hashes, account secrets, session tokens, or internal auth records are returned.

### 3.3 `POST /api/internal/bootstrap-admin`

Purpose:

- create the first super-admin only
- promote an existing user with the requested email if no super-admin exists

Body:

```json
{
  "name": "Super Admin",
  "email": "admin@example.com",
  "password": "StrongPass123"
}
```

Rules:

- fail with `409` if at least one super-admin already exists
- normalize email to lowercase
- trim name
- require password length of at least 8
- set the Better Auth legacy `user.role` value to `super-admin`
- create or update the credential account password
- assign the DB-backed `super-admin` role through `syncUserRoleAssignment`

### 3.4 `PATCH /api/internal/bootstrap-admin`

Purpose:

- update a super-admin's name, email, password, or any combination of those fields

Target selection order:

1. `userId`
2. `currentEmail`
3. automatic selection only when exactly one super-admin exists

Rules:

- fail with `404` if no super-admin exists
- fail with `400` if multiple super-admins exist and no unambiguous target is provided
- fail with `400` if no update fields are provided
- normalize updated email to lowercase
- trim updated name
- require updated password length of at least 8
- keep the target assigned to the DB-backed `super-admin` role after update

### 3.5 Delete/Demotion

Delete and demotion are intentionally not part of this endpoint.

Reason:

- deleting or demoting the last super-admin can lock operators out of the system
- removal needs stronger workflow controls than bootstrap/update operations

If removal is added later, it belongs in a separate endpoint with explicit last-admin protection.

---

## 4. Implementation Notes

Keep the endpoint file focused, but factor reusable logic when it reduces risk:

- `getSuperAdmins`
- `setOrCreateCredentialPassword`
- validation schemas
- response helpers

The existing source inspection test for the bootstrap route is stale. Update it to assert the actual supported behavior:

- the route uses `hashPassword` from `better-auth/crypto`
- credential `accountId` is the user id
- `POST` checks existing super-admins and returns `409`
- role synchronization still uses `syncUserRoleAssignment`
- invalid secrets still use hidden `404`

Update the existing curl documentation to include the `GET` response `superAdmins` field.

---

## 5. Verification

Run:

```bash
bun run test
bun run typecheck
```

Manual verification:

- call `GET` with an invalid secret and confirm `404`
- call `GET` with a valid secret and confirm status metadata
- call `POST` on an unbootstrapped database and confirm creation
- call `POST` again and confirm `409`
- call `PATCH` and confirm name/email/password updates without losing the `super-admin` role
