import { describe, expect, it } from "vitest";
import { describePostError, GENERIC_POST_ERROR } from "./post-error-message";

describe("describePostError", () => {
  it("explains a stock failure and says who can fix it", () => {
    const message = describePostError(new Error("Carton adjustment exceeds finished goods stock"));
    expect(message).toContain("carton packaging");
    expect(message).toContain("Refresh live checks");
    expect(message).not.toContain("adjustment");
  });

  it("tells the operator to compare with the paper copy when totals differ", () => {
    expect(describePostError(new Error("Posted total does not match signed offline total"))).toContain("paper");
  });

  it("keeps messages that already name the product", () => {
    const raw = 'Not enough stock for "Demo Cooking Oil 1L". Requested 24 units, available 12.';
    expect(describePostError(new Error(raw))).toBe(raw);
  });

  it("never shows raw database text", () => {
    expect(describePostError(new Error('insert into "invoices" failed: duplicate key'))).toBe(GENERIC_POST_ERROR);
    expect(describePostError("boom")).toBe(GENERIC_POST_ERROR);
  });
});
