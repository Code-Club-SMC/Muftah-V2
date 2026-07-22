import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/sales/create-trip-dialog.tsx"),
  "utf8",
);

describe("CreateTripDialog trip-driven attendance guardrails", () => {
  it("uses the shared trip parser and submits shop type", () => {
    expect(source).toContain("parseOrderBookerTripForm(form)");
    expect(source).toContain("shopType: tripValues.shopType");
    expect(source).toContain("ORDER_BOOKER_SHOP_TYPE_OPTIONS");
  });

  it("checks whether the selected order-booker date can accept trips", () => {
    expect(source).toContain("getOrderBookerTripEligibilityFn");
    expect(source).toContain('queryKey: ["orderBookerTripEligibility", form.orderBookerId, form.tripDate]');
    expect(source).toContain("disabled={createTrip.isPending || isCheckingEligibility || !!blockedReason}");
  });
});
