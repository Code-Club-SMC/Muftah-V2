import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceImportBatches,
  attendanceImportRows,
  attendanceOfflineWorkbooks,
  attendanceOutageWindows,
  db,
} from "@/db";
import {
  OFFLINE_WORKBOOK_MAX_BYTES,
} from "@/lib/attendance/offline/constants";
import {
  canWorkbookAcceptUploads,
  type OfflineImportCounts,
  type UploadBatchResult,
} from "@/lib/attendance/offline/contracts";
import { requireOfflineAttendanceEnabled } from "@/lib/attendance/offline/feature-flag.server";
import { parseOfflineAttendanceWorkbook } from "@/lib/attendance/offline/workbook-parser.server";
import { requireOfflineAttendanceUploadMiddleware } from "@/lib/middlewares";

const uploadMetadataSchema = z.object({
  outageStartsAt: z.string().datetime({ offset: true }),
  outageEndsAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(5).max(500),
});

function emptyCounts(): OfflineImportCounts {
  return {
    totalRows: 0,
    readyRows: 0,
    duplicateRows: 0,
    reviewRows: 0,
    invalidRows: 0,
    blockedRows: 0,
    importedRows: 0,
    excludedRows: 0,
  };
}

function isXlsxFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".xlsx") &&
    (!file.type ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  );
}

function getUploadMetadata(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new Error("Upload must include an XLSX file.");
  }
  if (!isXlsxFile(file)) {
    throw new Error("Upload must be an .xlsx workbook.");
  }
  if (file.size <= 0 || file.size > OFFLINE_WORKBOOK_MAX_BYTES) {
    throw new Error("Workbook file size is not allowed.");
  }

  const metadata = uploadMetadataSchema.parse({
    outageStartsAt: form.get("outageStartsAt"),
    outageEndsAt: form.get("outageEndsAt"),
    reason: form.get("reason"),
  });

  const startsAt = new Date(metadata.outageStartsAt);
  const endsAt = new Date(metadata.outageEndsAt);
  if (startsAt >= endsAt) {
    throw new Error("Outage start must be before outage end.");
  }
  if (endsAt > new Date()) {
    throw new Error("Outage end cannot be in the future.");
  }

  return {
    file,
    startsAt,
    endsAt,
    reason: metadata.reason,
  };
}

function countsForRows(rows: Array<{ parseIssues: unknown[] }>): OfflineImportCounts {
  return {
    ...emptyCounts(),
    totalRows: rows.length,
    invalidRows: rows.filter((row) => row.parseIssues.length > 0).length,
  };
}

async function storeRejectedUpload(input: {
  filename: string;
  fileSha256: string;
  byteSize: number;
  uploadedByUserId: string;
}): Promise<UploadBatchResult> {
  const [batch] = await db
    .insert(attendanceImportBatches)
    .values({
      uploadedByUserId: input.uploadedByUserId,
      originalFilename: input.filename,
      fileSha256: input.fileSha256,
      byteSize: input.byteSize,
      status: "rejected",
      lastError: "unsafe_workbook",
      ...emptyCounts(),
    })
    .returning({ id: attendanceImportBatches.id });

  if (!batch) {
    throw new Error("Failed to record rejected offline attendance upload.");
  }

  return {
    batchId: batch.id,
    status: "rejected",
    counts: emptyCounts(),
  };
}

export const uploadOfflineAttendanceWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineAttendanceUploadMiddleware])
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Expected FormData");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<UploadBatchResult> => {
    requireOfflineAttendanceEnabled();

    const upload = getUploadMetadata(data);
    const file = upload.file;
    const bytes = new Uint8Array(await file.arrayBuffer());

    let parsed: Awaited<ReturnType<typeof parseOfflineAttendanceWorkbook>>;
    try {
      parsed = await parseOfflineAttendanceWorkbook(bytes);
    } catch {
      const fileSha256 = await crypto.subtle.digest("SHA-256", bytes);
      return await storeRejectedUpload({
        filename: file.name,
        fileSha256: Array.from(new Uint8Array(fileSha256))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
        byteSize: bytes.byteLength,
        uploadedByUserId: context.session.user.id,
      });
    }

    return await db.transaction(async (tx) => {
      const workbook = await tx.query.attendanceOfflineWorkbooks.findFirst({
        where: and(
          eq(attendanceOfflineWorkbooks.id, parsed.manifest.workbookId),
          eq(
            attendanceOfflineWorkbooks.assignedOperatorUserId,
            parsed.manifest.operatorUserId,
          ),
          eq(attendanceOfflineWorkbooks.signingVersion, parsed.manifest.signingVersion),
        ),
      });

      if (!workbook || !canWorkbookAcceptUploads(workbook.status)) {
        throw new Error("Workbook is not active for offline attendance upload.");
      }

      const [outageWindow] = await tx
        .insert(attendanceOutageWindows)
        .values({
          workbookId: workbook.id,
          startsAt: upload.startsAt,
          endsAt: upload.endsAt,
          reason: upload.reason,
          status: "pending",
          declaredByUserId: context.session.user.id,
        })
        .returning({ id: attendanceOutageWindows.id });

      if (!outageWindow) {
        throw new Error("Failed to record offline attendance outage.");
      }

      const counts = countsForRows(parsed.rows);
      const [batch] = await tx
        .insert(attendanceImportBatches)
        .values({
          workbookId: workbook.id,
          outageWindowId: outageWindow.id,
          uploadedByUserId: context.session.user.id,
          originalFilename: file.name,
          fileSha256: parsed.fileSha256,
          byteSize: bytes.byteLength,
          status: "awaiting_supervisor",
          ...counts,
        })
        .returning({ id: attendanceImportBatches.id });

      if (!batch) {
        throw new Error("Failed to stage offline attendance import batch.");
      }

      if (parsed.rows.length > 0) {
        await tx.insert(attendanceImportRows).values(
          parsed.rows.map((row) => {
            const firstIssue = row.parseIssues[0] ?? null;
            return {
              batchId: batch.id,
              workbookId: workbook.id,
              worksheetRowNumber: row.worksheetRowNumber,
              recordToken: row.recordToken,
              rawEmployeeCode: row.rawEmployeeCode || null,
              rawDate: row.rawDate || null,
              rawTime: row.rawTime || null,
              rawDirection: row.rawDirection || null,
              rawNote: row.rawNote,
              normalizedTimestamp: row.normalizedTimestamp
                ? new Date(row.normalizedTimestamp)
                : null,
              contentHash: row.contentHash,
              status: firstIssue ? ("invalid" as const) : ("pending" as const),
              reasonCode: firstIssue?.code ?? null,
              reasonMessage: firstIssue?.message ?? null,
            };
          }),
        );
      }

      return {
        batchId: batch.id,
        status: "awaiting_supervisor",
        counts,
      };
    });
  });
