import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateOrderBookerCommission } from "@/lib/order-booker/commission";

const SALES_FN_DIR = resolve(process.cwd(), "src/server-functions/sales");
const SALES_ROUTE_DIR = resolve(process.cwd(), "src/routes/_protected/sales");
const HOOKS_DIR = resolve(process.cwd(), "src/hooks/sales");
const PAYROLL_DIR = resolve(process.cwd(), "src/server-functions/hr/payroll");

describe("order booker regressions", () => {
  it("computes progressive commission bands exactly once for server and UI consumers", () => {
    const result = calculateOrderBookerCommission({
      fulfilledAmount: 1500,
      flatRate: 5,
      tiers: [
        { minAmount: 0, maxAmount: 1000, rate: 2 },
        { minAmount: 1000, maxAmount: 2000, rate: 3 },
      ],
    });

    expect(result.mode).toBe("tiered");
    expect(result.amount).toBe(35);
    expect(result.rate).toBe(3);
    expect(result.effectiveRate).toBeCloseTo(2.33, 2);
    expect(result.breakdown).toEqual([
      {
        minAmount: 0,
        maxAmount: 1000,
        rate: 2,
        bandAmount: 1000,
        commissionAmount: 20,
      },
      {
        minAmount: 1000,
        maxAmount: 2000,
        rate: 3,
        bandAmount: 500,
        commissionAmount: 15,
      },
    ]);
  });

  it("falls back to flat commission when no active tier applies", () => {
    const result = calculateOrderBookerCommission({
      fulfilledAmount: 800,
      flatRate: 4,
      tiers: [],
    });

    expect(result.mode).toBe("flat");
    expect(result.amount).toBe(32);
    expect(result.rate).toBe(4);
    expect(result.effectiveRate).toBe(4);
    expect(result.breakdown).toEqual([]);
  });

  it("accrues commission when invoice conversion delivers a linked order", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "invoice-posting-service.ts"),
      "utf8",
    );

    expect(source).toContain("await calculateCommissionForOrder(");
    expect(source).toContain("if (linkedOrderStatus !== \"delivered\")");
  });

  it("uses shared commission math in order fulfillment preview instead of single-tier full-amount math", () => {
    const source = readFileSync(
      resolve(SALES_ROUTE_DIR, "orders/index.tsx"),
      "utf8",
    );

    expect(source).toContain("calculateOrderBookerCommission({");
    expect(source).not.toContain("amountNum >= min && amountNum <= max");
  });

  it("counts delivered orders in order booker sales-performance logs", () => {
    const source = readFileSync(
      resolve(PAYROLL_DIR, "sales-performance-fn.ts"),
      "utf8",
    );

    expect(source).toContain("o.status === \"delivered\"");
    expect(source).not.toContain("o.status === \"fulfilled\"");
  });

  it("guards portal linking against duplicate user assignment across order bookers", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "sales-config-fn.ts"),
      "utf8",
    );

    expect(source).toContain("User already linked to order booker");
    expect(source).toContain("ne(orderBookers.id, data.orderBookerId)");
    expect(source).toContain("blockedUserIds");
  });

  it("treats pending commission as current accrued liability, not accrued minus paid minus reversed", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "order-booker-commission-fn.ts"),
      "utf8",
    );

    expect(source).toContain("const pending = records");
    expect(source).toContain("totalPending: pending");
    expect(source).toContain("r.status !== \"reversed\"");
    expect(source).not.toContain("totalPending: accrued - paid - reversed");
  });

  it("lets operational sales screens request only active order bookers", () => {
    const hookSource = readFileSync(
      resolve(HOOKS_DIR, "use-sales-people.ts"),
      "utf8",
    );
    const ordersSource = readFileSync(
      resolve(SALES_ROUTE_DIR, "orders/index.tsx"),
      "utf8",
    );
    const recoveriesSource = readFileSync(
      resolve(process.cwd(), "src/components/sales/batch-recoveries-dialog.tsx"),
      "utf8",
    );

    expect(hookSource).toContain("status?: \"active\" | \"inactive\"");
    expect(hookSource).toContain("getOrderBookersFn({ data: status ? { status } : {} })");
    expect(ordersSource).toContain("useGetOrderBookers(\"active\")");
    expect(recoveriesSource).toContain("useGetOrderBookers(\"active\")");
  });
});
