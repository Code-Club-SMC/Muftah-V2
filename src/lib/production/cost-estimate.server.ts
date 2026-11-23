import { inArray } from "drizzle-orm";
import type { db } from "@/db";
import { recipes } from "@/db/schemas/inventory-schema";
import { estimateFormat } from "./cost-estimate";

const price = { columns: { costPerUnit: true, measuredInKg: true, weightPerPack: true } } as const;
const ingredients = { with: { chemical: { columns: { costPerUnit: true } } } } as const;

// Estimates are worked out from today's formula and prices on every read. The columns saved
// on the format are only a snapshot from when it was last saved.
export async function withLiveEstimates<T extends { id: string }>(reader: Pick<typeof db, "query">, rows: T[]) {
  if (!rows.length) return [];
  const formats = await reader.query.recipes.findMany({
    where: inArray(recipes.id, rows.map((row) => row.id)),
    with: { formula: { with: { ingredients } }, ingredients, containerPackaging: price, cartonPackaging: price, packaging: { with: { packagingMaterial: price } } },
  });
  const estimates = new Map(formats.map((format) => [format.id, estimateFormat(format)]));
  return rows.map((row) => ({ ...row, ...estimates.get(row.id)! }));
}
