const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

const regex = /const \[\s*currentMetrics,\s*previousMetrics,\s*productionRow,\s*chemicalStockRow,\s*packagingStockRow,\s*finishedGoodsRow,\s*empCountRow,\s*\] = await Promise\.all\(\[\s*computePeriodMetrics\(rangeStart, rangeEnd\),\s*computePeriodMetrics\(prevPeriod\.start, prevPeriod\.end\),\s*db\s*\.select\(\{[\s\S]*?\.then\(\(r\) => r\[0\]\),/;

const replacement = `const [
      currentMetrics,
      previousMetrics,
      mixingRow,
      packagingRow,
      chemicalStockRow,
      packagingStockRow,
      finishedGoodsRow,
      empCountRow,
    ] = await Promise.all([
      computePeriodMetrics(rangeStart, rangeEnd),
      computePeriodMetrics(prevPeriod.start, prevPeriod.end),
      db
        .select({
          activeCount: sql<number>\`count(*) filter (where \${mixingRuns.status} = 'in_progress')\`,
          completedCount: sql<number>\`count(*) filter (where \${mixingRuns.status} = 'completed')\`,
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
        .then((r) => r[0]),`;

code = code.replace(regex, replacement);
fs.writeFileSync(path, code);
