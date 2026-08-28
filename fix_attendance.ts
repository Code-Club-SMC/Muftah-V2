import fs from 'fs';
const file = 'src/server-functions/hr/attendance/upsert-attendance-fn.ts';
let content = fs.readFileSync(file, 'utf8');

const importStatement = `import { logActivityQuiet } from "@/lib/activity-logger.server";\n`;
if (!content.includes('logActivityQuiet')) {
  content = importStatement + content;
}

content = content.replace(
  /return \{ success: true \};\s*\}\);/m,
  (match) => `logActivityQuiet({ module: "hr", action: "updated", entityType: "attendance", actorId: context.authContext.session.user.id, actorName: context.authContext.session.user.name, description: "Corrected/Updated employee attendance" });\n    ${match}`
);

fs.writeFileSync(file, content);
