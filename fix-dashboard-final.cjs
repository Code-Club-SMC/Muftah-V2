const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

// Update imports
code = code.replace(/import \{ payslips/g, 'import { mixingRuns, packagingAllocations, mixingMaterialsUsed, packagingMaterialsUsed } from "@/db/schemas/production-schema";\nimport { payslips');
code = code.replace(/productionRuns,\n/g, '');
code = code.replace(/productionMaterialsUsed,\n/g, '');

// Update computePeriodMetrics
code = code.replace(/db\s*\.select\(\{\s*totalMaterialCost: sql<string>`coalesce\(sum\(\$\{productionMaterialsUsed\.totalCost\}\), 0)`,\s*\}\)\s*\.from\(productionMaterialsUsed\)\s*\.innerJoin\(productionRuns, eq\(productionMaterialsUsed\.productionRunId, productionRuns\.id\)\)\s*\.where\(\s*and\(\s*eq\(productionRuns\.status, "completed"\),\s*gte\(productionRuns\.actualCompletionDate, rangeStart\),\s*lte\(productionRuns\.actualCompletionDate, rangeEnd\),\s*\),\s*\)\s*\.then\(\(r\) => r\[0\]\),/, `db
      .select({
        totalMaterialCost: sql<string>\`coalesce(sum(\${mixingMaterialsUsed.totalCost}), 0)\`,
      })
      .from(mixingMaterialsUsed)
      .innerJoin(mixingRuns, eq(mixingMaterialsUsed.mixingRunId, mixingRuns.id))
      .where(
        and(
          eq(mixingRuns.status, "completed"),
          gte(mixingRuns.actualCompletionDate, rangeStart),
          lte(mixingRuns.actualCompletionDate, rangeEnd),
        ),
      )
      .then((r) => r[0]),`);

// Update Promise.all
code = code.replace(/db\s*\.select\(\{\s*activeCount: sql<number>`count\(\*\) filter \(where \$\{productionRuns\.status\} = 'in_progress'\)`,\s*completedCount: sql<number>`count\(\*\) filter \(where \$\{productionRuns\.status\} = 'completed'\)`,\s*totalCartons: sql<string>`coalesce\(sum\(\$\{productionRuns\.cartonsProduced\}\) filter \(where \$\{productionRuns\.status\} = 'completed'\), 0)`,\s*\}\)\s*\.from\(productionRuns\)\s*\.where\(and\(gte\(productionRuns\.createdAt, rangeStart\), lte\(productionRuns\.createdAt, rangeEnd\)\)\)\s*\.then\(\(r\) => r\[0\]\),/, `db
        .select({
          activeCount: sql<number>\`count(*) filter (where \${mixingRuns.status} = 'in_progress')\`,
          completedCount: sql<number>\`count(*) filter (where \${mixingRuns.status} = 'completed')\`,
          totalCartons: sql<string>\`0\`
        })
        .from(mixingRuns)
        .where(and(gte(mixingRuns.createdAt, rangeStart), lte(mixingRuns.createdAt, rangeEnd)))
        .then((r) => r[0]),
      db
        .select({
          activeCount: sql<number>\`count(*) filter (where \${packagingAllocations.status} = 'in_progress')\`,
          completedCount: sql<number>\`count(*) filter (where \${packagingAllocations.status} = 'completed')\`,
          totalCartons: sql<string>\`coalesce(sum(\${packagingAllocations.completedContainers}) filter (where \${packagingAllocations.status} = 'completed'), 0)\`,
        })
        .from(packagingAllocations)
        .where(and(gte(packagingAllocations.createdAt, rangeStart), lte(packagingAllocations.createdAt, rangeEnd)))
        .then((r) => r[0]),`);

code = code.replace(/const \[[\s\S]*?\] = await Promise\.all\(\[/, `const [
      currentMetrics,
      previousMetrics,
      mixingRow,
      packagingRow,
      chemicalStockRow,
      packagingStockRow,
      finishedGoodsRow,
      empCountRow,
    ] = await Promise.all([`);

// Update activeProductionRuns, completedProductionRuns, totalCartonsProduced
code = code.replace(/const activeProductionRuns = productionRow\?\.activeCount \?\? 0;/g, 'const activeProductionRuns = (mixingRow?.activeCount ?? 0) + (packagingRow?.activeCount ?? 0);');
code = code.replace(/const completedProductionRuns = productionRow\?\.completedCount \?\? 0;/g, 'const completedProductionRuns = (mixingRow?.completedCount ?? 0) + (packagingRow?.completedCount ?? 0);');
code = code.replace(/const totalCartonsProduced = toFloat\(productionRow\?\.totalCartons\);/g, 'const totalCartonsProduced = toFloat(packagingRow?.totalCartons);');

code = code.replace(/payrollsInRange\.map\(\(p\) => p\.id\)/g, 'payrollsInRange.map((p: any) => p.id)');

fs.writeFileSync(path, code);
