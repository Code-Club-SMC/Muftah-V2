import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  decimal,
  integer,
  serial,
  boolean,
  index,
  unique,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

import { customers, invoices, invoiceItems } from "./sales-schema";
import { products, recipes, warehouses } from "./inventory-schema";
import { user } from "./auth-schema";
import { employees } from "./hr-schema";
import { wallets } from "./finance-schema";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// --- SALESMEN ---
export const salesmen = pgTable("salesmen", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("active"), // "active" | "inactive"
  employeeId: text("employee_id"),
  ...timestamps,
});

// --- RECIPE PRICES (per-pack baseline pricing for invoices) ---
export const recipePrices = pgTable("recipe_prices", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  recipeId: text("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" })
    .unique(),
  invoicePricePerPack: decimal("invoice_price_per_pack", {
    precision: 12,
    scale: 2,
  }).notNull(),
  retailPricePerPack: decimal("retail_price_per_pack", {
    precision: 12,
    scale: 2,
  }).notNull(),
  updatedById: text("updated_by_id").references(() => user.id),
  ...timestamps,
});

// --- ENTITY RECIPE RATES (per-entity carton pricing) ---
// Polymorphic: entityType ∈ {'distributor', 'order_booker', 'general'}.
// entityId references customers.id (when 'distributor'), orderBookers.id
// (when 'order_booker'), or fixed "general" for walk-in/general invoices.
// No FK on entityId because of the polymorphism; referential integrity is enforced
// at the application layer. Per-pack price is derived from pricePerCarton and
// recipe.containersPerCarton at read time.
export const entityRecipeRates = pgTable(
  "entity_recipe_rates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entityType: text("entity_type").notNull(), // "distributor" | "order_booker" | "general"
    entityId: text("entity_id").notNull(), // customers.id OR orderBookers.id OR "general"
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    pricePerCarton: decimal("price_per_carton", {
      precision: 12,
      scale: 2,
    }).notNull(),
    updatedById: text("updated_by_id").references(() => user.id),
    ...timestamps,
  },
  (table) => ({
    entityRecipeUnique: unique("uq_entity_recipe_rates_entity_recipe").on(
      table.entityType,
      table.entityId,
      table.recipeId,
    ),
    entityRecipeIdx: index("idx_entity_recipe_rates_entity").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

// --- DISCOUNT RULES (distributor-specific, flexible discount configuration) ---
// Supports: per-recipe rules, all-items rules, discount cartons, and free units
export const discountRules = pgTable("discount_rules", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  recipeId: text("recipe_id")
    .references(() => recipes.id, { onDelete: "cascade" }), // NULL = applies to ALL items
  // Rule type determines how the discount is applied
  ruleType: text("rule_type").notNull().default("free_units"), 
  // "free_units" | "discount_cartons" | "percentage_off"
  quantityThreshold: integer("quantity_threshold").notNull().default(0),
  // Minimum cartons to trigger the rule
  freeUnits: integer("free_units").notNull().default(0),
  // Number of free cartons given (for free_units type)
  discountCartons: integer("discount_cartons").notNull().default(0),
  // Number of cartons discounted/charged at reduced rate (for discount_cartons type)
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).default("0"),
  // Percentage off for percentage_off type (e.g., 10.00 = 10% off)
  effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
}, (table) => ({
  customerRecipeIdx: index("idx_discount_rules_customer_recipe").on(table.customerId, table.recipeId),
  datesIdx: index("idx_discount_rules_dates").on(table.effectiveFrom, table.effectiveTo),
  activeIdx: index("idx_discount_rules_active").on(table.isActive),
}));

// --- PAYMENTS ---
export const payments = pgTable(
  "payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    method: text("method", {
      enum: ["cash", "bank_transfer", "cheque", "expense_offset"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "confirmed", "returned", "cancelled", "reversed"],
    }).notNull(),
    walletId: text("wallet_id").references(() => wallets.id),
    reference: text("reference"),
    chequeNumber: text("cheque_number"),
    chequeBank: text("cheque_bank"),
    chequeDate: timestamp("cheque_date", { withTimezone: true }),
    expenseType: text("expense_type"),
    recordedById: text("recorded_by_id")
      .notNull()
      .references(() => user.id),
    paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
    effectiveDate: timestamp("effective_date", { withTimezone: true }),
    source: text("source", {
      enum: ["invoice_creation", "recovery", "offline_import", "adjustment"],
    }).notNull(),
    sourceRecordId: text("source_record_id"),
    allocationGroupId: text("allocation_group_id"),
    confirmedById: text("confirmed_by_id").references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    resolvedById: text("resolved_by_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => ({
    amountPositiveCheck: check(
      "payments_amount_positive_check",
      sql`${table.amount} > 0`,
    ),
    methodStatusCheck: check(
      "payments_method_status_check",
      sql`(
        (${table.method} in ('cash', 'expense_offset') and ${table.status} in ('confirmed', 'reversed')) or
        (${table.method} = 'bank_transfer' and ${table.status} in ('pending', 'confirmed', 'cancelled', 'reversed')) or
        (${table.method} = 'cheque' and ${table.status} in ('pending', 'confirmed', 'returned', 'cancelled', 'reversed'))
      )`,
    ),
    methodDetailsCheck: check(
      "payments_method_details_check",
      sql`(
        (${table.method} = 'expense_offset' or ${table.walletId} is not null) and
        (${table.method} <> 'bank_transfer' or nullif(btrim(${table.reference}), '') is not null) and
        (${table.method} <> 'cheque' or (
          nullif(btrim(${table.chequeNumber}), '') is not null and
          nullif(btrim(${table.chequeBank}), '') is not null and
          ${table.chequeDate} is not null
        ))
      )`,
    ),
    confirmationCheck: check(
      "payments_confirmation_check",
      sql`(
        (${table.status} in ('confirmed', 'reversed') and ${table.effectiveDate} is not null and ${table.confirmedById} is not null and ${table.confirmedAt} is not null) or
        (${table.status} in ('pending', 'returned', 'cancelled') and ${table.effectiveDate} is null and ${table.confirmedById} is null and ${table.confirmedAt} is null)
      )`,
    ),
    resolutionCheck: check(
      "payments_resolution_check",
      sql`(
        (${table.status} in ('returned', 'cancelled', 'reversed') and ${table.resolvedById} is not null and ${table.resolvedAt} is not null and nullif(btrim(${table.resolutionReason}), '') is not null) or
        (${table.status} in ('pending', 'confirmed') and ${table.resolvedById} is null and ${table.resolvedAt} is null and ${table.resolutionReason} is null)
      )`,
    ),
    sourceCheck: check(
      "payments_source_check",
      sql`${table.source} in ('invoice_creation', 'recovery', 'offline_import', 'adjustment')`,
    ),
    sourceRecordUnique: uniqueIndex("payments_source_record_unique")
      .on(table.source, table.sourceRecordId)
      .where(sql`${table.sourceRecordId} is not null`),
    invoiceStatusIdx: index("payments_invoice_status_idx").on(
      table.invoiceId,
      table.status,
    ),
    effectiveDateIdx: index("payments_effective_date_idx").on(
      table.effectiveDate,
    ),
  }),
);

// --- SLIP RECORDS ---
export const slipRecords = pgTable("slip_records", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  slipNumber: text("slip_number").notNull().unique(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  salesmanId: text("salesman_id")
    .references(() => salesmen.id), // Optional
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
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
  status: text("status").notNull().default("open"), // "open" | "partially_recovered" | "closed"
  recoveryStatus: text("recovery_status"), // "pending" | "in_progress" | "partially_paid" | "overdue" | "defaulted"
  recoveryAssignedToId: text("recovery_assigned_to_id").references(() => salesmen.id),
  nextFollowUpDate: timestamp("next_follow_up_date"),
  lastFollowUpDate: timestamp("last_follow_up_date"),
  escalationLevel: integer("escalation_level").default(0),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  reconciledAt: timestamp("reconciled_at"),
  ...timestamps,
}, (table) => ({
  statusIdx: index("idx_slip_records_status").on(table.status),
  recoveryStatusIdx: index("idx_slip_records_recovery_status").on(table.recoveryStatus),
  recoveryAssignedIdx: index("idx_slip_records_recovery_assigned").on(table.recoveryAssignedToId),
  nextFollowUpIdx: index("idx_slip_records_next_follow_up").on(table.nextFollowUpDate),
  invoiceUnique: uniqueIndex("slip_records_invoice_unique").on(table.invoiceId),
  settlementAmountsCheck: check(
    "slip_records_settlement_amounts_check",
    sql`${table.invoiceAmount} >= 0 and ${table.paidAmount} >= 0 and ${table.returnedAmount} >= 0 and ${table.outstandingAmount} >= 0 and ${table.paidAmount} + ${table.returnedAmount} + ${table.outstandingAmount} = ${table.invoiceAmount}`,
  ),
}));

// --- CREDIT RECOVERY ATTEMPTS ---
export const creditRecoveryAttempts = pgTable("credit_recovery_attempts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  slipId: text("slip_id")
    .notNull()
    .references(() => slipRecords.id),
  assignedToId: text("assigned_to_id")
    .references(() => salesmen.id),
  attemptMethod: text("attempt_method").notNull().default("call"), // "call" | "visit" | "whatsapp" | "letter" | "other"
  attemptOutcome: text("attempt_outcome").notNull().default("no_answer"), // "no_answer" | "promised" | "partial_payment" | "refused" | "unreachable" | "resolved"
  amountPromised: decimal("amount_promised", { precision: 12, scale: 2 }),
  promisedDate: timestamp("promised_date"),
  notes: text("notes"),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  ...timestamps,
}, (table) => ({
  slipIdIdx: index("idx_credit_recovery_attempts_slip_id").on(table.slipId),
}));

// --- PRICE CHANGE LOG ---
export const priceChangeLog = pgTable("price_change_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  customerId: text("customer_id").references(() => customers.id), // Nullable for global changes
  oldPrice: decimal("old_price", { precision: 12, scale: 2 }).notNull(),
  newPrice: decimal("new_price", { precision: 12, scale: 2 }).notNull(),
  changedById: text("changed_by_id")
    .notNull()
    .references(() => user.id),
  source: text("source").notNull(), // "admin" | "invoice_override" | "invoice_calculation"
  invoiceId: text("invoice_id").references(() => invoices.id), // Nullable
  metadata: jsonb("metadata"), // Stores additional context: { priceAgreementId, customerDiscountRuleId, promoRuleId }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- ORDER BOOKERS ---
export const orderBookers = pgTable("order_bookers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  assignedArea: text("assigned_area"),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("0"),
  employeeId: text("employee_id"), // nullable link to HR employees for payroll
  userId: text("user_id"), // links to auth user for self-service login
  status: text("status").notNull().default("active"), // "active" | "inactive"
  ...timestamps,
});

// --- ORDERS ---
export const orders = pgTable("orders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  billNumber: integer("bill_number").notNull(),
  orderBookerId: text("order_booker_id")
    .notNull()
    .references(() => orderBookers.id),
  shopkeeperName: text("shopkeeper_name").notNull(),
  shopkeeperMobile: text("shopkeeper_mobile"),
  shopkeeperAddress: text("shopkeeper_address"),
  status: text("status").notNull().default("pending"), // "pending" | "confirmed" | "delivered" | "returned"
  tripId: text("trip_id"),
  fulfilledBySalesmanId: text("fulfilled_by_salesman_id")
    .references(() => salesmen.id),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledAmount: decimal("fulfilled_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  ...timestamps,
}, (table) => ({
  uniqueOrderBookerBillNumber: unique("uq_orders_order_booker_bill_number").on(
    table.orderBookerId,
    table.billNumber,
  ),
}));

// --- ORDER ITEMS ---
export const orderItems = pgTable("order_items", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  recipeId: text("recipe_id")
    .references(() => recipes.id),
  unitType: text("unit_type").notNull().default("full_carton"), // "full_carton" | "half_carton" | "pack" | "shopper"
  quantity: integer("quantity").notNull().default(0),
  rate: decimal("rate", { precision: 12, scale: 2 }).notNull().default("0"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  ...timestamps,
});

// --- ORDER BOOKER TRIPS ---
export const orderBookerTrips = pgTable("order_booker_trips", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  orderBookerId: text("order_booker_id")
    .notNull()
    .references(() => orderBookers.id),
  tripDate: timestamp("trip_date").notNull(),
  destination: text("destination").notNull(),
  shopType: text("shop_type").$type<"old" | "new">().notNull().default("old"),
  distanceKm: decimal("distance_km", { precision: 8, scale: 2 }).notNull().default("0"),
  vehicleType: text("vehicle_type").notNull().default("own_vehicle"), // "own_vehicle" | "company_vehicle"
  fuelCost: decimal("fuel_cost", { precision: 12, scale: 2 }).default("0"),
  tadaAmount: decimal("tada_amount", { precision: 12, scale: 2 }).default("0"),
  notes: text("notes"),
  recordedById: text("recorded_by_id")
    .references(() => user.id),
  ...timestamps,
});

// --- COMMISSION TIERS ---
export const commissionTiers = pgTable("commission_tiers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  orderBookerId: text("order_booker_id").references(() => orderBookers.id),
  minAmount: decimal("min_amount", { precision: 12, scale: 2 }).notNull(),
  maxAmount: decimal("max_amount", { precision: 12, scale: 2 }),
  rate: decimal("rate", { precision: 5, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

// --- COMMISSION RECORDS ---
export const commissionRecords = pgTable("commission_records", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  orderBookerId: text("order_booker_id")
    .notNull()
    .references(() => orderBookers.id),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  fulfilledAmount: decimal("fulfilled_amount", { precision: 12, scale: 2 }).notNull(),
  appliedRate: decimal("applied_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull(),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").notNull().default("accrued"), // "accrued" | "paid" | "reversed"
  paidInPayslipId: text("paid_in_payslip_id"),
  ...timestamps,
}, (table) => ({
  uniqueOrderBookerOrder: unique("uq_commission_records_booker_order").on(
    table.orderBookerId,
    table.orderId,
  ),
}));

// --- SALES PERFORMANCE LOGS (Order Booker & Salesman monthly metrics) ---
export const salesPerformanceLogs = pgTable("sales_performance_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),

  // Period
  yearMonth: text("year_month").notNull(), // "YYYY-MM"

  // Order Booker specific
  totalOrders: integer("total_orders").default(0).notNull(),
  fulfilledOrders: integer("fulfilled_orders").default(0).notNull(),
  totalOrderValue: decimal("total_order_value", { precision: 14, scale: 2 }).default("0").notNull(),
  totalCommission: decimal("total_commission", { precision: 12, scale: 2 }).default("0").notNull(),

  // Salesman specific
  totalInvoices: integer("total_invoices").default(0).notNull(),
  totalCartonsSold: integer("total_cartons_sold").default(0).notNull(),
  totalSalesValue: decimal("total_sales_value", { precision: 14, scale: 2 }).default("0").notNull(),
  totalTargetValue: decimal("total_target_value", { precision: 14, scale: 2 }).default("0").notNull(),

  // Achievement rate (computed)
  achievementRate: decimal("achievement_rate", { precision: 5, scale: 2 }).default("0").notNull(), // percentage

  // Rank within role for the month
  monthlyRank: integer("monthly_rank").default(0).notNull(),

  // Raw data references
  commissionRecordIds: jsonb("commission_record_ids").$type<string[]>().default([]),
  invoiceIds: jsonb("invoice_ids").$type<string[]>().default([]),

  // Attribution
  loggedAt: timestamp("logged_at").defaultNow().notNull(),
  remarks: text("remarks"),

  ...timestamps,
}, (table) => ({
  employeeMonthIdx: index("idx_perf_logs_employee_month").on(table.employeeId, table.yearMonth),
  yearMonthIdx: index("idx_perf_logs_year_month").on(table.yearMonth),
}));

// --- RELATIONS ---
export const salesmenRelations = relations(salesmen, ({ many }) => ({
  customers: many(customers),
  invoices: many(invoices),
  slipRecords: many(slipRecords),
}));

export const recipePricesRelations = relations(recipePrices, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipePrices.recipeId],
    references: [recipes.id],
  }),
  updatedBy: one(user, {
    fields: [recipePrices.updatedById],
    references: [user.id],
  }),
}));

export const entityRecipeRatesRelations = relations(
  entityRecipeRates,
  ({ one }) => ({
    recipe: one(recipes, {
      fields: [entityRecipeRates.recipeId],
      references: [recipes.id],
    }),
    updatedBy: one(user, {
      fields: [entityRecipeRates.updatedById],
      references: [user.id],
    }),
  }),
);

export const discountRulesRelations = relations(
  discountRules,
  ({ one }) => ({
    customer: one(customers, {
      fields: [discountRules.customerId],
      references: [customers.id],
    }),
    recipe: one(recipes, {
      fields: [discountRules.recipeId],
      references: [recipes.id],
    }),
  })
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  customer: one(customers, {
    fields: [payments.customerId],
    references: [customers.id],
  }),
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
  recordedBy: one(user, {
    fields: [payments.recordedById],
    references: [user.id],
    relationName: "paymentRecordedBy",
  }),
  wallet: one(wallets, {
    fields: [payments.walletId],
    references: [wallets.id],
  }),
  confirmedBy: one(user, {
    fields: [payments.confirmedById],
    references: [user.id],
    relationName: "paymentConfirmedBy",
  }),
  resolvedBy: one(user, {
    fields: [payments.resolvedById],
    references: [user.id],
    relationName: "paymentResolvedBy",
  }),
}));

export const slipRecordsRelations = relations(slipRecords, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [slipRecords.invoiceId],
    references: [invoices.id],
  }),
  customer: one(customers, {
    fields: [slipRecords.customerId],
    references: [customers.id],
  }),
  salesman: one(salesmen, {
    fields: [slipRecords.salesmanId],
    references: [salesmen.id],
  }),
  recoveryAssignedTo: one(salesmen, {
    fields: [slipRecords.recoveryAssignedToId],
    references: [salesmen.id],
  }),
  recoveryAttempts: many(creditRecoveryAttempts),
}));

export const priceChangeLogRelations = relations(priceChangeLog, ({ one }) => ({
  product: one(products, {
    fields: [priceChangeLog.productId],
    references: [products.id],
  }),
  customer: one(customers, {
    fields: [priceChangeLog.customerId],
    references: [customers.id],
  }),
  changedBy: one(user, {
    fields: [priceChangeLog.changedById],
    references: [user.id],
  }),
  invoice: one(invoices, {
    fields: [priceChangeLog.invoiceId],
    references: [invoices.id],
  }),
}));

export const orderBookersRelations = relations(orderBookers, ({ many }) => ({
  orders: many(orders),
  trips: many(orderBookerTrips),
  commissionRecords: many(commissionRecords),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  orderBooker: one(orderBookers, {
    fields: [orders.orderBookerId],
    references: [orderBookers.id],
  }),
  trip: one(orderBookerTrips, {
    fields: [orders.tripId],
    references: [orderBookerTrips.id],
  }),
  fulfilledBySalesman: one(salesmen, {
    fields: [orders.fulfilledBySalesmanId],
    references: [salesmen.id],
  }),
  items: many(orderItems),
}));

export const orderBookerTripsRelations = relations(orderBookerTrips, ({ one, many }) => ({
  orderBooker: one(orderBookers, {
    fields: [orderBookerTrips.orderBookerId],
    references: [orderBookers.id],
  }),
  recordedBy: one(user, {
    fields: [orderBookerTrips.recordedById],
    references: [user.id],
  }),
  orders: many(orders),
}));

export const commissionRecordsRelations = relations(commissionRecords, ({ one }) => ({
  orderBooker: one(orderBookers, {
    fields: [commissionRecords.orderBookerId],
    references: [orderBookers.id],
  }),
  order: one(orders, {
    fields: [commissionRecords.orderId],
    references: [orders.id],
  }),
}));

// ── SALES RETURNS / CREDIT NOTES ───────────────────────────────────────────
export const salesReturns = pgTable("sales_returns", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  returnNumber: serial("return_number").notNull(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  returnDate: timestamp("return_date").notNull().defaultNow(),
  reason: text("reason").notNull(),
  condition: text("condition").notNull().default("good"), // "good" | "damaged" | "expired"
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "rejected" | "completed"
  approvedById: text("approved_by_id").references(() => user.id),
  approvedAt: timestamp("approved_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  ...timestamps,
}, (table) => ({
  invoiceIdx: index("idx_sales_returns_invoice").on(table.invoiceId),
  customerIdx: index("idx_sales_returns_customer").on(table.customerId),
  statusIdx: index("idx_sales_returns_status").on(table.status),
}));

export const salesReturnItems = pgTable("sales_return_items", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  salesReturnId: text("sales_return_id")
    .notNull()
    .references(() => salesReturns.id, { onDelete: "cascade" }),
  invoiceItemId: text("invoice_item_id")
    .notNull()
    .references(() => invoiceItems.id),
  recipeId: text("recipe_id").references(() => recipes.id),
  cartonsReturned: integer("cartons_returned").notNull().default(0),
  quantityReturned: integer("quantity_returned").notNull().default(0),
  refundPerUnit: decimal("refund_per_unit", { precision: 12, scale: 2 }).notNull().default("0"),
  totalRefund: decimal("total_refund", { precision: 12, scale: 2 }).notNull().default("0"),
  ...timestamps,
}, (table) => ({
  salesReturnIdx: index("idx_sales_return_items_return").on(table.salesReturnId),
  invoiceItemIdx: index("idx_sales_return_items_invoice_item").on(table.invoiceItemId),
}));

export const salesReturnStockTraces = pgTable("sales_return_stock_traces", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  salesReturnId: text("sales_return_id")
    .notNull()
    .references(() => salesReturns.id, { onDelete: "cascade" }),
  salesReturnItemId: text("sales_return_item_id")
    .notNull()
    .references(() => salesReturnItems.id, { onDelete: "cascade" }),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  invoiceItemId: text("invoice_item_id")
    .notNull()
    .references(() => invoiceItems.id),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  recipeId: text("recipe_id")
    .notNull()
    .references(() => recipes.id),
  destination: text("destination").notNull(), // "sellable" | "damaged" | "expired"
  condition: text("condition").notNull(),
  cartonsMoved: integer("cartons_moved").notNull().default(0),
  quantityMoved: integer("quantity_moved").notNull().default(0),
  totalUnitsMoved: integer("total_units_moved").notNull().default(0),
  costPerUnit: decimal("cost_per_unit", { precision: 12, scale: 4 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  ...timestamps,
}, (table) => ({
  salesReturnIdx: index("idx_return_stock_traces_return").on(table.salesReturnId),
  salesReturnItemIdx: index("idx_return_stock_traces_return_item").on(table.salesReturnItemId),
  invoiceIdx: index("idx_return_stock_traces_invoice").on(table.invoiceId),
  warehouseIdx: index("idx_return_stock_traces_warehouse").on(table.warehouseId),
  destinationIdx: index("idx_return_stock_traces_destination").on(table.destination),
}));

export const salesPerformanceLogsRelations = relations(salesPerformanceLogs, ({ one }) => ({
  employee: one(employees, {
    fields: [salesPerformanceLogs.employeeId],
    references: [employees.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  recipe: one(recipes, {
    fields: [orderItems.recipeId],
    references: [recipes.id],
  }),
}));

export const creditRecoveryAttemptsRelations = relations(creditRecoveryAttempts, ({ one }) => ({
  slip: one(slipRecords, {
    fields: [creditRecoveryAttempts.slipId],
    references: [slipRecords.id],
  }),
  assignedTo: one(salesmen, {
    fields: [creditRecoveryAttempts.assignedToId],
    references: [salesmen.id],
  }),
}));

// ── INVOICE TIMELINE EVENTS ────────────────────────────────────────────────
// Immutable audit trail of everything that happened to an invoice.

export const invoiceTimelineEvents = pgTable("invoice_timeline_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  // "created" | "updated" | "dispatched" | "payment" | "status_change" |
  // "recovery_attempt" | "escalation" | "return" | "closed" | "note"
  title: text("title").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  actorId: text("actor_id").references(() => user.id),
  actorName: text("actor_name"),
  eventDate: timestamp("event_date").notNull().defaultNow(),
  ...timestamps,
}, (table) => ({
  invoiceIdx: index("idx_invoice_timeline_invoice").on(table.invoiceId),
  eventTypeIdx: index("idx_invoice_timeline_event_type").on(table.eventType),
  eventDateIdx: index("idx_invoice_timeline_event_date").on(table.eventDate),
}));

// ── LEDGER EXPORT AUDIT LOG ────────────────────────────────────────────────
// Tracks who viewed, printed, exported, or emailed ledger data.

export const salesReturnsRelations = relations(salesReturns, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [salesReturns.invoiceId],
    references: [invoices.id],
  }),
  customer: one(customers, {
    fields: [salesReturns.customerId],
    references: [customers.id],
  }),
  approvedBy: one(user, {
    fields: [salesReturns.approvedById],
    references: [user.id],
  }),
  items: many(salesReturnItems),
  stockTraces: many(salesReturnStockTraces),
}));

export const salesReturnItemsRelations = relations(salesReturnItems, ({ one, many }) => ({
  salesReturn: one(salesReturns, {
    fields: [salesReturnItems.salesReturnId],
    references: [salesReturns.id],
  }),
  invoiceItem: one(invoiceItems, {
    fields: [salesReturnItems.invoiceItemId],
    references: [invoiceItems.id],
  }),
  recipe: one(recipes, {
    fields: [salesReturnItems.recipeId],
    references: [recipes.id],
  }),
  stockTraces: many(salesReturnStockTraces),
}));

export const salesReturnStockTracesRelations = relations(salesReturnStockTraces, ({ one }) => ({
  salesReturn: one(salesReturns, {
    fields: [salesReturnStockTraces.salesReturnId],
    references: [salesReturns.id],
  }),
  salesReturnItem: one(salesReturnItems, {
    fields: [salesReturnStockTraces.salesReturnItemId],
    references: [salesReturnItems.id],
  }),
  invoice: one(invoices, {
    fields: [salesReturnStockTraces.invoiceId],
    references: [invoices.id],
  }),
  invoiceItem: one(invoiceItems, {
    fields: [salesReturnStockTraces.invoiceItemId],
    references: [invoiceItems.id],
  }),
  warehouse: one(warehouses, {
    fields: [salesReturnStockTraces.warehouseId],
    references: [warehouses.id],
  }),
  recipe: one(recipes, {
    fields: [salesReturnStockTraces.recipeId],
    references: [recipes.id],
  }),
}));

export const invoiceTimelineEventsRelations = relations(invoiceTimelineEvents, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceTimelineEvents.invoiceId],
    references: [invoices.id],
  }),
  actor: one(user, {
    fields: [invoiceTimelineEvents.actorId],
    references: [user.id],
  }),
}));

export const ledgerExportAuditLog = pgTable("ledger_export_audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  userEmail: text("user_email"),
  entityType: text("entity_type").notNull(), // "distributor" | "salesman" | "shopkeeper"
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name"),
  exportType: text("export_type").notNull(), // "view" | "csv" | "pdf" | "print" | "email"
  periodFrom: timestamp("period_from"),
  periodTo: timestamp("period_to"),
  entryCount: integer("entry_count").default(0),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"), // Additional context
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("idx_ledger_audit_entity").on(table.entityType, table.entityId),
  userIdx: index("idx_ledger_audit_user").on(table.userId),
  exportTypeIdx: index("idx_ledger_audit_type").on(table.exportType),
  createdAtIdx: index("idx_ledger_audit_created").on(table.createdAt),
}));
