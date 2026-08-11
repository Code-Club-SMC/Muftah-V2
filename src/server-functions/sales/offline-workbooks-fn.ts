import { createId } from "@paralleldrive/cuid2";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  offlineSalesImportBatches,
  offlineSalesInvoiceSlots,
  offlineSalesWorkbooks,
  user,
} from "@/db";
import {
  OFFLINE_SALES_FACTORY_CODE,
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_ITEM_CAPACITY,
  OFFLINE_SALES_PAYMENT_CAPACITY,
  OFFLINE_SALES_TEMPLATE_VERSION,
} from "@/lib/sales/offline/constants";
import {
  type OfflineSalesManifest,
  type OfflineSalesReferenceSnapshot,
  type OfflineSalesWorkbookSummary,
  offlineSalesDownloadHeaders,
} from "@/lib/sales/offline/contracts";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import { buildOfflineSalesReferenceSnapshot } from "@/lib/sales/offline/reference-snapshot.server";
import {
  createOfflineSalesSlotToken,
  getActiveOfflineSalesSigningVersion,
  hashOfflineSalesSnapshot,
  signOfflineSalesManifest,
  signOfflineSalesSnapshot,
  verifyOfflineSalesManifest,
  verifyOfflineSalesSnapshot,
} from "@/lib/sales/offline/signing.server";
import { buildOfflineSalesWorkbook } from "@/lib/sales/offline/workbook-template.server";
import { reserveOfflineInvoiceSerials } from "@/lib/sales/invoice-number.server";
import { requireOfflineSalesWorkbookManageMiddleware } from "@/lib/middlewares";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;
type Workbook = typeof offlineSalesWorkbooks.$inferSelect;
type BatchStatus = typeof offlineSalesImportBatches.$inferSelect.status;

const UNRESOLVED_BATCH_STATUSES: BatchStatus[] = [
  "uploaded",
  "preview_ready",
  "posting",
];

const workbookIdSchema = z.object({ workbookId: z.string().min(1) });
const issueSchema = z.object({ operatorUserId: z.string().min(1) });
const replaceSchema = workbookIdSchema.extend({
  usedRowsUploaded: z.literal(true),
  operatorUserId: z.string().min(1).optional(),
});
const forceRetireSchema = workbookIdSchema.extend({
  reason: z.string().trim().min(5).max(500),
});

export type OfflineSalesOperatorOption = {
  id: string;
  name: string;
  email: string;
};

function iso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function requireOperator(database: Database, operatorUserId: string) {
  const [operator] = await database
    .select({ id: user.id, name: user.name, email: user.email, banned: user.banned })
    .from(user)
    .where(eq(user.id, operatorUserId))
    .limit(1);
  if (!operator || operator.banned) {
    throw new Error("Designated operator was not found or is disabled.");
  }
  return operator;
}

async function requireWorkbook(database: Database, workbookId: string) {
  const [workbook] = await database
    .select()
    .from(offlineSalesWorkbooks)
    .where(eq(offlineSalesWorkbooks.id, workbookId))
    .limit(1);
  if (!workbook) throw new Error("Offline sales workbook was not found.");
  return workbook;
}

async function findActiveWorkbook(database: Database, excludeId?: string) {
  return (
    await database
      .select()
      .from(offlineSalesWorkbooks)
      .where(
        and(
          eq(offlineSalesWorkbooks.factoryCode, OFFLINE_SALES_FACTORY_CODE),
          eq(offlineSalesWorkbooks.status, "active"),
          excludeId ? ne(offlineSalesWorkbooks.id, excludeId) : undefined,
        ),
      )
      .limit(1)
  )[0];
}

async function assertNoUnresolvedBatch(database: Database, workbookId: string) {
  const [batch] = await database
    .select({ id: offlineSalesImportBatches.id })
    .from(offlineSalesImportBatches)
    .where(
      and(
        eq(offlineSalesImportBatches.workbookId, workbookId),
        inArray(offlineSalesImportBatches.status, UNRESOLVED_BATCH_STATUSES),
      ),
    )
    .limit(1);
  if (batch) {
    throw new Error("Finish the current offline upload before replacing this workbook.");
  }
}

async function toSummary(
  database: Database,
  workbook: Workbook,
  operatorName: string,
): Promise<OfflineSalesWorkbookSummary> {
  const snapshot =
    workbook.referenceSnapshot as unknown as OfflineSalesReferenceSnapshot;
  const [counts] = await database
    .select({
      used: sql<number>`count(*) filter (where ${offlineSalesInvoiceSlots.status} <> 'unused')::int`,
      remaining: sql<number>`count(*) filter (where ${offlineSalesInvoiceSlots.status} = 'unused')::int`,
    })
    .from(offlineSalesInvoiceSlots)
    .where(eq(offlineSalesInvoiceSlots.workbookId, workbook.id));
  return {
    id: workbook.id,
    operatorUserId: workbook.operatorUserId,
    operatorName,
    status: workbook.status,
    issuedAt: iso(workbook.issuedAt),
    snapshotGeneratedAt: snapshot.generatedAt,
    templateVersion: workbook.templateVersion,
    signingVersion: workbook.signingVersion,
    invoiceCapacity: workbook.invoiceCapacity,
    usedSlots: Number(counts?.used ?? 0),
    remainingSlots: Number(counts?.remaining ?? 0),
    replacementWorkbookId: workbook.replacementWorkbookId,
    forceRetiredReason: workbook.forceRetiredReason,
  };
}

async function issueInTransaction(input: {
  tx: Transaction;
  operatorUserId: string;
  issuedByUserId: string;
}) {
  const operator = await requireOperator(input.tx, input.operatorUserId);
  if (await findActiveWorkbook(input.tx)) {
    throw new Error("Factory F01 already has an active offline sales workbook.");
  }
  const signingVersion = getActiveOfflineSalesSigningVersion();
  if (!signingVersion) throw new Error("Offline sales signing is disabled.");

  const issuedAt = new Date();
  const workbookId = createId();
  const snapshot = await buildOfflineSalesReferenceSnapshot(input.tx, issuedAt);
  const snapshotSha256 = hashOfflineSalesSnapshot(snapshot);
  const manifest: OfflineSalesManifest = {
    format: "titan-offline-sales",
    workbookId,
    factoryCode: OFFLINE_SALES_FACTORY_CODE,
    operatorUserId: operator.id,
    templateVersion: OFFLINE_SALES_TEMPLATE_VERSION,
    signingVersion,
    invoiceCapacity: OFFLINE_SALES_INVOICE_CAPACITY,
    itemCapacity: OFFLINE_SALES_ITEM_CAPACITY,
    paymentCapacity: OFFLINE_SALES_PAYMENT_CAPACITY,
    issuedAt: issuedAt.toISOString(),
    snapshotSha256,
  };
  const manifestSignature = signOfflineSalesManifest(manifest);
  const snapshotSignature = signOfflineSalesSnapshot(snapshot, signingVersion);
  const { start } = await reserveOfflineInvoiceSerials(
    input.tx,
    OFFLINE_SALES_INVOICE_CAPACITY,
  );

  const [workbook] = await input.tx
    .insert(offlineSalesWorkbooks)
    .values({
      id: workbookId,
      factoryCode: OFFLINE_SALES_FACTORY_CODE,
      operatorUserId: operator.id,
      issuedByUserId: input.issuedByUserId,
      status: "active",
      templateVersion: OFFLINE_SALES_TEMPLATE_VERSION,
      signingVersion,
      invoiceCapacity: OFFLINE_SALES_INVOICE_CAPACITY,
      itemCapacity: OFFLINE_SALES_ITEM_CAPACITY,
      paymentCapacity: OFFLINE_SALES_PAYMENT_CAPACITY,
      referenceSnapshot: snapshot as unknown as Record<string, unknown>,
      snapshotSha256,
      snapshotSignature,
      manifestSignature,
      issuedAt,
    })
    .returning();
  if (!workbook) throw new Error("Could not issue offline sales workbook.");

  await input.tx.insert(offlineSalesInvoiceSlots).values(
    Array.from({ length: OFFLINE_SALES_INVOICE_CAPACITY }, (_, index) => {
      const slotNumber = index + 1;
      const reservedSerial = start + index;
      return {
        id: createId(),
        workbookId,
        slotNumber,
        reservedSerial,
        recordToken: createOfflineSalesSlotToken({
          workbookId,
          operatorUserId: operator.id,
          templateVersion: OFFLINE_SALES_TEMPLATE_VERSION,
          signingVersion,
          slotNumber,
          reservedSerial,
        }),
      };
    }),
  );

  return { workbook, operator };
}

export const listOfflineSalesOperatorsFn = createServerFn()
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .handler(async (): Promise<OfflineSalesOperatorOption[]> => {
    requireOfflineSalesEnabled();
    return await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.banned, false))
      .orderBy(asc(user.name), asc(user.email));
  });

export const listOfflineSalesWorkbooksFn = createServerFn()
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .handler(async () => {
    requireOfflineSalesEnabled();
    const rows = await db
      .select({ workbook: offlineSalesWorkbooks, operatorName: user.name })
      .from(offlineSalesWorkbooks)
      .leftJoin(user, eq(offlineSalesWorkbooks.operatorUserId, user.id))
      .orderBy(desc(offlineSalesWorkbooks.issuedAt));
    return await Promise.all(
      rows.map(({ workbook, operatorName }) =>
        toSummary(db, workbook, operatorName ?? "Unknown Operator"),
      ),
    );
  });

export const issueOfflineSalesWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .inputValidator(issueSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    return await db.transaction(async (tx) => {
      const { workbook, operator } = await issueInTransaction({
        tx,
        operatorUserId: data.operatorUserId,
        issuedByUserId: context.session.user.id,
      });
      return await toSummary(tx, workbook, operator.name);
    });
  });

export const downloadOfflineSalesWorkbookFn = createServerFn()
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .inputValidator(workbookIdSchema)
  .handler(async ({ data }) => {
    requireOfflineSalesEnabled();
    const workbook = await requireWorkbook(db, data.workbookId);
    if (workbook.status !== "active") {
      throw new Error("Only the active official workbook can be downloaded.");
    }
    const operator = await requireOperator(db, workbook.operatorUserId);
    const slots = await db
      .select({
        id: offlineSalesInvoiceSlots.id,
        slotNumber: offlineSalesInvoiceSlots.slotNumber,
        reservedSerial: offlineSalesInvoiceSlots.reservedSerial,
        recordToken: offlineSalesInvoiceSlots.recordToken,
      })
      .from(offlineSalesInvoiceSlots)
      .where(eq(offlineSalesInvoiceSlots.workbookId, workbook.id))
      .orderBy(asc(offlineSalesInvoiceSlots.slotNumber));
    if (slots.length !== OFFLINE_SALES_INVOICE_CAPACITY) {
      throw new Error("Offline sales workbook slots are incomplete.");
    }
    const snapshot =
      workbook.referenceSnapshot as unknown as OfflineSalesReferenceSnapshot;
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
      issuedAt: iso(workbook.issuedAt),
      snapshotSha256: workbook.snapshotSha256,
    };
    if (
      hashOfflineSalesSnapshot(snapshot) !== workbook.snapshotSha256 ||
      !verifyOfflineSalesSnapshot(
        snapshot,
        workbook.signingVersion,
        workbook.snapshotSignature,
      ) ||
      !verifyOfflineSalesManifest(manifest, workbook.manifestSignature)
    ) {
      throw new Error("Offline sales workbook signing data is invalid.");
    }
    const bytes = await buildOfflineSalesWorkbook({
      manifest,
      manifestSignature: workbook.manifestSignature,
      snapshot,
      snapshotSignature: workbook.snapshotSignature,
      operatorName: operator.name,
      slots,
    });
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: offlineSalesDownloadHeaders({ workbookId: workbook.id }),
    });
  });

export const replaceOfflineSalesWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .inputValidator(replaceSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    return await db.transaction(async (tx) => {
      const oldWorkbook = await requireWorkbook(tx, data.workbookId);
      if (oldWorkbook.status !== "active") {
        throw new Error("Only the active workbook can be replaced.");
      }
      await assertNoUnresolvedBatch(tx, oldWorkbook.id);
      const operatorUserId = data.operatorUserId ?? oldWorkbook.operatorUserId;
      await requireOperator(tx, operatorUserId);
      const closedAt = new Date();
      await tx
        .update(offlineSalesWorkbooks)
        .set({
          status: "closed",
          closedByUserId: context.session.user.id,
          closedAt,
          updatedAt: closedAt,
        })
        .where(eq(offlineSalesWorkbooks.id, oldWorkbook.id));
      await tx
        .update(offlineSalesInvoiceSlots)
        .set({ status: "voided", updatedAt: closedAt })
        .where(
          and(
            eq(offlineSalesInvoiceSlots.workbookId, oldWorkbook.id),
            eq(offlineSalesInvoiceSlots.status, "unused"),
          ),
        );
      const { workbook, operator } = await issueInTransaction({
        tx,
        operatorUserId,
        issuedByUserId: context.session.user.id,
      });
      await tx
        .update(offlineSalesWorkbooks)
        .set({ replacementWorkbookId: workbook.id, updatedAt: new Date() })
        .where(eq(offlineSalesWorkbooks.id, oldWorkbook.id));
      return await toSummary(tx, workbook, operator.name);
    });
  });

export const forceRetireOfflineSalesWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .inputValidator(forceRetireSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    return await db.transaction(async (tx) => {
      const workbook = await requireWorkbook(tx, data.workbookId);
      if (workbook.status !== "active") {
        throw new Error("Only the active workbook can be force-retired.");
      }
      const retiredAt = new Date();
      const [retired] = await tx
        .update(offlineSalesWorkbooks)
        .set({
          status: "force_retired",
          forceRetiredByUserId: context.session.user.id,
          forceRetiredAt: retiredAt,
          forceRetiredReason: data.reason,
          updatedAt: retiredAt,
        })
        .where(eq(offlineSalesWorkbooks.id, workbook.id))
        .returning();
      await tx
        .update(offlineSalesInvoiceSlots)
        .set({ status: "voided", updatedAt: retiredAt })
        .where(
          and(
            eq(offlineSalesInvoiceSlots.workbookId, workbook.id),
            eq(offlineSalesInvoiceSlots.status, "unused"),
          ),
        );
      if (!retired) throw new Error("Could not force-retire offline workbook.");
      const operator = await requireOperator(tx, retired.operatorUserId);
      return await toSummary(tx, retired, operator.name);
    });
  });
