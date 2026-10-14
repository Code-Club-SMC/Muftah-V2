const fs = require('fs');
const path = 'src/db/schemas/inventory-schema.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Drop productionRuns entirely
code = code.replace(/export const productionRuns = pgTable\("production_runs", \{[\s\S]*?\n\}\);\n/g, '');
code = code.replace(/export const productionRunsRelations = relations\(productionRuns,[\s\S]*?\n\);\n/g, '');

// 2. Drop productionProgressLogs
code = code.replace(/export const productionProgressLogs = pgTable\(\n\s*"production_progress_logs",[\s\S]*?\n\);/g, '');
code = code.replace(/export const productionProgressLogsRelations = relations\(\n\s*productionProgressLogs,[\s\S]*?\n\);\n/g, '');

// 3. Drop productionMaterialsUsed
code = code.replace(/export const productionMaterialsUsed = pgTable\(\n\s*"production_materials_used",[\s\S]*?\n\);/g, '');
code = code.replace(/export const productionMaterialsUsedRelations = relations\(\n\s*productionMaterialsUsed,[\s\S]*?\n\);\n/g, '');

// 4. Drop productionRunLabReports
code = code.replace(/export const productionRunLabReports = pgTable\("production_run_lab_reports", \{[\s\S]*?\n\}\);\n/g, '');
code = code.replace(/export const productionRunLabReportsRelations = relations\(\n\s*productionRunLabReports,[\s\S]*?\n\);\n/g, '');

// 5. Update wacHistory
code = code.replace(/productionRunId: text\("production_run_id"\)/g, 'packagingAllocationId: text("packaging_allocation_id")');
code = code.replace(/fields: \[wacHistory\.productionRunId\]/g, 'fields: [wacHistory.packagingAllocationId]');
// Note: wacHistory references productionRuns? We must update the references block to point to packagingAllocations.
// Wait, I will just use a more careful replacement for wacHistory.

fs.writeFileSync(path, code);
