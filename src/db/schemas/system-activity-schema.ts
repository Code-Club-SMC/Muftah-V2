import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

// ── SYSTEM ACTIVITY LOG ────────────────────────────────────────────────────
// Append-only, immutable audit trail of every significant mutation across
// the entire ERP. Designed for the super-admin activity timeline view.
// No updates, no deletes — events are facts.

export const systemActivityLog = pgTable(
  "system_activity_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),

    // When the event occurred (event time, not insert time)
    timestamp: timestamp("timestamp").notNull().defaultNow(),

    // Which module: sales | finance | hr | manufacturing | inventory |
    // suppliers | user-management | auth
    module: text("module").notNull(),

    // Verb: created | updated | deleted | approved | rejected | dispatched |
    // completed | started | failed | transferred | verified | reversed |
    // login | logout | role_changed | banned | unbanned | generated | etc.
    action: text("action").notNull(),

    // What was acted on: invoice | production_run | employee | payroll |
    // user | expense | stock_transfer | carton | order | payment | etc.
    entityType: text("entity_type").notNull(),

    // FK-free reference to the entity's PK (nullable for system-level events)
    entityId: text("entity_id"),

    // Human-readable label for quick rendering without joins
    // e.g. "INV-00451", "Ahmed Khan", "Run #PR-0087"
    entityLabel: text("entity_label"),

    // Who performed the action
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),

    // One-line human summary:
    // "Abdul created Invoice #INV-00451 for Customer ABC"
    description: text("description").notNull(),

    // Flexible per-event context: old/new values, amounts, IDs, etc.
    metadata: jsonb("metadata"),

    // Client IP if available from request headers
    ipAddress: text("ip_address"),

    // Visual treatment hint: info (default) | warning | critical
    severity: text("severity").notNull().default("info"),
  },
  (table) => ({
    // Primary query: reverse-chronological feed
    timestampIdx: index("sal_timestamp_idx").on(table.timestamp),
    // Filter by module
    moduleIdx: index("sal_module_idx").on(table.module),
    // Filter by actor
    actorIdx: index("sal_actor_idx").on(table.actorId),
    // Filter by entity type
    entityTypeIdx: index("sal_entity_type_idx").on(table.entityType),
    // Composite for module + time range queries
    moduleTimestampIdx: index("sal_module_timestamp_idx").on(
      table.module,
      table.timestamp,
    ),
    // Composite for actor + time range queries
    actorTimestampIdx: index("sal_actor_timestamp_idx").on(
      table.actorId,
      table.timestamp,
    ),
    // Severity filter (rare but useful for "show me critical events only")
    severityIdx: index("sal_severity_idx").on(table.severity),
  }),
);

export const systemActivityLogRelations = relations(
  systemActivityLog,
  ({ one }) => ({
    actor: one(user, {
      fields: [systemActivityLog.actorId],
      references: [user.id],
    }),
  }),
);
