import fs from 'fs';
const file = 'src/lib/auth.ts';
let content = fs.readFileSync(file, 'utf8');

const importStatement = `import { logActivityQuiet } from "./activity-logger.server";\n`;
if (!content.includes('logActivityQuiet')) {
  content = importStatement + content;
}

const dbHooks = `
  databaseHooks: {
    session: {
      create: {
        after: async (session: any) => {
          // Fetch user name since session only has userId
          const u = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, session.userId) });
          logActivityQuiet({
            module: "auth",
            action: "login",
            entityType: "session",
            actorId: session.userId,
            actorName: u?.name || "Unknown User",
            description: \`User \${u?.name || session.userId} logged in\`,
            ipAddress: session.ipAddress,
          });
        }
      },
      delete: {
        before: async (session: any) => {
          const u = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, session.userId) });
          logActivityQuiet({
            module: "auth",
            action: "logout",
            entityType: "session",
            actorId: session.userId,
            actorName: u?.name || "Unknown User",
            description: \`User \${u?.name || session.userId} logged out\`,
          });
        }
      }
    }
  },
`;

if (!content.includes('databaseHooks:')) {
  content = content.replace('trustedOrigins,', dbHooks + '\n  trustedOrigins,');
}

fs.writeFileSync(file, content);
