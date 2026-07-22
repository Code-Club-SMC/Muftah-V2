import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();
const db = drizzle(client);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("✅ Migrations complete");

await client.end();
process.exit(0);
