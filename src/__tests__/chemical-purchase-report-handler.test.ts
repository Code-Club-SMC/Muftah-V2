import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLabReportFn } from "@/server-functions/inventory/lab-reports/create-lab-report-fn";
import { updateLabReportFn } from "@/server-functions/inventory/lab-reports/update-lab-report-fn";
import { deleteLabReportFn } from "@/server-functions/inventory/lab-reports/delete-lab-report-fn";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/middlewares", () => ({ requireInventoryManageMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse(data: unknown): unknown };
  const b = { middleware: () => b, inputValidator: (schema: typeof validator) => { validator = schema; return b; },
    handler: (fn: (input: unknown) => unknown) => (input: { data: unknown }) => Promise.resolve().then(() => fn({ ...input, data: validator.parse(input.data) })) };
  return b;
} }));
type Report = { id: string; chemicalId: string; purchaseId: string | null; analysisItems?: unknown; [key: string]: unknown };
let reports: Report[];
let purchases: { id: string; chemicalId: string; materialType: string; voidedAt: Date | null }[];
let events: string[];
const details = { productName: "Soda", certifiedBy: "Lab technician", reportDate: "2026-11-06", analysisItems: [{ item: "pH", requirement: "Recorded by lab", result: "8.1", passed: false }] };
const context = { session: { user: { id: "actor" } } };
const create = (extra = {}) => createLabReportFn({ data: { chemicalId: "c", purchaseId: "p1", ...details, ...extra }, context } as never);
const update = (extra = {}) => updateLabReportFn({ data: { reportId: "r", ...details, ...extra } } as never);
const remove = () => deleteLabReportFn({ data: { reportId: "r" } });
function transaction() {
  const find = (rows: { id: string }[], where: never) => rows.find(row => row.id === new PgDialect().sqlToQuery(where).params[0]);
  return {
    query: { chemicalLabReports: { findFirst: async ({ where }: { where: never }) => { events.push("read-report"); return find(reports, where); } } },
    select: () => {
      let table = ""; let where: never;
      const b = { from: (t: Parameters<typeof getTableName>[0]) => { table = getTableName(t); return b; }, where: (value: never) => { where = value; return b; },
        for: () => { events.push(`lock:${table}`); return b; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve([find(table === "purchase_records" ? purchases : reports, where)].filter(Boolean)).then(resolve) };
      return b;
    },
    insert: () => ({ values: (values: Omit<Report, "id">) => ({ returning: async () => { events.push("write-report"); const report = { ...values, id: `r${reports.length}` } as Report; reports.push(report); return [report]; } }) }),
    update: () => ({ set: (values: object) => ({ where: (where: never) => ({ returning: async () => { events.push("write-report"); const report = find(reports, where)!; Object.assign(report, values); return [report]; } }) }) }),
    delete: () => ({ where: async (where: never) => { events.push("write-report"); reports = reports.filter(r => r !== find(reports, where)); } }),
  };
}
beforeEach(() => {
  events = []; reports = [{ id: "r", chemicalId: "c", purchaseId: "p1" }];
  purchases = [{ id: "p1", chemicalId: "c", materialType: "chemical", voidedAt: null }, { id: "p2", chemicalId: "c", materialType: "chemical", voidedAt: null }];
  mocks.transaction.mockReset().mockImplementation(async fn => fn(transaction()));
});
describe("purchase-owned certificate writes", () => {
  it("requires purchase ownership and stores each certificate's supplied results independently", async () => {
    await expect(create({ purchaseId: undefined })).rejects.toThrow();
    const first = await create();
    const second = await create({ purchaseId: "p2", analysisItems: [{ ...details.analysisItems[0], result: "9.2", passed: true }] });
    expect(first).toMatchObject({ purchaseId: "p1", analysisItems: [{ result: "8.1", passed: false }] });
    expect(second).toMatchObject({ purchaseId: "p2", analysisItems: [{ result: "9.2", passed: true }] });
    expect(events.indexOf("lock:purchase_records")).toBeLessThan(events.indexOf("write-report"));
  });
  it.each(["missing", "mismatch", "packaging", "voided"])("refuses %s purchase on creation", async kind => {
    if (kind === "missing") purchases = [];
    if (kind === "mismatch") purchases[0].chemicalId = "another";
    if (kind === "packaging") purchases[0].materialType = "packaging";
    if (kind === "voided") purchases[0].voidedAt = new Date();
    await expect(create()).rejects.toThrow(/purchase/i);
    expect(events).not.toContain("write-report");
  });
  it.each(["update", "delete"])("locks the purchase before re-reading or writing the report on %s", async action => {
    await (action === "update" ? update() : remove());
    expect(events.indexOf("lock:purchase_records")).toBeLessThan(events.indexOf("lock:chemical_lab_reports"));
    expect(events.indexOf("lock:chemical_lab_reports")).toBeLessThan(events.indexOf("write-report"));
  });
  it("makes certificates on voided purchases read-only", async () => {
    purchases[0].voidedAt = new Date();
    await expect(update()).rejects.toThrow(/voided/i);
    await expect(remove()).rejects.toThrow(/voided/i);
    expect(events).not.toContain("write-report");
  });
  it("allows legacy edits/deletes but rejects ownership or chemical reassignment", async () => {
    reports[0].purchaseId = null;
    await expect(update({ purchaseId: "p2" })).rejects.toThrow();
    await expect(update({ chemicalId: "different" })).rejects.toThrow();
    await update();
    expect(reports[0].purchaseId).toBeNull();
    await remove();
    expect(reports).toEqual([]);
    expect(events).not.toContain("lock:purchase_records");
  });
  it("refuses edits/deletes of a missing certificate", async () => {
    reports = [];
    await expect(update()).rejects.toThrow(/not found/i);
    await expect(remove()).rejects.toThrow(/not found/i);
  });
});
