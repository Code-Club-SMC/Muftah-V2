import { createId } from "@paralleldrive/cuid2";
import { isNull, relations, sql } from "drizzle-orm";
import { boolean, check, decimal, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { warehouses, chemicals, materialLots, packagingMaterials, chemicalLabReports } from "./inventory-schema";
import { suppliers } from "./core-suppliers";
import { user } from "./auth-schema";
import { wallets, transactions } from "./finance-schema";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// --- SUPPLIER PAYMENTS ---
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    paymentDate: timestamp("payment_date").defaultNow().notNull(),
    reference: text("reference"), // Invoice #, Check #
    method: text("method"), // "cash", "bank_transfer", "cheque"
    bankName: text("bank_name"),
    paidBy: text("paid_by"),
    walletId: text("wallet_id"), // wallet used for payment, or "pay_later"
    notes: text("notes"),
    purchaseId: text("purchase_id").references(() => purchaseRecords.id), // Link payment to a specific purchase
    ...timestamps,
  },
  (t) => ({
    supplierIdx: index("payment_supplier_idx").on(t.supplierId),
    purchaseIdx: index("payment_purchase_idx").on(t.purchaseId),
  }),
);

// --- PURCHASE RECORDS (Stock In) ---
export const purchaseRecords = pgTable(
  "purchase_records",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id), // Where stock was added

    // Polymorphic reference to material
    materialType: text("material_type").notNull(), // "chemical", "packaging"
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(
      () => packagingMaterials.id,
    ),
    lotId: text("lot_id").references(() => materialLots.id),

    quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
    cost: decimal("cost", { precision: 12, scale: 2 }).notNull(), // Total cost of this purchase
    unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(), // Cost per unit at time of purchase
    paidAmount: decimal("paid_amount", { precision: 12, scale: 2 })
      .default("0")
      .notNull(), // Track amount paid for THIS purchase
    // Debit notes from completed supplier returns that lowered what we owe on THIS purchase.
    returnedAmount: decimal("returned_amount", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),

    purchaseDate: timestamp("purchase_date").defaultNow().notNull(),
    invoiceNumber: text("invoice_number"),
    paymentMethod: text("payment_method"), // "cash", "bank_transfer", "cheque", "credit"
    bankName: text("bank_name"),
    transactionId: text("transaction_id"),
    paidBy: text("paid_by"),
    notes: text("notes"),
    // By-product tracking: the containers this purchase came in become sellable empties once used.
    byProductTracked: boolean("by_product_tracked").notNull().default(false),
    containerName: text("container_name"),
    containerSize: decimal("container_size", { precision: 12, scale: 3 }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: text("voided_by_id").references(() => user.id),
    voidReason: text("void_reason"),
    voidRefundAmount: decimal("void_refund_amount", { precision: 12, scale: 2 }),
    voidRefundWalletId: text("void_refund_wallet_id").references(() => wallets.id),
    voidSnapshot: jsonb("void_snapshot").$type<{
      materialName: string;
      unit: string;
      supplierName: string;
    }>(),
    ...timestamps,
  },
  (t) => ({
    supplierIdx: index("purchase_supplier_idx").on(t.supplierId),
    warehouseIdx: index("purchase_warehouse_idx").on(t.warehouseId),
    dateIdx: index("purchase_date_idx").on(t.purchaseDate),
    activeSupplierIdx: index("purchase_active_supplier_idx").on(t.supplierId, t.purchaseDate).where(isNull(t.voidedAt)),
    returnedAmountNotNegative: check("purchase_returned_amount_ck", sql`${t.returnedAmount} >= 0`),
    voidRefundBounds: check("purchase_void_refund_bounds", sql`${t.voidRefundAmount} >= 0 AND ${t.voidRefundAmount} <= ${t.paidAmount}`),
    voidMetadata: check("purchase_void_metadata", sql`(
      (${t.voidedAt} IS NULL AND ${t.voidedById} IS NULL AND ${t.voidReason} IS NULL
        AND ${t.voidRefundAmount} IS NULL AND ${t.voidRefundWalletId} IS NULL AND ${t.voidSnapshot} IS NULL)
      OR
      (${t.voidedAt} IS NOT NULL AND ${t.voidedById} IS NOT NULL AND ${t.voidReason} IS NOT NULL
        AND length(btrim(${t.voidReason})) BETWEEN 1 AND 1000
        AND ${t.voidRefundAmount} IS NOT NULL AND ${t.voidSnapshot} IS NOT NULL
        AND ((${t.voidRefundAmount} = 0 AND ${t.voidRefundWalletId} IS NULL)
          OR (${t.voidRefundAmount} > 0 AND ${t.voidRefundWalletId} IS NOT NULL)))
    )`),
    byProductContainer: check("purchase_by_product_container", sql`(
      (${t.byProductTracked} = false AND ${t.containerName} IS NULL AND ${t.containerSize} IS NULL)
      OR
      (${t.byProductTracked} = true AND ${t.containerName} IS NOT NULL AND length(btrim(${t.containerName})) BETWEEN 1 AND 40
        AND ${t.containerSize} > 0 AND mod(${t.quantity}, ${t.containerSize}) = 0)
    )`),
  }),
);

// --- SUPPLIER RETURNS (one per purchase line; debit note on completion) ---
export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    returnNumber: text("return_number").notNull(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    // Cancelled and voided returns go with the purchase if it is deleted; active ones block the delete.
    purchaseId: text("purchase_id").notNull().references(() => purchaseRecords.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    lotId: text("lot_id").notNull().references(() => materialLots.id),
    materialType: text("material_type").notNull(), // "chemical" | "packaging"
    chemicalId: text("chemical_id").references(() => chemicals.id),
    packagingMaterialId: text("packaging_material_id").references(() => packagingMaterials.id),
    quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
    unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
    totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("requested"),
    requestedById: text("requested_by_id").notNull().references(() => user.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedById: text("dispatched_by_id").references(() => user.id),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedById: text("completed_by_id").references(() => user.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    debitNoteNumber: text("debit_note_number"),
    appliedToPurchaseAmount: decimal("applied_to_purchase_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    refundWalletId: text("refund_wallet_id").references(() => wallets.id),
    refundTransactionId: text("refund_transaction_id").references(() => transactions.id),
    supplierCreditAmount: decimal("supplier_credit_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    cancelledById: text("cancelled_by_id").references(() => user.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    voidedById: text("voided_by_id").references(() => user.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => ({
    numberUnique: uniqueIndex("supplier_returns_number_unique_idx").on(t.returnNumber),
    debitNoteUnique: uniqueIndex("supplier_returns_debit_note_unique_idx").on(t.debitNoteNumber).where(sql`${t.debitNoteNumber} IS NOT NULL`),
    supplierStatusIdx: index("supplier_returns_supplier_status_idx").on(t.supplierId, t.status, t.requestedAt),
    purchaseIdx: index("supplier_returns_purchase_idx").on(t.purchaseId),
    statusCheck: check("supplier_returns_status_ck", sql`${t.status} IN ('requested', 'dispatched', 'completed', 'cancelled', 'voided')`),
    quantityCheck: check("supplier_returns_quantity_ck", sql`${t.quantity} > 0 AND ${t.unitCost} >= 0 AND ${t.totalAmount} >= 0`),
    debitNoteCheck: check("supplier_returns_debit_note_ck", sql`${t.status} NOT IN ('completed', 'voided') OR (
      ${t.debitNoteNumber} IS NOT NULL AND ${t.completedAt} IS NOT NULL
      AND ${t.appliedToPurchaseAmount} + ${t.refundAmount} + ${t.supplierCreditAmount} = ${t.totalAmount})`),
    refundWalletCheck: check("supplier_returns_refund_wallet_ck", sql`(${t.refundAmount} = 0 AND ${t.refundWalletId} IS NULL) OR (${t.refundAmount} > 0 AND ${t.refundWalletId} IS NOT NULL)`),
  }),
);

// --- SUPPLIER CREDIT (append-only; balance = sum of amount) ---
// issued: debit note leftover kept with the supplier (+)
// used: paid part of a purchase from credit (−)
// use_reversed: that purchase was deleted, credit given back (+)
// issue_reversed: the debit note was voided (−)
export const supplierCreditMovements = pgTable(
  "supplier_credit_movements",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    kind: text("kind").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    supplierReturnId: text("supplier_return_id").references(() => supplierReturns.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id").references(() => purchaseRecords.id, { onDelete: "set null" }),
    supplierPaymentId: text("supplier_payment_id").references(() => supplierPayments.id, { onDelete: "set null" }),
    note: text("note"),
    performedById: text("performed_by_id").notNull().references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    supplierIdx: index("supplier_credit_supplier_idx").on(t.supplierId, t.createdAt),
    kindCheck: check("supplier_credit_kind_ck", sql`${t.kind} IN ('issued', 'used', 'use_reversed', 'issue_reversed')`),
    signCheck: check("supplier_credit_sign_ck", sql`(${t.kind} IN ('issued', 'use_reversed') AND ${t.amount} > 0) OR (${t.kind} IN ('used', 'issue_reversed') AND ${t.amount} < 0)`),
  }),
);

// --- RELATIONS ---
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  payments: many(supplierPayments),
  purchases: many(purchaseRecords),
  returns: many(supplierReturns),
  creditMovements: many(supplierCreditMovements),
}));

export const supplierPaymentsRelations = relations(
  supplierPayments,
  ({ one }) => ({
    supplier: one(suppliers, {
      fields: [supplierPayments.supplierId],
      references: [suppliers.id],
    }),
    purchase: one(purchaseRecords, {
      fields: [supplierPayments.purchaseId],
      references: [purchaseRecords.id],
    }),
  }),
);

export const purchaseRecordsRelations = relations(
  purchaseRecords,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseRecords.supplierId],
      references: [suppliers.id],
    }),
    payments: many(supplierPayments),
    labReports: many(chemicalLabReports),
    returns: many(supplierReturns),
    voidedBy: one(user, {
      fields: [purchaseRecords.voidedById],
      references: [user.id],
      relationName: "purchaseVoidedBy",
    }),
    voidRefundWallet: one(wallets, {
      fields: [purchaseRecords.voidRefundWalletId],
      references: [wallets.id],
      relationName: "purchaseVoidRefundWallet",
    }),
    warehouse: one(warehouses, {
      fields: [purchaseRecords.warehouseId],
      references: [warehouses.id],
    }),
    chemical: one(chemicals, {
      fields: [purchaseRecords.chemicalId],
      references: [chemicals.id],
    }),
    packagingMaterial: one(packagingMaterials, {
      fields: [purchaseRecords.packagingMaterialId],
      references: [packagingMaterials.id],
    }),
  }),
);

export const supplierReturnsRelations = relations(supplierReturns, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierReturns.supplierId], references: [suppliers.id] }),
  purchase: one(purchaseRecords, { fields: [supplierReturns.purchaseId], references: [purchaseRecords.id] }),
  warehouse: one(warehouses, { fields: [supplierReturns.warehouseId], references: [warehouses.id] }),
  chemical: one(chemicals, { fields: [supplierReturns.chemicalId], references: [chemicals.id] }),
  packagingMaterial: one(packagingMaterials, { fields: [supplierReturns.packagingMaterialId], references: [packagingMaterials.id] }),
  refundWallet: one(wallets, { fields: [supplierReturns.refundWalletId], references: [wallets.id], relationName: "supplierReturnRefundWallet" }),
  requestedBy: one(user, { fields: [supplierReturns.requestedById], references: [user.id], relationName: "supplierReturnRequestedBy" }),
}));

export const supplierCreditMovementsRelations = relations(supplierCreditMovements, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierCreditMovements.supplierId], references: [suppliers.id] }),
  supplierReturn: one(supplierReturns, { fields: [supplierCreditMovements.supplierReturnId], references: [supplierReturns.id] }),
}));
