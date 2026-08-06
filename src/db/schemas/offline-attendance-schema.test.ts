import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { attendancePunches } from "./hr-schema";
import {
  attendanceImportBatches,
  attendanceImportRows,
  attendanceOfflineWorkbooks,
  attendanceOutageWindows,
  attendancePunchCorrectionAudit,
  attendanceTerminalHeartbeats,
  payrollAttendanceInvalidations,
} from "./offline-attendance-schema";

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

describe("offline attendance database contract", () => {
  it("defines every workflow table with stable names", () => {
    expect(getTableConfig(attendanceOfflineWorkbooks).name).toBe(
      "attendance_offline_workbooks",
    );
    expect(getTableConfig(attendanceOutageWindows).name).toBe(
      "attendance_outage_windows",
    );
    expect(getTableConfig(attendanceImportBatches).name).toBe(
      "attendance_import_batches",
    );
    expect(getTableConfig(attendanceImportRows).name).toBe(
      "attendance_import_rows",
    );
    expect(getTableConfig(attendanceTerminalHeartbeats).name).toBe(
      "attendance_terminal_heartbeats",
    );
    expect(getTableConfig(attendancePunchCorrectionAudit).name).toBe(
      "attendance_punch_correction_audit",
    );
    expect(getTableConfig(payrollAttendanceInvalidations).name).toBe(
      "payroll_attendance_invalidations",
    );
  });

  it("keeps one active workbook and durable imported record claims", () => {
    expect(indexNames(attendanceOfflineWorkbooks)).toContain(
      "attendance_offline_workbooks_active_operator_idx",
    );
    expect(indexNames(attendanceImportRows)).toContain(
      "attendance_import_rows_imported_identity_idx",
    );
    expect(indexNames(attendanceImportRows)).toContain(
      "attendance_import_rows_batch_row_idx",
    );
  });

  it("defines outage, size, row, heartbeat, and payroll safety constraints", () => {
    expect(checkNames(attendanceOutageWindows)).toContain(
      "attendance_outage_windows_range_check",
    );
    expect(checkNames(attendanceImportBatches)).toContain(
      "attendance_import_batches_byte_size_check",
    );
    expect(checkNames(attendanceImportRows)).toContain(
      "attendance_import_rows_row_number_check",
    );
    expect(indexNames(attendanceTerminalHeartbeats)).toContain(
      "attendance_terminal_heartbeats_terminal_minute_idx",
    );
    expect(indexNames(payrollAttendanceInvalidations)).toContain(
      "payroll_attendance_invalidations_unresolved_idx",
    );
  });

  it("links workflow tables to protected records", () => {
    expect(
      getTableConfig(attendanceOfflineWorkbooks).foreignKeys.length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      getTableConfig(attendanceImportRows).foreignKeys.length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      getTableConfig(payrollAttendanceInvalidations).foreignKeys.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("extends punch source and offline identity columns", () => {
    type PunchInsert = typeof attendancePunches.$inferInsert;
    const source: PunchInsert["source"] = "offline_excel";
    expect(source).toBe("offline_excel");

    const punchConfig = getTableConfig(attendancePunches);
    expect(punchConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "offline_import_row_id",
        "offline_import_identity",
      ]),
    );
    expect(punchConfig.indexes.map((index) => index.config.name)).toContain(
      "attendance_punches_offline_identity_idx",
    );
  });
});
