import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, user, chemicals, materialLots, purchaseRecords, suppliers, warehouses } from "@/db";
import { chemicalLabReports } from "@/db/schemas/inventory-schema";
import { addStockFn } from "@/server-functions/inventory/stock/add-stock-fn";
import { deletePurchaseRecordFn } from "@/server-functions/suppliers/delete-purchase-record-fn";
import { createLabReportFn } from "@/server-functions/inventory/lab-reports/create-lab-report-fn";
import { updateLabReportFn } from "@/server-functions/inventory/lab-reports/update-lab-report-fn";
import { deleteLabReportFn } from "@/server-functions/inventory/lab-reports/delete-lab-report-fn";
import { getLabReportsFn } from "@/server-functions/inventory/lab-reports/get-lab-reports-fn";
import { getChemicalReportPurchasesFn } from "@/server-functions/inventory/lab-reports/get-chemical-report-purchases-fn";
import { chemicalReportCoverage } from "@/lib/inventory/chemical-report-coverage.server";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse(data: unknown): unknown };
  const b = { middleware: () => b, inputValidator: (schema: typeof validator) => { validator = schema; return b; },
    handler: (fn: (input: unknown) => unknown) => async (input: { data: unknown }) => fn({ ...input, data: validator.parse(input.data) }) };
  return b;
} }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {}, requireInventoryViewMiddleware: {}, requireSuppliersManageMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

const details = (result: string) => ({ productName: "Soda", certifiedBy: "Test laboratory", reportDate: "2026-11-06", analysisItems: [{ item: "pH", requirement: "Lab supplied standard", result, passed: false }] });
async function fixture() {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Buyer", email: `${id}@test.invalid` }).returning();
  const [floor] = await db.insert(warehouses).values({ name: id, address: "Test", city: "Test", state: "Test", latitude: "0", longitude: "0", type: "factory_floor" }).returning();
  const [supplier] = await db.insert(suppliers).values({ supplierName: id }).returning();
  const [chemical] = await db.insert(chemicals).values({ name: id, unit: "kg" }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };
  const buy = async () => {
    const before = await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, chemical.id));
    await addStockFn({ data: { warehouseId: floor.id, materialType: "chemical", materialId: chemical.id, supplierId: supplier.id,
      quantity: "100", cost: "7000", paymentMethod: "pay_later", walletId: "", paymentStatus: "unpaid", amountPaid: "", notes: "", transactionId: "", bankName: "" }, context } as never);
    return (await db.select().from(purchaseRecords).where(eq(purchaseRecords.chemicalId, chemical.id))).find(p => !before.some(b => b.id === p.id))!;
  };
  const first = await buy();
  const second = await buy();
  const create = (purchaseId: string, result = "8.1", chemicalId = chemical.id) => createLabReportFn({ data: { chemicalId, purchaseId, ...details(result) }, context } as never);
  return { actor, floor, supplier, chemical, context, first, second, create };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("purchase certificate ownership and coverage", () => {
  it("does not confuse same-price lots with independent deliveries, and retains distinct certificate results", async () => {
    const f = await fixture();
    expect(f.first.lotId).toBe(f.second.lotId);
    expect(await db.select().from(materialLots).where(eq(materialLots.chemicalId, f.chemical.id))).toHaveLength(1);
    const first = await f.create(f.first.id, "8.1");
    expect((await chemicalReportCoverage([f.chemical.id], f.floor.id))[f.chemical.id]).toEqual({ purchaseCount: 2, missingPurchaseCount: 1, reportCount: 1 });
    expect(await db.query.chemicalLabReports.findMany({ where: eq(chemicalLabReports.purchaseId, f.second.id) })).toHaveLength(0);
    const additional = await f.create(f.first.id, "9.2");
    const second = await f.create(f.second.id, "10.3");
    expect((await db.query.chemicalLabReports.findFirst({ where: eq(chemicalLabReports.id, first.id) }))?.analysisItems[0].result).toBe("8.1");
    expect(additional.analysisItems[0].result).toBe("9.2");
    expect(second.analysisItems[0].result).toBe("10.3");
    expect((await chemicalReportCoverage([f.chemical.id]))[f.chemical.id]).toEqual({ purchaseCount: 2, missingPurchaseCount: 0, reportCount: 3 });
    const scoped = await getLabReportsFn({ data: { chemicalId: f.chemical.id, purchaseId: f.first.id } });
    expect(scoped).toHaveLength(2);
    expect(scoped.every(r => r.purchase?.supplier.supplierName === f.supplier.supplierName)).toBe(true);
  });

  it("counts legacy certificates without covering purchases, and deletion restores pending status", async () => {
    const f = await fixture();
    const [legacy] = await db.insert(chemicalLabReports).values({ chemicalId: f.chemical.id, createdById: f.actor.id, ...details("legacy"), reportDate: new Date("2026-11-06") }).returning();
    expect(legacy.purchaseId).toBeNull();
    expect((await chemicalReportCoverage([f.chemical.id], "other-warehouse"))[f.chemical.id]).toEqual({ purchaseCount: 0, missingPurchaseCount: 0, reportCount: 1 });
    expect((await chemicalReportCoverage([f.chemical.id], f.floor.id))[f.chemical.id]).toEqual({ purchaseCount: 2, missingPurchaseCount: 2, reportCount: 1 });
    const owned = await f.create(f.first.id);
    await deleteLabReportFn({ data: { reportId: owned.id } });
    expect((await chemicalReportCoverage([f.chemical.id]))[f.chemical.id].missingPurchaseCount).toBe(2);
    await updateLabReportFn({ data: { reportId: legacy.id, ...details("edited legacy") } });
    expect((await db.query.chemicalLabReports.findFirst({ where: eq(chemicalLabReports.id, legacy.id) }))?.purchaseId).toBeNull();
    await deleteLabReportFn({ data: { reportId: legacy.id } });
    const coverage = await chemicalReportCoverage([f.chemical.id, "no-data"], "different-warehouse");
    expect(coverage[f.chemical.id]).toEqual({ purchaseCount: 0, missingPurchaseCount: 0, reportCount: 0 });
    expect(coverage["no-data"]).toEqual({ purchaseCount: 0, missingPurchaseCount: 0, reportCount: 0 });
  });

  it("rejects missing/mismatched/voided ownership and reassignment while retaining voided certificates for history", async () => {
    const f = await fixture();
    const [other] = await db.insert(chemicals).values({ name: randomUUID() }).returning();
    await expect(f.create("missing")).rejects.toThrow(/not found/);
    await expect(f.create(f.first.id, "x", other.id)).rejects.toThrow(/belong/);
    await expect(getLabReportsFn({ data: { chemicalId: other.id, purchaseId: f.first.id } })).rejects.toThrow(/belong/);
    const report = await f.create(f.first.id);
    await expect(updateLabReportFn({ data: { reportId: report.id, purchaseId: f.second.id, ...details("x") } } as never)).rejects.toThrow();
    await deletePurchaseRecordFn({ data: { id: f.first.id, reason: "Duplicate delivery" }, context: f.context } as never);
    await expect(f.create(f.first.id)).rejects.toThrow(/voided/);
    await expect(updateLabReportFn({ data: { reportId: report.id, ...details("changed") } })).rejects.toThrow(/voided/);
    await expect(deleteLabReportFn({ data: { reportId: report.id } })).rejects.toThrow(/voided/);
    expect(await getLabReportsFn({ data: { chemicalId: f.chemical.id, purchaseId: f.first.id } })).toMatchObject([{ id: report.id, purchase: { voidReason: "Duplicate delivery" } }]);
    expect((await chemicalReportCoverage([f.chemical.id]))[f.chemical.id]).toEqual({ purchaseCount: 1, missingPurchaseCount: 1, reportCount: 1 });
    const purchases = await getChemicalReportPurchasesFn({ data: { chemicalId: f.chemical.id } });
    expect(purchases).toHaveLength(2);
    expect(purchases.find(p => p.purchaseId === f.first.id)).toMatchObject({ reportCount: 1, voidedAt: expect.any(Date) });
    // The FK protects retained purchase ownership independently of ordinary app deletes.
    await expect(db.delete(purchaseRecords).where(eq(purchaseRecords.id, f.first.id))).rejects.toThrow();
  });
});
