/**
 * One-time backfill: marks old chemical purchases as by-products using the chemical's saved
 * packaging (for example "Drum" + "100kg"). Only clean cases are marked. Everything else is
 * listed and left for the admin to mark by hand in Edit purchase.
 *
 * Marking a purchase can only raise empties earned, never lower them, so it can't conflict
 * with sales already recorded.
 *
 * Usage:
 *   npx tsx --env-file=.env src/db/backfill-by-products.ts           # dry run, changes nothing
 *   npx tsx --env-file=.env src/db/backfill-by-products.ts --apply   # writes the changes
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from ".";
import { chemicals } from "./schemas/inventory-schema";
import { purchaseRecords } from "./schemas/supplier-schema";
import { autoMarkFromPackaging } from "../lib/inventory/by-products";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({
      id: purchaseRecords.id,
      purchaseDate: purchaseRecords.purchaseDate,
      quantity: purchaseRecords.quantity,
      chemicalName: chemicals.name,
      unit: chemicals.unit,
      packagingType: chemicals.packagingType,
      packagingSize: chemicals.packagingSize,
    })
    .from(purchaseRecords)
    .innerJoin(chemicals, eq(purchaseRecords.chemicalId, chemicals.id))
    .where(
      and(
        eq(purchaseRecords.materialType, "chemical"),
        eq(purchaseRecords.byProductTracked, false),
        isNull(purchaseRecords.voidedAt),
      ),
    );

  const toMark: { id: string; containerName: string; containerSize: string }[] = [];
  for (const row of rows) {
    const result = autoMarkFromPackaging(row);
    const what = `${row.chemicalName} | ${row.quantity} ${row.unit} | ${row.purchaseDate.toISOString().slice(0, 10)} | ${row.id}`;
    if (result.ok) {
      toMark.push({ id: row.id, containerName: result.containerName, containerSize: result.containerSize });
      console.log(`MARK  ${what} -> ${Number(result.containerSize)}${row.unit} ${result.containerName}`);
    } else {
      console.log(`SKIP  ${what} (${result.reason})`);
    }
  }

  console.log(`\n${toMark.length} to mark, ${rows.length - toMark.length} skipped (mark those by hand in Edit purchase).`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of toMark) {
      await tx
        .update(purchaseRecords)
        .set({ byProductTracked: true, containerName: item.containerName, containerSize: item.containerSize, updatedAt: new Date() })
        .where(and(eq(purchaseRecords.id, item.id), eq(purchaseRecords.byProductTracked, false)));
    }
  });
  console.log(`Marked ${toMark.length} purchases.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
