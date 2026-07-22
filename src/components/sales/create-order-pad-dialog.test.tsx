import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/sales/create-order-pad-dialog.tsx"),
  "utf8",
);

describe("CreateOrderPadDialog trip details", () => {
  it("creates order-backed trips with the shared trip parser and shop type", () => {
    expect(source).toContain("parseOrderBookerTripForm(value.trip)");
    expect(source).toContain("shopType: tripValues.shopType");
    expect(source).toContain("ORDER_BOOKER_SHOP_TYPE_OPTIONS");
  });

  it("blocks order submission when trips are not allowed for that day", () => {
    expect(source).toContain("getOrderBookerTripEligibilityFn");
    expect(source).toContain('queryKey: ["orderBookerTripEligibility", orderBookerId, tripDate]');
    expect(source).toContain("disabled={create.isPending || isCheckingTripEligibility || !!blockedReason}");
  });
});
