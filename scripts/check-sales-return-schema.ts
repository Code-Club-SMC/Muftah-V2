// Run after switching branches that share a database: bun scripts/check-sales-return-schema.ts
// Read-only. Never run db:push or rewrite migration history to resolve a mismatch.
import { Client } from "pg";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  salesReturns,
  salesReturnItems,
  salesReturnStockTraces,
} from "../src/db/schemas/sales-erp-schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ||
    ["production", "staging"].includes(process.env.NODE_ENV ?? "")
      ? { rejectUnauthorized: false }
      : false,
});

try {
  await client.connect();
  const tables = [salesReturns, salesReturnItems, salesReturnStockTraces];
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    column_default: string | null;
  }>(
    "select table_name, column_name, column_default from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])",
    [tables.map(getTableName)],
  );
  const missing = tables.flatMap((table) =>
    Object.values(getTableColumns(table))
      .filter(
        (column) =>
          !rows.some(
            (row) =>
              row.table_name === getTableName(table) &&
              row.column_name === column.name,
          ),
      )
      .map((column) => `${getTableName(table)}.${column.name}`),
  );
  if (missing.length)
    throw new Error(
      `Sales return schema mismatch. Missing: ${missing.join(", ")}. Reconcile this database with this branch's migration history before using returns, invoices or ledgers.`,
    );
  const status = rows.find(
    (row) => row.table_name === "sales_returns" && row.column_name === "status",
  );
  if (status?.column_default !== `'${salesReturns.status.default}'::text`)
    throw new Error(
      `Sales return status default differs from this branch. Expected ${salesReturns.status.default}, found ${status?.column_default}.`,
    );
  console.log("Sales return columns and status default match this checkout.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
