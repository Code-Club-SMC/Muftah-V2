import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  attendance,
  attendanceImportBatches,
  attendanceImportRows,
  attendanceOfflineWorkbooks,
  attendanceOutageWindows,
  attendancePunches,
  attendanceTerminalHeartbeats,
  db,
  employees,
  payrolls,
  user,
} from "@/db";
import type {
  OfflineBatchStatus,
  OfflineRowStatus,
} from "@/db/schemas/offline-attendance-schema";
import type { OfflineImportCounts } from "./contracts";
import {
  classifyOfflineTimeline,
  groupOfflineRows,
  type ClassifiedOfflineRow,
  type ImportedIdentityClaim,
  type OfflineEmployeeDayGroup,
  type TimelineCandidatePunch,
  type TimelineClassification,
  type TimelinePolicy,
  type TimelinePunch,
} from "./timeline";
import {
  assertDistinctWorkflowActors,
  type OfflineWorkflowActors,
} from "./workflow-actors";
import { toPKTDate } from "../time";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;
type ImportBatch = typeof attendanceImportBatches.$inferSelect;
type ImportRow = typeof attendanceImportRows.$inferSelect;
type Employee = typeof employees.$inferSelect;
type AttendanceRow = typeof attendance.$inferSelect;
type PayrollRow = typeof payrolls.$inferSelect;
type WorkbookRow = typeof attendanceOfflineWorkbooks.$inferSelect;
type OutageWindowRow = typeof attendanceOutageWindows.$inferSelect;

export { assertDistinctWorkflowActors, type OfflineWorkflowActors };

export type OfflinePreviewTimelineEvent = {
  id: string;
  source: "qr_terminal" | "manual" | "offline_excel";
  timestamp: string;
  direction: "in" | "out";
  attendanceDate: string;
  rowStatus?: OfflineRowStatus;
};

export type OfflineImportPreviewGroup = OfflineEmployeeDayGroup & {
  timeline: OfflinePreviewTimelineEvent[];
};

export type OfflineImportPreview = {
  batchId: string;
  status: OfflineBatchStatus;
  counts: OfflineImportCounts;
  groups: OfflineImportPreviewGroup[];
  heartbeatCount: number;
};

export type OfflineImportQueueItem = {
  batchId: string;
  workbookId: string | null;
  outageWindowId: string | null;
  status: OfflineBatchStatus;
  uploadedAt: string;
  operatorUserId: string | null;
  operatorName: string | null;
  outageStatus: string | null;
  startsAt: string | null;
  endsAt: string | null;
  counts: OfflineImportCounts;
};

export type OfflineImportQueues = {
  awaitingSupervisor: OfflineImportQueueItem[];
  readyForReview: OfflineImportQueueItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function countsFromRows(
  rows: Array<{ status: OfflineRowStatus }>,
): OfflineImportCounts {
  return {
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "ready").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    reviewRows: rows.filter((row) => row.status === "needs_review").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length,
    blockedRows: rows.filter((row) => row.status === "blocked").length,
    importedRows: rows.filter((row) => row.status === "imported").length,
    excludedRows: rows.filter((row) => row.status === "excluded").length,
  };
}

function batchCounts(batch: ImportBatch): OfflineImportCounts {
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

function dateToIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function asDirection(value: string | null): "in" | "out" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "in" || normalized === "out") return normalized;
  return null;
}

function rowTimestamp(row: ImportRow): Date | null {
  if (!row.normalizedTimestamp) return null;
  const date =
    row.normalizedTimestamp instanceof Date
      ? row.normalizedTimestamp
      : new Date(row.normalizedTimestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

function rowToClassified(row: ImportRow): ClassifiedOfflineRow {
  return {
    id: row.id,
    batchId: row.batchId,
    employeeId: row.employeeId,
    attendanceDate: row.attendanceDate,
    normalizedTimestamp: dateToIso(row.normalizedTimestamp),
    rawDirection: row.rawDirection,
    status: row.status,
    worksheetRowNumber: row.worksheetRowNumber,
    reasonCode: row.reasonCode,
    reasonMessage: row.reasonMessage,
  };
}

function rowToCandidate(
  row: ImportRow,
  employeeId: string,
): TimelineCandidatePunch | null {
  const direction = asDirection(row.rawDirection);
  const timestamp = rowTimestamp(row);
  if (!direction || !timestamp) return null;

  return {
    id: row.id,
    employeeId,
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

function rowStatusForClassification(
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

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function mapById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
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

function attendanceStatusForDate(
  attendanceRows: AttendanceRow[],
  employeeId: string,
  date: string,
) {
  return (
    attendanceRows.find(
      (row) => row.employeeId === employeeId && row.date === date,
    )?.status ?? "none"
  );
}

function timelinePolicyForDate(input: {
  employee: Employee;
  date: string;
  outageWindow: OutageWindowRow;
  attendanceRows: AttendanceRow[];
  payrollRows: PayrollRow[];
}): TimelinePolicy {
  return {
    employeeExists: true,
    employeeStatus: input.employee.status,
    attendanceStatus: attendanceStatusForDate(
      input.attendanceRows,
      input.employee.id,
      input.date,
    ),
    isRestDay: isRestDay(input.date, input.employee.restDays),
    payrollStatus: payrollStatusForDate(input.payrollRows, input.date),
    confirmedWindow: {
      startsAt: input.outageWindow.startsAt.toISOString(),
      endsAt: input.outageWindow.endsAt.toISOString(),
    },
    now: new Date().toISOString(),
  };
}

function baseTimelinePolicy(input: {
  employee: Employee;
  outageWindow: OutageWindowRow;
}): TimelinePolicy {
  return {
    employeeExists: true,
    employeeStatus: input.employee.status,
    attendanceStatus: "none",
    payrollStatus: "none",
    confirmedWindow: {
      startsAt: input.outageWindow.startsAt.toISOString(),
      endsAt: input.outageWindow.endsAt.toISOString(),
    },
    now: new Date().toISOString(),
  };
}

function groupRowsByEmployee(rows: ImportRow[]) {
  const groups = new Map<string, ImportRow[]>();

  for (const row of rows) {
    const key = row.rawEmployeeCode?.trim().toUpperCase() ?? "";
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return groups;
}

async function updateBatchCounts(tx: Tx, batchId: string) {
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

async function requireBatchContext(database: DbLike, batchId: string) {
  const batch = await database.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });
  if (!batch) throw new Error("Offline attendance import batch was not found.");
  if (!batch.workbookId || !batch.outageWindowId) {
    throw new Error("Offline attendance import batch is missing workbook data.");
  }

  const workbook = await database.query.attendanceOfflineWorkbooks.findFirst({
    where: eq(attendanceOfflineWorkbooks.id, batch.workbookId),
  });
  if (!workbook) throw new Error("Offline attendance workbook was not found.");

  const outageWindow = await database.query.attendanceOutageWindows.findFirst({
    where: eq(attendanceOutageWindows.id, batch.outageWindowId),
  });
  if (!outageWindow) {
    throw new Error("Offline attendance outage window was not found.");
  }

  return { batch, workbook, outageWindow };
}

async function loadRelevantLiveData(input: {
  database: DbLike;
  rows: ImportRow[];
  employeeIds: string[];
}) {
  const timestamps = input.rows
    .map(rowTimestamp)
    .filter((value): value is Date => value !== null);

  if (timestamps.length === 0 || input.employeeIds.length === 0) {
    return {
      punches: [] as Array<typeof attendancePunches.$inferSelect>,
      attendanceRows: [] as AttendanceRow[],
      payrollRows: [] as PayrollRow[],
    };
  }

  const minMs = Math.min(...timestamps.map((date) => date.getTime()));
  const maxMs = Math.max(...timestamps.map((date) => date.getTime()));
  const startsAt = new Date(minMs - DAY_MS);
  const endsAt = new Date(maxMs + DAY_MS);
  const startDate = toPKTDate(startsAt);
  const endDate = toPKTDate(endsAt);

  const punches = await input.database.query.attendancePunches.findMany({
    where: and(
      inArray(attendancePunches.employeeId, input.employeeIds),
      gte(attendancePunches.timestamp, startsAt),
      lte(attendancePunches.timestamp, endsAt),
    ),
    orderBy: [asc(attendancePunches.timestamp)],
  });
  const attendanceRows = await input.database.query.attendance.findMany({
    where: and(
      inArray(attendance.employeeId, input.employeeIds),
      gte(attendance.date, startDate),
      lte(attendance.date, endDate),
    ),
  });
  const payrollRows = await input.database.query.payrolls.findMany({
    where: and(
      lte(payrolls.startDate, endDate),
      gte(payrolls.endDate, startDate),
    ),
  });

  return { punches, attendanceRows, payrollRows };
}

async function loadImportedClaims(input: {
  tx: Tx;
  workbookId: string;
  rows: ImportRow[];
}): Promise<ImportedIdentityClaim[]> {
  const tokens = unique(input.rows.map((row) => row.recordToken).filter(Boolean));
  if (tokens.length === 0) return [];

  const importedRows = await input.tx.query.attendanceImportRows.findMany({
    where: and(
      eq(attendanceImportRows.workbookId, input.workbookId),
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

async function persistClassification(input: {
  tx: Tx;
  rows: ImportRow[];
  employeeId: string;
  classification: TimelineClassification;
}) {
  const status = rowStatusForClassification(input.classification);
  const reason = reasonForClassification(input.classification);
  const candidateRows = new Map(
    input.classification.candidateRows.map((row) => [row.candidateRowId, row]),
  );

  for (const row of input.rows) {
    const candidate = candidateRows.get(row.id);
    const timestamp = rowTimestamp(row);
    await input.tx
      .update(attendanceImportRows)
      .set({
        employeeId: input.employeeId,
        attendanceDate:
          candidate?.attendanceDate ??
          row.attendanceDate ??
          (timestamp ? toPKTDate(timestamp) : null),
        status,
        reasonCode: reason.reasonCode,
        reasonMessage: reason.reasonMessage,
        updatedAt: new Date(),
      })
      .where(eq(attendanceImportRows.id, row.id));
  }
}

async function persistInvalidRows(input: {
  tx: Tx;
  rows: ImportRow[];
  employeeId: string | null;
  reasonCode: string;
  reasonMessage: string;
}) {
  for (const row of input.rows) {
    if (row.status === "imported" || row.status === "excluded") continue;
    await input.tx
      .update(attendanceImportRows)
      .set({
        employeeId: input.employeeId,
        status: "invalid",
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        updatedAt: new Date(),
      })
      .where(eq(attendanceImportRows.id, row.id));
  }
}

async function classifyRowsForEmployee(input: {
  tx: Tx;
  rows: ImportRow[];
  employee: Employee;
  outageWindow: OutageWindowRow;
  existingPunches: TimelinePunch[];
  importedClaims: ImportedIdentityClaim[];
  attendanceRows: AttendanceRow[];
  payrollRows: PayrollRow[];
}) {
  const eligibleRows = input.rows.filter(
    (row) => row.status === "pending" || row.status === "ready",
  );
  const candidateRows = eligibleRows.map((row) =>
    rowToCandidate(row, input.employee.id),
  );

  if (candidateRows.includes(null)) {
    await persistInvalidRows({
      tx: input.tx,
      rows: eligibleRows,
      employeeId: input.employee.id,
      reasonCode: "invalid_literal_values",
      reasonMessage: "Row has invalid timestamp or direction",
    });
    return;
  }

  const candidates = candidateRows as TimelineCandidatePunch[];
  if (candidates.length === 0) return;

  const firstPass = classifyOfflineTimeline({
    existing: input.existingPunches,
    candidates,
    importedClaims: input.importedClaims,
    policy: baseTimelinePolicy({
      employee: input.employee,
      outageWindow: input.outageWindow,
    }),
  });

  let finalClassification = firstPass;
  if (firstPass.status === "ready") {
    finalClassification = classifyOfflineTimeline({
      existing: input.existingPunches,
      candidates,
      importedClaims: input.importedClaims,
      policy: timelinePolicyForDate({
        employee: input.employee,
        date: firstPass.attendanceDate,
        outageWindow: input.outageWindow,
        attendanceRows: input.attendanceRows,
        payrollRows: input.payrollRows,
      }),
    });
  }

  await persistClassification({
    tx: input.tx,
    rows: eligibleRows,
    employeeId: input.employee.id,
    classification: finalClassification,
  });
}

async function heartbeatCountForBatch(
  database: DbLike,
  workbook: WorkbookRow,
  outageWindow: OutageWindowRow,
) {
  const [result] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(attendanceTerminalHeartbeats)
    .where(
      and(
        eq(
          attendanceTerminalHeartbeats.terminalUserId,
          workbook.assignedOperatorUserId,
        ),
        gte(attendanceTerminalHeartbeats.minuteBucket, outageWindow.startsAt),
        lte(attendanceTerminalHeartbeats.minuteBucket, outageWindow.endsAt),
      ),
    );

  return Number(result?.count ?? 0);
}

function timelineEventsForGroup(input: {
  group: OfflineEmployeeDayGroup;
  punches: TimelinePunch[];
}): OfflinePreviewTimelineEvent[] {
  const proposed = input.group.rows
    .map((row): OfflinePreviewTimelineEvent | null => {
      const direction = asDirection(row.rawDirection);
      if (!row.normalizedTimestamp || !direction) return null;
      return {
        id: row.id,
        source: "offline_excel",
        timestamp: row.normalizedTimestamp,
        direction,
        attendanceDate: row.attendanceDate ?? input.group.attendanceDate,
        rowStatus: row.status,
      };
    })
    .filter((event): event is OfflinePreviewTimelineEvent => event !== null);

  const existing = input.punches
    .filter(
      (punch) =>
        punch.employeeId === input.group.employeeId &&
        punch.attendanceDate === input.group.attendanceDate,
    )
    .map((punch): OfflinePreviewTimelineEvent => ({
      id: punch.id,
      source: punch.source,
      timestamp: punch.timestamp,
      direction: punch.direction,
      attendanceDate: punch.attendanceDate,
    }));

  return [...existing, ...proposed].sort((left, right) => {
    const timeDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
  });
}

export async function buildAndPersistOfflinePreview(
  batchId: string,
): Promise<OfflineImportPreview> {
  return await db.transaction(async (tx) => {
    const { batch, workbook, outageWindow } = await requireBatchContext(tx, batchId);
    if (
      batch.status !== "preview_ready" &&
      batch.status !== "awaiting_supervisor" &&
      batch.status !== "importing"
    ) {
      throw new Error("Offline attendance batch is not ready for preview.");
    }
    if (outageWindow.status !== "confirmed") {
      throw new Error("Supervisor must confirm the outage before preview.");
    }

    const rows = await tx.query.attendanceImportRows.findMany({
      where: eq(attendanceImportRows.batchId, batchId),
      orderBy: [asc(attendanceImportRows.worksheetRowNumber)],
    });

    const rowsByCode = groupRowsByEmployee(
      rows.filter(
        (row) => row.status !== "imported" && row.status !== "excluded",
      ),
    );
    const employeeCodes = [...rowsByCode.keys()];
    const employeeRows = employeeCodes.length
      ? await tx.query.employees.findMany({
          where: inArray(employees.employeeCode, employeeCodes),
        })
      : [];
    const employeesByCode = new Map(
      employeeRows.map((employee) => [
        employee.employeeCode.trim().toUpperCase(),
        employee,
      ]),
    );

    for (const [code, codeRows] of rowsByCode) {
      const employee = employeesByCode.get(code);
      if (!employee) {
        await persistInvalidRows({
          tx,
          rows: codeRows,
          employeeId: null,
          reasonCode: "unknown_employee",
          reasonMessage: "Employee code does not match an employee",
        });
      }
    }

    const employeeIds = unique(employeeRows.map((employee) => employee.id));
    const liveData = await loadRelevantLiveData({
      database: tx,
      rows,
      employeeIds,
    });
    const punchesByEmployee = new Map<string, TimelinePunch[]>();
    for (const punch of liveData.punches.map(punchToTimeline)) {
      const list = punchesByEmployee.get(punch.employeeId) ?? [];
      list.push(punch);
      punchesByEmployee.set(punch.employeeId, list);
    }

    const importedClaims = await loadImportedClaims({
      tx,
      workbookId: workbook.id,
      rows,
    });

    for (const [code, codeRows] of rowsByCode) {
      const employee = employeesByCode.get(code);
      if (!employee) continue;

      await classifyRowsForEmployee({
        tx,
        rows: codeRows,
        employee,
        outageWindow,
        existingPunches: punchesByEmployee.get(employee.id) ?? [],
        importedClaims,
        attendanceRows: liveData.attendanceRows,
        payrollRows: liveData.payrollRows,
      });
    }

    const counts = await updateBatchCounts(tx, batchId);
    await tx
      .update(attendanceImportBatches)
      .set({
        status: "preview_ready",
        updatedAt: new Date(),
      })
      .where(eq(attendanceImportBatches.id, batchId));

    const refreshedRows = await tx.query.attendanceImportRows.findMany({
      where: eq(attendanceImportRows.batchId, batchId),
      orderBy: [asc(attendanceImportRows.worksheetRowNumber)],
    });
    const classifiedRows = refreshedRows.map(rowToClassified);
    const groups = groupOfflineRows(classifiedRows).map((group) => ({
      ...group,
      timeline: timelineEventsForGroup({
        group,
        punches: [...punchesByEmployee.values()].flat(),
      }),
    }));
    const heartbeatCount = await heartbeatCountForBatch(
      tx,
      workbook,
      outageWindow,
    );

    return {
      batchId,
      status: "preview_ready",
      counts,
      groups,
      heartbeatCount,
    };
  });
}

export async function getOfflineImportBatchPreview(
  batchId: string,
): Promise<OfflineImportPreview> {
  const { batch, workbook, outageWindow } = await requireBatchContext(db, batchId);
  const rows = await db.query.attendanceImportRows.findMany({
    where: eq(attendanceImportRows.batchId, batchId),
    orderBy: [asc(attendanceImportRows.worksheetRowNumber)],
  });
  const employeeIds = unique(
    rows
      .map((row) => row.employeeId)
      .filter((value): value is string => Boolean(value)),
  );
  const liveData = await loadRelevantLiveData({
    database: db,
    rows,
    employeeIds,
  });
  const punches = liveData.punches.map(punchToTimeline);
  const groups = groupOfflineRows(rows.map(rowToClassified)).map((group) => ({
    ...group,
    timeline: timelineEventsForGroup({ group, punches }),
  }));
  const heartbeatCount = await heartbeatCountForBatch(
    db,
    workbook,
    outageWindow,
  );

  return {
    batchId,
    status: batch.status,
    counts: batchCounts(batch),
    groups,
    heartbeatCount,
  };
}

export async function getOfflineImportQueues(): Promise<OfflineImportQueues> {
  const rows = await db
    .select({
      batch: attendanceImportBatches,
      workbook: attendanceOfflineWorkbooks,
      outage: attendanceOutageWindows,
      operatorName: user.name,
    })
    .from(attendanceImportBatches)
    .leftJoin(
      attendanceOfflineWorkbooks,
      eq(attendanceImportBatches.workbookId, attendanceOfflineWorkbooks.id),
    )
    .leftJoin(
      attendanceOutageWindows,
      eq(attendanceImportBatches.outageWindowId, attendanceOutageWindows.id),
    )
    .leftJoin(
      user,
      eq(attendanceOfflineWorkbooks.assignedOperatorUserId, user.id),
    )
    .where(
      inArray(attendanceImportBatches.status, [
        "awaiting_supervisor",
        "preview_ready",
        "importing",
      ]),
    )
    .orderBy(asc(attendanceImportBatches.uploadedAt));

  const items = rows.map((row): OfflineImportQueueItem => ({
    batchId: row.batch.id,
    workbookId: row.batch.workbookId,
    outageWindowId: row.batch.outageWindowId,
    status: row.batch.status,
    uploadedAt: row.batch.uploadedAt.toISOString(),
    operatorUserId: row.workbook?.assignedOperatorUserId ?? null,
    operatorName: row.operatorName ?? null,
    outageStatus: row.outage?.status ?? null,
    startsAt: dateToIso(row.outage?.startsAt ?? null),
    endsAt: dateToIso(row.outage?.endsAt ?? null),
    counts: batchCounts(row.batch),
  }));

  return {
    awaitingSupervisor: items.filter(
      (item) => item.status === "awaiting_supervisor",
    ),
    readyForReview: items.filter((item) => item.status !== "awaiting_supervisor"),
  };
}

export async function excludeOfflineImportRows(input: {
  batchId: string;
  rowIds: string[];
  reason: string;
}) {
  const rowIds = unique(input.rowIds);
  if (rowIds.length === 0) {
    throw new Error("Select at least one offline attendance row.");
  }

  return await db.transaction(async (tx) => {
    const rows = await tx.query.attendanceImportRows.findMany({
      where: and(
        eq(attendanceImportRows.batchId, input.batchId),
        inArray(attendanceImportRows.id, rowIds),
      ),
    });

    if (rows.length !== rowIds.length) {
      throw new Error("One or more selected rows were not found.");
    }

    const blocked = rows.find(
      (row) =>
        row.status !== "needs_review" &&
        row.status !== "invalid" &&
        row.status !== "blocked",
    );
    if (blocked) {
      throw new Error("Only review, invalid, or blocked rows can be excluded.");
    }

    await tx
      .update(attendanceImportRows)
      .set({
        status: "excluded",
        reasonCode: "excluded_by_reviewer",
        reasonMessage: input.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attendanceImportRows.batchId, input.batchId),
          inArray(attendanceImportRows.id, rowIds),
        ),
      );

    const counts = await updateBatchCounts(tx, input.batchId);
    return {
      batchId: input.batchId,
      counts,
    };
  });
}
