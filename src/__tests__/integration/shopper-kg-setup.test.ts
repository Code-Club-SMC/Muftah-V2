import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, warehouses, suppliers, packagingMaterials, purchaseRecords, materialLots } from "@/db";
import type { Tx } from "@/lib/inventory/material-lots.server";
import { addPackagingMaterialFn } from "@/server-functions/inventory/add-packaging-material-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { withRollback } from "./with-rollback";

// Only the session transport is replaced. Validation, handlers, locks and SQL are real.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown };
    const builder = {
      middleware: () => builder,
      inputValidator: (schema: typeof validator) => {
        validator = schema;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: { data: unknown; context: unknown }) =>
          handler({ ...input, data: validator.parse(input.data) }),
    };
    return builder;
  },
}));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const purchase = { notes: "", invoiceNumber: "", paymentMethod: "cash", walletId: "", paymentStatus: "unpaid" as const, amountPaid: "", transactionId: "", bankName: "" };

async function seed(tx: Tx) {
  const id = randomUUID();
  const [actor] = await tx.insert(user).values({ id, name: "Store", email: `${id}@test.invalid` }).returning();
  const [floor] = await tx.insert(warehouses).values({ name: id, address: "T", city: "T", state: "T", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [supplier] = await tx.insert(suppliers).values({ supplierName: id }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor }, permissions: ["inventory.manage"] } };
  return { id, floor, supplier, context };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("shoppers measured in KG", () => {
  it("buys shoppers as KG × price per KG and opens a per-KG lot", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    await addPackagingMaterialFn({ data: { ...purchase, name: `${id} 100g shopper`, warehouseId: floor.id, quantity: "50", costPerUnit: "1", minimumStockLevel: 10, type: "primary", capacity: "", capacityUnit: "", measuredInKg: true, weightPerPack: "1.0", pricePerKg: "520", associatedStickerId: "", stickerCost: "", supplierId: supplier.id }, context } as never);
    const [material] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.name, `${id} 100g shopper`));
    expect(material.measuredInKg).toBe(true);
    expect(material.costPerUnit).toBe("520.00");
    const [bought] = await tx.select().from(purchaseRecords).where(eq(purchaseRecords.packagingMaterialId, material.id));
    expect([bought.quantity, bought.unitCost, bought.cost]).toEqual(["50.000", "520.00", "26000.00"]);
    const [lot] = await tx.select().from(materialLots).where(eq(materialLots.packagingMaterialId, material.id));
    expect(lot.unitPrice).toBe("520.00");
  }));

  it("requires weight and price, and only allows it on primary packaging", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    const base = { ...purchase, warehouseId: floor.id, quantity: "0", costPerUnit: "0", minimumStockLevel: 0, capacity: "", capacityUnit: "", associatedStickerId: "", stickerCost: "", supplierId: supplier.id, measuredInKg: true };
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-a`, type: "primary", weightPerPack: "", pricePerKg: "520" }, context } as never)).rejects.toThrow("Weight of one shopper");
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-b`, type: "primary", weightPerPack: "1", pricePerKg: "" }, context } as never)).rejects.toThrow("Price per KG");
    await expect(addPackagingMaterialFn({ data: { ...base, name: `${id}-c`, type: "master", weightPerPack: "1", pricePerKg: "520" }, context } as never)).rejects.toThrow("Only primary packaging");
  }));

  it("locks the switch once the material has stock or history", () => withRollback(async (tx) => {
    const { id, floor, supplier, context } = await seed(tx);
    const [empty] = await tx.insert(packagingMaterials).values({ name: `${id}-empty`, type: "primary", costPerUnit: "2" }).returning();
    const fields = { name: empty.name, costPerUnit: "520", minimumStockLevel: 0, materialType: "primary", measuredInKg: true, weightPerPack: "1.0" };
    await updateMaterialFn({ data: { id: empty.id, type: "packaging", data: fields }, context } as never);
    const [switched] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.id, empty.id));
    expect(switched.measuredInKg).toBe(true);

    await addPackagingMaterialFn({ data: { ...purchase, name: `${id}-stocked`, warehouseId: floor.id, quantity: "100", costPerUnit: "2", minimumStockLevel: 0, type: "primary", capacity: "", capacityUnit: "", measuredInKg: false, weightPerPack: "", pricePerKg: "", associatedStickerId: "", stickerCost: "", supplierId: supplier.id }, context } as never);
    const [stocked] = await tx.select().from(packagingMaterials).where(eq(packagingMaterials.name, `${id}-stocked`));
    await expect(updateMaterialFn({ data: { id: stocked.id, type: "packaging", data: { ...fields, name: stocked.name } }, context } as never))
      .rejects.toThrow("Measured in KG can't change once this material has stock or has been used.");
  }));
});
