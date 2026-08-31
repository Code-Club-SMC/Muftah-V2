import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { desc, eq, and, gte, lte, ilike, or, count } from "drizzle-orm";
import { db, systemActivityLog } from "@/db";
import { requireSuperAdminMiddleware, requireActivityTimelineManageMiddleware } from "@/lib/middlewares";
import { logActivity } from "@/lib/activity-logger.server";

// ── INPUT SCHEMA ───────────────────────────────────────────────────────────

const activityTimelineInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(50),
  module: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  entityType: z.string().optional(),
  severity: z.string().optional(),
  dateFrom: z.string().optional(), // ISO date
  dateTo: z.string().optional(), // ISO date
  search: z.string().optional(),
});

export type ActivityTimelineInput = z.infer<typeof activityTimelineInput>;

const activityExportInput = z.object({
  module: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  entityType: z.string().optional(),
  severity: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

function buildWhereClause(data: z.infer<typeof activityExportInput>) {
  const { module, action, actorId, entityType, severity, dateFrom, dateTo, search } = data;
  const conditions = [];

  if (module) conditions.push(eq(systemActivityLog.module, module));
  if (action) conditions.push(eq(systemActivityLog.action, action));
  if (actorId) conditions.push(eq(systemActivityLog.actorId, actorId));
  if (entityType) conditions.push(eq(systemActivityLog.entityType, entityType));
  if (severity) conditions.push(eq(systemActivityLog.severity, severity));
  if (dateFrom) conditions.push(gte(systemActivityLog.timestamp, new Date(dateFrom)));
  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    conditions.push(lte(systemActivityLog.timestamp, endDate));
  }
  if (search) {
    conditions.push(
      or(
        ilike(systemActivityLog.description, `%${search}%`),
        ilike(systemActivityLog.entityLabel, `%${search}%`),
        ilike(systemActivityLog.actorName, `%${search}%`)
      )
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ── QUERY: PAGINATED TIMELINE ──────────────────────────────────────────────

export const getActivityTimelineFn = createServerFn({ method: "GET" })
  .middleware([requireSuperAdminMiddleware])
  .inputValidator((d: unknown) => activityTimelineInput.parse(d))
  .handler(async ({ data }: { data: ActivityTimelineInput }) => {
    const { page, pageSize } = data;
    const whereClause = buildWhereClause(data);
    const offset = (page - 1) * pageSize;

    const [events, totalResult] = await Promise.all([
      db
        .select({
          id: systemActivityLog.id,
          timestamp: systemActivityLog.timestamp,
          module: systemActivityLog.module,
          action: systemActivityLog.action,
          entityType: systemActivityLog.entityType,
          entityId: systemActivityLog.entityId,
          entityLabel: systemActivityLog.entityLabel,
          actorId: systemActivityLog.actorId,
          actorName: systemActivityLog.actorName,
          description: systemActivityLog.description,
          metadata: systemActivityLog.metadata,
          ipAddress: systemActivityLog.ipAddress,
          severity: systemActivityLog.severity,
        })
        .from(systemActivityLog)
        .where(whereClause)
        .orderBy(desc(systemActivityLog.timestamp))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: count() })
        .from(systemActivityLog)
        .where(whereClause),
    ]);

    const total = totalResult[0]?.total ?? 0;

    return {
      events,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });

// ── QUERY: FILTER OPTIONS (distinct values) ────────────────────────────────

export const getActivityFilterOptionsFn = createServerFn({ method: "GET" })
  .middleware([requireSuperAdminMiddleware])
  .handler(async () => {
    const [modules, actions, entityTypes, actors] = await Promise.all([
      db
        .selectDistinct({ value: systemActivityLog.module })
        .from(systemActivityLog)
        .orderBy(systemActivityLog.module),
      db
        .selectDistinct({ value: systemActivityLog.action })
        .from(systemActivityLog)
        .orderBy(systemActivityLog.action),
      db
        .selectDistinct({ value: systemActivityLog.entityType })
        .from(systemActivityLog)
        .orderBy(systemActivityLog.entityType),
      db
        .selectDistinctOn([systemActivityLog.actorId], {
          id: systemActivityLog.actorId,
          name: systemActivityLog.actorName,
        })
        .from(systemActivityLog)
        .orderBy(systemActivityLog.actorId),
    ]);

    return {
      modules: modules.map((m) => m.value),
      actions: actions.map((a) => a.value),
      entityTypes: entityTypes.map((e) => e.value),
      actors: actors.map((a) => ({ id: a.id, name: a.name })),
    };
  });

// ── QUERY: EXPORT (CSV data) ───────────────────────────────────────────────

export const exportActivityTimelineFn = createServerFn({ method: "GET" })
  .middleware([requireSuperAdminMiddleware])
  .inputValidator((d: unknown) => activityExportInput.parse(d))
  .handler(async ({ data }: { data: z.infer<typeof activityExportInput> }) => {
    const whereClause = buildWhereClause(data);

    // Cap export at 5000 rows to prevent memory issues
    const events = await db
      .select({
        timestamp: systemActivityLog.timestamp,
        module: systemActivityLog.module,
        action: systemActivityLog.action,
        entityType: systemActivityLog.entityType,
        entityId: systemActivityLog.entityId,
        entityLabel: systemActivityLog.entityLabel,
        actorName: systemActivityLog.actorName,
        description: systemActivityLog.description,
        severity: systemActivityLog.severity,
        ipAddress: systemActivityLog.ipAddress,
      })
      .from(systemActivityLog)
      .where(whereClause)
      .orderBy(desc(systemActivityLog.timestamp))
      .limit(5000);

    return { events };
  });

// ── COMMAND: CREATE MANUAL EVENT ───────────────────────────────────────────

const createManualActivityEventInput = z.object({
  module: z.string().min(1, "Module is required"),
  action: z.string().min(1, "Action is required"),
  entityType: z.string().min(1, "Entity Type is required"),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  description: z.string().min(1, "Description is required"),
});

export const createManualActivityEventFn = createServerFn({ method: "POST" })
  .middleware([requireActivityTimelineManageMiddleware])
  .inputValidator((d: unknown) => createManualActivityEventInput.parse(d))
  .handler(async ({ data, context }) => {
    const { module, action, entityType, severity, description } = data;
    const actorId = context.session.user.id;
    const actorName = context.session.user.name;

    await logActivity({
      module: module as any, // Cast to any since we are allowing free-text
      action,
      entityType,
      severity,
      description,
      actorId,
      actorName,
    });

    return { success: true };
  });
