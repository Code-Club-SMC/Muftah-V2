import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPackagingMaterialFn } from "@/server-functions/inventory/add-packaging-material-fn";
import { updateMaterialFn } from "@/server-functions/inventory/update-material-fn";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { packagingMaterials } from "@/db/schemas/inventory-schema";
import { PACKAGING_KINDS } from "@/lib/inventory/packaging-kind";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), move: vi.fn() }));
vi.mock("@/db", async () => ({
  ...await import("@/db/schemas/inventory-schema"), ...await import("@/db/schemas/supplier-schema"),
  ...await import("@/db/schemas/finance-schema"), ...await import("@/db/schemas/core-suppliers"),
  db: { transaction: mocks.transaction },
}));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {}, requireSuppliersManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));
vi.mock("@/lib/inventory/material-lots.server", () => ({ lockMaterialStock: vi.fn(), moveLotStock: mocks.move, purchaseIsUntouched: vi.fn(), findOrCreateLot: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse(value: unknown): unknown };
  const b = { middleware: () => b, inputValidator: (schema: typeof validator) => { validator = schema; return b; },
    handler: (fn: (input: unknown) => unknown) => async (input: { data: unknown }) => fn({ ...input, data: validator.parse(input.data) }) };
  return b;
} }));
const context = { session: { user: { id: "actor", name: "Buyer" } }, authContext: { session: { user: { id: "actor", name: "Buyer" } } } };
let material: Record<string, unknown>;
let writes: Record<string, unknown>[];
const createInput = { name: "New shopper", warehouseId: "floor", quantity: "0", costPerUnit: "520", minimumStockLevel: 0, type: "primary", measuredInKg: true, weightPerPack: "6.5", pricePerKg: "520", capacity: "", capacityUnit: "", associatedStickerId: "", stickerCost: "", supplierId: "supplier", notes: "", invoiceNumber: "", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "" };
const editInput = { id: "pkg", type: "packaging", data: { name: "Shopper", costPerUnit: "520", minimumStockLevel: 0 } };
beforeEach(() => {
  vi.clearAllMocks(); writes = [];
  material = { id: "pkg", name: "Shopper", type: "primary", measuredInKg: true, weightPerPack: "6.5", packagingKind: "shopper" };
  mocks.transaction.mockImplementation(async fn => fn({
    query: { warehouses: { findFirst: async () => ({ id: "floor", name: "Floor", type: "factory_floor" }) } },
    select: () => {
      let table = "", filtered = false;
      const b = { from: (value: Parameters<typeof getTableName>[0]) => { table = getTableName(value); return b; },
        where: () => { filtered = true; return b; }, for: () => b,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(
          table === "packaging_materials" ? filtered ? [material] : []
            : table === "purchase_records" ? [{ id: "p", materialType: "packaging", packagingMaterialId: "pkg", quantity: "10.000", cost: "5200.00", unitCost: "520.00", lotId: "lot", voidedAt: null }]
            : table === "suppliers" ? [{ supplierName: "Supplier" }] : []
        ).then(resolve, reject) };
      return b;
    },
    insert: () => ({ values: (values: Record<string, unknown>) => ({ returning: async () => { material = { id: "pkg", ...values }; return [material]; } }) }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => ({ where: async () => {
      if (getTableName(table) === "packaging_materials") {
        writes.push(values);
        Object.assign(material, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)));
      }
    } }) }),
  }));
});

describe("packaging kind write boundaries", () => {
  it.each(["bucket", null, undefined])("creates kind %s without inferring role or units", async packagingKind => {
    const result = await addPackagingMaterialFn({ data: { ...createInput, packagingKind }, context } as never);
    expect(result).toMatchObject({ type: "primary", measuredInKg: true, weightPerPack: "6.5" });
    expect(result.packagingKind).toBe(packagingKind);
  });
  it.each(["create", "material", "purchase"])("rejects an unknown kind before the %s transaction", async boundary => {
    const call = boundary === "create" ? addPackagingMaterialFn({ data: { ...createInput, packagingKind: "drum" }, context } as never)
      : boundary === "material" ? updateMaterialFn({ data: { ...editInput, data: { ...editInput.data, packagingKind: "drum" } }, context } as never)
      : updatePurchaseRecordFn({ data: { id: "p", packagingKind: "drum" }, context } as never);
    await expect(call).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["material", "purchase"])("preserves omitted kinds, saves explicit values and clears null on %s edits", async boundary => {
    const edit = (fields: Record<string, unknown>) => boundary === "material"
      ? updateMaterialFn({ data: { ...editInput, data: { ...editInput.data, ...fields } }, context } as never)
      : updatePurchaseRecordFn({ data: { id: "p", ...fields }, context } as never);
    await edit({}); expect(material.packagingKind).toBe("shopper");
    await edit({ packagingKind: "bucket" }); expect(material.packagingKind).toBe("bucket");
    await edit({ packagingKind: null }); expect(material.packagingKind).toBeNull();
    expect(material).toMatchObject({ type: "primary", measuredInKg: true });
    expect(writes).toHaveLength(3);
    expect(mocks.move).not.toHaveBeenCalled();
  });
  it("keeps the database field nullable with an explicit allowed-value check", () => {
    expect(packagingMaterials.packagingKind.notNull).toBe(false);
    const check = getTableConfig(packagingMaterials).checks.find(c => c.name === "packaging_materials_kind_check")!;
    const query = new PgDialect().sqlToQuery(check.value);
    expect(query.sql).toContain("IS NULL OR");
    for (const kind of PACKAGING_KINDS) expect(query.sql).toContain(`'${kind}'`);
  });
});
