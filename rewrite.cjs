const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

const regex = /const \[\s*currentMetrics,\s*previousMetrics,\s*productionRow,\s*mixingRow,\s*packagingRow,\s*chemicalStockRow,\s*packagingStockRow,\s*finishedGoodsRow,\s*empCountRow,\s*\] = await Promise\.all\(\[[\s\S]*?\.then\(\(r\) => r\[0\]\),/m;

// wait, the variables array in the file right now is missing productionRow because I sed'd it!
// let's just replace from `const [` to the end of the `Promise.all` call!
// I'll match `const [ currentMetrics,` to `empCountRow,\n    ] = await Promise.all([`
