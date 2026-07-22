import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const appRoles = pgTable(
  "app_roles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: boolean("is_system").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    defaultLandingPath: text("default_landing_path").notNull().default("/dashboard"),
    ...timestamps,
  },
  (table) => [
    index("app_roles_slug_idx").on(table.slug),
    index("app_roles_archived_idx").on(table.isArchived),
  ],
);

export const appPermissions = pgTable(
  "app_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    key: text("key").notNull().unique(),
    moduleKey: text("module_key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("action"),
    routePattern: text("route_pattern"),
    ...timestamps,
  },
  (table) => [
    index("app_permissions_key_idx").on(table.key),
    index("app_permissions_module_idx").on(table.moduleKey),
  ],
);

export const appRolePermissions = pgTable(
  "app_role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => appPermissions.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roleId, table.permissionId],
      name: "app_role_permissions_pk",
    }),
    index("app_role_permissions_role_idx").on(table.roleId),
    index("app_role_permissions_permission_idx").on(table.permissionId),
  ],
);

export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "restrict" }),
    assignedByUserId: text("assigned_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_role_assignments_role_idx").on(table.roleId),
    index("user_role_assignments_assigned_by_idx").on(table.assignedByUserId),
  ],
);

export const appRolesRelations = relations(appRoles, ({ many }) => ({
  permissions: many(appRolePermissions),
  assignments: many(userRoleAssignments),
}));

export const appPermissionsRelations = relations(appPermissions, ({ many }) => ({
  roles: many(appRolePermissions),
}));

export const appRolePermissionsRelations = relations(appRolePermissions, ({ one }) => ({
  role: one(appRoles, {
    fields: [appRolePermissions.roleId],
    references: [appRoles.id],
  }),
  permission: one(appPermissions, {
    fields: [appRolePermissions.permissionId],
    references: [appPermissions.id],
  }),
}));

export const userRoleAssignmentsRelations = relations(
  userRoleAssignments,
  ({ one }) => ({
    user: one(user, {
      fields: [userRoleAssignments.userId],
      references: [user.id],
    }),
    role: one(appRoles, {
      fields: [userRoleAssignments.roleId],
      references: [appRoles.id],
    }),
    assignedBy: one(user, {
      fields: [userRoleAssignments.assignedByUserId],
      references: [user.id],
    }),
  }),
);
