import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateNextCreditNoteNumber,
  applyCustomerCreditToPayment,
  DbOrTx,
  formatVoidBlockedByRefundError,
  getCustomerCreditSummary,
  issueCustomerCreditFromReturn,
  issueCustomerRefund,
  issuePaymentOverageCredit,
  parseVoidBlockedByRefundError,
  reclaimInvoiceReturnCreditForPaymentReversal,
  reclaimPaymentOverageCredit,
  restoreCustomerCreditForReversedPayment,
  reverseCustomerRefund,
  selectFifoAllocations,
  VOID_BLOCKED_BY_REFUND,
  voidReturnCreditSettlement,
} from "./customer-credit-service";

const serviceSource = readFileSync(
  resolve(process.cwd(), "src/server-functions/sales/customer-credit-service.ts"),
  "utf8",
);

describe("customer-credit-service pure FIFO & void error mechanics", () => {
  it("allocates requested amount deterministically across active lots in FIFO order", () => {
    const plan = selectFifoAllocations(2500, [
      { id: "lot-1", remainingAmount: "1000.00", createdAt: new Date("2026-10-01") },
      { id: "lot-2", remainingAmount: "2000.00", createdAt: new Date("2026-10-02") },
      { id: "lot-3", remainingAmount: "500.00", createdAt: new Date("2026-10-03") },
    ]);
    expect(plan).toEqual([
      { lotId: "lot-1", amount: 1000 },
      { lotId: "lot-2", amount: 1500 },
    ]);
  });

  it("throws when FIFO lots hold less than requested amount", () => {
    expect(() =>
      selectFifoAllocations(1200, [
        { id: "lot-1", remainingAmount: "1000.00", createdAt: new Date("2026-10-01") },
      ]),
    ).toThrow(/exceeds available store credit/i);
  });

  it("formats and parses VOID_BLOCKED_BY_REFUND with customer routing metadata", () => {
    const err = formatVoidBlockedByRefundError({
      refundedAmount: 1500,
      customerId: "cust-123",
      customerName: "Ahmed Traders",
      customerType: "distributor",
    });
    expect(err.message).toContain(VOID_BLOCKED_BY_REFUND);
    expect(parseVoidBlockedByRefundError(err)).toEqual({
      refundedAmount: 1500,
      customerId: "cust-123",
      customerName: "Ahmed Traders",
      customerType: "distributor",
      displayMessage:
        "Rs 1,500 of this return's credit was already refunded. Reverse the refund on Ahmed Traders's page before voiding.",
    });
  });

  it("handles zero credit balance cleanly", () => {
    expect(selectFifoAllocations(0, [])).toEqual([]);
  });

  it("throws on negative requested amount", () => {
    expect(() => selectFifoAllocations(-100, [])).toThrow(/negative/i);
  });

  it("returns null for non-error or non-matching error messages in parseVoidBlockedByRefundError", () => {
    expect(parseVoidBlockedByRefundError(null)).toBeNull();
    expect(parseVoidBlockedByRefundError(new Error("Random error"))).toBeNull();
    expect(parseVoidBlockedByRefundError(new Error("VOID_BLOCKED_BY_REFUND:bad_json:msg"))).toBeNull();
  });
});

describe("customer-credit-service source architecture invariants", () => {
  it("strictly avoids runtime import of @/db (type-only import)", () => {
    expect(serviceSource).toMatch(/import\s+type\s+\{[^}]*db[^}]*\}\s+from\s+["']@\/db["']/);
    const nonTypeDbImport = serviceSource
      .split("\n")
      .filter((line) => line.includes('@/db"') || line.includes("@/db'"))
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => !line.includes("import type"));
    expect(nonTypeDbImport).toEqual([]);
  });

  it("uses row-level locking with .for('update')", () => {
    expect(serviceSource).toContain('.for("update")');
  });

  it("implements Ruling P2 (application_reversed movement on surplusReturned)", () => {
    expect(serviceSource).toContain('type: "application_reversed"');
    expect(serviceSource).toContain("surplusReturned");
  });

  it("implements Ruling P4 (exposes lots with status active/depleted/voided, type & movementType, creditNotes)", () => {
    expect(serviceSource).toContain("activeLotCount");
    expect(serviceSource).toContain("movementType: m.type");
    expect(serviceSource).toContain("creditNotes:");
  });
});

// Robust in-memory mock database helper
function evaluateCondition(sqlObj: any, row: any): boolean {
  if (!sqlObj) return true;
  const chunks = sqlObj.queryChunks;
  if (!chunks) return true;

  if (chunks.length === 3 && chunks[0].value?.[0] === "(" && chunks[2].value?.[0] === ")") {
    return evaluateCondition(chunks[1], row);
  }

  if (chunks.some((c: any) => c.value?.[0] === " and ")) {
    const subSqls = chunks.filter((c: any) => c.queryChunks);
    return subSqls.every((s: any) => evaluateCondition(s, row));
  }

  if (chunks.some((c: any) => c.value?.[0]?.includes("is not null"))) {
    const col = chunks.find((c: any) => c && c.table && c.name);
    if (col) {
      const camel = col.name.replace(/_([a-z])/g, (_: any, g: string) => g.toUpperCase());
      const val = row[camel] !== undefined ? row[camel] : row[col.name];
      return val !== null && val !== undefined;
    }
  }

  if (chunks.some((c: any) => c.value?.[0]?.includes("<> 'voided'"))) {
    const col = chunks.find((c: any) => c && c.table && c.name);
    if (col) {
      const camel = col.name.replace(/_([a-z])/g, (_: any, g: string) => g.toUpperCase());
      const val = row[camel] !== undefined ? row[camel] : row[col.name];
      return String(val) !== "voided";
    }
  }

  const col = chunks.find((c: any) => c && c.table && c.name);
  if (!col) return true;
  const camel = col.name.replace(/_([a-z])/g, (_: any, g: string) => g.toUpperCase());
  const val = row[camel] !== undefined ? row[camel] : row[col.name];

  const isNullChunk = chunks.find((c: any) => c.value?.[0]?.includes("is null"));
  if (isNullChunk) {
    return val === null || val === undefined;
  }

  const inChunk = chunks.find((c: any) => c.value?.[0]?.includes("in"));
  if (inChunk) {
    const arr = chunks.find((c: any) => Array.isArray(c));
    if (arr) {
      const allowed = arr.map((p: any) => (p.value !== undefined ? p.value : p)).map(String);
      return allowed.includes(String(val));
    }
  }

  const strChunk = chunks.find((c: any) =>
    c.value && ["=", ">"].some((op) => c.value[0].includes(op)),
  );
  const opStr = strChunk ? strChunk.value[0].trim() : "=";
  const param = chunks.find((c: any) => c.constructor?.name === "Param");

  if (opStr === "=") {
    return String(val) === String(param?.value);
  }
  if (opStr === ">") {
    return Number(val) > Number(param?.value);
  }

  return true;
}

function parseOrderBy(orders: any[]) {
  return (a: any, b: any) => {
    for (const order of orders) {
      if (!order?.queryChunks) continue;
      const col = order.queryChunks.find((c: any) => c?.table && c?.name);
      if (!col) continue;
      const camel = col.name.replace(/_([a-z])/g, (_: any, g: string) => g.toUpperCase());
      const valA = a[camel] !== undefined ? a[camel] : a[col.name];
      const valB = b[camel] !== undefined ? b[camel] : b[col.name];
      const isDesc = order.queryChunks.some((c: any) => c?.value?.[0]?.includes("desc"));
      let cmp = 0;
      if (valA instanceof Date && valB instanceof Date) {
        cmp = valA.getTime() - valB.getTime();
      } else if (typeof valA === "number" && typeof valB === "number") {
        cmp = valA - valB;
      } else {
        cmp = String(valA ?? "").localeCompare(String(valB ?? ""));
      }
      if (cmp !== 0) return isDesc ? -cmp : cmp;
    }
    return 0;
  };
}

function createMockDb() {
  const state: Record<string, any[]> = {
    credit_note_counters: [],
    customers: [],
    customer_credit_lots: [],
    customer_credit_movements: [],
    customer_credit_payment_allocations: [],
    customer_refunds: [],
    customer_refund_allocations: [],
    wallets: [],
    transactions: [],
    invoices: [],
    sales_returns: [],
    payments: [],
    slip_records: [],
  };

  const getTableName = (tableDef: any) =>
    tableDef[Symbol.for("drizzle:Name")] || tableDef._?.name;

  const mockTx: DbOrTx = {
    select: (_fields?: any) => {
      let selectedTable: string | null = null;
      let filterCondition: any = null;
      let orderBys: any[] = [];
      let limitCount: number | null = null;

      const chain = {
        from: (tableDef: any) => {
          selectedTable = getTableName(tableDef);
          return chain;
        },
        where: (condition: any) => {
          filterCondition = condition;
          return chain;
        },
        orderBy: (...orders: any[]) => {
          orderBys = orders;
          return chain;
        },
        limit: (n: number) => {
          limitCount = n;
          return chain;
        },
        for: (_mode: string) => chain,
        then: (onfulfilled: any) => {
          const tableData = state[selectedTable!] ?? [];
          let res = filterCondition
            ? tableData.filter((row) => evaluateCondition(filterCondition, row))
            : [...tableData];
          if (orderBys.length > 0) {
            res.sort(parseOrderBy(orderBys));
          }
          if (limitCount != null) {
            res = res.slice(0, limitCount);
          }
          return Promise.resolve(res).then(onfulfilled);
        },
      };
      return chain as any;
    },
    insert: (tableDef: any) => {
      const tableName = getTableName(tableDef);
      const chain = {
        values: (valOrVals: any) => {
          const vals = Array.isArray(valOrVals) ? valOrVals : [valOrVals];
          const chainConflict = {
            onConflictDoNothing: () => chainConflict,
            then: (onfulfilled: any) => {
              const table = state[tableName];
              for (const v of vals) {
                if (tableName === "credit_note_counters") {
                  if (!table.some((x) => x.id === v.id)) {
                    table.push({ ...v });
                  }
                } else {
                  table.push({ ...v, createdAt: v.createdAt ?? new Date() });
                }
              }
              return Promise.resolve().then(onfulfilled);
            },
          };
          return chainConflict;
        },
      };
      return chain as any;
    },
    update: (tableDef: any) => {
      const tableName = getTableName(tableDef);
      let updateValues: any = {};
      const chain = {
        set: (vals: any) => {
          updateValues = vals;
          return chain;
        },
        where: (condition: any) => {
          return {
            then: (onfulfilled: any) => {
              const table = state[tableName] ?? [];
              for (const row of table) {
                if (!condition || evaluateCondition(condition, row)) {
                  Object.assign(row, updateValues);
                }
              }
              return Promise.resolve().then(onfulfilled);
            },
          };
        },
      };
      return chain as any;
    },
    query: {
      customers: {
        findFirst: async (opts: any) => {
          return state.customers.find((c) => !opts?.where || evaluateCondition(opts.where, c));
        },
      },
      wallets: {
        findFirst: async (opts: any) => {
          return state.wallets.find((w) => !opts?.where || evaluateCondition(opts.where, w));
        },
      },
      salesReturns: {
        findFirst: async (opts: any) => {
          return state.sales_returns.find((r) => !opts?.where || evaluateCondition(opts.where, r));
        },
        findMany: async (opts: any) => {
          return state.sales_returns.filter((r) => !opts?.where || evaluateCondition(opts.where, r));
        },
      },
      invoices: {
        findFirst: async (opts: any) => {
          return state.invoices.find((i) => !opts?.where || evaluateCondition(opts.where, i));
        },
        findMany: async (opts: any) => {
          return state.invoices.filter((i) => !opts?.where || evaluateCondition(opts.where, i));
        },
      },
      customerCreditLots: {
        findMany: async (opts: any) => {
          return state.customer_credit_lots.filter((l) => !opts?.where || evaluateCondition(opts.where, l));
        },
      },
      customerCreditMovements: {
        findMany: async (opts: any) => {
          return state.customer_credit_movements
            .filter((m) => !opts?.where || evaluateCondition(opts.where, m))
            .map((m) => ({
              ...m,
              wallet: state.wallets.find((w) => w.id === m.walletId),
              invoice: state.invoices.find((i) => i.id === m.invoiceId),
              salesReturn: state.sales_returns.find((r) => r.id === m.salesReturnId),
              refund: state.customer_refunds.find((rf) => rf.id === m.refundId),
              performedBy: { id: m.performedById, name: "User" },
            }));
        },
      },
      customerRefunds: {
        findMany: async (opts: any) => {
          return state.customer_refunds
            .filter((r) => !opts?.where || evaluateCondition(opts.where, r))
            .map((r) => ({
              ...r,
              wallet: state.wallets.find((w) => w.id === r.walletId),
              issuedBy: { id: r.issuedById, name: "User" },
              reversedBy: r.reversedById ? { id: r.reversedById, name: "User" } : null,
            }));
        },
      },
    } as any,
  };

  return { state, mockTx };
}

describe("customer-credit-service transactional accounting engine", () => {
  it("allocateNextCreditNoteNumber increments sequentially starting from 1", async () => {
    const { state, mockTx } = createMockDb();
    const cn1 = await allocateNextCreditNoteNumber(mockTx);
    expect(cn1).toBe("CN-0001");
    expect(state.credit_note_counters[0].lastNumber).toBe(1);

    const cn2 = await allocateNextCreditNoteNumber(mockTx);
    expect(cn2).toBe("CN-0002");
    expect(state.credit_note_counters[0].lastNumber).toBe(2);
  });

  it("issueCustomerCreditFromReturn creates lot, movement, and increments customer balance", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "500.00",
      outstandingAmount: "1000.00",
    });

    const res = await issueCustomerCreditFromReturn(mockTx, {
      customerId: "cust-1",
      salesReturnId: "ret-1",
      sourceInvoiceId: "inv-1",
      creditNoteNumber: "CN-0001",
      amount: 1500,
      performedById: "user-1",
    });

    expect(res.balanceAfter).toBe(2000);
    expect(state.customers[0].creditBalance).toBe("2000.00");
    expect(state.customer_credit_lots).toHaveLength(1);
    expect(state.customer_credit_lots[0]).toMatchObject({
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      originalAmount: "1500.00",
      remainingAmount: "1500.00",
      appliedAmount: "0.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
    });
    expect(state.customer_credit_movements).toHaveLength(1);
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "issued",
      amount: "1500.00",
      signedDelta: "1500.00",
      balanceAfter: "2000.00",
    });
  });

  it("issuePaymentOverageCredit creates lot with sourceType payment_overage", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "0.00",
      outstandingAmount: "0.00",
    });

    const res = await issuePaymentOverageCredit(mockTx, {
      customerId: "cust-1",
      sourceInvoiceId: "inv-1",
      sourcePaymentId: "pay-1",
      amount: 750,
      performedById: "user-1",
    });

    expect(res.balanceAfter).toBe(750);
    expect(state.customer_credit_lots[0].sourceType).toBe("payment_overage");
    expect(state.customer_credit_lots[0].sourcePaymentId).toBe("pay-1");
  });

  it("applyCustomerCreditToPayment allocates FIFO, creates allocations and movements, and updates balance", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "2500.00",
      outstandingAmount: "3000.00",
    });
    state.customer_credit_lots.push(
      {
        id: "lot-1",
        customerId: "cust-1",
        sourceType: "sales_return",
        sourceReturnId: "ret-1",
        sourceInvoiceId: "inv-old",
        sourcePaymentId: null,
        creditNoteNumber: "CN-0001",
        originalAmount: "1000.00",
        remainingAmount: "1000.00",
        appliedAmount: "0.00",
        refundedAmount: "0.00",
        reclaimedAmount: "0.00",
        createdAt: new Date("2026-10-01"),
        voidedAt: null,
      },
      {
        id: "lot-2",
        customerId: "cust-1",
        sourceType: "sales_return",
        sourceReturnId: "ret-2",
        sourceInvoiceId: "inv-old",
        sourcePaymentId: null,
        creditNoteNumber: "CN-0002",
        originalAmount: "1500.00",
        remainingAmount: "1500.00",
        appliedAmount: "0.00",
        refundedAmount: "0.00",
        reclaimedAmount: "0.00",
        createdAt: new Date("2026-10-02"),
        voidedAt: null,
      },
    );

    const res = await applyCustomerCreditToPayment(mockTx, {
      customerId: "cust-1",
      paymentId: "pay-new",
      invoiceId: "inv-new",
      amount: 1800,
      performedById: "user-1",
    });

    expect(res.balanceAfter).toBe(700);
    expect(state.customers[0].creditBalance).toBe("700.00");
    // Lot 1 fully consumed
    expect(state.customer_credit_lots[0].remainingAmount).toBe("0.00");
    expect(state.customer_credit_lots[0].appliedAmount).toBe("1000.00");
    // Lot 2 partially consumed
    expect(state.customer_credit_lots[1].remainingAmount).toBe("700.00");
    expect(state.customer_credit_lots[1].appliedAmount).toBe("800.00");

    expect(state.customer_credit_payment_allocations).toHaveLength(2);
    expect(state.customer_credit_payment_allocations[0]).toMatchObject({
      creditLotId: "lot-1",
      amount: "1000.00",
      status: "active",
    });
    expect(state.customer_credit_payment_allocations[1]).toMatchObject({
      creditLotId: "lot-2",
      amount: "800.00",
      status: "active",
    });

    expect(state.customer_credit_movements).toHaveLength(2);
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "applied",
      amount: "1000.00",
      signedDelta: "-1000.00",
      balanceAfter: "1500.00",
    });
    expect(state.customer_credit_movements[1]).toMatchObject({
      type: "applied",
      amount: "800.00",
      signedDelta: "-800.00",
      balanceAfter: "700.00",
    });
  });

  it("restoreCustomerCreditForReversedPayment reverses allocations and restores lot balances", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "700.00",
      outstandingAmount: "3000.00",
    });
    state.customer_credit_lots.push({
      id: "lot-1",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-old",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "1000.00",
      remainingAmount: "0.00",
      appliedAmount: "1000.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
      createdAt: new Date("2026-10-01"),
      voidedAt: null,
    });
    state.customer_credit_payment_allocations.push({
      id: "alloc-1",
      paymentId: "pay-1",
      creditLotId: "lot-1",
      amount: "1000.00",
      status: "active",
      createdAt: new Date(),
      reversedAt: null,
    });

    await restoreCustomerCreditForReversedPayment(mockTx, {
      customerId: "cust-1",
      paymentId: "pay-1",
      invoiceId: "inv-1",
      performedById: "user-1",
      reason: "Cheque bounced",
    });

    expect(state.customers[0].creditBalance).toBe("1700.00");
    expect(state.customer_credit_lots[0].remainingAmount).toBe("1000.00");
    expect(state.customer_credit_lots[0].appliedAmount).toBe("0.00");
    expect(state.customer_credit_payment_allocations[0].status).toBe("reversed");
    expect(state.customer_credit_movements).toHaveLength(1);
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "application_reversed",
      amount: "1000.00",
      signedDelta: "1000.00",
      balanceAfter: "1700.00",
    });
  });

  it("issueCustomerRefund checks wallet balance and creates refund + wallet transaction", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "1500.00",
      outstandingAmount: "0.00",
    });
    state.wallets.push({
      id: "w-1",
      name: "Main Cash",
      balance: "5000.00",
      type: "cash",
    });
    state.customer_credit_lots.push({
      id: "lot-1",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-1",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "1500.00",
      remainingAmount: "1500.00",
      appliedAmount: "0.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });

    const res = await issueCustomerRefund(mockTx, {
      customerId: "cust-1",
      amount: 1000,
      walletId: "w-1",
      refundDate: new Date("2026-11-01"),
      performedById: "user-1",
      permissions: ["finance.manage"],
    });

    expect(res.balanceAfter).toBe(500);
    expect(state.wallets[0].balance).toBe("4000.00");
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({
      walletId: "w-1",
      type: "debit",
      amount: "1000.00",
      source: "Customer Refund",
    });
    expect(state.customer_refunds).toHaveLength(1);
    expect(state.customer_refunds[0]).toMatchObject({
      amount: "1000.00",
      status: "active",
    });
    expect(state.customer_credit_movements).toHaveLength(1);
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "refunded",
      amount: "1000.00",
      signedDelta: "-1000.00",
      balanceAfter: "500.00",
    });
  });

  it("issueCustomerRefund rejects overdraw when user lacks finance.manage or allowOverdraw is false", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "1500.00",
      outstandingAmount: "0.00",
    });
    state.wallets.push({
      id: "w-1",
      name: "Petty Cash",
      balance: "200.00",
      type: "cash",
    });
    state.customer_credit_lots.push({
      id: "lot-1",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-1",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "1500.00",
      remainingAmount: "1500.00",
      appliedAmount: "0.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });

    await expect(
      issueCustomerRefund(mockTx, {
        customerId: "cust-1",
        amount: 500,
        walletId: "w-1",
        refundDate: new Date(),
        performedById: "user-1",
        permissions: ["sales.manage"],
      }),
    ).rejects.toThrow(/only has Rs 200/i);

    await expect(
      issueCustomerRefund(mockTx, {
        customerId: "cust-1",
        amount: 500,
        walletId: "w-1",
        refundDate: new Date(),
        performedById: "user-1",
        permissions: ["finance.manage"],
        allowOverdraw: false,
      }),
    ).rejects.toThrow(/OVERDRAW_CONFIRM_REQUIRED/i);
  });

  it("reverseCustomerRefund credits wallet and restores lot balance", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "500.00",
      outstandingAmount: "0.00",
    });
    state.wallets.push({
      id: "w-1",
      name: "Main Cash",
      balance: "4000.00",
      type: "cash",
    });
    state.customer_credit_lots.push({
      id: "lot-1",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-1",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "1500.00",
      remainingAmount: "500.00",
      appliedAmount: "0.00",
      refundedAmount: "1000.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });
    state.customer_refunds.push({
      id: "ref-1",
      customerId: "cust-1",
      salesReturnId: "ret-1",
      creditNoteNumber: "CN-0001",
      walletId: "w-1",
      walletTransactionId: "tx-orig",
      amount: "1000.00",
      refundDate: new Date(),
      notes: "Cash refund",
      status: "active",
      issuedById: "user-1",
      createdAt: new Date(),
      reversedById: null,
      reversedAt: null,
      reverseReason: null,
      reversalTransactionId: null,
    });
    state.customer_refund_allocations.push({
      id: "ralloc-1",
      refundId: "ref-1",
      creditLotId: "lot-1",
      amount: "1000.00",
      status: "active",
      createdAt: new Date(),
      reversedAt: null,
    });

    const res = await reverseCustomerRefund(mockTx, {
      refundId: "ref-1",
      reason: "Customer refunded mistake",
      performedById: "user-2",
    });

    expect(res.balanceAfter).toBe(1500);
    expect(state.wallets[0].balance).toBe("5000.00");
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({
      walletId: "w-1",
      type: "credit",
      amount: "1000.00",
      source: "Customer Refund Reversal",
      reversalOfTransactionId: "tx-orig",
    });
    expect(state.customer_refunds[0].status).toBe("reversed");
    expect(state.customer_credit_lots[0].remainingAmount).toBe("1500.00");
    expect(state.customer_credit_lots[0].refundedAmount).toBe("0.00");
    expect(state.customer_credit_movements).toHaveLength(1);
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "refund_reversed",
      amount: "1000.00",
      signedDelta: "1000.00",
      balanceAfter: "1500.00",
    });
  });

  it("voidReturnCreditSettlement blocks void if refund exists, otherwise reclaims and marks lots voided", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "1500.00",
      outstandingAmount: "0.00",
    });
    state.customer_credit_lots.push({
      id: "lot-1",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-1",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "1500.00",
      remainingAmount: "500.00",
      appliedAmount: "0.00",
      refundedAmount: "1000.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });

    await expect(
      voidReturnCreditSettlement(mockTx, {
        salesReturnId: "ret-1",
        invoiceId: "inv-1",
        customerId: "cust-1",
        creditNoteNumber: "CN-0001",
        reason: "Cancelled return",
        performedById: "user-1",
        recalculateInvoice: async () => {},
        recordTimeline: async () => {},
      }),
    ).rejects.toThrow(/VOID_BLOCKED_BY_REFUND/);

    // If refund was reversed (refundedAmount = 0), void succeeds
    state.customer_credit_lots[0].refundedAmount = "0.00";
    state.customer_credit_lots[0].remainingAmount = "1500.00";

    await voidReturnCreditSettlement(mockTx, {
      salesReturnId: "ret-1",
      invoiceId: "inv-1",
      customerId: "cust-1",
      creditNoteNumber: "CN-0001",
      reason: "Cancelled return",
      performedById: "user-1",
      recalculateInvoice: async () => {},
      recordTimeline: async () => {},
    });

    expect(state.customers[0].creditBalance).toBe("0.00");
    expect(state.customer_credit_lots[0].remainingAmount).toBe("0.00");
    expect(state.customer_credit_lots[0].voidedAt).toBeDefined();
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "void_reclaimed",
      amount: "1500.00",
      signedDelta: "-1500.00",
      balanceAfter: "0.00",
    });
  });

  it("reclaimPaymentOverageCredit preserves ledger invariant with Ruling P2 conservation movement", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "100.00",
      outstandingAmount: "0.00",
    });
    state.customer_credit_lots.push({
      id: "lot-overage",
      customerId: "cust-1",
      sourceType: "payment_overage",
      sourceReturnId: null,
      sourceInvoiceId: "inv-source",
      sourcePaymentId: "pay-over",
      creditNoteNumber: null,
      originalAmount: "1000.00",
      remainingAmount: "100.00",
      appliedAmount: "900.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });
    state.payments.push({
      id: "pay-applied",
      customerId: "cust-1",
      invoiceId: "inv-other",
      amount: "900.00",
      method: "customer_credit",
      status: "confirmed",
      walletId: null,
      recordedById: "user-1",
      paymentDate: new Date(),
      effectiveDate: new Date(),
    });
    state.customer_credit_payment_allocations.push({
      id: "alloc-overage",
      paymentId: "pay-applied",
      creditLotId: "lot-overage",
      amount: "900.00",
      status: "active",
      createdAt: new Date(),
      reversedAt: null,
    });
    state.invoices.push({
      id: "inv-other",
      invoiceNumber: "INV-OTHER",
      customerId: "cust-1",
      totalPrice: "900.00",
      paidAmount: "900.00",
      returnedAmount: "0.00",
      excessCreditedAmount: "0.00",
      outstandingAmount: "0.00",
      status: "active",
      paymentStatus: "paid",
    });

    await reclaimPaymentOverageCredit(mockTx, {
      invoiceId: "inv-source",
      customerId: "cust-1",
      reclaimAmount: 400,
      reason: "Payment reversed",
      performedById: "user-1",
      allowUnapplyApplied: true,
      recalculateInvoice: async () => {},
      recordTimeline: async () => {},
    });

    expect(state.customers[0].creditBalance).toBe("600.00");

    const reversedMov = state.customer_credit_movements.find(
      (m) => m.type === "application_reversed",
    );
    expect(reversedMov).toBeDefined();
    expect(reversedMov?.amount).toBe("600.00");
    expect(reversedMov?.signedDelta).toBe("600.00");
    expect(reversedMov?.balanceAfter).toBe("600.00");

    const movementsSum = state.customer_credit_movements.reduce(
      (sum, m) => sum + Number(m.signedDelta),
      0,
    );
    expect(movementsSum).toBe(500);
  });

  it("reclaimInvoiceReturnCreditForPaymentReversal pulls return credit generated by invoice returns", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Retailer A",
      customerType: "retailer",
      creditBalance: "800.00",
      outstandingAmount: "0.00",
    });
    state.customer_credit_lots.push({
      id: "lot-ret",
      customerId: "cust-1",
      sourceType: "sales_return",
      sourceReturnId: "ret-1",
      sourceInvoiceId: "inv-source",
      sourcePaymentId: null,
      creditNoteNumber: "CN-0001",
      originalAmount: "800.00",
      remainingAmount: "800.00",
      appliedAmount: "0.00",
      refundedAmount: "0.00",
      reclaimedAmount: "0.00",
      createdAt: new Date(),
      voidedAt: null,
    });
    state.sales_returns.push({
      id: "ret-1",
      customerId: "cust-1",
      invoiceId: "inv-source",
      returnNumber: 1,
      creditNoteNumber: "CN-0001",
      creditNoteIssuedAt: new Date(),
      status: "completed",
      totalAmount: "1000.00",
      appliedToInvoiceAmount: "200.00",
      customerCreditAmount: "800.00",
      createdAt: new Date(),
      completedAt: new Date(),
    });

    await reclaimInvoiceReturnCreditForPaymentReversal(mockTx, {
      invoiceId: "inv-source",
      customerId: "cust-1",
      reopenNeeded: 500,
      performedById: "user-1",
    });

    expect(state.customers[0].creditBalance).toBe("300.00");
    expect(state.customer_credit_lots[0].remainingAmount).toBe("300.00");
    expect(state.customer_credit_lots[0].reclaimedAmount).toBe("500.00");
    expect(state.sales_returns[0].appliedToInvoiceAmount).toBe("700.00");
    expect(state.sales_returns[0].customerCreditAmount).toBe("300.00");
    expect(state.customer_credit_movements[0]).toMatchObject({
      type: "void_reclaimed",
      amount: "500.00",
      signedDelta: "-500.00",
      balanceAfter: "300.00",
    });
  });

  it("getCustomerCreditSummary returns balance, activeLotCount, lots, movements with type & movementType, refunds, creditNotes", async () => {
    const { state, mockTx } = createMockDb();
    state.customers.push({
      id: "cust-1",
      name: "Ahmed Traders",
      customerType: "distributor",
      creditBalance: "1200.00",
      outstandingAmount: "3000.00",
    });
    state.customer_credit_lots.push(
      {
        id: "lot-1",
        customerId: "cust-1",
        sourceType: "sales_return",
        sourceReturnId: "ret-1",
        sourceInvoiceId: "inv-1",
        sourcePaymentId: null,
        creditNoteNumber: "CN-0001",
        originalAmount: "1000.00",
        remainingAmount: "1000.00",
        appliedAmount: "0.00",
        refundedAmount: "0.00",
        reclaimedAmount: "0.00",
        createdAt: new Date("2026-10-01"),
        voidedAt: null,
      },
      {
        id: "lot-2",
        customerId: "cust-1",
        sourceType: "sales_return",
        sourceReturnId: "ret-2",
        sourceInvoiceId: "inv-1",
        sourcePaymentId: null,
        creditNoteNumber: "CN-0002",
        originalAmount: "500.00",
        remainingAmount: "0.00",
        appliedAmount: "500.00",
        refundedAmount: "0.00",
        reclaimedAmount: "0.00",
        createdAt: new Date("2026-10-02"),
        voidedAt: null,
      },
    );
    state.sales_returns.push({
      id: "ret-1",
      customerId: "cust-1",
      invoiceId: "inv-1",
      returnNumber: 1,
      creditNoteNumber: "CN-0001",
      creditNoteIssuedAt: new Date(),
      status: "completed",
      totalAmount: "1000.00",
      appliedToInvoiceAmount: "0.00",
      customerCreditAmount: "1000.00",
      createdAt: new Date(),
      completedAt: new Date(),
    });
    state.customer_credit_movements.push({
      id: "mov-1",
      customerId: "cust-1",
      creditLotId: "lot-1",
      type: "issued",
      amount: "1000.00",
      signedDelta: "1000.00",
      balanceAfter: "1000.00",
      performedById: "user-1",
      createdAt: new Date(),
    });

    const summary = await getCustomerCreditSummary(mockTx, "cust-1");

    expect(summary.customerId).toBe("cust-1");
    expect(summary.customerName).toBe("Ahmed Traders");
    expect(summary.customerType).toBe("distributor");
    expect(summary.balance).toBe(1200);
    expect(summary.creditBalance).toBe(1200);
    expect(summary.activeLotCount).toBe(1);
    expect(summary.lots).toHaveLength(2);
    expect(summary.lots[0].status).toBe("active");
    expect(summary.lots[1].status).toBe("depleted");
    expect(summary.creditNotes).toHaveLength(1);
    expect(summary.creditNotes[0].creditNoteNumber).toBe("CN-0001");
    expect(summary.movements).toHaveLength(1);
    expect(summary.movements[0].type).toBe("issued");
    expect(summary.movements[0].movementType).toBe("issued");
  });
});
