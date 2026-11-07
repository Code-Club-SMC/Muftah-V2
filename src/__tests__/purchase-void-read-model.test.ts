import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { withStockLeft } from "@/lib/suppliers/purchase-rows.server";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";

const mocks = vi.hoisted(() => ({ queries: [] as string[], suppliers: vi.fn() }));
vi.mock("@/lib/middlewares", () => ({ requireSuppliersViewMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: () => builder, handler: (fn: () => unknown) => fn };
  return builder;
} }));
vi.mock("@/db", () => ({ db: {
  query: { suppliers: { findMany: mocks.suppliers }, supplierPayments: { findMany: async () => [] } },
  select: () => {
    const b = { from: () => b, leftJoin: () => b, groupBy: () => b,
      where: (where: never) => { mocks.queries.push(new PgDialect().sqlToQuery(where).sql); return b; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve) };
    return b;
  },
} }));
describe("void-aware read models", () => {
  it("excludes voided purchases from supplier active totals, not from returned history", async () => {
    mocks.suppliers.mockResolvedValue([{ purchases: [{ cost: "100", paidAmount: "40", voidedAt: null }, { cost: "9000", paidAmount: "7000", voidedAt: new Date() }] }]);
    expect(await getSuppliersFn()).toMatchObject([{ totalPurchases: 100, totalPayments: 40, balance: 60, purchases: expect.any(Array) }]);
  });
  it("returns zero stock for retained voids and filters every lot/legacy attribution query", async () => {
    mocks.queries.length = 0;
    const base = { quantity: "100", chemicalId: "c", packagingMaterialId: null, voidedAt: new Date() };
    const rows = await withStockLeft([{ ...base, id: "lot", lotId: "l" }, { ...base, id: "legacy", lotId: null },
      { ...base, id: "active-lot", lotId: "l", voidedAt: null }, { ...base, id: "active-legacy", lotId: null, voidedAt: null }]);
    expect(rows.slice(0, 2).map(r => r.stockLeft)).toEqual([0, 0]);
    const purchaseQueries = mocks.queries.filter(q => q.includes('"purchase_records"'));
    expect(purchaseQueries).toHaveLength(3);
    for (const query of purchaseQueries) expect(query).toContain('"purchase_records"."voided_at" is null');
  });
  it.each(["suppliers/get-supplier-details-fn.ts", "suppliers/get-supplier-paginated-outstanding-fn.ts", "reports/purchases-report-fn.ts"])("filters active accounting in %s", path => {
    expect(readFileSync(`src/server-functions/${path}`, "utf8")).toContain("isNull(purchaseRecords.voidedAt)");
  });
});
