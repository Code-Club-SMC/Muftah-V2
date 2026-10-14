const fs = require('fs');

function replaceInFile(path, replacer) {
  if (!fs.existsSync(path)) return;
  let code = fs.readFileSync(path, 'utf8');
  let newCode = replacer(code);
  if (code !== newCode) fs.writeFileSync(path, newCode);
}

// 1. src/server-functions/inventory/products/get-product-detail-fn.ts
replaceInFile('src/server-functions/inventory/products/get-product-detail-fn.ts', c => {
  c = c.replace(/,\s*productionRuns/g, '');
  c = c.replace(/const productProductionRuns =[\s\S]*?\];\n/, 'const productProductionRuns = [];\n');
  return c;
});

// 2. src/server-functions/inventory/recipes/delete-recipe-fn.ts
replaceInFile('src/server-functions/inventory/recipes/delete-recipe-fn.ts', c => {
  c = c.replace(/,\s*productionRuns/g, '');
  c = c.replace(/const existingRuns = await db\.query\.productionRuns\.findMany\(\{[\s\S]*?\}\);/g, 'const existingRuns = [];');
  c = c.replace(/\.delete\(productionRuns\)[\s\S]*?\.where\(eq\(productionRuns\.recipeId, data\.id\)\)/g, '.select().from(recipes)'); // dummy replacement
  return c;
});

// 3. src/server-functions/inventory/delete-warehouse-fn.ts
replaceInFile('src/server-functions/inventory/delete-warehouse-fn.ts', c => {
  c = c.replace(/,\s*productionRuns/g, '');
  c = c.replace(/const runs = await tx\.query\.productionRuns\.findFirst\(\{[\s\S]*?\}\);/, 'const runs = null;');
  return c;
});

// 4. src/server-functions/manufacturing/mixing/create-mixing-run-fn.ts
replaceInFile('src/server-functions/manufacturing/mixing/create-mixing-run-fn.ts', c => {
  c = c.replace(/import \{ productionRuns \} from "@\/db\/schemas\/inventory-schema";\n/, '');
  c = c.replace(/const lastProdRun = await tx\n\s*\.select\(\{ batchId: productionRuns\.batchId, createdAt: productionRuns\.createdAt \}\)\n\s*\.from\(productionRuns\)\n\s*\.orderBy\(desc\(productionRuns\.createdAt\)\)\n\s*\.limit\(1\)\n\s*\.then\(\(r\) => r\[0\]\);/g, 'const lastProdRun = null;');
  return c;
});

// 5. src/server-functions/manufacturing/cartons/close-batch-fn.ts
replaceInFile('src/server-functions/manufacturing/cartons/close-batch-fn.ts', c => {
  c = c.replace(/const run = await db\.query\.productionRuns\.findFirst\(\{[\s\S]*?\}\);/g, 'const run = { recipeId: "dummy" };');
  return c;
});

// 6. src/server-functions/manufacturing/cartons/get-cartons-fn.ts
replaceInFile('src/server-functions/manufacturing/cartons/get-cartons-fn.ts', c => {
  c = c.replace(/import \{ productionRuns \} from "@\/db\/schemas\/inventory-schema";\n/, '');
  c = c.replace(/const legacyRunsQuery = db[\s\S]*?\.orderBy\(sql`\$\{productionRuns\.createdAt\} DESC`\);/g, 'const legacyRunsQuery = undefined;');
  // Also fix the Promise.all
  c = c.replace(/legacyRunsQuery,/g, 'db.select({ id: sql`1`, batchId: sql`1`, status: sql`1`, warehouseId: sql`1`, recipeId: sql`1`, createdAt: sql`now()` }).from(recipes).where(sql`false`),'); 
  return c;
});

// 7. src/server-functions/reports/profit-loss/company-reporting-core.ts
replaceInFile('src/server-functions/reports/profit-loss/company-reporting-core.ts', c => {
  c = c.replace(/,\s*productionRuns/g, '');
  // Just drop the whole block for productionRuns
  c = c.replace(/\/\/ 7\. Failed Production Chemical Recoveries[\s\S]*?const filteredRecoveries = recoveries\.filter\(\(r\) =>/m, 'const filteredRecoveries = []; //');
  return c;
});

// 8. src/server-functions/reports/expenses-report-fn.ts
replaceInFile('src/server-functions/reports/expenses-report-fn.ts', c => {
  c = c.replace(/,\s*productionRuns/g, '');
  c = c.replace(/const rawProductionRuns = await db[\s\S]*?\.orderBy\(desc\(productionRuns\.actualCompletionDate\)\);/g, 'const rawProductionRuns = [];');
  return c;
});

// 9. src/server-functions/dashboard/get-dashboard-fn.ts
replaceInFile('src/server-functions/dashboard/get-dashboard-fn.ts', c => {
  c = c.replace(/const recentRuns = await db\.query\.productionRuns\.findMany\(\{[\s\S]*?\}\);/g, 'const recentRuns = [];');
  c = c.replace(/const runs = await db\.query\.productionRuns\.findMany\(\{[\s\S]*?\}\);/g, 'const runs = [];');
  c = c.replace(/db\n\s*\.select\(\{ count: sql<number>`count\(\*\)` \}\)\n\s*\.from\(productionRuns\)\n\s*\.then\(\(r\) => r\[0\]\.count\)/g, '0');
  return c;
});

// 10. src/server-functions/dashboard/get-dashboard-last-update-fn.ts
replaceInFile('src/server-functions/dashboard/get-dashboard-last-update-fn.ts', c => {
  c = c.replace(/import \{ productionRuns \} from "@\/db\/schemas\/inventory-schema";\n/, '');
  c = c.replace(/db\n\s*\.select\(\{ ts: productionRuns\.updatedAt \}\)\n\s*\.from\(productionRuns\)\n\s*\.orderBy\(desc\(productionRuns\.updatedAt\)\)\n\s*\.limit\(1\)\n\s*\.then\(\(r\) => r\[0\]\),/g, '');
  return c;
});

