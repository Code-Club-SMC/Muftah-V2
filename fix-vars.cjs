const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/const activeProductionRuns = productionRow\?\.activeCount \?\? 0;/, 'const activeProductionRuns = (mixingRow?.activeCount ?? 0) + (packagingRow?.activeCount ?? 0);');
code = code.replace(/const completedProductionRuns = productionRow\?\.completedCount \?\? 0;/, 'const completedProductionRuns = (mixingRow?.completedCount ?? 0) + (packagingRow?.completedCount ?? 0);');
code = code.replace(/const totalCartonsProduced = toFloat\(productionRow\?\.totalCartons\);/, 'const totalCartonsProduced = toFloat(packagingRow?.totalCartons);');

fs.writeFileSync(path, code);
