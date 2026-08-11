import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { wallets } from "./finance-schema";
import { recipes, warehouses } from "./inventory-schema";
import { invoiceItems, invoices } from "./sales-schema";

export type OfflineSalesWorkbookStatus = "active" | "closed" | "force_retired";
export type OfflineSalesSlotStatus =
  | "unused"
  | "staged"
  | "posted"
  | "voided"
  | "conflict";
export type OfflineSalesBatchStatus =
  | "uploaded"
  | "preview_ready"
  | "posting"
  | "completed"
  | "completed_with_issues"
  | "rejected";
export type OfflineSalesInvoiceStatus =
  | "ready"
  | "warning"
  | "duplicate"
  | "invalid"
  | "needs_review"
  | "posted"
  | "excluded";
export type StockReconciliationStatus = "open" | "resolved";
export type StockReconciliationResolutionType =
  | "counted_adjustment"
  | "missing_record";

const idColumn = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const offlineSalesWorkbooks = pgTable(
  "offline_sales_workbooks",
  {
    id: idColumn(),
    factoryCode: text("factory_code").notNull(),
    operatorUserId: text("operator_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    issuedByUserId: text("issued_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "closed", "force_retired"] })
      .$type<OfflineSalesWorkbookStatus>()
      .default("active")
      .notNull(),
    templateVersion: integer("template_version").notNull(),
    signingVersion: integer("signing_version").notNull(),
    invoiceCapacity: integer("invoice_capacity").notNull(),
    itemCapacity: integer("item_capacity").notNull(),
    paymentCapacity: integer("payment_capacity").notNull(),
    referenceSnapshot: jsonb("reference_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    snapshotSha256: text("snapshot_sha256").notNull(),
    snapshotSignature: text("snapshot_signature").notNull(),
    manifestSignature: text("manifest_signature").notNull(),
    replacementWorkbookId: text("replacement_workbook_id").references(
      (): AnyPgColumn => offlineSalesWorkbooks.id,
      { onDelete: "set null" },
    ),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    closedByUserId: text("closed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    forceRetiredByUserId: text("force_retired_by_user_id").references(
      () => user.id,
      { onDelete: "restrict" },
    ),
    forceRetiredAt: timestamp("force_retired_at", { withTimezone: true }),
    forceRetiredReason: text("force_retired_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_workbooks_one_active_factory_idx")
      .on(table.factoryCode)
      .where(sql`${table.status} = 'active'`),
    index("offline_sales_workbooks_operator_idx").on(table.operatorUserId),
    check(
      "offline_sales_workbooks_factory_check",
      sql`${table.factoryCode} = 'F01'`,
    ),
    check(
      "offline_sales_workbooks_capacities_check",
      sql`${table.templateVersion} > 0 and ${table.signingVersion} > 0 and ${table.invoiceCapacity} > 0 and ${table.itemCapacity} > 0 and ${table.paymentCapacity} > 0`,
    ),
  ],
);

export const offlineSalesInvoiceSlots = pgTable(
  "offline_sales_invoice_slots",
  {
    id: idColumn(),
    workbookId: text("workbook_id")
      .notNull()
      .references(() => offlineSalesWorkbooks.id, { onDelete: "restrict" }),
    slotNumber: integer("slot_number").notNull(),
    reservedSerial: integer("reserved_serial").notNull(),
    recordToken: text("record_token").notNull(),
    status: text("status", {
      enum: ["unused", "staged", "posted", "voided", "conflict"],
    })
      .$type<OfflineSalesSlotStatus>()
      .default("unused")
      .notNull(),
    stagedContentHash: text("staged_content_hash"),
    stagedInvoiceId: text("staged_invoice_id").references(
      (): AnyPgColumn => offlineSalesStagedInvoices.id,
      { onDelete: "restrict" },
    ),
    postedInvoiceId: text("posted_invoice_id").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_slots_token_idx").on(table.recordToken),
    uniqueIndex("offline_sales_slots_serial_idx").on(table.reservedSerial),
    uniqueIndex("offline_sales_slots_workbook_slot_idx").on(
      table.workbookId,
      table.slotNumber,
    ),
    uniqueIndex("offline_sales_slots_staged_invoice_idx")
      .on(table.stagedInvoiceId)
      .where(sql`${table.stagedInvoiceId} is not null`),
    uniqueIndex("offline_sales_slots_posted_invoice_idx")
      .on(table.postedInvoiceId)
      .where(sql`${table.postedInvoiceId} is not null`),
    check(
      "offline_sales_slots_numbers_check",
      sql`${table.slotNumber} > 0 and ${table.reservedSerial} > 0`,
    ),
  ],
);

export const offlineSalesImportBatches = pgTable(
  "offline_sales_import_batches",
  {
    id: idColumn(),
    workbookId: text("workbook_id")
      .references(() => offlineSalesWorkbooks.id, { onDelete: "restrict" }),
    originalFilename: text("original_filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    outageStartedAt: timestamp("outage_started_at", { withTimezone: true }).notNull(),
    outageEndedAt: timestamp("outage_ended_at", { withTimezone: true }).notNull(),
    outageReason: text("outage_reason").notNull(),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    status: text("status", {
      enum: [
        "uploaded",
        "preview_ready",
        "posting",
        "completed",
        "completed_with_issues",
        "rejected",
      ],
    })
      .$type<OfflineSalesBatchStatus>()
      .default("uploaded")
      .notNull(),
    totalInvoices: integer("total_invoices").default(0).notNull(),
    readyInvoices: integer("ready_invoices").default(0).notNull(),
    warningInvoices: integer("warning_invoices").default(0).notNull(),
    duplicateInvoices: integer("duplicate_invoices").default(0).notNull(),
    invalidInvoices: integer("invalid_invoices").default(0).notNull(),
    needsReviewInvoices: integer("needs_review_invoices").default(0).notNull(),
    postedInvoices: integer("posted_invoices").default(0).notNull(),
    excludedInvoices: integer("excluded_invoices").default(0).notNull(),
    processingLeaseId: text("processing_lease_id"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", {
      withTimezone: true,
    }),
    lastError: text("last_error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_batches_file_hash_idx").on(table.fileSha256),
    index("offline_sales_batches_workbook_status_idx").on(
      table.workbookId,
      table.status,
    ),
    check("offline_sales_batches_size_check", sql`${table.byteSize} > 0`),
    check(
      "offline_sales_batches_outage_range_check",
      sql`${table.outageStartedAt} < ${table.outageEndedAt}`,
    ),
    check(
      "offline_sales_batches_counts_check",
      sql`${table.totalInvoices} >= 0 and ${table.readyInvoices} >= 0 and ${table.warningInvoices} >= 0 and ${table.duplicateInvoices} >= 0 and ${table.invalidInvoices} >= 0 and ${table.needsReviewInvoices} >= 0 and ${table.postedInvoices} >= 0 and ${table.excludedInvoices} >= 0`,
    ),
    check(
      "offline_sales_batches_workbook_required_check",
      sql`${table.status} = 'rejected' or ${table.workbookId} is not null`,
    ),
  ],
);

export const offlineSalesStagedInvoices = pgTable(
  "offline_sales_staged_invoices",
  {
    id: idColumn(),
    batchId: text("batch_id")
      .notNull()
      .references(() => offlineSalesImportBatches.id, { onDelete: "cascade" }),
    workbookId: text("workbook_id")
      .notNull()
      .references(() => offlineSalesWorkbooks.id, { onDelete: "restrict" }),
    slotId: text("slot_id")
      .notNull()
      .references(() => offlineSalesInvoiceSlots.id, { onDelete: "restrict" }),
    recordToken: text("record_token").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    contentHash: text("content_hash").notNull(),
    worksheetRowNumber: integer("worksheet_row_number").notNull(),
    saleType: text("sale_type", {
      enum: ["direct_distributor", "booked_order"],
    }).notNull(),
    businessDate: timestamp("business_date", { withTimezone: true }).notNull(),
    distributorCode: text("distributor_code"),
    customerId: text("customer_id"),
    orderBookerCode: text("order_booker_code"),
    billNumber: integer("bill_number"),
    orderId: text("order_id"),
    paymentDueDate: timestamp("payment_due_date", { withTimezone: true }),
    remarks: text("remarks"),
    invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: decimal("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    pendingAmount: decimal("pending_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    outstandingAmount: decimal("outstanding_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status", {
      enum: [
        "ready",
        "warning",
        "duplicate",
        "invalid",
        "needs_review",
        "posted",
        "excluded",
      ],
    })
      .$type<OfflineSalesInvoiceStatus>()
      .notNull(),
    issueCodes: jsonb("issue_codes").$type<string[]>().default([]).notNull(),
    issueDetails: jsonb("issue_details")
      .$type<Array<{ code: string; message: string; source?: string; value?: string }>>()
      .default([])
      .notNull(),
    warningsAcknowledged: boolean("warnings_acknowledged").default(false).notNull(),
    reviewResolution: text("review_resolution"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    postedInvoiceId: text("posted_invoice_id").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_staged_workbook_token_idx").on(
      table.workbookId,
      table.recordToken,
    ),
    uniqueIndex("offline_sales_staged_invoice_number_idx").on(table.invoiceNumber),
    uniqueIndex("offline_sales_staged_posted_invoice_idx")
      .on(table.postedInvoiceId)
      .where(sql`${table.postedInvoiceId} is not null`),
    index("offline_sales_staged_batch_status_idx").on(table.batchId, table.status),
    check(
      "offline_sales_staged_amounts_check",
      sql`${table.invoiceAmount} >= 0 and ${table.paidAmount} >= 0 and ${table.pendingAmount} >= 0 and ${table.outstandingAmount} >= 0 and ${table.paidAmount} + ${table.outstandingAmount} = ${table.invoiceAmount} and ${table.pendingAmount} <= ${table.outstandingAmount}`,
    ),
    check(
      "offline_sales_staged_row_check",
      sql`${table.worksheetRowNumber} > 0`,
    ),
  ],
);

export const offlineSalesStagedItems = pgTable(
  "offline_sales_staged_items",
  {
    id: idColumn(),
    stagedInvoiceId: text("staged_invoice_id")
      .notNull()
      .references(() => offlineSalesStagedInvoices.id, { onDelete: "cascade" }),
    worksheetRowNumber: integer("worksheet_row_number").notNull(),
    productCode: text("product_code").notNull(),
    recipeId: text("recipe_id").references(() => recipes.id, {
      onDelete: "restrict",
    }),
    cartonQuantity: integer("carton_quantity").notNull(),
    looseUnitQuantity: integer("loose_unit_quantity").notNull(),
    packsPerCarton: integer("packs_per_carton").notNull(),
    baseCartonPrice: decimal("base_carton_price", { precision: 12, scale: 2 })
      .notNull(),
    freeCartons: integer("free_cartons").default(0).notNull(),
    chargedUnits: integer("charged_units").notNull(),
    dispatchedUnits: integer("dispatched_units").notNull(),
    lineAmount: decimal("line_amount", { precision: 12, scale: 2 }).notNull(),
    wacPerPack: decimal("wac_per_pack", { precision: 12, scale: 4 }).notNull(),
    stockUnitsSnapshot: integer("stock_units_snapshot").notNull(),
    physicalStockConfirmed: boolean("physical_stock_confirmed").default(false).notNull(),
    sourceColumns: jsonb("source_columns").$type<Record<string, string>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_staged_items_invoice_row_idx").on(
      table.stagedInvoiceId,
      table.worksheetRowNumber,
    ),
    check(
      "offline_sales_staged_items_quantities_check",
      sql`${table.worksheetRowNumber} > 0 and ${table.cartonQuantity} >= 0 and ${table.looseUnitQuantity} >= 0 and ${table.packsPerCarton} > 0 and ${table.freeCartons} >= 0 and ${table.chargedUnits} >= 0 and ${table.dispatchedUnits} >= 0 and ${table.baseCartonPrice} >= 0 and ${table.lineAmount} >= 0 and ${table.wacPerPack} >= 0 and ${table.stockUnitsSnapshot} >= 0`,
    ),
  ],
);

export const offlineSalesStagedPayments = pgTable(
  "offline_sales_staged_payments",
  {
    id: idColumn(),
    stagedInvoiceId: text("staged_invoice_id")
      .notNull()
      .references(() => offlineSalesStagedInvoices.id, { onDelete: "cascade" }),
    worksheetRowNumber: integer("worksheet_row_number").notNull(),
    method: text("method", { enum: ["cash", "bank_transfer", "cheque"] }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    walletCode: text("wallet_code").notNull(),
    walletId: text("wallet_id").references(() => wallets.id, { onDelete: "restrict" }),
    reference: text("reference"),
    chequeNumber: text("cheque_number"),
    chequeBank: text("cheque_bank"),
    chequeDate: timestamp("cheque_date", { withTimezone: true }),
    paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
    sourceColumns: jsonb("source_columns").$type<Record<string, string>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offline_sales_staged_payments_invoice_row_idx").on(
      table.stagedInvoiceId,
      table.worksheetRowNumber,
    ),
    check(
      "offline_sales_staged_payments_amount_check",
      sql`${table.worksheetRowNumber} > 0 and ${table.amount} > 0`,
    ),
  ],
);

export const stockReconciliationIssues = pgTable(
  "stock_reconciliation_issues",
  {
    id: idColumn(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    invoiceItemId: text("invoice_item_id")
      .notNull()
      .references(() => invoiceItems.id, { onDelete: "restrict" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "restrict" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    requestedUnits: integer("requested_units").notNull(),
    availableUnits: integer("available_units").notNull(),
    deficitUnits: integer("deficit_units").notNull(),
    snapshotStockUnits: integer("snapshot_stock_units").notNull(),
    liveStockUnits: integer("live_stock_units").notNull(),
    status: text("status", { enum: ["open", "resolved"] })
      .$type<StockReconciliationStatus>()
      .default("open")
      .notNull(),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    resolutionReason: text("resolution_reason"),
    resolutionReference: text("resolution_reference"),
    resolutionType: text("resolution_type", {
      enum: ["counted_adjustment", "missing_record"],
    }).$type<StockReconciliationResolutionType>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("stock_reconciliation_issues_status_idx").on(table.status),
    index("stock_reconciliation_issues_invoice_idx").on(table.invoiceId),
    check(
      "stock_reconciliation_issues_deficit_check",
      sql`${table.requestedUnits} > 0 and ${table.availableUnits} >= 0 and ${table.deficitUnits} > 0 and ${table.deficitUnits} = ${table.requestedUnits} - ${table.availableUnits}`,
    ),
    check(
      "stock_reconciliation_issues_resolution_check",
      sql`(
        ${table.status} = 'open' and ${table.resolvedByUserId} is null and ${table.resolutionReason} is null and ${table.resolutionReference} is null and ${table.resolutionType} is null and ${table.resolvedAt} is null
      ) or (
        ${table.status} = 'resolved' and ${table.resolvedByUserId} is not null and nullif(btrim(${table.resolutionReason}), '') is not null and nullif(btrim(${table.resolutionReference}), '') is not null and ${table.resolutionType} in ('counted_adjustment', 'missing_record') and ${table.resolvedAt} is not null
      )`,
    ),
  ],
);
