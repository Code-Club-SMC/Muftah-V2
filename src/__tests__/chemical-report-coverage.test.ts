import { beforeEach, describe, expect, it, vi } from "vitest";
import { chemicalReportCoverage } from "@/lib/inventory/chemical-report-coverage.server";

const mocks = vi.hoisted(() => ({ queries: [] as { table: string; sql: string; params: unknown[] }[] }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(async (sql, params) => {
    const table = sql.includes('from "purchase_records"') ? "purchase_records" : "chemical_lab_reports";
    mocks.queries.push({ table, sql, params });
    return { rows: table === "purchase_records" ? [["c", 2, 1]] : [["c", 4]] };
  }) };
});
beforeEach(() => { mocks.queries.length = 0; });
describe("batched chemical certificate coverage", () => {
  it("keeps active purchase coverage separate from total certificates, including legacy, and zero-fills", async () => {
    expect(await chemicalReportCoverage(["c", "empty", "c"], "floor")).toEqual({ c: { purchaseCount: 2, missingPurchaseCount: 1, reportCount: 4 }, empty: { purchaseCount: 0, missingPurchaseCount: 0, reportCount: 0 } });
    expect(mocks.queries).toHaveLength(2);
    const purchase = mocks.queries.find(q => q.table === "purchase_records")!;
    expect(purchase.sql).toContain('"voided_at" is null');
    expect(purchase.sql.toLowerCase()).toContain("not exists");
    expect(purchase.sql).toContain('"chemical_lab_reports"."purchase_id"');
    expect(purchase.sql).toContain('"chemical_lab_reports"."purchase_id" = "purchase_records"."id"');
    expect(purchase.sql.toLowerCase()).not.toContain(" join ");
    expect(purchase.params).toContain("floor");
    expect(mocks.queries.find(q => q.table === "chemical_lab_reports")?.params).not.toContain("floor");
  });
  it("does no queries for an empty batch", async () => {
    expect(await chemicalReportCoverage([])).toEqual({});
    expect(mocks.queries).toEqual([]);
  });
});
