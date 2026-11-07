import { createId } from "@paralleldrive/cuid2";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
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
const forceRetireSchema = workbookIdSchema.extend({
  reason: z.string().trim().min(5).max(500),
});

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
    throw new Error("That user was not found or is disabled.");
  }
  return operator;
}

async function requireWorkbook(database: Database, workbookId: string) {
  const [workbook] = await database
    .select()
    .from(offlineSalesWorkbooks)
    .where(eq(offlineSalesWorkbooks.id, workbookId))
    .limit(1);
  if (!workbook) throw new Error("Offline invoice numbers were not found.");
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
    throw new Error("Finish reviewing the current offline batch before replacing the invoice numbers.");
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
    throw new Error("Factory F01 already has an active set of offline invoice numbers.");
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
  if (!workbook) throw new Error("Could not issue offline invoice numbers.");

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

export const forceRetireOfflineSalesWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesWorkbookManageMiddleware])
  .inputValidator(forceRetireSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    return await db.transaction(async (tx) => {
      const workbook = await requireWorkbook(tx, data.workbookId);
      if (workbook.status !== "active") {
        throw new Error("Only the active invoice numbers can be retired.");
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
      if (!retired) throw new Error("Could not retire offline invoice numbers.");
      const operator = await requireOperator(tx, retired.operatorUserId);
      return await toSummary(tx, retired, operator.name);
    });
  });

/**
 * Brings the price list up to date without changing the reserved invoice
 * numbers. Only safe when no printed invoice is still waiting to be sent, so
 * the desk asks for it only then.
 */
async function refreshSnapshotInPlace(tx: Transaction, workbook: Workbook) {
  const current = workbook.referenceSnapshot as unknown as OfflineSalesReferenceSnapshot;
  // A copy built under 4 minutes ago is reused. The desk asks every 5 minutes,
  // so it always gets a new copy, even when two clocks are a little apart.
  if (Date.now() - new Date(current.generatedAt).getTime() < 4 * 60_000) return workbook;
  const generatedAt = new Date();
  const snapshot = await buildOfflineSalesReferenceSnapshot(tx, generatedAt);
  const snapshotSha256 = hashOfflineSalesSnapshot(snapshot);
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
    snapshotSha256,
  };
  const [updated] = await tx
    .update(offlineSalesWorkbooks)
    .set({
      referenceSnapshot: snapshot as unknown as Record<string, unknown>,
      snapshotSha256,
      snapshotSignature: signOfflineSalesSnapshot(snapshot, workbook.signingVersion),
      manifestSignature: signOfflineSalesManifest(manifest),
      updatedAt: generatedAt,
    })
    .where(eq(offlineSalesWorkbooks.id, workbook.id))
    .returning();
  return updated ?? workbook;
}

/**
 * Gives the offline desk a workbook without any office step.
 *
 * - No active workbook: issue one to this user.
 * - Active workbook with numbers left: use it. When the desk has nothing
 *   waiting to be sent, its price list is refreshed in place first.
 * - Every number used and the last upload fully reviewed: close it and issue a
 *   fresh one (nothing on the desk can still be waiting, because an unsent
 *   invoice always keeps its number unused on the server).
 */
export const ensureDeskWorkbook = createServerOnlyFn(
  async (userId: string, options: { refreshPrices: boolean }): Promise<Workbook> => {
    return await db.transaction(async (tx) => {
      // Two quick clicks must not race to issue two workbooks.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('offline-sales-issue-F01'))`,
      );
      const active = await findActiveWorkbook(tx);
      if (!active) {
        return (
          await issueInTransaction({
            tx,
            operatorUserId: userId,
            issuedByUserId: userId,
          })
        ).workbook;
      }
      const [counts] = await tx
        .select({
          unused: sql<number>`count(*) filter (where ${offlineSalesInvoiceSlots.status} = 'unused')::int`,
        })
        .from(offlineSalesInvoiceSlots)
        .where(eq(offlineSalesInvoiceSlots.workbookId, active.id));
      if (Number(counts?.unused ?? 0) > 0) {
        return options.refreshPrices ? await refreshSnapshotInPlace(tx, active) : active;
      }

      try {
        await assertNoUnresolvedBatch(tx, active.id);
      } catch {
        throw new Error(
          "All invoice numbers are used. Once the office has finished reviewing the last upload, press Refresh this computer for a new set.",
        );
      }
      const closedAt = new Date();
      await tx
        .update(offlineSalesWorkbooks)
        .set({
          status: "closed",
          closedByUserId: userId,
          closedAt,
          updatedAt: closedAt,
        })
        .where(eq(offlineSalesWorkbooks.id, active.id));
      const { workbook } = await issueInTransaction({
        tx,
        operatorUserId: userId,
        issuedByUserId: userId,
      });
      await tx
        .update(offlineSalesWorkbooks)
        .set({ replacementWorkbookId: workbook.id, updatedAt: new Date() })
        .where(eq(offlineSalesWorkbooks.id, active.id));
      return workbook;
    });
  },
);
