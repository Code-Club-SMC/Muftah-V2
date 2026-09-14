import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORDERS_SOURCE = readFileSync(
  resolve("src/server-functions/sales/orders-fn.ts"),
  "utf8",
);
const RECOVERY_SOURCE = readFileSync(
  resolve("src/server-functions/sales/credit-recovery-fn.ts"),
  "utf8",
);

describe("salesman attendance triggers in sales workflows", () => {
  it("triggers attendance sync in fulfillOrderFn", () => {
    expect(ORDERS_SOURCE).toContain("syncSalesmanAttendanceForDate");
    expect(ORDERS_SOURCE).toContain("salesmanId: data.fulfilledBySalesmanId");
  });

  it("triggers attendance sync in logRecoveryAttemptFn", () => {
    expect(RECOVERY_SOURCE).toContain("syncSalesmanAttendanceForDate");
    expect(RECOVERY_SOURCE).toContain("salesmanId: data.assignedToId");
  });

  it("triggers attendance sync rollback in deleteOrderFn", () => {
    expect(ORDERS_SOURCE).toContain("deleteOrderFn");
    expect(ORDERS_SOURCE).toContain("order?.fulfilledBySalesmanId && order.status === \"delivered\"");
    expect(ORDERS_SOURCE).toContain("salesmanId: order.fulfilledBySalesmanId");
  });
});
