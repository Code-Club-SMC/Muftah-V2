import fs from 'fs';
const file = 'src/server-functions/sales/sales-returns-fn.ts';
let content = fs.readFileSync(file, 'utf8');

const importStatement = `import { logActivityQuiet } from "@/lib/activity-logger.server";\n`;
if (!content.includes('logActivityQuiet')) {
  content = importStatement + content;
}

// Replace end of createSalesReturnFn
content = content.replace(
  /return \{ success: true, returnRecord \};\s*\}\);/m,
  `logActivityQuiet({ module: "sales", action: "created", entityType: "sales_return", entityId: returnRecord.id, actorId: context.authContext.session.user.id, actorName: context.authContext.session.user.name, description: "Created sales return" });\n    return { success: true, returnRecord };\n  });`
);

// Replace end of processSalesReturnFn
content = content.replace(
  /return \{ success: true \};\s*\}\);/m,
  `logActivityQuiet({ module: "sales", action: "processed", entityType: "sales_return", actorId: context.authContext.session.user.id, actorName: context.authContext.session.user.name, description: "Processed sales return" });\n    return { success: true };\n  });`
);

fs.writeFileSync(file, content);
