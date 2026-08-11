import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
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
  offlineSalesWorkbooks,
  orders,
  recipes,
  wallets,
} from "@/db";
import { classifyOfflineSalesInvoice } from "@/lib/sales/offline/classification.server";
import type {
  OfflineSalesBatchDetail,
  OfflineSalesReferenceSnapshot,
} from "@/lib/sales/offline/contracts";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import {
  requireOfflineSalesReviewMiddleware,
  requireOfflineSalesViewMiddleware,
} from "@/lib/middlewares";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const batchIdSchema = z.object({ batchId: z.string().min(1) });
const stagedInvoiceSchema = batchIdSchema.extend({
  stagedInvoiceId: z.string().min(1),
});
const excludeSchema = stagedInvoiceSchema.extend({
  reason: z.string().trim().min(5).max(500),
});
const walletSchema = batchIdSchema.extend({
  stagedPaymentId: z.string().min(1),
  replacementWalletId: z.string().min(1),
});
const orderResolutionSchema = stagedInvoiceSchema.extend({
  resolution: z.enum([
    "same_dispatch_duplicate",
    "replace_incorrect_online",
    "second_physical_dispatch",
  ]),
  existingInvoiceId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
});

async function requireBatch(
  database: typeof db | Transaction,
  batchId: string,
) {
  const [batch] = await database
    .select()
    .from(offlineSalesImportBatches)
    .where(eq(offlineSalesImportBatches.id, batchId))
    .limit(1);
  if (!batch?.workbookId)
    throw new Error("Offline sales import batch was not found.");
  const [workbook] = await database
    .select()
    .from(offlineSalesWorkbooks)
    .where(eq(offlineSalesWorkbooks.id, batch.workbookId))
    .limit(1);
  if (!workbook) throw new Error("Offline sales workbook was not found.");
  return { batch, workbook };
}

async function recomputeBatchCounts(tx: Transaction, batchId: string) {
  const rows = await tx
    .select({ status: offlineSalesStagedInvoices.status })
    .from(offlineSalesStagedInvoices)
    .where(eq(offlineSalesStagedInvoices.batchId, batchId));
  const count = (
    status: typeof offlineSalesStagedInvoices.$inferSelect.status,
  ) => rows.filter((row) => row.status === status).length;
  await tx
    .update(offlineSalesImportBatches)
    .set({
      readyInvoices: count("ready"),
      warningInvoices: count("warning"),
      invalidInvoices: count("invalid"),
      needsReviewInvoices: count("needs_review"),
      postedInvoices: count("posted"),
      excludedInvoices: count("excluded"),
      updatedAt: new Date(),
    })
    .where(eq(offlineSalesImportBatches.id, batchId));
}

function issueDetails(codes: string[]) {
  return codes.map((code) => ({
    code,
    message: code
      .replaceAll("_", " ")
      .replace(/^./, (value) => value.toUpperCase()),
  }));
}

const refreshOfflineSalesPreviewImpl = async (
  batchId: string,
): Promise<OfflineSalesBatchDetail> => {
  await db.transaction(async (tx) => {
    const { batch, workbook } = await requireBatch(tx, batchId);
    if (!["preview_ready", "completed_with_issues"].includes(batch.status)) {
      throw new Error("Only a reviewable offline batch can be refreshed.");
    }
    const snapshot =
      workbook.referenceSnapshot as unknown as OfflineSalesReferenceSnapshot;
    const staged = await tx
      .select()
      .from(offlineSalesStagedInvoices)
      .where(eq(offlineSalesStagedInvoices.batchId, batchId));
    const stagedIds = staged.map((value) => value.id);
    const items = stagedIds.length
      ? await tx
          .select()
          .from(offlineSalesStagedItems)
          .where(inArray(offlineSalesStagedItems.stagedInvoiceId, stagedIds))
      : [];
    const payments = stagedIds.length
      ? await tx
          .select()
          .from(offlineSalesStagedPayments)
          .where(inArray(offlineSalesStagedPayments.stagedInvoiceId, stagedIds))
      : [];
    const customerIds = [
      ...new Set(
        staged.flatMap((value) => (value.customerId ? [value.customerId] : [])),
      ),
    ];
    const recipeIds = [
      ...new Set(
        items.flatMap((value) => (value.recipeId ? [value.recipeId] : [])),
      ),
    ];
    const walletIds = [
      ...new Set(
        payments.flatMap((value) => (value.walletId ? [value.walletId] : [])),
      ),
    ];
    const orderIds = [
      ...new Set(
        staged.flatMap((value) => (value.orderId ? [value.orderId] : [])),
      ),
    ];
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
    const walletRows = walletIds.length
      ? await tx
          .select({ id: wallets.id, type: wallets.type })
          .from(wallets)
          .where(inArray(wallets.id, walletIds))
      : [];
    const orderRows = orderIds.length
      ? await tx
          .select({ id: orders.id })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : [];
    const linkedInvoices = orderIds.length
      ? await tx
          .select({ id: invoices.id, orderId: invoices.orderId })
          .from(invoices)
          .where(
            and(
              inArray(invoices.orderId, orderIds),
              eq(invoices.status, "saved"),
            ),
          )
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
              eq(finishedGoodsStock.warehouseId, snapshot.factoryWarehouseId),
              inArray(finishedGoodsStock.recipeId, recipeIds),
            ),
          )
      : [];
    const customersById = new Map(
      customerRows.map((value) => [value.id, value]),
    );
    const recipesById = new Map(recipeRows.map((value) => [value.id, value]));
    const walletsById = new Map(walletRows.map((value) => [value.id, value]));
    const orderIdSet = new Set(orderRows.map((value) => value.id));
    const invoicedOrderIds = new Set(
      linkedInvoices.flatMap((value) => (value.orderId ? [value.orderId] : [])),
    );
    const stockByRecipe = new Map(
      stockRows.map((value) => [value.recipeId, value]),
    );
    const productByRecipe = new Map(
      snapshot.products.map((value) => [value.recipeId, value]),
    );

    for (const invoice of staged) {
      if (["invalid", "excluded", "posted"].includes(invoice.status)) continue;
      if (invoice.issueCodes.includes("identity_content_changed")) continue;
      const invoiceItems = items.filter(
        (value) => value.stagedInvoiceId === invoice.id,
      );
      const invoicePayments = payments.filter(
        (value) => value.stagedInvoiceId === invoice.id,
      );
      const liveCustomer = invoice.customerId
        ? customersById.get(invoice.customerId)
        : null;
      const resolution = invoice.reviewResolution ?? "";
      const orderAlreadyInvoiced = Boolean(
        invoice.orderId && invoicedOrderIds.has(invoice.orderId),
      );
      const classification = classifyOfflineSalesInvoice({
        parseIssueCodes: [],
        identityState: "new",
        workbookStatus: workbook.status,
        distributorUsable:
          invoice.saleType !== "direct_distributor" || Boolean(liveCustomer),
        productsUsable: invoiceItems.every((item) =>
          Boolean(item.recipeId && recipesById.get(item.recipeId)?.isActive),
        ),
        walletsUsable: invoicePayments.every((payment) => {
          const wallet = payment.walletId
            ? walletsById.get(payment.walletId)
            : null;
          return Boolean(
            wallet &&
            (payment.method === "cash"
              ? wallet.type === "cash"
              : wallet.type === "bank"),
          );
        }),
        orderState:
          invoice.saleType !== "booked_order"
            ? "not_applicable"
            : !invoice.orderId || !orderIdSet.has(invoice.orderId)
              ? "not_found"
              : orderAlreadyInvoiced &&
                  !resolution.startsWith("second_physical_dispatch:")
                ? "already_invoiced"
                : "usable",
        hasStockShortage: invoiceItems.some((item) => {
          const product = item.recipeId
            ? productByRecipe.get(item.recipeId)
            : null;
          const stock = item.recipeId ? stockByRecipe.get(item.recipeId) : null;
          const available =
            Number(stock?.cartons ?? 0) *
              (product?.packsPerCarton ?? item.packsPerCarton) +
            Number(stock?.loose ?? 0);
          return item.dispatchedUnits > available;
        }),
        creditHoldActive: Boolean(liveCustomer?.creditHold),
        creditLimitExceeded: Boolean(
          liveCustomer &&
          Number(liveCustomer.creditLimit ?? 0) > 0 &&
          Number(liveCustomer.outstandingAmount ?? 0) +
            Number(invoice.outstandingAmount) >
            Number(liveCustomer.creditLimit),
        ),
        staleSnapshot:
          invoice.businessDate.getTime() -
            new Date(snapshot.generatedAt).getTime() >
          30 * 24 * 60 * 60 * 1_000,
      });
      if (resolution.startsWith("second_physical_dispatch:")) {
        classification.status = "warning";
        classification.issueCodes = [
          "second_physical_dispatch",
          ...classification.issueCodes,
        ];
      }
      await tx
        .update(offlineSalesStagedInvoices)
        .set({
          status: classification.status,
          issueCodes: classification.issueCodes,
          issueDetails: issueDetails(classification.issueCodes),
          warningsAcknowledged:
            classification.status === "warning"
              ? invoice.warningsAcknowledged
              : false,
          updatedAt: new Date(),
        })
        .where(eq(offlineSalesStagedInvoices.id, invoice.id));
    }
    await recomputeBatchCounts(tx, batchId);
  });
  return await getOfflineSalesBatchDetail(batchId);
};

const getOfflineSalesBatchDetailImpl = async (
  batchId: string,
): Promise<OfflineSalesBatchDetail> => {
  const { batch } = await requireBatch(db, batchId);
  const stagedRows = await db
    .select({
      invoice: offlineSalesStagedInvoices,
      customerName: customers.name,
    })
    .from(offlineSalesStagedInvoices)
    .leftJoin(
      customers,
      eq(customers.id, offlineSalesStagedInvoices.customerId),
    )
    .where(eq(offlineSalesStagedInvoices.batchId, batchId))
    .orderBy(offlineSalesStagedInvoices.worksheetRowNumber);
  const stagedIds = stagedRows.map(({ invoice }) => invoice.id);
  const orderIds = stagedRows.flatMap(({ invoice }) =>
    invoice.orderId ? [invoice.orderId] : [],
  );
  const itemRows = stagedIds.length
    ? await db
        .select({ item: offlineSalesStagedItems, productName: recipes.name })
        .from(offlineSalesStagedItems)
        .leftJoin(recipes, eq(recipes.id, offlineSalesStagedItems.recipeId))
        .where(inArray(offlineSalesStagedItems.stagedInvoiceId, stagedIds))
        .orderBy(offlineSalesStagedItems.worksheetRowNumber)
    : [];
  const paymentRows = stagedIds.length
    ? await db
        .select({
          payment: offlineSalesStagedPayments,
          walletName: wallets.name,
          walletType: wallets.type,
        })
        .from(offlineSalesStagedPayments)
        .leftJoin(wallets, eq(wallets.id, offlineSalesStagedPayments.walletId))
        .where(inArray(offlineSalesStagedPayments.stagedInvoiceId, stagedIds))
        .orderBy(offlineSalesStagedPayments.worksheetRowNumber)
    : [];
  const orderInvoiceRows = orderIds.length
    ? await db
        .select({
          id: invoices.id,
          orderId: invoices.orderId,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
        })
        .from(invoices)
        .where(inArray(invoices.orderId, orderIds))
    : [];
  return {
    batchId: batch.id,
    status: batch.status,
    filename: batch.originalFilename,
    outageStartedAt: batch.outageStartedAt,
    outageEndedAt: batch.outageEndedAt,
    outageReason: batch.outageReason,
    uploadedAt: batch.uploadedAt,
    counts: {
      total: batch.totalInvoices,
      ready: batch.readyInvoices,
      warning: batch.warningInvoices,
      duplicate: batch.duplicateInvoices,
      invalid: batch.invalidInvoices,
      needsReview: batch.needsReviewInvoices,
      posted: batch.postedInvoices,
      excluded: batch.excludedInvoices,
    },
    invoices: stagedRows.map(({ invoice, customerName }) => ({
      stagedInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      worksheetRowNumber: invoice.worksheetRowNumber,
      saleType: invoice.saleType,
      businessDate: invoice.businessDate,
      distributorCode: invoice.distributorCode,
      customerName,
      orderBookerCode: invoice.orderBookerCode,
      billNumber: invoice.billNumber,
      paymentDueDate: invoice.paymentDueDate,
      remarks: invoice.remarks,
      invoiceAmount: invoice.invoiceAmount,
      paidAmount: invoice.paidAmount,
      pendingAmount: invoice.pendingAmount,
      outstandingAmount: invoice.outstandingAmount,
      issueCodes: invoice.issueCodes,
      issueDetails: invoice.issueDetails,
      warningsAcknowledged: invoice.warningsAcknowledged,
      reviewResolution: invoice.reviewResolution,
      postedInvoiceId: invoice.postedInvoiceId,
      items: itemRows
        .filter(({ item }) => item.stagedInvoiceId === invoice.id)
        .map(({ item, productName }) => ({
          id: item.id,
          worksheetRowNumber: item.worksheetRowNumber,
          productCode: item.productCode,
          productName,
          cartonQuantity: item.cartonQuantity,
          looseUnitQuantity: item.looseUnitQuantity,
          packsPerCarton: item.packsPerCarton,
          freeCartons: item.freeCartons,
          dispatchedUnits: item.dispatchedUnits,
          lineAmount: item.lineAmount,
          stockUnitsSnapshot: item.stockUnitsSnapshot,
          physicalStockConfirmed: item.physicalStockConfirmed,
          sourceColumns: item.sourceColumns,
        })),
      payments: paymentRows
        .filter(({ payment }) => payment.stagedInvoiceId === invoice.id)
        .map(({ payment, walletName, walletType }) => ({
          id: payment.id,
          worksheetRowNumber: payment.worksheetRowNumber,
          method: payment.method,
          amount: payment.amount,
          walletCode: payment.walletCode,
          walletId: payment.walletId,
          walletName,
          walletType,
          reference: payment.reference,
          chequeNumber: payment.chequeNumber,
          chequeBank: payment.chequeBank,
          paymentDate: payment.paymentDate,
          sourceColumns: payment.sourceColumns,
        })),
      orderInvoiceCandidates: invoice.orderId
        ? orderInvoiceRows
            .filter((candidate) => candidate.orderId === invoice.orderId)
            .map(({ id, invoiceNumber, status }) => ({
              id,
              invoiceNumber,
              status,
            }))
        : [],
    })),
  };
};

export const getOfflineSalesBatchDetail = createServerOnlyFn(
  getOfflineSalesBatchDetailImpl,
);

export const refreshOfflineSalesPreview = createServerOnlyFn(
  refreshOfflineSalesPreviewImpl,
);

export const listOfflineSalesReplacementWalletsFn = createServerFn()
  .middleware([requireOfflineSalesReviewMiddleware])
  .handler(async () => {
    requireOfflineSalesEnabled();
    return await db
      .select({ id: wallets.id, name: wallets.name, type: wallets.type })
      .from(wallets)
      .where(inArray(wallets.type, ["cash", "bank"]))
      .orderBy(wallets.name);
  });

export const listOfflineSalesImportBatchesFn = createServerFn()
  .middleware([requireOfflineSalesViewMiddleware])
  .handler(async () => {
    requireOfflineSalesEnabled();
    return await db
      .select()
      .from(offlineSalesImportBatches)
      .orderBy(desc(offlineSalesImportBatches.uploadedAt));
  });

export const getOfflineSalesBatchFn = createServerFn()
  .middleware([requireOfflineSalesViewMiddleware])
  .inputValidator(batchIdSchema)
  .handler(async ({ data }) => {
    requireOfflineSalesEnabled();
    return await getOfflineSalesBatchDetail(data.batchId);
  });

export const refreshOfflineSalesPreviewFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesReviewMiddleware])
  .inputValidator(batchIdSchema)
  .handler(async ({ data }) => {
    requireOfflineSalesEnabled();
    return await refreshOfflineSalesPreview(data.batchId);
  });

export const acknowledgeOfflineSalesWarningFn = createServerFn({
  method: "POST",
})
  .middleware([requireOfflineSalesReviewMiddleware])
  .inputValidator(stagedInvoiceSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    const [updated] = await db
      .update(offlineSalesStagedInvoices)
      .set({
        warningsAcknowledged: true,
        reviewedByUserId: context.session.user.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(offlineSalesStagedInvoices.id, data.stagedInvoiceId),
          eq(offlineSalesStagedInvoices.batchId, data.batchId),
          eq(offlineSalesStagedInvoices.status, "warning"),
        ),
      )
      .returning({ id: offlineSalesStagedInvoices.id });
    if (!updated)
      throw new Error("Only a warning invoice can be acknowledged.");
    return await getOfflineSalesBatchDetail(data.batchId);
  });

export const replaceOfflineSalesWalletFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesReviewMiddleware])
  .inputValidator(walletSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(offlineSalesStagedPayments)
        .innerJoin(
          offlineSalesStagedInvoices,
          and(
            eq(
              offlineSalesStagedPayments.stagedInvoiceId,
              offlineSalesStagedInvoices.id,
            ),
            eq(offlineSalesStagedInvoices.batchId, data.batchId),
          ),
        )
        .where(eq(offlineSalesStagedPayments.id, data.stagedPaymentId))
        .limit(1);
      if (!payment) throw new Error("Offline staged payment was not found.");
      const oldWalletId = payment.offline_sales_staged_payments.walletId;
      const oldWallet = oldWalletId
        ? (
            await tx
              .select()
              .from(wallets)
              .where(eq(wallets.id, oldWalletId))
              .limit(1)
          )[0]
        : null;
      const replacement = (
        await tx
          .select()
          .from(wallets)
          .where(eq(wallets.id, data.replacementWalletId))
          .limit(1)
      )[0];
      const method = payment.offline_sales_staged_payments.method;
      const requiredType = method === "cash" ? "cash" : "bank";
      if (oldWallet?.type === requiredType)
        throw new Error("Available wallets cannot be replaced during review.");
      if (!replacement || replacement.type !== requiredType)
        throw new Error("Replacement wallet must have the same payment type.");
      await tx
        .update(offlineSalesStagedPayments)
        .set({ walletId: replacement.id, updatedAt: new Date() })
        .where(eq(offlineSalesStagedPayments.id, data.stagedPaymentId));
      await tx
        .update(offlineSalesStagedInvoices)
        .set({
          reviewedByUserId: context.session.user.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          eq(
            offlineSalesStagedInvoices.id,
            payment.offline_sales_staged_payments.stagedInvoiceId,
          ),
        );
    });
    return await refreshOfflineSalesPreview(data.batchId);
  });

export const excludeOfflineSalesInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireOfflineSalesReviewMiddleware])
  .inputValidator(excludeSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    await db.transaction(async (tx) => {
      const [invoice] = await tx
        .update(offlineSalesStagedInvoices)
        .set({
          status: "excluded",
          reviewResolution: `excluded:${data.reason}`,
          reviewedByUserId: context.session.user.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(offlineSalesStagedInvoices.id, data.stagedInvoiceId),
            eq(offlineSalesStagedInvoices.batchId, data.batchId),
            ne(offlineSalesStagedInvoices.status, "posted"),
          ),
        )
        .returning();
      if (!invoice) throw new Error("Posted invoices cannot be excluded.");
      await tx
        .update(offlineSalesInvoiceSlots)
        .set({ status: "voided", updatedAt: new Date() })
        .where(eq(offlineSalesInvoiceSlots.id, invoice.slotId));
      await recomputeBatchCounts(tx, data.batchId);
    });
    return await getOfflineSalesBatchDetail(data.batchId);
  });

export const resolveOfflineSalesOrderConflictFn = createServerFn({
  method: "POST",
})
  .middleware([requireOfflineSalesReviewMiddleware])
  .inputValidator(orderResolutionSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();
    await db.transaction(async (tx) => {
      const [staged] = await tx
        .select()
        .from(offlineSalesStagedInvoices)
        .where(
          and(
            eq(offlineSalesStagedInvoices.id, data.stagedInvoiceId),
            eq(offlineSalesStagedInvoices.batchId, data.batchId),
            eq(offlineSalesStagedInvoices.saleType, "booked_order"),
          ),
        )
        .limit(1);
      if (!staged?.orderId)
        throw new Error("Booked offline invoice was not found.");
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, data.existingInvoiceId),
            eq(invoices.orderId, staged.orderId),
          ),
        )
        .limit(1);
      if (!existing)
        throw new Error("Existing order invoice does not match this conflict.");
      if (
        data.resolution === "replace_incorrect_online" &&
        existing.status !== "voided"
      ) {
        throw new Error("Reverse or void the incorrect online invoice first.");
      }
      const resolution = `${data.resolution}:${existing.id}:${data.reason}`;
      if (data.resolution === "same_dispatch_duplicate") {
        await tx
          .update(offlineSalesStagedInvoices)
          .set({
            status: "excluded",
            reviewResolution: resolution,
            reviewedByUserId: context.session.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(offlineSalesStagedInvoices.id, staged.id));
        await tx
          .update(offlineSalesInvoiceSlots)
          .set({ status: "voided", updatedAt: new Date() })
          .where(eq(offlineSalesInvoiceSlots.id, staged.slotId));
      } else {
        await tx
          .update(offlineSalesStagedInvoices)
          .set({
            status: "warning",
            reviewResolution: resolution,
            issueCodes:
              data.resolution === "second_physical_dispatch"
                ? ["second_physical_dispatch"]
                : [],
            issueDetails:
              data.resolution === "second_physical_dispatch"
                ? [
                    {
                      code: "second_physical_dispatch",
                      message:
                        "Approved as a separate physical dispatch; no second order commission will be earned.",
                    },
                  ]
                : [],
            warningsAcknowledged: false,
            reviewedByUserId: context.session.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(offlineSalesStagedInvoices.id, staged.id));
      }
      await recomputeBatchCounts(tx, data.batchId);
    });
    return await getOfflineSalesBatchDetail(data.batchId);
  });
