import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "./auth-schema";
import { attendancePunches, employees, payrolls } from "./hr-schema";

export type OfflineWorkbookStatus = "active" | "retired" | "replaced";
export type OfflineOutageStatus = "pending" | "confirmed" | "rejected";
export type OfflineBatchStatus =
  | "uploaded"
  | "awaiting_supervisor"
  | "preview_ready"
  | "importing"
  | "completed"
  | "completed_with_issues"
  | "cancelled"
  | "rejected";
export type OfflineRowStatus =
  | "pending"
  | "ready"
  | "duplicate"
  | "needs_review"
  | "invalid"
  | "blocked"
  | "imported"
  | "excluded";

type AttendanceCorrectionSnapshot = Record<string, unknown>;

export type PayrollAttendanceAffectedSummary = {
  employeeIds: string[];
  attendanceDates: string[];
};

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

const idColumn = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

export const attendanceOfflineWorkbooks = pgTable(
  "attendance_offline_workbooks",
  {
    id: idColumn(),
    assignedOperatorUserId: text("assigned_operator_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    templateVersion: integer("template_version").notNull(),
    rowCapacity: integer("row_capacity").notNull(),
    signingVersion: integer("signing_version").notNull(),
    status: text("status", {
      enum: ["active", "retired", "replaced"],
    })
      .$type<OfflineWorkbookStatus>()
      .default("active")
      .notNull(),
    issuedByUserId: text("issued_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    replacedByWorkbookId: text("replaced_by_workbook_id").references(
      (): AnyPgColumn => attendanceOfflineWorkbooks.id,
      { onDelete: "set null" },
    ),
    retiredByUserId: text("retired_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    retiredReason: text("retired_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("attendance_offline_workbooks_active_operator_idx")
      .on(table.assignedOperatorUserId)
      .where(sql`${table.status} = 'active'`),
    index("attendance_offline_workbooks_status_idx").on(table.status),
    check(
      "attendance_offline_workbooks_versions_check",
      sql`${table.templateVersion} > 0 AND ${table.signingVersion} > 0 AND ${table.rowCapacity} > 0`,
    ),
  ],
);

export const attendanceOutageWindows = pgTable(
  "attendance_outage_windows",
  {
    id: idColumn(),
    workbookId: text("workbook_id")
      .notNull()
      .references(() => attendanceOfflineWorkbooks.id, {
        onDelete: "restrict",
      }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: text("status", {
      enum: ["pending", "confirmed", "rejected"],
    })
      .$type<OfflineOutageStatus>()
      .default("pending")
      .notNull(),
    declaredByUserId: text("declared_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    confirmedByUserId: text("confirmed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "attendance_outage_windows_range_check",
      sql`${table.startsAt} < ${table.endsAt}`,
    ),
    check(
      "attendance_outage_windows_actor_check",
      sql`${table.confirmedByUserId} IS NULL OR ${table.confirmedByUserId} <> ${table.declaredByUserId}`,
    ),
    index("attendance_outage_windows_workbook_status_idx").on(
      table.workbookId,
      table.status,
    ),
  ],
);

export const attendanceImportBatches = pgTable(
  "attendance_import_batches",
  {
    id: idColumn(),
    workbookId: text("workbook_id").references(
      () => attendanceOfflineWorkbooks.id,
      { onDelete: "restrict" },
    ),
    outageWindowId: text("outage_window_id").references(
      () => attendanceOutageWindows.id,
      { onDelete: "restrict" },
    ),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    originalFilename: text("original_filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status", {
      enum: [
        "uploaded",
        "awaiting_supervisor",
        "preview_ready",
        "importing",
        "completed",
        "completed_with_issues",
        "cancelled",
        "rejected",
      ],
    })
      .$type<OfflineBatchStatus>()
      .default("uploaded")
      .notNull(),
    totalRows: integer("total_rows").default(0).notNull(),
    readyRows: integer("ready_rows").default(0).notNull(),
    duplicateRows: integer("duplicate_rows").default(0).notNull(),
    reviewRows: integer("review_rows").default(0).notNull(),
    invalidRows: integer("invalid_rows").default(0).notNull(),
    blockedRows: integer("blocked_rows").default(0).notNull(),
    importedRows: integer("imported_rows").default(0).notNull(),
    excludedRows: integer("excluded_rows").default(0).notNull(),
    lastError: text("last_error"),
    processingLeaseId: text("processing_lease_id"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", {
      withTimezone: true,
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "attendance_import_batches_byte_size_check",
      sql`${table.byteSize} > 0`,
    ),
    check(
      "attendance_import_batches_counts_check",
      sql`${table.totalRows} >= 0 AND ${table.readyRows} >= 0 AND ${table.duplicateRows} >= 0 AND ${table.reviewRows} >= 0 AND ${table.invalidRows} >= 0 AND ${table.blockedRows} >= 0 AND ${table.importedRows} >= 0 AND ${table.excludedRows} >= 0`,
    ),
    check(
      "attendance_import_batches_reviewer_check",
      sql`${table.reviewedByUserId} IS NULL OR ${table.reviewedByUserId} <> ${table.uploadedByUserId}`,
    ),
    index("attendance_import_batches_workbook_idx").on(table.workbookId),
    index("attendance_import_batches_outage_idx").on(table.outageWindowId),
    index("attendance_import_batches_status_idx").on(table.status),
    index("attendance_import_batches_file_hash_idx").on(table.fileSha256),
  ],
);

export const attendanceImportRows = pgTable(
  "attendance_import_rows",
  {
    id: idColumn(),
    batchId: text("batch_id")
      .notNull()
      .references(() => attendanceImportBatches.id, { onDelete: "cascade" }),
    workbookId: text("workbook_id")
      .notNull()
      .references(() => attendanceOfflineWorkbooks.id, {
        onDelete: "restrict",
      }),
    worksheetRowNumber: integer("worksheet_row_number").notNull(),
    recordToken: text("record_token").notNull(),
    rawEmployeeCode: text("raw_employee_code"),
    rawDate: text("raw_date"),
    rawTime: text("raw_time"),
    rawDirection: text("raw_direction"),
    rawNote: text("raw_note"),
    normalizedTimestamp: timestamp("normalized_timestamp", {
      withTimezone: true,
    }),
    attendanceDate: date("attendance_date"),
    employeeId: text("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    contentHash: text("content_hash"),
    status: text("status", {
      enum: [
        "pending",
        "ready",
        "duplicate",
        "needs_review",
        "invalid",
        "blocked",
        "imported",
        "excluded",
      ],
    })
      .$type<OfflineRowStatus>()
      .default("pending")
      .notNull(),
    reasonCode: text("reason_code"),
    reasonMessage: text("reason_message"),
    punchId: text("punch_id").references(() => attendancePunches.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    check(
      "attendance_import_rows_row_number_check",
      sql`${table.worksheetRowNumber} > 0`,
    ),
    uniqueIndex("attendance_import_rows_batch_row_idx").on(
      table.batchId,
      table.worksheetRowNumber,
    ),
    uniqueIndex("attendance_import_rows_imported_identity_idx")
      .on(table.workbookId, table.recordToken)
      .where(sql`${table.status} = 'imported'`),
    index("attendance_import_rows_batch_status_idx").on(
      table.batchId,
      table.status,
    ),
    index("attendance_import_rows_employee_date_idx").on(
      table.employeeId,
      table.attendanceDate,
    ),
  ],
);

export const attendanceTerminalHeartbeats = pgTable(
  "attendance_terminal_heartbeats",
  {
    id: idColumn(),
    terminalUserId: text("terminal_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    minuteBucket: timestamp("minute_bucket", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("attendance_terminal_heartbeats_terminal_minute_idx").on(
      table.terminalUserId,
      table.minuteBucket,
    ),
    index("attendance_terminal_heartbeats_observed_idx").on(table.observedAt),
  ],
);

export const attendancePunchCorrectionAudit = pgTable(
  "attendance_punch_correction_audit",
  {
    id: idColumn(),
    originalPunchId: text("original_punch_id").notNull(),
    originalImportRowId: text("original_import_row_id").references(
      () => attendanceImportRows.id,
      { onDelete: "restrict" },
    ),
    action: text("action", { enum: ["correct", "delete"] }).notNull(),
    oldValues: jsonb("old_values")
      .$type<AttendanceCorrectionSnapshot>()
      .notNull(),
    newValues: jsonb("new_values").$type<AttendanceCorrectionSnapshot>(),
    reason: text("reason").notNull(),
    changedByUserId: text("changed_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("attendance_punch_correction_audit_punch_idx").on(
      table.originalPunchId,
    ),
    index("attendance_punch_correction_audit_import_row_idx").on(
      table.originalImportRowId,
    ),
  ],
);

export const payrollAttendanceInvalidations = pgTable(
  "payroll_attendance_invalidations",
  {
    id: idColumn(),
    payrollId: text("payroll_id")
      .notNull()
      .references(() => payrolls.id, { onDelete: "cascade" }),
    importBatchId: text("import_batch_id")
      .notNull()
      .references(() => attendanceImportBatches.id, { onDelete: "restrict" }),
    affectedSummary: jsonb("affected_summary")
      .$type<PayrollAttendanceAffectedSummary>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("payroll_attendance_invalidations_unresolved_idx")
      .on(table.payrollId, table.importBatchId)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("payroll_attendance_invalidations_batch_idx").on(table.importBatchId),
  ],
);
