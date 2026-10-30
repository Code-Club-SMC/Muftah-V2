// src/__tests__/actual-material-use-schema.test.ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { materialAdjustments, packagingMaterials } from "@/db/schemas/inventory-schema";
import { batchPackingReceipts, mixingMaterialUse, mixingMaterialsUsed, mixingRuns, packingMaterialUse } from "@/db/schemas/production-schema";

const columns = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((column) => column.name);

describe("actual material use schema", () => {
  it("marks shoppers measured in KG", () => {
    expect(columns(packagingMaterials)).toContain("measured_in_kg");
  });

  it("keeps reason codes next to the existing free-text notes", () => {
    expect(columns(mixingRuns)).toEqual(expect.arrayContaining(["shortfall_reason_code", "shortfall_reason"]));
    expect(columns(batchPackingReceipts)).toEqual(expect.arrayContaining(["loss_reason_code", "loss_reason"]));
    expect(columns(mixingMaterialsUsed)).toContain("use_type");
  });

  it("stores planned and used amounts per chemical and per packing material", () => {
    expect(columns(mixingMaterialUse)).toEqual(expect.arrayContaining(["mixing_run_id", "chemical_id", "formula_quantity", "used_quantity", "extra_quantity", "extra_cost", "reason", "note"]));
    expect(columns(packingMaterialUse)).toEqual(expect.arrayContaining(["receipt_id", "material_id", "measured_in_kg", "needed_quantity", "used_quantity", "extra_quantity", "extra_cost", "total_cost", "reason", "note", "shopper_weight_grams", "expected_shoppers", "actual_shoppers", "loss_shoppers"]));
  });

  it("stores each manual adjustment with its lot, price and reason", () => {
    expect(columns(materialAdjustments)).toEqual(expect.arrayContaining(["warehouse_id", "material_type", "chemical_id", "packaging_material_id", "lot_id", "delta", "unit_price", "value", "reason", "note", "source", "performed_by_id", "created_at"]));
  });
});
