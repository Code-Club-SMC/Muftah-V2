import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  check,
  decimal,
  pgTable,
  text,
  timestamp,
  integer,
  serial,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { recipes, warehouses } from "./inventory-schema";
import { user } from "./auth-schema";
import { salesmen, discountRules, orderBookers, orders } from "./sales-erp-schema";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// Public invoice numbers use explicit transactional counters. Internal serial
// columns remain implementation details and never determine customer numbers.
export const invoiceNumberCounters = pgTable(
  "invoice_number_counters",
  {
    kind: text("kind", { enum: ["online", "offline"] }).primaryKey(),
    nextValue: integer("next_value").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "invoice_number_counters_next_value_check",
      sql`${table.nextValue} > 0`,
    ),
    check(
      "invoice_number_counters_kind_check",
      sql`${table.kind} in ('online', 'offline')`,
    ),
  ],
);

// --- CUSTOMERS ---
export const customers = pgTable("customers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  sNo: serial("s_no"),
  name: text("name").notNull(),
  address: text("address"),
  cnic: text("cnic"),
  city: text("city"),
  state: text("state"),
  bankAccount: text("bank_account"),
  mobileNumber: text("mobile_number"),
  totalSale: decimal("total_sale", { precision: 12, scale: 2 }).default("0"),
  totalPaidAmount: decimal("total_paid_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  outstandingAmount: decimal("outstanding_amount", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),
  weightSaleKg: decimal("weight_sale_kg", { precision: 12, scale: 3 }).default(
    "0",
  ),
  expenses: decimal("expenses", { precision: 12, scale: 2 }).default("0"),
  averagePerKg: decimal("average_per_kg", { precision: 12, scale: 2 }).default(
    "0",
  ),
  averageKgWithExpense: decimal("average_kg_with_expense", {
    precision: 12,
    scale: 2,
  }).default("0"),
  expenseAverage: decimal("expense_average", {
    precision: 12,
    scale: 2,
  }).default("0"),
  customerType: text("customer_type").notNull().default("retailer"), // "distributor" | "retailer" | "shopkeeper" | "wholesaler"
  salesmanId: text("salesman_id").references(() => salesmen.id),
  defaultMargin: decimal("default_margin", { precision: 5, scale: 2 }).default("0"), // distributor default margin %
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }).default("0"),
  creditHold: boolean("credit_hold").default(false),
  ...timestamps,
});

// --- INVOICES ---
export const invoices = pgTable(
  "invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sNo: serial("s_no"),
    date: timestamp("date").notNull().defaultNow(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceNumber: text("invoice_number").notNull(),
    source: text("source", { enum: ["online", "offline_import"] })
      .notNull()
      .default("online"),
    paidAmount: decimal("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    returnedAmount: decimal("returned_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    outstandingAmount: decimal("outstanding_amount", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    paymentDueDate: timestamp("payment_due_date", { withTimezone: true }),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "partially_paid", "paid"],
    })
      .notNull()
      .default("unpaid"),
    expenses: decimal("expenses", { precision: 12, scale: 2 }).default("0"),
    expensesDescription: text("expenses_description"),
    invoiceDiscount: decimal("invoice_discount", { precision: 12, scale: 2 }).default("0"),
    invoiceDiscountDescription: text("invoice_discount_description"),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
    totalPrice: decimal("total_price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    remarks: text("remarks"),

    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    stockWarehouseId: text("stock_warehouse_id").references(() => warehouses.id),
    performedById: text("performed_by_id")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: ["saved", "voided"] })
      .notNull()
      .default("saved"),
    salesmanId: text("salesman_id").references(() => salesmen.id),
    // Link to a booked order (set when the invoice is generated from an order).
    // Nullable so non-order invoices are unaffected.
    orderId: text("order_id").references(() => orders.id),
    // Denormalized order booker for fast portal queries (recoveries).
    orderBookerId: text("order_booker_id").references(() => orderBookers.id),
    // The database migration owns this FK. Keeping the Drizzle column as plain
    // text avoids a sales-schema <-> offline-sales-schema module cycle that
    // corrupts relational query inference across the application.
    offlineSalesSlotId: text("offline_sales_slot_id"),
    ...timestamps,
  },
  (table) => ({
    statusDateIdx: index("idx_invoices_status_date").on(table.status, table.date),
    orderBookerIdx: index("idx_invoices_order_booker").on(table.orderBookerId),
    invoiceNumberUnique: uniqueIndex("invoices_invoice_number_unique").on(
      table.invoiceNumber,
    ),
    orderIdUnique: uniqueIndex("invoices_order_id_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    offlineSalesSlotUnique: uniqueIndex("invoices_offline_sales_slot_unique")
      .on(table.offlineSalesSlotId)
      .where(sql`${table.offlineSalesSlotId} is not null`),
    settlementAmountsCheck: check(
      "invoices_settlement_amounts_check",
      sql`${table.paidAmount} >= 0 and ${table.returnedAmount} >= 0 and ${table.outstandingAmount} >= 0 and ${table.paidAmount} + ${table.returnedAmount} + ${table.outstandingAmount} = ${table.totalPrice}`,
    ),
    sourceCheck: check(
      "invoices_source_check",
      sql`${table.source} in ('online', 'offline_import')`,
    ),
    paymentStatusCheck: check(
      "invoices_payment_status_check",
      sql`${table.paymentStatus} in ('unpaid', 'partially_paid', 'paid')`,
    ),
    lifecycleStatusCheck: check(
      "invoices_lifecycle_status_check",
      sql`${table.status} in ('saved', 'voided')`,
    ),
  }),
);

// --- INVOICE ITEMS ---
export const invoiceItems = pgTable("invoice_items", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  pack: text("pack").notNull(),
  recipeId: text("recipe_id").references(() => recipes.id), // For stock checks against Finished Goods
  numberOfCartons: integer("number_of_cartons").notNull().default(0),
  quantity: integer("quantity").notNull().default(0), // Loose units
  packsPerCarton: integer("packs_per_carton").notNull().default(0),
  totalWeight: decimal("total_weight", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  perCartonPrice: decimal("per_carton_price", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discountCartons: integer("discount_cartons").notNull().default(0),
  hsnCode: text("hsn_code").notNull(),
  retailPrice: decimal("retail_price", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  margin: decimal("margin", { precision: 12, scale: 2 }).notNull().default("0"),
  tpPrice: decimal("tp_price", { precision: 12, scale: 2 }),
  marginPercent: decimal("margin_percent", { precision: 12, scale: 2 }),
  actualPackSize: integer("actual_pack_size").default(0),
  chargedUnits: integer("charged_units").notNull().default(0),
  dispatchedUnits: integer("dispatched_units").notNull().default(0),
  fillAmountSnapshot: decimal("fill_amount_snapshot", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  fillUnitSnapshot: text("fill_unit_snapshot"),
  discountRuleId: text("discount_rule_id").references(() => discountRules.id),
  freeCartons: integer("free_cartons").default(0),
  isPriceOverride: boolean("is_price_override").default(false),
  costOfGoodsSold: decimal("cost_of_goods_sold", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  costOfGoodsSoldPerUnit: decimal("cost_of_goods_sold_per_unit", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("0"),
  ...timestamps,
}, (table) => ({
  discountRuleIdx: index("idx_invoice_items_discount_rule").on(table.discountRuleId),
  recipeInvoiceIdx: index("idx_invoice_items_recipe_invoice").on(table.recipeId, table.invoiceId),
}));

// --- RELATIONS ---

export const customersRelations = relations(customers, ({ many }) => ({
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  salesman: one(salesmen, {
    fields: [invoices.salesmanId],
    references: [salesmen.id],
  }),
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
  orderBooker: one(orderBookers, {
    fields: [invoices.orderBookerId],
    references: [orderBookers.id],
  }),
  items: many(invoiceItems),
  warehouse: one(warehouses, {
    fields: [invoices.warehouseId],
    references: [warehouses.id],
  }),
  performer: one(user, {
    fields: [invoices.performedById],
    references: [user.id],
  }),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  recipe: one(recipes, {
    fields: [invoiceItems.recipeId],
    references: [recipes.id],
  }),
  discountRule: one(discountRules, {
    fields: [invoiceItems.discountRuleId],
    references: [discountRules.id],
  }),
}));
