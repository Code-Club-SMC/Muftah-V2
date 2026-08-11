import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  customers,
  db,
  finishedGoodsStock,
  invoices,
  offlineSalesImportBatches,
  offlineSalesInvoiceSlots,
  offlineSalesStagedInvoices,
  offlineSalesStagedItems,
  offlineSalesStagedPayments,
  orders,
  recipes,
  wallets,
  offlineSalesWorkbooks,
} from "@/db";
import {
  classifyOfflineSalesInvoice,
  type OfflineClassificationResult,
} from "@/lib/sales/offline/classification.server";
import { OFFLINE_SALES_MAX_BYTES } from "@/lib/sales/offline/constants";
import type {
  OfflineSalesUploadResult,
  ParsedOfflineSalesInvoice,
  ParsedOfflineSalesWorkbook,
} from "@/lib/sales/offline/contracts";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import { hashOfflineSalesSnapshot } from "@/lib/sales/offline/signing.server";
import { parseOfflineSalesWorkbook } from "@/lib/sales/offline/workbook-parser.server";
import { requireOfflineSalesUploadMiddleware } from "@/lib/middlewares";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MIN_XLSX_BYTES = 1024 * 1024;
const STALE_SNAPSHOT_MS = 30 * 24 * 60 * 60 * 1_000;

const uploadSchema = z.object({
  outageStartedAt: z.string().datetime({ offset: true }),
  outageEndedAt: z.string().datetime({ offset: true }),
  outageReason: z.string().trim().min(5).max(500),
});

type UploadMetadata = {
  filename: string;
  byteSize: number;
  outageStartedAt: Date;
  outageEndedAt: Date;
  outageReason: string;
  uploadedByUserId: string;
};

function countsFromBatch(batch: typeof offlineSalesImportBatches.$inferSelect) {
  return {
    ready: batch.readyInvoices,
    warning: batch.warningInvoices,
    duplicate: batch.duplicateInvoices,
    invalid: batch.invalidInvoices,
    needsReview: batch.needsReviewInvoices,
  };
}

function resultFromBatch(
  batch: typeof offlineSalesImportBatches.$inferSelect,
): OfflineSalesUploadResult {
  return {
    batchId: batch.id,
    fileSha256: batch.fileSha256,
    status: batch.status === "rejected" ? "rejected" : "preview_ready",
    counts: countsFromBatch(batch),
  };
}

function readForm(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File))
    throw new Error("Upload must include an XLSX file.");
  if (
    !file.name.toLowerCase().endsWith(".xlsx") ||
    (file.type &&
      file.type !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  )
    throw new Error("Upload must be an .xlsx workbook.");
  if (file.size < MIN_XLSX_BYTES || file.size > OFFLINE_SALES_MAX_BYTES) {
    throw new Error("Workbook file size is not allowed.");
  }
  const parsed = uploadSchema.parse({
    outageStartedAt: form.get("outageStartedAt"),
    outageEndedAt: form.get("outageEndedAt"),
    outageReason: form.get("outageReason"),
  });
  const outageStartedAt = new Date(parsed.outageStartedAt);
  const outageEndedAt = new Date(parsed.outageEndedAt);
  if (outageStartedAt >= outageEndedAt)
    throw new Error("Outage start must be before outage end.");
  if (outageEndedAt > new Date())
    throw new Error("Outage end cannot be in the future.");
  return {
    file,
    outageStartedAt,
    outageEndedAt,
    outageReason: parsed.outageReason,
  };
}

async function existingFile(
  fileSha256: string,
  database: typeof db | Transaction = db,
) {
  return (
    await database
      .select()
      .from(offlineSalesImportBatches)
      .where(eq(offlineSalesImportBatches.fileSha256, fileSha256))
      .limit(1)
  )[0];
}

async function storeRejectedUpload(
  metadata: UploadMetadata,
  fileSha256: string,
): Promise<OfflineSalesUploadResult> {
  const existing = await existingFile(fileSha256);
  if (existing) return resultFromBatch(existing);
  const [batch] = await db
    .insert(offlineSalesImportBatches)
    .values({
      workbookId: null,
      originalFilename: metadata.filename,
      fileSha256,
      byteSize: metadata.byteSize,
      outageStartedAt: metadata.outageStartedAt,
      outageEndedAt: metadata.outageEndedAt,
      outageReason: metadata.outageReason,
      uploadedByUserId: metadata.uploadedByUserId,
      status: "rejected",
      lastError: "unsafe_workbook",
    })
    .returning();
  if (!batch)
    throw new Error("Could not record rejected offline sales upload.");
  return resultFromBatch(batch);
}

function issueMessage(code: string) {
  const messages: Record<string, string> = {
    stock_shortage: "Live system stock is lower than the offline dispatch.",
    credit_limit_exceeded:
      "This invoice would exceed the current outstanding amount limit.",
    credit_hold_active:
      "The distributor currently has an outstanding amount hold.",
    stale_snapshot_context:
      "The workbook reference snapshot is more than 30 days old.",
    force_retired_workbook:
      "This workbook was force-retired and requires review.",
    distributor_unavailable: "The signed distributor is no longer available.",
    product_unavailable: "A signed product is no longer active or available.",
    wallet_unavailable:
      "A selected wallet is no longer available or has the wrong type.",
    order_not_found: "The signed booked order is no longer available.",
    order_already_invoiced:
      "The booked order already has an online or offline invoice.",
    identity_content_changed:
      "This reserved invoice identity was uploaded earlier with different content.",
  };
  return messages[code] ?? code.replaceAll("_", " ");
}

function pktDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

async function buildLiveContext(
  tx: Transaction,
  parsed: ParsedOfflineSalesWorkbook,
) {
  const distributorByCode = new Map(
    parsed.snapshot.distributors.map((value) => [value.code, value]),
  );
  const productByCode = new Map(
    parsed.snapshot.products.map((value) => [value.code, value]),
  );
  const orderByKey = new Map(
    parsed.snapshot.orders.map((value) => [
      `${value.orderBookerCode}|${value.billNumber}`,
      value,
    ]),
  );
  const walletByCode = new Map(
    parsed.snapshot.wallets.map((value) => [value.code, value]),
  );
  const customerIds = [
    ...new Set(
      parsed.invoices.flatMap((invoice) => {
        const id = invoice.distributorCode
          ? distributorByCode.get(invoice.distributorCode)?.id
          : null;
        return id ? [id] : [];
      }),
    ),
  ];
  const recipeIds = [
    ...new Set(
      parsed.invoices.flatMap((invoice) =>
        invoice.items
          .map((item) => productByCode.get(item.productCode)?.recipeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  const orderIds = [
    ...new Set(
      parsed.invoices.flatMap((invoice) => {
        const order = orderByKey.get(
          `${invoice.orderBookerCode}|${invoice.billNumber}`,
        );
        return order ? [order.id] : [];
      }),
    ),
  ];
  const walletIds = [
    ...new Set(
      parsed.invoices.flatMap((invoice) =>
        invoice.payments
          .map((payment) => walletByCode.get(payment.walletCode)?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  // A transaction uses one pg client. Keep its queries sequential; pg does not
  // support overlapping client.query calls and will reject them in pg v9.
  const customerRows = customerIds.length
    ? await tx
        .select()
        .from(customers)
        .where(inArray(customers.id, customerIds))
    : [];
  const recipeRows = recipeIds.length
    ? await tx
        .select({ id: recipes.id, isActive: recipes.isActive })
        .from(recipes)
        .where(inArray(recipes.id, recipeIds))
    : [];
  const orderRows = orderIds.length
    ? await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(inArray(orders.id, orderIds))
    : [];
  const linkedInvoices = orderIds.length
    ? await tx
        .select({ orderId: invoices.orderId })
        .from(invoices)
        .where(
          and(
            inArray(invoices.orderId, orderIds),
            eq(invoices.status, "saved"),
          ),
        )
    : [];
  const walletRows = walletIds.length
    ? await tx
        .select({ id: wallets.id, type: wallets.type })
        .from(wallets)
        .where(inArray(wallets.id, walletIds))
    : [];
  const stockRows = recipeIds.length
    ? await tx
        .select({
          recipeId: finishedGoodsStock.recipeId,
          cartons: finishedGoodsStock.quantityCartons,
          loose: finishedGoodsStock.quantityContainers,
        })
        .from(finishedGoodsStock)
        .where(
          and(
            eq(
              finishedGoodsStock.warehouseId,
              parsed.snapshot.factoryWarehouseId,
            ),
            inArray(finishedGoodsStock.recipeId, recipeIds),
          ),
        )
    : [];
  return {
    distributorByCode,
    productByCode,
    orderByKey,
    walletByCode,
    customers: new Map(customerRows.map((value) => [value.id, value])),
    recipes: new Map(recipeRows.map((value) => [value.id, value])),
    orders: new Map(orderRows.map((value) => [value.id, value])),
    invoicedOrders: new Set(
      linkedInvoices.flatMap((value) => (value.orderId ? [value.orderId] : [])),
    ),
    wallets: new Map(walletRows.map((value) => [value.id, value])),
    stock: new Map(stockRows.map((value) => [value.recipeId, value])),
  };
}

function classifyWithLiveContext(input: {
  invoice: ParsedOfflineSalesInvoice;
  parsed: ParsedOfflineSalesWorkbook;
  workbookStatus: "active" | "closed" | "force_retired";
  context: Awaited<ReturnType<typeof buildLiveContext>>;
  outageStartedAt: Date;
  outageEndedAt: Date;
}): OfflineClassificationResult {
  const { invoice, parsed, context } = input;
  const additionalIssues = [...invoice.parseIssues];
  const businessDate = new Date(
    `${invoice.saleDate}T${invoice.saleTime}:00+05:00`,
  );
  if (
    Number.isNaN(businessDate.getTime()) ||
    businessDate < input.outageStartedAt ||
    businessDate > input.outageEndedAt
  )
    additionalIssues.push({
      code: "outside_outage_window",
      message: "Sale date and time must be inside the declared outage.",
      source: `Invoices!E${invoice.worksheetRowNumber}`,
    });
  const outageStartDate = pktDate(input.outageStartedAt);
  const outageEndDate = pktDate(input.outageEndedAt);
  if (
    invoice.payments.some(
      (payment) =>
        payment.paymentDate < outageStartDate ||
        payment.paymentDate > outageEndDate,
    )
  )
    additionalIssues.push({
      code: "payment_outside_outage_window",
      message: "Payment date must be inside the declared outage.",
      source: `Invoices!D${invoice.worksheetRowNumber}`,
    });

  const signedDistributor = invoice.distributorCode
    ? context.distributorByCode.get(invoice.distributorCode)
    : null;
  const liveCustomer = signedDistributor
    ? context.customers.get(signedDistributor.id)
    : null;
  const signedOrder = context.orderByKey.get(
    `${invoice.orderBookerCode}|${invoice.billNumber}`,
  );
  const liveOrder = signedOrder ? context.orders.get(signedOrder.id) : null;
  const productsUsable = invoice.items.every((item) => {
    const signed = context.productByCode.get(item.productCode);
    return Boolean(signed && context.recipes.get(signed.recipeId)?.isActive);
  });
  const walletsUsable = invoice.payments.every((payment) => {
    const signed = context.walletByCode.get(payment.walletCode);
    const live = signed ? context.wallets.get(signed.id) : null;
    return Boolean(
      live &&
      (payment.method === "cash" ? live.type === "cash" : live.type === "bank"),
    );
  });
  const hasStockShortage = invoice.items.some((item) => {
    const product = context.productByCode.get(item.productCode);
    const stock = product ? context.stock.get(product.recipeId) : null;
    const available =
      Number(stock?.cartons ?? 0) * (product?.packsPerCarton ?? 0) +
      Number(stock?.loose ?? 0);
    return item.dispatchedUnits > available;
  });
  const currentOutstanding = Number(liveCustomer?.outstandingAmount ?? 0);
  const limit = Number(liveCustomer?.creditLimit ?? 0);
  const result = classifyOfflineSalesInvoice({
    parseIssueCodes: additionalIssues.map((value) => value.code),
    identityState: "new",
    workbookStatus: input.workbookStatus,
    distributorUsable:
      invoice.saleType !== "direct_distributor" || Boolean(liveCustomer),
    productsUsable,
    walletsUsable,
    orderState:
      invoice.saleType !== "booked_order"
        ? "not_applicable"
        : !liveOrder
          ? "not_found"
          : context.invoicedOrders.has(liveOrder.id)
            ? "already_invoiced"
            : "usable",
    hasStockShortage,
    creditHoldActive: Boolean(liveCustomer?.creditHold),
    creditLimitExceeded: Boolean(
      liveCustomer &&
      limit > 0 &&
      currentOutstanding + invoice.outstandingAmount > limit,
    ),
    staleSnapshot:
      businessDate.getTime() - new Date(parsed.snapshot.generatedAt).getTime() >
      STALE_SNAPSHOT_MS,
  });
  invoice.parseIssues = additionalIssues;
  return result;
}

const stageOfflineSalesUploadImpl = async (input: {
  parsed: ParsedOfflineSalesWorkbook;
  metadata: UploadMetadata;
}): Promise<OfflineSalesUploadResult> => {
  return await db.transaction(async (tx) => {
    const existing = await existingFile(input.parsed.fileSha256, tx);
    if (existing) return resultFromBatch(existing);
    const [workbook] = await tx
      .select()
      .from(offlineSalesWorkbooks)
      .where(
        and(
          eq(offlineSalesWorkbooks.id, input.parsed.manifest.workbookId),
          eq(
            offlineSalesWorkbooks.operatorUserId,
            input.parsed.manifest.operatorUserId,
          ),
          eq(
            offlineSalesWorkbooks.signingVersion,
            input.parsed.manifest.signingVersion,
          ),
        ),
      )
      .limit(1);
    if (
      !workbook ||
      workbook.snapshotSha256 !== input.parsed.manifest.snapshotSha256 ||
      hashOfflineSalesSnapshot(input.parsed.snapshot) !==
        workbook.snapshotSha256
    )
      throw new Error(
        "Workbook does not match an issued offline sales workbook.",
      );

    const [batch] = await tx
      .insert(offlineSalesImportBatches)
      .values({
        workbookId: workbook.id,
        originalFilename: input.metadata.filename,
        fileSha256: input.parsed.fileSha256,
        byteSize: input.metadata.byteSize,
        outageStartedAt: input.metadata.outageStartedAt,
        outageEndedAt: input.metadata.outageEndedAt,
        outageReason: input.metadata.outageReason,
        uploadedByUserId: input.metadata.uploadedByUserId,
        status: "uploaded",
        totalInvoices: input.parsed.invoices.length,
      })
      .returning();
    if (!batch) throw new Error("Could not create offline sales import batch.");

    const slots = await tx
      .select()
      .from(offlineSalesInvoiceSlots)
      .where(eq(offlineSalesInvoiceSlots.workbookId, workbook.id));
    const slotsByToken = new Map(
      slots.map((value) => [value.recordToken, value]),
    );
    const context = await buildLiveContext(tx, input.parsed);
    const counts = {
      ready: 0,
      warning: 0,
      duplicate: 0,
      invalid: 0,
      needsReview: 0,
    };

    for (const invoice of input.parsed.invoices) {
      const slot = slotsByToken.get(invoice.recordToken);
      if (!slot)
        throw new Error(
          "Workbook contains a slot that was not issued by the system.",
        );
      if (slot.stagedContentHash) {
        if (slot.stagedContentHash === invoice.contentHash)
          counts.duplicate += 1;
        else {
          counts.needsReview += 1;
          await tx
            .update(offlineSalesInvoiceSlots)
            .set({ status: "conflict", updatedAt: new Date() })
            .where(eq(offlineSalesInvoiceSlots.id, slot.id));
        }
        continue;
      }
      const classification = classifyWithLiveContext({
        invoice,
        parsed: input.parsed,
        workbookStatus: workbook.status,
        context,
        outageStartedAt: input.metadata.outageStartedAt,
        outageEndedAt: input.metadata.outageEndedAt,
      });
      if (classification.status === "ready") counts.ready += 1;
      else if (classification.status === "warning") counts.warning += 1;
      else if (classification.status === "invalid") counts.invalid += 1;
      else if (classification.status === "needs_review")
        counts.needsReview += 1;

      const signedDistributor = invoice.distributorCode
        ? context.distributorByCode.get(invoice.distributorCode)
        : null;
      const signedOrder = context.orderByKey.get(
        `${invoice.orderBookerCode}|${invoice.billNumber}`,
      );
      const parsedBusinessDate = new Date(
        `${invoice.saleDate}T${invoice.saleTime}:00+05:00`,
      );
      const businessDate = Number.isNaN(parsedBusinessDate.getTime())
        ? input.metadata.outageStartedAt
        : parsedBusinessDate;
      const [staged] = await tx
        .insert(offlineSalesStagedInvoices)
        .values({
          id: createId(),
          batchId: batch.id,
          workbookId: workbook.id,
          slotId: slot.id,
          recordToken: invoice.recordToken,
          invoiceNumber: invoice.invoiceNumber,
          contentHash: invoice.contentHash,
          worksheetRowNumber: invoice.worksheetRowNumber,
          saleType: invoice.saleType,
          businessDate,
          distributorCode: invoice.distributorCode,
          customerId: signedDistributor?.id ?? null,
          orderBookerCode: invoice.orderBookerCode,
          billNumber: invoice.billNumber,
          orderId: signedOrder?.id ?? null,
          paymentDueDate: invoice.paymentDueDate
            ? new Date(`${invoice.paymentDueDate}T00:00:00+05:00`)
            : null,
          remarks: invoice.remarks,
          invoiceAmount: invoice.invoiceAmount.toFixed(2),
          paidAmount: invoice.paidAmount.toFixed(2),
          pendingAmount: invoice.pendingAmount.toFixed(2),
          outstandingAmount: invoice.outstandingAmount.toFixed(2),
          status: classification.status,
          issueCodes: classification.issueCodes,
          issueDetails: [
            ...invoice.parseIssues,
            ...classification.issueCodes
              .filter(
                (code) =>
                  !invoice.parseIssues.some((value) => value.code === code),
              )
              .map((code) => ({ code, message: issueMessage(code) })),
          ],
        })
        .returning({ id: offlineSalesStagedInvoices.id });
      if (!staged) throw new Error("Could not stage offline invoice.");
      if (invoice.items.length)
        await tx.insert(offlineSalesStagedItems).values(
          invoice.items.map((item) => {
            const product = context.productByCode.get(item.productCode);
            return {
              id: createId(),
              stagedInvoiceId: staged.id,
              worksheetRowNumber: item.worksheetRowNumber,
              productCode: item.productCode,
              recipeId: product?.recipeId ?? null,
              cartonQuantity: item.cartonQuantity,
              looseUnitQuantity: item.looseUnitQuantity,
              packsPerCarton: item.packsPerCarton,
              baseCartonPrice: item.baseCartonPrice.toFixed(2),
              freeCartons: item.freeCartons,
              chargedUnits: item.chargedUnits,
              dispatchedUnits: item.dispatchedUnits,
              lineAmount: item.lineAmount.toFixed(2),
              wacPerPack: item.wacPerPack.toFixed(4),
              stockUnitsSnapshot: item.stockUnitsSnapshot,
              physicalStockConfirmed: item.physicalStockConfirmed,
              sourceColumns: item.sourceColumns,
            };
          }),
        );
      if (invoice.payments.length)
        await tx.insert(offlineSalesStagedPayments).values(
          invoice.payments.map((payment) => {
            const signedWallet = context.walletByCode.get(payment.walletCode);
            return {
              id: createId(),
              stagedInvoiceId: staged.id,
              worksheetRowNumber: payment.worksheetRowNumber,
              method: payment.method,
              amount: payment.amount.toFixed(2),
              walletCode: payment.walletCode,
              walletId:
                signedWallet && context.wallets.has(signedWallet.id)
                  ? signedWallet.id
                  : null,
              reference: payment.reference,
              chequeNumber: payment.chequeNumber,
              chequeBank: payment.chequeBank,
              chequeDate: payment.chequeDate
                ? new Date(`${payment.chequeDate}T00:00:00+05:00`)
                : null,
              paymentDate: new Date(`${payment.paymentDate}T00:00:00+05:00`),
              sourceColumns: payment.sourceColumns,
            };
          }),
        );
      await tx
        .update(offlineSalesInvoiceSlots)
        .set({
          status: "staged",
          stagedContentHash: invoice.contentHash,
          stagedInvoiceId: staged.id,
          consumedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(offlineSalesInvoiceSlots.id, slot.id),
            eq(offlineSalesInvoiceSlots.status, "unused"),
          ),
        );
    }

    const [updated] = await tx
      .update(offlineSalesImportBatches)
      .set({
        status: "preview_ready",
        readyInvoices: counts.ready,
        warningInvoices: counts.warning,
        duplicateInvoices: counts.duplicate,
        invalidInvoices: counts.invalid,
        needsReviewInvoices: counts.needsReview,
        updatedAt: new Date(),
      })
      .where(eq(offlineSalesImportBatches.id, batch.id))
      .returning();
    if (!updated) throw new Error("Could not finish offline sales staging.");
    return resultFromBatch(updated);
  });
};

export const stageOfflineSalesUpload = createServerOnlyFn(
  stageOfflineSalesUploadImpl,
);

export const uploadOfflineSalesWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesUploadMiddleware])
  .inputValidator((value: unknown) => {
    if (!(value instanceof FormData)) throw new Error("Expected FormData");
    return value;
  })
  .handler(async ({ data, context }): Promise<OfflineSalesUploadResult> => {
    requireOfflineSalesEnabled();
    const upload = readForm(data);
    let bytes = new Uint8Array(await upload.file.arrayBuffer());
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata: UploadMetadata = {
      filename: upload.file.name,
      byteSize: bytes.byteLength,
      outageStartedAt: upload.outageStartedAt,
      outageEndedAt: upload.outageEndedAt,
      outageReason: upload.outageReason,
      uploadedByUserId: context.session.user.id,
    };
    let parsed: ParsedOfflineSalesWorkbook;
    try {
      parsed = await parseOfflineSalesWorkbook(bytes);
    } catch {
      bytes = new Uint8Array();
      return await storeRejectedUpload(metadata, fileSha256);
    }
    bytes = new Uint8Array();
    return await stageOfflineSalesUpload({ parsed, metadata });
  });
