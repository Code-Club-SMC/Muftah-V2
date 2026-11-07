import { count } from "drizzle-orm";
import type { db } from "@/db";
import { salesReturnReasons } from "@/db/schemas/sales-erp-schema";
import { DEFAULT_RETURN_REASONS } from "./return-lifecycle";

type Database = Pick<typeof db, "select" | "insert">;

/** Fills the reason list on first use. Once any reason exists, the list belongs to the admins. */
export async function ensureReturnReasonsSeeded(database: Database): Promise<void> {
  const [existing] = await database.select({ total: count() }).from(salesReturnReasons);
  if (Number(existing?.total ?? 0) > 0) return;
  await database
    .insert(salesReturnReasons)
    .values(
      DEFAULT_RETURN_REASONS.map((reason, index) => ({
        name: reason.name,
        requiresNote: reason.requiresNote,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing();
}
