/**
 * One-time sync: sets each chemical's and packaging material's current price to its newest
 * purchase. Purchases made before prices followed purchases never updated it.
 * Stock already on hand keeps the price it was bought for.
 *
 * Check the dry run first: a price typed by hand after the newest purchase is listed too.
 * Leave an item out with --skip=<id>,<id>.
 *
 * Usage:
 *   npx tsx --env-file=.env src/db/sync-material-prices.ts           # dry run, changes nothing
 *   npx tsx --env-file=.env src/db/sync-material-prices.ts --apply   # writes the changes
 */

import { db } from ".";
import { chemicals, packagingMaterials } from "./schemas/inventory-schema";
import { lotPrice, type MaterialRef } from "../lib/inventory/material-lots";
import { lockMaterialEverywhere, newestPurchases, setMaterialPrice } from "../lib/inventory/material-price.server";

async function main() {
  const apply = process.argv.includes("--apply");
  const skip = new Set(process.argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length).split(","));
  const fields = (table: typeof chemicals | typeof packagingMaterials) => ({ id: table.id, name: table.name, price: table.costPerUnit });
  const items = [
    ...(await db.select(fields(chemicals)).from(chemicals)).map((row) => ({ ...row, materialType: "chemical" as const })),
    ...(await db.select(fields(packagingMaterials)).from(packagingMaterials)).map((row) => ({ ...row, materialType: "packaging" as const })),
  ];

  let changes = 0;
  for (const item of items) {
    const ref: MaterialRef = { materialType: item.materialType, materialId: item.id };
    await db.transaction(async (tx) => {
      const [newest] = await newestPurchases(tx, ref);
      if (!newest || lotPrice(newest.unitCost) === lotPrice(item.price ?? "0")) return;
      const what = `${item.name} (${item.materialType}, ${item.id}): ${item.price} -> ${newest.unitCost}, bought ${newest.purchaseDate.toISOString().slice(0, 10)}`;
      if (skip.has(item.id)) return console.log(`SKIP  ${what}`);
      changes++;
      console.log(`SET   ${what}`);
      if (!apply) return;
      await lockMaterialEverywhere(tx, ref);
      await setMaterialPrice(tx, ref, newest.unitCost);
    });
  }
  console.log(`\n${changes} price(s) ${apply ? "updated" : "to update. Dry run only. Re-run with --apply to write."}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
