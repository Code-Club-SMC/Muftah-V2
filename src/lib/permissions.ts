import { createAccessControl } from "better-auth/plugins/access";

// Better Auth still uses this static model for its admin plugin endpoints.
// The application's real authorization model is database-backed in src/lib/rbac.ts.
const statement = {
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "delete",
    "set-password",
    "update",
  ],
  session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const superAdmin = ac.newRole({
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "delete",
    "set-password",
    "update",
  ],
  session: ["list", "revoke", "delete"],
});

export const admin = ac.newRole({
  user: ["list", "ban"],
  session: ["list"],
});

export const operator = ac.newRole({
  user: [],
  session: [],
});

export const financeManager = ac.newRole({
  user: [],
  session: [],
});

export const attendanceTerminal = ac.newRole({
  user: [],
  session: [],
});

export const orderBooker = ac.newRole({
  user: [],
  session: [],
});
