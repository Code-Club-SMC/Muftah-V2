import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDistributorLedgerFn } from "@/server-functions/sales/ledger-fn";
import { computeChronologicalLedgerStep } from "@/lib/ledger-types";

const fixture = vi.hoisted(() => ({ returns: [] as any[] }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (input: unknown) => unknown;
  const builder = {
    middleware: () => builder,
    inputValidator: (fn: typeof validate) => { validate = fn; return builder; },
    handler: (fn: Function) => (input: { data: unknown }) => fn({ data: validate(input.data), context: {} }),
  };
  return builder;
} }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => ({}) }));
vi.mock("@/lib/middlewares", () => ({ requireSalesViewMiddleware: {} }));
vi.mock("@/db", () => ({ db: {
  insert: () => ({ values: async () => {} }),
  query: {
    customers: { findFirst: async () => ({ id: "customer", name: "Synthetic", customerType: "distributor" }), findMany: async () => [] },
    invoices: { findMany: async (query: any) => query.columns ? [{ totalPrice: "1000" }] : [] },
    payments: { findMany: async (query: any) => query.columns ? [{ amount: "100" }] : [] },
    salesReturns: { findMany: async () => fixture.returns },
    customerRefunds: { findMany: async () => [] },
    slipRecords: { findMany: async () => [] },
  },
} }));

const read = (query: Record<string, unknown> = {}): Promise<any> => (generateDistributorLedgerFn as Function)({ data: { customerId: "customer", ...query } });

describe("ledger receipt/void events", () => {
  beforeEach(() => {
    fixture.returns = [{ id: "r1", customerId: "customer", invoiceId: "invoice", invoice: { invoiceNumber: "INV-1" },
      returnNumber: 1, totalAmount: "200.00", status: "voided", reason: "Synthetic", condition: "good", notes: null,
      approvedAt: new Date("2026-02-01"), returnDate: new Date("2026-02-01"),
      completedAt: new Date("2026-03-31T23:59:59.999"), voidedAt: new Date("2026-04-01T00:00:00"),
      stockTraces: [{ kind: "receive", totalCost: "120.00" }, { kind: "void", totalCost: "-180.00" }],
    }];
  });

  it("keeps the original receipt in a statement ending before the later void", async () => {
    const result = await read({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(result.summary).toMatchObject({ openingBalance: 900, closingBalance: 700, periodReturns: 200, periodTotalProfit: -80 });
    expect(result.entries).toMatchObject([{ id: "r1:return", type: "return", eventKind: "return", amount: 200, date: fixture.returns[0].completedAt }]);
  });

  it("includes an old receipt in opening and only the opposite event in the void period", async () => {
    const result = await read({ dateFrom: "2026-04-01", dateTo: "2026-04-30" });
    expect(result.summary).toMatchObject({ openingBalance: 700, closingBalance: 900, periodReturns: -200, periodTotalProfit: 20 });
    expect(result.entries).toMatchObject([{ id: "r1:void", type: "return", eventKind: "void", amount: 200, runningBalance: 900 }]);
  });

  it("nets receipt and void in later openings and does not credit unreceived approvals", async () => {
    fixture.returns.push({ ...fixture.returns[0], id: "unreceived", status: "approved", completedAt: null, voidedAt: null });
    const result = await read({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    expect(result.summary).toMatchObject({ openingBalance: 900, closingBalance: 900, periodReturns: 0, periodTotalProfit: 0 });
    expect(result.entries).toEqual([]);
  });

  it("retains both positive magnitudes, stable IDs and separate costs through filtering, pagination and full export", async () => {
    fixture.returns[0].completedAt = new Date("2026-04-01T00:00:00Z");
    fixture.returns[0].voidedAt = new Date("2026-04-01T01:00:00Z");
    const query = { typeFilter: "return", search: "INV-1", limit: 1 };
    const first = await read(query);
    const second = await read({ ...query, page: 2 });
    const exported = await read({ ...query, includeFullEntries: true, exportType: "csv" });
    expect([first.entries[0].id, second.entries[0].id]).toEqual(["r1:return", "r1:void"]);
    expect(exported.entries.map((entry: any) => [entry.eventKind, entry.amount, entry.runningBalance])).toEqual([["return", 200, -200], ["void", 200, 0]]);
    expect(exported.summary).toMatchObject({ periodReturns: 0, periodTotalProfit: -60, closingBalance: 0 });
    expect(exported.totalEntries).toBe(2);
    expect((await read({ ...query, sortOrder: "desc", includeFullEntries: true })).entries.map((entry: any) => entry.id)).toEqual(["r1:void", "r1:return"]);
  });
});

describe("Phase 4 store credit ledger balance deltas", () => {
  it("does not double-subtract when customer_credit settles a second invoice, and recovers balance on cash refund", () => {
    let bal = 0;
    bal = computeChronologicalLedgerStep(bal, { type: "invoice", totalPrice: 10000 });
    expect(bal).toBe(10000);
    bal = computeChronologicalLedgerStep(bal, { type: "payment", method: "cash", amount: 10000 });
    expect(bal).toBe(0);
    bal = computeChronologicalLedgerStep(bal, { type: "return", eventKind: "return", amount: 4000 });
    expect(bal).toBe(-4000);
    // Applying store credit toward invoice #2 (Rs 6,000) keeps balance = -4000 + 6000 = +2000 (not -2000)
    bal = computeChronologicalLedgerStep(bal, { type: "invoice", totalPrice: 6000 });
    expect(bal).toBe(2000);
    bal = computeChronologicalLedgerStep(bal, { type: "payment", method: "customer_credit", amount: 4000 });
    expect(bal).toBe(2000);
  });

  it("moves negative balance toward zero on cash refund and back down on refund reversal", () => {
    let bal = -4000;
    bal = computeChronologicalLedgerStep(bal, { type: "refund", eventKind: "refund", amount: 4000 });
    expect(bal).toBe(0);
    bal = computeChronologicalLedgerStep(bal, { type: "refund", eventKind: "refund_reversal", amount: 4000 });
    expect(bal).toBe(-4000);
  });
});

