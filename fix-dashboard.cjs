const fs = require('fs');
const file = '/home/abdul-rehman/Projects/titan-new/src/server-functions/dashboard/get-dashboard-fn.ts';
let content = fs.readFileSync(file, 'utf8');

// Find the Promise.all block
const startMatch = "    ] = await Promise.all([";
const endMatch = "    // Revenue count for the current period (kept for backwards-compat)";

const startIndex = content.indexOf(startMatch);
const endIndex = content.indexOf(endMatch);

if (startIndex !== -1 && endIndex !== -1) {
  const newBlock = `    ] = await Promise.all([
      computePeriodMetrics(rangeStart, rangeEnd),
      computePeriodMetrics(prevPeriod.start, prevPeriod.end),
      db
        .select({
          activeCount: sql<number>\`count(*) filter (where \${productionRuns.status} = 'in_progress')\`,
          completedCount: sql<number>\`count(*) filter (where \${productionRuns.status} = 'completed')\`,
          totalCartons: sql<string>\`coalesce(sum(\${productionRuns.cartonsProduced}) filter (where \${productionRuns.status} = 'completed'), 0)\`,
        })
        .from(productionRuns)
        .where(and(gte(productionRuns.createdAt, rangeStart), lte(productionRuns.createdAt, rangeEnd)))
        .then((r) => r[0]),
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
        .then((r) => r[0]),
      db
        .select({ value: sql<string>\`coalesce(sum(\${materialStock.quantity}::numeric * \${chemicals.costPerUnit}::numeric), 0)\` })
        .from(materialStock)
        .leftJoin(chemicals, eq(materialStock.chemicalId, chemicals.id))
        .where(sql\`\${materialStock.chemicalId} is not null\`)
        .then((r) => r[0]),
      db
        .select({ value: sql<string>\`coalesce(sum(\${materialStock.quantity}::numeric * \${packagingMaterials.costPerUnit}::numeric), 0)\` })
        .from(materialStock)
        .leftJoin(packagingMaterials, eq(materialStock.packagingMaterialId, packagingMaterials.id))
        .where(sql\`\${materialStock.packagingMaterialId} is not null\`)
        .then((r) => r[0]),
      db
        .select({
          value: sql<string>\`coalesce(sum(
            (
              \${finishedGoodsStock.quantityCartons} * coalesce(\${recipes.containersPerCarton}, 0)
              + \${finishedGoodsStock.quantityContainers}
            )::numeric * coalesce(nullif(trim(\${finishedGoodsStock.weightedAverageCostPerPack}::text), '')::numeric, 0)
          ), 0)\`,
        })
        .from(finishedGoodsStock)
        .leftJoin(recipes, eq(finishedGoodsStock.recipeId, recipes.id))
        .then((r) => r[0]),
      db
        .select({ count: sql<number>\`count(*)\` })
        .from(employees)
        .where(eq(employees.status, "active"))
        .then((r) => r[0]),
    ]);

`;
  
  content = content.substring(0, startIndex) + newBlock + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log("Fixed dashboard fn");
} else {
  console.log("Could not find blocks");
}
