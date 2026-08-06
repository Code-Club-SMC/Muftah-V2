import { z } from "zod";

export const OFFLINE_ATTENDANCE_WORKBOOK_FORMAT =
  "titan-offline-attendance" as const;

export const OFFLINE_ATTENDANCE_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

export const offlineDirectionSchema = z.enum(["IN", "OUT"]);
export const offlineWorkbookStatusSchema = z.enum([
  "active",
  "retired",
  "replaced",
]);

export type OfflineDirection = z.infer<typeof offlineDirectionSchema>;
export type OfflineWorkbookStatus = z.infer<typeof offlineWorkbookStatusSchema>;

export type WorkbookManifest = {
  format: typeof OFFLINE_ATTENDANCE_WORKBOOK_FORMAT;
  workbookId: string;
  operatorUserId: string;
  templateVersion: number;
  rowCapacity: number;
  signingVersion: number;
  issuedAt: string;
};

export type WorkbookTemplateInput = {
  workbookId: string;
  operatorUserId: string;
  operatorName: string;
  templateVersion: number;
  rowCapacity: number;
  signingVersion: number;
  issuedAt: string;
};

export type OfflineWorkbookSummary = {
  id: string;
  operatorUserId: string;
  operatorName: string;
  templateVersion: number;
  rowCapacity: number;
  signingVersion: number;
  highestSeenRow: number;
  remainingRows: number;
  status: OfflineWorkbookStatus;
  issuedAt: string;
  replacedByWorkbookId: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
};

export type OfflineParseIssue = {
  code: string;
  message: string;
};

export type ParsedOfflineRow = {
  worksheetRowNumber: number;
  recordToken: string;
  rawEmployeeCode: string;
  rawDate: string;
  rawTime: string;
  rawDirection: string;
  rawNote: string | null;
  normalizedTimestamp: string | null;
  contentHash: string;
  parseIssues: OfflineParseIssue[];
};

export type ParsedOfflineWorkbook = {
  manifest: WorkbookManifest;
  fileSha256: string;
  rows: ParsedOfflineRow[];
};

export type OfflineImportCounts = {
  totalRows: number;
  readyRows: number;
  duplicateRows: number;
  reviewRows: number;
  invalidRows: number;
  blockedRows: number;
  importedRows: number;
  excludedRows: number;
};

export type UploadBatchResult = {
  batchId: string;
  status: "awaiting_supervisor" | "rejected";
  counts: OfflineImportCounts;
};

export type OfflineWorkbookDownloadHeadersInput = {
  operatorName: string;
  workbookId: string;
};

export type OfflineWorkbookDownloadHeaders = {
  "Content-Type": typeof OFFLINE_ATTENDANCE_XLSX_CONTENT_TYPE;
  "Content-Disposition": string;
  "Cache-Control": "no-store";
  "X-Content-Type-Options": "nosniff";
};

export function canWorkbookAcceptUploads(status: OfflineWorkbookStatus) {
  return status === "active";
}

function sanitizeFilenamePart(value: string) {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);

  return safe || "unknown";
}

export function buildOfflineWorkbookFilename(
  input: OfflineWorkbookDownloadHeadersInput,
) {
  return [
    "offline-attendance",
    sanitizeFilenamePart(input.operatorName),
    sanitizeFilenamePart(input.workbookId),
  ].join("-") + ".xlsx";
}

export function buildOfflineWorkbookDownloadHeaders(
  input: OfflineWorkbookDownloadHeadersInput,
): OfflineWorkbookDownloadHeaders {
  return {
    "Content-Type": OFFLINE_ATTENDANCE_XLSX_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${buildOfflineWorkbookFilename(input)}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
