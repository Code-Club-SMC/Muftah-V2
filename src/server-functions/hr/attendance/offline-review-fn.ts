import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceImportBatches,
  attendanceOfflineWorkbooks,
  attendanceOutageWindows,
  db,
} from "@/db";
import { requireOfflineAttendanceEnabled } from "@/lib/attendance/offline/feature-flag.server";
import {
  assertDistinctWorkflowActors,
  buildAndPersistOfflinePreview,
  excludeOfflineImportRows,
  getOfflineImportBatchPreview,
  getOfflineImportQueues,
} from "@/lib/attendance/offline/preview.server";
import {
  requireOfflineAttendanceViewMiddleware,
  requireOfflineImportReviewMiddleware,
  requireOfflineOutageConfirmMiddleware,
} from "@/lib/middlewares";

const batchIdSchema = z.object({
  batchId: z.string().min(1),
});

const confirmOutageSchema = batchIdSchema.extend({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(5).max(500),
});

const rejectOutageSchema = batchIdSchema.extend({
  reason: z.string().trim().min(5).max(500),
});

const excludeRowsSchema = batchIdSchema.extend({
  rowIds: z.array(z.string().min(1)).min(1).max(500),
  reason: z.string().trim().min(5).max(500),
});

async function loadBatchForDecision(batchId: string) {
  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });
  if (!batch?.workbookId || !batch.outageWindowId) {
    throw new Error("Offline attendance import batch was not found.");
  }

  const workbook = await db.query.attendanceOfflineWorkbooks.findFirst({
    where: eq(attendanceOfflineWorkbooks.id, batch.workbookId),
  });
  const outageWindow = await db.query.attendanceOutageWindows.findFirst({
    where: eq(attendanceOutageWindows.id, batch.outageWindowId),
  });
  if (!workbook || !outageWindow) {
    throw new Error("Offline attendance import batch is incomplete.");
  }

  return { batch, workbook, outageWindow };
}

function parseConfirmedRange(input: {
  startsAt: string;
  endsAt: string;
}) {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new Error("Outage range is not valid.");
  }
  if (startsAt >= endsAt) {
    throw new Error("Outage start must be before outage end.");
  }
  if (endsAt > new Date()) {
    throw new Error("Outage end cannot be in the future.");
  }

  return { startsAt, endsAt };
}

export const getOfflineImportQueuesFn = createServerFn()
  .middleware([requireOfflineAttendanceViewMiddleware])
  .handler(async () => {
    requireOfflineAttendanceEnabled();
    return await getOfflineImportQueues();
  });

export const getOfflineImportBatchFn = createServerFn()
  .middleware([requireOfflineAttendanceViewMiddleware])
  .inputValidator(batchIdSchema)
  .handler(async ({ data }) => {
    requireOfflineAttendanceEnabled();
    return await getOfflineImportBatchPreview(data.batchId);
  });

export const confirmOfflineOutageWindowFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineOutageConfirmMiddleware])
  .inputValidator(confirmOutageSchema)
  .handler(async ({ data, context }) => {
    requireOfflineAttendanceEnabled();

    const range = parseConfirmedRange(data);
    const { workbook } = await loadBatchForDecision(data.batchId);
    assertDistinctWorkflowActors({
      operatorUserId: workbook.assignedOperatorUserId,
      supervisorUserId: context.session.user.id,
      reviewerUserId: null,
    });

    await db.transaction(async (tx) => {
      const batch = await tx.query.attendanceImportBatches.findFirst({
        where: eq(attendanceImportBatches.id, data.batchId),
      });
      if (!batch?.workbookId || !batch.outageWindowId) {
        throw new Error("Offline attendance import batch was not found.");
      }
      if (batch.status !== "awaiting_supervisor") {
        throw new Error("Only batches awaiting supervisor can be confirmed.");
      }

      const workbookInTx = await tx.query.attendanceOfflineWorkbooks.findFirst({
        where: eq(attendanceOfflineWorkbooks.id, batch.workbookId),
      });
      if (!workbookInTx) {
        throw new Error("Offline attendance workbook was not found.");
      }
      assertDistinctWorkflowActors({
        operatorUserId: workbookInTx.assignedOperatorUserId,
        supervisorUserId: context.session.user.id,
        reviewerUserId: null,
      });

      const [outageWindow] = await tx
        .update(attendanceOutageWindows)
        .set({
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          reason: data.reason,
          status: "confirmed",
          confirmedByUserId: context.session.user.id,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceOutageWindows.id, batch.outageWindowId),
            eq(attendanceOutageWindows.status, "pending"),
          ),
        )
        .returning({ id: attendanceOutageWindows.id });

      if (!outageWindow) {
        throw new Error("Outage is not pending supervisor confirmation.");
      }

      await tx
        .update(attendanceImportBatches)
        .set({
          status: "preview_ready",
          updatedAt: new Date(),
        })
        .where(eq(attendanceImportBatches.id, data.batchId));
    });

    return await buildAndPersistOfflinePreview(data.batchId);
  });

export const rejectOfflineOutageWindowFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineOutageConfirmMiddleware])
  .inputValidator(rejectOutageSchema)
  .handler(async ({ data, context }) => {
    requireOfflineAttendanceEnabled();

    const { workbook } = await loadBatchForDecision(data.batchId);
    assertDistinctWorkflowActors({
      operatorUserId: workbook.assignedOperatorUserId,
      supervisorUserId: context.session.user.id,
      reviewerUserId: null,
    });

    return await db.transaction(async (tx) => {
      const batch = await tx.query.attendanceImportBatches.findFirst({
        where: eq(attendanceImportBatches.id, data.batchId),
      });
      if (!batch?.outageWindowId) {
        throw new Error("Offline attendance import batch was not found.");
      }
      if (batch.status !== "awaiting_supervisor") {
        throw new Error("Only batches awaiting supervisor can be rejected.");
      }

      const [outageWindow] = await tx
        .update(attendanceOutageWindows)
        .set({
          status: "rejected",
          reason: data.reason,
          rejectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceOutageWindows.id, batch.outageWindowId),
            eq(attendanceOutageWindows.status, "pending"),
          ),
        )
        .returning({ id: attendanceOutageWindows.id });

      if (!outageWindow) {
        throw new Error("Outage is not pending supervisor confirmation.");
      }

      await tx
        .update(attendanceImportBatches)
        .set({
          status: "cancelled",
          lastError: data.reason,
          updatedAt: new Date(),
        })
        .where(eq(attendanceImportBatches.id, data.batchId));

      return {
        batchId: data.batchId,
        status: "cancelled" as const,
      };
    });
  });

export const refreshOfflineImportPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineImportReviewMiddleware])
  .inputValidator(batchIdSchema)
  .handler(async ({ data }) => {
    requireOfflineAttendanceEnabled();
    return await buildAndPersistOfflinePreview(data.batchId);
  });

export const excludeOfflineImportRowsFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineImportReviewMiddleware])
  .inputValidator(excludeRowsSchema)
  .handler(async ({ data }) => {
    requireOfflineAttendanceEnabled();
    return await excludeOfflineImportRows(data);
  });
