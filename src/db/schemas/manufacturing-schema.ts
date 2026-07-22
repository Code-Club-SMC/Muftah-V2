import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { invoices } from "./sales-schema";
import {
  productionRuns,
  recipes,
  warehouses,
} from "./inventory-schema";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

// ---------------------------------------------------------------------------
// CARTONS — Individual carton tracking with full lifecycle
// ---------------------------------------------------------------------------
export const cartons = pgTable(
  "cartons",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    productionRunId: text("production_run_id")
      .notNull()
      .references(() => productionRuns.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    sku: text("sku"),
    capacity: integer("capacity").notNull(),
    currentPacks: integer("current_packs").notNull().default(0),
    status: text("status").notNull().default("PARTIAL"),
    // PARTIAL | COMPLETE | SEALED | DISPATCHED | ARCHIVED | RETIRED | ON_HOLD

    // Warehouse zone
    zone: text("zone"),

    // QC hold
    holdReason: text("hold_reason"),
    holdStartedAt: timestamp("hold_started_at"),
    holdExpiresAt: timestamp("hold_expires_at"),
    holdStartedBy: text("hold_started_by").references(() => user.id),
    preHoldStatus: text("pre_hold_status"),

    // Retirement
    retiredAt: timestamp("retired_at"),
    retiredReason: text("retired_reason"),
    retiredBy: text("retired_by").references(() => user.id),

    // Dispatch
    dispatchedAt: timestamp("dispatched_at"),
    dispatchOrderId: text("dispatch_order_id").references(() => invoices.id),

    // Repack audit
    originalCapacity: integer("original_capacity"),

    ...timestamps,
  },
  (t) => ({
    recipeIdx: index("cartons_recipe_idx").on(t.recipeId),
    productionRunIdx: index("cartons_production_run_idx").on(t.productionRunId),
    warehouseIdx: index("cartons_warehouse_idx").on(t.warehouseId),
    statusIdx: index("cartons_status_idx").on(t.status),
    skuIdx: index("cartons_sku_idx").on(t.sku),
  }),
);

// ---------------------------------------------------------------------------
// ADJUSTMENT LOG — Append-only audit trail for all carton pack mutations
// ---------------------------------------------------------------------------
export const adjustmentLog = pgTable(
  "adjustment_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    cartonId: text("carton_id")
      .notNull()
      .references(() => cartons.id),
    batchId: text("batch_id").references(() => productionRuns.id),
    sku: text("sku"),

    // Adjustment type:
    // TOP_UP | REMOVAL | MANUAL_OVERRIDE | BULK_ADJUST
    // MERGE_IN | MERGE_OUT | REPACK | RETIRE
    // TRANSFER_IN | TRANSFER_OUT
    // DISPATCH_PARTIAL | DISPATCH_FULL
    // RETURN_GOOD | RETURN_DAMAGED
    // RECONCILIATION | INTEGRITY_CORRECTION
    // QC_HOLD_APPLIED | QC_HOLD_CLEARED | QC_HOLD_CONDEMNED
    // UNSEALED
    type: text("type").notNull(),

    packsBefore: integer("packs_before").notNull(),
    delta: integer("delta").notNull(),
    packsAfter: integer("packs_after").notNull(),

    reason: text("reason"),
    relatedCartonId: text("related_carton_id").references(() => cartons.id),
    dispatchOrderId: text("dispatch_order_id").references(() => invoices.id),
    returnRecordId: text("return_record_id").references(
      () => returnRecords.id,
    ),
    reconciliationId: text("reconciliation_id"),
    bulkOperationId: text("bulk_operation_id"),

    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
  },
  (t) => ({
    cartonIdx: index("adj_log_carton_idx").on(t.cartonId),
    batchIdx: index("adj_log_batch_idx").on(t.batchId),
    typeIdx: index("adj_log_type_idx").on(t.type),
    bulkOpIdx: index("adj_log_bulk_op_idx").on(t.bulkOperationId),
    performedIdx: index("adj_log_performed_idx").on(t.performedAt),
  }),
);

// ---------------------------------------------------------------------------
// STOCK COUNT SESSIONS — Periodic physical inventory counts
// ---------------------------------------------------------------------------
export const stockCountSessions = pgTable(
  "stock_count_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    batchId: text("batch_id").references(() => productionRuns.id),
    sku: text("sku"),
    status: text("status").notNull().default("OPEN"),
    // OPEN | PENDING_APPROVAL | APPROVED | REJECTED
    startedBy: text("started_by")
      .notNull()
      .references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    approvedAt: timestamp("approved_at"),
    notes: text("notes"),
  },
  (t) => ({
    statusIdx: index("stock_count_session_status_idx").on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// STOCK COUNT LINES — Individual carton counts within a session
// ---------------------------------------------------------------------------
export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sessionId: text("session_id")
      .notNull()
      .references(() => stockCountSessions.id, { onDelete: "cascade" }),
    cartonId: text("carton_id")
      .notNull()
      .references(() => cartons.id),
    systemCount: integer("system_count").notNull(),
    physicalCount: integer("physical_count").notNull().default(0),
    delta: integer("delta").notNull().default(0),
    status: text("status").notNull().default("PENDING"),
    // PENDING | WITHIN_TOLERANCE | FLAGGED | APPROVED | REJECTED
    approvedBy: text("approved_by").references(() => user.id),
  },
  (t) => ({
    sessionIdx: index("stock_count_session_idx").on(t.sessionId),
    cartonIdx: index("stock_count_carton_idx").on(t.cartonId),
  }),
);

// ---------------------------------------------------------------------------
// RETURN RECORDS — Track returns of dispatched cartons
// ---------------------------------------------------------------------------
export const returnRecords = pgTable("return_records", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  dispatchOrderId: text("dispatch_order_id")
    .notNull()
    .references(() => invoices.id),
  returnedBy: text("returned_by")
    .notNull()
    .references(() => user.id),
  returnedAt: timestamp("returned_at").defaultNow().notNull(),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// RETURN LINES — Individual carton lines within a return record
// ---------------------------------------------------------------------------
export const returnLines = pgTable(
  "return_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    returnRecordId: text("return_record_id")
      .notNull()
      .references(() => returnRecords.id, { onDelete: "cascade" }),
    cartonId: text("carton_id")
      .notNull()
      .references(() => cartons.id),
    packsReturned: integer("packs_returned").notNull(),
    condition: text("condition").notNull(), // "GOOD" | "DAMAGED"
    destinationCartonId: text("destination_carton_id").references(
      () => cartons.id,
    ),
  },
  (t) => ({
    recordIdx: index("return_lines_record_idx").on(t.returnRecordId),
    cartonIdx: index("return_lines_carton_idx").on(t.cartonId),
  }),
);

// ---------------------------------------------------------------------------
// INTEGRITY ALERTS — Detects carton sum vs ledger mismatches
// ---------------------------------------------------------------------------
export const integrityAlerts = pgTable(
  "integrity_alerts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sku: text("sku").notNull(),
    batchId: text("batch_id").references(() => productionRuns.id),
    cartonSum: integer("carton_sum").notNull(),
    ledgerTotal: integer("ledger_total").notNull(),
    delta: integer("delta").notNull().default(0),
    status: text("status").notNull().default("OPEN"),
    // OPEN | ACKNOWLEDGED | RESOLVED
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"),
  },
  (t) => ({
    statusIdx: index("integrity_alerts_status_idx").on(t.status),
    skuIdx: index("integrity_alerts_sku_idx").on(t.sku),
    batchIdx: index("integrity_alerts_batch_idx").on(t.batchId),
  }),
);

// ---------------------------------------------------------------------------
// RELATIONS
// ---------------------------------------------------------------------------

export const cartonsRelations = relations(cartons, ({ one, many }) => ({
  recipe: one(recipes, {
    fields: [cartons.recipeId],
    references: [recipes.id],
  }),
  productionRun: one(productionRuns, {
    fields: [cartons.productionRunId],
    references: [productionRuns.id],
  }),
  warehouse: one(warehouses, {
    fields: [cartons.warehouseId],
    references: [warehouses.id],
  }),
  holdStartedByUser: one(user, {
    fields: [cartons.holdStartedBy],
    references: [user.id],
    relationName: "cartonHoldStartedBy",
  }),
  retiredByUser: one(user, {
    fields: [cartons.retiredBy],
    references: [user.id],
    relationName: "cartonRetiredBy",
  }),
  dispatchOrder: one(invoices, {
    fields: [cartons.dispatchOrderId],
    references: [invoices.id],
  }),
  adjustmentLogs: many(adjustmentLog),
  stockCountLines: many(stockCountLines),
  returnLinesAsSource: many(returnLines, { relationName: "returnLineSource" }),
  returnLinesAsDestination: many(returnLines, {
    relationName: "returnLineDestination",
  }),
  relatedAdjustmentLogs: many(adjustmentLog, {
    relationName: "relatedCartonAdjustments",
  }),
}));

export const adjustmentLogRelations = relations(
  adjustmentLog,
  ({ one }) => ({
    carton: one(cartons, {
      fields: [adjustmentLog.cartonId],
      references: [cartons.id],
    }),
    batch: one(productionRuns, {
      fields: [adjustmentLog.batchId],
      references: [productionRuns.id],
    }),
    relatedCarton: one(cartons, {
      fields: [adjustmentLog.relatedCartonId],
      references: [cartons.id],
      relationName: "relatedCartonAdjustments",
    }),
    dispatchOrder: one(invoices, {
      fields: [adjustmentLog.dispatchOrderId],
      references: [invoices.id],
    }),
    returnRecord: one(returnRecords, {
      fields: [adjustmentLog.returnRecordId],
      references: [returnRecords.id],
    }),
    performedByUser: one(user, {
      fields: [adjustmentLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const stockCountSessionsRelations = relations(
  stockCountSessions,
  ({ one, many }) => ({
    batch: one(productionRuns, {
      fields: [stockCountSessions.batchId],
      references: [productionRuns.id],
    }),
    startedByUser: one(user, {
      fields: [stockCountSessions.startedBy],
      references: [user.id],
      relationName: "stockCountStartedBy",
    }),
    approvedByUser: one(user, {
      fields: [stockCountSessions.approvedBy],
      references: [user.id],
      relationName: "stockCountApprovedBy",
    }),
    lines: many(stockCountLines),
  }),
);

export const stockCountLinesRelations = relations(
  stockCountLines,
  ({ one }) => ({
    session: one(stockCountSessions, {
      fields: [stockCountLines.sessionId],
      references: [stockCountSessions.id],
    }),
    carton: one(cartons, {
      fields: [stockCountLines.cartonId],
      references: [cartons.id],
    }),
    approvedByUser: one(user, {
      fields: [stockCountLines.approvedBy],
      references: [user.id],
    }),
  }),
);

export const returnRecordsRelations = relations(
  returnRecords,
  ({ one, many }) => ({
    dispatchOrder: one(invoices, {
      fields: [returnRecords.dispatchOrderId],
      references: [invoices.id],
    }),
    returnedByUser: one(user, {
      fields: [returnRecords.returnedBy],
      references: [user.id],
    }),
    lines: many(returnLines),
  }),
);

export const returnLinesRelations = relations(returnLines, ({ one }) => ({
  returnRecord: one(returnRecords, {
    fields: [returnLines.returnRecordId],
    references: [returnRecords.id],
  }),
  carton: one(cartons, {
    fields: [returnLines.cartonId],
    references: [cartons.id],
    relationName: "returnLineSource",
  }),
  destinationCarton: one(cartons, {
    fields: [returnLines.destinationCartonId],
    references: [cartons.id],
    relationName: "returnLineDestination",
  }),
}));

export const integrityAlertsRelations = relations(
  integrityAlerts,
  ({ one }) => ({
    batch: one(productionRuns, {
      fields: [integrityAlerts.batchId],
      references: [productionRuns.id],
    }),
    resolvedByUser: one(user, {
      fields: [integrityAlerts.resolvedBy],
      references: [user.id],
    }),
  }),
);