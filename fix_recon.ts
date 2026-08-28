import fs from 'fs';
const file = 'src/server-functions/sales/offline-stock-reconciliation-fn.ts';
let content = fs.readFileSync(file, 'utf8');

const importStatement = `import { logActivityQuiet } from "@/lib/activity-logger.server";\n`;
if (!content.includes('logActivityQuiet')) {
  content = importStatement + content;
}

// Replace end of resolveStockReconciliationIssueFn
content = content.replace(
  /return \{ success: true, message: "[^"]+" \};\s*\}\);/m,
  (match) => `logActivityQuiet({ module: "inventory", action: "reconciled", entityType: "stock_reconciliation", actorId: context.authContext.session.user.id, actorName: context.authContext.session.user.name, description: "Resolved stock reconciliation issue" });\n    ${match}`
);

fs.writeFileSync(file, content);
