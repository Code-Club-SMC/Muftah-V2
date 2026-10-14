const fs = require('fs');
const path = 'src/server-functions/dashboard/get-dashboard-fn.ts';
let code = fs.readFileSync(path, 'utf8');

// I will just use regex to fix it
const regex = /\] = await Promise\.all\(\[\n[\s\S]*?\.then\(\(r\) => r\[0\]\),\n      db\n        \.select\(\{\n          activeCount: sql<number>`count\(\*\) filter \(where \$\{mixingRuns\.status\} = 'in_progress'\)`/;

code = code.replace(regex, `] = await Promise.all([
      computePeriodMetrics(rangeStart, rangeEnd),
      computePeriodMetrics(prevPeriod.start, prevPeriod.end),
      db
        .select({
          activeCount: sql<number>\`count(*) filter (where \${mixingRuns.status} = 'in_progress')\``);
fs.writeFileSync(path, code);
