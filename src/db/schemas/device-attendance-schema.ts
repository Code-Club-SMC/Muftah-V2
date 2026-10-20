import { createId } from "@paralleldrive/cuid2";
import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { attendancePunches, employees } from "./hr-schema";
import type {
  DeviceImportRowPreview,
  DevicePunchReport,
} from "@/lib/attendance/device-import/contracts";

export const deviceAttendanceImports = pgTable(
  "device_attendance_imports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    filename: text("filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    report: jsonb("report").$type<DevicePunchReport>().notNull(),
    status: text("status", { enum: ["preview", "completed"] })
      .notNull()
      .default("preview"),
    resultRows: jsonb("result_rows").$type<DeviceImportRowPreview[]>(),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => user.id),
    confirmedByUserId: text("confirmed_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("device_attendance_imports_created_idx").on(table.createdAt),
  ],
);

export const deviceAttendancePersonMappings = pgTable(
  "device_attendance_person_mappings",
  {
    personId: text("person_id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    linkedByUserId: text("linked_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("device_attendance_person_employee_idx").on(table.employeeId),
  ],
);

// The claim is deliberately retained when HR deletes/corrects its punch.
export const deviceAttendancePunchClaims = pgTable(
  "device_attendance_punch_claims",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    importId: text("import_id")
      .notNull()
      .references(() => deviceAttendanceImports.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    reportDate: date("report_date").notNull(),
    attendanceDate: date("attendance_date").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    punchId: text("punch_id").references(() => attendancePunches.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("device_attendance_punch_identity_idx").on(
      table.employeeId,
      table.timestamp,
    ),
    index("device_attendance_claim_date_idx").on(
      table.employeeId,
      table.attendanceDate,
    ),
  ],
);
