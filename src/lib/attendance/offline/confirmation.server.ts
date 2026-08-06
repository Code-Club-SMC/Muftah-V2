import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import {
  attendance,
  attendanceImportBatches,
  attendanceImportRows,
  attendanceOfflineWorkbooks,
  attendanceOutageWindows,
  attendancePunches,
  db,
  employees,
  payrolls,
} from "@/db";
import type {
  OfflineBatchStatus,
  OfflineRowStatus,
} from "@/db/schemas/offline-attendance-schema";
import { recomputeAttendanceRow } from "@/lib/attendance/recompute-server";
import {
  OFFLINE_BATCH_LEASE_MS,
  OFFLINE_CONFIRM_GROUP_LIMIT,
} from "./constants";
import type { OfflineImportCounts } from "./contracts";
import { invalidateDraftPayrollsForAttendance } from "./payroll-invalidation.server";
import { countsFromRows } from "./preview.server";
import {
  classifyOfflineTimeline,
  type ImportedIdentityClaim,
  type TimelineCandidatePunch,
  type TimelineClassification,
  type TimelinePolicy,
  type TimelinePunch,
} from "./timeline";
import { assertDistinctWorkflowActors } from "./workflow-actors";
import { toPKTDate } from "../time";
import { lockEmployeePunchWrites } from "@/server-functions/hr/attendance/punch-write-lock";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BatchRow = typeof attendanceImportBatches.$inferSelect;
type ImportRow = typeof attendanceImportRows.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;
type PayrollRow = typeof payrolls.$inferSelect;
type OutageRow = typeof attendanceOutageWindows.$inferSelect;

export type ConfirmBatchResult = {
  batchId: string;
  status: "importing" | "completed" | "completed_with_issues";
  processedGroups: number;
  importedRows: number;
  hasMore: boolean;
  counts: OfflineImportCounts;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const REST_DAY_NOTE = "Scanned on rest day";

function asDirection(value: string | null): "in" | "out" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "in" || normalized === "out") return normalized;
  return null;
}

function getDateDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isRestDay(date: string, restDays: unknown) {
  const configuredRestDays = Array.isArray(restDays)
    ? restDays.filter((day): day is number => Number.isInteger(day))
    : [0];
  return configuredRestDays.includes(getDateDay(date));
}

function rowTimestamp(row: ImportRow): Date | null {
  if (!row.normalizedTimestamp) return null;
  const date =
    row.normalizedTimestamp instanceof Date
      ? row.normalizedTimestamp
      : new Date(row.normalizedTimestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

function rowToCandidate(row: ImportRow): TimelineCandidatePunch | null {
  const direction = asDirection(row.rawDirection);
  const timestamp = rowTimestamp(row);
  if (!direction || !timestamp || !row.employeeId) return null;

  return {
    id: row.id,
    employeeId: row.employeeId,
    timestamp: timestamp.toISOString(),
    attendanceDate: row.attendanceDate ?? toPKTDate(timestamp),
    direction,
    source: "offline_excel",
    candidateRowId: row.id,
    workbookId: row.workbookId,
    recordToken: row.recordToken,
    contentHash: row.contentHash ?? "",
  };
}

function punchToTimeline(
  punch: typeof attendancePunches.$inferSelect,
): TimelinePunch {
  return {
    id: punch.id,
    employeeId: punch.employeeId,
    timestamp: punch.timestamp.toISOString(),
    attendanceDate: punch.attendanceDate,
    direction: punch.direction,
    source: punch.source as TimelinePunch["source"],
  };
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function countsFromBatch(batch: BatchRow): OfflineImportCounts {
  return {
    totalRows: batch.totalRows,
    readyRows: batch.readyRows,
    duplicateRows: batch.duplicateRows,
    reviewRows: batch.reviewRows,
    invalidRows: batch.invalidRows,
    blockedRows: batch.blockedRows,
    importedRows: batch.importedRows,
    excludedRows: batch.excludedRows,
  };
}

function resultFromBatch(
  batch: BatchRow,
  processedGroups = 0,
  importedRows = 0,
): ConfirmBatchResult {
  const hasMore = batch.status === "importing";
  const status =
    batch.status === "completed" || batch.status === "completed_with_issues"
      ? batch.status
      : "importing";

  return {
    batchId: batch.id,
    status,
    processedGroups,
    importedRows,
    hasMore,
    counts: countsFromBatch(batch),
  };
}

function statusForClassification(
  classification: TimelineClassification,
): OfflineRowStatus {
  if (classification.status === "ready") return "ready";
  if (classification.status === "duplicate") return "duplicate";
  if (classification.status === "needs_review") return "needs_review";
  if (classification.status === "invalid") return "invalid";
  return "blocked";
}

function reasonForClassification(classification: TimelineClassification) {
  if (classification.status === "ready") {
    return { reasonCode: null, reasonMessage: null };
  }

  return {
    reasonCode: classification.reasonCode,
    reasonMessage: classification.message,
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function dateWindow(attendanceDate: string) {
  const center = new Date(`${attendanceDate}T00:00:00+05:00`);
  return {
    startsAt: new Date(center.getTime() - DAY_MS),
    endsAt: new Date(center.getTime() + 2 * DAY_MS),
  };
}

function payrollStatusForDate(payrollRows: PayrollRow[], date: string) {
  const payroll = payrollRows.find(
    (row) => row.startDate <= date && row.endDate >= date,
  );
  const status = payroll?.status;
  if (status === "draft" || status === "approved" || status === "paid") {
    return status;
  }
  return "none";
}

function timelinePolicy(input: {
  employee: EmployeeRow;
  attendanceDate: string;
  outage: OutageRow;
  attendanceStatus: string;
  payrollRows: PayrollRow[];
}): TimelinePolicy {
  return {
    employeeExists: true,
    employeeStatus: input.employee.status,
    attendanceStatus: input.attendanceStatus,
    isRestDay: isRestDay(input.attendanceDate, input.employee.restDays),
    payrollStatus: payrollStatusForDate(input.payrollRows, input.attendanceDate),
    confirmedWindow: {
      startsAt: input.outage.startsAt.toISOString(),
      endsAt: input.outage.endsAt.toISOString(),
    },
    now: new Date().toISOString(),
  };
}

async function recomputeBatchCounts(tx: Tx, batchId: string) {
  const rows = await tx.query.attendanceImportRows.findMany({
    where: eq(attendanceImportRows.batchId, batchId),
    columns: { status: true },
  });
  const counts = countsFromRows(rows);

  await tx
    .update(attendanceImportBatches)
    .set({
      ...counts,
      updatedAt: new Date(),
    })
    .where(eq(attendanceImportBatches.id, batchId));

  return counts;
}

async function loadImportedClaims(
  tx: Tx,
  rows: ImportRow[],
): Promise<ImportedIdentityClaim[]> {
  const tokens = unique(rows.map((row) => row.recordToken));
  const workbookIds = unique(rows.map((row) => row.workbookId));
  if (tokens.length === 0 || workbookIds.length === 0) return [];

  const importedRows = await tx.query.attendanceImportRows.findMany({
    where: and(
      inArray(attendanceImportRows.workbookId, workbookIds),
      inArray(attendanceImportRows.recordToken, tokens),
      eq(attendanceImportRows.status, "imported"),
    ),
    columns: {
      workbookId: true,
      recordToken: true,
      contentHash: true,
      punchId: true,
    },
  });

  return importedRows.map((row) => ({
    workbookId: row.workbookId,
    recordToken: row.recordToken,
    contentHash: row.contentHash ?? "",
    punchId: row.punchId,
  }));
}

async function loadBatchBundle(tx: Tx, batchId: string) {
  const batch = await tx.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });
  if (!batch?.workbookId || !batch.outageWindowId) {
    throw new Error("Offline attendance import batch was not found.");
  }

  const workbook = await tx.query.attendanceOfflineWorkbooks.findFirst({
    where: eq(attendanceOfflineWorkbooks.id, batch.workbookId),
  });
  const outage = await tx.query.attendanceOutageWindows.findFirst({
    where: eq(attendanceOutageWindows.id, batch.outageWindowId),
  });
  if (!workbook || !outage) {
    throw new Error("Offline attendance import batch is incomplete.");
  }
  if (outage.status !== "confirmed" || !outage.confirmedByUserId) {
    throw new Error("Supervisor must confirm the outage before final import.");
  }

  return { batch, workbook, outage };
}

async function acquireBatchLease(input: {
  batchId: string;
  reviewerUserId: string;
  leaseId: string;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + OFFLINE_BATCH_LEASE_MS);

  return await db.transaction(async (tx) => {
    const { batch, workbook, outage } = await loadBatchBundle(tx, input.batchId);

    if (batch.status === "completed" || batch.status === "completed_with_issues") {
      return { claimed: false as const, batch };
    }
    if (batch.status !== "preview_ready" && batch.status !== "importing") {
      throw new Error("Offline attendance batch is not ready for final import.");
    }

    assertDistinctWorkflowActors({
      operatorUserId: workbook.assignedOperatorUserId,
      supervisorUserId: outage.confirmedByUserId,
      reviewerUserId: input.reviewerUserId,
    });

    if (
      batch.reviewedByUserId &&
      batch.reviewedByUserId !== input.reviewerUserId
    ) {
      throw new Error("Only the original reviewer can resume this import.");
    }

    const [claimed] = await tx
      .update(attendanceImportBatches)
      .set({
        status: "importing",
        reviewedByUserId: batch.reviewedByUserId ?? input.reviewerUserId,
        reviewedAt: batch.reviewedAt ?? now,
        processingLeaseId: input.leaseId,
        processingLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(attendanceImportBatches.id, input.batchId),
          inArray(attendanceImportBatches.status, [
            "preview_ready",
            "importing",
          ]),
          or(
            isNull(attendanceImportBatches.processingLeaseId),
            isNull(attendanceImportBatches.processingLeaseExpiresAt),
            lt(attendanceImportBatches.processingLeaseExpiresAt, now),
            eq(attendanceImportBatches.processingLeaseId, input.leaseId),
          ),
        ),
      )
      .returning();

    return claimed
      ? { claimed: true as const, batch: claimed }
      : { claimed: false as const, batch };
  });
}

async function releaseBatchLease(batchId: string, leaseId: string) {
  await db
    .update(attendanceImportBatches)
    .set({
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(attendanceImportBatches.id, batchId),
        eq(attendanceImportBatches.processingLeaseId, leaseId),
      ),
    );
}

async function renewBatchLease(tx: Tx, batchId: string, leaseId: string) {
  const [renewed] = await tx
    .update(attendanceImportBatches)
    .set({
      processingLeaseExpiresAt: new Date(Date.now() + OFFLINE_BATCH_LEASE_MS),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(attendanceImportBatches.id, batchId),
        eq(attendanceImportBatches.processingLeaseId, leaseId),
      ),
    )
    .returning({ id: attendanceImportBatches.id });

  if (!renewed) {
    throw new Error("Offline attendance import lease expired.");
  }
}

async function nextReadyGroup(batchId: string) {
  const first = await db.query.attendanceImportRows.findFirst({
    where: and(
      eq(attendanceImportRows.batchId, batchId),
      eq(attendanceImportRows.status, "ready"),
    ),
    orderBy: [
      asc(attendanceImportRows.employeeId),
      asc(attendanceImportRows.attendanceDate),
      asc(attendanceImportRows.normalizedTimestamp),
      asc(attendanceImportRows.worksheetRowNumber),
    ],
  });

  if (!first?.employeeId || !first.attendanceDate) return null;

  const rows = await db.query.attendanceImportRows.findMany({
    where: and(
      eq(attendanceImportRows.batchId, batchId),
      eq(attendanceImportRows.status, "ready"),
      eq(attendanceImportRows.employeeId, first.employeeId),
      eq(attendanceImportRows.attendanceDate, first.attendanceDate),
    ),
    orderBy: [
      asc(attendanceImportRows.normalizedTimestamp),
      asc(attendanceImportRows.worksheetRowNumber),
    ],
  });

  return {
    employeeId: first.employeeId,
    attendanceDate: first.attendanceDate,
    rows,
  };
}

async function markRowsFromClassification(input: {
  tx: Tx;
  rows: ImportRow[];
  classification: TimelineClassification;
}) {
  const status = statusForClassification(input.classification);
  const reason = reasonForClassification(input.classification);

  await input.tx
    .update(attendanceImportRows)
    .set({
      status,
      reasonCode: reason.reasonCode,
      reasonMessage: reason.reasonMessage,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        attendanceImportRows.id,
        input.rows.map((row) => row.id),
      ),
    );
}

async function markGroupDuplicate(input: {
  batchId: string;
  employeeId: string;
  attendanceDate: string;
  reasonCode: string;
  reasonMessage: string;
}) {
  await db
    .update(attendanceImportRows)
    .set({
      status: "duplicate",
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(attendanceImportRows.batchId, input.batchId),
        eq(attendanceImportRows.employeeId, input.employeeId),
        eq(attendanceImportRows.attendanceDate, input.attendanceDate),
        eq(attendanceImportRows.status, "ready"),
      ),
    );
}

async function classifyReadyGroup(input: {
  tx: Tx;
  rows: ImportRow[];
  employee: EmployeeRow;
  outage: OutageRow;
  attendanceDate: string;
}) {
  const candidates = input.rows.map(rowToCandidate);
  if (candidates.includes(null)) {
    return {
      status: "invalid",
      reasonCode: "invalid_literal_values",
      message: "Ready row has invalid timestamp or direction",
      timeline: [],
      candidateRows: [],
    } satisfies TimelineClassification;
  }

  const window = dateWindow(input.attendanceDate);
  const existingPunches = await input.tx.query.attendancePunches.findMany({
    where: and(
      eq(attendancePunches.employeeId, input.employee.id),
      gte(attendancePunches.timestamp, window.startsAt),
      lte(attendancePunches.timestamp, window.endsAt),
    ),
    orderBy: [asc(attendancePunches.timestamp)],
  });
  const attendanceRow = await input.tx.query.attendance.findFirst({
    where: and(
      eq(attendance.employeeId, input.employee.id),
      eq(attendance.date, input.attendanceDate),
    ),
  });
  const payrollRows = await input.tx.query.payrolls.findMany({
    where: and(
      lte(payrolls.startDate, input.attendanceDate),
      gte(payrolls.endDate, input.attendanceDate),
    ),
  });
  const importedClaims = await loadImportedClaims(input.tx, input.rows);

  return classifyOfflineTimeline({
    existing: existingPunches.map(punchToTimeline),
    candidates: candidates as TimelineCandidatePunch[],
    importedClaims,
    policy: timelinePolicy({
      employee: input.employee,
      attendanceDate: input.attendanceDate,
      outage: input.outage,
      attendanceStatus: attendanceRow?.status ?? "none",
      payrollRows,
    }),
  });
}

async function processReadyGroup(input: {
  batchId: string;
  leaseId: string;
  reviewerUserId: string;
  employeeId: string;
  attendanceDate: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      await renewBatchLease(tx, input.batchId, input.leaseId);
      await lockEmployeePunchWrites(tx, input.employeeId);

      const { workbook, outage } = await loadBatchBundle(tx, input.batchId);
      assertDistinctWorkflowActors({
        operatorUserId: workbook.assignedOperatorUserId,
        supervisorUserId: outage.confirmedByUserId,
        reviewerUserId: input.reviewerUserId,
      });

      const rows = await tx.query.attendanceImportRows.findMany({
        where: and(
          eq(attendanceImportRows.batchId, input.batchId),
          eq(attendanceImportRows.employeeId, input.employeeId),
          eq(attendanceImportRows.attendanceDate, input.attendanceDate),
          eq(attendanceImportRows.status, "ready"),
        ),
        orderBy: [
          asc(attendanceImportRows.normalizedTimestamp),
          asc(attendanceImportRows.worksheetRowNumber),
        ],
      });
      if (rows.length === 0) return { importedRows: 0 };

      const employee = await tx.query.employees.findFirst({
        where: eq(employees.id, input.employeeId),
      });
      if (!employee) {
        await markRowsFromClassification({
          tx,
          rows,
          classification: {
            status: "invalid",
            reasonCode: "unknown_employee",
            message: "Employee code does not match an employee",
            timeline: [],
            candidateRows: [],
          },
        });
        return { importedRows: 0 };
      }

      const classification = await classifyReadyGroup({
        tx,
        rows,
        employee,
        outage,
        attendanceDate: input.attendanceDate,
      });
      if (classification.status !== "ready") {
        await markRowsFromClassification({ tx, rows, classification });
        return { importedRows: 0 };
      }

      const claimedRows = await tx
        .update(attendanceImportRows)
        .set({
          status: "imported",
          reasonCode: null,
          reasonMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceImportRows.batchId, input.batchId),
            eq(attendanceImportRows.employeeId, input.employeeId),
            eq(attendanceImportRows.attendanceDate, input.attendanceDate),
            eq(attendanceImportRows.status, "ready"),
          ),
        )
        .returning();

      if (claimedRows.length !== rows.length) {
        throw new Error("Offline attendance rows changed during import.");
      }

      const candidateDateByRow = new Map(
        classification.candidateRows.map((candidate) => [
          candidate.candidateRowId,
          candidate.attendanceDate,
        ]),
      );
      let importedRows = 0;

      for (const row of claimedRows) {
        const timestamp = rowTimestamp(row);
        const direction = asDirection(row.rawDirection);
        if (!timestamp || !direction) {
          throw new Error("Claimed offline row has invalid timestamp.");
        }

        const attendanceDate =
          candidateDateByRow.get(row.id) ??
          row.attendanceDate ??
          input.attendanceDate;
        const [punch] = await tx
          .insert(attendancePunches)
          .values({
            employeeId: input.employeeId,
            timestamp,
            attendanceDate,
            direction,
            source: "offline_excel",
            terminalUserId: workbook.assignedOperatorUserId,
            note: row.rawNote,
            offlineImportRowId: row.id,
            offlineImportIdentity: `${row.workbookId}:${row.recordToken}`,
          })
          .returning({ id: attendancePunches.id });

        if (!punch) {
          throw new Error("Failed to insert offline attendance punch.");
        }

        await tx
          .update(attendanceImportRows)
          .set({
            punchId: punch.id,
            attendanceDate,
            updatedAt: new Date(),
          })
          .where(eq(attendanceImportRows.id, row.id));
        importedRows += 1;
      }

      await recomputeAttendanceRow(tx, input.employeeId, input.attendanceDate, {
        forceNightShift: classification.isNightShift,
        appendNote: isRestDay(input.attendanceDate, employee.restDays)
          ? REST_DAY_NOTE
          : undefined,
      });

      await invalidateDraftPayrollsForAttendance(tx, {
        batchId: input.batchId,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
      });

      return { importedRows };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      await markGroupDuplicate({
        batchId: input.batchId,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
        reasonCode: "already_imported",
        reasonMessage: "Offline attendance row was already imported",
      });
      return { importedRows: 0 };
    }

    throw error;
  }
}

async function finishBatchIfDone(batchId: string) {
  return await db.transaction(async (tx) => {
    const rows = await tx.query.attendanceImportRows.findMany({
      where: eq(attendanceImportRows.batchId, batchId),
      columns: { status: true },
    });
    const counts = countsFromRows(rows);
    const hasMoreReadyRows = counts.readyRows > 0;
    const status: OfflineBatchStatus = hasMoreReadyRows
      ? "importing"
      : counts.reviewRows > 0 ||
          counts.invalidRows > 0 ||
          counts.blockedRows > 0 ||
          counts.duplicateRows > 0 ||
          counts.excludedRows > 0
        ? "completed_with_issues"
        : "completed";

    const [batch] = await tx
      .update(attendanceImportBatches)
      .set({
        ...counts,
        status,
        completedAt: hasMoreReadyRows ? null : new Date(),
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(attendanceImportBatches.id, batchId))
      .returning();

    if (!batch) {
      throw new Error("Offline attendance import batch was not found.");
    }

    return batch;
  });
}

export async function processOfflineImportSlice(input: {
  batchId: string;
  reviewerUserId: string;
}): Promise<ConfirmBatchResult> {
  const leaseId = createId();
  const lease = await acquireBatchLease({
    batchId: input.batchId,
    reviewerUserId: input.reviewerUserId,
    leaseId,
  });

  if (!lease.claimed) {
    return resultFromBatch(lease.batch);
  }

  let processedGroups = 0;
  let importedRows = 0;

  try {
    while (processedGroups < OFFLINE_CONFIRM_GROUP_LIMIT) {
      const group = await nextReadyGroup(input.batchId);
      if (!group) break;

      const result = await processReadyGroup({
        batchId: input.batchId,
        leaseId,
        reviewerUserId: input.reviewerUserId,
        employeeId: group.employeeId,
        attendanceDate: group.attendanceDate,
      });
      processedGroups += 1;
      importedRows += result.importedRows;
    }

    const finishedBatch = await finishBatchIfDone(input.batchId);
    return {
      ...resultFromBatch(finishedBatch, processedGroups, importedRows),
      hasMore: finishedBatch.status === "importing",
    };
  } finally {
    await releaseBatchLease(input.batchId, leaseId);
  }
}
