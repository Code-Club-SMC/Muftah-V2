import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const packagingUnitSql = (measuredInKg: AnyPgColumn) => sql<string>`case when ${measuredInKg} then 'kg' else 'pcs' end`;
