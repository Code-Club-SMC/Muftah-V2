const fs = require('fs');
const path = 'src/db/schemas/manufacturing-schema.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/productionRunId: text\("production_run_id"\)[\s\S]*?\.references\(\(\) => productionRuns\.id\),/, '');
code = code.replace(/productionRunIdx: index\("cartons_production_run_idx"\)\.on\(t\.productionRunId\),/, '');
code = code.replace(/productionRun: one\(productionRuns, \{[\s\S]*?\}\),/, '');
code = code.replace(/import { productionRuns } from "\.\/inventory-schema";/, '');
code = code.replace(/productionRunId: text\("production_run_id"\)/, ''); // Just in case it didn't match fully

fs.writeFileSync(path, code);
