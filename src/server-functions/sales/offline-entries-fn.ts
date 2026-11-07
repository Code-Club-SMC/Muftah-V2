import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, offlineSalesInvoiceSlots, offlineSalesWorkbooks } from "@/db";
import {
  OFFLINE_SALES_FACTORY_CODE,
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_ITEM_CAPACITY,
  OFFLINE_SALES_PAYMENT_CAPACITY,
} from "@/lib/sales/offline/constants";
import type {
  OfflineSalesManifest,
  OfflineSalesReferenceSnapshot,
  OfflineSalesUploadResult,
} from "@/lib/sales/offline/contracts";
import { type OfflineDeskPack, toDeskReference } from "@/lib/sales/offline/desk-pack";
import { buildParsedWorkbookFromEntries } from "@/lib/sales/offline/entry-processor.server";
import { offlineEntriesSchema } from "@/lib/sales/offline/entry-schema";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import {
  hashOfflineSalesSnapshot,
  verifyOfflineSalesManifest,
  verifyOfflineSalesSnapshot,
} from "@/lib/sales/offline/signing.server";
import { requireOfflineSalesUploadMiddleware } from "@/lib/middlewares";
import { stageOfflineSalesUpload } from "./offline-upload-fn";
import { ensureDeskWorkbook } from "./offline-workbooks-fn";

type Workbook = typeof offlineSalesWorkbooks.$inferSelect;

/** Refuses a set of invoice numbers unless its stored signatures still verify. */
async function loadVerifiedWorkbook(workbook: Workbook) {
  const snapshot = workbook.referenceSnapshot as unknown as OfflineSalesReferenceSnapshot;
  const manifest: OfflineSalesManifest = {
    format: "titan-offline-sales",
    workbookId: workbook.id,
    factoryCode: OFFLINE_SALES_FACTORY_CODE,
    operatorUserId: workbook.operatorUserId,
    templateVersion: workbook.templateVersion,
    signingVersion: workbook.signingVersion,
    invoiceCapacity: OFFLINE_SALES_INVOICE_CAPACITY,
    itemCapacity: OFFLINE_SALES_ITEM_CAPACITY,
    paymentCapacity: OFFLINE_SALES_PAYMENT_CAPACITY,
    issuedAt: workbook.issuedAt.toISOString(),
    snapshotSha256: workbook.snapshotSha256,
  };
  if (
    hashOfflineSalesSnapshot(snapshot) !== workbook.snapshotSha256 ||
    !verifyOfflineSalesSnapshot(snapshot, workbook.signingVersion, workbook.snapshotSignature) ||
    !verifyOfflineSalesManifest(manifest, workbook.manifestSignature)
  ) {
    throw new Error("Offline sales signing data is invalid.");
  }
  return { snapshot, manifest };
}

/**
 * Everything the factory computer needs to take invoices without the server:
 * the price list and the invoice numbers reserved for it. If none have
 * been issued yet, one is issued right here, so nobody waits for the office.
 */
export const getOfflineSalesPackFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesUploadMiddleware])
  // The desk says whether any printed invoice is still waiting to be sent. If
  // none is, the price list is refreshed; if some are, prices stay as printed.
  .inputValidator(z.object({ hasUnsentInvoices: z.boolean() }))
  .handler(async ({ data, context }): Promise<OfflineDeskPack> => {
    requireOfflineSalesEnabled();
    const workbook = await ensureDeskWorkbook(context.session.user.id, {
      refreshPrices: !data.hasUnsentInvoices,
    });
    const { snapshot } = await loadVerifiedWorkbook(workbook);
    const slots = await db
      .select({
        slotNumber: offlineSalesInvoiceSlots.slotNumber,
        reservedSerial: offlineSalesInvoiceSlots.reservedSerial,
        recordToken: offlineSalesInvoiceSlots.recordToken,
      })
      .from(offlineSalesInvoiceSlots)
      .where(
        and(
          eq(offlineSalesInvoiceSlots.workbookId, workbook.id),
          eq(offlineSalesInvoiceSlots.status, "unused"),
        ),
      )
      .orderBy(asc(offlineSalesInvoiceSlots.slotNumber));
    return {
      workbookId: workbook.id,
      operatorName: context.session.user.name,
      issuedAt: workbook.issuedAt.toISOString(),
      invoiceCapacity: workbook.invoiceCapacity,
      reference: toDeskReference(snapshot),
      slots,
    };
  });

const sendSchema = z.object({
  workbookId: z.string().min(1),
  outageStartedAt: z.string().datetime({ offset: true }),
  outageEndedAt: z.string().datetime({ offset: true }),
  outageReason: z.string().trim().min(5).max(500),
  source: z.enum(["desk", "backup_file"]),
  entries: offlineEntriesSchema,
});

/**
 * Receives invoices typed in the browser. They go through the same staging,
 * classification, review and posting; the only
 * difference is where the rows come from.
 */
export const sendOfflineSalesEntriesFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesUploadMiddleware])
  .inputValidator(sendSchema)
  .handler(async ({ data, context }): Promise<OfflineSalesUploadResult> => {
    requireOfflineSalesEnabled();
    const outageStartedAt = new Date(data.outageStartedAt);
    const outageEndedAt = new Date(data.outageEndedAt);
    if (outageStartedAt >= outageEndedAt) throw new Error("Outage start must be before outage end.");
    if (outageEndedAt > new Date()) throw new Error("Outage end cannot be in the future.");

    const [workbook] = await db
      .select()
      .from(offlineSalesWorkbooks)
      .where(eq(offlineSalesWorkbooks.id, data.workbookId))
      .limit(1);
    if (!workbook) throw new Error("These invoice numbers were not issued by the system.");
    const { snapshot, manifest } = await loadVerifiedWorkbook(workbook);
    const slots = await db
      .select({
        slotNumber: offlineSalesInvoiceSlots.slotNumber,
        reservedSerial: offlineSalesInvoiceSlots.reservedSerial,
        recordToken: offlineSalesInvoiceSlots.recordToken,
      })
      .from(offlineSalesInvoiceSlots)
      .where(eq(offlineSalesInvoiceSlots.workbookId, workbook.id));

    const parsed = buildParsedWorkbookFromEntries({
      manifest,
      manifestSignature: workbook.manifestSignature,
      snapshot,
      snapshotSignature: workbook.snapshotSignature,
      slots,
      entries: data.entries,
    });
    return await stageOfflineSalesUpload({
      parsed,
      metadata: {
        filename:
          data.source === "desk"
            ? `offline-desk-${workbook.id}.entries`
            : `offline-backup-${workbook.id}.json`,
        byteSize: Buffer.byteLength(JSON.stringify(data.entries), "utf8"),
        outageStartedAt,
        outageEndedAt,
        outageReason: data.outageReason,
        uploadedByUserId: context.session.user.id,
      },
    });
  });
