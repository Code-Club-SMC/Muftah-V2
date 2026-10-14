const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/productionRuns,\s*/g, '');
code = code.replace(/productionMaterialsUsed,\s*/g, '');

code = code.replace(/productionRow,\s*/g, '');

// Remove the productionRuns query block
const prodQuery = /db\s*\.select\(\{\s*activeCount: sql<number>`count\(\*\) filter \(where \$\{productionRuns\.status\} = 'in_progress'\)`,\s*completedCount: sql<number>`count\(\*\) filter \(where \$\{productionRuns\.status\} = 'completed'\)`,\s*totalCartons: sql<string>`coalesce\(sum\(\$\{productionRuns\.cartonsProduced\}\) filter \(where \$\{productionRuns\.status\} = 'completed'\), 0)`,\s*\}\)\s*\.from\(productionRuns\)\s*\.where\(and\(gte\(productionRuns\.createdAt, rangeStart\), lte\(productionRuns\.createdAt, rangeEnd\)\)\)\s*\.then\(\(r\) => r\[0\]\),\s*/;
code = code.replace(prodQuery, '');

// Fix variable assignments
code = code.replace(/const activeProductionRuns = \(productionRow\?\.activeCount \?\? 0\) \+ \(mixingRow\?\.activeCount \?\? 0\) \+ \(packagingRow\?\.activeCount \?\? 0\);/, 'const activeProductionRuns = (mixingRow?.activeCount ?? 0) + (packagingRow?.activeCount ?? 0);');
code = code.replace(/const completedProductionRuns = \(productionRow\?\.completedCount \?\? 0\) \+ \(mixingRow\?\.completedCount \?\? 0\) \+ \(packagingRow\?\.completedCount \?\? 0\);/, 'const completedProductionRuns = (mixingRow?.completedCount ?? 0) + (packagingRow?.completedCount ?? 0);');
code = code.replace(/const totalCartonsProduced = toFloat\(productionRow\?\.totalCartons\) \+ toFloat\(packagingRow\?\.totalCartons\);/, 'const totalCartonsProduced = toFloat(packagingRow?.totalCartons);');

// The computePeriodMetrics also used productionMaterialsUsed. We need to replace it with mixingMaterialsUsed and packagingMaterialsUsed, OR just mixingMaterialsUsed for bulk.
// Wait, in the Spec we introduced mixingMaterialsUsed and packagingMaterialsUsed! 
// Let's replace the productionMaterialsUsed query inside computePeriodMetrics!
fs.writeFileSync(path, code);
