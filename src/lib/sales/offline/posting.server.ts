import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
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
import type { PostBatchResult } from "./contracts";
import {
  OFFLINE_SALES_POST_LEASE_MS,
  OFFLINE_SALES_POST_LIMIT,
} from "./constants";
import { postInvoice } from "@/server-functions/sales/invoice-posting-service";
import { describePostError } from "./post-error-message";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function safePostError(error: unknown) {
  return describePostError(error);
}

async function claimBatch(batchId: string) {
  const leaseId = createId();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + OFFLINE_SALES_POST_LEASE_MS);
  const [batch] = await db
    .update(offlineSalesImportBatches)
    .set({
      status: "posting",
      processingLeaseId: leaseId,
      processingLeaseExpiresAt: leaseExpiresAt,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(offlineSalesImportBatches.id, batchId),
        inArray(offlineSalesImportBatches.status, [
          "preview_ready",
          "completed_with_issues",
          "posting",
        ]),
        or(
          sql`${offlineSalesImportBatches.processingLeaseId} is null`,
          sql`${offlineSalesImportBatches.processingLeaseExpiresAt} < ${now}`,
        ),
      ),
    )
    .returning();
  if (!batch?.workbookId) {
    throw new Error("Offline sales batch is already being posted or is not ready.");
  }
  return { batch, leaseId };
}

async function resolveBookedCustomer(
  tx: Transaction,
  staged: typeof offlineSalesStagedInvoices.$inferSelect,
) {
  if (!staged.orderId) throw new Error("Signed booked order is missing");
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, staged.orderId))
    .limit(1);
  if (!order) throw new Error("Signed booked order no longer exists");

  const resolution = staged.reviewResolution ?? "";
  if (resolution.startsWith("second_physical_dispatch:")) {
    const existingInvoiceId = resolution.split(":")[1];
    const [existingInvoice] = await tx
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(and(eq(invoices.id, existingInvoiceId), eq(invoices.orderId, order.id)))
      .limit(1);
    if (!existingInvoice) throw new Error("Approved existing dispatch invoice was not found");
    return {
      customerId: existingInvoice.customerId,
      customerName: undefined,
      customerMobile: undefined,
      orderId: undefined,
      commissionPolicy: "suppress" as const,
    };
  }

  if (resolution.startsWith("replace_incorrect_online:")) {
    const incorrectInvoiceId = resolution.split(":")[1];
    const [incorrect] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, incorrectInvoiceId), eq(invoices.orderId, order.id)))
      .limit(1);
    if (!incorrect || incorrect.status !== "voided") {
      throw new Error("Incorrect online invoice must remain voided before replacement");
    }
    await tx
      .update(invoices)
      .set({ orderId: null, updatedAt: new Date() })
      .where(eq(invoices.id, incorrect.id));
  }

  let [customer] = order.shopkeeperMobile
    ? await tx
        .select()
        .from(customers)
        .where(sql`lower(${customers.mobileNumber}) = lower(${order.shopkeeperMobile})`)
        .limit(1)
    : [];
  if (!customer && order.shopkeeperName) {
    [customer] = await tx
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.name, order.shopkeeperName),
          or(
            eq(customers.customerType, "shopkeeper"),
            eq(customers.customerType, "retailer"),
          ),
        ),
      )
      .limit(1);
  }
  return {
    customerId: customer?.id,
    customerName: customer ? undefined : order.shopkeeperName,
    customerMobile: customer ? undefined : order.shopkeeperMobile ?? undefined,
    orderId: order.id,
    commissionPolicy: "normal" as const,
  };
}

/**
 * Customer for a retailer or walk-in sale. An existing customer is used as is.
 * A new walk-in is matched by mobile number first, so the same person typed on
 * two invoices becomes one customer, and is created otherwise.
 */
async function resolveRetailCustomer(
  tx: Transaction,
  staged: typeof offlineSalesStagedInvoices.$inferSelect,
) {
  const normal = {
    customerName: undefined,
    customerMobile: undefined,
    orderId: undefined,
    commissionPolicy: "normal" as const,
  };
  if (staged.customerId) {
    const [existing] = await tx
      .select({ id: customers.id, customerType: customers.customerType })
      .from(customers)
      .where(eq(customers.id, staged.customerId))
      .limit(1);
    if (!existing || existing.customerType === "distributor") {
      throw new Error("Signed customer is no longer available");
    }
    return { ...normal, customerId: existing.id };
  }
  const details = staged.customerDetails;
  if (!details || details.name.trim().length < 2) {
    throw new Error("New customer details are missing");
  }
  if (details.mobile?.trim()) {
    const [byMobile] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          sql`lower(${customers.mobileNumber}) = lower(${details.mobile.trim()})`,
          ne(customers.customerType, "distributor"),
        ),
      )
      .limit(1);
    if (byMobile) return { ...normal, customerId: byMobile.id };
  }
  const [created] = await tx
    .insert(customers)
    .values({
      name: details.name.trim(),
      mobileNumber: details.mobile?.trim() || null,
      city: details.city?.trim() || null,
      address: details.address?.trim() || null,
      customerType: "retailer",
    })
    .returning({ id: customers.id });
  return { ...normal, customerId: created.id };
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Turns staged lines into the lines the shared invoice service posts.
 *
 * `additive` is true for a distributor: free cartons are shipped on top of the
 * ordered cartons and only the ordered ones are billed. For everyone else the
 * ordered cartons include the free ones, so the billed cartons are the ordered
 * ones less the free ones. This is the same rule the desk calculator uses.
 */
export function buildPostingLines(
  stagedItems: Array<typeof offlineSalesStagedItems.$inferSelect>,
  recipeNames: Map<string, string>,
  additive: boolean,
) {
  const items: Array<{
    pack: string;
    recipeId: string;
    unitType: "carton" | "units";
    numberOfCartons: number;
    numberOfUnits: number;
    discountCartons: number;
    packsPerCarton: number;
    hsnCode: string;
    perCartonPrice: number;
    retailPrice: number;
    isPriceOverride: boolean;
    preserveStoredDistributorRate: boolean;
    legacyBaseCartonRate: number;
  }> = [];
  const snapshots: NonNullable<Parameters<typeof postInvoice>[1]["signedLineSnapshots"]> = [];
  for (const staged of stagedItems) {
    if (!staged.recipeId) throw new Error("Signed product is no longer available");
    const price = Number(staged.baseCartonPrice);
    const manual = staged.manualFreeCartons;
    const common = {
      pack: recipeNames.get(staged.recipeId) ?? staged.productCode,
      recipeId: staged.recipeId,
      discountCartons: manual,
      packsPerCarton: staged.packsPerCarton,
      hsnCode: "",
      perCartonPrice: price,
      retailPrice: price / staged.packsPerCarton,
      isPriceOverride: staged.isPriceOverride,
      preserveStoredDistributorRate: !staged.isPriceOverride,
      legacyBaseCartonRate: price,
    };
    if (staged.cartonQuantity > 0) {
      const chargedCartons = additive
        ? staged.cartonQuantity
        : staged.cartonQuantity - manual;
      const dispatchedCartons = additive
        ? staged.cartonQuantity + staged.freeCartons + manual
        : staged.cartonQuantity;
      items.push({
        ...common,
        unitType: "carton",
        numberOfCartons: staged.cartonQuantity,
        numberOfUnits: 0,
      });
      snapshots.push({
        stagedItemId: staged.id,
        recipeId: staged.recipeId,
        baseCartonPrice: price,
        // The scheme only. Cartons given by hand travel as `discountCartons`.
        freeCartons: staged.freeCartons,
        chargedUnits: chargedCartons * staged.packsPerCarton,
        dispatchedUnits: dispatchedCartons * staged.packsPerCarton,
        lineAmount: cents(chargedCartons * price),
        wacPerPack: Number(staged.wacPerPack),
        stockUnitsSnapshot: staged.stockUnitsSnapshot,
      });
    }
    if (staged.looseUnitQuantity > 0) {
      items.push({
        ...common,
        discountCartons: 0,
        unitType: "units",
        numberOfCartons: 0,
        numberOfUnits: staged.looseUnitQuantity,
      });
      snapshots.push({
        stagedItemId: staged.id,
        recipeId: staged.recipeId,
        baseCartonPrice: price,
        freeCartons: 0,
        chargedUnits: staged.looseUnitQuantity,
        dispatchedUnits: staged.looseUnitQuantity,
        lineAmount: cents((price / staged.packsPerCarton) * staged.looseUnitQuantity),
        wacPerPack: Number(staged.wacPerPack),
        stockUnitsSnapshot: staged.stockUnitsSnapshot,
      });
    }
  }
  return { items, snapshots };
}

async function postOne(stagedInvoiceId: string, actorId: string) {
  return await db.transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(offlineSalesStagedInvoices)
      .where(eq(offlineSalesStagedInvoices.id, stagedInvoiceId))
      .limit(1);
    if (!initial) throw new Error("Staged offline invoice was not found");

    await tx.execute(
      sql`SELECT ${offlineSalesInvoiceSlots.id} FROM ${offlineSalesInvoiceSlots} WHERE ${offlineSalesInvoiceSlots.id} = ${initial.slotId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT ${offlineSalesStagedInvoices.id} FROM ${offlineSalesStagedInvoices} WHERE ${offlineSalesStagedInvoices.id} = ${initial.id} FOR UPDATE`,
    );
    const [staged] = await tx
      .select()
      .from(offlineSalesStagedInvoices)
      .where(eq(offlineSalesStagedInvoices.id, initial.id))
      .limit(1);
    const [slot] = await tx
      .select()
      .from(offlineSalesInvoiceSlots)
      .where(eq(offlineSalesInvoiceSlots.id, initial.slotId))
      .limit(1);
    if (!staged || !slot) throw new Error("Offline invoice identity is incomplete");
    if (staged.status === "posted" && staged.postedInvoiceId) return staged.postedInvoiceId;
    if (slot.postedInvoiceId) return slot.postedInvoiceId;
    if (
      staged.status !== "ready" &&
      !(staged.status === "warning" && staged.warningsAcknowledged)
    ) throw new Error("Offline invoice is not approved for posting");

    const stagedItems = await tx
      .select()
      .from(offlineSalesStagedItems)
      .where(eq(offlineSalesStagedItems.stagedInvoiceId, staged.id))
      .orderBy(asc(offlineSalesStagedItems.recipeId));
    const stagedPayments = await tx
      .select()
      .from(offlineSalesStagedPayments)
      .where(eq(offlineSalesStagedPayments.stagedInvoiceId, staged.id))
      .orderBy(asc(offlineSalesStagedPayments.worksheetRowNumber));
    const recipeIds = [...new Set(stagedItems.flatMap((item) => item.recipeId ? [item.recipeId] : []))].sort();

    if (staged.orderId) {
      await tx.execute(sql`SELECT ${orders.id} FROM ${orders} WHERE ${orders.id} = ${staged.orderId} FOR UPDATE`);
    }
    if (recipeIds.length > 0) {
      await tx
        .select({ id: finishedGoodsStock.id })
        .from(finishedGoodsStock)
        .where(inArray(finishedGoodsStock.recipeId, recipeIds))
        .orderBy(asc(finishedGoodsStock.recipeId))
        .for("update");
    }
    if (staged.customerId) {
      await tx.execute(sql`SELECT ${customers.id} FROM ${customers} WHERE ${customers.id} = ${staged.customerId} FOR UPDATE`);
    }

    const recipeRows = recipeIds.length
      ? await tx
          .select({ id: recipes.id, name: recipes.name, isActive: recipes.isActive })
          .from(recipes)
          .where(inArray(recipes.id, recipeIds))
      : [];
    if (
      recipeRows.length !== recipeIds.length ||
      recipeRows.some((recipe) => !recipe.isActive)
    ) throw new Error("A signed product is no longer active");
    const recipeNames = new Map(recipeRows.map((recipe) => [recipe.id, recipe.name]));
    for (const payment of stagedPayments) {
      // A salary paid by the distributor goes through no account.
      if (payment.method === "expense_offset") continue;
      if (!payment.walletId) throw new Error("Payment wallet requires review");
      const [wallet] = await tx
        .select({ type: wallets.type })
        .from(wallets)
        .where(eq(wallets.id, payment.walletId))
        .limit(1);
      const expectedType = payment.method === "cash" ? "cash" : "bank";
      if (!wallet || wallet.type !== expectedType) throw new Error("Payment wallet requires review");
    }

    const customer = staged.saleType === "booked_order"
      ? await resolveBookedCustomer(tx, staged)
      : staged.saleType === "direct_retailer"
      ? await resolveRetailCustomer(tx, staged)
      : {
          customerId: staged.customerId ?? undefined,
          customerName: undefined,
          customerMobile: undefined,
          orderId: undefined,
          commissionPolicy: "normal" as const,
        };
    if (staged.saleType === "direct_distributor" && !customer.customerId) {
      throw new Error("Signed distributor is no longer available");
    }
    const postingLines = buildPostingLines(
      stagedItems,
      recipeNames,
      staged.saleType === "direct_distributor",
    );
    const posted = await postInvoice(tx, {
      customerId: customer.customerId,
      customerName: customer.customerName,
      customerMobile: customer.customerMobile,
      customerType: "retailer",
      salesmanId: undefined,
      warehouseId: (
        await tx.select({ id: sql<string>`${offlineSalesWorkbooks.referenceSnapshot}->>'factoryWarehouseId'` })
          .from(offlineSalesWorkbooks)
          .where(eq(offlineSalesWorkbooks.id, staged.workbookId))
          .limit(1)
      )[0]?.id ?? "",
      payments: stagedPayments.map((payment) =>
        payment.method === "expense_offset"
          ? {
              method: "expense_offset" as const,
              amount: Number(payment.amount),
              paymentDate: payment.paymentDate,
              notes: payment.notes ?? undefined,
              expenseType: payment.expenseType ?? "salesman_salary",
              expenseEmployeeId: payment.expenseEmployeeId ?? undefined,
            }
          : {
              method: payment.method,
              amount: Number(payment.amount),
              walletId: payment.walletId!,
              reference: payment.reference ?? undefined,
              notes: payment.notes ?? undefined,
              instantVerify: payment.instantVerify,
              chequeNumber: payment.chequeNumber ?? undefined,
              chequeBank: payment.chequeBank ?? undefined,
              chequeDate: payment.chequeDate ?? undefined,
              paymentDate: payment.paymentDate,
              sourceRecordId: payment.id,
            },
      ),
      paymentDueDate: staged.paymentDueDate ?? undefined,
      expenses: Number(staged.expenses),
      expensesDescription: staged.expensesDescription ?? undefined,
      invoiceDiscount: Number(staged.invoiceDiscount),
      invoiceDiscountDescription: staged.invoiceDiscountDescription ?? undefined,
      remarks: staged.remarks ?? undefined,
      orderId: customer.orderId,
      items: postingLines.items,
      performedById: actorId,
      source: "offline_import",
      businessDate: staged.businessDate,
      publicInvoiceNumber: staged.invoiceNumber,
      stockPolicy: "offline_reconcile",
      creditPolicy: "warn",
      pricingPolicy: "signed_snapshot",
      offlineSalesSlotId: slot.id,
      offlineSaleType: staged.saleType,
      commissionPolicy: customer.commissionPolicy,
      signedLineSnapshots: postingLines.snapshots,
    });
    if (Number(posted.totalPrice) !== Number(staged.invoiceAmount)) {
      throw new Error("Posted total does not match signed offline total");
    }
    const postedAt = new Date();
    await tx
      .update(offlineSalesStagedInvoices)
      .set({ status: "posted", postedInvoiceId: posted.id, postedAt, updatedAt: postedAt })
      .where(and(eq(offlineSalesStagedInvoices.id, staged.id), ne(offlineSalesStagedInvoices.status, "posted")));
    await tx
      .update(offlineSalesInvoiceSlots)
      .set({ status: "posted", postedInvoiceId: posted.id, updatedAt: postedAt })
      .where(and(eq(offlineSalesInvoiceSlots.id, slot.id), sql`${offlineSalesInvoiceSlots.postedInvoiceId} is null`));
    return posted.id;
  });
}

async function finalizeBatch(batchId: string, leaseId: string) {
  const rows = await db
    .select({ status: offlineSalesStagedInvoices.status, acknowledged: offlineSalesStagedInvoices.warningsAcknowledged })
    .from(offlineSalesStagedInvoices)
    .where(eq(offlineSalesStagedInvoices.batchId, batchId));
  const posted = rows.filter((row) => row.status === "posted").length;
  const excluded = rows.filter((row) => row.status === "excluded").length;
  const invalid = rows.filter((row) => row.status === "invalid").length;
  const needsReview = rows.filter((row) => row.status === "needs_review").length;
  const ready = rows.filter((row) => row.status === "ready").length;
  const warning = rows.filter((row) => row.status === "warning").length;
  const eligible = rows.filter((row) => row.status === "ready" || (row.status === "warning" && row.acknowledged)).length;
  const finalStatus: "preview_ready" | "completed_with_issues" | "completed" = eligible > 0
    ? "preview_ready"
    : invalid > 0 || needsReview > 0 || warning > 0
      ? "completed_with_issues"
      : "completed";
  await db.update(offlineSalesImportBatches).set({
    status: finalStatus,
    readyInvoices: ready,
    warningInvoices: warning,
    invalidInvoices: invalid,
    needsReviewInvoices: needsReview,
    postedInvoices: posted,
    excludedInvoices: excluded,
    processingLeaseId: null,
    processingLeaseExpiresAt: null,
    completedAt: finalStatus === "preview_ready" ? null : new Date(),
    updatedAt: new Date(),
  }).where(and(eq(offlineSalesImportBatches.id, batchId), eq(offlineSalesImportBatches.processingLeaseId, leaseId)));
  return { posted, remaining: eligible, status: finalStatus };
}

export async function postOfflineSalesBatch(input: {
  batchId: string;
  actorId: string;
}): Promise<PostBatchResult> {
  const [existing] = await db
    .select({
      status: offlineSalesImportBatches.status,
    })
    .from(offlineSalesImportBatches)
    .where(eq(offlineSalesImportBatches.id, input.batchId))
    .limit(1);
  if (!existing) throw new Error("Offline sales batch was not found.");
  if (existing.status === "completed") {
    return {
      batchId: input.batchId,
      status: "completed",
      posted: 0,
      failed: 0,
      remaining: 0,
      hasMore: false,
    };
  }

  const { leaseId } = await claimBatch(input.batchId);
  const candidates = await db
    .select({ id: offlineSalesStagedInvoices.id })
    .from(offlineSalesStagedInvoices)
    .where(
      and(
        eq(offlineSalesStagedInvoices.batchId, input.batchId),
        or(
          eq(offlineSalesStagedInvoices.status, "ready"),
          and(
            eq(offlineSalesStagedInvoices.status, "warning"),
            eq(offlineSalesStagedInvoices.warningsAcknowledged, true),
          ),
        ),
      ),
    )
    .orderBy(asc(offlineSalesStagedInvoices.worksheetRowNumber))
    .limit(OFFLINE_SALES_POST_LIMIT);
  let posted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await postOne(candidate.id, input.actorId);
      posted += 1;
    } catch (error) {
      failed += 1;
      console.error("Offline sales invoice posting failed", {
        stagedInvoiceId: candidate.id,
        error,
      });
      await db
        .update(offlineSalesStagedInvoices)
        .set({
          status: "needs_review",
          issueCodes: ["posting_failed"],
          issueDetails: [{ code: "posting_failed", message: safePostError(error) }],
          updatedAt: new Date(),
        })
        .where(and(eq(offlineSalesStagedInvoices.id, candidate.id), ne(offlineSalesStagedInvoices.status, "posted")));
    }
  }
  const final = await finalizeBatch(input.batchId, leaseId);
  return {
    batchId: input.batchId,
    status: final.status,
    posted,
    failed,
    remaining: final.remaining,
    hasMore: final.remaining > 0,
  };
}
