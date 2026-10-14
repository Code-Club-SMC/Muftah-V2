const fs = require('fs');
const path = 'src/db/schemas/inventory-schema.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace table block
code = code.replace(/export const failedProductionChemicalRecoveries = pgTable\([\s\S]*?\n\);/g, `export const failedProductionChemicalRecoveries = pgTable(
  "failed_production_chemical_recoveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    mixingRunId: text("mixing_run_id")
      .notNull(),
    mixingMaterialUsedId: text("mixing_material_used_id")
      .notNull(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    chemicalId: text("chemical_id")
      .notNull()
      .references(() => chemicals.id),
    quantityRecovered: decimal("quantity_recovered", {
      precision: 10,
      scale: 2,
    }).notNull(),
    unit: text("unit").notNull(),
    reason: text("reason"),
    status: text("status", { enum: ["pending", "settled"] })
      .default("pending")
      .notNull(),
    settledById: text("settled_by_id").references(() => user.id),
    settledAt: timestamp("settled_at", { mode: "date" }),
    ...timestamps,
  }
);`);

// Replace relations block
code = code.replace(/export const failedProductionChemicalRecoveriesRelations = relations\([\s\S]*?\n\);\n/g, `export const failedProductionChemicalRecoveriesRelations = relations(
  failedProductionChemicalRecoveries,
  ({ one }) => ({
    warehouse: one(warehouses, {
      fields: [failedProductionChemicalRecoveries.warehouseId],
      references: [warehouses.id],
    }),
    chemical: one(chemicals, {
      fields: [failedProductionChemicalRecoveries.chemicalId],
      references: [chemicals.id],
    }),
    settledBy: one(user, {
      fields: [failedProductionChemicalRecoveries.settledById],
      references: [user.id],
    }),
  }),
);\n`);

// Note: mixingRuns and mixingMaterialsUsed are in production-schema.ts, so we don't add the direct relation object here to avoid circular imports.

fs.writeFileSync(path, code);
