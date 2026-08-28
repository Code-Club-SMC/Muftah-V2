import fs from 'fs';
const file = 'src/server-functions/dashboard/activity-timeline-fn.ts';
let content = fs.readFileSync(file, 'utf8');

const helper = `
function buildWhereClause(data: z.infer<typeof activityExportInput>) {
  const { module, action, actorId, entityType, severity, dateFrom, dateTo, search } = data;
  const conditions = [];

  if (module) conditions.push(eq(systemActivityLog.module, module));
  if (action) conditions.push(eq(systemActivityLog.action, action));
  if (actorId) conditions.push(eq(systemActivityLog.actorId, actorId));
  if (entityType) conditions.push(eq(systemActivityLog.entityType, entityType));
  if (severity) conditions.push(eq(systemActivityLog.severity, severity));
  if (dateFrom) conditions.push(gte(systemActivityLog.timestamp, new Date(dateFrom)));
  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    conditions.push(lte(systemActivityLog.timestamp, endDate));
  }
  if (search) {
    conditions.push(
      or(
        ilike(systemActivityLog.description, \`%\${search}%\`),
        ilike(systemActivityLog.entityLabel, \`%\${search}%\`),
        ilike(systemActivityLog.actorName, \`%\${search}%\`)
      )
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}
`;

content = content.replace(
  /const activityExportInput = z\.object\(\{[\s\S]*?\}\);/m,
  (match) => match + '\n' + helper
);

content = content.replace(
  /const { page, pageSize, module, action, actorId, entityType, severity, dateFrom, dateTo, search } = data;\s*const conditions = \[\];[\s\S]*?const whereClause = conditions\.length > 0 \? and\(\.\.\.conditions\) : undefined;/m,
  'const { page, pageSize } = data;\n    const whereClause = buildWhereClause(data);'
);

content = content.replace(
  /const { module, action, actorId, entityType, severity, dateFrom, dateTo, search } = data;\s*const conditions = \[\];[\s\S]*?const whereClause = conditions\.length > 0 \? and\(\.\.\.conditions\) : undefined;/m,
  'const whereClause = buildWhereClause(data);'
);

fs.writeFileSync(file, content);
