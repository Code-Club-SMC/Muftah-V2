// src/__tests__/material-lots-schema.test.ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { materialLots, materialLotStock, materialLotMovements, inventoryAuditLog, stockTransfers } from "@/db/schemas/inventory-schema";
import { purchaseRecords } from "@/db/schemas/supplier-schema";
import { mixingMaterialsUsed, packagingMaterialsUsed } from "@/db/schemas/production-schema";

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((column) => column.name);

describe("material lot schema", () => {
  it("stores one lot per item and price", () => {
    expect(columns(materialLots)).toEqual(expect.arrayContaining(["id", "chemical_id", "packaging_material_id", "unit_price", "first_purchased_at"]));
    const indexes = getTableConfig(materialLots).indexes.map((index) => index.config.name);
    expect(indexes).toEqual(expect.arrayContaining(["material_lots_chemical_price_unique_idx", "material_lots_packaging_price_unique_idx"]));
  });

  it("stores lot quantity per store and an append-only movement ledger", () => {
    expect(columns(materialLotStock)).toEqual(expect.arrayContaining(["lot_id", "warehouse_id", "quantity"]));
    expect(columns(materialLotMovements)).toEqual(expect.arrayContaining(["lot_id", "warehouse_id", "delta", "source_type", "source_id", "created_at"]));
  });

  it("links usage and history rows to the lot", () => {
    for (const table of [purchaseRecords, inventoryAuditLog, stockTransfers, mixingMaterialsUsed, packagingMaterialsUsed]) {
      expect(columns(table)).toContain("lot_id");
    }
  });
});
