import { and, asc, eq, lte, isNull, or } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { appPermissions, appRolePermissions, appRoles, userRoleAssignments } from "@/db/schemas/rbac-schema";
import { hasPermission } from "@/lib/rbac";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getProductionOperators(executor: Executor, operatorId?: string) {
  const rows = await executor.select({ id: user.id, name: user.name, roleSlug: appRoles.slug, permission: appPermissions.key })
    .from(user).innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, user.id))
    .innerJoin(appRoles, eq(userRoleAssignments.roleId, appRoles.id))
    .leftJoin(appRolePermissions, eq(appRolePermissions.roleId, appRoles.id))
    .leftJoin(appPermissions, eq(appRolePermissions.permissionId, appPermissions.id))
    .where(and(operatorId ? eq(user.id, operatorId) : undefined, eq(appRoles.isArchived, false),
      or(isNull(user.banned), eq(user.banned, false), and(eq(user.banned, true), lte(user.banExpires, new Date())))))
    .orderBy(asc(user.name));
  const candidates = new Map<string, { id: string; name: string; permissions: Set<string> }>();
  for (const row of rows) {
    const candidate = candidates.get(row.id) ?? { id: row.id, name: row.name, permissions: new Set<string>() };
    if (row.roleSlug === "super-admin") candidate.permissions.add("*");
    if (row.permission) candidate.permissions.add(row.permission);
    candidates.set(row.id, candidate);
  }
  return [...candidates.values()].filter(candidate => hasPermission(candidate.permissions, "manufacturing.run.manage") ||
    (hasPermission(candidate.permissions, "operator.run.read") && hasPermission(candidate.permissions, "operator.run.log")))
    .map(({ id, name }) => ({ id, name }));
}
