import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  uniqueIndex,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import {
  chemicals,
  packagingMaterials,
  products,
  recipes,
  productionRunLabReports,
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
// FORMULAS — Pure chemical formula definitions, scoped to one product
// ---------------------------------------------------------------------------
export const formulas = pgTable("formulas", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(), // e.g., "Dishwash Powder Base Formula"

  // Batch Configuration
  batchSize: decimal("batch_size", { precision: 10, scale: 2 }).notNull(), // e.g., 500.00
  batchUnit: text("batch_unit").notNull().default("kg"), // "kg" | "liters"

  // Estimated cost (computed from ingredients)
  estimatedIngredientsCost: decimal("estimated_ingredients_cost", {
    precision: 12,
    scale: 2,
  }),

  // Instructions
  productionInstructions: text("production_instructions"), // Mixing SOP / procedure steps
  notes: text("notes"),

  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// FORMULA INGREDIENTS — Chemical BOM for one batch of a formula
// ---------------------------------------------------------------------------
export const formulaIngredients = pgTable(
  "formula_ingredients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    formulaId: text("formula_id")
      .notNull()
      .references(() => formulas.id, { onDelete: "cascade" }),
    chemicalId: text("chemical_id")
      .notNull()
      .references(() => chemicals.id),
    quantityPerBatch: decimal("quantity_per_batch", {
      precision: 10,
      scale: 3,
    }).notNull(), // Qty needed per batch
    ...timestamps,
  },
  (t) => ({
    formulaIdx: index("formula_ingredients_formula_idx").on(t.formulaId),
  }),
);

// ---------------------------------------------------------------------------
// MIXING RUNS — Phase 1: Chemical compounding. 1 run = 1 batch, always.
// ---------------------------------------------------------------------------
export const mixingRuns = pgTable(
  "mixing_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    batchId: text("batch_id").notNull().unique(), // Sequential from shared A0001 series
    formulaId: text("formula_id")
      .notNull()
      .references(() => formulas.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id), // Factory floor
    operatorId: text("operator_id")
      .notNull()
      .references(() => user.id),
    initiatorId: text("initiator_id").references(() => user.id),

    // Bulk Output
    targetBulkQuantity: decimal("target_bulk_quantity", {
      precision: 12,
      scale: 3,
    }).notNull(), // = formula.batchSize
    actualBulkProduced: decimal("actual_bulk_produced", {
      precision: 12,
      scale: 3,
    }).default("0"),
    bulkUnit: text("bulk_unit").notNull(), // "kg" | "liters"

    // Costing
    totalChemicalCost: decimal("total_chemical_cost", {
      precision: 12,
      scale: 2,
    }).default("0"),
    chemicalCostPerUnit: decimal("chemical_cost_per_unit", {
      precision: 10,
      scale: 4,
    }).default("0"), // totalChemicalCost / actualBulkProduced

    // Status & Scheduling
    status: text("status").notNull().default("scheduled"), // "scheduled" | "in_progress" | "completed" | "failed" | "cancelled"
    scheduledStartDate: timestamp("scheduled_start_date"),
    actualStartDate: timestamp("actual_start_date"),
    actualCompletionDate: timestamp("actual_completion_date"),

    // Yield Tracking
    yieldPercentage: decimal("yield_percentage", { precision: 5, scale: 2 }), // (actualBulkProduced / targetBulkQuantity) × 100
    shortfallQuantity: decimal("shortfall_quantity", {
      precision: 12,
      scale: 3,
    }).default("0"),
    shortfallReason: text("shortfall_reason"),

    // Batch lifecycle
    closedBy: text("closed_by").references(() => user.id),

    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    updatedAtIdx: index("mixing_runs_updated_at_idx").on(t.updatedAt),
    formulaStatusIdx: index("mixing_runs_formula_status_idx").on(
      t.formulaId,
      t.status,
    ),
  }),
);

// ---------------------------------------------------------------------------
// MIXING PROGRESS LOGS — Incremental bulk output logged by operator
// ---------------------------------------------------------------------------
export const mixingProgressLogs = pgTable(
  "mixing_progress_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    mixingRunId: text("mixing_run_id")
      .notNull()
      .references(() => mixingRuns.id, { onDelete: "cascade" }),
    quantityProduced: decimal("quantity_produced", {
      precision: 12,
      scale: 3,
    }).notNull(), // Bulk weight in this increment (e.g., 20.000 kg)
    originalQuantityProduced: decimal("original_quantity_produced", {
      precision: 12,
      scale: 3,
    }), // Preserved if edited
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    editedById: text("edited_by_id").references(() => user.id),
    editReason: text("edit_reason"),
    editedAt: timestamp("edited_at"),
    ...timestamps,
  },
  (t) => ({
    runCreatedAtIdx: index("mixing_progress_run_created_at_idx").on(
      t.mixingRunId,
      t.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// MIXING MATERIALS USED — Chemical consumption audit for mixing runs
// ---------------------------------------------------------------------------
export const mixingMaterialsUsed = pgTable(
  "mixing_materials_used",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    mixingRunId: text("mixing_run_id")
      .notNull()
      .references(() => mixingRuns.id, { onDelete: "cascade" }),
    chemicalId: text("chemical_id")
      .notNull()
      .references(() => chemicals.id),
    quantityUsed: decimal("quantity_used", {
      precision: 12,
      scale: 3,
    }).notNull(),
    costPerUnit: decimal("cost_per_unit", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => ({
    mixingRunIdx: index("mixing_materials_mixing_run_idx").on(t.mixingRunId),
  }),
);

// ---------------------------------------------------------------------------
// PACKAGING ALLOCATIONS — Phase 2: One allocation per packaging format
// per mixing run. Multiple allocations per mixing run.
// ---------------------------------------------------------------------------
export const packagingAllocations = pgTable(
  "packaging_allocations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    mixingRunId: text("mixing_run_id")
      .notNull()
      .references(() => mixingRuns.id),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id), // Packaging format / finished good SKU
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id), // Factory floor
    operatorId: text("operator_id")
      .notNull()
      .references(() => user.id),
    initiatorId: text("initiator_id").references(() => user.id),

    // Allocation
    allocatedBulkQuantity: decimal("allocated_bulk_quantity", {
      precision: 12,
      scale: 3,
    }).notNull(), // Bulk allocated from mixing batch (e.g., 100.000 kg)
    allocatedBulkUnit: text("allocated_bulk_unit").notNull(), // "kg" | "liters"
    allocatedChemicalCost: decimal("allocated_chemical_cost", {
      precision: 12,
      scale: 2,
    }).notNull(), // (allocated / actualBulkProduced) × totalChemicalCost

    // Targets
    targetContainers: integer("target_containers").notNull(), // floor(allocatedBulk / fillAmount)
    targetCartons: integer("target_cartons").default(0),
    targetLooseUnits: integer("target_loose_units").default(0),

    packingReceiptId: text("packing_receipt_id").references(() => batchPackingReceipts.id),
    formatSnapshot: jsonb("format_snapshot").$type<{ id: string; name: string; fillAmount: string | null; fillUnit: string | null; containersPerCarton: number; usesCartons: boolean }>(),
    fullCartonsRecorded: integer("full_cartons_recorded"),
    partialPacksRecorded: integer("partial_packs_recorded"),
    outsidePacksRecorded: integer("outside_packs_recorded"),
    nominalBulkRecorded: decimal("nominal_bulk_recorded", { precision: 12, scale: 3 }),
    varianceReason: text("variance_reason"),

    // Actuals
    completedContainers: integer("completed_containers").default(0), // Running total from progress logs
    actualBulkConsumed: decimal("actual_bulk_consumed", {
      precision: 12,
      scale: 3,
    }).default("0"), // completedContainers × fillAmount
    actualCartonsProduced: integer("actual_cartons_produced").default(0),
    actualPacksProduced: integer("actual_packs_produced").default(0),
    actualLooseUnitsProduced: integer("actual_loose_units_produced").default(0),

    // Costs
    totalPackagingCost: decimal("total_packaging_cost", {
      precision: 12,
      scale: 2,
    }).default("0"),
    totalProductionCost: decimal("total_production_cost", {
      precision: 12,
      scale: 2,
    }).default("0"), // allocatedChemicalCost + totalPackagingCost
    actualCostPerPack: decimal("actual_cost_per_pack", {
      precision: 10,
      scale: 4,
    }).default("0"),
    actualCostPerCarton: decimal("actual_cost_per_carton", {
      precision: 10,
      scale: 4,
    }).default("0"),

    // Lifecycle
    status: text("status").notNull().default("allocated"), // "allocated" | "in_progress" | "completed" | "cancelled"
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    closedBy: text("closed_by").references(() => user.id),
    shortfallUnits: integer("shortfall_units").default(0),
    shortfallReason: text("shortfall_reason"),
    yieldVarianceCartons: integer("yield_variance_cartons").default(0),

    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    mixingRunIdx: index("pkg_alloc_mixing_run_idx").on(t.mixingRunId),
    recipeIdx: index("pkg_alloc_recipe_idx").on(t.recipeId),
    statusIdx: index("pkg_alloc_status_idx").on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// PACKAGING PROGRESS LOGS — Container filling progress per allocation
// ---------------------------------------------------------------------------
export const packagingProgressLogs = pgTable(
  "packaging_progress_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    packagingAllocationId: text("packaging_allocation_id")
      .notNull()
      .references(() => packagingAllocations.id, { onDelete: "cascade" }),
    containersProduced: integer("containers_produced").notNull(),
    bulkConsumed: decimal("bulk_consumed", {
      precision: 12,
      scale: 3,
    }).notNull(), // containers × fillAmount
    originalContainersProduced: integer("original_containers_produced"), // Preserved if edited
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    editedById: text("edited_by_id").references(() => user.id),
    editReason: text("edit_reason"),
    editedAt: timestamp("edited_at"),
    ...timestamps,
  },
  (t) => ({
    allocationCreatedAtIdx: index(
      "pkg_progress_allocation_created_at_idx",
    ).on(t.packagingAllocationId, t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// PACKAGING MATERIALS USED — Material consumption audit for packaging
// ---------------------------------------------------------------------------
export const packagingMaterialsUsed = pgTable(
  "packaging_materials_used_in_allocation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    packagingAllocationId: text("packaging_allocation_id")
      .notNull()
      .references(() => packagingAllocations.id, { onDelete: "cascade" }),
    progressLogId: text("progress_log_id").references(
      () => packagingProgressLogs.id,
      { onDelete: "set null" },
    ),
    materialId: text("material_id")
      .notNull()
      .references(() => packagingMaterials.id),
    quantityUsed: decimal("quantity_used", {
      precision: 12,
      scale: 3,
    }).notNull(),
    costPerUnit: decimal("cost_per_unit", {
      precision: 10,
      scale: 2,
    }).notNull(),
    totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => ({
    allocationIdx: index("pkg_mat_used_allocation_idx").on(
      t.packagingAllocationId,
    ),
    progressLogIdx: index("pkg_mat_used_progress_log_idx").on(t.progressLogId),
  }),
);

// ---------------------------------------------------------------------------
// RELATIONS
// ---------------------------------------------------------------------------

export const formulasRelations = relations(formulas, ({ one, many }) => ({
  product: one(products, {
    fields: [formulas.productId],
    references: [products.id],
  }),
  ingredients: many(formulaIngredients),
  recipes: many(recipes),
  mixingRuns: many(mixingRuns),
}));

export const formulaIngredientsRelations = relations(
  formulaIngredients,
  ({ one }) => ({
    formula: one(formulas, {
      fields: [formulaIngredients.formulaId],
      references: [formulas.id],
    }),
    chemical: one(chemicals, {
      fields: [formulaIngredients.chemicalId],
      references: [chemicals.id],
    }),
  }),
);

export const mixingRunsRelations = relations(
  mixingRuns,
  ({ one, many }) => ({
    formula: one(formulas, {
      fields: [mixingRuns.formulaId],
      references: [formulas.id],
    }),
    warehouse: one(warehouses, {
      fields: [mixingRuns.warehouseId],
      references: [warehouses.id],
    }),
    operator: one(user, {
      fields: [mixingRuns.operatorId],
      references: [user.id],
      relationName: "mixingOperator",
    }),
    initiator: one(user, {
      fields: [mixingRuns.initiatorId],
      references: [user.id],
      relationName: "mixingInitiator",
    }),
    closedByUser: one(user, {
      fields: [mixingRuns.closedBy],
      references: [user.id],
      relationName: "mixingClosedBy",
    }),
    progressLogs: many(mixingProgressLogs),
    materialsUsed: many(mixingMaterialsUsed),
    labReports: many(productionRunLabReports),
    packingReceipts: many(batchPackingReceipts),
  packagingAllocations: many(packagingAllocations),
  }),
);

export const mixingProgressLogsRelations = relations(
  mixingProgressLogs,
  ({ one }) => ({
    mixingRun: one(mixingRuns, {
      fields: [mixingProgressLogs.mixingRunId],
      references: [mixingRuns.id],
    }),
    createdBy: one(user, {
      fields: [mixingProgressLogs.createdById],
      references: [user.id],
      relationName: "mixingProgressCreatedBy",
    }),
    editedBy: one(user, {
      fields: [mixingProgressLogs.editedById],
      references: [user.id],
      relationName: "mixingProgressEditedBy",
    }),
  }),
);

export const mixingMaterialsUsedRelations = relations(
  mixingMaterialsUsed,
  ({ one }) => ({
    mixingRun: one(mixingRuns, {
      fields: [mixingMaterialsUsed.mixingRunId],
      references: [mixingRuns.id],
    }),
    chemical: one(chemicals, {
      fields: [mixingMaterialsUsed.chemicalId],
      references: [chemicals.id],
    }),
  }),
);

export const packagingAllocationsRelations = relations(
  packagingAllocations,
  ({ one, many }) => ({
    mixingRun: one(mixingRuns, {
      fields: [packagingAllocations.mixingRunId],
      references: [mixingRuns.id],
    }),
    recipe: one(recipes, {
      fields: [packagingAllocations.recipeId],
      references: [recipes.id],
    }),
    warehouse: one(warehouses, {
      fields: [packagingAllocations.warehouseId],
      references: [warehouses.id],
    }),
    operator: one(user, {
      fields: [packagingAllocations.operatorId],
      references: [user.id],
      relationName: "packagingOperator",
    }),
    initiator: one(user, {
      fields: [packagingAllocations.initiatorId],
      references: [user.id],
      relationName: "packagingInitiator",
    }),
    closedByUser: one(user, {
      fields: [packagingAllocations.closedBy],
      references: [user.id],
      relationName: "packagingClosedBy",
    }),
    progressLogs: many(packagingProgressLogs),
    materialsUsed: many(packagingMaterialsUsed),
  }),
);

export const packagingProgressLogsRelations = relations(
  packagingProgressLogs,
  ({ one, many }) => ({
    packagingAllocation: one(packagingAllocations, {
      fields: [packagingProgressLogs.packagingAllocationId],
      references: [packagingAllocations.id],
    }),
    createdBy: one(user, {
      fields: [packagingProgressLogs.createdById],
      references: [user.id],
      relationName: "packagingProgressCreatedBy",
    }),
    editedBy: one(user, {
      fields: [packagingProgressLogs.editedById],
      references: [user.id],
      relationName: "packagingProgressEditedBy",
    }),
    materialsUsed: many(packagingMaterialsUsed),
  }),
);

export const packagingMaterialsUsedRelations = relations(
  packagingMaterialsUsed,
  ({ one }) => ({
    packagingAllocation: one(packagingAllocations, {
      fields: [packagingMaterialsUsed.packagingAllocationId],
      references: [packagingAllocations.id],
    }),
    progressLog: one(packagingProgressLogs, {
      fields: [packagingMaterialsUsed.progressLogId],
      references: [packagingProgressLogs.id],
    }),
    packagingMaterial: one(packagingMaterials, {
      fields: [packagingMaterialsUsed.materialId],
      references: [packagingMaterials.id],
    }),
  }),
);

// Immutable packing receipts. Legacy allocations keep their existing reservations.
export const batchPackingReceipts = pgTable("batch_packing_receipts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  mixingRunId: text("mixing_run_id").notNull().references(() => mixingRuns.id),
  requestId: text("request_id").notNull(),
  requestPayload: text("request_payload").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id),
  packedAt: timestamp("packed_at").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  bulkConsumed: decimal("bulk_consumed", { precision: 12, scale: 3 }).notNull(),
  lossBulk: decimal("loss_bulk", { precision: 12, scale: 3 }).notNull(),
  lossReason: text("loss_reason"),
  totalPacks: integer("total_packs").notNull(),
  costAudit: jsonb("cost_audit").$type<{ chemicalCost: string; lossCostPolicy: string }>().notNull(),
}, t => ({ requestIdx: uniqueIndex("batch_packing_request_idx").on(t.mixingRunId, t.requestId) }));

// Separate evidence for packs that were never placed inside a carton.
export const outsidePackMovements = pgTable("outside_pack_movements", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  recipeId: text("recipe_id").notNull().references(() => recipes.id),
  referenceId: text("reference_id").notNull(),
  type: text("type").notNull(),
  delta: integer("delta").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({ referenceIdx: index("outside_pack_reference_idx").on(t.referenceId, t.recipeId) }));

export const batchPackingReceiptsRelations = relations(batchPackingReceipts, ({ one }) => ({ mixingRun: one(mixingRuns, { fields: [batchPackingReceipts.mixingRunId], references: [mixingRuns.id] }) }));
