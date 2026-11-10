import { createId } from "@paralleldrive/cuid2";
import { isNull, relations, sql } from "drizzle-orm";
import { check, decimal, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { warehouses, chemicals, materialLots, packagingMaterials, chemicalLabReports } from "./inventory-schema";
import { suppliers } from "./core-suppliers";
import { user } from "./auth-schema";
import { wallets } from "./finance-schema";

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

    purchaseDate: timestamp("purchase_date").defaultNow().notNull(),
    invoiceNumber: text("invoice_number"),
    paymentMethod: text("payment_method"), // "cash", "bank_transfer", "cheque", "credit"
    bankName: text("bank_name"),
    transactionId: text("transaction_id"),
    paidBy: text("paid_by"),
    notes: text("notes"),
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
  }),
);

// --- RELATIONS ---
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  payments: many(supplierPayments),
  purchases: many(purchaseRecords),
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
