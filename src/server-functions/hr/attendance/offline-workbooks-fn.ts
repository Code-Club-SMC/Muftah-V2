import { createId } from "@paralleldrive/cuid2";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceImportBatches,
  attendanceImportRows,
  attendanceOfflineWorkbooks,
  db,
  user,
} from "@/db";
import {
  OFFLINE_TEMPLATE_VERSION,
  OFFLINE_WORKBOOK_ROW_CAPACITY,
} from "@/lib/attendance/offline/constants";
import {
  buildOfflineWorkbookDownloadHeaders,
  type OfflineWorkbookSummary,
} from "@/lib/attendance/offline/contracts";
import { requireOfflineAttendanceEnabled } from "@/lib/attendance/offline/feature-flag.server";
import { getActiveSigningVersion } from "@/lib/attendance/offline/signing.server";
import { buildOfflineAttendanceWorkbook } from "@/lib/attendance/offline/workbook-template.server";
import { requireOfflineWorkbookManageMiddleware } from "@/lib/middlewares";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;
type WorkbookRecord = typeof attendanceOfflineWorkbooks.$inferSelect;
type ImportBatchStatus = typeof attendanceImportBatches.$inferSelect["status"];

const UNRESOLVED_IMPORT_BATCH_STATUSES: ReadonlyArray<ImportBatchStatus> = [
  "uploaded",
  "awaiting_supervisor",
  "preview_ready",
  "importing",
] as const;

const workbookIdSchema = z.object({
  workbookId: z.string().min(1),
});

const issueWorkbookSchema = z.object({
  operatorUserId: z.string().min(1),
  rowCapacity: z
    .number()
    .int()
    .min(1)
    .max(OFFLINE_WORKBOOK_ROW_CAPACITY)
    .optional(),
});

const replaceWorkbookSchema = workbookIdSchema.extend({
  operatorUserId: z.string().min(1).optional(),
});

const retireWorkbookSchema = workbookIdSchema.extend({
  reason: z.string().trim().min(1).max(240),
});

function dateToIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function getWorkbookRowStats(workbookId: string, rowCapacity: number) {
  const [stats] = await db
    .select({
      highestSeenRow:
        sql<number>`coalesce(max(${attendanceImportRows.worksheetRowNumber}), 1)::int`,
    })
    .from(attendanceImportRows)
    .where(eq(attendanceImportRows.workbookId, workbookId));
  const highestSeenRow = Number(stats?.highestSeenRow ?? 1);
  const usedRows = Math.max(0, highestSeenRow - 1);

  return {
    highestSeenRow,
    remainingRows: Math.max(0, rowCapacity - usedRows),
  };
}

async function toWorkbookSummary(
  record: WorkbookRecord,
  operatorName: string,
): Promise<OfflineWorkbookSummary> {
  const rowStats = await getWorkbookRowStats(record.id, record.rowCapacity);

  return {
    id: record.id,
    operatorUserId: record.assignedOperatorUserId,
    operatorName,
    templateVersion: record.templateVersion,
    rowCapacity: record.rowCapacity,
    signingVersion: record.signingVersion,
    highestSeenRow: rowStats.highestSeenRow,
    remainingRows: rowStats.remainingRows,
    status: record.status,
    issuedAt: dateToIso(record.issuedAt),
    replacedByWorkbookId: record.replacedByWorkbookId,
    retiredAt: record.retiredAt ? dateToIso(record.retiredAt) : null,
    retiredReason: record.retiredReason,
  };
}

async function requireOperatorUser(operatorUserId: string, database: DbLike = db) {
  const operator = await database.query.user.findFirst({
    where: eq(user.id, operatorUserId),
    columns: {
      id: true,
      name: true,
      email: true,
    },
  });

  if (!operator) {
    throw new Error("Assigned operator user was not found.");
  }

  return operator;
}

async function findActiveWorkbookForOperator(
  operatorUserId: string,
  database: DbLike = db,
  excludeWorkbookId?: string,
) {
  const conditions = [
    eq(attendanceOfflineWorkbooks.assignedOperatorUserId, operatorUserId),
    eq(attendanceOfflineWorkbooks.status, "active"),
  ];

  if (excludeWorkbookId) {
    conditions.push(ne(attendanceOfflineWorkbooks.id, excludeWorkbookId));
  }

  return await database.query.attendanceOfflineWorkbooks.findFirst({
    where: and(...conditions),
  });
}

async function assertNoUnresolvedImportBatches(
  database: DbLike,
  workbookId: string,
) {
  const unresolvedBatch = await database.query.attendanceImportBatches.findFirst({
    where: and(
      eq(attendanceImportBatches.workbookId, workbookId),
      inArray(attendanceImportBatches.status, UNRESOLVED_IMPORT_BATCH_STATUSES),
    ),
    columns: {
      id: true,
    },
  });

  if (unresolvedBatch) {
    throw new Error("Resolve pending imports before changing this workbook.");
  }
}

async function requireWorkbook(workbookId: string, database: DbLike = db) {
  const workbook = await database.query.attendanceOfflineWorkbooks.findFirst({
    where: eq(attendanceOfflineWorkbooks.id, workbookId),
  });

  if (!workbook) {
    throw new Error("Offline attendance workbook was not found.");
  }

  return workbook;
}

async function loadWorkbookForDownload(workbookId: string) {
  const workbook = await requireWorkbook(workbookId);
  const operator = await requireOperatorUser(workbook.assignedOperatorUserId);
  return { workbook, operator };
}

function requireActiveSigningVersion() {
  const signingVersion = getActiveSigningVersion();
  if (!signingVersion) {
    throw new Error("Offline attendance signing is disabled.");
  }
  return signingVersion;
}

export const listOfflineAttendanceWorkbooksFn = createServerFn()
  .middleware([requireOfflineWorkbookManageMiddleware])
  .handler(async () => {
    requireOfflineAttendanceEnabled();

    const rows = await db
      .select({
        workbook: attendanceOfflineWorkbooks,
        operatorName: user.name,
      })
      .from(attendanceOfflineWorkbooks)
      .leftJoin(
        user,
        eq(attendanceOfflineWorkbooks.assignedOperatorUserId, user.id),
      )
      .orderBy(desc(attendanceOfflineWorkbooks.issuedAt));

    return await Promise.all(
      rows.map((row) =>
        toWorkbookSummary(row.workbook, row.operatorName ?? "Unknown Operator"),
      ),
    );
  });

export const issueOfflineAttendanceWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineWorkbookManageMiddleware])
  .inputValidator(issueWorkbookSchema)
  .handler(async ({ data, context }) => {
    requireOfflineAttendanceEnabled();

    const signingVersion = requireActiveSigningVersion();
    const rowCapacity = data.rowCapacity ?? OFFLINE_WORKBOOK_ROW_CAPACITY;

    return await db.transaction(async (tx) => {
      const operator = await requireOperatorUser(data.operatorUserId, tx);
      const activeWorkbook = await findActiveWorkbookForOperator(
        data.operatorUserId,
        tx,
      );

      if (activeWorkbook) {
        throw new Error("This operator already has an active offline workbook.");
      }

      const issuedAt = new Date();
      const [workbook] = await tx
        .insert(attendanceOfflineWorkbooks)
        .values({
          id: createId(),
          assignedOperatorUserId: data.operatorUserId,
          templateVersion: OFFLINE_TEMPLATE_VERSION,
          rowCapacity,
          signingVersion,
          status: "active",
          issuedByUserId: context.session.user.id,
          issuedAt,
        })
        .returning();

      if (!workbook) {
        throw new Error("Failed to issue offline attendance workbook.");
      }

      return await toWorkbookSummary(workbook, operator.name);
    });
  });

export const downloadOfflineAttendanceWorkbookFn = createServerFn()
  .middleware([requireOfflineWorkbookManageMiddleware])
  .inputValidator(workbookIdSchema)
  .handler(async ({ data }) => {
    requireOfflineAttendanceEnabled();

    const { workbook, operator } = await loadWorkbookForDownload(data.workbookId);
    const bytes = await buildOfflineAttendanceWorkbook({
      workbookId: workbook.id,
      operatorUserId: workbook.assignedOperatorUserId,
      operatorName: operator.name,
      templateVersion: workbook.templateVersion,
      rowCapacity: workbook.rowCapacity,
      signingVersion: workbook.signingVersion,
      issuedAt: dateToIso(workbook.issuedAt),
    });
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);

    return new Response(body, {
      headers: buildOfflineWorkbookDownloadHeaders({
        operatorName: operator.name,
        workbookId: workbook.id,
      }),
    });
  });

export const replaceOfflineAttendanceWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineWorkbookManageMiddleware])
  .inputValidator(replaceWorkbookSchema)
  .handler(async ({ data, context }) => {
    requireOfflineAttendanceEnabled();

    const signingVersion = requireActiveSigningVersion();

    return await db.transaction(async (tx) => {
      const oldWorkbook = await requireWorkbook(data.workbookId, tx);
      if (oldWorkbook.status !== "active") {
        throw new Error("Only active offline workbooks can be replaced.");
      }

      await assertNoUnresolvedImportBatches(tx, oldWorkbook.id);

      const assignedOperatorUserId =
        data.operatorUserId ?? oldWorkbook.assignedOperatorUserId;
      const operator = await requireOperatorUser(assignedOperatorUserId, tx);
      const activeWorkbook = await findActiveWorkbookForOperator(
        assignedOperatorUserId,
        tx,
        oldWorkbook.id,
      );

      if (activeWorkbook) {
        throw new Error("This operator already has an active offline workbook.");
      }

      const issuedAt = new Date();
      await tx
        .update(attendanceOfflineWorkbooks)
        .set({
          status: "replaced",
          updatedAt: issuedAt,
        })
        .where(eq(attendanceOfflineWorkbooks.id, oldWorkbook.id));

      const [replacement] = await tx
        .insert(attendanceOfflineWorkbooks)
        .values({
          id: createId(),
          assignedOperatorUserId,
          templateVersion: OFFLINE_TEMPLATE_VERSION,
          rowCapacity: oldWorkbook.rowCapacity,
          signingVersion,
          status: "active",
          issuedByUserId: context.session.user.id,
          issuedAt,
        })
        .returning();

      if (!replacement) {
        throw new Error("Failed to replace offline attendance workbook.");
      }

      await tx
        .update(attendanceOfflineWorkbooks)
        .set({
          replacedByWorkbookId: replacement.id,
          updatedAt: new Date(),
        })
        .where(eq(attendanceOfflineWorkbooks.id, oldWorkbook.id));

      return await toWorkbookSummary(replacement, operator.name);
    });
  });

export const retireOfflineAttendanceWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineWorkbookManageMiddleware])
  .inputValidator(retireWorkbookSchema)
  .handler(async ({ data, context }) => {
    requireOfflineAttendanceEnabled();

    return await db.transaction(async (tx) => {
      const workbook = await requireWorkbook(data.workbookId, tx);
      if (workbook.status !== "active") {
        throw new Error("Only active offline workbooks can be retired.");
      }

      await assertNoUnresolvedImportBatches(tx, workbook.id);

      const retiredAt = new Date();
      const [retired] = await tx
        .update(attendanceOfflineWorkbooks)
        .set({
          status: "retired",
          retiredByUserId: context.session.user.id,
          retiredReason: data.reason,
          retiredAt,
          updatedAt: retiredAt,
        })
        .where(eq(attendanceOfflineWorkbooks.id, workbook.id))
        .returning();

      if (!retired) {
        throw new Error("Failed to retire offline attendance workbook.");
      }

      const operator = await requireOperatorUser(retired.assignedOperatorUserId, tx);
      return await toWorkbookSummary(retired, operator.name);
    });
  });
