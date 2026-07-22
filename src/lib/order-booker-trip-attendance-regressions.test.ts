import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

const createTripDialog = source("src/components/sales/create-trip-dialog.tsx");
const createOrderPadDialog = source("src/components/sales/create-order-pad-dialog.tsx");
const orderBookerDetailRoute = source(
  "src/routes/_protected/sales/people/order-bookers/$orderBookerId/index.tsx",
);
const orderBookerTripsFn = source(
  "src/server-functions/sales/order-booker-trips-fn.ts",
);
const ordersFn = source("src/server-functions/sales/orders-fn.ts");
const payrollCore = source("src/server-functions/hr/payroll/core.ts");
const orderBookerActivityLog = source(
  "src/components/hr/attendance/order-booker-attendance-log.tsx",
);

describe("order-booker trip-driven attendance regressions", () => {
  it("keeps backoffice trip entry on the approved shared dialogs", () => {
    expect(orderBookerDetailRoute).toContain(
      'import { CreateTripDialog } from "@/components/sales/create-trip-dialog"',
    );
    expect(orderBookerDetailRoute).toContain("<CreateTripDialog");
    expect(orderBookerDetailRoute).not.toContain("useCreateOrderBookerTrip");
    expect(orderBookerDetailRoute).not.toContain("const handleSubmit = () =>");
    expect(orderBookerDetailRoute).not.toContain("<DialogTitle>Log Trip</DialogTitle>");
  });

  it("requires shop type in both approved trip entry flows", () => {
    expect(createTripDialog).toContain("ORDER_BOOKER_SHOP_TYPE_OPTIONS");
    expect(createTripDialog).toContain("shopType: tripValues.shopType");
    expect(createTripDialog).toContain("parseOrderBookerTripForm(form)");

    expect(createOrderPadDialog).toContain("ORDER_BOOKER_SHOP_TYPE_OPTIONS");
    expect(createOrderPadDialog).toContain("shopType: tripValues.shopType");
    expect(createOrderPadDialog).toContain("parseOrderBookerTripForm(value.trip)");

    expect(orderBookerTripsFn).toContain('shopType: z.enum(["old", "new"])');
    expect(ordersFn).toContain('shopType: z.enum(["old", "new"])');
  });

  it("syncs attendance from both trip mutations and order creation", () => {
    expect(orderBookerTripsFn).toContain(
      'import { syncOrderBookerAttendanceForDate } from "./order-booker-trip-sync"',
    );
    expect(orderBookerTripsFn.match(/syncOrderBookerAttendanceForDate\(/g)?.length).toBeGreaterThanOrEqual(3);

    expect(ordersFn).toContain(
      'import { syncOrderBookerAttendanceForDate } from "./order-booker-trip-sync"',
    );
    expect(ordersFn).toContain("await syncOrderBookerAttendanceForDate({");
  });

  it("does not skip unresolved order-booker attendance in payroll", () => {
    expect(payrollCore).toContain("function shouldBlockMissingAttendance(");
    expect(payrollCore).toContain("if (employee.isOrderBooker) return true;");
    expect(payrollCore).toContain("return !employee.isSalesman;");
  });

  it("uses trips and orders, not attendance marketing snapshots, for order-booker logs", () => {
    expect(orderBookerActivityLog).toContain("getOrderBookerActivityLogFn");
    expect(orderBookerActivityLog).not.toContain("saleAmount");
    expect(orderBookerActivityLog).not.toContain("recoveryAmount");
    expect(orderBookerActivityLog).not.toContain("petrolAmount");
    expect(orderBookerActivityLog).not.toContain("areaVisited");
  });
});
