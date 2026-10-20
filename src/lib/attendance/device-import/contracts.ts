export const DEVICE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const DEVICE_IMPORT_MAX_ROWS = 20_000;

export type DevicePunchReportRow = {
  rowNumber: number;
  personId: string;
  personName: string;
  department: string;
  date: string | null;
  punches: string[];
  reportedCount: number | null;
  issues: string[];
};

export type DevicePunchReport = {
  format: "csv" | "xlsx";
  rows: DevicePunchReportRow[];
};

export type DeviceImportMappings = Record<string, string>;
export type DeviceImportRowStatus =
  | "ready"
  | "unchanged"
  | "needs_review"
  | "blocked"
  | "imported";

export type DeviceImportRowPreview = {
  rowNumber: number;
  personId: string;
  personName: string;
  employeeId: string | null;
  employeeName: string | null;
  date: string | null;
  attendanceDates?: string[];
  punchTimes: string[];
  status: DeviceImportRowStatus;
  messages: string[];
  newPunchCount: number;
  dutyHours: string | null;
};

export type DeviceImportPreview = {
  importId: string;
  filename: string;
  format: "csv" | "xlsx";
  status: "preview" | "completed";
  rows: DeviceImportRowPreview[];
  employees: { id: string; employeeCode: string; name: string }[];
};
